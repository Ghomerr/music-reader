// Fichier projet (.json) : seule mémoire durable de l'application (le serveur ne garde rien).
// Format v2 = le modèle interne tel quel, à deux détails près pour rester lisible à l'œil : une hauteur
// s'écrit « Eb4 » (null pour un silence) et les notes n'ont pas d'identifiant (recalculé au chargement).
// Le format v1 (maquette, v0 : notes en start/duration absolus) se relit et se convertit.
import { parsePitchCode, pitchCode } from './pitch';
import type {
  Clef, Instrument, Line, LineSettings, LostSymbol, Lyric, Measure, NoteEvent, PageMeta, Pitch, PrintSettings,
  Project, Settings, Step,
} from './types';

const INSTRUMENTS: Instrument[] = ['piano', 'flute', 'cordes', 'orgue'];
export const DEFAULT_TEMPO = 100;

const defaultLineSettings = (l: Pick<Line, 'clef'>): LineSettings =>
  ({ enabled: true, instrument: l.clef.sign === 'F' ? 'cordes' : 'piano', volume: 0.8 });

/** Réglages par défaut : 100 BPM, pas de transposition, toutes les lignes actives, paroles imprimées. */
export function defaultSettings(lines: Line[], title: string): Settings {
  return {
    tempo: DEFAULT_TEMPO,
    transpose: 0,
    loop: false,
    lines: Object.fromEntries(lines.map(l => [l.id, defaultLineSettings(l)])),
    print: { lines: [], lyrics: true, verses: [], title, keepLayout: false },
  };
}

// ---------- Écriture ----------

const r6 = (x: number) => Math.round(x * 1e6) / 1e6 + 0;   // + 0 : pas de « -0 » dans le fichier

/** Ramène une valeur arrondie à 6 décimales sur la fraction exacte (1/3, 1/6…) qu'elle représentait. */
const snap = (x: number): number => {
  const r = Math.round(x * 6720) / 6720;
  return Math.abs(r - x) < 2e-6 ? r : x;
};

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function noteOut(n: NoteEvent): Json {
  const o: { [k: string]: Json } = {
    measure: n.measure, offset: r6(n.offset), duration: r6(n.duration),
    pitch: n.pitch ? pitchCode(n.pitch) : null, voice: n.voice,
  };
  if (n.tie) o.tie = true;
  if (n.lyrics?.length) o.lyrics = n.lyrics.map(l => ({ ...l }) as unknown as Json);
  if (n.manual) o.manual = true;
  return o;
}

const clefOut = (c: Clef): Json => ({ ...c });

/**
 * JSON indenté de 2, mais avec les petits objets (une note, une mesure, une clé) sur une seule ligne :
 * le fichier reste lisible et compact, et un diff montre une note par ligne.
 */
