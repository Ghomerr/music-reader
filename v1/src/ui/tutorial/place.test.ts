import { describe, expect, it } from 'vitest';
import { placeBubble, presentSteps, unionRect, visibleRect } from './place';

const view = { width: 1280, height: 800 };
const bubble = { width: 420, height: 180 };

describe('placeBubble', () => {
  it('centre la bulle sans cible', () => {
    expect(placeBubble(null, bubble, view)).toEqual({ kind: 'center' });
  });

  it('place la bulle sous la cible, centrée sur elle', () => {
    const p = placeBubble({ top: 100, left: 400, width: 200, height: 40 }, bubble, view);
    expect(p).toEqual({ kind: 'float', side: 'below', top: 154, left: 290 });
  });

  it('passe au-dessus quand la place manque en dessous (tiroir, bas de page)', () => {
    const p = placeBubble({ top: 600, left: 400, width: 200, height: 150 }, bubble, view);
    expect(p).toMatchObject({ kind: 'float', side: 'above', top: 600 - 14 - 180 });
  });

  it('se met à côté d\'une cible haute, sans sortir de l\'écran', () => {
    const p = placeBubble({ top: 60, left: 900, width: 360, height: 700 }, bubble, view);
    expect(p).toMatchObject({ kind: 'float', side: 'left', left: 900 - 14 - 420 });
    if (p.kind === 'float') expect(p.top).toBeGreaterThanOrEqual(8);
  });

  it('se pose en bas, par-dessus une cible qui remplit l\'écran', () => {
    const p = placeBubble({ top: 2, left: 2, width: 1276, height: 796 }, bubble, view);
    expect(p).toMatchObject({ kind: 'float', side: 'over', top: 800 - 180 - 16 });
  });

  it('reste dans l\'écran près d\'un bord', () => {
    const p = placeBubble({ top: 20, left: 1200, width: 60, height: 30 }, bubble, view);
    expect(p).toMatchObject({ kind: 'float', side: 'below', left: 1280 - 420 - 8 });
  });

  it('prend toute la largeur sur écran étroit, du côté opposé à la cible', () => {
    const phone = { width: 390, height: 800 };
    expect(placeBubble({ top: 600, left: 0, width: 390, height: 100 }, bubble, phone)).toEqual({ kind: 'dock', edge: 'top' });
    expect(placeBubble({ top: 100, left: 0, width: 390, height: 100 }, bubble, phone)).toEqual({ kind: 'dock', edge: 'bottom' });
  });
});

describe('rectangles', () => {
  it('englobe plusieurs boutons et ignore les boîtes vides', () => {
    expect(unionRect([
      { top: 10, left: 10, width: 40, height: 40 },
      { top: 10, left: 60, width: 40, height: 50 },
      { top: 0, left: 0, width: 0, height: 0 },
    ])).toEqual({ top: 10, left: 10, width: 90, height: 50 });
    expect(unionRect([])).toBeNull();
  });

  it('ne garde que la partie visible, agrandie de la marge', () => {
    expect(visibleRect({ top: 100, left: 100, width: 50, height: 20 }, view)).toEqual({ top: 94, left: 94, width: 62, height: 32 });
    expect(visibleRect({ top: -500, left: 0, width: 100, height: 2000 }, view)).toEqual({ top: 2, left: 2, width: 104, height: 796 });
    expect(visibleRect({ top: 900, left: 0, width: 100, height: 50 }, view)).toBeNull();
  });
});

describe('presentSteps', () => {
  it('saute les étapes dont la cible manque, garde celles sans cible', () => {
    const steps = [{ title: 'a' }, { title: 'b', target: '.x' }, { title: 'c', target: '.y' }];
    expect(presentSteps(steps, s => s.target === '.y').map(s => s.title)).toEqual(['a', 'c']);
  });
});
