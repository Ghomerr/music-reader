// Étape « Relire et écouter » : la partition reconstruite (avec ses diagnostics en couleur), le panneau
// d'écoute, la liste des mesures à relire et l'éditeur de mesure.
import { useMemo, useState } from 'react';
import type { Issue, IssueKind, MeasureTime } from '../../model/types';
import { findIssues, timeline } from '../../model/check';
import { writeMusicXml } from '../../model/musicxml-write';
import { measureAt } from '../../audio/perform';
import { setState, useStore } from '../../state/store';
import { OsmdView } from '../common/OsmdView';
import { PlayerPanel } from '../player/PlayerPanel';
import { IssueList, Legend } from './IssueList';
import { MeasureEditor } from './MeasureEditor';
import './ScoreStep.css';

/** fonds de la couche de surlignage (papier blanc, quel que soit le thème) */
const CELL = {
  rhythm: 'rgba(232, 89, 12, 0.16)',
  empty: 'rgba(214, 51, 108, 0.22)',
  checked: 'rgba(100, 116, 139, 0.14)',
  open: 'rgba(79, 70, 229, 0.12)',
  openLine: 'rgba(79, 70, 229, 0.26)',
};
const ZOOMS = [0.6, 0.75, 0.9, 1, 1.15, 1.3, 1.5];

function attempt<T>(fn: () => T, fallback: T): { value: T; error: string | null } {
  try { return { value: fn(), error: null }; }
  catch (e) { return { value: fallback, error: e instanceof Error ? e.message : String(e) }; }
}

export function ScoreStep() {
  const project = useStore(s => s.project);
  const selection = useStore(s => s.selection);
  const [keepLayout, setKeepLayout] = useState(true);
  const [zoom, setZoom] = useState(1);
  // Les réglages (tempo, transposition…) changent l'objet projet sans toucher à la musique : on ne
  // dépend que des mesures, des lignes et de la relecture pour ne pas re-rendre la partition à
  // chaque cran du curseur de tempo.
  const measures = project?.measures, lines = project?.lines, review = project?.review;

  const issues = useMemo(() => (project ? attempt(() => findIssues(project), [] as Issue[]) : { value: [], error: null }),
    [measures, lines, review]);
  const times = useMemo(() => (project ? attempt(() => timeline(project), [] as MeasureTime[]).value : []),
    [measures, lines]);
  const playing = useStore(s => {
    if (s.playhead == null || !times.length) return null;
    const i = measureAt(times, s.playhead);
    return i < 0 ? null : i;
  });

  const xmlColors = useMemo(() => {
    const map = new Map<string, IssueKind>();
    for (const i of issues.value) {
      if (i.checked) continue;
      const k = `${i.measure}|${i.lineId}`;
      if (!map.has(k) || i.kind === 'empty') map.set(k, i.kind);
    }
    return map;
  }, [issues]);

  const xml = useMemo(() => (project
    ? attempt(() => writeMusicXml(project, { colors: xmlColors, keepLayout, lyrics: true }), '')
    : { value: '', error: null }),
  [measures, lines, project?.title, xmlColors, keepLayout]);

  // writeMusicXml regroupe les lignes par partie, dans l'ordre d'apparition : même ordre pour les portées.
  const lineOrder = useMemo(() => {
    const parts = new Map<number, string[]>();
    for (const l of lines ?? []) {
      const g = parts.get(l.part);
      if (g) g.push(l.id); else parts.set(l.part, [l.id]);
    }
    return [...parts.values()].flat();
  }, [lines]);

  const cellColors = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues.value) {
      const k = `${i.measure}|${i.lineId}`;
      const c = i.checked ? CELL.checked : i.kind === 'empty' ? CELL.empty : CELL.rhythm;
      if (!map.has(k) || c === CELL.empty) map.set(k, c);
    }
    if (selection) {
      for (const l of lines ?? []) {
        const k = `${selection.measure}|${l.id}`;
        // la mesure ouverte garde sa couleur de diagnostic sur les autres lignes
        if (l.id === selection.lineId) map.set(k, CELL.openLine);
        else if (!map.has(k)) map.set(k, CELL.open);
      }
    }
    return map;
  }, [issues, selection, lines]);

  if (!project) return null;
  const error = issues.error ?? xml.error;
  const zi = ZOOMS.indexOf(zoom);

  return (
    <div className={'score-step' + (selection ? ' editing' : '')}>
      <div className="score-main">
        <section className="card score-card">
          <div className="row score-bar">
            <h2>{project.title || 'Partition'}</h2>
            <span className="spacer" />
            <label title="Reprendre les retours à la ligne de l'image d'origine (comparaison plus facile)">
              <input type="checkbox" checked={keepLayout} onChange={e => setKeepLayout(e.target.checked)} /> mise en page d'origine
            </label>
            <span className="row zoom" role="group" aria-label="Zoom">
              <button className="btn sm" disabled={zi <= 0} onClick={() => setZoom(ZOOMS[zi - 1])} aria-label="Réduire">−</button>
              <span className="zoom-val">{Math.round(zoom * 100)} %</span>
              <button className="btn sm" disabled={zi >= ZOOMS.length - 1} onClick={() => setZoom(ZOOMS[zi + 1])} aria-label="Agrandir">+</button>
            </span>
          </div>
          <div className="row score-hint">
            <Legend />
            <small className="muted">Cliquer sur une mesure pour la corriger.</small>
          </div>
          {error && <div className="note err">Partition impossible à écrire : {error}</div>}
          {xml.value && (
            <OsmdView xml={xml.value} keepLayout={keepLayout} zoom={zoom} lineOrder={lineOrder} firstMeasure={0}
                      cellColors={cellColors} playingMeasure={playing} scrollToMeasure={selection?.measure ?? null}
                      onMeasureClick={(measure, lineId) => setState({ selection: { measure, lineId } })} />
          )}
        </section>
      </div>
      <div className="score-side">
        {/* reste monté pendant toute l'étape : son démontage met la lecture en pause */}
        <PlayerPanel />
        <IssueList project={project} issues={issues.value} selected={selection?.measure ?? null} />
      </div>
      {selection && project.measures[selection.measure] && (
        <MeasureEditor project={project} issues={issues.value} selection={selection} />
      )}
    </div>
  );
}
