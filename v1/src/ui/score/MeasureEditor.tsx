// Éditeur de mesure : correction manuelle des notes et des paroles, une portée par ligne.
// Toutes les modifications passent par editProject (annulables) ; les diagnostics, recalculés par
// ScoreStep sur le nouveau projet, montrent la mesure se « réparer » à vue.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Issue, NoteEvent, Project } from '../../model/types';
import { durationName, keyLabel, pitchLabel } from '../../model/pitch';
import { editProject, getState, newId, setState } from '../../state/store';
import { playMeasure } from '../../audio/player';
import { lineColor } from '../player/colors';
import {
  FIGURES, deleteEvent, figureDuration, figureOf, insertEvent, measureLength, measureNotes, movePitch, replaceMeasureNotes,
  setAlter, setDuration, setLyric, toggleTie, versesOf, type EditCtx, type Figure, type NewEvent,
} from './edit';
import { FigureIcon } from './Glyphs';
import { KIND_LABEL, kindClass } from './IssueList';
import { OriginalExcerpt } from './OriginalExcerpt';
import { StaffEditor, type Tool } from './StaffEditor';

interface Props {
  project: Project;
  issues: Issue[];
  selection: { measure: number; lineId?: string };
}

const isField = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');

export function MeasureEditor({ project, issues, selection }: Props) {
  const m = selection.measure;
  const measure = project.measures[m];
  const [fig, setFig] = useState<Figure>({ base: 1, dots: 0, triplet: false });
  const [rest, setRest] = useState(false);
  const [insert, setInsert] = useState(false);
  const [shift, setShift] = useState(true);
  const [voice, setVoice] = useState(1);
  const [verse, setVerse] = useState(1);
  const [sel, setSel] = useState<{ lineId: string; id: string } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  // Les ids de notes ne survivent pas à un rechargement ni à certaines opérations : une sélection
  // qui ne retrouve plus sa note se désélectionne simplement.
  const selNote: NoteEvent | undefined = sel
    ? project.lines.find(l => l.id === sel.lineId)?.notes.find(n => n.id === sel.id && n.measure === m)
    : undefined;
  useEffect(() => { if (sel && !selNote) setSel(null); }, [sel, selNote]);
  useEffect(() => { setSel(null); }, [m]);

  const activeLine = sel?.lineId ?? selection.lineId ?? project.lines[0]?.id;

  // La ligne visée (clic sur la partition ou la liste) est amenée à l'écran dans le tiroir.
  useEffect(() => {
    if (!selection.lineId) return;
    bodyRef.current?.querySelector(`[data-line="${CSS.escape(selection.lineId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [m, selection.lineId]);

  const verses = useMemo(() => {
    const s = new Set<number>();
    for (const l of project.lines) for (const v of versesOf(l)) s.add(v);
    return [...s].sort((a, b) => a - b);
  }, [project.lines]);
  // Champs de paroles : d'office sur les lignes qui en portent (le chant), à la demande ailleurs.
  const withLyrics = useMemo(() => new Set(project.lines.filter(l => l.notes.some(n => n.lyrics?.length)).map(l => l.id)), [project.lines]);
  const [lyricToggles, setLyricToggles] = useState<Set<string>>(() => new Set());
  const maxVoice = useMemo(() => Math.max(1, ...project.lines.flatMap(l => measureNotes(l, m).map(n => n.voice))), [project.lines, m]);

  // gestionnaire clavier relu à chaque rendu (état courant), écouteur posé une seule fois
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  if (!measure) return null;
  const len = measureLength(measure);
  const mIssues = issues.filter(i => i.measure === m);
  const tool: Tool = { figure: figureDuration(fig), rest, insert, voice };

  // ---------- Application des gestes ----------
  const ctx = (): EditCtx => ({ measure: m, fifths: measure.fifths, shift, newId: () => newId('n') });
  /** Calcule la correction sur le projet courant ; n'entre dans l'historique que si elle change quelque chose. */
  const apply = (lineId: string, fn: (notes: NoteEvent[], c: EditCtx) => NoteEvent[]) => {
    const line = getState().project?.lines.find(l => l.id === lineId);
    if (!line) return;
    const before = measureNotes(line, m);
    const after = fn(before, ctx());
    if (after === before) return;
    editProject(d => {
      const dl = d.lines.find(l => l.id === lineId);
      if (dl) replaceMeasureNotes(dl, m, after);
    });
  };
  const onInsert = (lineId: string, ev: NewEvent) => {
    let id = '';
    apply(lineId, (ns, c) => { const r = insertEvent(ns, c, ev); id = r.id; return r.notes; });
    if (id) setSel({ lineId, id });
  };
  const onSelect = (lineId: string, id: string | null) => {
    if (!id) { setSel(null); return; }
    setSel({ lineId, id });
    const n = project.lines.find(l => l.id === lineId)?.notes.find(x => x.id === id);
    if (!n) return;
    const f = figureOf(n.duration);
    if (f) setFig(f);
    setVoice(n.voice);
  };
  const onLyric = (lineId: string, id: string, text: string) => {
    const line = getState().project?.lines.find(l => l.id === lineId);
    if (!line) return;
    const after = setLyric(line.notes, id, verse, text);
    if (after === line.notes) return;
    editProject(d => { const dl = d.lines.find(l => l.id === lineId); if (dl) dl.notes = after; });
  };
  const onSel = (fn: (ns: NoteEvent[], c: EditCtx, id: string) => NoteEvent[]) => {
    if (sel) apply(sel.lineId, (ns, c) => fn(ns, c, sel.id));
  };
  const chooseFigure = (f: Figure) => {
    setFig(f);
    if (sel) onSel((ns, c, id) => setDuration(ns, c, id, figureDuration(f)));
  };
  const remove = () => {
    if (!sel) return;
    onSel((ns, c, id) => deleteEvent(ns, c, id));
    setSel(null);
  };
  const toggleChecked = (lineId: string) => editProject(d => {
    const k = `${m}|${lineId}`;
    const i = d.review.checked.indexOf(k);
    if (i >= 0) d.review.checked.splice(i, 1); else d.review.checked.push(k);
  });
  const goto = (to: number) => {
    if (to >= 0 && to < project.measures.length) setState({ selection: { measure: to, lineId: activeLine } });
  };
  const close = () => setState({ selection: null });

  // ---------- Clavier (la barre d'espace reste au panneau d'écoute) ----------
  keyRef.current =(e: KeyboardEvent) => {
    if (e.ctrlKey || e.metaKey || e.altKey || isField(e.target)) return;
    const k = e.key;
    let used = true;
    if (k === 'Escape') { if (sel) setSel(null); else close(); }
    else if ((k === 'ArrowUp' || k === 'ArrowDown') && selNote?.pitch) {
      const steps = (k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 7 : 1);
      onSel((ns, c, id) => movePitch(ns, c, id, steps));
    } else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      const dir = k === 'ArrowLeft' ? -1 : 1;
      const line = sel && project.lines.find(l => l.id === sel.lineId);
      if (line && sel) {
        const ns = measureNotes(line, m);
        const i = ns.findIndex(n => n.id === sel.id);
        const to = ns[i + dir];
        if (to) onSelect(line.id, to.id); else goto(m + dir);
      } else goto(m + dir);
    } else if (k === 'PageUp' || k === 'PageDown') goto(m + (k === 'PageUp' ? -1 : 1));
    else if (k === 'Delete' || k === 'Backspace') remove();
    else if (/^[1-6]$/.test(k)) chooseFigure({ base: FIGURES[+k - 1].base, dots: 0, triplet: fig.triplet });
    else if (k === '.') chooseFigure({ ...fig, dots: fig.dots ? 0 : 1 });
    else if (k === 't' || k === 'T') chooseFigure({ ...fig, triplet: !fig.triplet });
    else if (k === 'r' || k === 'R' || k === '0') setRest(r => !r);
    else used = false;
    if (used) e.preventDefault();
  };

  const selLabel = selNote
    ? `${selNote.pitch ? pitchLabel(selNote.pitch) : 'Silence'} · ${durationName(selNote.duration)} · voix ${selNote.voice}${selNote.manual ? ' · corrigée' : ''}`
    : null;

  return (
    <aside className="me-drawer" aria-label={`Éditeur de la mesure ${m + 1}`}>
      <header className="me-head">
        <div className="me-nav">
          <button className="btn sm" onClick={() => goto(m - 1)} disabled={m === 0} title="Mesure précédente (PgPréc)">←</button>
          <h3>Mesure {m + 1} <small>— page {measure.page}, mesure {measure.label} de l'original</small></h3>
          <button className="btn sm" onClick={() => goto(m + 1)} disabled={m >= project.measures.length - 1} title="Mesure suivante (PgSuiv)">→</button>
        </div>
        <span className="badge">{measure.beats}/{measure.beatType}</span>
        <span className="badge">{keyLabel(measure.fifths, measure.mode)}</span>
        <span className="spacer" />
        <button className="btn sm" onClick={() => playMeasure(m)} title="Écouter la mesure, toutes lignes actives">▶ Écouter la mesure</button>
        <button className="btn sm" onClick={close} title="Fermer (Échap)" aria-label="Fermer l'éditeur">✕</button>
      </header>

      <div className="me-body" ref={bodyRef}>
        <div className="me-top">
          <OriginalExcerpt measure={measure} />
          <ul className="me-issues">
            {mIssues.length === 0 && <li className="muted">Aucun diagnostic sur cette mesure.</li>}
            {mIssues.map((i, k) => (
              <li key={k} className={kindClass(i)}>
                <span className={'kind ' + kindClass(i)}>{i.checked ? '✓ ' : ''}{KIND_LABEL[i.kind]}</span>{' '}
                {project.lines.find(l => l.id === i.lineId)?.name ?? i.lineId} — {i.text}
              </li>
            ))}
          </ul>
        </div>

        <div className="me-tools" role="toolbar" aria-label="Figures et outils">
          <div className="me-palette">
            {FIGURES.map((f, i) => (
              <button key={f.base} className={'btn fig' + (fig.base === f.base ? ' sel' : '')} title={`${f.name} (${i + 1})`} aria-label={f.name}
                      aria-pressed={fig.base === f.base} onClick={() => chooseFigure({ base: f.base, dots: 0, triplet: fig.triplet })}>
                <FigureIcon fig={{ base: f.base, dots: 0, triplet: false }} rest={rest} />
              </button>
            ))}
            <button className={'btn fig' + (fig.dots ? ' sel' : '')} title="Point (.)" aria-label="point" aria-pressed={!!fig.dots}
                    onClick={() => chooseFigure({ ...fig, dots: fig.dots ? 0 : 1 })}><b className="fig-txt">•</b></button>
            <button className={'btn fig' + (fig.triplet ? ' sel' : '')} title="Triolet (T)" aria-label="triolet" aria-pressed={fig.triplet}
                    onClick={() => chooseFigure({ ...fig, triplet: !fig.triplet })}><b className="fig-txt">³</b></button>
            <button className={'btn fig' + (rest ? ' sel' : '')} title="Poser des silences (R)" aria-label="silence" aria-pressed={rest}
                    onClick={() => setRest(r => !r)}><FigureIcon fig={{ base: 1, dots: 0, triplet: false }} rest /></button>
            <span className="me-current" title="Figure posée au prochain clic">
              <FigureIcon fig={fig} rest={rest} size={26} /> {rest ? 'silence · ' : ''}{durationName(figureDuration(fig))}
            </span>
          </div>
          <div className="row me-opts">
            <label title="Une note posée au début d'une autre l'insère avant elle et décale la suite, au lieu de former un accord">
              <input type="checkbox" checked={insert} onChange={e => setInsert(e.target.checked)} /> insérer
            </label>
            <label title="Un changement de durée ou une suppression déplace la suite de la voix">
              <input type="checkbox" checked={shift} onChange={e => setShift(e.target.checked)} /> décaler la suite
            </label>
            <label>voix{' '}
              <select value={voice} onChange={e => setVoice(+e.target.value)}>
                {Array.from({ length: maxVoice + 1 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
              </select>
            </label>
            <label>couplet{' '}
              <select value={verse} onChange={e => setVerse(+e.target.value)}>
                {verses.map(v => <option key={v} value={v}>{v}</option>)}
                <option value={Math.max(...verses) + 1}>nouveau ({Math.max(...verses) + 1})</option>
              </select>
            </label>
          </div>
          <div className="row me-selbar" aria-live="polite">
            {selNote ? (
              <>
                <span className="me-sel">{selLabel}</span>
                {selNote.pitch && (
                  <>
                    <button className="btn sm" title="Monter d'un degré (↑)" onClick={() => onSel((ns, c, id) => movePitch(ns, c, id, 1))}>↑</button>
                    <button className="btn sm" title="Descendre d'un degré (↓)" onClick={() => onSel((ns, c, id) => movePitch(ns, c, id, -1))}>↓</button>
                    <button className="btn sm" title="Dièse" onClick={() => onSel((ns, c, id) => setAlter(ns, c, id, 1))}>♯</button>
                    <button className="btn sm" title="Bémol" onClick={() => onSel((ns, c, id) => setAlter(ns, c, id, -1))}>♭</button>
                    <button className="btn sm" title="Bécarre" onClick={() => onSel((ns, c, id) => setAlter(ns, c, id, 0))}>♮</button>
                    <button className="btn sm" title="Altération de l'armure" onClick={() => onSel((ns, c, id) => setAlter(ns, c, id, 'key'))}>armure</button>
                    <button className={'btn sm' + (selNote.tie ? ' sel' : '')} aria-pressed={!!selNote.tie} title="Liée à la note suivante de même hauteur"
                            onClick={() => onSel((ns, _c, id) => toggleTie(ns, id))}>⁀ liée à la suivante</button>
                  </>
                )}
                <button className="btn sm danger" title="Supprimer (Suppr)" onClick={remove}>Supprimer</button>
              </>
            ) : (
              <small className="muted">Cliquer sur la portée pose la figure choisie ; cliquer sur une note la sélectionne (glisser pour la déplacer).
                Clavier : 1–6 figures, « . » point, T triolet, R silence, ↑↓ hauteur, ←→ note voisine, Suppr, Échap.</small>
            )}
          </div>
        </div>

        {project.lines.map((line, rank) => {
          const key = `${m}|${line.id}`;
          const checked = project.review.checked.includes(key);
          const li = mIssues.filter(i => i.lineId === line.id);
          const showLyrics = withLyrics.has(line.id) !== lyricToggles.has(line.id);
          return (
            <section key={line.id} data-line={line.id} className={'me-line' + (line.id === activeLine ? ' active' : '')}>
              <div className="row me-line-head">
                <i className="dot" style={{ background: lineColor(rank) }} />
                <b>{line.name}</b>
                {li.map((i, k) => <span key={k} className={'kind ' + kindClass(i)}>{KIND_LABEL[i.kind]}</span>)}
                <span className="spacer" />
                <button className={'btn sm' + (showLyrics ? ' sel' : '')} aria-pressed={showLyrics} title="Afficher les champs de paroles sous les notes"
                        onClick={() => setLyricToggles(s => { const n = new Set(s); if (n.has(line.id)) n.delete(line.id); else n.add(line.id); return n; })}>
                  paroles
                </button>
                <button className="btn sm" onClick={() => playMeasure(m, line.id)} title="Écouter cette ligne seule">▶</button>
                <button className={'btn sm' + (checked ? ' sel' : '')} aria-pressed={checked} onClick={() => toggleChecked(line.id)}
                        title="La mesure est juste pour cette ligne (ou acceptée telle quelle)">
                  {checked ? '✓ Vérifiée' : 'Marquer comme vérifiée'}
                </button>
              </div>
              <StaffEditor line={line} m={m} measure={measure} notes={measureNotes(line, m)} len={len} tool={tool}
                           selectedId={sel?.lineId === line.id ? sel.id : null} verse={verse} lyrics={showLyrics}
                           onSelect={id => onSelect(line.id, id)}
                           onInsert={ev => onInsert(line.id, ev)}
                           onMove={(id, steps) => apply(line.id, (ns, c) => movePitch(ns, c, id, steps))}
                           onLyric={(id, text) => onLyric(line.id, id, text)} />
            </section>
          );
        })}
      </div>
    </aside>
  );
}
