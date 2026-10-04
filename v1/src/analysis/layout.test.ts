// Découpage de la page lu dans le projet .omr d'Audiveris (server/omr.mjs), confronté au MusicXML de la
// même analyse : la k-ième mesure du découpage doit être la k-ième mesure du MusicXML, de même numéro.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readLayout, readScore } from '../../server/omr.mjs';
import { readMusicXml } from '../model/musicxml-read';
import type { PageLayout } from '../model/types';
import { sampleRegion } from './sample';

const JOBS = join(__dirname, '../../../v0/jobs');
const jobs = existsSync(JOBS) ? readdirSync(JOBS).filter(j => existsSync(join(JOBS, j, 'out/input.omr'))) : [];

describe.skipIf(!jobs.length)('découpage .omr (jobs réels de la v0)', () => {
  it.each(jobs)('%s : mesures du découpage = mesures du MusicXML', job => {
    const layout = readLayout(join(JOBS, job, 'out/input.omr'));
    const score = readMusicXml(readScore(join(JOBS, job, 'out/input.mxl')));
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.interline).toBeGreaterThan(5);
    const ids = layout.systems.flatMap(s => s.measures.map(m => String(m.id)));
    expect(ids).toEqual(score.measures.map(m => m.label));
    for (const s of layout.systems) {
      expect(s.staves.length).toBeGreaterThan(0);
      for (const st of s.staves) {
        // 5 lignes = 4 interlignes entre la première et la dernière
        expect(st.bottom - st.top).toBeGreaterThan(3 * layout.interline);
        expect(st.bottom - st.top).toBeLessThan(5 * layout.interline);
        expect(st.part).toBeGreaterThanOrEqual(0);
        expect(st.part).toBeLessThan(score.staves.length);
      }
      for (const m of s.measures) expect(m.right).toBeGreaterThan(m.left);
    }
  });
});

describe('extrait pour l’essai des polices', () => {
  const sys = (id: number, top: number, measures: number) => ({
    id, left: 100, right: 1500, top, bottom: top + 60,
    staves: [{ id, part: 0, top, bottom: top + 60, left: 100, right: 1500 }],
    measures: Array.from({ length: measures }, (_, k) => ({ id: k + 1, left: 100 + k * 300, right: 400 + k * 300 })),
  });
  const layout: PageLayout = { width: 1600, height: 2000, interline: 15, systems: [sys(1, 300, 3), sys(2, 600, 4), sys(3, 900, 4)] };

  it('prend au moins deux systèmes et quatre mesures, toute la largeur', () => {
    const r = sampleRegion(layout)!;
    expect(r.systems).toBe(2);
    expect(r.measures).toBe(7);
    expect(r.rect.x).toBe(0);
    expect(r.rect.w).toBe(1600);
    // 6 interlignes au-dessus, moitié de l'écart avec le système suivant au-dessous
    expect(r.rect.y).toBe(300 - 90);
    expect(r.rect.y + r.rect.h).toBe(660 + 120);
  });

  it('va plus loin si les premiers systèmes sont courts', () => {
    expect(sampleRegion(layout, 8)!.systems).toBe(3);
  });

  it('reste dans l’image et renonce sans système', () => {
    const r = sampleRegion({ ...layout, systems: [sys(1, 20, 2)] })!;
    expect(r.rect.y).toBe(0);
    expect(r.rect.y + r.rect.h).toBeLessThanOrEqual(2000);
    expect(sampleRegion({ ...layout, systems: [] })).toBeNull();
  });
});
