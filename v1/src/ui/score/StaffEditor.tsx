// Portée éditable d'une ligne pour une mesure (SVG maison, pas OSMD : il faut savoir exactement où
// tombe chaque note pour la placer, la sélectionner et la déplacer au doigt).
// Axe horizontal proportionnel au temps ; axe vertical = degrés, relatifs à la ligne du bas de la clé.
import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { Line, Measure, NoteEvent } from '../../model/types';
import { EPS, diatonic, durationName, keyAlter, pitchLabel, same } from '../../model/pitch';
import {
  clefAt, clefBottom, figureOf, flagCount, keySignature, lyricDisplay, lyricOf, pitchAt, snapOffset, type NewEvent,
} from './edit';
import { ACC_CHAR, Dots, Head, Rest, STEP, Stem } from './Glyphs';

export interface Tool {
  /** durée de la figure choisie, en noires */
  figure: number;
  rest: boolean;
  /** insérer en décalant la suite (au lieu de former un accord) */
  insert: boolean;
  voice: number;
}

interface Props {
  line: Line;
  /** indice de la mesure dans le projet */
  m: number;
  measure: Measure;
  /** notes de la mesure pour cette ligne */
  notes: NoteEvent[];
  /** durée attendue de la mesure */
  len: number;
  tool: Tool;
  selectedId: string | null;
  verse: number;
  /** afficher les champs de paroles sous les notes */
  lyrics: boolean;
  onSelect: (id: string | null) => void;
  onInsert: (ev: NewEvent) => void;
  /** déplacement vertical d'une note par glisser */
  onMove: (id: string, steps: number) => void;
  onLyric: (id: string, text: string) => void;
}

const INK = '#222';
const MANUAL = '#4f46e5';
const SELECT = '#e8590c';
const GHOST = '#4f46e5';
const TOP = 16;
const BOT = 10;
const CLEF_W = 38;

const CLEF_CHAR = { G: '𝄞', F: '𝄢', C: '𝄡', percussion: '𝄥' } as const;

function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

interface Ghost { offset: number; rel: number; kind: string }
type Gesture =
  | { kind: 'drag'; id: string; y0: number; delta: number }
  | { kind: 'place' };

