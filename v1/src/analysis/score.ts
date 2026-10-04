// Note d'une police sur un extrait : c'est elle qui départage les polices lors de l'essai automatique.
import { assemble } from '../model/assemble';
import { findIssues } from '../model/check';
import type { PageScore, UnplacedSymbol } from '../model/types';

export interface TrialMetrics {
  /** mesures reconnues */
  measures: number;
  /** lignes musicales */
  lines: number;
  /** notes (hors silences) */
  notes: number;
  /** couples (mesure, ligne) au rythme faux, vides ou troués */
  bad: number;
  /** symboles vus mais non placés (journal d'Audiveris) */
  lost: number;
}

/** Mesure un résultat d'analyse avec les contrôles mêmes de la relecture (assemble + findIssues). */
export function trialMetrics(score: PageScore, unplaced: UnplacedSymbol[]): TrialMetrics {
  const { project } = assemble([{ key: 'essai', name: 'essai', font: '', scale: 1, score, unplaced }], null);
  const bad = new Set<string>();
  for (const i of findIssues(project)) if (i.kind !== 'lost') bad.add(`${i.measure}|${i.lineId}`);
  return {
    measures: project.measures.length,
    lines: project.lines.length,
    notes: project.lines.reduce((a, l) => a + l.notes.filter(n => n.pitch).length, 0),
    bad: bad.size,
    lost: project.review.lost.length,
  };
}

/**
 * Plus haut = meilleur :  1,5 × mesures × lignes − mesures fausses − 0,5 × symboles perdus + notes / 1000.
 *
 * - Chaque mesure-ligne compte, et chaque mesure-ligne fausse (rythme, vide, trou) se retranche : c'est le
 *   contrôle qui révèle une figure perdue (Bravura sans ses rondes sur Over The Rainbow).
 * - Une mesure trouvée vaut 1,5 et non 1 : une barre de mesure manquée fusionne deux mesures en une seule
 *   mesure fausse, ce que la seule soustraction compterait comme une erreur alors que la structure est
 *   perdue (et l'éditeur ne sait pas recréer une barre). Mesuré sur Fly Me To The Moon : Finale Jazz y
 *   retrouve toutes les barres (8 mesures sur l'extrait, 42 sur la page) mais avec un rythme faux de plus ;
 *   à 1 pour 1, Leland et elle seraient à égalité. Au-delà de 1,5, une barre parasite (qui coupe une mesure
 *   juste en deux moitiés fausses) ne serait plus pénalisée.
 * - Un symbole perdu (vu par Audiveris, absent du résultat) pèse une demi-erreur : il se signale déjà
 *   souvent par une mesure fausse.
 * - Les notes ne départagent qu'à égalité : leur nombre seul n'est pas un gage (sur Fly Me, une mélodie
 *   seule, Bravura « trouve » 170 notes contre 125, dont 49 notes d'accord et 82 blanches : des têtes
 *   inventées).
 */
export function fontScore(m: TrialMetrics): number {
  return structure(m) + m.notes / 1000;
}

/** Partie de la note qui ne dépend que de la structure et des contrôles (multiple de 0,5). */
const structure = (m: TrialMetrics) => 1.5 * m.measures * m.lines - m.bad - 0.5 * m.lost;

/**
 * Police retenue parmi les essais aboutis. La police par défaut garde la main tant qu'aucune autre ne la
 * bat sur la structure : un écart d'une ou deux notes seulement tient du hasard (Fortunio p. 1 : Bravura
 * devance Leland d'une note sur l'extrait, et fait pire qu'elle sur la page 2). Entre les autres polices à
 * égalité de structure, le nombre de notes départage, puis l'ordre des essais.
 */
export function pickFont<T extends TrialMetrics & { font: string }>(trials: T[], defaultFont: string): T | null {
  if (!trials.length) return null;
  const top = Math.max(...trials.map(structure));
  const best = trials.filter(t => structure(t) >= top - 1e-9);
  return best.find(t => t.font === defaultFont)
    ?? best.reduce((a, b) => (b.notes > a.notes ? b : a));
}
