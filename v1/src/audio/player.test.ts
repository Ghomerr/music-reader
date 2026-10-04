// Planification du lecteur, vérifiée sur un faux contexte Web Audio (temps piloté par le test) : pas de son
// ici, mais les instants de début et d'arrêt, la fenêtre glissante et le nettoyage des nœuds se contrôlent.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Line, Measure, NoteEvent, Project } from '../model/types';

vi.mock('../model/check', () => ({
  // mesures de 4 temps consécutives (la vraie timeline est testée par l'agent « modèle »)
  timeline: (p: Project) => p.measures.map((_, i) => ({ start: i * 4, len: 4, expected: 4 })),
}));

import { getState, setProject, updateSettings } from '../state/store';
import * as player from './player';

// ---------- Faux Web Audio ----------
class FakeParam {
  value = 0;
  calls: string[] = [];
  setValueAtTime() { this.calls.push('set'); return this; }
  linearRampToValueAtTime() { return this; }
  exponentialRampToValueAtTime() { return this; }
  setTargetAtTime(v: number) { this.calls.push(`target:${v}`); return this; }
  cancelScheduledValues() { this.calls.push('cancel'); return this; }
}
let disconnects = 0;
class FakeNode {
  out: FakeNode[] = [];
  connect(n: FakeNode) { this.out.push(n); return n; }
  disconnect() { this.out = []; disconnects++; }
}
class FakeGain extends FakeNode { gain = new FakeParam(); }
class FakeFilter extends FakeNode { type = ''; frequency = new FakeParam(); }
class FakeOsc extends FakeNode {
  type = '';
  frequency = new FakeParam();
  startAt = NaN;
  stopAt = NaN;
  ended = false;
  onended: (() => void) | null = null;
  private listeners: (() => void)[] = [];
  start(t: number) { this.startAt = t; }
  stop(t: number) { this.stopAt = t; }
  addEventListener(_: string, fn: () => void) { this.listeners.push(fn); }
  fire() { if (this.ended) return; this.ended = true; this.onended?.(); this.listeners.forEach(f => f()); }
}
let oscs: FakeOsc[] = [];
let ctx: FakeCtx;
class FakeCtx {
  currentTime = 0;
  destination = new FakeNode();
  constructor() { ctx = this; }
  resume() { return Promise.resolve(); }
  createGain() { return new FakeGain(); }
  createBiquadFilter() { return new FakeFilter(); }
  createDynamicsCompressor() { return new FakeNode(); }
  createOscillator() { const o = new FakeOsc(); oscs.push(o); return o; }
}

/** Fait avancer le temps audio et les minuteries ensemble ; les sources arrivées à leur fin la signalent. */
function advance(sec: number) {
  const step = 0.025;
  for (let t = 0; t < sec - 1e-9; t += step) {
    ctx.currentTime += step;
    oscs.forEach(o => { if (o.stopAt <= ctx.currentTime) o.fire(); });
    vi.advanceTimersByTime(step * 1000);
  }
}

// ---------- Projet de test ----------
let seq = 0;
const note = (measure: number, offset: number, duration: number, step: 'C' | 'E' | 'G' = 'C'): NoteEvent =>
  ({ id: `n${++seq}`, measure, offset, duration, pitch: { step, alter: 0, octave: 4 }, voice: 1 });
const line = (id: string, notes: NoteEvent[]): Line =>
  ({ id, name: id, part: 0, partName: 'P', staff: 1, clef: { sign: 'G', line: 2 }, notes });
const measure = (i: number): Measure =>
  ({ pageKey: 'p', page: 1, local: i, label: String(i + 1), beats: 4, beatType: 4, fifths: 0, mode: 'major' });

/** `bars` mesures de 4 noires (ligne a, Do) ; ligne b (Mi) en rondes, désactivée. Tempo 120 : 0,5 s la noire. */
function load(bars: number, loop = false) {
  const a = line('a', Array.from({ length: bars * 4 }, (_, i) => note(Math.floor(i / 4), i % 4, 1)));
  const b = line('b', Array.from({ length: bars }, (_, i) => note(i, 0, 4, 'E')));
  const p: Project = {
    format: 'music-reader', version: 2, title: 'T', createdAt: '', pages: [],
    measures: Array.from({ length: bars }, (_, i) => measure(i)), lines: [a, b],
    settings: {
      tempo: 120, transpose: 0, loop,
      lines: { a: { enabled: true, instrument: 'piano', volume: 1 }, b: { enabled: false, instrument: 'flute', volume: 1 } },
      print: { lines: [], lyrics: true, verses: [], title: 'T', keepLayout: false },
    },
    review: { lost: [], checked: [] },
  };
  setProject(p);
}

/** instants de début des notes programmées (une note = 2 oscillateurs au piano, 2 à la flûte) */
const starts = () => [...new Set(oscs.map(o => +o.startAt.toFixed(3)))];
const freqs = () => [...new Set(oscs.map(o => Math.round(o.frequency.value)))];

