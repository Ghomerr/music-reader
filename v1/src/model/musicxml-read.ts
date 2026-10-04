// Lecture du MusicXML (score-partwise) produit par Audiveris pour une page, vers le modèle interne.
// Reprend la lecture de la v0 (divisions, backup/forward, accords) mais sans rien fusionner ni jeter :
// chaque note ou silence du fichier devient un NoteEvent, à sa place dans sa mesure. Les erreurs de
// reconnaissance (durées nulles, mesures qui débordent) restent visibles pour le contrôle des durées.
import type { Clef, Line, Lyric, Measure, NoteEvent, PageScore, Pitch, Step } from './types';

const STEPS = new Set(['C', 'D', 'E', 'F', 'G', 'A', 'B']);

/** Ramène une position flottante sur la grille exacte la plus proche (triolets, quintolets…). */
const snap = (x: number): number => {
  const r = Math.round(x * 6720) / 6720;
  return Math.abs(r - x) < 2e-6 ? r : x;
};

const kids = (el: Element, tag: string): Element[] => [...el.children].filter(c => c.tagName === tag);
const kid = (el: Element, tag: string): Element | undefined => [...el.children].find(c => c.tagName === tag);
const text = (el: Element | undefined, tag: string): string | undefined => {
  const k = el && kid(el, tag);
  return k ? (k.textContent ?? '').trim() : undefined;
};

function readClef(el: Element): Clef {
  const raw = text(el, 'sign')?.toUpperCase() ?? 'G';
  const sign: Clef['sign'] = raw === 'F' ? 'F' : raw === 'C' ? 'C' : raw === 'PERCUSSION' ? 'percussion' : 'G';
  const defLine = sign === 'F' ? 4 : sign === 'C' || sign === 'percussion' ? 3 : 2;
  // TAB ou « none » : pas de sens ici, on retombe sur une clé de sol
  const line = raw === 'G' || raw === 'F' || raw === 'C' ? Number(text(el, 'line')) || defLine : defLine;
  const oct = Number(text(el, 'clef-octave-change'));
  return oct ? { sign, line, octaveChange: oct } : { sign, line };
}

const sameClef = (a: Clef, b: Clef) =>
  a.sign === b.sign && a.line === b.line && (a.octaveChange ?? 0) === (b.octaveChange ?? 0);

/** Nombre de temps d'une métrique, y compris les formes composées « 3+2 ». */
const parseBeats = (s: string | undefined): number =>
  s ? s.split('+').reduce((a, x) => a + (Number(x) || 0), 0) : 0;

function readTitle(root: Element): string {
  const work = kid(root, 'work');
  const t = text(work, 'work-title') || text(root, 'movement-title');
  if (t) return t;
  // À défaut, le plus gros texte du haut de la page (Audiveris met le titre en <credit>). Les numéros
  // de mesure et les lettres de repère sont aussi des <credit> : on écarte ce qui n'a pas l'air d'un mot.
  const height = Number(root.querySelector('defaults > page-layout > page-height')?.textContent) || 0;
  let best = '', bestSize = 0;
  root.querySelectorAll(':scope > credit > credit-words').forEach(c => {
    const s = (c.textContent ?? '').trim();
    if ((s.match(/\p{L}/gu) ?? []).length < 3) return;
    const y = Number(c.getAttribute('default-y'));
    if (height && Number.isFinite(y) && y < height * 0.75) return;
    const size = Number(c.getAttribute('font-size')) || 0;
    if (size > bestSize) { best = s; bestSize = size; }
  });
  return best;
}

function readLyrics(note: Element): Lyric[] {
  const out: Lyric[] = [];
  for (const ly of kids(note, 'lyric')) {
    // Une élision (<text>a</text><elision/><text>b</text>) se lit comme un seul mot
    const words = kids(ly, 'text').map(t => (t.textContent ?? '').trim()).filter(Boolean);
    if (!words.length) continue;   // <extend> seul : prolongation d'une syllabe, rien à afficher
    const verse = parseInt((ly.getAttribute('number') ?? '1').replace(/\D+/g, ''), 10) || 1;
    const syl = text(ly, 'syllabic');
    const l: Lyric = { verse, text: words.join('‿') };
    if (syl === 'single' || syl === 'begin' || syl === 'middle' || syl === 'end') l.syllabic = syl;
    out.push(l);
  }
  return out.sort((a, b) => a.verse - b.verse);
}

