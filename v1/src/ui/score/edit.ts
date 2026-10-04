// Logique d'édition de l'éditeur de mesure, sans React ni DOM : chaque opération prend les notes d'une
// mesure-ligne et rend un nouveau tableau (les tests la couvrent). Les composants l'appliquent au
// projet via editProject, ce qui rend chaque geste annulable.
//
// Règles communes :
// - toute note créée ou modifiée porte `manual: true` (elle survit à une réanalyse, cf. assemble) ;
// - un accord = notes de même voix, même offset, même durée : on les modifie ensemble ;
// - « décaler la suite » (ctx.shift) : un changement de durée ou une suppression déplace les
//   évènements suivants de la même voix, pour qu'une croche lue comme noire se corrige d'un geste.
//   Sans décalage, rien ne bouge : un raccourcissement laisse un silence, un allongement mange les
//   silences qui suivent.
import type { Clef, Line, Lyric, Measure, NoteEvent, PageLayout, Pitch } from '../../model/types';
import { EPS, diatonic, fromDiatonic, keyAlter, same } from '../../model/pitch';

export interface EditCtx {
  /** indice de la mesure dans le projet */
  measure: number;
  /** armure de la mesure (quintes) : altération par défaut d'une note posée ou déplacée */
  fifths: number;
  /** décaler la suite de la voix */
  shift: boolean;
  newId: () => string;
}

/** Durée attendue d'une mesure, en noires. */
export const measureLength = (m: Pick<Measure, 'beats' | 'beatType'>): number => (m.beats * 4) / m.beatType;

const end = (n: NoteEvent) => n.offset + n.duration;

/** Ordre du modèle : (mesure, offset, voix) ; le tri est stable, l'ordre d'un accord est conservé. */
export function compareNotes(a: NoteEvent, b: NoteEvent): number {
  if (a.measure !== b.measure) return a.measure - b.measure;
  if (!same(a.offset, b.offset)) return a.offset - b.offset;
  return a.voice - b.voice;
}
export const sortNotes = (notes: NoteEvent[]): NoteEvent[] => notes.slice().sort(compareNotes);

export const measureNotes = (line: Line, measure: number): NoteEvent[] => line.notes.filter(n => n.measure === measure);

/** Remplace le contenu d'une mesure dans une ligne (à appeler sur le brouillon d'editProject). */
export function replaceMeasureNotes(line: Line, measure: number, notes: NoteEvent[]): void {
  line.notes = sortNotes([...line.notes.filter(n => n.measure !== measure), ...notes]);
}

/** Notes d'un accord (ou le silence seul) auquel appartient `n`. */
export function slotOf(notes: NoteEvent[], n: NoteEvent): NoteEvent[] {
  if (!n.pitch) return [n];
  return notes.filter(x => x.pitch && x.voice === n.voice && same(x.offset, n.offset));
}

export const samePitch = (a: Pitch, b: Pitch) => a.step === b.step && a.octave === b.octave && a.alter === b.alter;

// ---------- Figures ----------

export interface Figure {
  /** valeur de la figure sans point ni triolet : 4 = ronde … 0.125 = triple croche */
  base: number;
  dots: number;
  triplet: boolean;
}

/** Les six figures de la palette, dans l'ordre des touches 1 à 6. */
export const FIGURES: { base: number; name: string; symbol: string }[] = [
  { base: 4, name: 'ronde', symbol: '𝅝' },
  { base: 2, name: 'blanche', symbol: '𝅗𝅥' },
  { base: 1, name: 'noire', symbol: '♩' },
  { base: 0.5, name: 'croche', symbol: '♪' },
  { base: 0.25, name: 'double croche', symbol: '𝅘𝅥𝅯' },
  { base: 0.125, name: 'triple croche', symbol: '𝅘𝅥𝅰' },
];

const log2Int = (x: number): number | null => {
  const l = Math.log2(x);
  return Math.abs(l - Math.round(l)) < 1e-6 ? Math.round(l) : null;
};

