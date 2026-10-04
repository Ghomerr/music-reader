// Données réelles pour les tests du modèle : MusicXML et journaux d'Audiveris produits par la v0
// (v0/jobs, hors dépôt). Les tests qui en dépendent sont sautés si le dossier est absent.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AnalyzedPage } from './assemble';
import { readMusicXml } from './musicxml-read';
import type { UnplacedSymbol } from './types';

// vitest tourne depuis v1/ (sous jsdom, import.meta.url n'est pas une URL file:)
const JOBS = resolve(process.cwd(), '../v0/jobs') + '/';

/** « Over The Rainbow », coupé en trois pages (Leland) : 17 + 15 + 8 mesures. */
export const RAINBOW = { p1: '5813a57d97ce', p2: '83255fad3762', p3: '53a4ca795e48' } as const;

export const hasJobs = Object.values(RAINBOW).every(j => existsSync(`${JOBS}${j}/input.xml`));

export const jobXml = (job: string): string => readFileSync(`${JOBS}${job}/input.xml`, 'utf8');

/** Symboles non placés relevés dans le journal, avec la même expression que le serveur de la v0. */
export function jobUnplaced(job: string): UnplacedSymbol[] {
  const dir = `${JOBS}${job}/out/`;
  const out: UnplacedSymbol[] = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.log')))
    for (const line of readFileSync(dir + f, 'utf8').split(/\r?\n/)) {
      const lost = /Measure\{#(\d+)(?:P(\d+))?\} No timeOffset for (Head|Rest)ChordInter#(\d+)\{[^}]*?staff:(\d+)[^}]*?dur:(\d+)\/(\d+)/.exec(line);
      if (lost && !out.some(u => u.id === lost[4]))
        out.push({ measure: lost[1], part: lost[2] ? +lost[2] : null, rest: lost[3] === 'Rest',
                   id: lost[4], staff: +lost[5], dur: [+lost[6], +lost[7]] });
    }
  return out;
}

export function analyzed(job: string, key = job, name = `${job}.jpg`): AnalyzedPage {
  return { key, name, font: 'Leland', scale: 1, score: readMusicXml(jobXml(job)), unplaced: jobUnplaced(job) };
}
