import { describe, expect, test } from 'vitest';
import { createBlankProject } from './blank';
import { findIssues } from './check';
import { copyMeasure, deleteMeasure, hasNotes, insertMeasure, isAddedMeasure, measureOrigin, parseMeasureList } from './measures';
import { parseProject, serializeProject } from './project-io';
import type { NoteEvent, Project } from './types';

const C5 = { step: 'C' as const, alter: 0, octave: 5 };

/** Partition vierge chant + piano de 4 mesures en 3/4, une note par mesure dans le chant. */
function sample(): Project {
  const p = createBlankProject({ title: 'T', beats: 3, beatType: 4, fifths: 1, mode: 'major', measures: 4, formation: 'chant-piano', createdAt: '2026-10-31T09:00:00.000Z' });
  const chant = p.lines[0];
  chant.notes = [0, 1, 2, 3].map((m): NoteEvent => ({ id: `c${m}`, measure: m, offset: 0, duration: 3, pitch: { ...C5, octave: 4 + (m % 2) }, voice: 1, manual: true }));
  p.lines[2].clefChanges = [{ measure: 2, offset: 1, clef: { sign: 'G', line: 2 } }];
  p.review.checked = ['1|0|1', '3|1|2'];
  p.review.lost = [{ measure: 3, lineId: '1|1', rest: false, duration: 1 }];
  return p;
}

const measuresOf = (p: Project, lineId: string) => p.lines.find(l => l.id === lineId)!.notes.map(n => n.measure);

describe('insertMeasure', () => {
  test('nouvelle mesure au milieu : tout ce qui suit est décalé', () => {
    const p = sample();
    expect(insertMeasure(p, 2, 'ajout-x')).toBe(2);
    expect(p.measures).toHaveLength(5);
    expect(p.measures[2]).toMatchObject({ pageKey: 'ajout-x', local: 0, beats: 3, beatType: 4, fifths: 1, mode: 'major' });
    expect(isAddedMeasure(p.measures[2])).toBe(true);
    expect(measuresOf(p, '0|1')).toEqual([0, 1, 2, 3, 4]);
    const chant = p.lines[0].notes;
    expect(chant[2]).toMatchObject({ measure: 2, pitch: null, duration: 3, voice: 1 });
    expect(chant[3]).toMatchObject({ id: 'c2', measure: 3 });
    expect(p.lines[2].clefChanges).toEqual([{ measure: 3, offset: 1, clef: { sign: 'G', line: 2 } }]);
    expect(p.review.checked).toEqual(['1|0|1', '4|1|2']);
    expect(p.review.lost[0].measure).toBe(4);
    // une mesure neuve ne signale rien ; le symbole perdu suit sa mesure
    expect(findIssues(p).filter(i => !i.checked).map(i => `${i.measure} ${i.kind}`)).toEqual(['4 lost']);
    // le projet reste valide et se relit à l'identique
    const again = parseProject(serializeProject(p));
    expect(serializeProject(again)).toBe(serializeProject(p));
  });

  test('au début et à la fin', () => {
    const p = sample();
    insertMeasure(p, 0, 'ajout-a');
    insertMeasure(p, 99, 'ajout-b');
    expect(p.measures.map(m => m.pageKey)).toEqual(['ajout-a', 'vierge', 'vierge', 'vierge', 'vierge', 'ajout-b']);
    expect(measuresOf(p, '1|2')).toEqual([0, 1, 2, 3, 4, 5]);
    expect(p.lines[0].notes.map(n => n.id).slice(0, 2)).toEqual(['ajout-a.0.0|1.0', 'c0']);
    expect(findIssues(p).filter(i => !i.checked).map(i => i.kind)).toEqual(['lost']);
  });

  test('métrique de la mesure précédente', () => {
    const p = sample();
    p.measures[2] = { ...p.measures[2], beats: 4 };
    insertMeasure(p, 2);
    expect(p.measures[2].beats).toBe(3);
    insertMeasure(p, 4);
    expect(p.measures[4].beats).toBe(4);
    expect(p.lines[1].notes.find(n => n.measure === 4)!.duration).toBe(4);
  });
});