/** Décompose une durée en figure ; null si elle ne correspond à aucune figure simple. */
export function figureOf(d: number): Figure | null {
  if (!(d > EPS)) return null;
  let k = log2Int(d);
  if (k !== null) return { base: 2 ** k, dots: 0, triplet: false };
  if ((k = log2Int(d / 1.5)) !== null) return { base: 2 ** k, dots: 1, triplet: false };
  if ((k = log2Int(d / 1.75)) !== null) return { base: 2 ** k, dots: 2, triplet: false };
  if ((k = log2Int(d * 1.5)) !== null) return { base: 2 ** k, dots: 0, triplet: true };
  return null;
}

export const figureDuration = (f: Figure): number =>
  f.base * (f.dots === 2 ? 1.75 : f.dots === 1 ? 1.5 : 1) * (f.triplet ? 2 / 3 : 1);

/** Nombre de crochets d'une figure (croche = 1). */
export const flagCount = (base: number): number => Math.max(0, -Math.round(Math.log2(base)));

const PLAIN = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.375, 0.25, 0.125];
const TRIPLETS = [2 / 3, 1 / 3, 1 / 6];

function greedy(d: number, values: number[]): number[] | null {
  const out: number[] = [];
  let r = d;
  for (const v of values) while (r > v - EPS && out.length < 64) { out.push(v); r -= v; }
  return Math.abs(r) < EPS ? out : null;
}

/** Découpe une durée quelconque en figures écrivables (pour les silences de remplissage). */
export function decompose(d: number): number[] {
  if (d <= EPS) return [];
  return greedy(d, PLAIN) ?? greedy(d, [...TRIPLETS, ...PLAIN]) ?? [d];
}

// ---------- Opérations élémentaires ----------

function restsBetween(a: number, b: number, voice: number, ctx: EditCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  let t = a;
  for (const d of decompose(b - a)) {
    out.push({ id: ctx.newId(), measure: ctx.measure, offset: t, duration: d, pitch: null, voice, manual: true });
    t += d;
  }
  return out;
}

/** Décale de `delta` les évènements de la voix qui commencent à partir de `from`. */
function shiftFrom(notes: NoteEvent[], voice: number, from: number, delta: number, except?: Set<string>): NoteEvent[] {
  if (same(delta, 0)) return notes;
  return notes.map(n => (n.voice === voice && n.offset > from - EPS && !except?.has(n.id)
    ? { ...n, offset: Math.max(0, n.offset + delta), manual: true } : n));
}

/** Retire des silences de la voix la plage [a, b) : ils sont supprimés ou raccourcis. */
function trimRests(notes: NoteEvent[], voice: number, a: number, b: number, ctx: EditCtx): NoteEvent[] {
  const out: NoteEvent[] = [];
  for (const n of notes) {
    if (n.pitch || n.voice !== voice || !(n.offset < b - EPS && end(n) > a + EPS)) { out.push(n); continue; }
    if (n.offset < a - EPS) {
      // la partie qui précède garde l'identifiant du silence
      const left = restsBetween(n.offset, a, voice, ctx);
      if (left.length) left[0].id = n.id;
      out.push(...left);
    }
    if (end(n) > b + EPS) out.push(...restsBetween(b, end(n), voice, ctx));
  }
  return out;
}

/** Si plus rien n'est marqué manuel dans la mesure-ligne, on marque la voix touchée : sinon une
 *  réanalyse de la page referait apparaître la note supprimée (cf. assemble). */
function keepManual(notes: NoteEvent[], voice: number): NoteEvent[] {
  if (notes.some(n => n.manual)) return notes;
  return notes.map(n => (n.voice === voice ? { ...n, manual: true } : n));
}

export interface NewEvent {
  offset: number;
  duration: number;
  /** null = silence */
  pitch: Pitch | null;
  voice: number;
  /** insérer avant l'évènement qui commence là, en décalant toute la suite de la voix */
  insert?: boolean;
}

