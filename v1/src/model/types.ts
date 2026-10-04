// Modèle interne de Music Reader : c'est lui, et non le MusicXML d'Audiveris, qui fait foi dès que
// l'analyse est terminée. L'affichage, la lecture, l'impression et le fichier projet en dérivent tous,
// si bien qu'une correction manuelle se propage partout d'un coup.
//
// Unités : toutes les durées et positions sont en temps de noire (1 = une noire, 0,5 = une croche).
// Les positions de notes sont relatives au début de leur mesure (measure + offset) : une note fausse
// ne décale ainsi jamais le reste de la partition, et une mesure se corrige indépendamment des autres.

export type Step = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';

/** Hauteur orthographiée : on garde l'écriture (Mi♭ et Ré♯ ne s'impriment pas pareil). */
export interface Pitch {
  step: Step;
  /** -2..2 : bémols / dièses */
  alter: number;
  /** octave scientifique : Do4 = do du milieu */
  octave: number;
}

export interface Lyric {
  /** numéro du couplet (1, 2…) */
  verse: number;
  text: string;
  syllabic?: 'single' | 'begin' | 'middle' | 'end';
  /** saisie ou corrigée à la main : survit à une réanalyse */
  manual?: boolean;
}

/** Une note ou un silence. Les accords sont des notes de même voix, même offset et même durée. */
export interface NoteEvent {
  /** identifiant stable (unique dans le projet) */
  id: string;
  /** indice de la mesure dans score.measures */
  measure: number;
  /** position depuis le début de la mesure, en noires */
  offset: number;
  /** en noires (1/3, 2/3, 1/6 pour les triolets) */
  duration: number;
  /** null = silence */
  pitch: Pitch | null;
  /** voix dans la ligne, à partir de 1 */
  voice: number;
  /** liée à la note suivante de même hauteur (liaison de prolongation) */
  tie?: boolean;
  lyrics?: Lyric[];
  /** posée ou modifiée à la main : survit à une réanalyse */
  manual?: boolean;
}

export interface Clef {
  sign: 'G' | 'F' | 'C' | 'percussion';
  line: number;
  /** -1 pour une clé de sol octaviée en bas (ténor), etc. */
  octaveChange?: number;
}

/** Une ligne musicale = une portée d'une partie, jouée en même temps que les autres. */
export interface Line {
  /** `${indice de partie}|${portée}`, ex. "0|1", "1|2" : sert au raccord des pages par position */
  id: string;
  /** libellé affiché, ex. « Piano — portée 2 » */
  name: string;
  /** indice de la partie d'origine (0, 1…) : les lignes d'une même partie s'impriment accolées */
  part: number;
  partName: string;
  /** portée dans la partie, à partir de 1 */
  staff: number;
  /** clé au début de la partition */
  clef: Clef;
  /** changements de clé ultérieurs */
  clefChanges?: { measure: number; offset: number; clef: Clef }[];
  /** triées par (measure, offset, voice) */
  notes: NoteEvent[];
}

export interface Measure {
  /** page d'origine (identifiant stable de la page, pas sa position) */
  pageKey: string;
  /** rang de la page dans l'ordre courant, à partir de 1 (affichage) */
  page: number;
  /** indice de la mesure dans sa page, à partir de 0 */
  local: number;
  /** numéro imprimé sur la page d'origine (Audiveris numérote chaque page à partir de 1) */
  label: string;
  beats: number;
  beatType: number;
  /** armure en quintes (-7..7) et mode */
  fifths: number;
  mode: 'major' | 'minor';
  /** début de système / de page sur l'image d'origine */
  newSystem?: boolean;
  newPage?: boolean;
}

export interface LineSettings {
  enabled: boolean;
  instrument: Instrument;
  /** 0..1 */
  volume: number;
}

export type Instrument = 'piano' | 'flute' | 'cordes' | 'orgue';

