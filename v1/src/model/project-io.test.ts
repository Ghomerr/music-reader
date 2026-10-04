import { describe, expect, test } from 'vitest';
import { assemble } from './assemble';
import { findIssues } from './check';
import { defaultSettings, parseProject, serializeProject } from './project-io';
import { analyzed, hasJobs, RAINBOW } from './test-data';
import type { Line, Project } from './types';

function small(): Project {
  const lines: Line[] = [{
    id: '0|1', name: 'Chant', part: 0, partName: 'Chant', staff: 1, clef: { sign: 'G', line: 2 },
    clefChanges: [{ measure: 1, offset: 2, clef: { sign: 'F', line: 4 } }],
    notes: [
      { id: 'pg.0.0|1.0', measure: 0, offset: 0, duration: 1 / 3, pitch: { step: 'E', alter: -1, octave: 4 }, voice: 1, tie: true,
        lyrics: [{ verse: 1, text: 'Là', syllabic: 'begin', manual: true }] },
      { id: 'pg.0.0|1.1', measure: 0, offset: 1 / 3, duration: 1 / 3, pitch: { step: 'E', alter: -1, octave: 4 }, voice: 1 },
      { id: 'pg.0.0|1.2', measure: 0, offset: 2 / 3, duration: 1 / 3 + 3, pitch: null, voice: 1, manual: true },
      { id: 'pg.1.0|1.0', measure: 1, offset: 0, duration: 4, pitch: { step: 'F', alter: 2, octave: 3 }, voice: 2 },
    ],
  }];
  return {
    format: 'music-reader', version: 2, title: 'Essai', createdAt: '2026-10-04T10:00:00.000Z',
    pages: [{ key: 'pg', name: 'page.jpg', font: 'Leland', scale: 1.5 }],
    measures: [
      { pageKey: 'pg', page: 1, local: 0, label: '1', beats: 4, beatType: 4, fifths: -3, mode: 'minor' },
      { pageKey: 'pg', page: 1, local: 1, label: '2', beats: 4, beatType: 4, fifths: -3, mode: 'minor', newSystem: true },
    ],
    lines,
    settings: { ...defaultSettings(lines, 'Essai'), tempo: 88, transpose: -2 },
    review: { lost: [{ measure: 1, lineId: '0|1', rest: true, duration: 0.5 }], checked: ['1|0|1'] },
  };
}

describe('fichier projet v2', () => {
  test('aller-retour exact, triolets compris ; format lisible', () => {
    const p = small();
    const text = serializeProject(p);
    expect(parseProject(text)).toEqual(p);
    expect(serializeProject(parseProject(text))).toBe(text);
    expect(text).toContain('"pitch": "Eb4"');
    expect(text).toContain('"pitch": null');
    expect(text).toContain('"offset": 0.333333');
    expect(text).not.toContain('"id": "pg.');      // identifiants de notes recalculés au chargement
    expect(text).toContain('\n    { "pageKey": "pg", "page": 1, "local": 1, "label": "2", "beats": 4, "beatType": 4, "fifths": -3, "mode": "minor", "newSystem": true }');
    // une note par ligne
    expect(text).toContain('\n        { "measure": 1, "offset": 0, "duration": 4, "pitch": "F##3", "voice": 2 }');
  });

  test('réglages absents ou faux : valeurs par défaut', () => {
    const d = JSON.parse(serializeProject(small()));
    delete d.settings;
    delete d.review;
    const p = parseProject(JSON.stringify(d));
    expect(p.settings).toEqual(defaultSettings(p.lines, 'Essai'));
    expect(p.review).toEqual({ lost: [], checked: [] });
    d.settings = { tempo: 'vite', loop: true, lines: { '0|1': { instrument: 'banjo', volume: 2 } }, print: { lyrics: false } };
    const q = parseProject(JSON.stringify(d));
    expect(q.settings.tempo).toBe(100);
    expect(q.settings.loop).toBe(true);
    expect(q.settings.lines['0|1']).toEqual({ enabled: true, instrument: 'piano', volume: 1 });
    expect(q.settings.print).toMatchObject({ lyrics: false, lines: [], verses: [], title: 'Essai' });
  });

  test('erreurs claires', () => {
    const ok = JSON.parse(serializeProject(small()));
    const bad = (f: (d: typeof ok) => void) => { const d = structuredClone(ok); f(d); return () => parseProject(JSON.stringify(d)); };
    expect(() => parseProject('{pas du json')).toThrow('n\'est pas un projet Lect\'O\'Note Matic 3000 : son contenu n\'est pas du JSON valide');
    expect(() => parseProject('{"format":"autre"}')).toThrow('Ce fichier n\'est pas un projet Lect\'O\'Note Matic 3000.');
    expect(() => parseProject('{"format":"music-reader","version":3}')).toThrow('Fichier projet : version 3 non prise en charge.');
    expect(bad(d => { d.lines[0].notes[1].pitch = 'H4'; })).toThrow('Fichier projet invalide : lines[0].notes[1].pitch : hauteur « H4 » illisible');
    expect(bad(d => { d.lines[0].notes[0].measure = 9; })).toThrow('Fichier projet invalide : lines[0].notes[0].measure doit être un entier ≥ 0 et ≤ 1.');
    expect(bad(d => { d.measures = 'x'; })).toThrow('Fichier projet invalide : measures doit être une liste.');
    expect(bad(d => { d.measures[1].mode = 'dorien'; })).toThrow('measures[1].mode doit valoir major ou minor');
    expect(bad(d => { d.lines.push(d.lines[0]); })).toThrow('lines[1].id « 0|1 » apparaît deux fois');
    expect(bad(d => { d.lines[0].clef = { sign: 'X', line: 2 }; })).toThrow('lines[0].clef.sign doit valoir G, F, C ou percussion');
    expect(bad(d => { d.lines = []; })).toThrow('aucune ligne musicale');
  });
});

