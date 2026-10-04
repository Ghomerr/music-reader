import { useEffect } from 'react';
import { canRedo, canUndo, redo, setState, undo, useStore, type StepId } from './state/store';
import { ImportStep } from './ui/import/ImportStep';
import { AnalyseStep } from './ui/analyse/AnalyseStep';
import { ScoreStep } from './ui/score/ScoreStep';
import { PrintStep } from './ui/print/PrintStep';

const STEPS: { id: StepId; label: string }[] = [
  { id: 'import', label: 'Importer' },
  { id: 'analyse', label: 'Analyser' },
  { id: 'score', label: 'Relire et écouter' },
  { id: 'print', label: 'Imprimer' },
];

export function App() {
  const step = useStore(s => s.step);
  const hasPages = useStore(s => s.pages.length > 0);
  const hasProject = useStore(s => !!s.project);
  const server = useStore(s => s.server);
  useStore(s => s.project);   // rafraîchit l'état des boutons annuler / rétablir

  useEffect(() => {
    fetch('/api/health').then(r => r.json()).then(h => setState({
      server: {
        ok: true, audiveris: !!h.audiveris, fonts: h.musicFonts || [],
        message: h.audiveris ? `Audiveris prêt · OCR : ${(h.ocrLanguages || []).join(', ') || 'aucune langue'}`
                             : 'Audiveris introuvable : lancer setup.ps1',
      },
    })).catch(() => setState({ server: { ok: false, audiveris: false, fonts: [], message: 'Serveur injoignable : analyse indisponible' } }));
  }, []);

  // Ctrl+Z / Ctrl+Y (ou Ctrl+Maj+Z) pour annuler et rétablir les corrections, hors champs de saisie.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || (e.target as HTMLElement).closest('input, textarea, select')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const enabled = (id: StepId) => id === 'import' || (id === 'analyse' ? hasPages : hasProject);

  return (
    <>
      <header className="app-header">
        <div className="app-bar">
          <div className="brand">🎼 Music Reader <span className="badge">v1</span></div>
          <nav className="steps">
            {STEPS.map((s, i) => (
              <button key={s.id} className={'step' + (s.id === step ? ' cur' : '')} disabled={!enabled(s.id)}
                      onClick={() => setState({ step: s.id })}>
                <b>{i + 1}</b>{s.label}
              </button>
            ))}
          </nav>
          <span className="spacer" />
          {hasProject && (
            <span className="row" style={{ gap: 4 }}>
              <button className="btn sm" onClick={undo} disabled={!canUndo()} title="Annuler la dernière correction (Ctrl+Z)">↶ Annuler</button>
              <button className="btn sm" onClick={redo} disabled={!canRedo()} title="Rétablir (Ctrl+Y)">↷ Rétablir</button>
            </span>
          )}
          <span className={'badge ' + (server.ok && server.audiveris ? 'ok' : server.ok ? 'err' : 'warn')}>{server.message}</span>
        </div>
      </header>
      <main className="app-main">
        {step === 'import' && <ImportStep />}
        {step === 'analyse' && <AnalyseStep />}
        {step === 'score' && hasProject && <ScoreStep />}
        {step === 'print' && hasProject && <PrintStep />}
      </main>
    </>
  );
}