/**
 * Voix où atterrit un évènement posé à `offset` pour `duration` : la voix demandée, sauf si l'on pose une
 * note à l'intérieur d'une note de cette voix (blanche au temps 1, noire posée au temps 2). Elle passe
 * alors dans la première voix libre sur cette durée : les notes se superposent au lieu d'être repoussées.
 */
export function targetVoice(notes: NoteEvent[], ev: Pick<NewEvent, 'offset' | 'duration' | 'voice' | 'insert' | 'pitch'>): number {
  if (ev.insert || !ev.pitch) return ev.voice;
  const a = ev.offset, b = ev.offset + ev.duration;
  const inside = (v: number) => notes.some(n => n.pitch && n.voice === v && n.offset < a - EPS && end(n) > a + EPS);
  if (!inside(ev.voice)) return ev.voice;
  const busy = (v: number) => notes.some(n => n.pitch && n.voice === v && n.offset < b - EPS && end(n) > a + EPS);
  let v = 1;
  while (busy(v)) v++;
  return v;
}

/**
 * Pose une note ou un silence.
 * - Note à l'endroit où commence une note de la voix : elle rejoint l'accord (avec sa durée).
 * - Silence à l'endroit où commence une note : il la remplace et prend la figure choisie.
 * - Ailleurs : les silences de la voix recouverts sont remplacés ou raccourcis ; si la note déborde
 *   sur la note suivante et que « décaler la suite » est actif, la suite est repoussée d'autant.
 * - `insert` : tout ce qui commence à partir de là est repoussé de la durée posée.
 */
export function insertEvent(notes: NoteEvent[], ctx: EditCtx, ev: NewEvent): { notes: NoteEvent[]; id: string } {
  const v = targetVoice(notes, ev);
  const chord = notes.filter(n => n.pitch && n.voice === v && same(n.offset, ev.offset));
  if (chord.length && !ev.insert) {
    if (ev.pitch) {
      const p = ev.pitch;
      const dup = chord.find(n => samePitch(n.pitch!, p));
      if (dup) return { notes, id: dup.id };
      const id = ctx.newId();
      const note: NoteEvent = { id, measure: ctx.measure, offset: chord[0].offset, duration: chord[0].duration, pitch: p, voice: v, manual: true };
      return { notes: sortNotes([...notes, note]), id };
    }
    const id = chord[0].id;
    const rest: NoteEvent = { id, measure: ctx.measure, offset: chord[0].offset, duration: chord[0].duration, pitch: null, voice: v, manual: true };
    const out = [...notes.filter(n => !chord.includes(n)), rest];
    return { notes: setDuration(sortNotes(out), ctx, id, ev.duration), id };
  }

  const a = ev.offset, b = ev.offset + ev.duration;
  let out = notes;
  if (ev.insert) out = shiftFrom(out, v, a, ev.duration);
  else {
    out = trimRests(out, v, a, b, ctx);
    if (ctx.shift) {
      const next = out.filter(n => n.voice === v && n.offset > a - EPS).sort((x, y) => x.offset - y.offset)[0];
      if (next && next.offset < b - EPS) out = shiftFrom(out, v, next.offset, b - next.offset);
    }
  }
  const id = ctx.newId();
  out = [...out, { id, measure: ctx.measure, offset: a, duration: ev.duration, pitch: ev.pitch, voice: v, manual: true }];
  return { notes: sortNotes(out), id };
}

