// Partition vierge : un projet complet sans page analysée, pour écrire soi-même une musique dans
// l'éditeur de mesure. Chaque mesure de chaque ligne porte un silence de mesure : une partition neuve
// n'est donc pas couverte de « mesure vide », et poser une note remplace simplement une part du silence.
import { defaultSettings } from './project-io';
import type { Clef, Line, Measure, NoteEvent, Project } from './types';

/** pageKey des mesures d'une partition vierge (aucune page d'origine). */
export const BLANK_PAGE_KEY = 'vierge';

export type Formation = 'chant' | 'piano' | 'chant-piano' | 'sol' | 'fa';

export const FORMATIONS: { id: Formation; label: string }[] = [
  { id: 'chant', label: 'Chant (une portée, clé de sol)' },
  { id: 'piano', label: 'Piano (clés de sol et de fa)' },
  { id: 'chant-piano', label: 'Chant et piano' },
  { id: 'sol', label: 'Instrument en clé de sol' },
  { id: 'fa', label: 'Instrument en clé de fa' },
];

export interface BlankOptions {
  title: string;
  beats: number;
  beatType: number;
  /** armure en quintes (-7..7) */
  fifths: number;
  mode: 'major' | 'minor';
  /** nombre de mesures (borné à 1..MAX_BLANK_MEASURES) */
  measures: number;
  formation: Formation;
  /** date de création (ISO) ; maintenant par défaut */
  createdAt?: string;
}

export const MAX_BLANK_MEASURES = 500;
export const DEFAULT_BLANK_TITLE = 'Nouvelle partition';

const TREBLE: Clef = { sign: 'G', line: 2 };
const BASS: Clef = { sign: 'F', line: 4 };

/** Lignes d'une formation : ids `${partie}|${portée}`, comme celles qu'assemble tire d'une analyse. */
function formationLines(f: Formation): Omit<Line, 'notes'>[] {
  const piano = (part: number): Omit<Line, 'notes'>[] => [
    { id: `${part}|1`, name: 'Piano — main droite', part, partName: 'Piano', staff: 1, clef: { ...TREBLE } },
    { id: `${part}|2`, name: 'Piano — main gauche', part, partName: 'Piano', staff: 2, clef: { ...BASS } },
  ];
  const single = (name: string, clef: Clef): Omit<Line, 'notes'> =>
    ({ id: '0|1', name, part: 0, partName: name, staff: 1, clef: { ...clef } });
  switch (f) {
    case 'chant': return [single('Chant', TREBLE)];
    case 'piano': return piano(0);
    case 'chant-piano': return [single('Chant', TREBLE), ...piano(1)];
    case 'sol': return [single('Instrument', TREBLE)];
    case 'fa': return [single('Instrument', BASS)];
  }
}

/** Durée d'une mesure, en noires. */
const lengthOf = (m: Pick<Measure, 'beats' | 'beatType'>) => (m.beats * 4) / m.beatType;

/**
 * Silence de mesure (voix 1, toute la mesure). Identifiant au format de project-io
 * (`${pageKey}.${mesure locale}.${ligne}.0`) : le projet se relit à l'identique après enregistrement.
 */
export function measureRest(m: Measure, index: number, lineId: string): NoteEvent {
  return { id: `${m.pageKey}.${m.local}.${lineId}.0`, measure: index, offset: 0, duration: lengthOf(m), pitch: null, voice: 1 };
}

/** Projet neuf, complet et valide : mesures numérotées 1..n, un silence de mesure partout. */
export function createBlankProject(o: BlankOptions): Project {
  const n = Math.max(1, Math.min(MAX_BLANK_MEASURES, Math.round(o.measures) || 1));
  const title = o.title.trim() || DEFAULT_BLANK_TITLE;
  const measures: Measure[] = Array.from({ length: n }, (_, i) => ({
    pageKey: BLANK_PAGE_KEY, page: 1, local: i, label: String(i + 1),
    beats: o.beats, beatType: o.beatType, fifths: o.fifths, mode: o.mode,
  }));
  const lines: Line[] = formationLines(o.formation).map(l => ({
    ...l, notes: measures.map((m, i) => measureRest(m, i, l.id)),
  }));
  return {
    format: 'music-reader', version: 2, title, createdAt: o.createdAt ?? new Date().toISOString(),
    pages: [], measures, lines, settings: defaultSettings(lines, title), review: { lost: [], checked: [] },
  };
}
