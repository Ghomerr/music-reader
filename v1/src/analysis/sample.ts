// Extrait de page pour l'essai des polices : les premiers systèmes, jusqu'à couvrir quelques mesures.
// Module pur (aucune dépendance au navigateur) : il sert aussi aux expériences de calibration en Node.
import type { PageLayout } from '../model/types';

export interface Rect { x: number; y: number; w: number; h: number }

export interface SampleRegion {
  rect: Rect;
  /** nombre de systèmes retenus */
  systems: number;
  /** mesures couvertes (d'après le découpage d'Audiveris) */
  measures: number;
}

/**
 * Rectangle (coordonnées de l'image analysée) couvrant les premiers systèmes, jusqu'à au moins
 * `minMeasures` mesures et `minSystems` systèmes. Deux systèmes au moins : Audiveris calcule sur toute
 * l'image des statistiques (épaisseur des ligatures, position des têtes par rapport aux hampes) qui,
 * sur un seul système, sont trop pauvres — il y perd alors des figures qu'il trouve sur la page entière
 * (mesuré : 0 ronde au lieu de 5 sur les 4 premières mesures d'Over The Rainbow avec Leland, alors
 * qu'avec deux systèmes l'extrait redonne exactement le résultat de la page). Toute la largeur est gardée : la clé, l'armure et la métrique sont en tête de système, et
 * sans elles Audiveris ne sait ni lire les hauteurs ni contrôler le rythme. En hauteur, on prend de
 * la marge au-dessus et au-dessous (lignes supplémentaires, accords, paroles sous la portée) sans
 * mordre sur le système voisin : s'il en restait un bout, Audiveris y chercherait une portée.
 */
export function sampleRegion(layout: PageLayout, minMeasures = 4, minSystems = 2): SampleRegion | null {
  const systems = layout.systems.filter(s => s.staves.length && s.bottom > s.top).sort((a, b) => a.top - b.top);
  if (!systems.length || !layout.width || !layout.height) return null;
  const il = layout.interline || 20;
  let n = 0, measures = 0;
  while (n < systems.length && (measures < minMeasures || n < minSystems)) measures += systems[n++].measures.length;
  const first = systems[0], last = systems[n - 1], next = systems[n];
  // Au-dessus du 1er système : le titre et l'en-tête n'apportent rien à l'essai, on se limite à 6 interlignes.
  const top = Math.max(0, Math.round(first.top - Math.min(first.top, 6 * il)));
  // Au-dessous : jusqu'au milieu de l'intervalle avec le système suivant (paroles comprises).
  const below = next ? Math.min((next.top - last.bottom) / 2, 10 * il) : 8 * il;
  const bottom = Math.min(layout.height, Math.round(last.bottom + Math.max(below, 2 * il)));
  return { rect: { x: 0, y: top, w: layout.width, h: bottom - top }, systems: n, measures };
}
