// Interprétation : du modèle (notes relatives aux mesures) à une liste d'évènements sonores à temps absolu.
// Pur et sans Web Audio, pour être testé et partagé par la lecture en direct et l'export WAV.
import type { Instrument, Line, LineSettings, MeasureTime, Project, Settings } from '../model/types';
import { midi as midiOf } from '../model/pitch';

export interface PlayEvent {
  /** hauteur MIDI, transposition comprise */
  midi: number;
  /** début, en noires depuis le début de la partition */
  start: number;
  /** durée en noires (notes liées fusionnées) */
  dur: number;
  lineId: string;
  instrument: Instrument;
  /** 0..1 */
  volume: number;
}

export interface PerformOptions {
  /** début de la lecture (noires) ; une note déjà commencée est reprise pour sa durée restante */
  from?: number;
  /** fin de la lecture (exclue) ; les notes qui la dépassent sont écourtées */
  to?: number;
  /** une seule ligne, jouée même si elle est désactivée (écoute d'une mesure dans l'éditeur) */
  only?: string;
  /** remplace settings.transpose */
  transpose?: number;
}

/** Tempo de départ : jamais lu sur la partition, on l'ajuste à l'oreille. */
export const DEFAULT_TEMPO = 100;
export const MIN_TEMPO = 30;
export const MAX_TEMPO = 240;
export const clampTempo = (t: number): number =>
  Math.max(MIN_TEMPO, Math.min(MAX_TEMPO, Math.round(t) || DEFAULT_TEMPO));

const EPS = 1e-6;
/** tolérance d'alignement d'une liaison (arrondis des triolets) */
const TIE_TOL = 1e-3;
/** reste minimal d'une note déjà commencée pour qu'on la rejoue : en deçà, ce serait un simple clic */
const MIN_HOLD = 0.25;

/** Réglages d'une ligne, avec des valeurs par défaut si le projet n'en a pas (ligne ajoutée après coup). */
export function lineSettingsOf(settings: Settings, line: Line): LineSettings {
  return settings.lines[line.id] ?? { enabled: true, instrument: line.clef.sign === 'F' ? 'cordes' : 'piano', volume: 0.8 };
}

/** Durée totale de la partition, en noires. */
export function totalBeats(times: MeasureTime[]): number {
  const last = times[times.length - 1];
  return last ? last.start + last.len : 0;
}

/** Indice de la mesure qui contient `beat` (la dernière si on est au-delà), -1 si la partition est vide. */
export function measureAt(times: MeasureTime[], beat: number): number {
  let lo = 0, hi = times.length - 1, found = times.length ? 0 : -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid].start <= beat + EPS) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found;
}

interface Abs { midi: number; start: number; end: number; measure: number; offset: number; tie: boolean }

/**
 * Notes d'une ligne à temps absolu, liaisons fusionnées. Une liaison se raccorde à la note suivante de même
 * hauteur qui commence là où elle finit — ou, si la mesure a un rythme faux (contenu plus court que la
 * mesure), à la première note de la mesure suivante : on comble alors le trou plutôt que de rejouer la note.
 */
function lineNotes(line: Line, times: MeasureTime[]): Abs[] {
  const abs: Abs[] = [];
  for (const n of line.notes) {
    const t = times[n.measure];
    if (!n.pitch || !t || !(n.duration > EPS)) continue;   // silences, grâces (durée nulle), mesure inconnue
    const start = t.start + n.offset;
    abs.push({ midi: midiOf(n.pitch), start, end: start + n.duration, measure: n.measure, offset: n.offset, tie: !!n.tie });
  }
  abs.sort((a, b) => a.start - b.start || a.midi - b.midi);

  const out: Abs[] = [];
  const open = new Map<number, Abs>();   // liaisons en attente de leur suite, par hauteur
  for (const n of abs) {
    const p = open.get(n.midi);
    if (p) {
      const aligned = Math.abs(n.start - p.end) < TIE_TOL;
      const nextBar = n.measure === p.measure + 1 && n.offset < TIE_TOL && n.start >= p.end - TIE_TOL;
      if (aligned || nextBar) {
        p.end = n.end;
        p.measure = n.measure;
        if (!n.tie) open.delete(n.midi);
        continue;
      }
      // la suite attendue n'est jamais venue (liaison vers une autre page, note perdue…) : on abandonne
      if (n.start > p.end + TIE_TOL) open.delete(n.midi);
    }
    const e = { ...n };
    out.push(e);
    if (n.tie) open.set(n.midi, e);
  }
  return out;
}

/** Évènements à jouer, triés par début. Les silences ne produisent rien : seul compte le temps des notes. */
export function perform(p: Project, times: MeasureTime[], opts: PerformOptions = {}): PlayEvent[] {
  const from = opts.from ?? 0;
  const to = opts.to ?? Infinity;
  const transpose = opts.transpose ?? p.settings.transpose;
  const events: PlayEvent[] = [];
  for (const line of p.lines) {
    const ls = lineSettingsOf(p.settings, line);
    if (opts.only !== undefined ? line.id !== opts.only : !ls.enabled) continue;
    for (const n of lineNotes(line, times)) {
      if (n.end <= from + EPS || n.start >= to - EPS) continue;
      let start = n.start;
      if (start < from - EPS) {
        if (n.end - from < MIN_HOLD) continue;
        start = from;
      }
      const end = Math.min(n.end, to);
      events.push({ midi: n.midi + transpose, start, dur: end - start, lineId: line.id, instrument: ls.instrument, volume: ls.volume });
    }
  }
  return events.sort((a, b) => a.start - b.start || a.midi - b.midi);
}
