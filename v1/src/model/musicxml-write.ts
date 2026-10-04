// Projet → MusicXML 3.1 partwise. Sert à l'affichage (OSMD, avec couleurs de diagnostic) comme à
// l'impression (sans couleurs) : une seule écriture, pour que l'écran montre exactement ce qui sortira.
//
// Le modèle est volontairement lâche (une mesure peut déborder, une voix peut se chevaucher, une ligne
// peut être vide) : on n'y corrige rien, on l'écrit de façon à ce qu'OSMD l'affiche sans se perdre.
// Toutes les positions sont converties en « ticks » entiers (DIVISIONS par noire) avant d'écrire.
import { timeline } from './check';
import { diatonic, EPS, transposeKey, transposePitch } from './pitch';
import type { Clef, IssueKind, Line, Lyric, NoteEvent, Pitch, Project } from './types';

export interface WriteOptions {
  /** lignes à écrire, dans l'ordre du projet ; absent ou vide = toutes */
  lines?: string[];
  /** demi-tons ; transpose notes ET armure, écriture orthographiée (pitch.ts) */
  transpose?: number;
  /** écrire les paroles (défaut : oui) */
  lyrics?: boolean;
  /** couplets à écrire ; absent ou vide = tous */
  verses?: number[];
  /** couleurs de diagnostic par `${measure}|${lineId}` ; absent = partition propre (impression) */
  colors?: Map<string, IssueKind>;
  /** reprendre les sauts de système / page de l'original */
  keepLayout?: boolean;
  title?: string;
  /** n'écrire que les mesures [début, fin] (indices inclus) */
  range?: [number, number];
}

/** 48 par noire : croches, doubles, triples (6) et triolets de noires, croches, doubles (32, 16, 8). */
export const DIVISIONS = 48;

/** Couleurs de diagnostic, reprises de styles.css (--diag-rhythm, --diag-empty). */
export const ISSUE_COLORS: Record<IssueKind, string> = {
  rhythm: '#e8590c', gap: '#e8590c', lost: '#e8590c', empty: '#d6336c',
};

// ---------- Figures de note ----------

export interface Figure {
  ticks: number;
  type: string;
  dots: number;
  /** triolet (time-modification 3:2) */
  triplet: boolean;
}

const BASE: [string, number][] = [
  ['whole', 192], ['half', 96], ['quarter', 48], ['eighth', 24], ['16th', 12], ['32nd', 6], ['64th', 3],
];

const FIGURES: Figure[] = [];
for (const [type, t] of BASE) {
  FIGURES.push({ ticks: t, type, dots: 0, triplet: false });
  if (t * 1.5 === Math.round(t * 1.5)) FIGURES.push({ ticks: t * 1.5, type, dots: 1, triplet: false });
  if (t * 1.75 === Math.round(t * 1.75)) FIGURES.push({ ticks: t * 1.75, type, dots: 2, triplet: false });
  // triolets non pointés seulement : un triolet pointé vaut une figure simple, qu'on préfère
  if (t >= 6) FIGURES.push({ ticks: (t * 2) / 3, type, dots: 0, triplet: true });
}

const splitCache = new Map<number, Figure[]>();

/**
 * Découpe une durée (ticks) en figures liées : le moins de morceaux possible, puis le moins de triolets
 * et de points. Programmation dynamique sur les ticks (les durées restent petites).
 */
export function splitDuration(ticks: number): Figure[] {
  const hit = splitCache.get(ticks);
  if (hit) return hit;
  const cost = new Array<number>(ticks + 1).fill(Infinity);
  const pick = new Array<Figure | null>(ticks + 1).fill(null);
  cost[0] = 0;
  for (let t = 1; t <= ticks; t++) {
    for (const f of FIGURES) {
      if (f.ticks > t || cost[t - f.ticks] === Infinity) continue;
      const c = cost[t - f.ticks] + 100 + (f.triplet ? 10 : 0) + f.dots;
      if (c < cost[t]) { cost[t] = c; pick[t] = f; }
    }
  }
  // Durée inexprimable (arrondi d'un quintolet…) : on écrit la plus grande part exprimable et le
  // dernier morceau absorbe le reste — sa figure est approximative, sa durée exacte.
  let t = ticks;
  while (t > 0 && cost[t] === Infinity) t--;
  const out: Figure[] = [];
  for (let r = t; r > 0; r -= pick[r]!.ticks) out.push(pick[r]!);
  out.sort((a, b) => b.ticks - a.ticks);
  if (t < ticks) {
    if (out.length) out[out.length - 1] = { ...out[out.length - 1], ticks: out[out.length - 1].ticks + ticks - t };
    else out.push({ ticks, type: '64th', dots: 0, triplet: false });
  }
  splitCache.set(ticks, out);
  return out;
}

