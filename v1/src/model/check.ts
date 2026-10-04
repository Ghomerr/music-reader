// Contrôle des durées : le principal indicateur de qualité de la reconnaissance (cf. PLAN.md, étape 1).
// Chaque mesure de chaque ligne doit remplir exactement sa métrique, toutes voix confondues. Repris de la
// v0 (checkRhythm), mais calculé sur le modèle interne : il suit donc les corrections manuelles.
// Appelé à chaque modification du projet : tout est indexé une fois par mesure, rien n'est quadratique.
import { durationName, EPS, same } from './pitch';
import type { Issue, IssueKind, LostSymbol, MeasureTime, NoteEvent, Project } from './types';

/** Nombre lisible à la française : 3 décimales au plus, virgule décimale. */
const fr = (x: number): string => String(+x.toFixed(3)).replace('.', ',').replace('-', '−');

const expectedLen = (m: { beats: number; beatType: number }) => (m.beats * 4) / m.beatType;

/** Notes regroupées par mesure, pour une ligne : byMeasure[mesure] (undefined si aucune). */
function indexByMeasure(notes: NoteEvent[], nMeasures: number): (NoteEvent[] | undefined)[] {
  const out: (NoteEvent[] | undefined)[] = new Array(nMeasures);
  for (const n of notes) {
    if (n.measure < 0 || n.measure >= nMeasures) continue;
    (out[n.measure] ??= []).push(n);
  }
  return out;
}

/** Fin du contenu le plus long de chaque mesure, sur les lignes retenues. */
function maxEnds(p: Project, keep: (id: string) => boolean): number[] {
  const ends = new Array<number>(p.measures.length).fill(0);
  for (const l of p.lines) {
    if (!keep(l.id)) continue;
    for (const n of l.notes)
      if (n.measure >= 0 && n.measure < ends.length) ends[n.measure] = Math.max(ends[n.measure], n.offset + n.duration);
  }
  return ends;
}

const isPickup = (i: number, maxEnd: number, expected: number) =>
  i === 0 && maxEnd > EPS && maxEnd < expected - EPS;

/**
 * Place chaque mesure dans le temps. Durée d'une mesure = durée attendue (métrique), ou le contenu le
 * plus long s'il déborde ; la première mesure plus courte que la métrique est une anacrouse.
 *
 * Seules comptent les lignes `lineIds` (par défaut : les lignes cochées à l'écoute). Une ligne mal lue
 * qu'on a décochée n'allonge donc plus les mesures des autres : on écoute et on voit le chant en 4/4 même
 * si le piano déborde encore. En contrepartie, cocher ou décocher une ligne peut déplacer les mesures
 * suivantes dans le temps.
 */
export function timeline(p: Project, lineIds?: string[]): MeasureTime[] {
  const ids = lineIds && new Set(lineIds);
  const keep = (id: string) => (ids ? ids.has(id) : p.settings.lines[id]?.enabled !== false);
  const ends = maxEnds(p, keep);
  let start = 0;
  return p.measures.map((m, i) => {
    const expected = expectedLen(m);
    const len = isPickup(i, ends[i], expected) ? ends[i] : Math.max(expected, ends[i]);
    const t = { start, len, expected };
    start += len;
    return t;
  });
}

const KIND_ORDER: Record<IssueKind, number> = { empty: 0, rhythm: 1, gap: 2, lost: 3 };
const FEMININE = /^(ronde|blanche|noire|croche|double|triple)/;

function lostText(list: LostSymbol[]): string {
  const names = list.map(s => (s.rest ? `silence de ${durationName(s.duration)}` : durationName(s.duration)));
  if (list.length === 1) {
    const e = !list[0].rest && FEMININE.test(names[0]) ? 'e' : '';
    return `1 ${names[0]} vu${e} par Audiveris mais non placé${e} dans le temps, donc absent${e}`;
  }
  return `${list.length} symboles vus par Audiveris mais non placés dans le temps (${names.join(', ')}), donc absents`;
}

