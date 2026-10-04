import { describe, expect, it } from 'vitest';
import type { Line, MeasureTime, NoteEvent, Pitch, Project, Step } from '../model/types';
import { clampTempo, lineSettingsOf, measureAt, perform, totalBeats } from './perform';

let seq = 0;
const P = (code: string): Pitch => {
  const m = /^([A-G])([#b]?)(\d)$/.exec(code)!;
  return { step: m[1] as Step, alter: m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0, octave: +m[3] };
};
const N = (measure: number, offset: number, duration: number, pitch: string | null, extra: Partial<NoteEvent> = {}): NoteEvent =>
  ({ id: `n${++seq}`, measure, offset, duration, pitch: pitch ? P(pitch) : null, voice: 1, ...extra });

const line = (id: string, notes: NoteEvent[], sign: 'G' | 'F' = 'G'): Line =>
  ({ id, name: id, part: 0, partName: 'P', staff: 1, clef: { sign, line: sign === 'G' ? 2 : 4 }, notes });

/** mesures en 4/4 consécutives */
const bars = (n: number, len = 4): MeasureTime[] =>
  Array.from({ length: n }, (_, i) => ({ start: i * len, len, expected: len }));

function project(lines: Line[], settings: Partial<Project['settings']> = {}): Project {
  return {
    format: 'music-reader', version: 2, title: 'Test', createdAt: '2026-01-01T00:00:00Z', pages: [],
    measures: [], lines,
    settings: {
      tempo: 100, transpose: 0, loop: false,
      lines: Object.fromEntries(lines.map(l => [l.id, { enabled: true, instrument: 'piano' as const, volume: 0.8 }])),
      print: { lines: [], lyrics: true, verses: [], title: 'Test', keepLayout: false },
      ...settings,
    },
    review: { lost: [], checked: [] },
  };
}

describe('perform', () => {
  it('place les notes à temps absolu et ignore silences et durées nulles', () => {
    const p = project([line('0|1', [
      N(0, 0, 1, 'C4'), N(0, 1, 1, null), N(0, 2, 2, 'E4'), N(0, 2, 0, 'D4'),   // grâce : durée nulle
      N(1, 0, 4, 'G4'),
    ])]);
    const ev = perform(p, bars(2));
    expect(ev.map(e => [e.midi, e.start, e.dur])).toEqual([[60, 0, 1], [64, 2, 2], [67, 4, 4]]);
    expect(ev[0]).toMatchObject({ lineId: '0|1', instrument: 'piano', volume: 0.8 });
  });

  it('suit le placement des mesures donné par la timeline (anacrouse)', () => {
    const p = project([line('a', [N(0, 0, 1, 'G4'), N(1, 0, 4, 'C5')])]);
    const times: MeasureTime[] = [{ start: 0, len: 1, expected: 4 }, { start: 1, len: 4, expected: 4 }];
    expect(perform(p, times).map(e => e.start)).toEqual([0, 1]);
    expect(totalBeats(times)).toBe(5);
  });

  it('fusionne les notes liées, y compris en chaîne et par-dessus la barre de mesure', () => {
    const p = project([line('a', [
      N(0, 0, 2, 'C4'), N(0, 2, 2, 'F4', { tie: true }),
      N(1, 0, 4, 'F4', { tie: true }),
      N(2, 0, 1, 'F4'), N(2, 1, 1, 'F4'),   // la dernière n'est pas liée : rejouée
    ])]);
    const ev = perform(p, bars(3));
    expect(ev.map(e => [e.midi, e.start, e.dur])).toEqual([[60, 0, 2], [65, 2, 7], [65, 9, 1]]);
  });

  it('lie la bonne note dans un accord', () => {
    const p = project([line('a', [
      N(0, 0, 2, 'C4', { tie: true }), N(0, 0, 2, 'E4'),
      N(0, 2, 2, 'C4'), N(0, 2, 2, 'E4'),
    ])]);
    const ev = perform(p, bars(1));
    expect(ev.map(e => [e.midi, e.start, e.dur])).toEqual([[60, 0, 4], [64, 0, 2], [64, 2, 2]]);
  });

  it('raccorde une liaison à la mesure suivante quand le rythme de la mesure est faux', () => {
    // mesure 0 : 3 temps seulement sur 4 ; la note liée finit au temps 3, sa suite commence au temps 4
    const p = project([line('a', [N(0, 0, 1, 'D4'), N(0, 1, 2, 'A4', { tie: true }), N(1, 0, 2, 'A4')])]);
    const ev = perform(p, bars(2));
    expect(ev.map(e => [e.midi, e.start, e.dur])).toEqual([[62, 0, 1], [69, 1, 5]]);
  });

  it('abandonne une liaison sans suite', () => {
    const p = project([line('a', [N(0, 0, 1, 'C4', { tie: true }), N(0, 1, 1, 'D4'), N(0, 2, 1, 'C4')])]);
    const ev = perform(p, bars(1));
    expect(ev.map(e => [e.midi, e.start, e.dur])).toEqual([[60, 0, 1], [62, 1, 1], [60, 2, 1]]);
  });

  it('transpose et applique les réglages de ligne', () => {
    const a = line('a', [N(0, 0, 4, 'C4')]);
    const b = line('b', [N(0, 0, 4, 'C3')], 'F');
    const p = project([a, b], { transpose: -3 });
    p.settings.lines.b = { enabled: true, instrument: 'cordes', volume: 0.5 };
    const ev = perform(p, bars(1));
    expect(ev.map(e => [e.lineId, e.midi, e.instrument, e.volume])).toEqual([
      ['b', 45, 'cordes', 0.5], ['a', 57, 'piano', 0.8],
    ]);
    expect(perform(p, bars(1), { transpose: 12 }).map(e => e.midi)).toEqual([60, 72]);
  });

  it('exclut les lignes désactivées, sauf la ligne demandée seule', () => {
    const p = project([line('a', [N(0, 0, 4, 'C4')]), line('b', [N(0, 0, 4, 'E4')])]);
    p.settings.lines.b.enabled = false;
    expect(perform(p, bars(1)).map(e => e.lineId)).toEqual(['a']);
    expect(perform(p, bars(1), { only: 'b' }).map(e => e.lineId)).toEqual(['b']);
    p.settings.lines.a.enabled = false;
    expect(perform(p, bars(1))).toEqual([]);
  });

  it('borne la lecture : notes écourtées à la fin, notes en cours reprises au début', () => {
    const p = project([line('a', [
      N(0, 0, 3, 'C4'), N(0, 3, 0.1, 'D4'), N(0, 3.1, 0.9, 'E4', { tie: true }),
      N(1, 0, 2, 'E4'), N(1, 2, 2, 'G4'),
    ])]);
    const ev = perform(p, bars(2), { from: 2, to: 6 });
    // C4 reprise pour son dernier temps ; E4 (lié) coupé à la borne ; G4, qui commence à la borne, exclu
    expect(ev.map(e => [e.midi, e.start, +e.dur.toFixed(6)])).toEqual([[60, 2, 1], [62, 3, 0.1], [64, 3.1, 2.9]]);
    // un reste trop court n'est pas rejoué
    expect(perform(p, bars(2), { from: 2.9 }).map(e => e.midi)).toEqual([62, 64, 67]);
    // une mesure seule
    expect(perform(p, bars(2), { from: 4, to: 8 }).map(e => [e.midi, e.start, e.dur])).toEqual([[64, 4, 2], [67, 6, 2]]);
  });

  it('ignore les notes de mesures inconnues de la timeline', () => {
    const p = project([line('a', [N(0, 0, 4, 'C4'), N(5, 0, 4, 'D4')])]);
    expect(perform(p, bars(1)).map(e => e.midi)).toEqual([60]);
  });
});

describe('outils', () => {
  it('measureAt trouve la mesure contenant une position', () => {
    const t = bars(3);
    expect(measureAt(t, 0)).toBe(0);
    expect(measureAt(t, 3.99)).toBe(0);
    expect(measureAt(t, 4)).toBe(1);
    expect(measureAt(t, 100)).toBe(2);
    expect(measureAt([], 0)).toBe(-1);
  });

  it('lineSettingsOf donne des réglages par défaut aux lignes inconnues', () => {
    const p = project([]);
    expect(lineSettingsOf(p.settings, line('x', [], 'F'))).toEqual({ enabled: true, instrument: 'cordes', volume: 0.8 });
    expect(lineSettingsOf(p.settings, line('y', []))).toMatchObject({ instrument: 'piano' });
  });

  it('clampTempo borne et arrondit', () => {
    expect(clampTempo(10)).toBe(30);
    expect(clampTempo(300)).toBe(240);
    expect(clampTempo(99.6)).toBe(100);
    expect(clampTempo(NaN)).toBe(100);
  });
});
