// Visite guidée (« Didacticiel »), sur le principe de celles de Dungeon Escape et Malefic Realms, sans
// mascotte : chaque étape met une partie de l'écran en lumière (le reste est assombri) et l'explique dans
// une bulle placée à côté. Une étape dont la cible est absente ou cachée est sautée.
//
// Pas de démarrage automatique : l'application de bureau ne garde rien d'un lancement à l'autre, une visite
// automatique reviendrait donc à chaque fois. On la lance par le bouton de l'en-tête (ou l'invitation de
// l'écran Importer) ; au plus une pastille discrète la suggère, une fois par écran et par session.
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { getState, setState, useStore } from '../../state/store';
import { track } from '../../stats';
import { placeBubble, presentSteps, unionRect, visibleRect, type Rect } from './place';
import { READY, SCREEN, TOURS, type Target, type TourName, type TourStep } from './tours';
import './tutorial.css';

export type { TourName } from './tours';

// ---------- État de la visite (hors React, comme le magasin) ----------

interface Run {
  name: TourName;
  steps: TourStep[];
  i: number;
  /** étape la plus avancée atteinte (statistiques) */
  furthest: number;
  /** action de la bulle en cours (ouverture de l'exemple…) */
  busy: boolean;
  error: string;
}

let run: Run | null = null;
/** élément qui avait le focus avant la visite, pour le lui rendre */
let returnFocus: HTMLElement | null = null;
/** écrans dont la visite a été suggérée ou faite pendant cette session (pastille) */
const seen = new Set<TourName>();
/** jeton du dernier lancement : un second clic pendant l'attente de l'écran annule le premier */
let token = 0;

const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
function setRun(next: Run | null): void {
  run = next;
  listeners.forEach(l => l());
}

// ---------- Cibles ----------

function resolve(target: Target | undefined): Element[] {
  if (target === undefined) return [];
  try {
    if (typeof target === 'string') {
      const el = document.querySelector(target);
      return el ? [el] : [];
    }
    return target();
  } catch {
    return [];   // sélecteur non pris en charge par le navigateur : étape sautée
  }
}

/** Affiché et de taille non nulle (un élément `hidden` ou replié n'a pas de boîte). */
function shown(el: Element): boolean {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
}

const targets = (s: TourStep) => resolve(s.target).filter(shown);
const rectOf = (els: Element[]): Rect | null => unionRect(els.map(e => e.getBoundingClientRect()));

/**
 * Amène la cible à l'écran : d'abord dans ses conteneurs défilants (colonne d'écoute, tiroir de l'éditeur),
 * puis dans la page, entre l'en-tête collant et le tiroir de l'éditeur s'il est ouvert.
 */
function bringIntoView(els: Element[]): void {
  const first = els[0];
  if (!first) return;
  first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  if (first.closest('.app-header, .me-drawer')) return;   // fixés à l'écran : rien à faire défiler
  const r = rectOf(els);
  if (!r) return;
  const top = (document.querySelector('.app-header')?.getBoundingClientRect().bottom ?? 0) + 8;
  const bottom = (document.querySelector('.me-drawer')?.getBoundingClientRect().top ?? window.innerHeight) - 8;
  const band = bottom - top;
  let dy = 0;
  if (r.height > band) dy = r.top - top;   // plus haute que la place : on en montre le haut
  else if (r.top < top || r.top + r.height > bottom) dy = r.top + r.height / 2 - (top + band / 2);
  if (Math.abs(dy) > 1) window.scrollBy({ top: dy, behavior: 'auto' });
}

// ---------- Lancement ----------

const frame = () => new Promise<void>(ok => requestAnimationFrame(() => ok()));

/** Attend que `sel` soit dans la page (rendu de l'écran, de la partition), au plus `ms` millisecondes. */
async function waitFor(sel: string, ms: number): Promise<boolean> {
  const end = performance.now() + ms;
  while (!document.querySelector(sel)) {
    if (performance.now() > end) return false;
    await new Promise(ok => setTimeout(ok, 50));
  }
  return true;
}

