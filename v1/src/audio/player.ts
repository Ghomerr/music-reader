// Lecteur unique de l'application. Il lit le projet courant du store (réglages compris) et publie la
// position de lecture dans store.playhead.
//
// Planification par fenêtre glissante : toutes les 125 ms, on crée les notes des 2 prochaines secondes, à
// temps absolus du contexte audio (précis à l'échantillon, quel que soit le retard des minuteries). Une
// longue partition démarre donc tout de suite, et un changement de réglage ne reprogramme que l'avenir
// proche. Chaque lecture (« session ») a sa propre sortie : à l'arrêt on la fond en 15 ms, on coupe ses
// sources, puis on la détache ; la session suivante peut démarrer pendant ce fondu.
import { getState, setState } from '../state/store';
import { timeline } from '../model/check';
import type { MeasureTime, Project } from '../model/types';
import { clampTempo, lineSettingsOf, perform, totalBeats, type PlayEvent } from './perform';
import { ARTICULATION, MIN_NOTE, createOutput, hz, voice, type Output } from './synth';

/** horizon de planification, en secondes */
const LOOKAHEAD = 2;
/** période du planificateur, en ms : c'est aussi la cadence de publication de store.playhead (8/s) */
const TICK = 125;
/** délai avant la première note : laisse au contexte le temps de démarrer sans tronquer l'attaque */
const LEAD = 0.06;
/** regroupement des appels à refresh() (curseur de tempo ou de volume tiré à la souris) */
const REFRESH_DELAY = 80;
const EPS = 1e-6;

/** Un passage joué d'un bout à l'autre ; la boucle enchaîne des segments sans interruption. */
interface Segment {
  /** instant (contexte audio) où sonne beat0 */
  t0: number;
  beat0: number;
  /** fin du passage, en noires */
  end: number;
  events: PlayEvent[];
  /** prochain évènement à planifier */
  idx: number;
}

/** Position de pause et valeur de store.playhead (null = arrêté) d'avant une écoute de mesure. */
interface Resume { beat: number; head: number | null }

interface Session {
  out: Output;
  /** secondes par noire */
  spb: number;
  segs: Segment[];
  /** borne de fin (écoute d'une mesure) : pas de boucle */
  to?: number;
  only?: string;
  /** écoute d'une mesure : position principale à retrouver ensuite (l'aperçu ne la déplace pas) */
  resume?: Resume;
  sources: Set<OscillatorNode>;
  timer: number;
}

let ctx: AudioContext | null = null;
let session: Session | null = null;
let pausedBeat = 0;
let refreshTimer = 0;
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version++;
  listeners.forEach(l => l());
}

/** Changement d'état du lecteur (lecture, pause, arrêt, déplacement) : pour useSyncExternalStore. */
export function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
/** Compteur incrémenté à chaque changement d'état (instantané pour useSyncExternalStore). */
export const getVersion = (): number => version;

function createContext(): AudioContext {
  const C = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new C({ latencyHint: 'interactive' });
}

const segEndTime = (s: Session, seg: Segment) => seg.t0 + (seg.end - seg.beat0) * s.spb;

/** Position de lecture courante, en noires (position de pause si rien ne joue). */
export function currentBeat(): number {
  const s = session;
  if (!s || !ctx) return pausedBeat;
  const now = ctx.currentTime;
  let seg = s.segs[0];
  for (const x of s.segs) if (x.t0 <= now) seg = x;
  return Math.min(seg.end, seg.beat0 + Math.max(0, now - seg.t0) / s.spb);
}

export function isPlaying(): boolean {
  return session !== null;
}

/** L'écoute en cours est-elle celle d'une seule mesure (éditeur) ? */
export function isPreview(): boolean {
  return session?.resume !== undefined;
}

function hasEnabledLine(p: Project): boolean {
  return p.lines.some(l => lineSettingsOf(p.settings, l).enabled);
}

function schedule(s: Session, seg: Segment, horizon: number): void {
  const ac = ctx!;
  const now = ac.currentTime;
  while (seg.idx < seg.events.length) {
    const e = seg.events[seg.idx];
    const t = seg.t0 + (e.start - seg.beat0) * s.spb;
    if (t > horizon) break;
    seg.idx++;
    // minuterie affamée au-delà de l'horizon (onglet gelé) : mieux vaut sauter la note que la jouer en retard
    if (t < now - 0.05) continue;
    const srcs = voice(ac, s.out.input, e.instrument, hz(e.midi), Math.max(t, now),
                       Math.max(MIN_NOTE, e.dur * s.spb * ARTICULATION), e.volume);
    for (const o of srcs) {
      s.sources.add(o);
      o.addEventListener('ended', () => s.sources.delete(o));
    }
  }
}

function tick(): void {
  const s = session;
  if (!s || !ctx) return;
  const now = ctx.currentTime;
  const horizon = now + LOOKAHEAD;
  while (s.segs.length > 1 && s.segs[1].t0 <= now) s.segs.shift();
  for (const seg of s.segs) schedule(s, seg, horizon);

  // Boucle : le passage suivant est préparé avant la fin du courant, pour s'enchaîner sans blanc. Le projet
  // est relu à ce moment-là : une correction faite pendant la lecture s'entend au tour suivant.
  let last = s.segs[s.segs.length - 1];
  const p = getState().project;
  if (s.to === undefined && p?.settings.loop && last.idx >= last.events.length && segEndTime(s, last) < horizon) {
    const times = timeline(p);
    const total = totalBeats(times);
    if (total > EPS) {
      last = { t0: segEndTime(s, last), beat0: 0, end: total, events: perform(p, times, { only: s.only }), idx: 0 };
      s.segs.push(last);
      schedule(s, last, horizon);
    }
  }

  if (now >= segEndTime(s, last)) finish();
  else setState({ playhead: currentBeat() });
}