/** Trous de l'union des intervalles [offset, offset + durée] entre 0 et `end`. */
function gaps(notes: NoteEvent[], end: number): { at: number; len: number }[] {
  const iv = notes.filter(n => n.duration > EPS).map(n => [n.offset, n.offset + n.duration]).sort((a, b) => a[0] - b[0]);
  const out: { at: number; len: number }[] = [];
  let cur = 0;
  for (const [s, e] of iv) {
    if (s > cur + EPS && cur < end - EPS) out.push({ at: cur, len: Math.min(s, end) - cur });
    cur = Math.max(cur, e);
  }
  return out;
}

/**
 * Diagnostics, recalculés à chaque modification du modèle, triés par mesure puis ligne :
 * - empty : aucune note ni silence sur la ligne ;
 * - rhythm : le contenu n'atteint pas ou dépasse la métrique (hors anacrouse) ;
 * - gap : un trou dans le temps à l'intérieur de la mesure ;
 * - lost : symbole vu par Audiveris mais non placé (journal), tant que la mesure-ligne n'a pas été
 *   retouchée à la main.
 * `checked` = l'utilisateur a validé la mesure-ligne (review.checked).
 */
export function findIssues(p: Project): Issue[] {
  const nM = p.measures.length;
  const checked = new Set(p.review.checked);
  const ends = maxEnds(p, () => true);   // anacrouse jugée sur toutes les lignes, cochées ou non
  const lineOrder = new Map(p.lines.map((l, i) => [l.id, i]));
  const byLine = new Map(p.lines.map(l => [l.id, indexByMeasure(l.notes, nM)]));
  const out: Issue[] = [];
  const add = (measure: number, lineId: string, kind: IssueKind, text: string) =>
    out.push({ measure, lineId, kind, text, checked: checked.has(`${measure}|${lineId}`) });

  for (const l of p.lines) {
    const idx = byLine.get(l.id)!;
    for (let m = 0; m < nM; m++) {
      const notes = idx[m];
      if (!notes?.length) { add(m, l.id, 'empty', 'aucune note reconnue'); continue; }
      const expected = expectedLen(p.measures[m]);
      let end = 0, zero = 0;
      for (const n of notes) {
        end = Math.max(end, n.offset + n.duration);
        if (n.duration <= EPS) zero++;
      }
      const why: string[] = [];
      // anacrouse : la première mesure, plus courte que la métrique sur toutes les lignes, est normale
      if (!same(end, expected) && !isPickup(m, ends[m], expected)) {
        const diff = end - expected;
        why.push(`${fr(end)} temps au lieu de ${fr(expected)} (${diff > 0 ? '+' : ''}${fr(diff)})`);
      }
      if (zero) why.push(zero > 1 ? `${zero} notes de durée nulle` : 'note de durée nulle');
      if (why.length) add(m, l.id, 'rhythm', why.join(' ; '));
      const holes = gaps(notes, end);
      if (holes.length)
        add(m, l.id, 'gap', holes.map(h => `trou de ${fr(h.len)} temps au temps ${fr(h.at + 1)}`).join(', '));
    }
  }

  // Symboles perdus, regroupés par mesure-ligne ; une retouche manuelle les fait taire
  const lost = new Map<string, LostSymbol[]>();
  for (const s of p.review.lost) {
    if (s.measure < 0 || s.measure >= nM || !byLine.has(s.lineId)) continue;
    const k = `${s.measure}|${s.lineId}`;
    if (!lost.has(k)) lost.set(k, []);
    lost.get(k)!.push(s);
  }
  for (const list of lost.values()) {
    const { measure, lineId } = list[0];
    if (byLine.get(lineId)![measure]?.some(n => n.manual)) continue;
    add(measure, lineId, 'lost', lostText(list));
  }

  return out.sort((a, b) => a.measure - b.measure
    || (lineOrder.get(a.lineId) ?? 0) - (lineOrder.get(b.lineId) ?? 0)
    || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
}