/** Affiche l'écran de la visite s'il ne l'est pas ; false si c'est impossible (pas de projet…). */
function showScreen(name: TourName): boolean {
  const s = getState();
  if (name === 'import') { if (s.step !== 'import') setState({ step: 'import' }); return true; }
  if (name === 'analyse') { if (!s.pages.length) return false; if (s.step !== 'analyse') setState({ step: 'analyse' }); return true; }
  if (!s.project) return false;
  if (name === 'print') { if (s.step !== 'print') setState({ step: 'print' }); return true; }
  // « Relire et écouter » se visite éditeur fermé ; l'éditeur a besoin d'une mesure ouverte.
  if (name === 'score') { if (s.step !== 'score' || s.selection) setState({ step: 'score', selection: null }); return true; }
  if (s.step !== 'score' || !s.selection) setState({ step: 'score', selection: s.selection ?? { measure: 0 } });
  return true;
}

async function begin(name: TourName): Promise<void> {
  const mine = ++token;
  if (run) finish(false);
  if (!showScreen(name)) return;
  if (!(await waitFor(SCREEN[name], 3000)) || mine !== token) return;
  const ready = READY[name];
  if (ready) await waitFor(ready, 2500);
  await frame();
  await frame();
  if (mine !== token) return;
  const steps = presentSteps(TOURS[name], s => targets(s).length > 0);
  if (!steps.length) return;
  seen.add(name);
  if (!returnFocus) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  setRun({ name, steps, i: 0, furthest: 0, busy: false, error: '' });
}

/** Fin ou abandon de la visite ; `chain` : une autre visite suit (le focus sera rendu à la fin de celle-ci). */
function finish(completed: boolean, chain = false): void {
  if (!run) return;
  track('tutoriel', { ecran: run.name, etapes: run.furthest + 1, termine: completed });
  setRun(null);
  if (chain) return;
  const el = returnFocus;
  returnFocus = null;
  if (el?.isConnected) el.focus({ preventScroll: true });
}

function go(i: number): void {
  if (!run || run.busy || i < 0 || i >= run.steps.length) return;
  setRun({ ...run, i, furthest: Math.max(run.furthest, i), error: '' });
}