describe('deleteMeasure', () => {
  test('retire la mesure et ses notes, recale la suite', () => {
    const p = sample();
    expect(deleteMeasure(p, 1)).toBe(true);
    expect(p.measures.map(m => m.label)).toEqual(['1', '3', '4']);
    expect(p.lines[0].notes.map(n => `${n.id}@${n.measure}`)).toEqual(['c0@0', 'c2@1', 'c3@2']);
    expect(p.review.checked).toEqual(['2|1|2']);
    expect(p.review.lost[0].measure).toBe(2);
  });

  test('un changement de clé de la mesure supprimée passe au début de la suivante', () => {
    const p = sample();
    deleteMeasure(p, 2);
    expect(p.lines[2].clefChanges).toEqual([{ measure: 2, offset: 0, clef: { sign: 'G', line: 2 } }]);
    const q = sample();
    q.lines[2].clefChanges = [{ measure: 0, offset: 2, clef: { sign: 'C', line: 3 } }];
    deleteMeasure(q, 0);
    expect(q.lines[2].clef).toEqual({ sign: 'C', line: 3 });
    expect(q.lines[2].clefChanges).toBeUndefined();
    const r = sample();
    deleteMeasure(r, 3);
    deleteMeasure(r, 2);
    expect(r.lines[2].clefChanges).toBeUndefined();
  });

  test('début de système reporté ; refuse la dernière mesure', () => {
    const p = sample();
    p.measures[1].newSystem = true;
    deleteMeasure(p, 1);
    expect(p.measures[1].newSystem).toBe(true);
    while (p.measures.length > 1) expect(deleteMeasure(p, 0)).toBe(true);
    expect(deleteMeasure(p, 0)).toBe(false);
    expect(p.measures).toHaveLength(1);
    // reste l'ancienne mesure 4, avec son symbole perdu
    expect(findIssues(p).filter(i => !i.checked).map(i => `${i.measure} ${i.kind}`)).toEqual(['0 lost']);
  });

  test('insérer puis supprimer revient au projet de départ', () => {
    const p = sample();
    const before = serializeProject(p);
    deleteMeasure(p, insertMeasure(p, 3));
    expect(serializeProject(p)).toBe(before);
  });
});

test('hasNotes, measureOrigin', () => {
  const p = sample();
  expect(hasNotes(p, 0)).toBe(true);
  insertMeasure(p, 1);
  expect(hasNotes(p, 1)).toBe(false);
  expect(measureOrigin(p, p.measures[0])).toBeNull();
  expect(measureOrigin(p, p.measures[1])).toBeNull();
  const analysed = { pages: [{ key: 'vierge', name: 'p.png', font: 'Leland', scale: 1 }] };
  expect(measureOrigin(analysed, p.measures[2])).toBe('page 1, mesure 2');
  expect(measureOrigin(analysed, p.measures[1])).toBe('ajoutée');
});

