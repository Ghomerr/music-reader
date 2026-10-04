// Assemblage des pages analysées en une seule partition (modèle interne), et reprise du travail de
// l'utilisateur quand on réassemble après une réanalyse ou un réordonnancement des pages.
// Tout ce qui vient de l'utilisateur est repéré par (page, mesure locale, ligne) et non par l'indice
// global de mesure : c'est le seul repère qui survit à l'ajout, la suppression ou le déplacement d'une page.
import { midi } from './pitch';
import { defaultSettings } from './project-io';
import type { Clef, Line, LostSymbol, Lyric, Measure, NoteEvent, PageMeta, PageScore, Project, UnplacedSymbol } from './types';

export interface AnalyzedPage {
  key: string;
  name: string;
  font: string;
  scale: number;
  score: PageScore;
  unplaced: UnplacedSymbol[];
}

const sameClef = (a: Clef, b: Clef) =>
  a.sign === b.sign && a.line === b.line && (a.octaveChange ?? 0) === (b.octaveChange ?? 0);

const byTime = (a: NoteEvent, b: NoteEvent) => a.measure - b.measure || a.offset - b.offset || a.voice - b.voice;

/** Ligne en cours d'assemblage : notes rangées par mesure globale. */
interface LineBuild {
  line: Line;
  byMeasure: Map<number, NoteEvent[]>;
  /** clé en vigueur à la fin de la dernière page vue */
  clef: Clef;
}

function newBuild(src: Line): LineBuild {
  return {
    line: { id: src.id, name: src.name, part: src.part, partName: src.partName, staff: src.staff, clef: { ...src.clef }, notes: [] },
    byMeasure: new Map(),
    clef: src.clef,
  };
}

/**
 * Symboles perdus d'une page (journal Audiveris) → mesure globale et ligne. Le journal donne la portée
 * comptée sur toute la page : on retrouve (partie, portée) en cyclant sur les portées d'un système.
 * Si Audiveris nomme une autre partie (système incomplet), c'est lui qu'on croit.
 */
function lostOfPage(pg: AnalyzedPage, base: number, lineIds: Set<string>): LostSymbol[] {
  const staffOf = pg.score.staves.flatMap((n, pi) => Array.from({ length: n || 1 }, (_, k) => ({ pi, k: k + 1 })));
  const out: LostSymbol[] = [];
  const seen = new Set<string>();
  for (const u of pg.unplaced) {
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    const at = u.staff > 0 && staffOf.length ? staffOf[(u.staff - 1) % staffOf.length] : undefined;
    let pi = at?.pi ?? 0, k = at?.k ?? 1;
    if (u.part && pi !== u.part - 1) { pi = u.part - 1; k = 1; }
    let local = pg.score.measures.findIndex(m => m.label === u.measure);
    if (local < 0) {
      const n = parseInt(u.measure, 10) - 1;
      local = n >= 0 && n < pg.score.measures.length ? n : -1;
    }
    const lineId = `${pi}|${k}`;
    if (local < 0 || !lineIds.has(lineId) || !u.dur[1]) continue;
    out.push({ measure: base + local, lineId, rest: u.rest, duration: (u.dur[0] / u.dur[1]) * 4 });
  }
  return out;
}

/** Report des paroles saisies à la main sur la note correspondante de la nouvelle analyse. */
function carryLyrics(from: NoteEvent, candidates: NoteEvent[] | undefined): boolean {
  const manual = (from.lyrics ?? []).filter(l => l.manual);
  if (!manual.length || !candidates) return false;
  const at = candidates.filter(n => n.pitch && Math.abs(n.offset - from.offset) < 1e-6);
  const score = (n: NoteEvent) => (n.voice === from.voice ? 2 : 0) + (from.pitch && n.pitch && midi(n.pitch) === midi(from.pitch) ? 1 : 0);
  const target = at.sort((a, b) => score(b) - score(a))[0];
  if (!target) return false;
  const lyrics: Lyric[] = (target.lyrics ?? []).filter(l => !manual.some(m => m.verse === l.verse));
  target.lyrics = [...lyrics, ...manual.map(l => ({ ...l }))].sort((a, b) => a.verse - b.verse);
  return true;
}