/** Change la figure d'une note (et de tout son accord) ou d'un silence. */
export function setDuration(notes: NoteEvent[], ctx: EditCtx, id: string, d: number): NoteEvent[] {
  const t = notes.find(n => n.id === id);
  if (!t || !(d > EPS) || same(t.duration, d)) return notes;
  const slot = new Set(slotOf(notes, t).map(n => n.id));
  const oldEnd = end(t), newEnd = t.offset + d;
  let out = notes.map(n => (slot.has(n.id) ? { ...n, duration: d, manual: true } : n));
  if (ctx.shift) out = shiftFrom(out, t.voice, oldEnd, d - t.duration, slot);
  else if (d > t.duration) out = trimRests(out, t.voice, oldEnd, newEnd, ctx);
  else out = [...out, ...restsBetween(newEnd, oldEnd, t.voice, ctx)];
  return sortNotes(out);
}

/**
 * Supprime une note ou un silence. Une note d'accord part seule. Sinon la suite de la voix est
 * ramenée en arrière (décalage) ou la place est laissée à un silence (note) / vide (silence).
 */
export function deleteEvent(notes: NoteEvent[], ctx: EditCtx, id: string): NoteEvent[] {
  const t = notes.find(n => n.id === id);
  if (!t) return notes;
  let out = notes.filter(n => n.id !== id);
  const chordLeft = t.pitch && out.some(n => n.pitch && n.voice === t.voice && same(n.offset, t.offset));
  if (!chordLeft) {
    if (ctx.shift) out = shiftFrom(out, t.voice, end(t), -t.duration);
    else if (t.pitch) out = [...out, ...restsBetween(t.offset, end(t), t.voice, ctx)];
  }
  // Mesure-ligne vidée : on y laisse un silence manuel de la durée libérée. Une mesure-ligne sans
  // note `manual` serait reprise telle quelle de la réanalyse, et la note supprimée reviendrait.
  if (!out.length) out = restsBetween(t.offset, end(t), t.voice, ctx);
  return sortNotes(keepManual(out, t.voice));
}

function updateNote(notes: NoteEvent[], id: string, fn: (n: NoteEvent) => NoteEvent): NoteEvent[] {
  return notes.map(n => (n.id === id ? { ...fn(n), manual: true } : n));
}

/** Monte ou descend une note de `steps` degrés ; l'altération reprend celle de l'armure. */
export function movePitch(notes: NoteEvent[], ctx: EditCtx, id: string, steps: number): NoteEvent[] {
  const t = notes.find(n => n.id === id);
  if (!t?.pitch || !steps) return notes;
  const { step, octave } = fromDiatonic(diatonic(t.pitch) + steps);
  return updateNote(notes, id, n => ({ ...n, pitch: { step, octave, alter: keyAlter(step, ctx.fifths) } }));
}

/** Altération explicite (-2..2) ou celle de l'armure. */
export function setAlter(notes: NoteEvent[], ctx: EditCtx, id: string, alter: number | 'key'): NoteEvent[] {
  const t = notes.find(n => n.id === id);
  if (!t?.pitch) return notes;
  const a = alter === 'key' ? keyAlter(t.pitch.step, ctx.fifths) : alter;
  if (a === t.pitch.alter) return notes;
  return updateNote(notes, id, n => ({ ...n, pitch: { ...n.pitch!, alter: a } }));
}

export function toggleTie(notes: NoteEvent[], id: string): NoteEvent[] {
  const t = notes.find(n => n.id === id);
  if (!t?.pitch) return notes;
  return updateNote(notes, id, n => {
    const { tie, ...rest } = n;
    return tie ? rest : { ...rest, tie: true };
  });
}

// ---------- Polyphonie : déplacer dans le temps, changer de voix ----------
//
// Audiveris place parfois les notes d'une seconde voix à la suite de la première au lieu de les
// superposer (la mesure déborde alors d'un ou deux temps). On corrige en déplaçant l'accord fautif dans
// le temps et en le passant dans une autre voix : chaque voix retombe sur la métrique.

