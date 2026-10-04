// Étape 2 : progression de l'analyse page par page, choix de la police, résumé du projet assemblé, et
// pour chaque page la comparaison image d'origine / partition reconstruite avec ses mesures signalées.
import { memo, useEffect, useMemo, useState } from 'react';
import { findIssues } from '../../model/check';
import { writeMusicXml } from '../../model/musicxml-write';
import { DURATIONS, durationName, keyLabel } from '../../model/pitch';
import type { Issue, IssueKind, Project } from '../../model/types';
import { setState, useStore, type Calibration, type PageState } from '../../state/store';
import { FONT_LABELS, isBusy, isSpread, rerunAllWithFont, rerunPage, validateFont } from '../../analysis/run';
import { OsmdView } from '../common/OsmdView';
import { StatusBadge } from '../import/ImportStep';
import { FoldHead, setFolded, useAllFolded, useFolded } from './fold';
import './AnalyseStep.css';

const secs = (ms?: number) => `${((ms || 0) / 1000).toFixed(1).replace('.', ',')} s`;
const fmtScale = (f: number) => '×' + String(f).replace('.', ',');

/** Fond des mesures signalées sur la partition reconstruite (translucide : les notes restent lisibles). */
const CELL_FILL: Record<IssueKind, string> = {
  rhythm: 'rgba(232,89,12,.16)', gap: 'rgba(232,89,12,.16)', lost: 'rgba(232,89,12,.16)', empty: 'rgba(214,51,108,.22)',
};

/** Lignes dans l'ordre des portées du MusicXML écrit (regroupées par partie, cf. writeMusicXml). */
function staffOrder(p: Project): string[] {
  const parts = new Map<number, string[]>();
  for (const l of p.lines) {
    if (!parts.has(l.part)) parts.set(l.part, []);
    parts.get(l.part)!.push(l.id);
  }
  return [...parts.values()].flat();
}

function safeIssues(p: Project | null): { issues: Issue[]; error?: string } {
  if (!p) return { issues: [] };
  try { return { issues: findIssues(p) }; }
  catch (e) { return { issues: [], error: e instanceof Error ? e.message : String(e) }; }
}

export function AnalyseStep() {
  const pages = useStore(s => s.pages);
  const project = useStore(s => s.project);
  const warnings = useStore(s => s.warnings);
  const calibration = useStore(s => s.calibration);
  const busy = useStore(s => isBusy(s));
  const { issues, error } = useMemo(() => safeIssues(project), [project]);
  const lineOrder = useMemo(() => (project ? staffOrder(project) : []), [project]);

  // toutes les zones repliables de l'étape (pour « Tout replier / Tout déplier »)
  const foldIds = useMemo(() => [
    'progress', ...(calibration.status !== 'idle' ? ['calibration'] : []), ...(project ? ['summary'] : []),
    ...pages.map(p => 'page:' + p.key),
  ], [calibration.status, project, pages]);

  return (
    <>
      <StepNav busy={busy} canGo={!!project} foldIds={foldIds} />
      <Progress pages={pages} busy={busy} />
      {calibration.status !== 'idle' && <CalibrationPanel c={calibration} busy={busy} />}
      {project && <Summary project={project} issues={issues} pages={pages.length} />}
      {error && <div className="note err">Contrôle des mesures impossible : {error}</div>}
      {warnings.map((w, i) => <div key={i} className="note warn">{w}</div>)}
      {pages.map((p, i) => (
        <PageCard key={p.key} p={p} index={i} project={project} issues={issues} lineOrder={lineOrder} />
      ))}
      <StepNav busy={busy} canGo={!!project} />
    </>
  );
}

