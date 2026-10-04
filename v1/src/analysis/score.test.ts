// Choix de la police sur des mesures réelles (extraits de deux systèmes, Audiveris 5.11, oct. 2026).
import { describe, expect, it } from 'vitest';
import { fontScore, pickFont, type TrialMetrics } from './score';

type T = TrialMetrics & { font: string };
const t = (font: string, measures: number, lines: number, notes: number, bad: number, lost: number): T =>
  ({ font, measures, lines, notes, bad, lost });

describe('note des polices', () => {
  it('Over The Rainbow p. 1 : Leland (Bravura perd les rondes)', () => {
    const trials = [t('Leland', 8, 3, 125, 2, 1), t('Bravura', 8, 3, 117, 3, 1), t('FinaleJazz', 8, 3, 116, 3, 1),
                    t('Primus', 8, 3, 124, 2, 1), t('MusicalSymbols', 8, 3, 121, 2, 1)];
    expect(pickFont(trials, 'Leland')!.font).toBe('Leland');
    expect(fontScore(trials[0])).toBeGreaterThan(fontScore(trials[1]));
  });

  it('Fly Me To The Moon : Finale Jazz (toutes les barres de mesure)', () => {
    const trials = [t('Leland', 7, 1, 30, 2, 0), t('Bravura', 7, 1, 30, 3, 0), t('FinaleJazz', 8, 1, 33, 3, 0),
                    t('Primus', 7, 1, 28, 3, 0), t('MusicalSymbols', 7, 1, 30, 4, 0)];
    expect(pickFont(trials, 'Leland')!.font).toBe('FinaleJazz');
  });

  it('Fortunio p. 1 : à structure égale, la police par défaut est gardée', () => {
    const trials = [t('Leland', 9, 2, 50, 15, 0), t('Bravura', 9, 2, 51, 15, 0), t('FinaleJazz', 9, 2, 50, 17, 0),
                    t('Primus', 9, 2, 51, 15, 0), t('MusicalSymbols', 9, 2, 52, 17, 0)];
    expect(pickFont(trials, 'Leland')!.font).toBe('Leland');
    // sans la police par défaut, les notes départagent, puis l'ordre des essais
    expect(pickFont(trials.slice(1), 'Leland')!.font).toBe('Bravura');
  });

  it('aucun essai', () => {
    expect(pickFont([], 'Leland')).toBeNull();
  });
});
