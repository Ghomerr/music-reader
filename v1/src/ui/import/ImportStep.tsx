// Étape 1 : choix des pages (une image = une page de partition), options d'analyse, ou ouverture
// d'un projet déjà enregistré. Deux autres départs, sans image : une partition vierge à écrire soi-même,
// ou le projet d'exemple.
import { useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { createBlankProject, FORMATIONS, MAX_BLANK_MEASURES, type Formation } from '../../model/blank';
import { keyLabel } from '../../model/pitch';
import { parseProject } from '../../model/project-io';
import { getState, resetHistory, setProject, setState, useStore, type PageState } from '../../state/store';
import { addFiles, analysePending, clearPages, FONT_LABELS, isBusy, isSpread, movePage, removePage } from '../../analysis/run';
import { track } from '../../stats';
import { startTour } from '../tutorial';
import { openDemo } from './demo';
import './ImportStep.css';

const SPREAD_HINT = "Audiveris attend une page de partition par image. Un scan de deux pages en vis-à-vis produit des "
  + "systèmes et des mesures incohérents : découper l'image avant de l'analyser.";

const SCALES: { value: 'auto' | number; label: string }[] = [
  { value: 'auto', label: 'Auto (réessai si résolution trop faible)' },
  { value: 1, label: 'Aucun (×1)' },
  { value: 1.5, label: '×1,5' },
  { value: 2, label: '×2' },
  { value: 3, label: '×3' },
];

export function StatusBadge({ p }: { p: PageState }) {
  switch (p.status) {
    case 'pending': return <span className="badge">à analyser</span>;
    case 'upload': return <span className="badge run"><span className="spin" /> envoi</span>;
    case 'queued': return <span className="badge run">en file{p.job?.queuePosition ? ` (${p.job.queuePosition})` : ''}</span>;
    case 'running': return <span className="badge run"><span className="spin" /> analyse {Math.round((p.job?.elapsedMs || 0) / 1000)} s</span>;
    case 'done': return <span className="badge ok">terminé</span>;
    case 'error': return <span className="badge err">échec</span>;
  }
}

const METERS: [number, number][] = [[2, 4], [3, 4], [4, 4], [6, 8], [3, 8], [2, 2]];

/** Armures dans l'ordre des altérations : Do, puis les dièses, puis les bémols (majeur, puis mineur). */
const KEYS = (['major', 'minor'] as const).flatMap(mode => [0, 1, 2, 3, 4, 5, 6, 7, -1, -2, -3, -4, -5, -6, -7].map(f => ({
  value: `${f}|${mode}`, mode,
  label: `${keyLabel(f, mode)}${f ? ` (${Math.abs(f)} ${f > 0 ? '♯' : '♭'})` : ''}`,
})));

/** Un projet en cours (analysé, corrigé) serait remplacé : on demande avant de le fermer. */
const confirmReplace = () => !getState().project
  || window.confirm('Le projet en cours sera fermé. Pour le garder, exportez-le d\'abord (« Projet (.json) » dans « Relire et écouter »). Continuer ?');

/** « Nouvelle partition vierge » : replié par défaut, pour ne pas encombrer l'écran. */
function BlankScore() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [formation, setFormation] = useState<Formation>('chant-piano');
  const [meter, setMeter] = useState('4/4');
  const [key, setKey] = useState('0|major');
  const [count, setCount] = useState(8);

  const create = (e: FormEvent) => {
    e.preventDefault();
    if (!confirmReplace()) return;
    const [beats, beatType] = meter.split('/').map(Number);
    const [f, mode] = key.split('|');
    const project = createBlankProject({
      title, beats, beatType, fifths: Number(f), mode: mode === 'minor' ? 'minor' : 'major', measures: count, formation,
    });
    clearPages();
    resetHistory();
    setProject(project, []);
    // l'éditeur s'ouvre sur la première mesure : on peut écrire tout de suite
    setState({ pages: [], step: 'score', selection: { measure: 0, lineId: project.lines[0].id } });
    track('partition_vierge', { formation, metrique: meter, mesures: project.measures.length });
  };

  return (
    <div className={'import-way' + (open ? ' open' : '')} data-tour="blank-score">
      <h3>Nouvelle partition vierge</h3>
      <small>Écrire soi-même une partition, mesure par mesure, sans image de départ.</small>
      {!open ? (
        <button className="btn" onClick={() => setOpen(true)} aria-expanded={false}>✎ Créer une partition…</button>
      ) : (
        <form className="import-blank" onSubmit={create}>
          <label>Titre
            <input type="text" value={title} placeholder="Nouvelle partition" maxLength={120} onChange={e => setTitle(e.target.value)} />
          </label>
          <label>Formation
            <select value={formation} onChange={e => setFormation(e.target.value as Formation)}>
              {FORMATIONS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </label>
          <label>Métrique
            <select value={meter} onChange={e => setMeter(e.target.value)}>
              {METERS.map(([b, t]) => <option key={`${b}/${t}`} value={`${b}/${t}`}>{b}/{t}</option>)}
            </select>
          </label>
          <label>Tonalité
            <select value={key} onChange={e => setKey(e.target.value)}>
              <optgroup label="Majeur">{KEYS.filter(k => k.mode === 'major').map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</optgroup>
              <optgroup label="Mineur">{KEYS.filter(k => k.mode === 'minor').map(k => <option key={k.value} value={k.value}>{k.label}</option>)}</optgroup>
            </select>
          </label>
          <label>Mesures
            <input type="number" min={1} max={MAX_BLANK_MEASURES} value={count}
                   onChange={e => setCount(Math.max(1, Math.min(MAX_BLANK_MEASURES, Math.round(+e.target.value) || 1)))} />
          </label>
          <div className="row import-blank-go">
            <button type="button" className="btn" onClick={() => setOpen(false)}>Annuler</button>
            <button type="submit" className="btn primary">Créer et écrire →</button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Les départs sans image : partition vierge, exemple, visite guidée. */
function OtherStarts() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const demo = async () => {
    if (!confirmReplace()) return;
    setBusy(true);
    setError('');
    try { await openDemo(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };
  return (
    <section className="card import-ways" aria-label="Autres façons de commencer">
      <BlankScore />
      <div className="import-way">
        <h3>Essayer avec un exemple</h3>
        <small>« Au clair de la lune », chant et piano, avec une mesure à corriger.</small>
        <button className="btn" data-tour="demo" onClick={demo} disabled={busy}>
          {busy ? <span className="spin" /> : '♪'} Ouvrir l'exemple
        </button>
        {error && <div className="note err">{error}</div>}
      </div>
      <div className="import-way">
        <h3>Première visite ?</h3>
        <small>Une visite guidée présente chaque écran, pas à pas.</small>
        <button className="btn" data-tour="tour-invite" onClick={() => startTour('import')}>🎓 Visite guidée</button>
      </div>
    </section>
  );
}

export function ImportStep() {
  const pages = useStore(s => s.pages);
  const autoFont = useStore(s => s.autoFont);
  const font = useStore(s => s.font);
  const scaleMode = useStore(s => s.scaleMode);
  const fonts = useStore(s => s.server.fonts);
  const audiveris = useStore(s => s.server.audiveris);
  const busy = useStore(s => isBusy(s));
  const [over, setOver] = useState(false);
  const [projectError, setProjectError] = useState('');
  const fileIn = useRef<HTMLInputElement>(null);
  const cameraIn = useRef<HTMLInputElement>(null);
  const projectIn = useRef<HTMLInputElement>(null);

  const onFiles = (e: ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = '';
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    addFiles(e.dataTransfer.files);
  };

  const openProject = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const project = parseProject(await f.text());
      clearPages();
      resetHistory();
      setProject(project, []);
      // Pages sans image : elles ne servent qu'à l'affichage (police, agrandissement d'origine).
      setState({
        pages: project.pages.map(m => ({ key: m.key, file: null, name: m.name, url: '', status: 'done', scale: m.scale, font: m.font })),
        step: 'score', selection: null,
      });
      setProjectError('');
      track('projet_charge', { pages: project.pages.length, mesures: project.measures.length });
    } catch (err) {
      setProjectError(`${f.name} : ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const images = pages.filter(p => p.file);
  const pending = images.filter(p => p.status === 'pending' || p.status === 'error').length;
  const analysed = images.some(p => p.status !== 'pending');
  const run = () => {
    setState({ step: 'analyse' });
    void analysePending();
  };
  const fontList = fonts.length ? fonts : Object.keys(FONT_LABELS);

  return (
    <>
      <OtherStarts />

      <section className="card">
        <h2>Pages à analyser</h2>
        <small>
          Images PNG ou JPG d'une même musique, dans l'ordre de lecture — <b>une page de partition par image</b>.
          Chaque page est analysée par Audiveris, puis les pages sont mises bout à bout.
        </small>

        <label className={'import-drop' + (over ? ' over' : '')}
               onDragOver={e => { e.preventDefault(); setOver(true); }} onDragEnter={() => setOver(true)}
               onDragLeave={() => setOver(false)} onDrop={onDrop}>
          <input ref={fileIn} type="file" accept="image/*" multiple hidden onChange={onFiles} />
          <b>Glissez des images ici ou cliquez pour choisir</b><br />
          <small>Plusieurs fichiers possibles</small>
        </label>
        <div className="row">
          <button className="btn" onClick={() => cameraIn.current?.click()}>📷 Prendre une photo</button>
          <input ref={cameraIn} type="file" accept="image/*" capture="environment" hidden onChange={onFiles} />
          <button className="btn" onClick={() => projectIn.current?.click()}>📂 Ouvrir un projet (.json)</button>
          <input ref={projectIn} type="file" accept=".json,application/json" hidden onChange={openProject} />
          <span className="spacer" />
          {pages.length > 0 && <button className="btn" onClick={clearPages} disabled={busy}>Tout retirer</button>}
        </div>
        {projectError && <div className="note err">Ouverture impossible — {projectError}</div>}

        {pages.length > 0 && (
          <ol className="import-grid">
            {pages.map((p, i) => (
              <li key={p.key} className="import-thumb">
                <div className="import-img">
                  <b className="import-num">{i + 1}</b>
                  {p.url ? <img src={p.url} alt={`Page ${i + 1}`} /> : <span className="muted">projet rechargé</span>}
                </div>
                <div className="import-name" title={p.name}>{p.name}</div>
                <div className="row import-meta">
                  {p.w && <small>{p.w}×{p.h} px</small>}
                  {isSpread(p) && <span className="badge warn" title={SPREAD_HINT}>⚠ deux pages ?</span>}
                  <StatusBadge p={p} />
                </div>
                <div className="row import-actions">
                  <button className="btn sm" onClick={() => movePage(p.key, -1)} disabled={i === 0} aria-label="Avancer">←</button>
                  <button className="btn sm" onClick={() => movePage(p.key, 1)} disabled={i === pages.length - 1} aria-label="Reculer">→</button>
                  <span className="spacer" />
                  <button className="btn sm" onClick={() => removePage(p.key)} aria-label="Retirer">✕</button>
                </div>
              </li>
            ))}
          </ol>
        )}
        {pages.some(isSpread) && (
          <div className="note warn">
            Une image au moins est plus large que haute. S'il s'agit de deux pages côte à côte, découpez-la en deux
            avant d'analyser : Audiveris cherche les systèmes sur toute la largeur et mélange les deux pages.
          </div>
        )}
      </section>

      <section className="card">
        <h3>Options d'analyse</h3>
        <label className="import-opt">
          <input type="checkbox" checked={autoFont} onChange={e => setState({ autoFont: e.target.checked })} />
          <span>
            <b>Choisir la police automatiquement sur la 1re page</b><br />
            <small>
              Audiveris reconnaît les notes en les comparant aux dessins d'une police de référence, et la bonne police
              dépend de la gravure (sans elle, des rondes ou des barres de mesure disparaissent). Les premières mesures
              de la page 1 sont analysées avec chaque police ; la meilleure est proposée pour toutes les pages, à valider ensuite.
            </small>
          </span>
        </label>
        <div className="row" style={{ marginTop: 10 }}>
          {!autoFont && (
            <label>Police des têtes{' '}
              <select value={font} onChange={e => setState({ font: e.target.value })}>
                {fontList.map(f => <option key={f} value={f}>{FONT_LABELS[f] || f}</option>)}
              </select>
            </label>
          )}
          <label>Agrandissement{' '}
            <select value={String(scaleMode)}
                    onChange={e => setState({ scaleMode: e.target.value === 'auto' ? 'auto' : +e.target.value })}>
              {SCALES.map(s => <option key={String(s.value)} value={String(s.value)}>{s.label}</option>)}
            </select>
          </label>
          <span className="spacer" />
          {analysed && <button className="btn" onClick={() => setState({ step: 'analyse' })}>Voir l'analyse</button>}
          <button className="btn primary" onClick={run} disabled={!pending || !audiveris}
                  title={!audiveris ? "Le serveur d'analyse n'est pas disponible" : undefined}>
            {analysed ? `Analyser les pages restantes (${pending})` : 'Analyser'}
          </button>
        </div>
      </section>
    </>
  );
}
