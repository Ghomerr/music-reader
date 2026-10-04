// Hauteurs : MIDI, noms, armures et transposition orthographiée.
import type { Pitch, Step } from './types';

export const STEPS: Step[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const SEMI: Record<Step, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const FR: Record<Step, string> = { C: 'Do', D: 'Ré', E: 'Mi', F: 'Fa', G: 'Sol', A: 'La', B: 'Si' };
/** position de chaque note naturelle sur la ligne des quintes (Fa = -1, Do = 0, Sol = 1…) */
const FIFTH_POS: Record<Step, number> = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };
const FROM_FIFTH = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as Step[];

export const midi = (p: Pitch): number => (p.octave + 1) * 12 + SEMI[p.step] + p.alter;

/** Indice diatonique absolu (Do0 = 0, Ré0 = 1…) : sert à placer une note sur la portée. */
export const diatonic = (p: Pick<Pitch, 'step' | 'octave'>): number => p.octave * 7 + STEPS.indexOf(p.step);
export const fromDiatonic = (d: number): { step: Step; octave: number } =>
  ({ step: STEPS[((d % 7) + 7) % 7], octave: Math.floor(d / 7) });

const ACC = (a: number) => (a > 0 ? '♯'.repeat(a) : a < 0 ? '♭'.repeat(-a) : '');

/** « Mi♭4 » */
export const pitchLabel = (p: Pitch): string => FR[p.step] + ACC(p.alter) + p.octave;
/** « Eb4 » (notation scientifique, celle du fichier projet) */
export const pitchCode = (p: Pitch): string =>
  p.step + (p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter)) + p.octave;

export function parsePitchCode(s: string): Pitch | null {
  const m = /^([A-G])(#{1,2}|b{1,2})?(-?\d)$/.exec(s.trim());
  if (!m) return null;
  const acc = m[2] || '';
  return { step: m[1] as Step, alter: acc.startsWith('#') ? acc.length : acc ? -acc.length : 0, octave: +m[3] };
}

/** Altération qu'impose l'armure à un degré (ex. Si en Fa majeur → -1). */
export function keyAlter(step: Step, fifths: number): number {
  const pos = FIFTH_POS[step];
  if (fifths > 0 && pos < fifths - 1) return 1;     // dièses : Fa, Do, Sol… dans l'ordre
  if (fifths < 0 && pos >= 6 + fifths) return -1;   // bémols : Si, Mi, La… dans l'ordre
  return 0;
}

const MAJOR = ['Do♭', 'Sol♭', 'Ré♭', 'La♭', 'Mi♭', 'Si♭', 'Fa', 'Do', 'Sol', 'Ré', 'La', 'Mi', 'Si', 'Fa♯', 'Do♯'];
const MINOR = ['La♭', 'Mi♭', 'Si♭', 'Fa', 'Do', 'Sol', 'Ré', 'La', 'Mi', 'Si', 'Fa♯', 'Do♯', 'Sol♯', 'Ré♯', 'La♯'];

/** « Mi♭ majeur » */
export function keyLabel(fifths: number, mode: 'major' | 'minor' = 'major'): string {
  if (fifths < -7 || fifths > 7) return '?';
  return (mode === 'minor' ? MINOR : MAJOR)[fifths + 7] + (mode === 'minor' ? ' mineur' : ' majeur');
}

/**
 * Transposition orthographiée. On choisit l'intervalle sur la ligne des quintes de sorte que la nouvelle
 * armure ait le moins d'altérations possible, puis on décale chaque note du même nombre de quintes :
 * l'écriture reste cohérente avec l'armure (une tierce majeure reste une tierce majeure).
 */
export function transposeKey(fifths: number, semitones: number): { fifths: number; shift: number } {
  const t = ((semitones % 12) + 12) % 12;
  const base = (t * 7) % 12;                     // quintes équivalentes à t demi-tons, modulo 12
  let best = { fifths, shift: 0 };
  let bestScore = Infinity;
  for (const shift of [base - 12, base, base + 12]) {
    const f = fifths + shift;
    // à égalité (6 dièses / 6 bémols), on préfère les bémols si l'on descend, les dièses si l'on monte
    const score = Math.abs(f) * 2 + (Math.abs(f) === 6 ? (semitones < 0 ? (f > 0 ? 1 : 0) : (f < 0 ? 1 : 0)) : 0);
    if (Math.abs(f) <= 7 && score < bestScore) { bestScore = score; best = { fifths: f, shift }; }
  }
  return best;
}

export function transposePitch(p: Pitch, semitones: number, shift: number): Pitch {
  if (!semitones) return p;
  const pos = FIFTH_POS[p.step] + 7 * p.alter + shift;
  const natural = ((pos + 1) % 7 + 7) % 7;       // Fa=0 … Si=6
  const step = FROM_FIFTH[natural];
  const alter = Math.round((pos - (natural - 1)) / 7) || 0;   // || 0 : pas de -0
  const target = midi(p) + semitones;
  const octave = Math.floor((target - SEMI[step] - alter) / 12) - 1;
  return { step, alter, octave };
}

/** Durées usuelles en noires → nom et symbole (palette de l'éditeur, résumés). */
export const DURATIONS: { value: number; name: string; symbol: string }[] = [
  { value: 4, name: 'ronde', symbol: '𝅝' },
  { value: 3, name: 'blanche pointée', symbol: '𝅗𝅥.' },
  { value: 2, name: 'blanche', symbol: '𝅗𝅥' },
  { value: 1.5, name: 'noire pointée', symbol: '♩.' },
  { value: 1, name: 'noire', symbol: '♩' },
  { value: 0.75, name: 'croche pointée', symbol: '♪.' },
  { value: 2 / 3, name: 'triolet de noires', symbol: '♩³' },
  { value: 0.5, name: 'croche', symbol: '♪' },
  { value: 0.375, name: 'double pointée', symbol: '𝅘𝅥𝅯.' },
  { value: 1 / 3, name: 'triolet de croches', symbol: '♪³' },
  { value: 0.25, name: 'double croche', symbol: '𝅘𝅥𝅯' },
  { value: 1 / 6, name: 'triolet de doubles', symbol: '𝅘𝅥𝅯³' },
  { value: 0.125, name: 'triple croche', symbol: '𝅘𝅥𝅰' },
];
export const durationName = (d: number): string =>
  DURATIONS.find(x => Math.abs(x.value - d) < 1e-6)?.name ?? `${+d.toFixed(3)} temps`;

export const EPS = 1e-6;
export const same = (a: number, b: number) => Math.abs(a - b) < EPS;