// ---------- Structures intermédiaires ----------

/** Notes d'une voix jouées ensemble (même début, même durée) ; un silence forme un « accord » à lui seul. */
interface Chord {
  start: number;
  dur: number;
  rest: boolean;
  notes: NoteEvent[];
}

type El =
  | {
      k: 'note'; chord: boolean; pitch: Pitch | null; measureRest?: boolean; dur: number; voice: number;
      staff: number; fig: Figure | null; ties: ('start' | 'stop')[]; tuplet?: 'start' | 'stop';
      lyrics: Lyric[]; color?: string;
    }
  | { k: 'forward'; dur: number; voice: number; staff: number }
  | { k: 'backup'; dur: number }
  | { k: 'clef'; staff: number; clef: Clef };

const tick = (beats: number) => Math.round(beats * DIVISIONS);

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const samePitch = (a: Pitch, b: Pitch) => a.step === b.step && a.alter === b.alter && a.octave === b.octave;

/**
 * Répartit les évènements d'une mesure-ligne en voix écrites : on part de note.voice ; les notes de même
 * début et même durée forment un accord ; ce qui chevauche passe dans une voix supplémentaire.
 * La première voix renvoyée est la voix principale (comblée par des silences).
 */
function voiceTracks(notes: NoteEvent[]): Chord[][] {
  const byVoice = new Map<number, Map<string, Chord>>();
  for (const n of notes) {
    const start = Math.max(0, tick(n.offset));
    const dur = tick(n.offset + n.duration) - start;
    if (dur <= 0) continue;
    const rest = !n.pitch;
    const key = `${start}|${dur}|${rest}`;
    let groups = byVoice.get(n.voice);
    if (!groups) byVoice.set(n.voice, (groups = new Map()));
    const g = groups.get(key);
    if (!g) groups.set(key, { start, dur, rest, notes: [n] });
    else if (!rest) g.notes.push(n);            // silences superposés : un seul suffit
  }
  const overlaps = (t: Chord[], c: Chord) => t.some(o => c.start < o.start + o.dur && o.start < c.start + c.dur);
  const own: Chord[][] = [];
  const extra: Chord[][] = [];
  for (const v of [...byVoice.keys()].sort((a, b) => a - b)) {
    // à début égal, l'accord le plus fourni garde la voix (puis le plus long, puis les notes avant les silences)
    const chords = [...byVoice.get(v)!.values()]
      .sort((a, b) => a.start - b.start || +a.rest - +b.rest || b.notes.length - a.notes.length || b.dur - a.dur);
    const track: Chord[] = [];
    for (const c of chords) {
      if (!overlaps(track, c)) { track.push(c); continue; }
      const t = extra.find(x => !overlaps(x, c));
      if (t) t.push(c); else extra.push([c]);
    }
    own.push(track);
  }
  return [...own, ...extra].map(t => t.sort((a, b) => a.start - b.start));
}

/** Clé en vigueur au début de la mesure i (changements en début de mesure compris). */
function clefAt(line: Line, i: number): Clef {
  let clef = line.clef;
  let best: [number, number] = [-1, -1];
  for (const c of line.clefChanges ?? []) {
    if ((c.measure < i || (c.measure === i && c.offset <= EPS)) && (c.measure > best[0] || (c.measure === best[0] && c.offset >= best[1]))) {
      best = [c.measure, c.offset]; clef = c.clef;
    }
  }
  return clef;
}

/**
 * Pour chaque note liée (tie), cherche la note suivante de même hauteur sur la ligne : dans la même
 * mesure après sa fin, sinon au plus tôt dans la mesure suivante. Renvoie les couples début → fin.
 */