export interface PrintSettings {
  /** lignes à imprimer (ids) ; vide = toutes */
  lines: string[];
  lyrics: boolean;
  /** couplets imprimés ; vide = tous */
  verses: number[];
  title: string;
  /** reprendre les sauts de système de l'original */
  keepLayout: boolean;
}

export interface Settings {
  tempo: number;
  /** en demi-tons, -24..24 (± octave compris) */
  transpose: number;
  loop: boolean;
  lines: Record<string, LineSettings>;
  print: PrintSettings;
}

/** Symbole qu'Audiveris a vu mais n'a pas su placer dans le temps (relevé dans son journal). */
export interface LostSymbol {
  measure: number;
  lineId: string;
  rest: boolean;
  /** durée lue, en noires */
  duration: number;
}

export interface PageMeta {
  key: string;
  name: string;
  /** police de référence utilisée par Audiveris */
  font: string;
  scale: number;
}

export interface Project {
  format: 'music-reader';
  version: 2;
  title: string;
  createdAt: string;
  pages: PageMeta[];
  measures: Measure[];
  lines: Line[];
  settings: Settings;
  review: {
    lost: LostSymbol[];
    /** mesures relues et validées par l'utilisateur : `${measure}|${lineId}` */
    checked: string[];
  };
}

export type IssueKind = 'empty' | 'rhythm' | 'gap' | 'lost';

/** Diagnostic calculé à la volée sur le modèle (jamais stocké : il suit les corrections). */
export interface Issue {
  measure: number;
  lineId: string;
  kind: IssueKind;
  /** explication lisible, ex. « 5 temps au lieu de 4 (+1) » */
  text: string;
  /** l'utilisateur a validé la mesure malgré tout */
  checked: boolean;
}

/** Placement d'une mesure dans le temps, une fois la partition assemblée. */
export interface MeasureTime {
  /** début, en noires depuis le début de la partition */
  start: number;
  /** durée effective (métrique, ou contenu le plus long s'il déborde, ou anacrouse) */
  len: number;
  /** durée attendue d'après la métrique */
  expected: number;
}

// ---------- Résultat d'analyse d'une page, avant assemblage ----------

/** Ce que le serveur renvoie pour une page analysée (GET /api/jobs/:id). */
export interface UnplacedSymbol {
  /** numéro de mesure Audiveris dans la page (chaîne, comme dans le MusicXML) */
  measure: string;
  /** partie Audiveris (1-based) si le journal la donne */
  part: number | null;
  rest: boolean;
  id: string;
  /** portée dans la page (1-based, comptée sur tous les systèmes) */
  staff: number;
  /** durée [numérateur, dénominateur] en fraction de ronde */
  dur: [number, number];
}

/** Une page lue depuis le MusicXML d'Audiveris, avec numérotation locale des mesures. */
export interface PageScore {
  title: string;
  /** mesures de la page ; pageKey/page sont renseignés à l'assemblage */
  measures: Omit<Measure, 'pageKey' | 'page'>[];
  /** les mesures portent ici l'indice local ; NoteEvent.measure = indice dans measures */
  lines: Line[];
  /** portées par partie, dans l'ordre des parties (ex. [1, 2] pour chant + piano) */
  staves: number[];
  /** la page indique-t-elle elle-même sa métrique ? (sinon héritée de la page précédente) */
  hasTime: boolean;
  hasKey: boolean;
}

/** Géométrie de la page dans l'image analysée (extraite du fichier .omr d'Audiveris). */
export interface PageLayout {
  width: number;
  height: number;
  interline: number;
  systems: {
    id: number;
    left: number;
    right: number;
    top: number;
    bottom: number;
    staves: { id: number; part: number; top: number; bottom: number; left: number; right: number }[];
    /** mesures du système, dans l'ordre ; id = numéro Audiveris dans la page */
    measures: { id: number; left: number; right: number }[];
  }[];
}