describe('copyMeasure', () => {
  const E4 = { step: 'E' as const, alter: 0, octave: 4 };
  /** chant : deux notes avec paroles en mesure 0 ; mesures 1 et 2 : une note avec sa propre parole */
  function song(): Project {
    const p = sample();
    const chant = p.lines[0];
    chant.notes = [
      { id: 'a', measure: 0, offset: 0, duration: 2, pitch: C5, voice: 1, lyrics: [{ verse: 1, text: 'Au', syllabic: 'single' }] },
      { id: 'b', measure: 0, offset: 2, duration: 1, pitch: E4, voice: 1, tie: true, lyrics: [{ verse: 1, text: 'clair', syllabic: 'single' }] },
      { id: 'c', measure: 1, offset: 0, duration: 3, pitch: E4, voice: 1, lyrics: [{ verse: 1, text: 'mon', syllabic: 'single' }] },
      { id: 'd', measure: 2, offset: 0, duration: 3, pitch: E4, voice: 1 },
      { id: 'e', measure: 3, offset: 0, duration: 3, pitch: C5, voice: 1 },
    ];
    p.review.checked = ['1|0|1', '2|1|1'];
    return p;
  }
  const chantOf = (p: Project, m: number) => p.lines[0].notes.filter(n => n.measure === m);

  test('remplace le contenu des cibles, garde leurs paroles par position, marque les notes corrigées', () => {
    const p = song();
    expect(copyMeasure(p, 0, [1, 2, 0, 1], { lineIds: ['0|1'] })).toBe(2);
    for (const m of [1, 2]) {
      const ns = chantOf(p, m);
      expect(ns.map(n => [n.offset, n.duration, n.pitch?.step, n.manual, n.tie])).toEqual([[0, 2, 'C', true, undefined], [2, 1, 'E', true, true]]);
    }
    // paroles : la mesure 1 garde « mon » sur la note du 1er temps ; la mesure 2 n'en avait pas
    expect(chantOf(p, 1).map(n => n.lyrics?.[0]?.text)).toEqual(['mon', undefined]);
    expect(chantOf(p, 2).every(n => !n.lyrics)).toBe(true);
    // source et mesure 3 intactes ; autres lignes intactes ; identifiants uniques
    expect(chantOf(p, 0).map(n => n.id)).toEqual(['a', 'b']);
    expect(chantOf(p, 3).map(n => n.id)).toEqual(['e']);
    expect(measuresOf(p, '1|1')).toEqual([0, 1, 2, 3]);
    const ids = p.lines.flatMap(l => l.notes.map(n => n.id));
    expect(new Set(ids).size).toBe(ids.length);
    // la validation des cibles copiées tombe, pas celle des autres lignes
    expect(p.review.checked).toEqual(['2|1|1']);
    // projet valide, notes triées
    const again = parseProject(serializeProject(p));
    expect(again.lines[0].notes.map(n => n.measure)).toEqual([0, 0, 1, 1, 2, 2, 3]);
  });

  test('avec les paroles de la source, et sur toutes les lignes par défaut', () => {
    const p = song();
    copyMeasure(p, 0, [3], { lyrics: true });
    expect(chantOf(p, 3).map(n => n.lyrics?.[0]?.text)).toEqual(['Au', 'clair']);
    // piano : la mesure 3 reprend le silence de mesure de la mesure 0
    expect(p.lines[1].notes.filter(n => n.measure === 3)).toMatchObject([{ pitch: null, duration: 3, manual: true }]);
    expect(findIssues(p).filter(i => !i.checked && i.measure === 3 && i.kind !== 'lost')).toEqual([]);
  });

  test('rien à faire : source seule, hors partition', () => {
    const p = song();
    const before = serializeProject(p);
    expect(copyMeasure(p, 0, [0, 7, -1, 1.5])).toBe(0);
    expect(copyMeasure(p, 9, [1])).toBe(0);
    expect(serializeProject(p)).toBe(before);
  });
});

describe('parseMeasureList', () => {
  test('numéros, plages, séparateurs variés', () => {
    expect(parseMeasureList('5', 8)).toEqual({ indices: [4] });
    expect(parseMeasureList(' 5, 7-8 ; 2 ', 8)).toEqual({ indices: [1, 4, 6, 7] });
    expect(parseMeasureList('3 à 5 4', 8)).toEqual({ indices: [2, 3, 4] });
    expect(parseMeasureList('6–4', 8)).toEqual({ indices: [3, 4, 5] });
  });
  test('erreurs en clair', () => {
    expect(parseMeasureList('', 8).error).toMatch(/au moins une mesure/);
    expect(parseMeasureList('5, x', 8).error).toBe('« x » n\'est pas un numéro de mesure.');
    expect(parseMeasureList('7-9', 8).error).toBe('« 7-9 » : la partition va de la mesure 1 à la mesure 8.');
    expect(parseMeasureList('0', 8).error).toMatch(/va de la mesure 1/);
  });
});
