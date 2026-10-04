import { describe, expect, test } from 'vitest';
import { assemble, type AnalyzedPage } from './assemble';
import { findIssues } from './check';
import { analyzed, hasJobs, RAINBOW } from './test-data';
import type { Clef, Line, NoteEvent, PageScore, Project } from './types';

const G: Clef = { sign: 'G', line: 2 }, F: Clef = { sign: 'F', line: 4 };

/** Page construite : `lines` = [id, clé, notes par mesure (hauteurs en octave 4, une ronde chacune)] */
function page(key: string, nMeasures: number, lines: [string, Clef, string[]][], opts: Partial<PageScore> = {}): AnalyzedPage {
  const ls: Line[] = lines.map(([id, clef, steps]) => {
    const [part, staff] = id.split('|').map(Number);
    return {
      id, name: id, part, partName: `P${part}`, staff, clef,
      notes: steps.map((s, m): NoteEvent => ({
        id: `${m}.${id}.0`, measure: m, offset: 0, duration: 4, voice: 1,
        pitch: s === '-' ? null : { step: s as 'C', alter: 0, octave: 4 },
      })).slice(0, nMeasures),
    };
  });
  const score: PageScore = {
    title: '', staves: [], hasTime: true, hasKey: true, lines: ls,
    measures: Array.from({ length: nMeasures }, (_, i) => ({ local: i, label: String(i + 1), beats: 4, beatType: 4, fifths: 0, mode: 'major' })),
    ...opts,
  };
  if (!opts.staves) {
    const parts = new Map<number, number>();
    ls.forEach(l => parts.set(l.part, Math.max(parts.get(l.part) ?? 0, l.staff)));
    score.staves = [...parts.keys()].sort().map(p => parts.get(p)!);
  }
  return { key, name: `${key}.png`, font: 'Leland', scale: 1, score, unplaced: [] };
}

const stepsOf = (p: Project, lineId: string) =>
  p.lines.find(l => l.id === lineId)!.notes.map(n => `${n.measure}:${n.pitch?.step ?? '-'}`).join(' ');

