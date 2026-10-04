// Étape « Imprimer » : la partition relue et corrigée, ressortie propre (PLAN.md, « Réimprimer la
// partition »). Lignes choisies, tonalité courante, paroles au choix, et jamais de couleurs de diagnostic.
//
// L'aperçu est une instance OSMD à part, en pages A4 de largeur fixe (210 mm) : la mise en page ne dépend
// donc pas de l'écran, et ce qui est montré est exactement ce qui part à l'imprimante (une page OSMD =
// une feuille, cf. PrintStep.css).
import { useEffect, useMemo, useRef, useState } from 'react';
import { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import { findIssues } from '../../model/check';
import { writeMusicXml, type WriteOptions } from '../../model/musicxml-write';
import { keyLabel, transposeKey } from '../../model/pitch';
import type { Project, Settings } from '../../model/types';
import { setState, updateSettings, useStore } from '../../state/store';
import './PrintStep.css';

/** Taille de la musique sur la feuille : portée d'environ 7,5 mm, comme une partition imprimée courante. */
const ZOOM = 0.7;
const DEBOUNCE_MS = 300;

type Preview = { status: 'busy' } | { status: 'ready'; pages: number } | { status: 'error'; message: string };

const setPrint = (patch: Partial<Settings['print']>) =>
  updateSettings(s => ({ ...s, print: { ...s.print, ...patch } }));

const setTranspose = (t: number) =>
  updateSettings(s => ({ ...s, transpose: Math.max(-24, Math.min(24, t)) }));

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const fileName = (title: string) =>
  (title.trim() || 'partition').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').slice(0, 80) + '.musicxml';

export function PrintStep() {
  const project = useStore(s => s.project);
  return project ? <PrintView project={project} /> : null;
}

function PrintView({ project }: { project: Project }) {
  const { settings, lines, measures } = project;
  const print = settings.print;
  const t = settings.transpose;

  // Lignes imprimées : le choix enregistré, sinon celles qu'on écoute, sinon toutes.
  const chosen = useMemo(() => {
    const ids = lines.map(l => l.id);
    const stored = print.lines.filter(id => ids.includes(id));
    if (stored.length) return stored;
    const heard = ids.filter(id => settings.lines[id]?.enabled !== false);
    return heard.length ? heard : ids;
  }, [lines, print.lines, settings.lines]);

  // Couplets présents dans les paroles des lignes imprimées.
  const detected = useMemo(() => {
    const set = new Set<number>();
    for (const l of lines) if (chosen.includes(l.id)) for (const n of l.notes) for (const ly of n.lyrics ?? []) if (ly.text.trim()) set.add(ly.verse);
    return [...set].sort((a, b) => a - b);
  }, [lines, chosen]);
  const verses = useMemo(() => {
    const v = print.verses.filter(x => detected.includes(x));
    return v.length ? v : detected;
  }, [print.verses, detected]);

  // Mesures encore douteuses sur les lignes imprimées (non validées à la relecture).
  const doubtful = useMemo(() => {
    try {
      const open = findIssues(project).filter(i => !i.checked && chosen.includes(i.lineId));
      return new Set(open.map(i => i.measure)).size;
    } catch {
      return 0;
    }
    // findIssues ne dépend que du contenu : inutile de le relancer à chaque réglage
  }, [lines, measures, project.review, chosen]);

  const title = print.title;
  const options: WriteOptions = useMemo(() => ({
    lines: chosen,
    transpose: t,
    lyrics: print.lyrics && detected.length > 0,
    verses: verses.length === detected.length ? [] : verses,
    keepLayout: print.keepLayout,
    title,
  }), [chosen, t, print.lyrics, detected, verses, print.keepLayout, title]);

  const hostRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const [preview, setPreview] = useState<Preview>({ status: 'busy' });

  useEffect(() => {
    const host = hostRef.current!;
    const osmd = new OpenSheetMusicDisplay(host, {
      backend: 'svg',
      pageFormat: 'A4_P',
      pageBackgroundColor: '#FFFFFF',
      // largeur fixe : un redimensionnement de fenêtre (ou l'aperçu avant impression) ne doit pas
      // relancer la mise en page
      autoResize: false,
      autoBeam: true,
      disableCursor: true,
      drawingParameters: 'default',
      drawPartNames: true,
      drawMeasureNumbers: true,
      drawLyrics: true,
    });
    osmdRef.current = osmd;
    return () => {
      osmdRef.current = null;
      osmd.clear();
      host.replaceChildren();
    };
  }, []);

  // Nouveau rendu quand le contenu ou les options changent, regroupé (frappe du titre, clics rapprochés).
  useEffect(() => {
    let cancelled = false;
    setPreview({ status: 'busy' });
    const timer = setTimeout(async () => {
      const osmd = osmdRef.current;
      const host = hostRef.current;
      if (!osmd || !host) return;
      try {
        const xml = writeMusicXml(project, options);
        osmd.setOptions({
          newSystemFromXML: !!options.keepLayout,
          newPageFromXML: !!options.keepLayout,
          drawTitle: !!options.title?.trim(),
        });
        await osmd.load(xml);
        if (cancelled) return;
        osmd.zoom = ZOOM;
        osmd.render();
        setPreview({ status: 'ready', pages: host.querySelectorAll('svg').length });
      } catch (e) {
        if (!cancelled) setPreview({ status: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    }, DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [project, options]);

  const exportXml = () => {
    const xml = writeMusicXml(project, options);
    download(fileName(title || project.title), xml, 'application/vnd.recordare.musicxml+xml');
  };

  const toggleLine = (id: string) => {
    const next = lines.map(l => l.id).filter(x => (x === id ? !chosen.includes(x) : chosen.includes(x)));
    if (next.length) setPrint({ lines: next });
  };
  const toggleVerse = (v: number) => {
    const next = verses.includes(v) ? verses.filter(x => x !== v) : [...verses, v].sort((a, b) => a - b);
    if (next.length) setPrint({ verses: next.length === detected.length ? [] : next });
  };

  const m0 = measures[0];
  const origin = m0 ? keyLabel(m0.fifths, m0.mode) : '';
  const target = m0 ? keyLabel(transposeKey(m0.fifths, t).fifths, m0.mode) : '';
  const shift = t === 0 ? 'tonalité d’origine' : `${t > 0 ? '+' : '−'}${Math.abs(t)} demi-ton${Math.abs(t) > 1 ? 's' : ''}`;
  const ready = preview.status === 'ready';

  return (
    <div className="print-step">
      <aside className="card print-options no-print">
        <h2>Imprimer</h2>

        <label className="print-field">
          <span>Titre</span>
          <input type="text" value={title} placeholder={project.title || 'Sans titre'}
                 onChange={e => setPrint({ title: e.target.value })} />
        </label>

        <fieldset className="print-field">
          <legend>Lignes à imprimer</legend>
          {lines.map(l => (
            <label key={l.id} className="print-check">
              <input type="checkbox" checked={chosen.includes(l.id)}
                     disabled={chosen.length === 1 && chosen.includes(l.id)}
                     onChange={() => toggleLine(l.id)} />
              {l.name}
            </label>
          ))}
        </fieldset>

        <fieldset className="print-field">
          <legend>Tonalité</legend>
          <div className="print-key">
            <b>{target}</b>
            <small>{shift}{t !== 0 && origin ? ` · origine : ${origin}` : ''}</small>
          </div>
          <div className="row print-transpose">
            <button className="btn sm" onClick={() => setTranspose(t - 12)} disabled={t - 12 < -24} title="Une octave plus bas">−8ve</button>
            <button className="btn sm" onClick={() => setTranspose(t - 1)} disabled={t <= -24} title="Un demi-ton plus bas">−½</button>
            <button className="btn sm" onClick={() => setTranspose(0)} disabled={t === 0} title="Revenir à la tonalité d'origine">0</button>
            <button className="btn sm" onClick={() => setTranspose(t + 1)} disabled={t >= 24} title="Un demi-ton plus haut">+½</button>
            <button className="btn sm" onClick={() => setTranspose(t + 12)} disabled={t + 12 > 24} title="Une octave plus haut">+8ve</button>
          </div>
          <small>Même réglage que pour l'écoute : notes et armure sont transposées.</small>
        </fieldset>

        <fieldset className="print-field">
          <legend>Paroles</legend>
          {detected.length === 0 ? (
            <small>Aucune parole sur les lignes choisies.</small>
          ) : (
            <>
              <label className="print-check">
                <input type="checkbox" checked={print.lyrics} onChange={e => setPrint({ lyrics: e.target.checked })} />
                Imprimer les paroles
              </label>
              {print.lyrics && detected.length > 1 && (
                <div className="row print-verses">
                  {detected.map(v => (
                    <label key={v} className="print-check">
                      <input type="checkbox" checked={verses.includes(v)}
                             disabled={verses.length === 1 && verses.includes(v)}
                             onChange={() => toggleVerse(v)} />
                      Couplet {v}
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </fieldset>

        <fieldset className="print-field">
          <legend>Mise en page</legend>
          <label className="print-check">
            <input type="checkbox" checked={print.keepLayout} onChange={e => setPrint({ keepLayout: e.target.checked })} />
            Reprendre les fins de ligne et de page de l'original
          </label>
        </fieldset>

        <div className="print-actions">
          <button className="btn primary" onClick={() => window.print()} disabled={!ready}>🖨 Imprimer / PDF</button>
          <button className="btn" onClick={exportXml}>Exporter le MusicXML</button>
        </div>
        <small>Pour obtenir un PDF, choisissez « Enregistrer au format PDF » comme imprimante dans la boîte d'impression.</small>
      </aside>

      <section className="print-preview">
        <div className="print-status no-print">
          {doubtful > 0 && (
            <div className="note warn row">
              <span>
                {doubtful} mesure{doubtful > 1 ? 's restent douteuses' : ' reste douteuse'} — l'impression reste
                possible, sans couleurs de diagnostic.
              </span>
              <button className="btn sm" onClick={() => setState({ step: 'score' })}>Revoir la partition</button>
            </div>
          )}
          {preview.status === 'busy' && <div className="muted"><span className="spin" /> Mise en page…</div>}
          {preview.status === 'ready' && (
            <div className="muted">Aperçu : {preview.pages} page{preview.pages > 1 ? 's' : ''} A4</div>
          )}
          {preview.status === 'error' && <div className="note err">Mise en page impossible : {preview.message}</div>}
        </div>
        <div className="print-viewport">
          <div ref={hostRef} className="print-sheet" />
        </div>
      </section>
    </div>
  );
}