/** Déplace la note (avec son accord) ou le silence de `delta` noires, sans toucher au reste. */
export function moveInTime(notes: NoteEvent[], ctx: EditCtx, id: string, delta: number): NoteEvent[] {
  const t = notes.find(n => n.id === id);
  if (!t || same(delta, 0)) return notes;
  const to = Math.max(0, t.offset + delta);
  if (same(to, t.offset)) return notes;
  const slot = slotOf(notes, t);
  const ids = new Set(slot.map(n => n.id));
  // les silences de la voix recouverts à l'arrivée cèdent la place
  const others = trimRests(notes.filter(n => !ids.has(n.id)), t.voice, to, to + t.duration, ctx);
  const moved = slot.map(n => ({ ...n, offset: to, manual: true }));
  return sortNotes(keepManual([...others, ...moved], t.voice));
}

/** Passe la note (avec son accord) ou le silence dans la voix `voice`, à la même position. */
export function setVoice(notes: NoteEvent[], ctx: EditCtx, id: string, voice: number): NoteEvent[] {
  const t = notes.find(n => n.id === id);
  if (!t || t.voice === voice || voice < 1) return notes;
  const slot = slotOf(notes, t);
  const ids = new Set(slot.map(n => n.id));
  const others = trimRests(notes.filter(n => !ids.has(n.id)), voice, t.offset, t.offset + t.duration, ctx);
  const moved = slot.map(n => ({ ...n, voice, manual: true }));
  return sortNotes(keepManual([...others, ...moved], voice));
}

/**
 * Ramène une mesure-ligne à la métrique `len` : ce qui commence au-delà de la barre est supprimé, ce qui
 * la franchit est raccourci. Annulable comme toute correction ; à réserver au contenu vraiment en trop
 * (pour une seconde voix mal placée, mieux vaut déplacer et changer de voix).
 */
export function fitToMeter(notes: NoteEvent[], ctx: EditCtx, len: number): NoteEvent[] {
  if (!notes.some(n => end(n) > len + EPS)) return notes;
  const out: NoteEvent[] = [];
  for (const n of notes) {
    if (n.offset >= len - EPS) continue;
    if (end(n) > len + EPS) {
      const { tie: _tie, ...rest } = n;   // une note coupée à la barre n'est plus liée à la suivante
      void _tie;
      out.push({ ...rest, duration: len - n.offset, manual: true });
    } else out.push(n);
  }
  if (!out.length) return restsBetween(0, len, 1, ctx);
  return sortNotes(keepManual(out, out[0].voice));
}

/** Fin du contenu d'une mesure-ligne, toutes voix confondues. */
export const contentEnd = (notes: NoteEvent[]): number => Math.max(0, ...notes.map(end));

// ---------- Paroles ----------

const continues = (l?: Lyric) => l?.syllabic === 'begin' || l?.syllabic === 'middle';
export const lyricOf = (n: NoteEvent, verse: number): Lyric | undefined => n.lyrics?.find(l => l.verse === verse);

/** Texte affiché dans le champ : la syllabe, suivie d'un trait d'union si le mot continue. */
export const lyricDisplay = (l?: Lyric): string => (l ? l.text + (continues(l) ? '-' : '') : '');

/**
 * Saisie d'une syllabe sur une note. `lineNotes` = toutes les notes de la ligne (le découpage en
 * syllabes dépend de la syllabe précédente du couplet, éventuellement dans une autre mesure).
 * Règle simple et prévisible : un trait d'union final (« Là- ») = le mot continue (begin/middle),
 * sinon il se termine (single/end). La syllabe suivante est réajustée en conséquence. Champ vide =
 * syllabe supprimée.
 */
