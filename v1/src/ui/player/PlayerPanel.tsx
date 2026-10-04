// Panneau d'écoute (étape « Relire et écouter », colonne latérale) : transport, lignes (activer, solo,
// instrument, volume), tempo, tonalité, exports. Les réglages passent par updateSettings (hors historique
// d'annulation) puis player.refresh(), qui les applique en direct si la lecture est en cours.
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { updateSettings, useStore } from '../../state/store';
import { timeline } from '../../model/check';
import { serializeProject } from '../../model/project-io';
import { keyLabel, transposeKey } from '../../model/pitch';
import type { Clef, Line, LineSettings, Project, Settings } from '../../model/types';
import * as player from '../../audio/player';
import { DEFAULT_TEMPO, MAX_TEMPO, MIN_TEMPO, clampTempo, lineSettingsOf, measureAt, totalBeats } from '../../audio/perform';
import { INSTRUMENTS } from '../../audio/synth';
import { renderWav, saveFile, slug, wavName } from '../../audio/wav';
import { lineColor } from './colors';
import './PlayerPanel.css';

/** bornes de la transposition (cf. Settings.transpose) */
const MAX_TRANSPOSE = 24;

export function PlayerPanel() {
  const project = useStore(s => s.project);
  return project ? <Panel project={project} /> : null;
}

/** Réglages modifiés hors historique, puis appliqués en direct si la lecture est en cours. */
function setSettings(fn: (s: Settings) => Settings): void {
  updateSettings(fn);
  player.refresh();
}

function setLine(line: Line, patch: Partial<LineSettings>): void {
  setSettings(s => ({ ...s, lines: { ...s.lines, [line.id]: { ...lineSettingsOf(s, line), ...patch } } }));
}

function setEnabled(lines: Line[], on: (l: Line) => boolean): void {
  setSettings(s => ({
    ...s,
    lines: Object.fromEntries(lines.map(l => [l.id, { ...lineSettingsOf(s, l), enabled: on(l) }])),
  }));
}

const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

function clefLabel(c: Clef): string {
  if (c.sign === 'F') return 'Clé de fa';
  if (c.sign === 'C') return 'Clé d’ut';
  if (c.sign === 'percussion') return 'Percussions';
  return c.octaveChange === -1 ? 'Clé de sol octaviée' : 'Clé de sol';
}

function transposeText(t: number): string {
  if (!t) return 'tonalité d’origine';
  const n = Math.abs(t);
  const amount = n % 12 === 0 ? (n === 12 ? 'une octave' : `${n / 12} octaves`) : `${n} demi-ton${n > 1 ? 's' : ''}`;
  return `${amount} plus ${t > 0 ? 'haut' : 'bas'}`;
}

const signed = (t: number) => (t > 0 ? `+${t}` : t < 0 ? `−${-t}` : '0');

