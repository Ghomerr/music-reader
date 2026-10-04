// État de l'application : un seul magasin, lu par les composants via useStore(sélecteur).
// Le projet (modèle musical) a son propre historique pour annuler / rétablir les corrections.
import { useSyncExternalStore } from 'react';
import type { PageLayout, PageScore, Project, Settings, UnplacedSymbol } from '../model/types';

export type StepId = 'import' | 'analyse' | 'score' | 'print';

/** Réponse du serveur pour un job d'analyse (GET /api/jobs/:id). */
export interface JobView {
  id: string;
  name: string;
  status: 'queued' | 'running' | 'done' | 'error';
  error?: string;
  queuePosition: number;
  elapsedMs: number;
  interline: number | null;
  interlineTooLow: boolean;
  measures: number | null;
  font: string;
  unplaced: UnplacedSymbol[];
  scores: { name: string; url: string }[];
  /** URL du découpage de la page (systèmes, portées, mesures) quand l'analyse a abouti */
  layoutUrl?: string;
  log: string[];
}

export interface PageState {
  /** identifiant stable (survit au réordonnancement, repris dans Measure.pageKey) */
  key: string;
  /** null pour une page issue d'un projet rechargé (pas d'image) */
  file: File | null;
  name: string;
  /** URL objet de l'image d'origine */
  url: string;
  w?: number;
  h?: number;
  status: 'pending' | 'upload' | 'queued' | 'running' | 'done' | 'error';
  /** agrandissement appliqué avant envoi */
  scale: number;
  /** police de référence demandée à Audiveris */
  font: string;
  /** police choisie automatiquement, pas encore validée par l'utilisateur */
  fontProposed?: boolean;
  error?: string;
  job?: JobView;
  retried?: { from: number; factor: number };
  /** MusicXML brut renvoyé par Audiveris */
  xml?: string;
  parsed?: PageScore;
  layout?: PageLayout;
  /** erreur de lecture du MusicXML */
  perr?: string;
}

export interface FontTrial {
  font: string;
  status: 'pending' | 'running' | 'done' | 'error';
  /** mesures reconnues dans l'extrait */
  measures: number;
  notes: number;
  /** couples (mesure, ligne) dont le rythme est faux ou vide */
  bad: number;
  /** symboles vus mais non placés (journal) */
  lost: number;
  /** plus haut = meilleur */
  score: number;
  elapsedMs?: number;
  error?: string;
}

export interface Calibration {
  status: 'idle' | 'running' | 'done' | 'error';
  /** page qui a servi à l'essai */
  pageKey?: string;
  /** nombre de mesures de l'extrait testé */
  sample?: number;
  trials: FontTrial[];
  best?: string;
  /** l'utilisateur a validé (ou changé) la police proposée */
  validated: boolean;
  message?: string;
}

export interface AppState {
  step: StepId;
  pages: PageState[];
  /** police utilisée pour les prochaines analyses (proposée par l'essai, ou choisie) */
  font: string;
  /** 'auto' = agrandissement automatique si l'interligne est trop petit */
  scaleMode: 'auto' | number;
  /** essayer les polices sur la première page avant d'analyser les autres */
  autoFont: boolean;
  calibration: Calibration;
  project: Project | null;
  /** avertissements d'assemblage (lignes différentes d'une page à l'autre…) */
  warnings: string[];
  /** mesure ouverte dans l'éditeur */
  selection: { measure: number; lineId?: string } | null;
  /** position de lecture (noires) pour le surlignage de la partition, null à l'arrêt */
  playhead: number | null;
  server: { ok: boolean; audiveris: boolean; message: string; fonts: string[] };
}

export const DEFAULT_FONT = 'Leland';

let state: AppState = {
  step: 'import',
  pages: [],
  font: DEFAULT_FONT,
  scaleMode: 'auto',
  autoFont: true,
  calibration: { status: 'idle', trials: [], validated: false },
  project: null,
  warnings: [],
  selection: null,
  playhead: null,
  server: { ok: false, audiveris: false, message: 'Connexion au serveur…', fonts: [] },
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export const getState = (): AppState => state;

export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  emit();
}

/** Met à jour une page (par clé) sans toucher aux autres. */
export function updatePage(key: string, patch: Partial<PageState>): void {
  setState(s => ({ pages: s.pages.map(p => (p.key === key ? { ...p, ...patch } : p)) }));
}

export function useStore<T>(select: (s: AppState) => T): T {
  return useSyncExternalStore(
    cb => { listeners.add(cb); return () => listeners.delete(cb); },
    () => select(state),
  );
}

// ---------- Projet et historique des corrections ----------

const past: Project[] = [];
const future: Project[] = [];
const HISTORY = 100;

/** Remplace le projet sans passer par l'historique (analyse, chargement). */
export function setProject(project: Project | null, warnings?: string[]): void {
  setState(warnings ? { project, warnings } : { project });
}

/**
 * Applique une correction : `fn` modifie une copie du projet, l'original part dans l'historique.
 * Toute modification du modèle par l'utilisateur doit passer par ici (annulable).
 */
export function editProject(fn: (draft: Project) => void): void {
  const cur = state.project;
  if (!cur) return;
  const draft = structuredClone(cur);
  fn(draft);
  past.push(cur);
  if (past.length > HISTORY) past.shift();
  future.length = 0;
  setState({ project: draft });
}

/**
 * Change les réglages (tempo, transposition, lignes, impression) hors historique : annuler une
 * correction de note ne doit pas ramener le tempo d'il y a dix minutes.
 */
export function updateSettings(fn: (s: Settings) => Settings): void {
  const cur = state.project;
  if (!cur) return;
  setState({ project: { ...cur, settings: fn(cur.settings) } });
}

export const canUndo = () => past.length > 0;
export const canRedo = () => future.length > 0;

// Les réglages courants sont conservés lors d'un annuler / rétablir (cf. updateSettings).
export function undo(): void {
  const prev = past.pop();
  if (!prev || !state.project) return;
  future.push(state.project);
  setState({ project: { ...prev, settings: state.project.settings } });
}

export function redo(): void {
  const next = future.pop();
  if (!next || !state.project) return;
  past.push(state.project);
  setState({ project: { ...next, settings: state.project.settings } });
}

/** Oublie l'historique (nouveau projet). */
export function resetHistory(): void {
  past.length = 0;
  future.length = 0;
}

let seq = 0;
/** Identifiant court et unique pour une page ou une note créée dans la session. */
export const newId = (prefix = 'n'): string => `${prefix}${Date.now().toString(36)}${(++seq).toString(36)}`;

export type { PageLayout, PageScore, UnplacedSymbol };
