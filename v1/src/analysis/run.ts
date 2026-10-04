// Orchestration de l'analyse : envoi des pages au serveur, agrandissement automatique, lecture du
// MusicXML, essai des polices sur la première page, puis réassemblage du projet. Les composants
// n'appellent que les actions exportées ici ; tout l'état passe par le magasin.
import { assemble, type AnalyzedPage } from '../model/assemble';
import { readMusicXml } from '../model/musicxml-read';
import {
  DEFAULT_FONT, getState, newId, resetHistory, setProject, setState, updatePage,
  type Calibration, type FontTrial, type JobView, type PageState,
} from '../state/store';
import { analyseImage, fetchLayout, fetchMusicXml } from './api';
import { cropImage, imageSize, scaleImage } from './image';
import { sampleRegion } from './sample';
import { fontScore, pickFont, trialMetrics, type TrialMetrics } from './score';

/** Polices essayées automatiquement, la police par défaut en tête (elle gagne les égalités). */
export const TRIAL_FONTS = ['Leland', 'Bravura', 'FinaleJazz', 'Primus', 'MusicalSymbols'];

/** Toutes les polices proposées au choix manuel. */
export const FONT_LABELS: Record<string, string> = {
  Leland: 'Leland — gravure classique',
  Bravura: 'Bravura — défaut d’Audiveris',
  FinaleJazz: 'Finale Jazz — partitions calligraphiées',
  Primus: 'Primus',
  MusicalSymbols: 'Musical Symbols',
  JazzPerc: 'Jazz Perc',
};

/** Mesures couvertes au minimum par l'extrait d'essai. */
const SAMPLE_MEASURES = 4;

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const pageOf = (key: string) => getState().pages.find(p => p.key === key);

/** Une image nettement plus large que haute est presque toujours un scan de deux pages en vis-à-vis. */
export const isSpread = (p: Pick<PageState, 'w' | 'h'>) => !!(p.w && p.h && p.w > p.h * 1.25);

// ---------- Pages ----------

/** Ajoute des images à la liste (dimensions lues en arrière-plan). */
export function addFiles(files: Iterable<File>): void {
  const s = getState();
  // Les pages d'un projet rechargé n'ont pas d'image : on ne peut pas les mêler à une nouvelle analyse.
  const fresh = s.pages.some(p => !p.file);
  const added: PageState[] = [];
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    added.push({ key: newId('p'), file, name: file.name, url: URL.createObjectURL(file), status: 'pending',
                 scale: 1, font: s.font });
  }
  if (!added.length) return;
  if (fresh) {
    resetHistory();
    setProject(null, []);
    setState({ pages: added, calibration: { status: 'idle', trials: [], validated: false } });
  } else setState({ pages: [...s.pages, ...added] });
  for (const p of added)
    imageSize(p.url).then(d => updatePage(p.key, d)).catch(() => updatePage(p.key, { error: 'Image illisible' }));
}

export function removePage(key: string): void {
  const p = pageOf(key);
  if (!p) return;
  runs.delete(key);
  if (p.url) URL.revokeObjectURL(p.url);
  setState(s => ({ pages: s.pages.filter(x => x.key !== key) }));
  reassemble();
}

export function movePage(key: string, delta: number): void {
  const pages = [...getState().pages];
  const i = pages.findIndex(p => p.key === key), j = i + delta;
  if (i < 0 || j < 0 || j >= pages.length) return;
  [pages[i], pages[j]] = [pages[j], pages[i]];
  setState({ pages });
  reassemble();
}

export function clearPages(): void {
  for (const p of getState().pages) if (p.url) URL.revokeObjectURL(p.url);
  runs.clear();
  resetHistory();
  setProject(null, []);
  setState({ pages: [], calibration: { status: 'idle', trials: [], validated: false } });
}

// ---------- Assemblage ----------

/**
 * Remet les pages terminées bout à bout, dans l'ordre courant. Le projet précédent est transmis :
 * les corrections manuelles et les réglages y survivent (cf. assemble).
 */
export function reassemble(): void {
  const s = getState();
  if (s.pages.some(p => !p.file)) return;   // projet rechargé : rien à réassembler
  const done = s.pages.filter(p => p.status === 'done' && p.parsed);
  if (!done.length) { setProject(null, []); return; }
  const analyzed: AnalyzedPage[] = done.map(p => ({
    key: p.key, name: p.name, font: p.font, scale: p.scale, score: p.parsed!, unplaced: p.job?.unplaced ?? [],
  }));
  try {
    const { project, warnings } = assemble(analyzed, s.project);
    const failed = s.pages.filter(p => p.status === 'error').length;
    setProject(project, failed ? [...warnings, `${failed} page(s) en échec ignorée(s) dans l'assemblage.`] : warnings);
  } catch (e) {
    setState({ warnings: [`Assemblage impossible : ${msg(e)}`] });
  }
}

// ---------- Analyse d'une page ----------

