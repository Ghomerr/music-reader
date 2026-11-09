// Copier la mesure ouverte sur une ou plusieurs autres mesures (motif d'accompagnement, refrain répété…).
// Une seule correction, annulable : le contenu des mesures cibles est remplacé, ligne par ligne.
import { useEffect, useMemo, useState } from 'react';
import type { Line, Project } from '../../model/types';
import { copyMeasure, parseMeasureList } from '../../model/measures';
import { editProject, getState } from '../../state/store';
import { track } from '../../stats';

interface Props {
  project: Project;
  /** mesure copiée (indice) */
  from: number;
  /** lignes affichées dans l'éditeur, dans l'ordre */
  lines: Line[];
  onClose: () => void;
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

export function CopyPanel({ project, from, lines, onClose }: Props) {
  const count = project.measures.length;
  const [text, setText] = useState('');
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(lines.map(l => l.id)));
  const [lyrics, setLyrics] = useState(false);
  /** message de réussite, et le projet qu'a produit la copie : il s'efface dès que le projet change (Ctrl+Z…) */
  const [done, setDone] = useState<{ text: string; after: Project | null } | null>(null);
  useEffect(() => { setDone(null); }, [from]);

  const parsed = useMemo(() => (text.trim() ? parseMeasureList(text, count) : null), [text, count]);
  const targets = (parsed?.indices ?? []).filter(i => i !== from);
  const lineIds = lines.filter(l => chosen.has(l.id)).map(l => l.id);
  // cibles qui ont déjà des notes sur les lignes copiées : elles seront remplacées
  const filled = targets.filter(t => project.lines.some(l => chosen.has(l.id) && l.notes.some(n => n.measure === t && n.pitch)));
  const lyricLines = lines.some(l => chosen.has(l.id) && l.notes.some(n => n.measure === from && n.lyrics?.length));
  const canCopy = !!targets.length && !!lineIds.length && !parsed?.error;

  const copy = () => {
    if (!canCopy) return;
    let n = 0;
    editProject(d => { n = copyMeasure(d, from, targets, { lineIds, lyrics }); });
    track('mesure_copiee', { cibles: n, lignes: lineIds.length, paroles: lyrics });
    setDone({ text: `Mesure ${from + 1} copiée sur ${plural(n, 'mesure')} (${targets.map(t => t + 1).join(', ')}). Ctrl+Z pour annuler.`, after: getState().project });
    setText('');
  };
  const toggle = (id: string) => setChosen(s => { const c = new Set(s); if (c.has(id)) c.delete(id); else c.add(id); return c; });

  return (
    <section className="me-copy" aria-label={`Copier la mesure ${from + 1}`}>
      <div className="row me-copy-row">
        <b>Copier la mesure {from + 1} vers</b>
        <input type="text" value={text} autoFocus placeholder="ex. 5, 7-9" aria-label="Mesures cibles"
               onChange={e => { setText(e.target.value); setDone(null); }}
               onKeyDown={e => { if (e.key === 'Enter') copy(); if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }} />
        {from + 1 < count && <button className="btn sm" onClick={() => setText(String(from + 2))}>la suivante</button>}
        {from + 2 < count && <button className="btn sm" onClick={() => setText(`${from + 2}-${count}`)}>jusqu'à la fin</button>}
        <span className="spacer" />
        <button className="btn sm primary" onClick={copy} disabled={!canCopy}>Copier</button>
        <button className="btn sm" onClick={onClose} aria-label="Fermer la copie" title="Fermer">✕</button>
      </div>
      <div className="row me-copy-row">
        <span className="muted">Lignes :</span>
        {lines.map(l => (
          <label key={l.id}><input type="checkbox" checked={chosen.has(l.id)} onChange={() => toggle(l.id)} /> {l.name}</label>
        ))}
        {lyricLines && (
          <label title="Sinon, chaque mesure cible garde ses propres paroles, sur la note de même position">
            <input type="checkbox" checked={lyrics} onChange={e => setLyrics(e.target.checked)} /> copier aussi les paroles
          </label>
        )}
      </div>
      {parsed?.error && <div className="note err">{parsed.error}</div>}
      {!parsed?.error && targets.length > 0 && (
        <small className={filled.length ? 'me-copy-warn' : 'muted'}>
          → {plural(targets.length, 'mesure')} : {targets.map(t => t + 1).join(', ')}
          {filled.length > 0 && ` — ${filled.length > 1 ? `${filled.length} contiennent` : '1 contient'} déjà des notes, qui seront remplacées`}
          {parsed && parsed.indices.includes(from) && ' (la mesure copiée elle-même est ignorée)'}
        </small>
      )}
      {done && done.after === project && <div className="note ok">{done.text}</div>}
    </section>
  );
}
