// Panneau « À relire » : les diagnostics du modèle, groupés par mesure. C'est la porte d'entrée de la
// correction : chaque ligne ouvre l'éditeur sur la mesure signalée.
import { useMemo } from 'react';
import type { Issue, IssueKind, Project } from '../../model/types';
import { setState } from '../../state/store';

export const KIND_LABEL: Record<IssueKind, string> = {
  empty: 'mesure vide', rhythm: 'rythme faux', gap: 'trou', lost: 'note perdue',
};
export const kindClass = (i: Pick<Issue, 'kind' | 'checked'>) => (i.checked ? 'checked' : i.kind === 'empty' ? 'empty' : 'rhythm');

/** Prochaine mesure-ligne non validée après `from` (en reprenant au début). */
export function nextIssue(issues: Issue[], from: number | null): Issue | null {
  const open = issues.filter(i => !i.checked);
  return open.find(i => from === null || i.measure > from) ?? open[0] ?? null;
}

export function Legend() {
  return (
    <div className="legend">
      <span><i className="sw rhythm" />rythme faux, trou ou note perdue</span>
      <span><i className="sw empty" />mesure vide</span>
      <span><i className="sw checked" />validée</span>
      <span><i className="sw manual" />note corrigée</span>
    </div>
  );
}

interface Props {
  project: Project;
  /** diagnostics des seules lignes affichées */
  issues: Issue[];
  selected: number | null;
  /** diagnostics non validés sur des lignes décochées (masqués, mais signalés) */
  hidden?: number;
}

export function IssueList({ project, issues, selected, hidden = 0 }: Props) {
  const groups = useMemo(() => {
    const g = new Map<number, Issue[]>();
    for (const i of issues) {
      const l = g.get(i.measure);
      if (l) l.push(i); else g.set(i.measure, [i]);
    }
    return [...g.entries()];
  }, [issues]);
  const remaining = issues.filter(i => !i.checked).length;
  const validated = issues.length - remaining;
  const lineName = (id: string) => project.lines.find(l => l.id === id)?.name ?? id;
  const open = (measure: number, lineId?: string) => setState({ selection: { measure, lineId } });
  const next = nextIssue(issues, selected);

  return (
    <section className="card issues">
      <div className="row issues-head">
        <h3>À relire</h3>
        <span className="spacer" />
        <span className={'badge ' + (remaining ? 'warn' : 'ok')}>{remaining} à relire</span>
        {validated > 0 && <span className="badge">{validated} validé{validated > 1 ? 's' : ''}</span>}
      </div>
      {hidden > 0 && (
        <small className="muted issues-hidden">
          + {hidden} point{hidden > 1 ? 's' : ''} à relire sur des lignes décochées (masqué{hidden > 1 ? 's' : ''}).
        </small>
      )}
      {issues.length === 0 ? (
        <p className="note ok">{hidden
          ? 'Aucune mesure signalée sur les lignes affichées.'
          : 'Aucune mesure signalée : toutes les durées retombent sur la métrique.'}</p>
      ) : (
        <>
          <button className="btn primary sm" disabled={!next} onClick={() => next && open(next.measure, next.lineId)}>
            Suivante à relire →
          </button>
          <ul className="issue-groups">
            {groups.map(([m, list]) => {
              const meta = project.measures[m];
              return (
                <li key={m} className={m === selected ? 'cur' : ''}>
                  <button className="issue-measure" onClick={() => open(m, list.find(i => !i.checked)?.lineId ?? list[0].lineId)}>
                    <b>Mesure {m + 1}</b>
                    {meta && <small> · page {meta.page}, mesure {meta.label}</small>}
                  </button>
                  {list.map((i, k) => (
                    <button key={k} className={'issue ' + kindClass(i)} onClick={() => open(m, i.lineId)}>
                      <span className={'kind ' + kindClass(i)}>{i.checked ? '✓ ' : ''}{KIND_LABEL[i.kind]}</span>
                      <span className="issue-text">{lineName(i.lineId)} — {i.text}</span>
                    </button>
                  ))}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