function tieTargets(line: Line, inRange: (m: number) => boolean): { starts: Set<string>; stops: Set<string> } {
  const starts = new Set<string>();
  const stops = new Set<string>();
  const notes = line.notes.filter(n => n.pitch && n.duration > EPS);
  for (const n of notes) {
    if (!n.tie || !inRange(n.measure)) continue;
    let target: NoteEvent | null = null;
    for (const c of notes) {
      if (c === n || !samePitch(c.pitch!, n.pitch!)) continue;
      const ok = (c.measure === n.measure && c.offset >= n.offset + n.duration - EPS) || c.measure === n.measure + 1;
      if (!ok) continue;
      if (!target || c.measure < target.measure || (c.measure === target.measure && c.offset < target.offset)) target = c;
    }
    if (target && inRange(target.measure)) { starts.add(n.id); stops.add(target.id); }
  }
  return { starts, stops };
}

/** Pose les crochets de triolet : une suite de triolets se ferme quand elle forme un groupe complet. */
function markTuplets(els: El[]): void {
  let group: Extract<El, { k: 'note' }>[] = [];
  let sum = 0;
  let min = Infinity;
  const close = () => {
    if (group.length > 1) { group[0].tuplet = 'start'; group[group.length - 1].tuplet = 'stop'; }
    group = []; sum = 0; min = Infinity;
  };
  for (const e of els) {
    if (e.k === 'clef') continue;
    if (e.k !== 'note' || !e.fig?.triplet) { if (!(e.k === 'note' && e.chord)) close(); continue; }
    if (e.chord) continue;
    group.push(e);
    sum += e.dur;
    min = Math.min(min, e.dur);
    if (sum % (3 * min) === 0) close();
  }
  close();
}

// ---------- Écriture ----------

function pitchXml(p: Pitch): string {
  return `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`;
}

function clefXml(c: Clef, staff: number): string {
  const line = c.sign !== 'percussion' || c.line > 0 ? `<line>${c.line}</line>` : '';
  const oct = c.octaveChange ? `<clef-octave-change>${c.octaveChange}</clef-octave-change>` : '';
  return `<clef number="${staff}"><sign>${c.sign}</sign>${line}${oct}</clef>`;
}

function elXml(e: El): string {
  switch (e.k) {
    case 'backup': return `<backup><duration>${e.dur}</duration></backup>`;
    case 'forward': return `<forward><duration>${e.dur}</duration><voice>${e.voice}</voice><staff>${e.staff}</staff></forward>`;
    case 'clef': return `<attributes>${clefXml(e.clef, e.staff)}</attributes>`;
  }
  const x: string[] = [`<note${e.color ? ` color="${e.color}"` : ''}>`];
  if (e.chord) x.push('<chord/>');
  x.push(e.pitch ? pitchXml(e.pitch) : e.measureRest ? '<rest measure="yes"/>' : '<rest/>');
  x.push(`<duration>${e.dur}</duration>`);
  for (const t of e.ties) x.push(`<tie type="${t}"/>`);
  x.push(`<voice>${e.voice}</voice>`);
  if (e.fig) {
    x.push(`<type>${e.fig.type}</type>`, '<dot/>'.repeat(e.fig.dots));
    if (e.fig.triplet) x.push('<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>');
  }
  x.push(`<staff>${e.staff}</staff>`);
  if (e.ties.length || e.tuplet) {
    x.push('<notations>', ...e.ties.map(t => `<tied type="${t}"/>`), e.tuplet ? `<tuplet type="${e.tuplet}"/>` : '', '</notations>');
  }
  for (const l of e.lyrics) {
    x.push(`<lyric number="${l.verse}">${l.syllabic ? `<syllabic>${l.syllabic}</syllabic>` : ''}<text>${esc(l.text)}</text></lyric>`);
  }
  x.push('</note>');
  return x.join('');
}

/**
 * Projet → MusicXML 3.1 partwise, pour l'affichage (OSMD) et l'impression.
 * Chaque mesure écrite correspond, dans l'ordre, à une mesure du projet (la i-ème mesure du fichier
 * = project.measures[range[0] + i]) : l'affichage s'en sert pour savoir quelle mesure a été cliquée.
 * Les lignes d'une même partie sont regroupées en une partie à plusieurs portées (accolade).
 */