/** Jeton de la dernière analyse lancée par page : une relance périme la précédente. */
const runs = new Map<string, number>();
let runSeq = 0;

interface PageRun {
  /** image effectivement envoyée (agrandie le cas échéant) */
  image: Blob;
  job: JobView;
}

/**
 * Analyse une page : agrandissement, envoi, suivi, puis lecture du MusicXML et du découpage.
 * En mode 'auto', un interligne trop faible déclenche un seul réessai avec un facteur ≈ 22 / interligne
 * (arrondi au demi, borné à [1,5 ; 4]) — logique éprouvée dans la v0.
 */
async function runPage(key: string, font: string, scaleOpt: 'auto' | number, fontProposed: boolean): Promise<PageRun | null> {
  const p = pageOf(key);
  if (!p?.file) return null;
  const token = ++runSeq;
  runs.set(key, token);
  const alive = () => runs.get(key) === token && !!pageOf(key);
  const set = (patch: Partial<PageState>) => { if (alive()) updatePage(key, patch); };
  let scale = scaleOpt === 'auto' ? 1 : scaleOpt;
  set({ status: 'upload', scale, font, fontProposed: fontProposed || undefined, error: undefined, job: undefined,
        retried: undefined, xml: undefined, parsed: undefined, layout: undefined, perr: undefined });
  const follow = (j: JobView) => set({ job: j, status: j.status === 'done' || j.status === 'error' ? 'running' : j.status });
  try {
    let image = await scaleImage(p.file, scale);
    let job = await analyseImage(image, p.name, font, follow, alive);
    if (!alive()) return null;
    if (job.status === 'error' && scaleOpt === 'auto' && job.interlineTooLow && job.interline) {
      const factor = Math.min(4, Math.max(1.5, Math.round((22 / job.interline) * 2) / 2)) * scale;
      set({ retried: { from: job.interline, factor }, scale: factor, status: 'upload', job: undefined });
      scale = factor;
      image = await scaleImage(p.file, scale);
      job = await analyseImage(image, p.name, font, follow, alive);
      if (!alive()) return null;
    }
    if (job.status !== 'done') throw new Error(job.error || "Échec de l'analyse");
    const xml = await fetchMusicXml(job);
    let parsed, perr: string | undefined;
    try { parsed = readMusicXml(xml); } catch (e) { perr = msg(e); }
    const layout = await fetchLayout(job).catch(() => null);
    if (!alive()) return null;
    set({ status: 'done', job, xml, parsed, perr, layout: layout ?? undefined });
    reassemble();
    return { image, job };
  } catch (e) {
    set({ status: 'error', error: msg(e) });
    if (alive()) reassemble();
    return null;
  }
}

// ---------- Choix automatique de la police ----------

const setCalibration = (patch: Partial<Calibration>) =>
  setState(s => ({ calibration: { ...s.calibration, ...patch } }));

const setTrial = (font: string, patch: Partial<FontTrial>) =>
  setState(s => ({
    calibration: { ...s.calibration, trials: s.calibration.trials.map(t => (t.font === font ? { ...t, ...patch } : t)) },
  }));

/**
 * Essai des polices : la 1re page est d'abord analysée seule avec la police par défaut, ce qui donne
 * son découpage ; on en découpe les premiers systèmes (≥ 4 mesures) et on soumet cet extrait à
 * chaque police. La mieux notée est retenue ; la page 1 est réanalysée avec elle si besoin.
 * Renvoie la police retenue (la police par défaut si l'essai échoue).
 */
