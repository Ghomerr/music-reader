// Export audio : rendu hors ligne avec les réglages courants (tempo, transposition, lignes actives,
// instruments, volumes), encodé en WAV PCM 16 bits mono 44,1 kHz (~5 Mo/min).
import { timeline } from '../model/check';
import type { Project } from '../model/types';
import { clampTempo, perform, totalBeats, type PlayEvent } from './perform';
import { ARTICULATION, MIN_NOTE, createOutput, hz, voice } from './synth';

export const SAMPLE_RATE = 44100;
/** silence avant la première note et résonance laissée après la dernière, en secondes */
const HEAD = 0.05;
const TAIL = 1.5;
/** tranche de rendu : on programme les notes tranche par tranche et on publie la progression entre deux */
const CHUNK = 5;

/** Encode des échantillons (-1..1) en WAV PCM 16 bits mono : en-tête RIFF de 44 octets puis les données. */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const n = samples.length;
  const v = new DataView(new ArrayBuffer(44 + n * 2));
  const ascii = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);       // taille du fichier moins les 8 octets de cet en-tête
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);              // taille du bloc fmt (PCM)
  v.setUint16(20, 1, true);               // PCM entier
  v.setUint16(22, 1, true);               // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);  // octets par seconde
  v.setUint16(32, 2, true);               // octets par échantillon (toutes voies)
  v.setUint16(34, 16, true);              // bits par échantillon
  ascii(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0, o = 44; i < n; i++, o += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return v.buffer;
}

/**
 * Rend toute la partition avec les réglages courants. `onProgress` reçoit 0..1 au fil du rendu, quand le
 * navigateur sait suspendre un rendu hors ligne (Chrome, Safari) ; sinon seulement 1 à la fin.
 */
export async function renderWav(p: Project, onProgress?: (fraction: number) => void): Promise<Blob> {
  const times = timeline(p);
  const events = perform(p, times);
  if (!events.length) throw new Error('aucune note à jouer (lignes toutes désactivées ?)');
  const spb = 60 / clampTempo(p.settings.tempo);
  const duration = HEAD + totalBeats(times) * spb + TAIL;
  const chunked = typeof OfflineAudioContext.prototype.suspend === 'function';
  let buf = await render(events, spb, duration, chunked, onProgress);
  // une suspension refusée laisse des notes non programmées : on refait le rendu d'un seul tenant
  if (!buf) buf = (await render(events, spb, duration, false))!;
  onProgress?.(1);
  return new Blob([encodeWav(buf.getChannelData(0), buf.sampleRate)], { type: 'audio/wav' });
}

/** Rendu hors ligne ; null si le rendu par tranches a échoué en route. */
async function render(events: PlayEvent[], spb: number, duration: number, chunked: boolean,
                      onProgress?: (fraction: number) => void): Promise<AudioBuffer | null> {
  const oac = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * duration), SAMPLE_RATE);
  const out = createOutput(oac).input;
  let idx = 0;
  // Programme les notes qui commencent avant `until` (secondes). Par tranches, les nœuds d'une note se
  // détachent d'eux-mêmes à sa fin : un long morceau ne garde en mémoire que les tranches en cours.
  const scheduleUntil = (until: number) => {
    for (; idx < events.length; idx++) {
      const e = events[idx];
      const t = HEAD + e.start * spb;
      if (t >= until) break;
      voice(oac, out, e.instrument, hz(e.midi), t, Math.max(MIN_NOTE, e.dur * spb * ARTICULATION), e.volume);
    }
  };
  let failed = false;
  if (chunked) {
    scheduleUntil(CHUNK);
    for (let t = CHUNK; t < duration; t += CHUNK) {
      const at = t;
      oac.suspend(at).then(() => {
        onProgress?.(at / duration);
        scheduleUntil(at + CHUNK);
        return oac.resume();
      }).catch(() => { failed = true; });
    }
  } else {
    scheduleUntil(Infinity);
  }
  const buf = await oac.startRendering();
  return failed ? null : buf;
}

/** Nom de fichier tiré du titre : sans accents ni ponctuation. */
export function slug(title: string): string {
  return title.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'partition';
}

/** « ode-a-la-joie_+2_110bpm.wav » : les réglages entendus se lisent dans le nom. */
export function wavName(p: Project): string {
  const t = p.settings.transpose;
  return `${slug(p.title)}${t ? `_${t > 0 ? '+' : ''}${t}` : ''}_${clampTempo(p.settings.tempo)}bpm.wav`;
}

/**
 * Remet un fichier à l'utilisateur. Sur mobile, feuille de partage du système quand elle accepte les
 * fichiers (iOS gère mal les téléchargements en PWA) ; ailleurs, téléchargement classique.
 */
export async function saveFile(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], name, { type: blob.type });
  const mobile = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  if (mobile && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      return 'shared';
    } catch (e) {
      if ((e as Error).name === 'AbortError') return 'cancelled';
      // partage refusé (autorisation, type de fichier…) : on retombe sur le téléchargement
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return 'downloaded';
}