/** Navigation de l'étape, en haut et en bas : pas besoin de descendre tout en bas pour passer à la suite. */
function StepNav({ busy, canGo, foldIds }: { busy: boolean; canGo: boolean; foldIds?: string[] }) {
  const allFolded = useAllFolded(foldIds ?? []);
  return (
    <div className="row">
      <button className="btn" onClick={() => setState({ step: 'import' })}>← Pages</button>
      {foldIds && foldIds.length > 0 && (
        <button className="btn" onClick={() => setFolded(foldIds, !allFolded)}
                title="Replier les zones déjà lues pour ne garder que leurs en-têtes">
          {allFolded ? '▾ Tout déplier' : '▸ Tout replier'}
        </button>
      )}
      <span className="spacer" />
      {busy && <small><span className="spin" /> analyse en cours…</small>}
      <button className="btn primary" disabled={!canGo} onClick={() => setState({ step: 'score' })}>Relire et écouter →</button>
    </div>
  );
}

// ---------- Progression ----------

function Progress({ pages, busy }: { pages: PageState[]; busy: boolean }) {
  const done = pages.filter(p => p.status === 'done').length;
  const failed = pages.filter(p => p.status === 'error').length;
  const folded = useFolded('progress');
  return (
    <section className="card">
      <FoldHead id="progress" title="Analyse" level={2}>
        <span className="badge">{done} / {pages.length} page{pages.length > 1 ? 's' : ''} analysée{done > 1 ? 's' : ''}</span>
        {failed > 0 && <span className="badge err">{failed} en échec</span>}
        {busy && <span className="spin" />}
      </FoldHead>
      <div className="an-bar" aria-hidden><i style={{ width: `${pages.length ? (done + failed) / pages.length * 100 : 0}%` }} /></div>
      {!folded && <ol className="an-progress">
        {pages.map((p, i) => (
          <li key={p.key}>
            <b>{i + 1}</b>
            <span className="an-pname" title={p.name}>{p.name}</span>
            <StatusBadge p={p} />
            {p.status === 'done' && p.job && <small>{secs(p.job.elapsedMs)}</small>}
            {p.status === 'error' && p.error && <small className="an-err">{p.error}</small>}
          </li>
        ))}
      </ol>}
    </section>
  );
}

// ---------- Choix de la police ----------