describe('fichier projet v1 (maquette, v0)', () => {
  const v1 = {
    format: 'music-reader', version: 1, title: 'Ode à la joie', createdAt: '2026-10-02T10:00:00Z',
    score: { pages: 2, timeSignature: [3, 4], key: 'Eb' },
    settings: { tempo: 110, transpose: 2, loop: true },
    parts: [
      { name: 'Voix 1', clef: 'treble', enabled: true, instrument: 'flute', volume: 0.9,
        notes: [{ pitch: 'E4', start: 1, duration: 1 }, { pitch: 'G4', start: 2, duration: 2 }, { pitch: 'C5', start: 2, duration: 1 }] },
      { name: 'Basse', clef: 'bass', enabled: false, instrument: 'cordes', volume: 0.5, notes: [{ pitch: 'C3', start: 0, duration: 6 }] },
    ],
  };

  test('conversion : mesures fixes, notes coupées aux barres et liées, silences explicites', () => {
    const p = parseProject(JSON.stringify(v1));
    expect(p.version).toBe(2);
    expect(p.title).toBe('Ode à la joie');
    expect(p.pages).toEqual([]);
    expect(p.measures).toHaveLength(2);
    expect(p.measures[0]).toEqual({ pageKey: 'projet', page: 1, local: 0, label: '1', beats: 3, beatType: 4, fifths: -3, mode: 'major' });
    expect(p.lines.map(l => [l.id, l.name, l.clef.sign])).toEqual([['0|1', 'Voix 1', 'G'], ['1|1', 'Basse', 'F']]);
    const v = p.lines[0].notes.map(n => `${n.measure}:${n.offset}+${n.duration} ${n.pitch ? n.pitch.step + n.pitch.octave : '-'} v${n.voice}${n.tie ? ' ~' : ''}`);
    // G4 et C5 partent ensemble sans même durée : pas un accord, donc deux voix
    expect(v).toEqual(['0:0+1 - v1', '0:1+1 E4 v1', '0:2+1 G4 v1 ~', '0:2+1 C5 v2', '1:0+1 G4 v1', '1:1+2 - v1']);
    expect(p.lines[1].notes.map(n => `${n.measure}:${n.duration}${n.tie ? '~' : ''}`)).toEqual(['0:3~', '1:3']);
    expect(p.settings).toMatchObject({ tempo: 110, transpose: 2, loop: true });
    expect(p.settings.lines['0|1']).toEqual({ enabled: true, instrument: 'flute', volume: 0.9 });
    expect(p.settings.lines['1|1']).toEqual({ enabled: false, instrument: 'cordes', volume: 0.5 });
    expect(p.review).toEqual({ lost: [], checked: [] });
    expect(findIssues(p)).toEqual([]);
    // et il se réenregistre en v2
    expect(parseProject(serializeProject(p))).toEqual(p);
  });

  test('erreurs v1', () => {
    expect(() => parseProject(JSON.stringify({ ...v1, parts: [] }))).toThrow('aucune ligne musicale');
    expect(() => parseProject(JSON.stringify({ ...v1, parts: [{ notes: [{ pitch: 'X', start: 0, duration: 1 }] }] })))
      .toThrow('parts[0].notes[0].pitch : hauteur « X » illisible');
  });
});

describe.skipIf(!hasJobs)('fichier projet — Over The Rainbow', () => {
  test('aller-retour sur les trois pages assemblées', () => {
    const { project } = assemble([analyzed(RAINBOW.p1, 'p1'), analyzed(RAINBOW.p2, 'p2'), analyzed(RAINBOW.p3, 'p3')], null);
    const text = serializeProject(project);
    const back = parseProject(text);
    expect(back).toEqual(project);
    expect(serializeProject(back)).toBe(text);
    expect(findIssues(back)).toEqual(findIssues(project));
    expect(text.length).toBeLessThan(150_000);
  });
});
