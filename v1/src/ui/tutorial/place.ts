// Géométrie de la visite guidée, sans DOM : zone éclairée par le projecteur et place de la bulle.
// Isolée pour être testée (et parce que c'est là que se logent les cas limites : cible plus grande
// que l'écran, tiroir de l'éditeur, téléphone).

export interface Rect { top: number; left: number; width: number; height: number }
export interface Size { width: number; height: number }

/** En dessous de cette largeur, la bulle occupe toute la largeur, en haut ou en bas de l'écran. */
export const NARROW = 600;
/** marge entre la cible et la bulle */
const GAP = 14;
/** marge minimale entre la bulle et les bords de l'écran */
const EDGE = 8;

export type Placement =
  | { kind: 'center' }
  | { kind: 'dock'; edge: 'top' | 'bottom' }
  | { kind: 'float'; top: number; left: number; side: 'below' | 'above' | 'right' | 'left' | 'over' };

/** Rectangle englobant de plusieurs rectangles (une cible faite de plusieurs boutons). */
export function unionRect(rects: Rect[]): Rect | null {
  const r = rects.filter(x => x.width > 0 || x.height > 0);
  if (!r.length) return null;
  const top = Math.min(...r.map(x => x.top)), left = Math.min(...r.map(x => x.left));
  const bottom = Math.max(...r.map(x => x.top + x.height)), right = Math.max(...r.map(x => x.left + x.width));
  return { top, left, width: right - left, height: bottom - top };
}

/**
 * Partie visible de `r` dans l'écran, agrandie de `pad` (le projecteur déborde un peu de la cible) ;
 * null si la cible est entièrement hors de l'écran.
 */
export function visibleRect(r: Rect, view: Size, pad = 6): Rect | null {
  const top = Math.max(r.top - pad, 2), left = Math.max(r.left - pad, 2);
  const bottom = Math.min(r.top + r.height + pad, view.height - 2), right = Math.min(r.left + r.width + pad, view.width - 2);
  if (bottom <= top || right <= left) return null;
  return { top, left, width: right - left, height: bottom - top };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(lo, v), Math.max(lo, hi));

/**
 * Place la bulle à côté de la cible (zone visible, déjà agrandie) : dessous, sinon dessus, à droite, à
 * gauche ; si rien ne tient (cible qui remplit l'écran), par-dessus la cible, en bas de l'écran. Sans cible,
 * au centre. Sur écran étroit, la bulle prend toute la largeur, du côté opposé à la cible.
 */
export function placeBubble(target: Rect | null, bubble: Size, view: Size): Placement {
  if (!target) return { kind: 'center' };
  if (view.width < NARROW) {
    const center = target.top + target.height / 2;
    // la bulle du bas cache le bas de l'écran : cible dans la moitié basse → bulle en haut
    return { kind: 'dock', edge: center > view.height / 2 ? 'top' : 'bottom' };
  }
  const { width: bw, height: bh } = bubble;
  const bottom = target.top + target.height, right = target.left + target.width;
  const hx = clamp(target.left + target.width / 2 - bw / 2, EDGE, view.width - bw - EDGE);
  const vy = clamp(target.top + target.height / 2 - bh / 2, EDGE, view.height - bh - EDGE);
  if (bottom + GAP + bh <= view.height - EDGE) return { kind: 'float', side: 'below', top: bottom + GAP, left: hx };
  if (target.top - GAP - bh >= EDGE) return { kind: 'float', side: 'above', top: target.top - GAP - bh, left: hx };
  if (right + GAP + bw <= view.width - EDGE) return { kind: 'float', side: 'right', top: vy, left: right + GAP };
  if (target.left - GAP - bw >= EDGE) return { kind: 'float', side: 'left', top: vy, left: target.left - GAP - bw };
  return { kind: 'float', side: 'over', top: clamp(view.height - bh - 2 * EDGE, EDGE, view.height), left: hx };
}

/**
 * Étapes à montrer : celles sans cible, et celles dont la cible est présente et visible (`present`).
 * Une étape dont la cible manque (option masquée, image absente d'un projet rechargé…) est sautée.
 */
export function presentSteps<T extends { target?: unknown }>(steps: T[], present: (s: T) => boolean): T[] {
  return steps.filter(s => s.target === undefined || present(s));
}