export function StaffEditor({ line, m, measure, notes, len, tool, selectedId, verse, lyrics, onSelect, onInsert, onMove, onLyric }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const width = useWidth(wrapRef);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [drag, setDrag] = useState<{ id: string; delta: number } | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const fifths = measure.fifths;

  const geo = useMemo(() => {
    const bottomAt = (offset: number) => clefBottom(clefAt(line, m, offset));
    const relOf = (n: NoteEvent) => diatonic(n.pitch!) - bottomAt(n.offset);
    const rels = notes.filter(n => n.pitch).map(relOf);
    const relMin = Math.min(-7, ...rels.map(r => r - 3));
    const relMax = Math.max(15, ...rels.map(r => r + 3));
    const clef0 = clefAt(line, m, 0);
    const keyRel = keySignature(fifths, clefBottom(clef0)).map(d => d - clefBottom(clef0));
    const contentLeft = 8 + CLEF_W + keyRel.length * 9 + 12;
    const voiceEnd = Math.max(len, ...notes.map(n => n.offset + n.duration));
    const limit = Math.max(voiceEnd, 0.25);
    const minDur = Math.min(1, tool.figure, ...notes.map(n => n.duration));
    const avail = (width || 600) - contentLeft - 30;
    const ppb = Math.min(220, Math.max(Math.max(56, 26 / minDur), avail / limit));
    const svgW = Math.max(width || 0, Math.ceil(contentLeft + limit * ppb + 30));
    const height = TOP + (relMax - relMin) * STEP + BOT;
    return {
      bottomAt, relOf, relMin, relMax, clef0, keyRel, contentLeft, voiceEnd, limit, ppb, svgW, height,
      yOf: (rel: number) => TOP + (relMax - rel) * STEP,
      /** centre des têtes posées à `t` (la ligne de grille du temps est juste à gauche) */
      xOf: (t: number) => contentLeft + t * ppb + 9,
    };
  }, [line, m, notes, len, fifths, width, tool.figure]);
  const { yOf, xOf } = geo;

  // ---------- Dessin des évènements ----------
  const voices = new Set(notes.map(n => n.voice));
  const multi = voices.size > 1;
  type Slot = { voice: number; offset: number; duration: number; notes: NoteEvent[] };
  const slots: Slot[] = [];
  for (const n of notes) {
    const s = n.pitch ? slots.find(x => x.notes[0].pitch && x.voice === n.voice && same(x.offset, n.offset)) : undefined;
    if (s) s.notes.push(n);
    else slots.push({ voice: n.voice, offset: n.offset, duration: n.duration, notes: [n] });
  }
  const pitchedSlots = slots.filter(s => s.notes[0].pitch);

  const heads: { id: string; x: number; y: number }[] = [];
  const restHits: { id: string; x: number; y: number }[] = [];
  const out: ReactNode[] = [];
  const ym = yOf(4);

  const ledgers = (x: number, rel: number, key: string, color = INK) => {
    const ls: ReactNode[] = [];
    for (let r = -2; r >= rel; r -= 2) ls.push(<line key={key + 'l' + r} x1={x - 10} x2={x + 10} y1={yOf(r)} y2={yOf(r)} stroke={color} strokeWidth={1.2} />);
    for (let r = 10; r <= rel; r += 2) ls.push(<line key={key + 'l' + r} x1={x - 10} x2={x + 10} y1={yOf(r)} y2={yOf(r)} stroke={color} strokeWidth={1.2} />);
    return ls;
  };

  const nextX = (s: Slot) => {
    const after = slots.filter(o => o.voice === s.voice && o.offset > s.offset + EPS).map(o => xOf(o.offset));
    return after.length ? Math.min(...after) : xOf(s.offset) + 30;
  };

  for (const s of slots) {
    const x = xOf(s.offset);
    const fig = figureOf(s.duration);
    const base = fig?.base ?? 1;
    const key = s.notes[0].id;
    if (!s.notes[0].pitch) {
      const n = s.notes[0];
      const col = n.id === selectedId ? SELECT : n.manual ? MANUAL : INK;
      if (n.id === selectedId) out.push(<rect key={key + 'h'} x={x - 11} y={ym - 20} width={22} height={40} rx={6} fill="rgba(232,89,12,.15)" />);
      const yr = multi ? ym + (n.voice % 2 ? -12 : 12) : ym;
      out.push(<Rest key={key} cx={x} ym={yr} base={base} color={col} />);
      if (fig?.dots) out.push(<g key={key + 'd'}><Dots x={x + 9} y={yr - 3} n={fig.dots} color={col} /></g>);
      if (!fig) out.push(<text key={key + '?'} x={x} y={yOf(10)} textAnchor="middle" fontSize={10} fill={SELECT}>{+s.duration.toFixed(2)}</text>);
      restHits.push({ id: n.id, x, y: yr });
      continue;
    }
    // accord : têtes triées du bas vers le haut ; la note glissée est dessinée à sa nouvelle place
    const items = s.notes.map(n => {
      const rel = geo.relOf(n) + (drag?.id === n.id ? drag.delta : 0);
      const d = rel + geo.bottomAt(n.offset);
      const p = drag?.id === n.id ? pitchAt(d, fifths) : n.pitch!;
      return { n, rel, p };
    }).sort((a, b) => a.rel - b.rel);
    const avg = items.reduce((t, i) => t + i.rel, 0) / items.length;
    const up = multi ? s.voice % 2 === 1 : avg < 4;
    const lo = items[0].rel, hi = items[items.length - 1].rel;
    // secondes : la tête voisine passe de l'autre côté de la hampe
    let prevShift = false;
    const placed = items.map((it, i) => {
      const second = i > 0 && it.rel - items[i - 1].rel === 1 && !prevShift;
      prevShift = second;
      const dx = second ? (up ? 12 : -12) : 0;
      return { ...it, hx: x + dx };
    });
    for (const it of placed) {
      const col = it.n.id === selectedId ? SELECT : it.n.manual ? MANUAL : INK;
      const y = yOf(it.rel);
      out.push(...ledgers(it.hx, it.rel, it.n.id));
      if (it.n.id === selectedId) out.push(<circle key={it.n.id + 'h'} cx={it.hx} cy={y} r={11} fill="rgba(232,89,12,.18)" />);
      out.push(<Head key={it.n.id} cx={it.hx} y={y} base={base} color={col} />);
      if (it.p.alter !== keyAlter(it.p.step, fifths)) {
        out.push(<text key={it.n.id + 'a'} x={x - 11} y={y + 5} textAnchor="end" fontSize={15} fill={col}>{ACC_CHAR[String(it.p.alter)] ?? '?'}</text>);
      }
      if (fig?.dots) {
        const dy = it.rel % 2 === 0 ? -STEP / 1.2 : 0;  // tête sur une ligne : le point monte dans l'interligne
        out.push(<g key={it.n.id + 'd'}><Dots x={x + 11 + (up && placed.some(p => p.hx !== x) ? 12 : 0)} y={y + dy} n={fig.dots} color={col} /></g>);
      }
      if (it.n.tie) {
        const sgn = up ? 1 : -1;
        const x2 = Math.max(nextX(s) - 7, it.hx + 22);
        out.push(<path key={it.n.id + 't'} d={`M${it.hx + 6} ${y + sgn * 6} Q${(it.hx + x2) / 2} ${y + sgn * 15} ${x2} ${y + sgn * 6}`}
                       stroke={col} strokeWidth={1.6} fill="none" />);
      }
      heads.push({ id: it.n.id, x: it.hx, y });
    }
    if (base < 4) {
      const col = s.notes.some(n => n.id === selectedId) ? SELECT : s.notes.some(n => n.manual) ? MANUAL : INK;
      const sx = up ? x + 5.6 : x - 5.6;
      const y0 = up ? yOf(lo) - 1 : yOf(hi) + 1;
      const y1 = up ? yOf(hi) - 7 * STEP : yOf(lo) + 7 * STEP;
      out.push(<Stem key={key + 's'} x={sx} y0={y0} y1={y1} flags={flagCount(base)} color={col} />);
      if (fig?.triplet) out.push(<text key={key + '3'} x={sx} y={up ? y1 - 4 : y1 + 12} textAnchor="middle" fontSize={11} fontWeight={700} fill={col}>3</text>);
    } else if (fig?.triplet) {
      out.push(<text key={key + '3'} x={x} y={yOf(hi) - 10} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>3</text>);
    }
    if (!fig) out.push(<text key={key + '?'} x={x} y={yOf(hi) - 12} textAnchor="middle" fontSize={10} fill={SELECT}>{+s.duration.toFixed(2)}</text>);
  }

  // ---------- Pointeur ----------
  const toSvg = (e: RPointerEvent) => {
    const ctm = svgRef.current?.getScreenCTM();
    if (!ctm) return null;
    return new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
  };
  const hitTest = (p: DOMPoint, touch: boolean) => {
    const tx = touch ? 13 : 9, ty = touch ? 6 : 4.5;
    let best: { id: string; d: number; pitched: boolean } | null = null;
    for (const h of heads) {
      const dx = Math.abs(p.x - h.x), dy = Math.abs(p.y - h.y);
      if (dx <= tx && dy <= ty && (!best || dx + dy < best.d)) best = { id: h.id, d: dx + dy, pitched: true };
    }
    if (!best) for (const r of restHits) {
      const dx = Math.abs(p.x - r.x), dy = Math.abs(p.y - r.y);
      if (dx <= tx && dy <= 18 && (!best || dx < best.d)) best = { id: r.id, d: dx, pitched: false };
    }
    return best;
  };
  const ghostAt = (p: DOMPoint): Ghost => {
    const t = (p.x - xOf(0)) / geo.ppb;
    const snap = snapOffset(t, notes, tool.voice, tool.figure, len, 12 / geo.ppb);
    const rel = Math.max(geo.relMin + 1, Math.min(geo.relMax - 1, Math.round(geo.relMax - (p.y - TOP) / STEP)));
    return { offset: snap.offset, rel, kind: snap.kind };
  };

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = toSvg(e);
    if (!p) return;
    e.preventDefault();
    svgRef.current?.setPointerCapture(e.pointerId);
    const h = hitTest(p, e.pointerType !== 'mouse');
    if (h) {
      onSelect(h.id);
      setGhost(null);
      gesture.current = h.pitched ? { kind: 'drag', id: h.id, y0: p.y, delta: 0 } : null;
      return;
    }
    gesture.current = { kind: 'place' };
    setGhost(ghostAt(p));
  };
  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const p = toSvg(e);
    if (!p) return;
    const g = gesture.current;
    if (g?.kind === 'drag') {
      const delta = Math.round((g.y0 - p.y) / STEP);
      if (delta !== g.delta) { g.delta = delta; setDrag({ id: g.id, delta }); }
      return;
    }
    if (!g && e.pointerType === 'mouse' && hitTest(p, false)) { setGhost(null); return; }
    if (g || e.pointerType === 'mouse') setGhost(ghostAt(p));
  };
  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.kind === 'drag') {
      setDrag(null);
      if (g.delta) onMove(g.id, g.delta);
    } else if (g?.kind === 'place') {
      const p = toSvg(e);
      const gh = p ? ghostAt(p) : ghost;
      if (gh) {
        const d = gh.rel + geo.bottomAt(gh.offset);
        onInsert({ offset: gh.offset, duration: tool.figure, pitch: tool.rest ? null : pitchAt(d, fifths), voice: tool.voice, insert: tool.insert });
      }
    }
    if (e.pointerType !== 'mouse') setGhost(null);
  };
  const onPointerCancel = () => { gesture.current = null; setDrag(null); setGhost(null); };

  // ---------- Fantôme et étiquettes ----------
  let ghostEl: ReactNode = null;
  if (ghost && !drag) {
    const x = xOf(ghost.offset);
    const fig = figureOf(tool.figure);
    const base = fig?.base ?? 1;
    const d = ghost.rel + geo.bottomAt(ghost.offset);
    const label = tool.rest ? 'silence · ' + durationName(tool.figure) : pitchLabel(pitchAt(d, fifths)) + (ghost.kind === 'chord' && !tool.insert ? ' · accord' : '');
    const ly = tool.rest ? yOf(10) : Math.min(yOf(ghost.rel) - 26, yOf(10));
    ghostEl = (
      <g pointerEvents="none">
        {tool.insert && <line x1={x - 12} x2={x - 12} y1={yOf(10)} y2={yOf(-2)} stroke={GHOST} strokeWidth={2} strokeDasharray="3 3" />}
        {tool.rest ? <Rest cx={x} ym={ym} base={base} color={GHOST} opacity={0.6} /> : (
          <>
            {ledgers(x, ghost.rel, 'g', GHOST)}
            <Head cx={x} y={yOf(ghost.rel)} base={base} color={GHOST} opacity={0.6} />
            {base < 4 && <Stem x={ghost.rel < 4 ? x + 5.6 : x - 5.6} y0={yOf(ghost.rel)} y1={yOf(ghost.rel) + (ghost.rel < 4 ? -7 : 7) * STEP}
                               flags={flagCount(base)} color={GHOST} opacity={0.6} />}
          </>
        )}
        <rect x={x - 46} y={Math.max(0, ly - 13)} width={92} height={17} rx={8} fill="#fff" stroke={GHOST} strokeWidth={1} opacity={0.95} />
        <text x={x} y={Math.max(0, ly - 13) + 12.5} textAnchor="middle" fontSize={11.5} fill={GHOST} fontWeight={600}>{label}</text>
      </g>
    );
  } else if (drag) {
    const h = heads.find(x => x.id === drag.id);
    const n = notes.find(x => x.id === drag.id);
    if (h && n) {
      const rel = geo.relOf(n) + drag.delta;
      const lbl = pitchLabel(pitchAt(rel + geo.bottomAt(n.offset), fifths));
      ghostEl = (
        <g pointerEvents="none">
          <rect x={h.x - 30} y={h.y - 30} width={60} height={17} rx={8} fill="#fff" stroke={SELECT} />
          <text x={h.x} y={h.y - 17.5} textAnchor="middle" fontSize={11.5} fill={SELECT} fontWeight={600}>{lbl}</text>
        </g>
      );
    }
  }

  // ---------- Portée, clé, armure, grille ----------
  const staffLines = [0, 2, 4, 6, 8].map(r => (
    <line key={'s' + r} x1={4} x2={geo.svgW - 4} y1={yOf(r)} y2={yOf(r)} stroke="#555" strokeWidth={1} />
  ));
  const beat = 4 / measure.beatType;
  const grid: ReactNode[] = [];
  for (let k = 0, t = 0; t < geo.limit - EPS && k < 64; k++, t = k * beat) {
    grid.push(<line key={'g' + k} x1={xOf(t) - 9} x2={xOf(t) - 9} y1={yOf(10)} y2={yOf(-2)} stroke="#c9c4f5" strokeWidth={1} strokeDasharray={k ? '2 3' : undefined} />);
  }
  const barX = xOf(len) - 9;
  const clefGlyph = (c: typeof geo.clef0, x: number, size: number, key: string) => {
    // ancrage approximatif des glyphes Unicode, réglé sur Segoe UI Symbol / Noto Music
    const y = c.sign === 'G' ? yOf(2) + size * 0.19 : c.sign === 'F' ? yOf(6) + size * 0.2 : yOf(2 * ((c.line || 3) - 1)) + size * 0.25;
    return <text key={key} x={x} y={y} fontSize={size} fill={INK} className="staff-clef">{CLEF_CHAR[c.sign]}</text>;
  };
  const clefChanges = (line.clefChanges ?? []).filter(ch => ch.measure === m && ch.offset > EPS);

  // ---------- Paroles ----------
  const lyricSlots = pitchedSlots
    .filter(s => s.voice === tool.voice || s.notes.some(n => lyricOf(n, verse)))
    .map(s => ({ s, holder: s.notes.find(n => lyricOf(n, verse)) ?? s.notes[0] }));
  const lyricVoices = [...new Set(lyricSlots.map(l => l.s.voice))].sort((a, b) => a - b);

  return (
    <div ref={wrapRef} className="staff-wrap">
      <svg ref={svgRef} className="staff-svg" width={geo.svgW} height={geo.height}
           onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
           onPointerCancel={onPointerCancel} onPointerLeave={e => { if (e.pointerType === 'mouse' && !gesture.current) setGhost(null); }}
           role="img" aria-label={`Portée ${line.name}, mesure ${m + 1}`}>
        <rect x={0} y={0} width={geo.svgW} height={geo.height} fill="#fff" />
        {geo.voiceEnd > len + EPS && <rect x={barX} y={yOf(10)} width={geo.svgW - barX} height={yOf(-2) - yOf(10)} fill="rgba(232,89,12,.10)" />}
        {grid}
        {staffLines}
        <line x1={barX} x2={barX} y1={yOf(8)} y2={yOf(0)} stroke="#333" strokeWidth={1.6} />
        {clefGlyph(geo.clef0, 8, 46, 'clef')}
        {geo.keyRel.map((r, i) => (
          <text key={'k' + i} x={8 + CLEF_W + i * 9} y={yOf(r) + 5} fontSize={15} fill={INK}>{fifths > 0 ? '♯' : '♭'}</text>
        ))}
        {clefChanges.map((ch, i) => clefGlyph(ch.clef, xOf(ch.offset) - 30, 30, 'cc' + i))}
        {out}
        {ghostEl}
      </svg>
      {lyrics && lyricVoices.length > 0 && (
        <div className="staff-lyrics" style={{ width: geo.svgW, height: lyricVoices.length * 32 }}>
          {lyricSlots.map(({ s, holder }) => {
            const after = lyricSlots.filter(o => o.s.voice === s.voice && o.s.offset > s.offset + EPS).map(o => xOf(o.s.offset));
            const right = after.length ? Math.min(...after) - 14 - 3 : geo.svgW - 6;
            const left = xOf(s.offset) - 14;
            const text = lyricDisplay(lyricOf(holder, verse));
            return (
              <LyricInput key={`${holder.id}|${verse}|${text}`} value={text}
                          style={{ left, top: lyricVoices.indexOf(s.voice) * 32, width: Math.max(38, Math.min(130, right - left)) }}
                          label={`Syllabe, ${pitchLabel(holder.pitch!)}, temps ${+(s.offset + 1).toFixed(2)}`}
                          onCommit={t => onLyric(holder.id, t)} />
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Champ de syllabe : validé en quittant le champ ou par Entrée (une seule étape d'annulation). */
function LyricInput({ value, style, label, onCommit }: { value: string; style: React.CSSProperties; label: string; onCommit: (t: string) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const commit = () => { const v = ref.current?.value ?? ''; if (v.trim() !== value) onCommit(v); };
  return (
    <input ref={ref} type="text" className={'staff-lyric' + (value ? '' : ' empty')} defaultValue={value} style={style}
           aria-label={label} placeholder="·" spellCheck={false} autoComplete="off"
           onBlur={commit}
           onKeyDown={e => {
             if (e.key === 'Enter') { e.preventDefault(); ref.current?.blur(); }
             else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (ref.current) ref.current.value = value; ref.current?.blur(); }
           }} />
  );
}
