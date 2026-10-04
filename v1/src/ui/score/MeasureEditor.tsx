// Éditeur de mesure : correction manuelle des notes et des paroles, une portée par ligne.
// Toutes les modifications passent par editProject (annulables) ; les diagnostics, recalculés par
// ScoreStep sur le nouveau projet, montrent la mesure se « réparer » à vue.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Issue, NoteEvent, Project } from '../../model/types';
import { EPS, durationName, keyLabel, pitchLabel } from '../../model/pitch';
import { editProject, getState, newId, setState } from '../../state/store';
import { playMeasure } from '../../audio/player';
import { lineColor } from '../player/colors';
import {
  FIGURES, contentEnd, deleteEvent, figureDuration, figureOf, fitToMeter, insertEvent, measureLength, measureNotes, moveInTime,
  movePitch, replaceMeasureNotes, setAlter, setDuration, setLyric, setVoice as setVoiceOf, toggleTie, versesOf,
  type EditCtx, type Figure, type NewEvent,
} from './edit';
import { FigureIcon } from './Glyphs';
import { KIND_LABEL, kindClass } from './IssueList';
import { OriginalExcerpt } from './OriginalExcerpt';
import { StaffEditor, type EditMode, type Tool } from './StaffEditor';

interface Props {
  project: Project;
  issues: Issue[];
  selection: { measure: number; lineId?: string };
  /** lignes cochées dans le panneau d'écoute : les autres ne sont pas affichées */
  visibleLines?: Set<string>;
}

const MODES: { id: EditMode; label: string; title: string }[] = [
  { id: 'select', label: 'Sélectionner', title: 'Un clic sur une note la sélectionne pour la modifier ; rien n\'est posé (S)' },
  { id: 'add', label: 'Ajouter', title: 'Un clic sur la portée pose la figure choisie (A)' },
  { id: 'erase', label: 'Gommer', title: 'Un clic sur une note ou un silence le supprime (G)' },
];

const MODE_HELP: Record<EditMode, string> = {
  select: 'Cliquer sur une note pour la sélectionner (elle s\'éclaire au survol), puis la modifier avec les boutons ci-dessus ou la palette ; la glisser la monte ou la descend.',
  add: 'Cliquer sur la portée pose la figure choisie, aimantée à la ligne la plus proche : au début d\'une note, elle forme un accord ; à l\'intérieur, elle passe dans une autre voix.',
  erase: 'Cliquer sur une note ou un silence le supprime (elle passe en rose au survol).',
};

function ModeIcon({ mode }: { mode: EditMode }) {
  const p = { viewBox: '0 0 24 24', width: 18, height: 18, 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
              strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const };
  if (mode === 'select') return <svg {...p}><path d="M5 3l14 8-6 1.5L10 19z" /></svg>;
  if (mode === 'add') return <svg {...p}><ellipse cx="9" cy="17" rx="4" ry="3" transform="rotate(-20 9 17)" /><path d="M13 16V4" /><path d="M19 4v6M16 7h6" /></svg>;
  return <svg {...p}><path d="M4 15.5 13.5 6l6 6L10 21.5H6.5L4 19z" /><path d="M9 10.5l6 6" /><path d="M10 21.5h10" /></svg>;
}

const isField = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable]');