export function writeMusicXml(p: Project, o: WriteOptions = {}): string {
  const t = o.transpose ?? 0;
  const withLyrics = o.lyrics !== false;
  const verses = o.verses?.length ? new Set(o.verses) : null;
  const chosen = o.lines?.length ? p.lines.filter(l => o.lines!.includes(l.id)) : p.lines;
  const last = p.measures.length - 1;
  const r0 = Math.max(0, Math.min(o.range?.[0] ?? 0, last));
  const r1 = Math.max(r0, Math.min(o.range?.[1] ?? last, last));
  const inRange = (m: number) => m >= r0 && m <= r1;
  // Longueur de chaque mesure, celle de la lecture (métrique, débordement, anacrouse), calculée sur
  // toutes les lignes : une mesure a la même longueur quelles que soient les lignes imprimées.
  const lens = timeline(p).map(x => tick(x.len));
  const keys = p.measures.map(m => ({ ...transposeKey(m.fifths, t), mode: m.mode }));

  // Parties : lignes regroupées par line.part, dans l'ordre d'apparition.
  const parts: { name: string; lines: Line[] }[] = [];
  const byPart = new Map<number, { name: string; lines: Line[] }>();
  for (const l of chosen) {
    let g = byPart.get(l.part);
    if (!g) { byPart.set(l.part, (g = { name: l.partName, lines: [] })); parts.push(g); }
    g.lines.push(l);
  }

  const title = o.title ?? p.title;
  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="no"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="3.1">',
  ];
  // work-title seul : OSMD affiche un movement-title identique en sous-titre, en double.
  if (title.trim()) out.push(`<work><work-title>${esc(title.trim())}</work-title></work>`);
  out.push('<identification><encoding><software>Music Reader</software></encoding></identification>');
  out.push('<part-list>');
  parts.forEach((g, k) => out.push(`<score-part id="P${k + 1}"><part-name>${esc(g.name)}</part-name></score-part>`));
  out.push('</part-list>');

  parts.forEach((g, k) => {
    // Évènements par ligne et par mesure, et voix écrites de chaque mesure-ligne.
    const tracks = g.lines.map(l => {
      const byMeasure = new Map<number, NoteEvent[]>();
      for (const n of l.notes) {
        if (!inRange(n.measure) || n.duration <= EPS) continue;
        let a = byMeasure.get(n.measure);
        if (!a) byMeasure.set(n.measure, (a = []));
        a.push(n);
      }
      const res = new Map<number, Chord[][]>();
      for (const [m, notes] of byMeasure) res.set(m, voiceTracks(notes));
      return res;
    });
    // Numéros de voix uniques dans la partie : (rang - 1) × pas + voix.
    let stride = 4;
    for (const tr of tracks) for (const v of tr.values()) stride = Math.max(stride, v.length);
    const ties = g.lines.map(l => tieTargets(l, inRange));

    out.push(`<part id="P${k + 1}">`);
    for (let i = r0; i <= r1 && i <= last; i++) {
      const m = p.measures[i];
      const prev = i > r0 ? p.measures[i - 1] : null;
      const len = lens[i];
      out.push(`<measure number="${i + 1}">`);
      if (o.keepLayout && prev) {
        if (m.newPage) out.push('<print new-page="yes"/>');
        else if (m.newSystem) out.push('<print new-system="yes"/>');
      }
      // Attributs : tout au début, puis seulement ce qui change.
      const attrs: string[] = [];
      if (!prev) attrs.push(`<divisions>${DIVISIONS}</divisions>`);
      if (!prev || keys[i].fifths !== keys[i - 1].fifths || m.mode !== prev.mode) {
        attrs.push(`<key><fifths>${keys[i].fifths}</fifths><mode>${m.mode}</mode></key>`);
      }
      if (!prev || m.beats !== prev.beats || m.beatType !== prev.beatType) {
        attrs.push(`<time><beats>${m.beats}</beats><beat-type>${m.beatType}</beat-type></time>`);
      }
      if (!prev && g.lines.length > 1) attrs.push(`<staves>${g.lines.length}</staves>`);
      g.lines.forEach((l, r) => {
        if (!prev) attrs.push(clefXml(clefAt(l, i), r + 1));
        else for (const c of l.clefChanges ?? []) if (c.measure === i && c.offset <= EPS) attrs.push(clefXml(c.clef, r + 1));
      });
      if (attrs.length) out.push(`<attributes>${attrs.join('')}</attributes>`);

      const els: El[] = [];
      let pos = 0;
      g.lines.forEach((l, r) => {
        const staff = r + 1;
        const issue = o.colors?.get(`${i}|${l.id}`);
        const color = issue ? ISSUE_COLORS[issue] : undefined;
        const midClefs = (l.clefChanges ?? []).filter(c => c.measure === i && c.offset > EPS)
          .map(c => ({ at: tick(c.offset), clef: c.clef })).sort((a, b) => a.at - b.at);
        const flushClefs = (upTo: number) => {
          while (midClefs.length && midClefs[0].at <= upTo) els.push({ k: 'clef', staff, clef: midClefs.shift()!.clef });
        };
        const voices = tracks[r].get(i) ?? [];
        if (!voices.length) {
          // Mesure-ligne vide : un silence de mesure.
          if (pos > 0) els.push({ k: 'backup', dur: pos });
          els.push({ k: 'note', chord: false, pitch: null, measureRest: true, dur: len, voice: r * stride + 1, staff, fig: null, ties: [], lyrics: [], color });
          flushClefs(Infinity);
          pos = len;
          return;
        }
        voices.forEach((chords, v) => {
          const voice = r * stride + v + 1;
          const primary = v === 0;
          if (pos > 0) els.push({ k: 'backup', dur: pos });
          const start = els.length;
          let cur = 0;
          const gap = (to: number) => {
            while (cur < to) {
              // les silences de comblement s'arrêtent sur un changement de clé, pour l'y placer
              const stop = primary ? Math.min(to, midClefs.find(c => c.at > cur)?.at ?? to) : to;
              if (primary) {
                for (const f of splitDuration(stop - cur)) {
                  els.push({ k: 'note', chord: false, pitch: null, dur: f.ticks, voice, staff, fig: f, ties: [], lyrics: [], color });
                }
              } else els.push({ k: 'forward', dur: stop - cur, voice, staff });
              cur = stop;
              if (primary) flushClefs(cur);
            }
          };
          for (const c of chords) {
            gap(c.start);
            if (primary) flushClefs(c.start);
            const figs = splitDuration(c.dur);
            const heads = c.rest ? [c.notes[0]] : [...c.notes].sort((a, b) => diatonic(a.pitch!) - diatonic(b.pitch!));
            // Paroles : celles de l'accord, un exemplaire par couplet, sur la première note.
            const lyr: Lyric[] = [];
            if (withLyrics) for (const n of heads) for (const ly of n.lyrics ?? []) {
              if (ly.text.trim() && (!verses || verses.has(ly.verse)) && !lyr.some(x => x.verse === ly.verse)) lyr.push(ly);
            }
            lyr.sort((a, b) => a.verse - b.verse);
            figs.forEach((f, j) => {
              heads.forEach((n, h) => {
                const tiesOf: ('start' | 'stop')[] = [];
                if (!c.rest) {
                  if (j > 0 || ties[r].stops.has(n.id)) tiesOf.push('stop');
                  if (j < figs.length - 1 || ties[r].starts.has(n.id)) tiesOf.push('start');
                }
                els.push({
                  k: 'note', chord: h > 0, staff, voice, dur: f.ticks, fig: f, ties: tiesOf, color,
                  pitch: n.pitch ? transposePitch(n.pitch, t, keys[i].shift) : null,
                  lyrics: j === 0 && h === 0 ? lyr : [],
                });
              });
            });
            cur = c.start + c.dur;
          }
          if (primary) { gap(len); flushClefs(Infinity); }
          markTuplets(els.slice(start));
          pos = cur;
        });
      });
      out.push(...els.map(elXml));
      if (i === r1 && r1 === last) out.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
      out.push('</measure>');
    }
    out.push('</part>');
  });
  out.push('</score-partwise>');
  return out.join('\n');
}
