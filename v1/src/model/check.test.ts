import { describe, expect, test } from 'vitest';
import { assemble } from './assemble';
import { findIssues, timeline } from './check';
import { defaultSettings } from './project-io';
import { analyzed, hasJobs, RAINBOW } from './test-data';
import type { Line, NoteEvent, Project } from './types';

const C4 = { step: 'C' as const, alter: 0, octave: 4 };
let seq = 0;
const n = (measure: number, offset: number, duration: number, extra: Partial<NoteEvent> = {}): NoteEvent =>
  ({ id: `t${seq++}`, measure, offset, duration, pitch: C4, voice: 1, ...extra });

/** Projet construit : nMeasures mesures en 4/4, une ligne par tableau de notes. */
function proj(nMeasures: number, ...notes: NoteEvent[][]): Project {
  const lines: Line[] = notes.map((ns, i) => ({
    id: `${i}|1`, name: `L${i}`, part: i, partName: `L${i}`, staff: 1, clef: { sign: 'G', line: 2 }, notes: ns,
  }));
  return {
    format: 'music-reader', version: 2, title: 't', createdAt: '', pages: [],
    measures: Array.from({ length: nMeasures }, (_, i) =>
      ({ pageKey: 'p', page: 1, local: i, label: String(i + 1), beats: 4, beatType: 4, fifths: 0, mode: 'major' as const })),
    lines, settings: defaultSettings(lines, 't'), review: { lost: [], checked: [] },
  };
}

describe('timeline', () => {
  test('anacrouse, mesure qui déborde, métrique', () => {
    const p = proj(3, [n(0, 0, 1), n(1, 0, 4), n(2, 0, 4), n(2, 4, 1)], [n(0, 0, 0.5)]);
    p.measures[1].beats = 3; p.measures[1].beatType = 8;
    expect(timeline(p)).toEqual([
      { start: 0, len: 1, expected: 4 },
      { start: 1, len: 4, expected: 1.5 },
      { start: 5, len: 5, expected: 4 },
    ]);
  });
  test('mesure 0 vide : pas une anacrouse', () => {
    expect(timeline(proj(2, [n(1, 0, 4)]))[0]).toEqual({ start: 0, len: 4, expected: 4 });
  });
});

describe('findIssues', () => {
  test('vide, rythme, durée nulle, trou ; anacrouse tolérée ; tri', () => {
    const p = proj(4,
      [n(0, 0, 1), n(1, 0, 2), n(1, 2, 2, { voice: 2 }), n(1, 2, 3), n(2, 0, 1), n(2, 2, 2), n(3, 0, 4), n(3, 1, 0)],
      [n(0, 0, 1), n(2, 0, 4), n(3, 0, 1 / 3), n(3, 1 / 3, 1 / 3), n(3, 2 / 3, 1 / 3), n(3, 1, 3)]);
    const got = findIssues(p).map(i => [i.measure, i.lineId, i.kind, i.text]);
    expect(got).toEqual([
      [1, '0|1', 'rhythm', '5 temps au lieu de 4 (+1)'],
      [1, '1|1', 'empty', 'aucune note reconnue'],
      [2, '0|1', 'gap', 'trou de 1 temps au temps 2'],
      [3, '0|1', 'rhythm', 'note de durée nulle'],
    ]);
  });

  test('rythme court, nombres à la française', () => {
    const p = proj(2, [n(0, 0, 4), n(1, 0, 1.5), n(1, 1.5, 1.75)]);
    expect(findIssues(p)).toEqual([{ measure: 1, lineId: '0|1', kind: 'rhythm', text: '3,25 temps au lieu de 4 (−0,75)', checked: false }]);
  });

  test('symboles perdus : regroupés, tus après correction manuelle, mesures validées', () => {
    const p = proj(2, [n(0, 0, 4), n(1, 0, 4)], [n(0, 0, 4), n(1, 0, 4)]);
    p.review.lost = [
      { measure: 0, lineId: '0|1', rest: false, duration: 1 },
      { measure: 1, lineId: '1|1', rest: true, duration: 0.5 },
      { measure: 1, lineId: '1|1', rest: false, duration: 2 },
    ];
    p.review.checked = ['1|1|1'];
    expect(findIssues(p)).toEqual([
      { measure: 0, lineId: '0|1', kind: 'lost', checked: false, text: '1 noire vue par Audiveris mais non placée dans le temps, donc absente' },
      { measure: 1, lineId: '1|1', kind: 'lost', checked: true,
        text: '2 symboles vus par Audiveris mais non placés dans le temps (silence de croche, blanche), donc absents' },
    ]);
    p.lines[0].notes[0].manual = true;
    expect(findIssues(p).map(i => i.measure)).toEqual([1]);
  });

  test('rapide sur une grande partition', () => {
    const notes: NoteEvent[] = [];
    for (let m = 0; m < 2000; m++) for (let k = 0; k < 8; k++) notes.push(n(m, k / 2, 0.5));
    const p = proj(2000, notes, notes.map(x => ({ ...x })), notes.map(x => ({ ...x })));
    const t = performance.now();
    expect(findIssues(p)).toEqual([]);
    expect(performance.now() - t).toBeLessThan(200);
  });
});

describe.skipIf(!hasJobs)('findIssues — Over The Rainbow', () => {
  test('page 1 : mesures 3, 11 et 16 signalées, avec les notes jetées par Audiveris', () => {
    const { project: p } = assemble([analyzed(RAINBOW.p1)], null);
    const issues = findIssues(p);
    const label = (i: { measure: number }) => p.measures[i.measure].label;
    expect([...new Set(issues.map(label))]).toEqual(['3', '11', '16']);
    const lost = issues.filter(i => i.kind === 'lost').map(i => `${label(i)} ${i.lineId} ${i.text}`);
    expect(lost).toEqual([
      '3 1|1 1 noire vue par Audiveris mais non placée dans le temps, donc absente',
      '11 1|1 1 noire vue par Audiveris mais non placée dans le temps, donc absente',
      '16 1|1 2 symboles vus par Audiveris mais non placés dans le temps (silence de croche, silence de noire), donc absents',
      '16 1|2 2 symboles vus par Audiveris mais non placés dans le temps (noire, noire), donc absents',
    ]);
    expect(issues.filter(i => i.kind === 'rhythm').map(i => `${label(i)} ${i.lineId} ${i.text}`)).toEqual([
      '3 1|1 5 temps au lieu de 4 (+1)', '3 1|2 5 temps au lieu de 4 (+1)',
      '11 1|1 5 temps au lieu de 4 (+1)', '11 1|2 5 temps au lieu de 4 (+1)',
      '16 0|1 3,5 temps au lieu de 4 (−0,5)', '16 1|1 5 temps au lieu de 4 (+1)', '16 1|2 2 temps au lieu de 4 (−2)',
    ]);
  });

  test('trois pages assemblées : la métrique de la page 1 sert aux pages de suite', () => {
    const { project: p } = assemble([analyzed(RAINBOW.p1, 'a'), analyzed(RAINBOW.p2, 'b'), analyzed(RAINBOW.p3, 'c')], null);
    const bad = new Set(findIssues(p).filter(i => i.kind === 'rhythm' || i.kind === 'empty').map(i => i.measure));
    const perPage = [1, 2, 3].map(pg => [...bad].filter(m => p.measures[m].page === pg).length);
    expect(perPage).toEqual([3, 5, 2]);
    const t = timeline(p);
    expect(t).toHaveLength(40);
    expect(t[39].start + t[39].len).toBe(165.5);   // 160 temps + les débordements
  });
});