export function MeasureEditor({ project, issues, selection, visibleLines }: Props) {
  const m = selection.measure;
  const measure = project.measures[m];
  const [fig, setFig] = useState<Figure>({ base: 1, dots: 0, triplet: false });
  const [rest, setRest] = useState(false);
  /** ce que fait un clic sur la portée : sélectionner (défaut, ne pose jamais rien), ajouter, gommer */
  const [mode, setMode] = useState<EditMode>('select');
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

  const shown = (id: string) => !visibleLines || visibleLines.has(id);
  const activeLine = sel?.lineId ?? selection.lineId ?? project.lines.find(l => shown(l.id))?.id;

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
  const tool: Tool = { figure: figureDuration(fig), rest, insert, voice, mode };

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
  /** Changer de mode efface la sélection, sauf en revenant à la sélection. */
  const changeMode = (md: EditMode) => {
    setMode(md);
    if (md !== 'select') setSel(null);
  };
  // La palette agit sur la note sélectionnée en mode sélection ; sinon elle choisit la figure à poser
  // (et passe en mode ajout : choisir une figure, c'est vouloir la poser).
  const chooseFigure = (f: Figure) => {
    setFig(f);
    if (mode === 'select' && sel) onSel((ns, c, id) => setDuration(ns, c, id, figureDuration(f)));
    else if (mode !== 'add') changeMode('add');
  };
  const toggleRest = () => {
    setRest(r => !r);
    if (mode !== 'add') changeMode('add');
  };
  const remove = () => {
    if (!sel) return;
    onSel((ns, c, id) => deleteEvent(ns, c, id));
    setSel(null);
  };
  // Polyphonie : une seconde voix qu'Audiveris a mise à la suite de la première se recale en déplaçant
  // l'accord dans le temps (pas = sa figure, au plus un temps) et en le changeant de voix.
  const step = selNote ? Math.min(1, selNote.duration) : 1;
  const stepLabel = durationName(step);
  const nudge = (dir: number) => onSel((ns, c, id) => moveInTime(ns, c, id, dir * step));
  /** Lignes affichées dont le contenu dépasse la barre de mesure. */
  const overflowing = project.lines.filter(l => shown(l.id) && contentEnd(measureNotes(l, m)) > len + EPS).map(l => l.id);
  /** Coupe à la métrique, en une seule correction (un seul Ctrl+Z) pour toutes les lignes demandées. */
  const fit = (lineIds: string[]) => editProject(d => {
    for (const id of lineIds) {
      const dl = d.lines.find(l => l.id === id);
      if (!dl) continue;
      const before = measureNotes(dl, m);
      const after = fitToMeter(before, ctx(), len);
      if (after !== before) replaceMeasureNotes(dl, m, after);
    }
  });
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
    if (k === 'Escape') { if (sel) setSel(null); else if (mode !== 'select') changeMode('select'); else close(); }
    else if ((k === 'ArrowUp' || k === 'ArrowDown') && selNote?.pitch) {
      const steps = (k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 7 : 1);
      onSel((ns, c, id) => movePitch(ns, c, id, steps));
    } else if ((k === 'ArrowLeft' || k === 'ArrowRight') && e.shiftKey && selNote) {
      nudge(k === 'ArrowLeft' ? -1 : 1);
    } else if ((k === 'v' || k === 'V') && selNote) {
      onSel((ns, c, id) => setVoiceOf(ns, c, id, (selNote.voice % (maxVoice + 1)) + 1));
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
    else if (k === 'r' || k === 'R' || k === '0') toggleRest();
    else if (k === 's' || k === 'S') changeMode('select');
    else if (k === 'a' || k === 'A') changeMode('add');
    else if (k === 'g' || k === 'G') changeMode('erase');
    else used = false;
    if (used) e.preventDefault();
  };

  // En mode ajout, la note sélectionnée est celle qu'on vient de poser (pour lui ajouter un ♭ par exemple).
  const selLabel = selNote
    ? (mode === 'add' ? 'Note posée : ' : '')
      + `${selNote.pitch ? pitchLabel(selNote.pitch) : 'Silence'} · ${durationName(selNote.duration)} · voix ${selNote.voice}${selNote.manual ? ' · corrigée' : ''}`
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
        {/* Original, diagnostics et outils restent en place ; seules les portées défilent (.me-lines). */}
        <div className="me-top">
          <OriginalExcerpt measure={measure} />
          <div className="me-side">
          <ul className="me-issues">
            {mIssues.length === 0 && <li className="muted">Aucun diagnostic sur cette mesure.</li>}
            {mIssues.map((i, k) => (
              <li key={k} className={kindClass(i)}>
                <span className={'kind ' + kindClass(i)}>{i.checked ? '✓ ' : ''}{KIND_LABEL[i.kind]}</span>{' '}
                {project.lines.find(l => l.id === i.lineId)?.name ?? i.lineId} — {i.text}
              </li>
            ))}
          </ul>
          {overflowing.length > 0 && (
            <button className="btn sm" onClick={() => fit(overflowing)}
                    title="Coupe, sur les lignes affichées, ce qui dépasse la barre de mesure (annulable)">
              ✂ Ramener la mesure à {measure.beats}/{measure.beatType}
            </button>
          )}

        <div className="me-tools" role="toolbar" aria-label="Figures et outils">
          <div className="me-palette">
            {/* Un seul mode à la fois : on sait toujours ce que fera le prochain clic sur la portée. */}
            <div className="me-modes" role="radiogroup" aria-label="Mode d'édition">
              {MODES.map(md => (
                <button key={md.id} role="radio" aria-checked={mode === md.id} title={md.title}
                        className={`btn me-mode ${md.id}` + (mode === md.id ? ' sel' : '')} onClick={() => changeMode(md.id)}>
                  <ModeIcon mode={md.id} /> {md.label}
                </button>
              ))}
            </div>
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
                    onClick={toggleRest}><FigureIcon fig={{ base: 1, dots: 0, triplet: false }} rest /></button>
            {mode === 'add' && (
              <span className="me-current" title="Figure posée au prochain clic">
                <FigureIcon fig={fig} rest={rest} size={26} /> {rest ? 'silence · ' : ''}{durationName(figureDuration(fig))}
              </span>
            )}
          </div>
          <div className="row me-opts">
            {mode === 'add' && (
              <label title="Une note posée au début d'une autre l'insère avant elle et pousse la suite, au lieu de former un accord">
                <input type="checkbox" checked={insert} onChange={e => setInsert(e.target.checked)} /> insérer avant (pousse la suite)
              </label>
            )}
            <label title="Un changement de durée ou une suppression déplace la suite de la voix">
              <input type="checkbox" checked={shift} onChange={e => setShift(e.target.checked)} /> décaler la suite
            </label>
            {mode === 'add' && (
              <label title="Voix des notes posées (une note posée à l'intérieur d'une autre passe d'elle-même dans une voix libre)">voix{' '}
                <select value={voice} onChange={e => setVoice(+e.target.value)}>
                  {Array.from({ length: maxVoice + 1 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                </select>
              </label>
            )}
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
                <button className="btn sm" title={`Plus tôt, par pas de ${stepLabel} (Maj+←)`} onClick={() => nudge(-1)}>◀ plus tôt</button>
                <button className="btn sm" title={`Plus tard, par pas de ${stepLabel} (Maj+→)`} onClick={() => nudge(1)}>plus tard ▶</button>
                <label className="me-voice" title="Passer la note (et son accord) dans une autre voix, à la même position (V)">
                  voix{' '}
                  <select value={selNote.voice} onChange={e => onSel((ns, c, id) => setVoiceOf(ns, c, id, +e.target.value))}>
                    {Array.from({ length: maxVoice + 1 }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
                  </select>
                </label>
                <button className="btn sm danger" title="Supprimer (Suppr)" onClick={remove}>Supprimer</button>
              </>
            ) : (
              <small className="muted">
                {MODE_HELP[mode]}{' '}
                Clavier : S sélectionner, A ajouter, G gommer · 1–6 figures, « . » point, T triolet, R silence · ↑↓ hauteur,
                ←→ note voisine, Maj+←→ plus tôt / plus tard, V voix suivante, Suppr, Échap.</small>
            )}
          </div>
        </div>
          </div>
        </div>

        <div className="me-lines">
        {project.lines.map((line, rank) => {
          // rank pris sur toutes les lignes : même couleur que dans le panneau d'écoute
          if (!shown(line.id)) return null;
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
                {contentEnd(measureNotes(line, m)) > len + EPS && (
                  <button className="btn sm" onClick={() => fit([line.id])}
                          title="Coupe ce qui dépasse la barre de mesure sur cette ligne (annulable). Pour une seconde voix mal placée, mieux vaut la déplacer.">
                    ✂ Ramener à {measure.beats}/{measure.beatType}
                  </button>
                )}
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
                           onLyric={(id, text) => onLyric(line.id, id, text)}
                           onDelete={id => { apply(line.id, (ns, c) => deleteEvent(ns, c, id)); if (sel?.id === id) setSel(null); }} />
            </section>
          );
        })}
        </div>
      </div>
    </aside>
  );
}