function pretty(v: Json, indent = ''): string {
  const flat = inline(v);
  if (flat.length + indent.length <= 160 || v === null || typeof v !== 'object') return flat;
  const next = indent + '  ';
  if (Array.isArray(v)) return `[\n${v.map(x => next + pretty(x, next)).join(',\n')}\n${indent}]`;
  const entries = Object.entries(v);
  return `{\n${entries.map(([k, x]) => `${next}${JSON.stringify(k)}: ${pretty(x, next)}`).join(',\n')}\n${indent}}`;
}
function inline(v: Json): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(inline).join(', ')}]`;
  const e = Object.entries(v);
  return e.length ? `{ ${e.map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(', ')} }` : '{}';
}

/** Fichier projet (.json) : format v2 documenté dans PLAN.md, lisible à l'œil. */
export function serializeProject(p: Project): string {
  const data: Json = {
    format: 'music-reader',
    version: 2,
    title: p.title,
    createdAt: p.createdAt,
    pages: p.pages.map(pg => ({ key: pg.key, name: pg.name, font: pg.font, scale: pg.scale })),
    measures: p.measures.map(m => {
      const o: { [k: string]: Json } = {
        pageKey: m.pageKey, page: m.page, local: m.local, label: m.label,
        beats: m.beats, beatType: m.beatType, fifths: m.fifths, mode: m.mode,
      };
      if (m.newSystem) o.newSystem = true;
      if (m.newPage) o.newPage = true;
      return o;
    }),
    lines: p.lines.map(l => {
      const o: { [k: string]: Json } = { id: l.id, name: l.name, part: l.part, partName: l.partName, staff: l.staff, clef: clefOut(l.clef) };
      if (l.clefChanges?.length)
        o.clefChanges = l.clefChanges.map(c => ({ measure: c.measure, offset: r6(c.offset), clef: clefOut(c.clef) }));
      o.notes = l.notes.map(noteOut);
      return o;
    }),
    settings: JSON.parse(JSON.stringify(p.settings)) as Json,
    review: {
      lost: p.review.lost.map(s => ({ measure: s.measure, lineId: s.lineId, rest: s.rest, duration: r6(s.duration) })),
      checked: [...p.review.checked],
    },
  };
  return pretty(data) + '\n';
}

// ---------- Lecture ----------

class Invalid extends Error {
  constructor(msg: string) { super(`Fichier projet invalide : ${msg}.`); }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function obj(v: unknown, where: string): Obj {
  if (!isObj(v)) throw new Invalid(`${where} doit être un objet`);
  return v;
}
function arr(v: unknown, where: string): unknown[] {
  if (!Array.isArray(v)) throw new Invalid(`${where} doit être une liste`);
  return v;
}
function str(v: unknown, where: string): string {
  if (typeof v !== 'string') throw new Invalid(`${where} doit être un texte`);
  return v;
}
function int(v: unknown, where: string, min = -Infinity, max = Infinity): number {
  if (!isInt(v) || v < min || v > max)
    throw new Invalid(`${where} doit être un entier${min > -Infinity ? ` ≥ ${min}` : ''}${max < Infinity ? ` et ≤ ${max}` : ''}`);
  return v;
}
function num(v: unknown, where: string, min = -Infinity): number {
  if (!isNum(v) || v < min) throw new Invalid(`${where} doit être un nombre${min > -Infinity ? ` ≥ ${min}` : ''}`);
  return v;
}
function optBool(v: unknown, where: string): boolean | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== 'boolean') throw new Invalid(`${where} doit valoir true ou false`);
  return v;
}

function readClef(v: unknown, where: string): Clef {
  const o = obj(v, where);
  const sign = o.sign;
  if (sign !== 'G' && sign !== 'F' && sign !== 'C' && sign !== 'percussion')
    throw new Invalid(`${where}.sign doit valoir G, F, C ou percussion`);
  const c: Clef = { sign, line: int(o.line, `${where}.line`, 1, 5) };
  if (o.octaveChange !== undefined) {
    const oc = int(o.octaveChange, `${where}.octaveChange`, -2, 2);
    if (oc) c.octaveChange = oc;
  }
  return c;
}

function readPitch(v: unknown, where: string): Pitch | null {
  if (v === null) return null;
  const p = parsePitchCode(str(v, where));
  if (!p) throw new Invalid(`${where} : hauteur « ${String(v)} » illisible (attendu par ex. « Eb4 », ou null pour un silence)`);
  return p;
}

function readLyric(v: unknown, where: string): Lyric {
  const o = obj(v, where);
  const l: Lyric = { verse: int(o.verse, `${where}.verse`, 1), text: str(o.text, `${where}.text`) };
  if (o.syllabic !== undefined) {
    if (o.syllabic !== 'single' && o.syllabic !== 'begin' && o.syllabic !== 'middle' && o.syllabic !== 'end')
      throw new Invalid(`${where}.syllabic doit valoir single, begin, middle ou end`);
    l.syllabic = o.syllabic;
  }
  if (optBool(o.manual, `${where}.manual`)) l.manual = true;
  return l;
}

/** Réglages : tolérants (un réglage absent ou faux reprend sa valeur par défaut). */
function readSettings(v: unknown, lines: Line[], title: string): Settings {
  const d = defaultSettings(lines, title);
  if (!isObj(v)) return d;
  const s: Settings = {
    tempo: isNum(v.tempo) && v.tempo > 0 ? v.tempo : d.tempo,
    transpose: isInt(v.transpose) ? Math.max(-24, Math.min(24, v.transpose)) : d.transpose,
    loop: typeof v.loop === 'boolean' ? v.loop : d.loop,
    lines: d.lines,
    print: d.print,
  };
  const ls = isObj(v.lines) ? v.lines : {};
  for (const l of lines) {
    const x = ls[l.id];
    if (!isObj(x)) continue;
    s.lines[l.id] = {
      enabled: typeof x.enabled === 'boolean' ? x.enabled : d.lines[l.id].enabled,
      instrument: INSTRUMENTS.includes(x.instrument as Instrument) ? (x.instrument as Instrument) : d.lines[l.id].instrument,
      volume: isNum(x.volume) ? Math.max(0, Math.min(1, x.volume)) : d.lines[l.id].volume,
    };
  }
  if (isObj(v.print)) {
    const pr = v.print;
    const ids = new Set(lines.map(l => l.id));
    const p: PrintSettings = {
      lines: Array.isArray(pr.lines) ? pr.lines.filter((x): x is string => typeof x === 'string' && ids.has(x)) : d.print.lines,
      lyrics: typeof pr.lyrics === 'boolean' ? pr.lyrics : d.print.lyrics,
      verses: Array.isArray(pr.verses) ? pr.verses.filter((x): x is number => isInt(x) && x >= 1) : d.print.verses,
      title: typeof pr.title === 'string' ? pr.title : d.print.title,
      keepLayout: typeof pr.keepLayout === 'boolean' ? pr.keepLayout : d.print.keepLayout,
    };
    s.print = p;
  }
  return s;
}

/** Identifiants de notes, recalculés au chargement : `${pageKey}.${mesure locale}.${ligne}.${rang}`. */
function assignIds(lines: Line[], measures: Measure[]): void {
  const seen = new Set<string>();
  for (const l of lines) {
    let k = 0, cur = -1;
    for (const n of l.notes) {
      if (n.measure !== cur) { cur = n.measure; k = 0; }
      const m = measures[n.measure];
      let id = `${m.pageKey}.${m.local}.${l.id}.${k++}`;
      while (seen.has(id)) id += '~';
      seen.add(id);
      n.id = id;
    }
  }
}

const byTime = (a: NoteEvent, b: NoteEvent) => a.measure - b.measure || a.offset - b.offset || a.voice - b.voice;

function parseV2(d: Obj): Project {
  const title = typeof d.title === 'string' ? d.title : '';
  const createdAt = typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString();

  const pages: PageMeta[] = arr(d.pages ?? [], 'pages').map((v, i) => {
    const w = `pages[${i}]`, o = obj(v, w);
    return { key: str(o.key, `${w}.key`), name: str(o.name, `${w}.name`), font: str(o.font, `${w}.font`), scale: num(o.scale, `${w}.scale`, 0) };
  });

  const measures: Measure[] = arr(d.measures, 'measures').map((v, i) => {
    const w = `measures[${i}]`, o = obj(v, w);
    const mode = o.mode ?? 'major';
    if (mode !== 'major' && mode !== 'minor') throw new Invalid(`${w}.mode doit valoir major ou minor`);
    const m: Measure = {
      pageKey: str(o.pageKey, `${w}.pageKey`), page: int(o.page, `${w}.page`, 1), local: int(o.local, `${w}.local`, 0),
      label: typeof o.label === 'number' ? String(o.label) : str(o.label, `${w}.label`),
      beats: int(o.beats, `${w}.beats`, 1, 64), beatType: int(o.beatType, `${w}.beatType`, 1, 64),
      fifths: int(o.fifths, `${w}.fifths`, -7, 7), mode,
    };
    if (optBool(o.newSystem, `${w}.newSystem`)) m.newSystem = true;
    if (optBool(o.newPage, `${w}.newPage`)) m.newPage = true;
    return m;
  });
  if (!measures.length) throw new Invalid('la partition ne contient aucune mesure');
  const nM = measures.length;

  const ids = new Set<string>();
  const lines: Line[] = arr(d.lines, 'lines').map((v, i) => {
    const w = `lines[${i}]`, o = obj(v, w);
    const id = str(o.id, `${w}.id`);
    if (ids.has(id)) throw new Invalid(`${w}.id « ${id} » apparaît deux fois`);
    ids.add(id);
    const line: Line = {
      id, name: str(o.name, `${w}.name`), part: int(o.part, `${w}.part`, 0), partName: str(o.partName, `${w}.partName`),
      staff: int(o.staff, `${w}.staff`, 1), clef: readClef(o.clef, `${w}.clef`), notes: [],
    };
    if (o.clefChanges !== undefined) {
      line.clefChanges = arr(o.clefChanges, `${w}.clefChanges`).map((c, j) => {
        const cw = `${w}.clefChanges[${j}]`, co = obj(c, cw);
        return { measure: int(co.measure, `${cw}.measure`, 0, nM - 1), offset: snap(num(co.offset, `${cw}.offset`, 0)), clef: readClef(co.clef, `${cw}.clef`) };
      });
    }
    line.notes = arr(o.notes, `${w}.notes`).map((nv, j) => {
      const nw = `${w}.notes[${j}]`, no = obj(nv, nw);
      const n: NoteEvent = {
        id: '', measure: int(no.measure, `${nw}.measure`, 0, nM - 1),
        offset: snap(num(no.offset, `${nw}.offset`)), duration: snap(num(no.duration, `${nw}.duration`, 0)),
        pitch: readPitch(no.pitch, `${nw}.pitch`), voice: int(no.voice ?? 1, `${nw}.voice`, 1),
      };
      if (optBool(no.tie, `${nw}.tie`)) n.tie = true;
      if (no.lyrics !== undefined) {
        const ly = arr(no.lyrics, `${nw}.lyrics`).map((x, k) => readLyric(x, `${nw}.lyrics[${k}]`));
        if (ly.length) n.lyrics = ly;
      }
      if (optBool(no.manual, `${nw}.manual`)) n.manual = true;
      return n;
    }).sort(byTime);
    return line;
  });
  if (!lines.length) throw new Invalid('le projet ne contient aucune ligne musicale');
  assignIds(lines, measures);

  const rv = isObj(d.review) ? d.review : {};
  const lost: LostSymbol[] = arr(rv.lost ?? [], 'review.lost').map((v, i) => {
    const w = `review.lost[${i}]`, o = obj(v, w);
    return {
      measure: int(o.measure, `${w}.measure`, 0, nM - 1), lineId: str(o.lineId, `${w}.lineId`),
      rest: optBool(o.rest, `${w}.rest`) ?? false, duration: snap(num(o.duration, `${w}.duration`, 0)),
    };
  });
  const checked = arr(rv.checked ?? [], 'review.checked').map((v, i) => str(v, `review.checked[${i}]`));

  return {
    format: 'music-reader', version: 2, title, createdAt, pages, measures, lines,
    settings: readSettings(d.settings, lines, title), review: { lost, checked },
  };
}

// ---------- Format v1 (maquette, v0) ----------

const FIFTH_POS: Record<Step, number> = { F: -1, C: 0, G: 1, D: 2, A: 3, E: 4, B: 5 };

/** « Eb » (tonique) + mode → armure. Une tonalité à 7 dièses se relit en son équivalent à 5 bémols. */
function keyFromCode(code: unknown, mode: 'major' | 'minor'): number {
  if (typeof code !== 'string') return 0;
  const m = /^([A-G])(#|b)?/.exec(code.trim());
  if (!m) return 0;
  let f = FIFTH_POS[m[1] as Step] + (m[2] === '#' ? 7 : m[2] === 'b' ? -7 : 0) - (mode === 'minor' ? 3 : 0);
  if (Math.abs(f) > 6) f += f > 0 ? -12 : 12;
  return Math.abs(f) <= 7 ? f : 0;
}

function parseV1(d: Obj): Project {
  const parts = arr(d.parts, 'parts');
  if (!parts.length) throw new Invalid('le projet ne contient aucune ligne musicale');
  const score = isObj(d.score) ? d.score : {};
  const ts = Array.isArray(score.timeSignature) ? score.timeSignature : [];
  const beats = isInt(ts[0]) && ts[0] > 0 ? ts[0] : 4;
  const beatType = isInt(ts[1]) && ts[1] > 0 ? ts[1] : 4;
  const mode = score.mode === 'minor' ? 'minor' : 'major';
  const fifths = keyFromCode(score.key, mode);
  const L = (beats * 4) / beatType;
  const title = typeof d.title === 'string' && d.title.trim() ? d.title : 'Sans titre';

  // Notes absolues → (mesure, offset), coupées aux barres de mesure et liées
  const raw = parts.map((v, i) => {
    const w = `parts[${i}]`, o = obj(v, w);
    const notes = arr(o.notes, `${w}.notes`).map((nv, j) => {
      const nw = `${w}.notes[${j}]`, no = obj(nv, nw);
      return { pitch: readPitch(no.pitch, `${nw}.pitch`), start: snap(num(no.start, `${nw}.start`, 0)), duration: snap(num(no.duration, `${nw}.duration`, 0)) };
    }).filter(n => n.duration > 0).sort((a, b) => a.start - b.start);
    return { o, notes };
  });
  const total = Math.max(L, ...raw.flatMap(r => r.notes.map(n => n.start + n.duration)));
  const nM = Math.max(1, Math.ceil(total / L - 1e-6));
  const measures: Measure[] = Array.from({ length: nM }, (_, i) => ({
    pageKey: 'projet', page: 1, local: i, label: String(i + 1), beats, beatType, fifths, mode,
  }));

  /** Ajoute un évènement absolu, coupé aux barres (les morceaux d'une note sont liés). */
  const place = (out: NoteEvent[], pitch: Pitch | null, start: number, dur: number, voice: number) => {
    let s = start, rest = dur;
    while (rest > 1e-6) {
      const m = Math.min(nM - 1, Math.floor(s / L + 1e-6));
      const off = snap(s - m * L);
      const seg = snap(Math.min(rest, L - off));
      const n: NoteEvent = { id: '', measure: m, offset: off, duration: seg, pitch, voice };
      if (pitch && rest - seg > 1e-6) n.tie = true;
      out.push(n);
      s = snap(s + seg); rest = snap(rest - seg);
    }
  };

  const lines: Line[] = raw.map(({ o, notes }, i) => {
    const name = typeof o.name === 'string' && o.name.trim() ? o.name : `Ligne ${i + 1}`;
    const clef: Clef = o.clef === 'bass' ? { sign: 'F', line: 4 } : { sign: 'G', line: 2 };
    // Les notes qui se chevauchent sans former d'accord (même début, même durée) vont dans une autre voix
    const voices: { end: number; start: number; dur: number }[] = [];
    const out: NoteEvent[] = [];
    for (const n of notes) {
      let v = voices.findIndex(x => Math.abs(x.start - n.start) < 1e-6 && Math.abs(x.dur - n.duration) < 1e-6);
      if (v < 0) v = voices.findIndex(x => x.end <= n.start + 1e-6);
      if (v < 0) { v = voices.length; voices.push({ end: 0, start: 0, dur: 0 }); }
      // silences implicites du format v1 : rendus explicites dans la voix 1, pour que les mesures soient pleines
      if (v === 0 && n.start > voices[0].end + 1e-6) place(out, null, voices[0].end, n.start - voices[0].end, 1);
      voices[v] = { end: Math.max(voices[v].end, n.start + n.duration), start: n.start, dur: n.duration };
      place(out, n.pitch, n.start, n.duration, v + 1);
    }
    const end0 = voices[0]?.end ?? 0;
    if (end0 < nM * L - 1e-6) place(out, null, end0, nM * L - end0, 1);
    return { id: `${i}|1`, name, part: i, partName: name, staff: 1, clef, notes: out.sort(byTime) };
  });
  assignIds(lines, measures);

  // Réglages v1 : globaux dans settings, par ligne dans parts[]
  const s = isObj(d.settings) ? d.settings : {};
  const lineSettings: Obj = {};
  raw.forEach(({ o }, i) => { lineSettings[`${i}|1`] = { enabled: o.enabled !== false, instrument: o.instrument, volume: o.volume }; });
  const settings = readSettings({ tempo: s.tempo, transpose: s.transpose, loop: s.loop, lines: lineSettings }, lines, title);

  return {
    format: 'music-reader', version: 2, title,
    createdAt: typeof d.createdAt === 'string' ? d.createdAt : new Date().toISOString(),
    pages: [], measures, lines, settings, review: { lost: [], checked: [] },
  };
}

/**
 * Relit un fichier projet (v2, ou v1 de la maquette / de la v0 : notes en start/duration absolus).
 * Valide la structure et lève une Error au message clair en français sinon.
 */
export function parseProject(text: string): Project {
  let d: unknown;
  try { d = JSON.parse(text); }
  catch { throw new Error('Ce fichier n\'est pas un projet Music Reader : son contenu n\'est pas du JSON valide.'); }
  if (!isObj(d) || d.format !== 'music-reader') throw new Error('Ce fichier n\'est pas un projet Music Reader.');
  if (d.version === 2) return parseV2(d);
  if (d.version === 1) return parseV1(d);
  throw new Error(`Fichier projet : version ${String(d.version)} non prise en charge.`);
}
