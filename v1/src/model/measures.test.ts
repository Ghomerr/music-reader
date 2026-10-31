import { describe, expect, test } from 'vitest';
import { createBlankProject } from './blank';
import { findIssues } from './check';
import { deleteMeasure, hasNotes, insertMeasure, isAddedMeasure, measureOrigin } from './measures';
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
