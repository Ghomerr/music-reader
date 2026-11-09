// Insertion, suppression et copie de mesures. Ces fonctions modifient un brouillon de projet : on les appelle
// dans editProject, ce qui les rend annulables. Tout ce qui désigne une mesure par son indice (notes,
// changements de clé, symboles perdus, mesures validées) est recalé.
//
// Une mesure ajoutée n'a pas de page d'origine : son pageKey (`ajout-…`) n'appartient à aucune page.
// Une réanalyse reconstruit les mesures d'une page d'après l'image : une mesure ajoutée dans une page
// analysée disparaît alors, et une mesure supprimée revient.
import { measureRest } from './blank';
import type { Clef, Measure, NoteEvent, Project } from './types';

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

export interface CopyOptions {
  /** lignes à copier ; absent ou vide = toutes */
  lineIds?: string[];
  /** copier aussi les paroles de la mesure source ; sinon les mesures cibles gardent les leurs */
  lyrics?: boolean;
}

let copySeq = 0;
const copyId = () => `copie-${Date.now().toString(36)}${(++copySeq).toString(36)}`;

/**
 * Copie le contenu de la mesure `from` sur chacune des mesures `targets` (indices), ligne par ligne : le
 * contenu des cibles est remplacé. Pratique pour un motif d'accompagnement ou un refrain qui se répète.
 * - Les notes copiées sont marquées `manual` : comme une correction à la main, elles survivent à une
 *   réanalyse de leur page.
 * - Paroles : par défaut, chaque cible garde les siennes, reportées sur la note copiée de même voix et de
 *   même position (un couplet suivant sur la même mélodie) ; avec `lyrics`, celles de la source sont copiées.
 * - Une cible n'est plus « validée » : son contenu a changé, le contrôle des durées la juge à nouveau (une
 *   cible d'une autre métrique peut ainsi être signalée).
 * La mesure source elle-même et les indices hors partition sont ignorés. Rend le nombre de mesures remplacées.
 */
export function copyMeasure(p: Project, from: number, targets: number[], o: CopyOptions = {}): number {
  const n = p.measures.length;
  if (!Number.isInteger(from) || from < 0 || from >= n) return 0;
  const dest = [...new Set(targets)].filter(t => Number.isInteger(t) && t >= 0 && t < n && t !== from);
  if (!dest.length) return 0;
  const lineIds = new Set(o.lineIds?.length ? o.lineIds : p.lines.map(l => l.id));
  const destSet = new Set(dest);
  for (const l of p.lines) {
    if (!lineIds.has(l.id)) continue;
    const source = l.notes.filter(x => x.measure === from);
    const old = new Map<number, NoteEvent[]>();
    for (const x of l.notes) {
      if (!destSet.has(x.measure)) continue;
      const list = old.get(x.measure);
      if (list) list.push(x); else old.set(x.measure, [x]);
    }
    const copies = dest.flatMap((t): NoteEvent[] => {
      // ligne vide dans la source : la cible reçoit un silence de mesure plutôt que rien (pas de « mesure vide »)
      if (!source.length) return [{ ...measureRest(p.measures[t], t, l.id), id: copyId(), manual: true }];
      const before = old.get(t) ?? [];
      return source.map(x => {
        const { lyrics: srcLyrics, ...rest } = x;
        const keep = o.lyrics ? srcLyrics
          : x.pitch ? before.find(b => b.pitch && b.voice === x.voice && Math.abs(b.offset - x.offset) < 1e-6)?.lyrics : undefined;
        return { ...rest, id: copyId(), measure: t, manual: true, ...(keep?.length ? { lyrics: keep.map(y => ({ ...y })) } : {}) };
      });
    });
    l.notes = [...l.notes.filter(x => !destSet.has(x.measure)), ...copies]
      .sort((a, b) => a.measure - b.measure || a.offset - b.offset || a.voice - b.voice);
  }
  p.review.checked = p.review.checked.filter(k => {
    const cut = k.indexOf('|');
    return !(destSet.has(Number(k.slice(0, cut))) && lineIds.has(k.slice(cut + 1)));
  });
  return dest.length;
}

/**
 * Lit une liste de mesures saisie à la main, numérotées comme à l'écran (à partir de 1) : « 5 », « 5, 7-9 »,
 * « 3 à 6 ». Rend les indices (à partir de 0) triés et sans doublon, ou un message d'erreur en clair.
 */
export function parseMeasureList(text: string, count: number): { indices: number[]; error?: string } {
  const out = new Set<number>();
  const tokens = text.replace(/\s*(?:à|-|–|\.\.)\s*/g, '-').split(/[\s,;]+/).filter(Boolean);
  if (!tokens.length) return { indices: [], error: 'Indiquez au moins une mesure (ex. « 5 » ou « 5, 7-9 »).' };
  for (const t of tokens) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(t);
    if (!m) return { indices: [], error: `« ${t} » n'est pas un numéro de mesure.` };
    const a = +m[1], b = m[2] ? +m[2] : a;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    if (lo < 1 || hi > count) return { indices: [], error: `« ${t} » : la partition va de la mesure 1 à la mesure ${count}.` };
    for (let i = lo; i <= hi; i++) out.add(i - 1);
  }
  return { indices: [...out].sort((x, y) => x - y) };
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