beforeEach(() => {
  vi.useFakeTimers();
  oscs = [];
  disconnects = 0;
  vi.stubGlobal('AudioContext', FakeCtx);
});
afterEach(() => {
  player.stop();
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('player', () => {
  it('ne programme que les 2 prochaines secondes, à temps absolus, puis fait glisser la fenêtre', () => {
    load(10);   // 40 noires = 20 s
    player.play();
    expect(player.isPlaying()).toBe(true);
    // départ à currentTime + 0,06 ; fenêtre de 2 s : noires 0 à 3
    const t0 = starts()[0];
    expect(starts()).toEqual([0, 1, 2, 3].map(i => +(t0 + i * 0.5).toFixed(3)));
    expect(freqs()).toEqual([262, 523]);   // Do4 et son harmonique (piano), ligne b désactivée
    advance(1);
    expect(starts().length).toBe(6);
    expect(getState().playhead).toBeCloseTo((ctx.currentTime - t0) / 0.5, 0);
  });

  it('pause : fondu, sources coupées, position conservée ; reprise au même endroit', () => {
    load(10);
    player.play();
    advance(1.5);
    const live = oscs.filter(o => !o.ended);
    expect(live.length).toBeGreaterThan(0);
    player.pause();
    const now = ctx.currentTime;
    expect(player.isPlaying()).toBe(false);
    live.forEach(o => expect(o.stopAt).toBeCloseTo(now + 0.1, 6));
    const at = player.currentBeat();
    expect(at).toBeGreaterThan(2.5);
    expect(getState().playhead).toBe(at);
    // plus rien n'est programmé pendant la pause
    const n = oscs.length;
    advance(3);
    expect(oscs.length).toBe(n);
    // reprise : la première note jouée est celle qui suit (ou celle en cours, reprise)
    oscs = [];
    player.play();
    expect(player.currentBeat()).toBeCloseTo(at, 6);
  });

  it('fin naturelle : arrêt, playhead à null, tous les nœuds des notes détachés', () => {
    load(1);    // 4 noires = 2 s
    player.play();
    advance(3.5);
    expect(player.isPlaying()).toBe(false);
    expect(getState().playhead).toBeNull();
    expect(oscs.every(o => o.ended)).toBe(true);
    // une sortie par note (4) + la sortie générale (2 nœuds) après le délai de résonance
    expect(disconnects).toBe(4 + 2);
    // relancer après la fin repart du début
    player.play();
    expect(player.currentBeat()).toBe(0);
  });

  it('boucle : enchaîne le passage suivant sans s\'arrêter', () => {
    load(1, true);
    player.play();
    const t0 = starts()[0];
    advance(5);
    expect(player.isPlaying()).toBe(true);
    // les tours se suivent exactement toutes les 2 s
    const s = starts();
    expect(s.slice(0, 9)).toEqual(Array.from({ length: 9 }, (_, i) => +(t0 + i * 0.5).toFixed(3)));
    // désactiver la boucle : la lecture s'arrête à la fin du tour en cours
    updateSettings(x => ({ ...x, loop: false }));
    advance(4.5);
    expect(player.isPlaying()).toBe(false);
  });

  it('écoute d\'une mesure : ligne seule même désactivée, bornée, position principale intacte', () => {
    load(4);
    player.seek(6);
    player.playMeasure(2, 'b');
    expect(freqs()).toEqual([330, 659]);           // Mi4 (flûte : fondamentale et octave)
    expect(starts().length).toBe(1);               // une ronde
    expect(player.isPreview()).toBe(true);
    advance(3);
    expect(player.isPlaying()).toBe(false);
    expect(player.currentBeat()).toBe(6);
    expect(getState().playhead).toBe(6);
    expect(getState().project!.settings.lines.b.enabled).toBe(false);
  });

  it('écoute d\'une mesure depuis l\'arrêt : playhead revient à null', () => {
    load(4);
    player.stop();
    player.playMeasure(1);
    expect(getState().playhead).toBe(4);
    advance(3);
    expect(player.isPlaying()).toBe(false);
    expect(getState().playhead).toBeNull();
    expect(player.currentBeat()).toBe(0);
  });

  it('refresh : reprend à la position courante avec le nouveau tempo', () => {
    load(10);
    player.play();
    advance(1);
    updateSettings(s => ({ ...s, tempo: 60 }));
    player.refresh();
    player.refresh();   // appels rapprochés regroupés
    const before = oscs.length;
    const live = oscs.filter(o => !o.ended);
    vi.advanceTimersByTime(100);
    const fresh = oscs.slice(before);
    const b = player.currentBeat();
    expect(b).toBeGreaterThan(1.5);
    // nouvelles notes espacées d'une seconde (60 BPM)
    const s = [...new Set(fresh.map(o => +o.startAt.toFixed(3)))];
    expect(s.length).toBeGreaterThan(1);
    expect(s[1] - s[0]).toBeCloseTo(1, 3);
    // les notes de l'ancienne session encore programmées sont coupées (fondu de 0,1 s)
    expect(live.length).toBeGreaterThan(0);
    live.forEach(o => expect(o.stopAt).toBeCloseTo(ctx.currentTime + 0.1, 6));
  });

  it('refresh sans ligne active : pause sur place', () => {
    load(10);
    player.play();
    advance(1);
    updateSettings(s => ({ ...s, lines: { ...s.lines, a: { ...s.lines.a, enabled: false } } }));
    player.refresh();
    vi.advanceTimersByTime(100);
    expect(player.isPlaying()).toBe(false);
    expect(player.currentBeat()).toBeGreaterThan(1.5);
  });

  it('stop : retour au début', () => {
    load(10);
    player.play();
    advance(1);
    player.stop();
    expect(player.currentBeat()).toBe(0);
    expect(getState().playhead).toBeNull();
  });
});
