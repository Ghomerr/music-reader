// Projet d'exemple « Au clair de la lune » (traditionnel, domaine public), construit avec les fonctions du
// modèle. Le fichier livré (public/demo/au-clair-de-la-lune.music-reader.json) en est la sérialisation :
// le test demo.test.ts vérifie qu'il est à jour, et le régénère avec UPDATE_DEMO=1 (npx vitest run demo).
//
// Une erreur volontaire, pour que la visite guidée ait une mesure à corriger : mesure 4 du chant, « rot »
// est une blanche au lieu d'une ronde (2 temps au lieu de 4).
import { createBlankProject } from '../../model/blank';
import { parsePitchCode } from '../../model/pitch';
import type { Line, Lyric, NoteEvent, Project } from '../../model/types';

export const DEMO_FILE = 'demo/au-clair-de-la-lune.music-reader.json';
export const DEMO_TITLE = 'Au clair de la lune (exemple)';
/** mesure (indice) et ligne de l'erreur volontaire */
export const DEMO_MISTAKE = { measure: 3, lineId: '0|1' } as const;

/** Un évènement : hauteur(s) (« C5 », accord, ou null pour un silence), durée en noires, syllabe. */
type Ev = [pitch: string | string[] | null, duration: number, lyric?: string];

/**
 * Syllabe : « lu- » commence ou continue un mot (trait d'union final), « -ne » le termine,
 * « -te- » est au milieu ; sans trait d'union, mot d'une syllabe.
 */
function lyricOf(s: string): Lyric {
  const open = s.endsWith('-'), cont = s.startsWith('-');
  const text = s.replace(/^-|-$/g, '');
  const syllabic = open ? (cont ? 'middle' : 'begin') : cont ? 'end' : 'single';
  return { verse: 1, text, syllabic };
}

function fill(line: Line, bars: Ev[][]): void {
  line.notes = bars.flatMap((bar, measure) => {
    let offset = 0;
    return bar.flatMap(([pitch, duration, lyric]): NoteEvent[] => {
      const at = offset;
      offset += duration;
      const codes = pitch === null ? [null] : Array.isArray(pitch) ? pitch : [pitch];
      return codes.map((c, k) => {
        const n: NoteEvent = { id: '', measure, offset: at, duration, pitch: c === null ? null : parsePitchCode(c), voice: 1 };
        if (lyric && k === 0) n.lyrics = [lyricOf(lyric)];
        return n;
      });
    });
  });
  // identifiants au format du fichier projet (recalculés de même au chargement)
  let cur = -1, k = 0;
  for (const n of line.notes) {
    if (n.measure !== cur) { cur = n.measure; k = 0; }
    n.id = `vierge.${n.measure}.${line.id}.${k++}`;
  }
}

const C = ['C4', 'E4', 'G4'], G = ['B3', 'D4', 'G4'];

export function buildDemoProject(): Project {
  const p = createBlankProject({
    title: DEMO_TITLE, beats: 4, beatType: 4, fifths: 0, mode: 'major', measures: 8, formation: 'chant-piano',
    createdAt: '2026-10-31T00:00:00.000Z',
  });
  const [chant, right, left] = p.lines;

  // Couplet 1 : « Au clair de la lune, / Mon ami Pierrot, / Prête-moi ta plume / Pour écrire un mot. »
  fill(chant, [
    [['C5', 1, 'Au'], ['C5', 1, 'clair'], ['C5', 1, 'de'], ['D5', 1, 'la']],
    [['E5', 2, 'lu-'], ['D5', 2, '-ne,']],
    [['C5', 1, 'mon'], ['E5', 1, 'a-'], ['D5', 1, '-mi'], ['D5', 1, 'Pier-']],
    [['C5', 2, '-rot,']],                       // erreur volontaire : une ronde dans l'original
    [['C5', 1, 'Prê-'], ['C5', 1, '-te-'], ['C5', 1, '-moi'], ['D5', 1, 'ta']],
    [['E5', 2, 'plu-'], ['D5', 2, '-me']],
    [['C5', 1, 'pour'], ['E5', 1, 'é-'], ['D5', 1, '-crire'], ['D5', 1, 'un']],
    [['C5', 4, 'mot.']],
  ]);

  // Accompagnement : accords plaqués à la main droite, basse à la main gauche (Do et Sol).
  const tonic: Ev[] = [[C, 2], [C, 2]], toDominant: Ev[] = [[C, 2], [G, 2]];
  fill(right, [tonic, toDominant, toDominant, [[C, 4]], tonic, toDominant, toDominant, [[C, 4]]]);
  const bassI: Ev[] = [['C3', 4]], bassV: Ev[] = [['C3', 2], ['G2', 2]];
  fill(left, [bassI, bassV, bassV, bassI, bassI, bassV, bassV, [[['C2', 'C3'], 4]]]);

  // chant à la flûte (plus proche de la voix), piano au piano pour les deux mains
  p.settings.lines[chant.id].instrument = 'flute';
  p.settings.lines[left.id].instrument = 'piano';
  return p;
}