async function calibrate(key: string): Promise<{ font: string; rerun?: Promise<unknown> }> {
  const scaleMode = getState().scaleMode;
  setCalibration({ status: 'running', pageKey: key, trials: [], best: undefined, sample: undefined, validated: false,
                   message: `Analyse de la page 1 avec ${DEFAULT_FONT}, pour repérer ses premières mesures…` });
  const first = await runPage(key, DEFAULT_FONT, scaleMode, true);
  const layout = pageOf(key)?.layout;
  const fail = (message: string) => {
    setCalibration({ status: 'error', best: DEFAULT_FONT, message });
    setState({ font: DEFAULT_FONT });
    return { font: DEFAULT_FONT };
  };
  if (!first) return fail(`La page 1 n'a pas pu être analysée : essai des polices impossible, ${DEFAULT_FONT} est gardée.`);
  if (!layout) return fail(`Découpage de la page 1 indisponible : essai des polices impossible, ${DEFAULT_FONT} est gardée.`);
  const region = sampleRegion(layout, SAMPLE_MEASURES);
  if (!region) return fail(`Aucun système repéré sur la page 1 : essai des polices impossible, ${DEFAULT_FONT} est gardée.`);

  let sample: Blob;
  try { sample = await cropImage(first.image, region.rect); }
  catch (e) { return fail(`Découpe de l'extrait impossible (${msg(e)}) : ${DEFAULT_FONT} est gardée.`); }
  const name = (pageOf(key)?.name || 'page').replace(/(\.[^.]+)?$/, '-extrait.png');
  setCalibration({
    sample: region.measures,
    trials: TRIAL_FONTS.map(font => ({ font, status: 'pending', measures: 0, notes: 0, bad: 0, lost: 0, score: 0 })),
    message: `Essai des ${TRIAL_FONTS.length} polices sur les ${region.measures} premières mesures (${region.systems} système${region.systems > 1 ? 's' : ''})…`,
  });
  // Tous les essais partent ensemble : le serveur les traite l'un après l'autre.
  const results: (TrialMetrics & { font: string })[] = [];
  await Promise.all(TRIAL_FONTS.map(async font => {
    try {
      const job = await analyseImage(sample, name, font, j => setTrial(font, {
        status: j.status === 'queued' ? 'pending' : 'running', elapsedMs: j.elapsedMs,
      }));
      if (job.status !== 'done') throw new Error(job.error || 'échec');
      const m = trialMetrics(readMusicXml(await fetchMusicXml(job)), job.unplaced);
      results.push({ font, ...m });
      setTrial(font, { status: 'done', measures: m.measures, notes: m.notes, bad: m.bad, lost: m.lost,
                       score: fontScore(m), elapsedMs: job.elapsedMs });
    } catch (e) {
      setTrial(font, { status: 'error', error: msg(e) });
    }
  }));

  // dans l'ordre des essais (police par défaut d'abord), quel que soit l'ordre d'arrivée
  results.sort((a, b) => TRIAL_FONTS.indexOf(a.font) - TRIAL_FONTS.indexOf(b.font));
  const best = pickFont(results, DEFAULT_FONT);
  if (!best) return fail(`Aucun essai n'a abouti : ${DEFAULT_FONT} est gardée.`);
  setState({ font: best.font });
  setCalibration({
    status: 'done', best: best.font,
    message: best.font === DEFAULT_FONT
      ? `Aucune police ne fait mieux que ${best.font} sur l'extrait : elle est proposée pour toutes les pages.`
      : `${best.font} donne le meilleur résultat sur l'extrait : la page 1 est réanalysée avec elle, et les autres pages l'utilisent.`,
  });
  // Page 1 réanalysée avec la police retenue (même agrandissement : l'interligne est déjà connu). On ne
  // l'attend pas : les autres pages partent aussitôt derrière elle dans la file du serveur.
  const p = pageOf(key);
  const rerun = best.font !== DEFAULT_FONT && p ? runPage(key, best.font, p.scale, true) : undefined;
  return { font: best.font, rerun };
}

// ---------- Actions de l'interface ----------

let analysing = false;

/** Analyse les pages en attente ou en échec (bouton « Analyser »). */
export async function analysePending(): Promise<void> {
  if (analysing) return;
  analysing = true;
  try {
    const s = getState();
    let todo = s.pages.filter(p => p.file && (p.status === 'pending' || p.status === 'error'));
    if (!todo.length) return;
    let font = s.font;
    let proposed = s.autoFont && !s.calibration.validated && s.calibration.status !== 'idle';
    let rerun: Promise<unknown> | undefined;
    if (s.autoFont && !s.calibration.validated && s.calibration.status !== 'done') {
      // l'essai se fait sur la première page de la liste, même si elle est déjà analysée
      const firstKey = s.pages.find(p => p.file)!.key;
      ({ font, rerun } = await calibrate(firstKey));
      proposed = true;
      todo = getState().pages.filter(p => p.file && p.key !== firstKey && todo.some(t => t.key === p.key));
    }
    const scaleMode = getState().scaleMode;
    await Promise.all([rerun, ...todo.map(p => runPage(p.key, font, scaleMode, proposed))]);
  } finally {
    analysing = false;
  }
}

/** Relance une page avec une police et un agrandissement choisis (choix explicite : plus « proposée »). */
export function rerunPage(key: string, font: string, scale: 'auto' | number): Promise<unknown> {
  return runPage(key, font, scale, false);
}

/** L'utilisateur accepte la police proposée par l'essai. */
export function validateFont(): void {
  setCalibration({ validated: true });
  setState(s => ({ pages: s.pages.map(p => (p.fontProposed ? { ...p, fontProposed: undefined } : p)) }));
}

/** L'utilisateur préfère une autre police : toutes les pages sont relancées avec elle. */
export async function rerunAllWithFont(font: string): Promise<void> {
  setState({ font });
  setCalibration({ validated: true });
  const s = getState();
  await Promise.all(s.pages.filter(p => p.file).map(p => runPage(p.key, font, p.status === 'done' ? p.scale : s.scaleMode, false)));
}

/** Analyse en cours (au moins une page ou un essai non terminé) ? */
export const isBusy = (s = getState()) =>
  s.calibration.status === 'running' || s.pages.some(p => p.status === 'upload' || p.status === 'queued' || p.status === 'running');
