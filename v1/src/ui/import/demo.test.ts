// Projet d'exemple livré dans public/demo : à jour avec demo-score.ts, valide, une seule erreur volontaire.
// Régénérer le fichier : `$env:UPDATE_DEMO='1'; npx vitest run demo` (PowerShell).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { findIssues } from '../../model/check';
import { parseProject, serializeProject } from '../../model/project-io';
import { buildDemoProject, DEMO_FILE, DEMO_MISTAKE, DEMO_TITLE } from './demo-score';

// vitest tourne depuis v1/
const FILE = resolve(process.cwd(), 'public', DEMO_FILE);

describe('projet d\'exemple', () => {
  test('le fichier livré est la sérialisation de buildDemoProject()', () => {
    const text = serializeProject(buildDemoProject());
    if (process.env.UPDATE_DEMO) {
      mkdirSync(dirname(FILE), { recursive: true });
      writeFileSync(FILE, text);
    }
    expect(readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')).toBe(text);
  });

  test('relu : titre, lignes, paroles, un seul diagnostic à l\'endroit prévu', () => {
    const p = parseProject(readFileSync(FILE, 'utf8'));
    expect(p.title).toBe(DEMO_TITLE);
    expect(p.pages).toEqual([]);
    expect(p.measures).toHaveLength(8);
    expect(p.measures.every(m => m.beats === 4 && m.beatType === 4 && m.fifths === 0)).toBe(true);
    expect(p.lines.map(l => `${l.id} ${l.name} ${l.clef.sign}`)).toEqual(['0|1 Chant G', '1|1 Piano — main droite G', '1|2 Piano — main gauche F']);

    const words = p.lines[0].notes.flatMap(n => n.lyrics ?? []).map(l => l.text + (l.syllabic === 'begin' || l.syllabic === 'middle' ? '-' : ' '))
      .join('').trim();
    expect(words).toBe('Au clair de la lu-ne, mon a-mi Pier-rot, Prê-te-moi ta plu-me pour é-crire un mot.');
    expect(p.lines.slice(1).every(l => l.notes.every(n => !n.lyrics))).toBe(true);

    const issues = findIssues(p);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ ...DEMO_MISTAKE, kind: 'rhythm', checked: false });
    expect(issues[0].text).toBe('2 temps au lieu de 4 (−2)');
  });
});