describe('assemble — cas construits', () => {
  test('mesures globales, métrique et armure héritées, avertissement 4/4', () => {
    const a = page('a', 2, [['0|1', G, ['C', 'D']]], { hasTime: false, hasKey: true, title: '' });
    a.score.measures.forEach(m => { m.fifths = -2; });
    const b = page('b', 2, [['0|1', G, ['E', 'F']]], { hasTime: true, hasKey: false });
    b.score.measures.forEach(m => { m.beats = 3; });
    const c = page('c', 1, [['0|1', G, ['G']]], { hasTime: false, hasKey: false });
    const { project: p, warnings } = assemble([a, b, c], null);
    expect(p.measures.map(m => `${m.pageKey}${m.page}.${m.local}.${m.label} ${m.beats}/${m.beatType} ${m.fifths}`)).toEqual([
      'a1.0.1 4/4 -2', 'a1.1.2 4/4 -2', 'b2.0.1 3/4 -2', 'b2.1.2 3/4 -2', 'c3.0.1 3/4 -2',
    ]);
    expect(p.measures.map(m => !!m.newPage)).toEqual([false, false, true, false, true]);
    expect(warnings).toEqual(['Page 1 : aucune métrique indiquée, 4/4 supposé.']);
    expect(stepsOf(p, '0|1')).toBe('0:C 1:D 2:E 3:F 4:G');
    expect(p.title).toBe('a');
    expect(p.pages).toEqual([{ key: 'a', name: 'a.png', font: 'Leland', scale: 1 }, { key: 'b', name: 'b.png', font: 'Leland', scale: 1 }, { key: 'c', name: 'c.png', font: 'Leland', scale: 1 }]);
    expect(p.settings.tempo).toBe(100);
    expect(new Set(p.lines[0].notes.map(n => n.id)).size).toBe(5);
  });

  test('lignes différentes d\'une page à l\'autre, clés raccordées', () => {
    const a = page('a', 1, [['0|1', G, ['C']], ['1|1', G, ['C']]]);
    const b = page('b', 1, [['0|1', G, ['D']], ['1|1', F, ['D']], ['1|2', F, ['D']]]);
    b.score.lines[0].clefChanges = [{ measure: 0, offset: 2, clef: F }];
    const { project: p, warnings } = assemble([a, b], null);
    expect(p.lines.map(l => l.id)).toEqual(['0|1', '1|1', '1|2']);
    expect(warnings).toEqual(['Page 2 : lignes détectées différentes de la page 1 (3 au lieu de 2). Le raccord se fait par position.']);
    expect(p.lines[0].clefChanges).toEqual([{ measure: 1, offset: 2, clef: F }]);
    expect(p.lines[1].clef).toEqual(G);
    expect(p.lines[1].clefChanges).toEqual([{ measure: 1, offset: 0, clef: F }]);
    expect(p.lines[2].clef).toEqual(F);
    expect(stepsOf(p, '1|2')).toBe('1:D');
    expect(Object.keys(p.settings.lines)).toEqual(['0|1', '1|1', '1|2']);
    expect(p.settings.lines['1|2'].instrument).toBe('cordes');
  });

  test('symboles perdus : portée de page → ligne, mesure par libellé, doublons', () => {
    const a = page('a', 3, [['0|1', G, ['C', 'C', 'C']], ['1|1', G, ['C', 'C', 'C']], ['1|2', F, ['C', 'C', 'C']]]);
    a.score.measures[2].label = '7';
    a.unplaced = [
      { measure: '2', part: 2, rest: false, id: '1', staff: 5, dur: [1, 4] },    // portée 5 = 2e système, piano main droite
      { measure: '2', part: 2, rest: false, id: '1', staff: 5, dur: [1, 4] },
      { measure: '7', part: 2, rest: true, id: '2', staff: 6, dur: [1, 8] },
      { measure: '7', part: 2, rest: false, id: '3', staff: 1, dur: [1, 2] },    // la partie d'Audiveris l'emporte
      { measure: '9', part: null, rest: false, id: '4', staff: 1, dur: [1, 4] },  // mesure inconnue
    ];
    const { project: p } = assemble([page('z', 2, [['0|1', G, ['C', 'C']], ['1|1', G, ['C', 'C']], ['1|2', F, ['C', 'C']]]), a], null);
    expect(p.review.lost).toEqual([
      { measure: 3, lineId: '1|1', rest: false, duration: 1 },
      { measure: 4, lineId: '1|2', rest: true, duration: 0.5 },
      { measure: 4, lineId: '1|1', rest: false, duration: 2 },
    ]);
  });

  test('réassemblage : corrections manuelles, paroles, mesures validées et réglages survivent au réordonnancement', () => {
    const a = page('a', 2, [['0|1', G, ['C', 'D']], ['1|1', F, ['C', 'D']]]);
    const b = page('b', 2, [['0|1', G, ['E', 'F']], ['1|1', F, ['E', 'F']]]);
    const first = assemble([a, b], null).project;
    // l'utilisateur corrige la mesure 2 de la page b (ligne 0|1), une parole en page a, valide une mesure
    const l0 = first.lines[0];
    l0.notes = l0.notes.filter(n => n.measure !== 3);
    l0.notes.push({ id: 'n1', measure: 3, offset: 0, duration: 2, pitch: { step: 'A', alter: -1, octave: 4 }, voice: 1, manual: true },
                  { id: 'n2', measure: 3, offset: 2, duration: 2, pitch: null, voice: 1, manual: true });
    l0.notes[0].lyrics = [{ verse: 1, text: 'Là', manual: true }];
    first.review.checked = ['1|1|1', '2|0|1'];
    first.title = 'Mon titre';
    first.settings.tempo = 72;
    first.settings.lines['1|1'] = { enabled: false, instrument: 'orgue', volume: 0.3 };
    first.settings.print.lines = ['1|1', 'x|9'];

    // réanalyse (la page a gagne une portée) et inversion des pages
    const a2 = page('a', 2, [['0|1', G, ['C', 'D']], ['1|1', F, ['C', 'D']], ['1|2', F, ['C', 'D']]]);
    const { project: p } = assemble([b, a2], first);
    expect(p.measures.map(m => `${m.pageKey}${m.local}`)).toEqual(['b0', 'b1', 'a0', 'a1']);
    expect(stepsOf(p, '0|1')).toBe('0:E 1:A 1:- 2:C 3:D');
    const fixed = p.lines[0].notes.filter(n => n.measure === 1);
    expect(fixed.map(n => [n.id, n.manual, n.offset])).toEqual([['n1', true, 0], ['n2', true, 2]]);
    expect(p.lines[0].notes.find(n => n.measure === 2)!.lyrics).toEqual([{ verse: 1, text: 'Là', manual: true }]);
    expect(p.review.checked.sort()).toEqual(['0|0|1', '3|1|1']);
    expect(p.title).toBe('Mon titre');
    expect(p.settings.tempo).toBe(72);
    expect(p.settings.lines['1|1']).toEqual({ enabled: false, instrument: 'orgue', volume: 0.3 });
    expect(p.settings.lines['1|2']).toEqual({ enabled: true, instrument: 'cordes', volume: 0.8 });
    expect(p.settings.print.lines).toEqual(['1|1']);
    expect(p.createdAt).toBe(first.createdAt);
    const ids = p.lines.flatMap(l => l.notes.map(n => n.id));
    expect(new Set(ids).size).toBe(ids.length);

    // page supprimée : son contenu disparaît, les corrections des autres pages restent
    const { project: q, warnings } = assemble([b], p);
    expect(stepsOf(q, '0|1')).toBe('0:E 1:A 1:-');
    expect(q.review.checked).toEqual(['0|0|1']);
    expect(warnings).toEqual([]);
  });

  test('correction manuelle sur une mesure qui n\'existe plus : avertissement', () => {
    const first = assemble([page('a', 2, [['0|1', G, ['C', 'D']]])], null).project;
    first.lines[0].notes[1].manual = true;
    const { warnings } = assemble([page('a', 1, [['0|1', G, ['C']]])], first);
    expect(warnings).toEqual(['Page 1, mesure 2 : correction manuelle perdue, la nouvelle analyse n\'a plus cette mesure.']);
  });
});