interface MeasureInfo {
  label: string;
  beats?: number;
  beatType?: number;
  fifths?: number;
  mode?: 'major' | 'minor';
  newSystem?: boolean;
  newPage?: boolean;
}

interface LineBuild {
  line: Line;
  /** voix Audiveris → voix renumérotée dans la ligne */
  voices: Map<string, number>;
  /** clé en vigueur (pour ne noter que les vrais changements) */
  clef: Clef | null;
}

/**
 * Lit le MusicXML (score-partwise) produit par Audiveris pour UNE page.
 * - une Line par (partie, portée) : id `${indicePartie}|${portée}` ;
 * - NoteEvent.measure = indice local de la mesure dans la page ; offset relatif à la mesure ;
 * - silences conservés (pitch null), notes d'ornement ignorées, accords = même offset ;
 * - liaisons de prolongation : `tie: true` sur la note qui commence la liaison (pas de fusion) ;
 * - paroles (<lyric number>) avec syllabic ;
 * - sauts de système/page de l'original (<print new-system|new-page>) → Measure.newSystem/newPage.
 * Lève une Error en français si le XML est illisible.
 */
export function readMusicXml(xml: string): PageScore {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('MusicXML illisible : le fichier n\'est pas un XML valide.');
  const root = doc.documentElement;
  if (root.tagName !== 'score-partwise')
    throw new Error(`MusicXML non pris en charge : élément racine <${root.tagName}> au lieu de <score-partwise>.`);

  const partNames = new Map<string, string>();
  root.querySelectorAll(':scope > part-list > score-part').forEach(sp =>
    partNames.set(sp.getAttribute('id') ?? '', text(sp, 'part-name') || ''));

  const parts = kids(root, 'part');
  const infos: MeasureInfo[] = [];
  const staves: number[] = [];
  const builds = new Map<string, LineBuild>();
  let hasTime = false, hasKey = false;

  parts.forEach((part, pi) => {
    const partName = partNames.get(part.getAttribute('id') ?? '') || `Partie ${pi + 1}`;
    let div = 1;
    let nStaves = 1;
    const partLines: LineBuild[] = [];
    const lineOf = (staff: number): LineBuild => {
      const id = `${pi}|${staff}`;
      let b = builds.get(id);
      if (!b) {
        b = { line: { id, name: '', part: pi, partName, staff, clef: { sign: 'G', line: 2 }, notes: [] }, voices: new Map(), clef: null };
        builds.set(id, b);
        partLines.push(b);
      }
      return b;
    };

    kids(part, 'measure').forEach((m, mi) => {
      const info = (infos[mi] ??= { label: m.getAttribute('number') ?? String(mi + 1) });
      let pos = 0, prevStart = 0;
      for (const el of m.children) {
        const dur = () => (Number(text(el, 'duration')) || 0) / div;
        switch (el.tagName) {
          case 'print':
            if (el.getAttribute('new-system') === 'yes') info.newSystem = true;
            if (el.getAttribute('new-page') === 'yes') info.newPage = true;
            break;
          case 'attributes': {
            const d = Number(text(el, 'divisions'));
            if (d > 0) div = d;
            const st = Number(text(el, 'staves'));
            if (st > 0) nStaves = st;
            const time = kid(el, 'time');
            const beats = parseBeats(text(time, 'beats')), beatType = Number(text(time, 'beat-type'));
            if (time && beats > 0 && beatType > 0) {
              hasTime = true;
              if (info.beats === undefined) { info.beats = beats; info.beatType = beatType; }
            }
            const key = kid(el, 'key');
            const fifths = text(key, 'fifths');
            if (key && fifths !== undefined && fifths !== '' && Number.isFinite(Number(fifths))) {
              hasKey = true;
              if (info.fifths === undefined) {
                info.fifths = Math.max(-7, Math.min(7, Math.round(Number(fifths))));
                info.mode = text(key, 'mode') === 'minor' ? 'minor' : 'major';
              }
            }
            for (const c of kids(el, 'clef')) {
              const staff = Number(c.getAttribute('number')) || 1;
              const b = lineOf(staff);
              const clef = readClef(c);
              if (!b.clef && mi === 0 && pos < 1e-9) b.line.clef = clef;
              // une clé qui n'arrive qu'en cours de page : la portée commençait en clé de sol par défaut
              else if (!sameClef(b.clef ?? b.line.clef, clef))
                (b.line.clefChanges ??= []).push({ measure: mi, offset: snap(pos), clef });
              b.clef = clef;
            }
            break;
          }
          case 'backup': pos -= dur(); break;
          case 'forward': pos += dur(); break;
          case 'note': {
            if (kid(el, 'grace')) break;   // ornement : ne compte pas dans la mesure
            const d = dur();
            const chord = !!kid(el, 'chord');
            const start = chord ? prevStart : pos;
            if (!chord) { prevStart = pos; pos += d; }
            if (kid(el, 'unpitched') || kid(el, 'cue')) break;   // percussion, notes de rappel : non jouées
            const staff = Number(text(el, 'staff')) || 1;
            if (staff > nStaves) nStaves = staff;
            const b = lineOf(staff);
            const vKey = text(el, 'voice') || '1';
            let voice = b.voices.get(vKey);
            if (voice === undefined) { voice = b.voices.size + 1; b.voices.set(vKey, voice); }
            let pitch: Pitch | null = null;
            const p = kid(el, 'pitch');
            if (p) {
              const step = (text(p, 'step') ?? '').toUpperCase();
              const octave = Number(text(p, 'octave'));
              if (!STEPS.has(step) || !Number.isFinite(octave)) break;   // hauteur illisible : rien à jouer
              pitch = { step: step as Step, alter: Math.round(Number(text(p, 'alter')) || 0), octave };
            } else if (!kid(el, 'rest')) break;
            const n: NoteEvent = { id: '', measure: mi, offset: snap(start), duration: snap(d), pitch, voice };
            if (pitch && kids(el, 'tie').some(t => t.getAttribute('type') === 'start')) n.tie = true;
            const lyrics = readLyrics(el);
            if (lyrics.length) n.lyrics = lyrics;
            b.line.notes.push(n);
            break;
          }
        }
      }
    });
    staves[pi] = Math.max(nStaves, ...partLines.map(b => b.line.staff));
    // une ligne par portée déclarée, même si elle n'a rien sur cette page
    for (let k = 1; k <= staves[pi]; k++) lineOf(k);
  });

  // Métrique et armure : chaque mesure hérite de la précédente dans la page ; 4/4 et Do majeur par défaut
  let beats = 4, beatType = 4, fifths = 0, mode: 'major' | 'minor' = 'major';
  const measures: PageScore['measures'] = infos.map((info, i) => {
    if (info.beats !== undefined) { beats = info.beats; beatType = info.beatType!; }
    if (info.fifths !== undefined) { fifths = info.fifths; mode = info.mode!; }
    const m: Omit<Measure, 'pageKey' | 'page'> = { local: i, label: info.label, beats, beatType, fifths, mode };
    if (info.newSystem) m.newSystem = true;
    if (info.newPage) m.newPage = true;
    return m;
  });

  const lines = [...builds.values()].map(b => b.line).sort((a, b) => a.part - b.part || a.staff - b.staff);
  for (const l of lines) {
    l.name = l.partName + ((staves[l.part] ?? 1) > 1 ? ` — portée ${l.staff}` : '');
    l.notes.sort((a, b) => a.measure - b.measure || a.offset - b.offset || a.voice - b.voice);
    // identifiants provisoires, uniques dans la page (l'assemblage les préfixe par la page)
    let k = 0, cur = -1;
    for (const n of l.notes) {
      if (n.measure !== cur) { cur = n.measure; k = 0; }
      n.id = `${n.measure}.${l.id}.${k++}`;
    }
    if (l.clefChanges) l.clefChanges.sort((a, b) => a.measure - b.measure || a.offset - b.offset);
  }

  return { title: readTitle(root), measures, lines, staves: parts.map((_, i) => staves[i] ?? 1), hasTime, hasKey };
}