export function setLyric(lineNotes: NoteEvent[], id: string, verse: number, input: string): NoteEvent[] {
  const idx = lineNotes.findIndex(n => n.id === id);
  if (idx < 0 || !lineNotes[idx].pitch) return lineNotes;
  const target = lineNotes[idx];
  const raw = input.trim();
  const hyphen = /[-‐‑–]$/.test(raw);
  const text = raw.replace(/\s*[-‐‑–]+$/, '').trim();
  const sameVoice = (n: NoteEvent) => n.voice === target.voice && !!lyricOf(n, verse);
  let prev: NoteEvent | undefined;
  for (let i = idx - 1; i >= 0 && !prev; i--) if (sameVoice(lineNotes[i])) prev = lineNotes[i];
  const prevCont = prev ? continues(lyricOf(prev, verse)) : false;

  const out = lineNotes.slice();
  const lyrics = (target.lyrics ?? []).filter(l => l.verse !== verse);
  let cur: Lyric | undefined;
  if (text) {
    cur = { verse, text, syllabic: hyphen ? (prevCont ? 'middle' : 'begin') : (prevCont ? 'end' : 'single'), manual: true };
    lyrics.push(cur);
    lyrics.sort((x, y) => x.verse - y.verse);
  }
  const { lyrics: _old, ...bare } = target;
  void _old;
  out[idx] = lyrics.length ? { ...bare, lyrics } : bare;

  // La syllabe suivante du couplet commence ou continue un mot selon ce qui la précède désormais.
  const cont = cur ? continues(cur) : prevCont;
  for (let i = idx + 1; i < out.length; i++) {
    if (!sameVoice(out[i])) continue;
    const nl = lyricOf(out[i], verse)!;
    const syl: Lyric['syllabic'] = cont ? (continues(nl) ? 'middle' : 'end') : (continues(nl) ? 'begin' : 'single');
    if (syl !== (nl.syllabic ?? 'single')) {
      out[i] = { ...out[i], lyrics: out[i].lyrics!.map(l => (l.verse === verse ? { ...l, syllabic: syl } : l)) };
    }
    break;
  }
  return out;
}

/**
 * Retire un couplet des notes d'une ligne (à appliquer à toute la partition) ; les couplets suivants
 * remontent d'un cran, si bien qu'il reste toujours un couplet 1. Sert à ne garder qu'une ligne de texte
 * quand l'original en imprime deux (paroles anglaises et françaises, par exemple).
 */
export function dropVerse(notes: NoteEvent[], verse: number): NoteEvent[] {
  if (!notes.some(n => n.lyrics?.length)) return notes;
  return notes.map(n => {
    if (!n.lyrics?.length) return n;
    const lyrics = n.lyrics.filter(l => l.verse !== verse).map(l => (l.verse > verse ? { ...l, verse: l.verse - 1 } : l));
    const { lyrics: _old, ...bare } = n;
    void _old;
    return lyrics.length ? { ...bare, lyrics } : bare;
  });
}

/** Couplets présents dans une ligne (au moins le 1). */
export function versesOf(line: Line): number[] {
  const s = new Set<number>([1]);
  for (const n of line.notes) for (const l of n.lyrics ?? []) s.add(l.verse);
  return [...s].sort((a, b) => a - b);
}

// ---------- Aimantation ----------

export interface Snap {
  offset: number;
  /** chord = début d'une note (accord), rest = début d'un silence, end = fin de l'évènement précédent */
  kind: 'chord' | 'rest' | 'end' | 'grid';
}

/**
 * Position temporelle aimantée : début d'un évènement de la voix (pour former un accord) s'il est à
 * moins de `tol`, sinon le plus proche des fins d'évènements et des points de la grille
 * (pas = min(figure, 1 temps)). La grille couvre aussi l'intérieur des notes : une note posée là passe
 * dans une autre voix (targetVoice). Elle s'étend jusqu'à la fin de la mesure, ou du contenu s'il déborde.
 */