async function runAction(): Promise<void> {
  const action = run?.steps[run.i].action;
  if (!run || !action || run.busy) return;
  setRun({ ...run, busy: true, error: '' });
  try {
    const next = await action.run();
    finish(true, !!next);
    if (next) await begin(next);
  } catch (e) {
    if (run) setRun({ ...run, busy: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** Lance la visite `name`, ou à défaut celle de l'écran affiché (éditeur de mesure s'il est ouvert). */
export function startTour(name?: TourName): void {
  const s = getState();
  void begin(name ?? (s.step === 'score' && s.selection ? 'editor' : s.step));
}

// ---------- Affichage ----------

/** À monter une fois (App) : affiche la visite en cours par-dessus l'application. */
export function TourHost() {
  const current = useSyncExternalStore(subscribe, () => run);
  return (
    <>
      <HelpHint active={!!current} />
      {current && <Tour run={current} />}
    </>
  );
}

function Tour({ run: r }: { run: Run }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const spotRef = useRef<HTMLDivElement>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLButtonElement>(null);
  const step = r.steps[r.i];
  const last = r.i === r.steps.length - 1;
  const total = r.steps.length;

  // Projecteur et bulle sont placés directement dans le DOM : ils suivent défilement et redimensionnement
  // à chaque image, sans repasser par React.
  const placeRef = useRef<(animate: boolean) => void>(() => {});
  placeRef.current = (animate: boolean) => {
    const root = rootRef.current, spot = spotRef.current, bubble = bubbleRef.current;
    if (!root || !spot || !bubble) return;
    const view = { width: window.innerWidth, height: window.innerHeight };
    const rect = rectOf(targets(step));
    const vis = rect && visibleRect(rect, view);
    const p = placeBubble(vis, { width: bubble.offsetWidth, height: bubble.offsetHeight }, view);
    root.classList.toggle('tuto-dim', !vis);
    spot.classList.toggle('tuto-instant', !animate);
    if (vis) Object.assign(spot.style, { top: `${vis.top}px`, left: `${vis.left}px`, width: `${vis.width}px`, height: `${vis.height}px` });
    bubble.dataset.place = p.kind === 'float' ? p.side : p.kind === 'dock' ? `dock-${p.edge}` : 'center';
    Object.assign(bubble.style, p.kind === 'float' ? { top: `${p.top}px`, left: `${p.left}px` } : { top: '', left: '' });
  };

  // Nouvelle étape : cible amenée à l'écran, placement, focus sur le bouton principal.
  const first = useRef(true);
  useLayoutEffect(() => {
    bringIntoView(targets(step));
    placeRef.current(!first.current);
    first.current = false;
    mainRef.current?.focus({ preventScroll: true });
  }, [step]);
  // l'action en échec : son bouton, désactivé pendant l'attente, reprend le focus
  useEffect(() => { if (r.error) mainRef.current?.focus({ preventScroll: true }); }, [r.error]);

  // La bulle change de taille (erreur affichée, police chargée) ou la page bouge : on replace.
  useEffect(() => {
    let raf = 0;
    const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => placeRef.current(false)); };
    window.addEventListener('resize', later);
    window.addEventListener('scroll', later, true);   // capture : aussi les conteneurs défilants
    const ro = new ResizeObserver(later);
    if (bubbleRef.current) ro.observe(bubbleRef.current);
    for (const el of targets(step)) ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', later);
      window.removeEventListener('scroll', later, true);
      ro.disconnect();
    };
  }, [step]);

  // Clavier : la visite passe avant les raccourcis de l'application (éditeur, lecture, annuler), d'où
  // l'écoute en capture sur window et l'arrêt de la propagation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'ArrowRight' && !e.altKey) { e.preventDefault(); if (run) go(run.i + 1); }
      else if (e.key === 'ArrowLeft' && !e.altKey) { e.preventDefault(); if (run) go(run.i - 1); }
      else if (e.key === 'Tab') {
        // le focus reste dans la bulle
        const items = [...(bubbleRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        if (!items.length) return;
        const k = items.indexOf(document.activeElement as HTMLButtonElement);
        e.preventDefault();
        items[(k + (e.shiftKey ? -1 : 1) + items.length) % items.length].focus();
      } else if (!bubbleRef.current?.contains(e.target as Node)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  const action = step.action;
  return (
    <div className="tuto" ref={rootRef}>
      <div className="tuto-spot" ref={spotRef} />
      <div className="tuto-bubble" ref={bubbleRef} role="dialog" aria-modal="true"
           aria-labelledby="tuto-title" aria-describedby="tuto-text">
        <div className="tuto-head">
          <h2 id="tuto-title" className="tuto-title">{step.title}</h2>
          <span className="tuto-progress" aria-label={`Étape ${r.i + 1} sur ${total}`}>{r.i + 1} / {total}</span>
        </div>
        <div id="tuto-text" className="tuto-text">{step.body}</div>
        {r.error && <div className="note err">{r.error}</div>}
        <div className="tuto-actions">
          {!last && <button className="btn sm" onClick={() => finish(false)}>Passer</button>}
          <span className="spacer" />
          {r.i > 0 && <button className="btn sm" onClick={() => go(r.i - 1)} disabled={r.busy}>← Retour</button>}
          {action && (
            <button className="btn sm primary" ref={mainRef} onClick={() => void runAction()} disabled={r.busy}>
              {r.busy && <span className="spin" />} {action.label}
            </button>
          )}
          <button className={'btn sm' + (action ? '' : ' primary')} ref={action ? undefined : mainRef} disabled={r.busy}
                  onClick={() => (last ? finish(true) : go(r.i + 1))}>
            {last ? 'Terminer' : 'Suivant →'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Suggestion discrète ----------

/**
 * Pastille sur le bouton « Didacticiel » à la première arrivée sur un écran dans la session (sauf Importer,
 * qui a son invitation) ; elle disparaît dès qu'on quitte l'écran ou qu'on en lance la visite.
 */
function HelpHint({ active }: { active: boolean }) {
  const name = useStore((s): TourName => (s.step === 'score' && s.selection ? 'editor' : s.step));
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => setHost(document.querySelector('[data-tour="help"]')), []);
  const prev = useRef<TourName | null>(null);
  useEffect(() => {
    if (prev.current && prev.current !== name) seen.add(prev.current);
    prev.current = name;
  }, [name]);
  if (!host || active || name === 'import' || seen.has(name)) return null;
  return createPortal(<span className="tuto-hint" aria-hidden="true" />, host);
}
