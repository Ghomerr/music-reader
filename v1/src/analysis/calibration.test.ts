// Banc d'essai MANUEL de la note des polices (désactivé par défaut) : relit les résultats d'Audiveris
// enregistrés par un script d'expérience (un dossier par partition, un fichier JSON par essai :
// full-<police>.json pour la page entière, crop<N>-<police>.json pour l'extrait) et affiche le tableau.
// Usage : CALIBRATION_DIR=<dossier> npx vitest run src/analysis/calibration.test.ts
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readMusicXml } from '../model/musicxml-read';
import type { PageScore, UnplacedSymbol } from '../model/types';
import { fontScore, trialMetrics } from './score';

const DIR = process.env.CALIBRATION_DIR;
const FIRST = +(process.env.FIRST || 0);

/** Ne garde que les n premières mesures d'une page (comparaison page entière / extrait). */
function firstMeasures(s: PageScore, u: UnplacedSymbol[], n: number): [PageScore, UnplacedSymbol[]] {
  const labels = new Set(s.measures.slice(0, n).map(m => m.label));
  return [{ ...s, measures: s.measures.slice(0, n), lines: s.lines.map(l => ({ ...l, notes: l.notes.filter(x => x.measure < n) })) },
          u.filter(x => labels.has(x.measure))];
}

describe.skipIf(!DIR)('calibration des polices (manuel)', () => {
  it('note chaque essai', () => {
    const rows: Record<string, unknown>[] = [];
    for (const page of readdirSync(DIR!)) {
      let files: string[];
      try { files = readdirSync(join(DIR!, page)).filter(f => /^(full|crop\w+)-[A-Za-z]+\.json$/.test(f) && !f.includes('region')); }
      catch { continue; }
      for (const f of files) {
        const [mode, font] = f.slice(0, -5).split('-');
        const o = JSON.parse(readFileSync(join(DIR!, page, f), 'utf8'));
        if (o.status !== 'done') { rows.push({ page, mode, font, error: o.error }); continue; }
        const score = readMusicXml(o.xml);
        const variants: [string, PageScore, UnplacedSymbol[]][] = [[mode, score, o.unplaced]];
        if (mode === 'full' && FIRST) variants.push([`full${FIRST}`, ...firstMeasures(score, o.unplaced, FIRST)]);
        for (const [m, s, u] of variants) {
          const t = trialMetrics(s, u);
          const whole = s.lines.reduce((a, l) => a + l.notes.filter(n => n.pitch && n.duration === 4).length, 0);
          rows.push({ page, mode: m, font, s: m === mode ? +(o.elapsedMs / 1000).toFixed(1) : '', ...t, whole, score: +fontScore(t).toFixed(3) });
        }
      }
    }
    rows.sort((a, b) => `${a.page}${a.mode}`.localeCompare(`${b.page}${b.mode}`) || (b.score as number) - (a.score as number));
    const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
    process.stdout.write(['', cols.join('\t'), ...rows.map(r => cols.map(c => r[c] ?? '').join('\t'))].join('\n') + '\n');
    expect(rows.length).toBeGreaterThan(0);
  });
});