/**
 * Met les pages analysées bout à bout (dans l'ordre donné) en un seul projet.
 * - lignes raccordées par position (id `${partie}|${portée}`) ; avertissement si une page diffère ;
 * - métrique et armure héritées de la page précédente quand une page de suite ne les réimprime pas ;
 * - symboles perdus (journal Audiveris) rattachés à leur mesure globale et à leur ligne ;
 * - `previous` (projet courant) : on en reprend titre, réglages, mesures validées, et surtout
 *   les corrections manuelles — pour chaque (pageKey, mesure locale, ligne) contenant une note
 *   `manual`, le contenu corrigé remplace celui de la nouvelle analyse ; les paroles `manual`
 *   sont reportées sur la note de même ligne, mesure et offset si elle existe.
 */
export function assemble(pages: AnalyzedPage[], previous: Project | null): { project: Project; warnings: string[] } {
  const warnings: string[] = [];
  const measures: Measure[] = [];
  const builds = new Map<string, LineBuild>();
  const lost: LostSymbol[] = [];
  let firstIds: Set<string> | null = null;
  let time: { beats: number; beatType: number } | null = null;
  let key: { fifths: number; mode: 'major' | 'minor' } | null = null;

  pages.forEach((pg, i) => {
    const sc = pg.score;
    const base = measures.length;

    // Mesures. Une page de suite sans métrique ni armure reprend celles de la fin de la page précédente
    // (c'est ainsi qu'on les lit sur le papier) ; à défaut, 4/4 et Do majeur.
    if (!sc.hasTime && !time && sc.measures.length)
      warnings.push(`Page ${i + 1} : aucune métrique indiquée, 4/4 supposé.`);
    sc.measures.forEach((m, j) => {
      const t = sc.hasTime ? m : time ?? { beats: 4, beatType: 4 };
      const k = sc.hasKey ? m : key ?? { fifths: 0, mode: 'major' as const };
      const g: Measure = {
        pageKey: pg.key, page: i + 1, local: j, label: m.label,
        beats: t.beats, beatType: t.beatType, fifths: k.fifths, mode: k.mode,
      };
      // chaque image est une page de l'original : son début est un saut de page
      if (m.newSystem || (j === 0 && i > 0)) g.newSystem = true;
      if (m.newPage || (j === 0 && i > 0)) g.newPage = true;
      measures.push(g);
    });
    const last = measures[measures.length - 1];
    if (sc.measures.length) { time = { beats: last.beats, beatType: last.beatType }; key = { fifths: last.fifths, mode: last.mode }; }

    // Lignes, raccordées par position (partie, portée)
    const ids = new Set(sc.lines.map(l => l.id));
    if (!firstIds) firstIds = ids;
    else if ([...ids].sort().join() !== [...firstIds].sort().join())
      warnings.push(`Page ${i + 1} : lignes détectées différentes de la page 1 (${ids.size} au lieu de ${firstIds.size}). Le raccord se fait par position.`);
    for (const l of sc.lines) {
      let b = builds.get(l.id);
      if (!b) builds.set(l.id, (b = newBuild(l)));
      else if (!sameClef(b.clef, l.clef)) {
        (b.line.clefChanges ??= []).push({ measure: base, offset: 0, clef: { ...l.clef } });
      }
      b.clef = l.clef;
      for (const c of l.clefChanges ?? []) {
        (b.line.clefChanges ??= []).push({ measure: base + c.measure, offset: c.offset, clef: { ...c.clef } });
        b.clef = c.clef;
      }
      for (const n of l.notes) {
        if (n.measure < 0 || n.measure >= sc.measures.length) continue;
        const copy: NoteEvent = structuredClone(n);
        copy.measure = base + n.measure;
        let list = b.byMeasure.get(copy.measure);
        if (!list) b.byMeasure.set(copy.measure, (list = []));
        list.push(copy);
      }
    }
    lost.push(...lostOfPage(pg, base, ids));
  });

  // ---------- Reprise du projet précédent ----------
  const where = new Map(measures.map((m, g) => [`${m.pageKey}|${m.local}`, g]));
  const pageKeys = new Set(pages.map(p => p.key));
  /** groupes (mesure globale, ligne) dont le contenu vient de l'utilisateur : identifiants conservés */
  const keepIds = new Set<string>();
  const checked: string[] = [];

  if (previous) {
    const groups = new Map<string, { line: Line; m: Measure; notes: NoteEvent[] }>();
    for (const l of previous.lines)
      for (const n of l.notes) {
        const m = previous.measures[n.measure];
        if (!m) continue;
        const k = `${m.pageKey}|${m.local}|${l.id}`;
        let gr = groups.get(k);
        if (!gr) groups.set(k, (gr = { line: l, m, notes: [] }));
        gr.notes.push(n);
      }
    let lyricsLost = 0;
    for (const { line, m, notes } of groups.values()) {
      const g = where.get(`${m.pageKey}|${m.local}`);
      if (notes.some(n => n.manual)) {
        if (g === undefined) {
          if (pageKeys.has(m.pageKey))
            warnings.push(`Page ${pages.findIndex(p => p.key === m.pageKey) + 1}, mesure ${m.label} : correction manuelle perdue, la nouvelle analyse n'a plus cette mesure.`);
          continue;
        }
        let b = builds.get(line.id);
        if (!b) builds.set(line.id, (b = newBuild(line)));
        b.byMeasure.set(g, notes.map(n => ({ ...structuredClone(n), measure: g })));
        keepIds.add(`${g}|${line.id}`);
      } else if (pageKeys.has(m.pageKey)) {   // page supprimée : ses paroles partent avec elle
        for (const n of notes) {
          if (!n.lyrics?.some(l => l.manual)) continue;
          if (g === undefined || !carryLyrics(n, builds.get(line.id)?.byMeasure.get(g))) lyricsLost++;
        }
      }
    }
    if (lyricsLost)
      warnings.push(`${lyricsLost} syllabe(s) corrigée(s) à la main n'ont pas retrouvé leur note dans la nouvelle analyse.`);

    for (const c of previous.review.checked) {
      const cut = c.indexOf('|');
      const m = previous.measures[Number(c.slice(0, cut))];
      const lineId = c.slice(cut + 1);
      const g = m && where.get(`${m.pageKey}|${m.local}`);
      if (cut > 0 && g !== undefined && builds.has(lineId)) checked.push(`${g}|${lineId}`);
    }
  }

  // ---------- Lignes finales, identifiants de notes ----------
  const seen = new Set<string>();
  const lines = [...builds.values()].sort((a, b) => a.line.part - b.line.part || a.line.staff - b.line.staff).map(b => {
    const l = b.line;
    for (const g of [...b.byMeasure.keys()].sort((x, y) => x - y)) {
      const list = b.byMeasure.get(g)!.sort(byTime);
      const m = measures[g];
      const keep = keepIds.has(`${g}|${l.id}`);
      list.forEach((n, k) => {
        let id = keep && n.id ? n.id : `${m.pageKey}.${m.local}.${l.id}.${k}`;
        while (seen.has(id)) id += '~';
        seen.add(id);
        n.id = id;
        l.notes.push(n);
      });
    }
    if (l.clefChanges) l.clefChanges.sort((a, b) => a.measure - b.measure || a.offset - b.offset);
    return l;
  });

  const title = previous?.title
    ?? (pages.find(p => p.score.title)?.score.title || pages[0]?.name.replace(/\.[^.]+$/, '') || 'Sans titre');
  const lineIds = new Set(lines.map(l => l.id));
  const def = defaultSettings(lines, title);
  const settings = previous
    ? {
        ...def, ...previous.settings,
        lines: Object.fromEntries(lines.map(l => [l.id, previous.settings.lines[l.id] ?? def.lines[l.id]])),
        print: { ...def.print, ...previous.settings.print, lines: previous.settings.print.lines.filter(id => lineIds.has(id)) },
      }
    : def;

  const pageMeta: PageMeta[] = pages.map(p => ({ key: p.key, name: p.name, font: p.font, scale: p.scale }));
  const project: Project = {
    format: 'music-reader',
    version: 2,
    title,
    createdAt: previous?.createdAt ?? new Date().toISOString(),
    pages: pageMeta,
    measures,
    lines,
    settings,
    review: { lost, checked: [...new Set(checked)] },
  };
  return { project, warnings };
}
