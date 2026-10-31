// Insertion et suppression de mesures. Ces fonctions modifient un brouillon de projet : on les appelle
// dans editProject, ce qui les rend annulables. Tout ce qui désigne une mesure par son indice (notes,
// changements de clé, symboles perdus, mesures validées) est recalé.
//
// Une mesure ajoutée n'a pas de page d'origine : son pageKey (`ajout-…`) n'appartient à aucune page.
// Une réanalyse reconstruit les mesures d'une page d'après l'image : une mesure ajoutée dans une page
// analysée disparaît alors, et une mesure supprimée revient.
import { measureRest } from './blank';
import type { Clef, Measure, Project } from './types';

export const ADDED_PREFIX = 'ajout-';
export const isAddedMeasure = (m: Pick<Measure, 'pageKey'>): boolean => m.pageKey.startsWith(ADDED_PREFIX);

let seq = 0;
const addedKey = () => `${ADDED_PREFIX}${Date.now().toString(36)}${(++seq).toString(36)}`;

/** Recale un indice de mesure : `fn` rend le nouvel indice, ou null si la mesure disparaît. */
function remap(p: Project, fn: (m: number) => number | null): void {
  for (const l of p.lines) {
    l.notes = l.notes.flatMap(n => { const m = fn(n.measure); return m === null ? [] : [{ ...n, measure: m }]; });
    if (l.clefChanges)
      l.clefChanges = l.clefChanges.flatMap(c => { const m = fn(c.measure); return m === null ? [] : [{ ...c, measure: m }]; });
  }
  p.review.lost = p.review.lost.flatMap(s => { const m = fn(s.measure); return m === null ? [] : [{ ...s, measure: m }]; });
  p.review.checked = p.review.checked.flatMap(k => {
    const cut = k.indexOf('|');
    const m = cut > 0 ? fn(Number(k.slice(0, cut))) : null;
    return m === null ? [] : [`${m}${k.slice(cut)}`];
  });
}

/**
 * Insère une mesure à l'indice `at` (0..nombre de mesures), avec la métrique et l'armure de la mesure
 * qui précède (à défaut, de celle qu'elle repousse), et un silence de mesure sur chaque ligne.
 * Rend l'indice de la nouvelle mesure.
 */
export function insertMeasure(p: Project, at: number, key = addedKey()): number {
  const i = Math.max(0, Math.min(p.measures.length, Math.round(at)));
  const ref = p.measures[i - 1] ?? p.measures[i];
  const m: Measure = {
    pageKey: key, page: ref?.page ?? 1, local: 0, label: 'ajoutée',
    beats: ref?.beats ?? 4, beatType: ref?.beatType ?? 4, fifths: ref?.fifths ?? 0, mode: ref?.mode ?? 'major',
  };
  remap(p, x => (x >= i ? x + 1 : x));
  p.measures.splice(i, 0, m);
  // les notes restent triées par (mesure, offset, voix) : le silence se place avant la première note suivante
  for (const l of p.lines) {
    const k = l.notes.findIndex(n => n.measure > i);
    l.notes.splice(k < 0 ? l.notes.length : k, 0, measureRest(m, i, l.id));
  }
  return i;
}

/**
 * Supprime la mesure `at` et son contenu, et recale la suite. Un changement de clé posé dans la mesure
 * supprimée vaut encore pour la suite : la clé en vigueur à sa fin est reportée au début de la suivante.
 * Un début de système ou de page passe aussi à la suivante. Refuse (rend false) de supprimer la dernière
 * mesure restante.
 */
export function deleteMeasure(p: Project, at: number): boolean {
  const n = p.measures.length;
  if (n <= 1 || at < 0 || at >= n || !Number.isInteger(at)) return false;
  const gone = p.measures[at];
  const next = p.measures[at + 1];
  if (next) {
    if (gone.newSystem) next.newSystem = true;
    if (gone.newPage) next.newPage = true;
  }

  for (const l of p.lines) {
    const inside = (l.clefChanges ?? []).filter(c => c.measure === at).sort((a, b) => a.offset - b.offset);
    if (!inside.length) continue;
    const last: Clef = inside[inside.length - 1].clef;
    l.clefChanges = l.clefChanges!.filter(c => c.measure !== at);
    if (!next) continue;   // fin de la partition : plus rien après
    if (at === 0) {
      // la suivante devient la première : c'est la clé de début de la ligne qui change
      if (!l.clefChanges.some(c => c.measure === 1 && c.offset <= 1e-6)) l.clef = { ...last };
    } else if (!l.clefChanges.some(c => c.measure === at + 1 && c.offset <= 1e-6)) {
      l.clefChanges.push({ measure: at + 1, offset: 0, clef: { ...last } });
    }
    l.clefChanges.sort((a, b) => a.measure - b.measure || a.offset - b.offset);
  }

  remap(p, x => (x === at ? null : x > at ? x - 1 : x));
  p.measures.splice(at, 1);
  for (const l of p.lines) if (l.clefChanges && !l.clefChanges.length) delete l.clefChanges;
  return true;
}

/** La mesure contient-elle au moins une note (pas seulement des silences) sur une ligne ? */
export const hasNotes = (p: Project, at: number): boolean =>
  p.lines.some(l => l.notes.some(n => n.measure === at && n.pitch));

/**
 * Où se trouve la mesure sur l'original, en clair (« page 2, mesure 5 »), « ajoutée » pour une mesure
 * insérée dans une partition analysée, ou null quand il n'y a pas d'original (partition vierge, ancien
 * projet sans pages).
 */
export function measureOrigin(p: Pick<Project, 'pages'>, m: Measure): string | null {
  if (p.pages.some(pg => pg.key === m.pageKey)) return `page ${m.page}, mesure ${m.label}`;
  if (isAddedMeasure(m) && p.pages.length) return 'ajoutée';
  return null;
}
