import { describe, expect, test } from 'vitest';
import { createBlankProject, FORMATIONS, type Formation } from './blank';
import { findIssues, timeline } from './check';
import { writeMusicXml } from './musicxml-write';
import { parseProject, serializeProject } from './project-io';

const base = { title: 'Essai', beats: 3, beatType: 4, fifths: -2, mode: 'major' as const, measures: 8, createdAt: '2026-10-31T09:00:00.000Z' };

describe('createBlankProject', () => {
  test.each(FORMATIONS.map(f => f.id))('%s : projet valide, relu à l\'identique, sans diagnostic', (formation: Formation) => {
    const p = createBlankProject({ ...base, formation });
    expect(findIssues(p)).toEqual([]);
    const again = parseProject(serializeProject(p));
    expect(again).toEqual(p);
    expect(serializeProject(again)).toBe(serializeProject(p));
    expect(() => writeMusicXml(p, {})).not.toThrow();
  });

  test('mesures numérotées, métrique et armure demandées, silence de mesure partout', () => {
    const p = createBlankProject({ ...base, formation: 'chant-piano' });
    expect(p.pages).toEqual([]);
    expect(p.measures).toHaveLength(8);
    expect(p.measures[3]).toEqual({ pageKey: 'vierge', page: 1, local: 3, label: '4', beats: 3, beatType: 4, fifths: -2, mode: 'major' });
    for (const l of p.lines) {
      expect(l.notes).toHaveLength(8);
      expect(l.notes.every((n, i) => n.measure === i && n.offset === 0 && n.duration === 3 && n.pitch === null && n.voice === 1)).toBe(true);
    }
    expect(timeline(p).map(t => t.start)).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
    expect(p.settings.print.title).toBe('Essai');
    expect(Object.keys(p.settings.lines)).toEqual(['0|1', '1|1', '1|2']);
  });

  test('formations : lignes, parties et clés', () => {
    const lines = (f: Formation) => createBlankProject({ ...base, formation: f }).lines
      .map(l => `${l.id} ${l.name} (${l.partName}) ${l.clef.sign}${l.clef.line}`);
    expect(lines('chant')).toEqual(['0|1 Chant (Chant) G2']);
    expect(lines('piano')).toEqual(['0|1 Piano — main droite (Piano) G2', '0|2 Piano — main gauche (Piano) F4']);
    expect(lines('chant-piano')).toEqual(['0|1 Chant (Chant) G2', '1|1 Piano — main droite (Piano) G2', '1|2 Piano — main gauche (Piano) F4']);
    expect(lines('sol')).toEqual(['0|1 Instrument (Instrument) G2']);
    expect(lines('fa')).toEqual(['0|1 Instrument (Instrument) F4']);
  });

  test('6/8 : silence de 3 noires ; bornes et titre par défaut', () => {
    const p = createBlankProject({ ...base, beats: 6, beatType: 8, measures: 0, title: '  ', formation: 'chant' });
    expect(p.measures).toHaveLength(1);
    expect(p.lines[0].notes[0].duration).toBe(3);
    expect(p.title).toBe('Nouvelle partition');
    expect(createBlankProject({ ...base, measures: 10000, formation: 'chant' }).measures).toHaveLength(500);
  });
});
