// Signes musicaux dessinés en SVG simple (têtes, hampes, crochets, silences) : pas de police musicale
// à charger, et un rendu identique partout, y compris sur mobile où les symboles Unicode musicaux
// manquent souvent. Le dessin vise la lisibilité de l'éditeur, pas la gravure.
import type { Figure } from './edit';

/** demi-interligne, en px : un degré de la gamme */
export const STEP = 6;

export const ACC_CHAR: Record<string, string> = { '2': '𝄪', '1': '♯', '0': '♮', '-1': '♭', '-2': '𝄫' };

export function Head({ cx, y, base, color, opacity }: { cx: number; y: number; base: number; color: string; opacity?: number }) {
  const hollow = base >= 2;
  if (base >= 4) {
    // ronde : tête plus large, évidée en biais
    return (
      <g opacity={opacity}>
        <ellipse cx={cx} cy={y} rx={7.4} ry={4.9} fill={color} />
        <ellipse cx={cx} cy={y} rx={3.4} ry={2.6} transform={`rotate(-50 ${cx} ${y})`} fill="#fff" />
      </g>
    );
  }
  return (
    <ellipse cx={cx} cy={y} rx={hollow ? 6 : 6.3} ry={hollow ? 4.2 : 4.6} transform={`rotate(-22 ${cx} ${y})`}
             fill={hollow ? 'none' : color} stroke={color} strokeWidth={hollow ? 1.8 : 0} opacity={opacity} />
  );
}

/** Hampe de `y0` (côté tête) à `y1` (bout), avec ses crochets. */
export function Stem({ x, y0, y1, flags, color, opacity }: { x: number; y0: number; y1: number; flags: number; color: string; opacity?: number }) {
  const up = y1 < y0;
  const d: string[] = [];
  for (let i = 0; i < flags; i++) {
    const s = up ? y1 + i * 7 : y1 - i * 7;
    d.push(up ? `M${x} ${s} c 1 6 10 8 8 17` : `M${x} ${s} c 1 -6 10 -8 8 -17`);
  }
  return (
    <g stroke={color} fill="none" opacity={opacity}>
      <line x1={x} y1={y0} x2={x} y2={y1} strokeWidth={1.4} />
      {d.length > 0 && <path d={d.join(' ')} strokeWidth={2.4} strokeLinecap="round" />}
    </g>
  );
}

/** Silence centré en `cx` ; `ym` = ordonnée de la ligne du milieu de la portée. */
export function Rest({ cx, ym, base, color, opacity }: { cx: number; ym: number; base: number; color: string; opacity?: number }) {
  if (base >= 4) return <rect x={cx - 6} y={ym - 2 * STEP} width={12} height={5} fill={color} opacity={opacity} />;
  if (base >= 2) return <rect x={cx - 6} y={ym - 5} width={12} height={5} fill={color} opacity={opacity} />;
  if (base >= 1) {
    return (
      <path d={`M${cx - 2} ${ym - 15} L${cx + 4} ${ym - 8} L${cx - 1} ${ym - 2} L${cx + 4} ${ym + 5} C${cx - 3} ${ym + 2} ${cx - 4} ${ym + 8} ${cx + 1} ${ym + 12}`}
            stroke={color} strokeWidth={2.6} fill="none" strokeLinejoin="round" opacity={opacity} />
    );
  }
  const n = Math.max(1, -Math.round(Math.log2(base)));
  const parts = [];
  for (let i = 0; i < n; i++) {
    const y = ym - 6 + i * 6;
    parts.push(<circle key={'c' + i} cx={cx - 3 - i * 1.5} cy={y} r={2.6} fill={color} />);
    parts.push(<path key={'p' + i} d={`M${cx - 4 - i * 1.5} ${y + 1} Q${cx} ${y + 3} ${cx + 4 - i * 1.5} ${y - 2}`} stroke={color} strokeWidth={1.4} fill="none" />);
  }
  return (
    <g opacity={opacity}>
      <line x1={cx + 4} y1={ym - 8} x2={cx - 2 - n * 1.5} y2={ym + 8 + (n - 1) * 6} stroke={color} strokeWidth={1.5} />
      {parts}
    </g>
  );
}

export function Dots({ x, y, n, color }: { x: number; y: number; n: number; color: string }) {
  return <>{Array.from({ length: n }, (_, i) => <circle key={i} cx={x + i * 5} cy={y} r={1.9} fill={color} />)}</>;
}

/** Icône de figure pour la palette (et les résumés). */
export function FigureIcon({ fig, rest, size = 30 }: { fig: Figure; rest?: boolean; size?: number }) {
  const color = 'currentColor';
  const cx = 11, y = 24;
  return (
    <svg width={size * 0.8} height={size} viewBox="0 0 24 30" aria-hidden="true" style={{ overflow: 'visible' }}>
      {rest ? <Rest cx={10} ym={15} base={fig.base} color={color} /> : (
        <>
          <Head cx={cx} y={y} base={fig.base} color={color} />
          {fig.base < 4 && <Stem x={cx + 5.6} y0={y - 1} y1={y - 22} flags={Math.max(0, -Math.round(Math.log2(fig.base)))} color={color} />}
        </>
      )}
      {fig.dots > 0 && <Dots x={rest ? 19 : 20} y={rest ? 13 : y - 2} n={fig.dots} color={color} />}
      {fig.triplet && <text x={rest ? 3 : 4} y={rest ? 1 : 6} fontSize={9} fill={color} fontWeight={700}>3</text>}
    </svg>
  );
}
