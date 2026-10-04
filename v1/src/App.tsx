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
          <div className="brand">
            🎼 Music Reader <span className="badge">v1</span>
            <a className="twitter" href="https://twitter.com/Ghomerr" target="_blank" rel="noopener noreferrer"
               title="@Ghomerr sur Twitter" aria-label="@Ghomerr sur Twitter">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
                <path fill="currentColor" d="M23.953 4.57a10 10 0 0 1-2.825.775 4.958 4.958 0 0 0 2.163-2.723c-.951.555-2.005.959-3.127 1.184a4.92 4.92 0 0 0-8.384 4.482C7.69 8.095 4.067 6.13 1.64 3.162a4.822 4.822 0 0 0-.666 2.475c0 1.71.87 3.213 2.188 4.096a4.904 4.904 0 0 1-2.228-.616v.06a4.923 4.923 0 0 0 3.946 4.827 4.996 4.996 0 0 1-2.212.085 4.936 4.936 0 0 0 4.604 3.417 9.867 9.867 0 0 1-6.102 2.105c-.39 0-.779-.023-1.17-.067a13.995 13.995 0 0 0 7.557 2.209c9.053 0 13.998-7.496 13.998-13.985 0-.21 0-.42-.015-.63A9.935 9.935 0 0 0 24 4.59z" />
              </svg>
            </a>
          </div>
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
