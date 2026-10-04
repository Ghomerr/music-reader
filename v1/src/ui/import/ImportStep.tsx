// Étape 1 : choix des pages (une image = une page de partition), options d'analyse, ou ouverture
// d'un projet déjà enregistré.
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { parseProject } from '../../model/project-io';
import { resetHistory, setProject, setState, useStore, type PageState } from '../../state/store';
import { addFiles, analysePending, clearPages, FONT_LABELS, isBusy, isSpread, movePage, removePage } from '../../analysis/run';
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