describe.skipIf(!hasJobs)('assemble — Over The Rainbow (v0/jobs)', () => {
  const pages = () => [analyzed(RAINBOW.p1, 'p1', 'rainbow-1.jpg'), analyzed(RAINBOW.p2, 'p2', 'rainbow-2.jpg'), analyzed(RAINBOW.p3, 'p3', 'rainbow-3.jpg')];

  test('trois pages : 40 mesures, 3 lignes, 4/4 hérité, symboles perdus rattachés', () => {
    const { project: p, warnings } = assemble(pages(), null);
    expect(warnings).toEqual([]);
    expect(p.title).toBe('Over The Rainbow');
    expect(p.measures).toHaveLength(17 + 15 + 8);
    expect(p.measures.every(m => m.beats === 4 && m.beatType === 4 && m.fifths === 0)).toBe(true);
    expect(p.lines.map(l => l.name)).toEqual(['Voice', 'Piano — portée 1', 'Piano — portée 2']);
    expect(p.review.lost.map(s => `${p.measures[s.measure].label}/${s.lineId}/${s.rest ? 'silence' : 'note'}/${s.duration}`)).toEqual([
      '3/1|1/note/1', '11/1|1/note/1', '16/1|2/note/1', '16/1|1/silence/0.5', '16/1|1/silence/1', '16/1|2/note/1',
    ]);
    const ids = p.lines.flatMap(l => l.notes.map(n => n.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(p.lines.every(l => l.notes.every((n, i, a) => i === 0 || a[i - 1].measure <= n.measure))).toBe(true);
  });

  test('pages réordonnées après correction : la correction et la validation suivent leur page', () => {
    const first = assemble(pages(), null).project;
    // mesure 3 de la page 1, main droite : on remet la noire jetée par Audiveris
    const g = first.measures.findIndex(m => m.pageKey === 'p1' && m.label === '3');
    const rh = first.lines.find(l => l.id === '1|1')!;
    const kept = rh.notes.filter(n => n.measure === g).map(n => ({ ...n, manual: true }));
    rh.notes = [...rh.notes.filter(n => n.measure !== g), ...kept];
    first.review.checked = [`${g}|0|1`];
    expect(findIssues(first).some(i => i.measure === g && i.kind === 'lost')).toBe(false);

    const [p1, p2, p3] = pages();
    const { project: p } = assemble([p3, p1, p2], first);
    const g2 = p.measures.findIndex(m => m.pageKey === 'p1' && m.label === '3');
    expect(g2).toBe(8 + 2);
    expect(p.lines.find(l => l.id === '1|1')!.notes.filter(n => n.measure === g2).every(n => n.manual)).toBe(true);
    expect(p.review.checked).toEqual([`${g2}|0|1`]);
    const lostAt = findIssues(p).filter(i => i.kind === 'lost').map(i => p.measures[i.measure].label);
    expect(lostAt).toEqual(['11', '16', '16']);
  });
});
