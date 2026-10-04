// Synthèse des 4 instruments (repris de la v0) : quelques oscillateurs et une enveloppe par note.
// Fonctionne sur un AudioContext (lecture) comme sur un OfflineAudioContext (export WAV).
import type { Instrument } from '../model/types';

export const INSTRUMENTS: { id: Instrument; label: string }[] = [
  { id: 'piano', label: 'Piano' },
  { id: 'flute', label: 'Flûte' },
  { id: 'cordes', label: 'Cordes' },
  { id: 'orgue', label: 'Orgue' },
];

export const hz = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12);

export interface Output {
  /** entrée des notes ; son gain sert aussi au fondu d'arrêt */
  input: GainNode;
  /** détache toute la chaîne de sortie du contexte */
  dispose(): void;
}

/** Sortie commune : gain général puis compresseur, pour que les accords à plusieurs lignes ne saturent pas. */
export function createOutput(ac: BaseAudioContext): Output {
  const input = ac.createGain();
  input.gain.value = 0.9;
  const comp = ac.createDynamicsCompressor();
  input.connect(comp);
  comp.connect(ac.destination);
  return { input, dispose: () => { input.disconnect(); comp.disconnect(); } };
}

/** Attaque, déclin vers le maintien, maintien, relâchement. Renvoie l'instant où le son est éteint. */
function env(g: AudioParam, t: number, dur: number, peak: number, a: number, s: number, r: number): number {
  const att = Math.min(a, dur);   // note plus courte que l'attaque : les évènements restent dans l'ordre
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + att);
  g.linearRampToValueAtTime(peak * s, t + Math.max(att, Math.min(dur, a + 0.1)));
  g.setValueAtTime(peak * s, t + dur);
  g.linearRampToValueAtTime(0, t + dur + r);
  return t + dur + r + 0.02;
}

/**
 * Programme une note : `t` et `dur` en secondes (temps du contexte). Renvoie les sources créées, pour
 * pouvoir les couper avant leur fin (arrêt de la lecture). Tous les nœuds de la note sont détachés du graphe
 * à la fin de la dernière source : rien ne s'accumule au fil d'une longue lecture.
 */
export function voice(ac: BaseAudioContext, dest: AudioNode, instr: Instrument, freq: number,
                      t: number, dur: number, vol: number): OscillatorNode[] {
  const out = ac.createGain();
  out.connect(dest);
  const g = out.gain, peak = 0.14 * vol, oscs: OscillatorNode[] = [];
  const mk = (type: OscillatorType, f: number, gain: number, to: AudioNode) => {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const gg = ac.createGain();
    gg.gain.value = gain;
    o.connect(gg);
    gg.connect(to);
    oscs.push(o);
  };
  const lp = (cut: number) => {
    const b = ac.createBiquadFilter();
    b.type = 'lowpass';
    b.frequency.value = cut;
    b.connect(out);
    return b;
  };
  let end: number;
  if (instr === 'piano') {
    mk('triangle', freq, 1, out);
    mk('sine', freq * 2, 0.25, out);
    g.setValueAtTime(0, t);
    g.linearRampToValueAtTime(peak * 1.4, t + 0.006);
    g.exponentialRampToValueAtTime(0.0004, t + dur + 0.45);
    end = t + dur + 0.5;
  } else if (instr === 'orgue') {
    const b = lp(2400);
    mk('square', freq, 0.45, b);
    mk('sine', freq / 2, 0.6, b);
    end = env(g, t, dur, peak * 0.9, 0.02, 1, 0.06);
  } else if (instr === 'flute') {
    mk('sine', freq, 1, out);
    mk('sine', freq * 2, 0.07, out);
    end = env(g, t, dur, peak * 1.3, 0.06, 0.85, 0.12);
  } else {
    const b = lp(1500);
    mk('sawtooth', freq, 0.5, b);
    mk('sawtooth', freq * 1.005, 0.5, b);
    end = env(g, t, dur, peak * 0.9, 0.09, 0.8, 0.25);
  }
  for (const o of oscs) { o.start(t); o.stop(end); }
  // toutes les sources s'arrêtent au même instant : la dernière suffit à signaler la fin de la note
  oscs[oscs.length - 1].onended = () => out.disconnect();
  return oscs;
}

/** Part de la durée écrite effectivement tenue : un léger détaché sépare les notes répétées. */
export const ARTICULATION = 0.92;
/** durée minimale d'une note jouée, en secondes */
export const MIN_NOTE = 0.05;