export function snapOffset(t: number, notes: NoteEvent[], voice: number, figure: number, len: number, tol: number): Snap {
  const own = notes.filter(n => n.voice === voice);
  const limit = Math.max(len, ...own.map(end));
  const starts: Snap[] = own.map(n => ({ offset: n.offset, kind: n.pitch ? 'chord' as const : 'rest' as const }));
  let best: Snap | null = null;
  let bestD = Infinity;
  for (const s of starts) {
    const d = Math.abs(s.offset - t);
    if (d <= tol && (d < bestD - EPS || (same(d, bestD) && s.kind === 'chord'))) { best = s; bestD = d; }
  }
  if (best) return best;
  const cands: Snap[] = [...starts];
  for (const n of own) if (end(n) < limit - EPS) cands.push({ offset: end(n), kind: 'end' });
  const g = Math.min(figure, 1);
  for (let k = 0; k * g < limit - EPS && k < 512; k++) cands.push({ offset: k * g, kind: 'grid' });
  for (const c of cands) {
    const d = Math.abs(c.offset - t);
    if (d < bestD - EPS) { best = c; bestD = d; }
  }
  return best ?? { offset: 0, kind: 'grid' };
}

// ---------- Portée ----------

/** Indice diatonique de la ligne du bas de la portée pour une clé (Mi4 en clé de sol). */
export function clefBottom(c: Clef): number {
  const oct = 7 * (c.octaveChange ?? 0);
  switch (c.sign) {
    case 'F': return 24 - 2 * ((c.line || 4) - 1) + oct;   // Fa3 sur sa ligne
    case 'C': return 28 - 2 * ((c.line || 3) - 1) + oct;   // Do4 sur sa ligne
    default: return 32 - 2 * ((c.line || 2) - 1) + oct;    // Sol4 sur sa ligne (percussion : comme sol)
  }
}

/** Clé en vigueur à une position de la ligne (changements de clé compris). */
export function clefAt(line: Line, measure: number, offset = 0): Clef {
  let c = line.clef;
  for (const ch of line.clefChanges ?? []) {
    if (ch.measure < measure || (ch.measure === measure && ch.offset <= offset + EPS)) c = ch.clef;
  }
  return c;
}

const SHARPS: number[] = [38, 35, 39, 36, 33, 37, 34];  // Fa5 Do5 Sol5 Ré5 La4 Mi5 Si4 en clé de sol
const FLATS: number[] = [34, 37, 33, 36, 32, 35, 31];   // Si4 Mi5 La4 Ré5 Sol4 Do5 Fa4

/** Positions (indices diatoniques) des altérations de l'armure, transposées dans la clé. */
export function keySignature(fifths: number, bottom: number): number[] {
  const base = fifths >= 0 ? SHARPS.slice(0, fifths) : FLATS.slice(0, -fifths);
  return base.map(d => {
    const target = d - 30 + bottom;
    // même nom de note, octave la plus proche de la position qu'elle a en clé de sol
    const k = Math.round((target - d) / 7);
    return d + 7 * k;
  });
}

/** Hauteur visée sur la portée, avec l'altération de l'armure. */
export function pitchAt(d: number, fifths: number): Pitch {
  const { step, octave } = fromDiatonic(d);
  return { step, octave, alter: keyAlter(step, fifths) };
}

// ---------- Extrait de l'image d'origine ----------

/**
 * Rectangle d'une mesure dans l'image ANALYSÉE (coordonnées du découpage d'Audiveris) : la `local`-ième
 * mesure de la page en parcourant les systèmes dans l'ordre, sur toute la hauteur de son système, avec
 * une marge pour les paroles et les notes hors portée. null si la page n'a pas autant de mesures.
 */
export function measureBox(layout: PageLayout, local: number): { x: number; y: number; w: number; h: number; left: number; right: number } | null {
  let k = 0;
  for (const sys of layout.systems) {
    for (const mm of sys.measures) {
      if (k++ !== local) continue;
      const il = layout.interline || 20;
      const x0 = Math.max(0, mm.left - 1.5 * il), x1 = Math.min(layout.width || Infinity, mm.right + 1.5 * il);
      const y0 = Math.max(0, sys.top - 3 * il), y1 = Math.min(layout.height || Infinity, sys.bottom + 4 * il);
      // left/right : bords de la mesure elle-même, pour estomper les marges
      return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0, left: mm.left, right: mm.right } : null;
    }
  }
  return null;
}