/**
 * Fin de session. `fade` : arrêt demandé (fondu court et coupure des notes déjà programmées) ; sinon fin
 * naturelle, on laisse s'éteindre la résonance des dernières notes avant de détacher la sortie.
 */
function teardown(fade: boolean): void {
  const s = session;
  if (!s) return;
  session = null;
  clearInterval(s.timer);
  clearTimeout(refreshTimer);
  if (fade && ctx) {
    const now = ctx.currentTime;
    s.out.input.gain.cancelScheduledValues(now);
    s.out.input.gain.setTargetAtTime(0, now, 0.015);
    // les notes déjà programmées dans la fenêtre sont coupées (avant même leur début, le cas échéant)
    for (const o of s.sources) { try { o.stop(now + 0.1); } catch { /* déjà arrêtée */ } }
  }
  setTimeout(() => s.out.dispose(), fade ? 150 : 1000);
}

/** Position principale après la session `s` : une écoute de mesure rend celle d'avant l'écoute. */
function settle(s: Session, beat: number, head: number | null): void {
  pausedBeat = s.resume ? s.resume.beat : beat;
  setState({ playhead: s.resume ? s.resume.head : head });
  emit();
}

function finish(): void {
  const s = session;
  if (!s) return;
  teardown(false);
  settle(s, 0, null);
}

interface StartOptions { from: number; to?: number; only?: string; resume?: Resume }

/** Démarre une session ; false si rien n'est jouable (aucune ligne active, passage vide). */
function start(o: StartOptions): boolean {
  const p = getState().project;
  if (!p) return false;
  if (o.only === undefined && !hasEnabledLine(p)) return false;
  const times: MeasureTime[] = timeline(p);
  const end = Math.min(o.to ?? Infinity, totalBeats(times));
  const from = Math.max(0, o.from);
  if (end - from <= EPS) return false;

  teardown(true);
  ctx ??= createContext();
  // appelé depuis un geste de l'utilisateur : autorise le son (politique de lecture automatique)
  ctx.resume().catch(() => {});
  const t0 = ctx.currentTime + LEAD;
  const s: Session = {
    out: createOutput(ctx),
    spb: 60 / clampTempo(p.settings.tempo),
    segs: [{ t0, beat0: from, end, events: perform(p, times, { from, to: end, only: o.only }), idx: 0 }],
    to: o.to,
    only: o.only,
    resume: o.resume,
    sources: new Set(),
    timer: 0,
  };
  session = s;
  tick();
  s.timer = window.setInterval(tick, TICK);
  setState({ playhead: from });
  emit();
  return true;
}

/**
 * Lance la lecture depuis `fromBeat` (par défaut la position de pause ; depuis le début si la partition
 * était finie). `toBeat` borne la lecture (pas de boucle dans ce cas).
 */
export function play(fromBeat?: number, toBeat?: number): void {
  let from = fromBeat ?? pausedBeat;
  if (fromBeat === undefined) {
    const p = getState().project;
    if (p && from >= totalBeats(timeline(p)) - EPS) from = 0;
  }
  start({ from, to: toBeat });
}

export function pause(): void {
  const s = session;
  if (!s) return;
  const b = currentBeat();
  teardown(true);
  settle(s, b, b);
}

export function stop(): void {
  teardown(true);
  pausedBeat = 0;
  setState({ playhead: null });
  emit();
}

/** Déplace la position (barre de progression) ; la lecture continue depuis là si elle était en cours. */
export function seek(beat: number): void {
  const b = Math.max(0, beat);
  if (session) {
    if (!start({ from: b })) pause();
    return;
  }
  pausedBeat = b;
  setState({ playhead: b });
  emit();
}

/**
 * Écoute d'une seule mesure (éditeur) : toutes les lignes actives, ou la seule ligne `lineId` (même
 * désactivée, sans toucher aux réglages). La position de lecture principale n'est pas déplacée.
 */
export function playMeasure(measure: number, lineId?: string): void {
  const p = getState().project;
  if (!p) return;
  const t = timeline(p)[measure];
  if (!t) return;
  const b = currentBeat();
  const resume = session ? (session.resume ?? { beat: b, head: b }) : { beat: pausedBeat, head: getState().playhead };
  start({ from: t.start, to: t.start + t.len, only: lineId, resume });
}

/**
 * À appeler quand les réglages (tempo, transposition, lignes, instruments, volumes) ou les notes changent
 * pendant la lecture : on reprend depuis la position courante avec les nouvelles valeurs. Les appels
 * rapprochés sont regroupés.
 */
export function refresh(): void {
  if (!session) return;
  clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    const s = session;
    if (!s) return;
    const seg = s.segs[0];
    const b = currentBeat();
    if (b >= seg.end - EPS && s.segs.length === 1) return;   // dernière note : on laisse finir
    if (!start({ from: b, to: s.to, only: s.only, resume: s.resume })) {
      // plus rien à jouer (toutes les lignes désactivées) : pause sur place
      teardown(true);
      settle(s, b, b);
    }
  }, REFRESH_DELAY);
}