function Panel({ project }: { project: Project }) {
  const settings = project.settings;
  const version = useSyncExternalStore(player.subscribe, player.getVersion);
  const playing = player.isPlaying();
  void version;   // relu à chaque changement d'état du lecteur

  // La timeline dépend des mesures, des notes et des lignes cochées (seules elles allongent une mesure
  // qui déborde) : pas recalculée quand on change le tempo ou un volume.
  const enabledKey = project.lines.filter(l => lineSettingsOf(settings, l).enabled).map(l => l.id).join(',');
  const times = useMemo(() => timeline(project), [project.measures, project.lines, enabledKey]);
  const total = totalBeats(times);
  const noteCounts = useMemo(() => project.lines.map(l => l.notes.filter(n => n.pitch).length), [project.lines]);
  const anyEnabled = project.lines.some(l => lineSettingsOf(settings, l).enabled);

  // Une correction du modèle pendant la lecture s'entend tout de suite.
  useEffect(() => { player.refresh(); }, [project.lines, project.measures]);
  // Quitter l'étape met la lecture en pause : sans panneau, plus rien pour l'arrêter.
  useEffect(() => () => player.pause(), []);

  // ---------- Progression : animée hors React (requestAnimationFrame) pendant la lecture ----------
  const fillRef = useRef<HTMLElement>(null);
  const posRef = useRef<HTMLSpanElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const spb = 60 / clampTempo(settings.tempo);
  const paint = useCallback((b: number) => {
    if (fillRef.current) fillRef.current.style.width = total ? `${Math.min(100, (b / total) * 100)}%` : '0';
    const m = project.measures[measureAt(times, b)];
    if (posRef.current) posRef.current.textContent = m ? `Page ${m.page} · mesure ${m.label}` : '';
    if (timeRef.current) timeRef.current.textContent = `${fmt(b * spb)} / ${fmt(total * spb)}`;
  }, [times, total, spb, project.measures]);
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      paint(player.currentBeat());
      if (player.isPlaying()) raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [paint, version]);

  const toggle = useCallback(() => (player.isPlaying() ? player.pause() : player.play()), []);

  // Barre d'espace : lecture / pause, sauf dans un champ ou sur un bouton (qui réagit déjà à l'espace).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.target as HTMLElement).closest?.('input, textarea, select, button, [contenteditable="true"]')) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggle]);

  const seekAt = (e: ReactMouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!r.width || !total) return;
    player.seek(Math.max(0, Math.min(total - 0.01, ((e.clientX - r.left) / r.width) * total)));
  };
  // flèches sur la barre : mesure précédente / suivante
  const seekKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const b = player.currentBeat();
    const i = measureAt(times, b);
    if (i < 0) return;
    const target = e.key === 'ArrowRight' ? i + 1
      : b - times[i].start > 0.5 ? i : i - 1;   // comme un lecteur : d'abord le début de la mesure courante
    const t = times[Math.max(0, Math.min(times.length - 1, target))];
    player.seek(t.start);
  };

  // ---------- Tempo ----------
  const [tempoDraft, setTempoDraft] = useState<string | null>(null);
  const setTempo = (v: number) => setSettings(s => ({ ...s, tempo: clampTempo(v) }));
  const commitTempo = () => {
    if (tempoDraft !== null && tempoDraft.trim() !== '' && Number.isFinite(+tempoDraft)) setTempo(+tempoDraft);
    setTempoDraft(null);
  };

  // ---------- Tonalité ----------
  const first = project.measures[0];
  const fifths = first?.fifths ?? 0;
  const mode = first?.mode ?? 'major';
  const t = settings.transpose;
  const origKey = keyLabel(fifths, mode);
  const newKey = keyLabel(transposeKey(fifths, t).fifths, mode);
  const setTranspose = (v: number) =>
    setSettings(s => ({ ...s, transpose: Math.max(-MAX_TRANSPOSE, Math.min(MAX_TRANSPOSE, v)) }));

  // ---------- Exports ----------
  const [wavProgress, setWavProgress] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const exportJson = async () => {
    try {
      const name = `${slug(project.title)}.music-reader.json`;
      const r = await saveFile(new Blob([serializeProject(project)], { type: 'application/json' }), name);
      setStatus(r === 'cancelled' ? '' : `Projet exporté : ${name}`);
    } catch (e) {
      setStatus(`Échec de l’export du projet : ${(e as Error).message}`);
    }
  };
  const exportWav = async () => {
    setWavProgress(0);
    setStatus('');
    try {
      const blob = await renderWav(project, f => setWavProgress(f));
      const name = wavName(project);
      const r = await saveFile(blob, name);
      setStatus(r === 'cancelled' ? '' : `Audio exporté : ${name} (${(blob.size / 1e6).toFixed(1)} Mo)`);
    } catch (e) {
      setStatus(`Échec de l’export audio : ${(e as Error).message}`);
    } finally {
      setWavProgress(null);
    }
  };

  return (
    <div className="pl">
      <div className="card">
        <div className="pl-transport">
          <button className="pl-play" onClick={toggle} disabled={!playing && !anyEnabled}
                  aria-label={playing ? 'Pause' : 'Lecture'} title={playing ? 'Pause (espace)' : 'Lecture (espace)'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="btn pl-round" onClick={player.stop} aria-label="Stop" title="Stop">■</button>
          <span className="spacer" />
          <label className="pl-chk">
            <input type="checkbox" checked={settings.loop}
                   onChange={e => { const loop = e.target.checked; updateSettings(s => ({ ...s, loop })); }} />
            Boucle
          </label>
        </div>
        <div className="pl-prog" onClick={seekAt} onKeyDown={seekKey} tabIndex={0} role="slider"
             aria-label="Position de lecture" aria-valuemin={0} aria-valuemax={Math.round(total)}
             aria-valuenow={Math.round(player.currentBeat())}>
          <i ref={fillRef} />
        </div>
        <div className="pl-prog-info"><span ref={posRef} /><span ref={timeRef} /></div>
        {!anyEnabled && <div className="note warn">Aucune ligne active : rien à jouer.</div>}
        <small className="pl-cap">Reprises et sauts (D.C., coda) ne sont pas pris en compte : la partition est jouée telle qu&rsquo;écrite.</small>
      </div>

      <div className="card">
        <div className="row pl-head">
          <h3>Lignes</h3>
          <span className="row" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => setEnabled(project.lines, () => true)}>Toutes</button>
            <button className="btn sm" onClick={() => setEnabled(project.lines, () => false)}>Aucune</button>
          </span>
        </div>
        <small className="pl-cap" style={{ margin: '0 0 8px' }}>Une ligne décochée n&rsquo;est plus jouée, ni affichée sur la partition et dans la liste à relire.</small>
        {project.lines.map((l, i) => {
          const ls = lineSettingsOf(settings, l);
          return (
            <div key={l.id} className={'pl-line' + (ls.enabled ? '' : ' off')}>
              <label className="pl-line-head">
                <input type="checkbox" checked={ls.enabled} onChange={e => setLine(l, { enabled: e.target.checked })} />
                <span className="pl-sw" style={{ background: lineColor(i) }} />
                <span className="pl-lbl">
                  <b>{l.name}</b>
                  <small>{clefLabel(l.clef)} · {noteCounts[i]} note{noteCounts[i] > 1 ? 's' : ''}</small>
                </span>
                <button className="btn sm" type="button" title="Jouer cette ligne seule"
                        onClick={e => { e.preventDefault(); setEnabled(project.lines, x => x.id === l.id); }}>Solo</button>
              </label>
              <div className="pl-line-ctrl">
                <select value={ls.instrument} aria-label={`Instrument de ${l.name}`}
                        onChange={e => setLine(l, { instrument: e.target.value as LineSettings['instrument'] })}>
                  {INSTRUMENTS.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                </select>
                <span aria-hidden="true" title="Volume">🔊</span>
                <input type="range" min={0} max={1} step={0.05} value={ls.volume} aria-label={`Volume de ${l.name}`}
                       onChange={e => setLine(l, { volume: +e.target.value })} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h3>Tempo</h3>
        <div className="pl-tempo">
          <span className="pl-tempo-sym">♩ =</span>
          <input type="number" min={MIN_TEMPO} max={MAX_TEMPO} aria-label="Tempo (noires par minute)"
                 value={tempoDraft ?? String(settings.tempo)}
                 onChange={e => setTempoDraft(e.target.value)} onBlur={commitTempo}
                 onKeyDown={e => { if (e.key === 'Enter') commitTempo(); if (e.key === 'Escape') setTempoDraft(null); }} />
          <span className="muted">BPM</span>
        </div>
        <input type="range" className="pl-full" min={MIN_TEMPO} max={MAX_TEMPO} value={settings.tempo}
               aria-label="Tempo" onChange={e => setTempo(+e.target.value)} />
        <div className="row pl-btns">
          {[-10, -1, 1, 10].map(d => (
            <button key={d} className="btn sm" onClick={() => setTempo(settings.tempo + d)}>{d > 0 ? `+${d}` : `−${-d}`}</button>
          ))}
          <button className="btn sm pl-push" onClick={() => setTempo(DEFAULT_TEMPO)} disabled={settings.tempo === DEFAULT_TEMPO}>Réinitialiser</button>
        </div>
        <small className="pl-cap">Jamais lu sur la partition : on part de 100 et on ajuste à l&rsquo;oreille.</small>
      </div>

      <div className="card">
        <h3>Tonalité</h3>
        <div className="pl-stepper">
          <button className="btn pl-round" onClick={() => setTranspose(t - 1)} disabled={t <= -MAX_TRANSPOSE}
                  aria-label="Baisser d'un demi-ton">−</button>
          <div className="pl-val">
            <b>{t ? `${origKey} → ${newKey} (${signed(t)})` : origKey}</b>
            <small>{transposeText(t)}</small>
          </div>
          <button className="btn pl-round" onClick={() => setTranspose(t + 1)} disabled={t >= MAX_TRANSPOSE}
                  aria-label="Monter d'un demi-ton">+</button>
        </div>
        <div className="row pl-btns">
          <button className="btn sm" onClick={() => setTranspose(t - 12)} disabled={t - 12 < -MAX_TRANSPOSE}>−1 octave</button>
          <button className="btn sm" onClick={() => setTranspose(t + 12)} disabled={t + 12 > MAX_TRANSPOSE}>+1 octave</button>
          <button className="btn sm pl-push" onClick={() => setTranspose(0)} disabled={!t}>Réinitialiser</button>
        </div>
      </div>

      <div className="card">
        <h3>Exporter</h3>
        <div className="pl-export">
          <button className="btn" onClick={exportJson}>💾 Projet (.json)</button>
          <button className="btn" onClick={exportWav} disabled={wavProgress !== null || !anyEnabled}>
            {wavProgress !== null ? <><span className="spin" /> {Math.round(wavProgress * 100)} %</> : '🎵 Audio (.wav)'}
          </button>
        </div>
        {wavProgress !== null && <progress className="pl-full" value={wavProgress} max={1} aria-label="Génération de l'audio" />}
        <small className="pl-cap">
          {status || 'Le projet contient les notes, les corrections et tous les réglages : il se rouvre à l’étape 1 sans refaire l’analyse. L’audio reprend les réglages en cours.'}
        </small>
      </div>
    </div>
  );
}