function CalibrationPanel({ c, busy }: { c: Calibration; busy: boolean }) {
  const fonts = useStore(s => s.server.fonts);
  const current = useStore(s => s.font);
  const [other, setOther] = useState(current);
  useEffect(() => setOther(current), [current]);
  const list = fonts.length ? fonts : Object.keys(FONT_LABELS);
  const ranked = c.trials.filter(t => t.status === 'done');
  const folded = useFolded('calibration');
  return (
    <section className="card">
      <FoldHead id="calibration" title="Choix de la police">
        {c.status === 'running' && <span className="spin" />}
        {c.validated ? <span className="badge ok">police retenue : {current}</span>
          : c.best ? <span className="badge warn">proposée : {c.best}</span> : null}
      </FoldHead>
      {!folded && <>
      <small>
        Audiveris compare les têtes de notes aux dessins d'une police de référence. Les premières mesures de la page 1
        ont été analysées avec chacune ; la note favorise les mesures bien remplies et pénalise les mesures fausses ou
        vides et les symboles perdus.
      </small>
      {c.message && <div className={'note ' + (c.status === 'error' ? 'warn' : 'info')}>
        {c.status === 'running' && <span className="spin" />} {c.message}
      </div>}
      {c.trials.length > 0 && (
        <div className="an-scroll">
          <table className="an-table">
            <thead>
              <tr><th>Police</th><th>Mesures</th><th>Notes</th><th>Mesures fausses</th><th>Symboles perdus</th><th>Score</th><th>Durée</th></tr>
            </thead>
            <tbody>
              {c.trials.map(t => (
                <tr key={t.font} className={t.font === c.best ? 'an-best' : ''}>
                  <td>{t.font}{t.font === c.best && ' ★'}</td>
                  {t.status === 'done' ? (
                    <>
                      <td>{t.measures}</td><td>{t.notes}</td><td>{t.bad}</td><td>{t.lost}</td>
                      <td><b>{t.score.toFixed(1).replace('.', ',')}</b></td><td>{secs(t.elapsedMs)}</td>
                    </>
                  ) : t.status === 'error' ? (
                    <td colSpan={6} className="an-err">échec : {t.error}</td>
                  ) : (
                    <td colSpan={6} className="muted">
                      {t.status === 'running' ? <><span className="spin" /> analyse {secs(t.elapsedMs)}</> : 'en attente'}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {c.status !== 'running' && (
        <div className="row" style={{ marginTop: 10 }}>
          {c.best && !c.validated && ranked.length > 0 && (
            <>
              <span>Police proposée : <b>{c.best}</b></span>
              <button className="btn sm primary" onClick={validateFont} disabled={busy}>Valider</button>
              <span className="muted">ou</span>
            </>
          )}
          {c.validated && <span>Police retenue : <b>{current}</b></span>}
          <label>{c.validated ? 'Changer pour ' : 'choisir '}
            <select value={other} onChange={e => setOther(e.target.value)}>
              {list.map(f => <option key={f} value={f}>{FONT_LABELS[f] || f}</option>)}
            </select>
          </label>
          <button className="btn sm" disabled={busy} onClick={() => void rerunAllWithFont(other)}>Relancer toutes les pages</button>
        </div>
      )}
      </>}
    </section>
  );
}

// ---------- Résumé du projet ----------

function Summary({ project, issues, pages }: { project: Project; issues: Issue[]; pages: number }) {
  const facts = useMemo(() => {
    const notes = project.lines.flatMap(l => l.notes.filter(n => n.pitch));
    const counts = new Map<string, number>();
    for (const n of notes) counts.set(durationName(n.duration), (counts.get(durationName(n.duration)) || 0) + 1);
    const order = DURATIONS.map(d => d.name);
    const durs = [...counts].sort((a, b) => ((order.indexOf(a[0]) + 1) || 99) - ((order.indexOf(b[0]) + 1) || 99))
      .map(([k, v]) => `${k} ${v}`).join(' · ');
    const m0 = project.measures[0];
    const metres = new Set(project.measures.map(m => `${m.beats}/${m.beatType}`));
    const flagged = new Set(issues.filter(i => !i.checked).map(i => i.measure)).size;
    return {
      notes: notes.length, durs: durs || '—',
      key: m0 ? keyLabel(m0.fifths, m0.mode) : '—',
      metre: m0 ? `${m0.beats}/${m0.beatType}${metres.size > 1 ? ' (variable)' : ''}` : '—',
      flagged,
    };
  }, [project, issues]);
  const folded = useFolded('summary');
  return (
    <section className="card">
      <FoldHead id="summary" title="Partition assemblée">
        {folded && <span className="badge">{project.measures.length} mesures</span>}
        {folded && <span className={'badge ' + (facts.flagged ? 'err' : 'ok')}>{facts.flagged} signalée{facts.flagged > 1 ? 's' : ''}</span>}
      </FoldHead>
      {!folded && <>
      <div className="facts">
        <div className="fact"><small>Pages</small><b>{project.pages.length} / {pages}</b></div>
        <div className="fact"><small>Lignes</small><b>{project.lines.length}</b></div>
        <div className="fact"><small>Mesures</small><b>{project.measures.length}</b></div>
        <div className="fact"><small>Notes</small><b>{facts.notes}</b></div>
        <div className="fact"><small>Tonalité</small><b>{facts.key}</b></div>
        <div className="fact"><small>Métrique</small><b>{facts.metre}</b></div>
        <div className="fact"><small>Mesures signalées</small><b className={facts.flagged ? 'an-err' : ''}>{facts.flagged}</b></div>
      </div>
      <small>Durées : {facts.durs}</small>
      </>}
    </section>
  );
}

// ---------- Une page ----------

const SCALE_CHOICES: ('auto' | number)[] = ['auto', 1, 1.5, 2, 3, 4];

interface PageCardProps {
  p: PageState;
  index: number;
  project: Project | null;
  issues: Issue[];
  lineOrder: string[];
}

const PageCard = memo(function PageCard({ p, index, project, issues, lineOrder }: PageCardProps) {
  const fonts = useStore(s => s.server.fonts);
  const [font, setFont] = useState(p.font);
  const [scale, setScale] = useState<'auto' | number>(p.scale);
  useEffect(() => setFont(p.font), [p.font]);
  useEffect(() => setScale(p.scale), [p.scale]);

  // Mesures de la page dans le projet assemblé
  const range = useMemo((): [number, number] | null => {
    if (!project) return null;
    let a = -1, b = -1;
    project.measures.forEach((m, i) => { if (m.pageKey === p.key) { if (a < 0) a = i; b = i; } });
    return a < 0 ? null : [a, b];
  }, [project, p.key]);

  const pageIssues = useMemo(
    () => (range ? issues.filter(i => i.measure >= range[0] && i.measure <= range[1]) : []), [issues, range]);

  const { xml, cellColors, xmlError } = useMemo(() => {
    if (!project || !range) return { xml: '', cellColors: undefined, xmlError: '' };
    const colors = new Map<string, IssueKind>();
    for (const i of pageIssues) {
      if (i.checked) continue;
      const k = `${i.measure}|${i.lineId}`;
      if (colors.get(k) !== 'empty') colors.set(k, i.kind);   // une mesure vide reste rouge
    }
    const fills = new Map([...colors].map(([k, kind]) => [k, CELL_FILL[kind]]));
    try {
      return { xml: writeMusicXml(project, { range, colors, keepLayout: true }), cellColors: fills, xmlError: '' };
    } catch (e) {
      return { xml: '', cellColors: fills, xmlError: e instanceof Error ? e.message : String(e) };
    }
  }, [project, range, pageIssues]);

  const lineName = useMemo(() => new Map(project?.lines.map(l => [l.id, l.name]) ?? []), [project]);
  const running = p.status === 'upload' || p.status === 'queued' || p.status === 'running';
  const nMeasures = range ? range[1] - range[0] + 1 : p.job?.measures;
  const flagged = new Set(pageIssues.filter(i => !i.checked).map(i => i.measure)).size;
  const open = (measure: number, lineId?: string) => setState({ step: 'score', selection: { measure, lineId } });

  const download = () => {
    if (!p.xml) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([p.xml], { type: 'application/vnd.recordare.musicxml+xml' }));
    a.download = p.name.replace(/\.[^.]+$/, '') + '.musicxml';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };

  const folded = useFolded('page:' + p.key);
  return (
    <section className="card an-page">
      <FoldHead id={'page:' + p.key} title={`Page ${index + 1}`}>
        <span className="muted an-pname" title={p.name}>{p.name}</span>
        <StatusBadge p={p} />
        {p.status === 'done' && p.job && <span className="badge">{secs(p.job.elapsedMs)}</span>}
        <span className={'badge' + (p.fontProposed ? ' warn' : '')}
              title={p.fontProposed ? "Police choisie par l'essai automatique, à valider" : undefined}>
          police {p.font}{p.fontProposed ? ' — proposée' : ''}
        </span>
        {p.scale !== 1 && <span className="badge warn">agrandie {fmtScale(p.scale)}</span>}
        {p.job?.interline != null && <span className={'badge' + (p.job.interlineTooLow ? ' err' : '')}>interligne {p.job.interline} px</span>}
        {nMeasures != null && <span className="badge">{nMeasures} mesures</span>}
        {range && (flagged ? <span className="badge err">{flagged} mesure{flagged > 1 ? 's' : ''} à vérifier</span>
                           : <span className="badge ok">rythme cohérent</span>)}
      </FoldHead>

      {!folded && <>
      {p.file && (
        <div className="row an-rerun">
          <label>Police{' '}
            <select value={font} onChange={e => setFont(e.target.value)} disabled={running}>
              {(fonts.length ? fonts : Object.keys(FONT_LABELS)).map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </label>
          <label>Agrandissement{' '}
            <select value={String(scale)} disabled={running}
                    onChange={e => setScale(e.target.value === 'auto' ? 'auto' : +e.target.value)}>
              {[...new Set([...SCALE_CHOICES, p.scale])].map(f =>
                <option key={String(f)} value={String(f)}>{f === 'auto' ? 'auto' : fmtScale(f)}</option>)}
            </select>
          </label>
          <button className="btn sm" disabled={running} onClick={() => void rerunPage(p.key, font, scale)}>Relancer</button>
          <span className="spacer" />
          {p.xml && <button className="btn sm" onClick={download}>MusicXML brut</button>}
        </div>
      )}

      {p.retried && (
        <div className="note warn">
          Résolution trop faible (interligne {p.retried.from} px) : image agrandie automatiquement {fmtScale(p.retried.factor)} et analysée à nouveau.
        </div>
      )}
      {p.status === 'error' && p.error && <div className="note err">{p.error}</div>}
      {p.perr && <div className="note err">Lecture du MusicXML impossible : {p.perr}</div>}
      {xmlError && <div className="note err">Affichage impossible : {xmlError}</div>}
      {(p.job?.scores.length ?? 0) > 1 && (
        <div className="note warn">
          Audiveris a découpé cette page en {p.job!.scores.length} morceaux : seul le premier est lu.
        </div>
      )}
      {isSpread(p) && (
        <div className="note warn">
          Cette image est plus large que haute. S'il s'agit de deux pages côte à côte, découpez-la en deux avant
          d'analyser : Audiveris cherche les systèmes sur toute la largeur et mélange les deux pages.
        </div>
      )}

      {pageIssues.length > 0 && project && (
        <details className="an-issues" open={pageIssues.length <= 8}>
          <summary>{pageIssues.length} signalement{pageIssues.length > 1 ? 's' : ''} sur cette page</summary>
          <ul>
            {pageIssues.map((i, k) => (
              <li key={k} className={i.checked ? 'muted' : ''}>
                <button className="an-link" onClick={() => open(i.measure, i.lineId)}>
                  Mesure {project.measures[i.measure]?.label ?? i.measure + 1}
                </button>
                {' '}— {lineName.get(i.lineId) ?? i.lineId} : {i.text}
                {i.checked && ' — validée'}
              </li>
            ))}
          </ul>
          <small>
            Sur la partition reconstruite : <b style={{ color: 'var(--diag-rhythm)' }}>orange</b> = rythme faux ou note
            perdue par Audiveris, <b style={{ color: 'var(--diag-empty)' }}>rouge</b> = aucune note reconnue. Cliquer une
            mesure l'ouvre dans l'éditeur.
          </small>
        </details>
      )}

      <div className="an-cmp">
        <div className="an-pane">
          <div className="an-lbl">Image d'origine</div>
          {p.url ? <img src={p.url} alt={`Page ${index + 1}`} /> : <div className="muted an-empty">Image non conservée (projet rechargé).</div>}
        </div>
        <div className="an-pane">
          <div className="an-lbl">Partition reconstruite</div>
          {xml && range ? (
            <OsmdView xml={xml} keepLayout firstMeasure={range[0]} lineOrder={lineOrder} cellColors={cellColors}
                      onMeasureClick={open} />
          ) : (
            <div className="muted an-empty">
              {running ? <><span className="spin" /> En attente du résultat…</> : p.status === 'error' ? 'Aucun résultat.' : p.status === 'pending' ? 'Pas encore analysée.' : '—'}
            </div>
          )}
        </div>
      </div>

      {p.job && (
        <details className="an-log">
          <summary>Journal Audiveris</summary>
          <pre>{p.job.log.join('\n')}</pre>
        </details>
      )}
      </>}
    </section>
  );
});
