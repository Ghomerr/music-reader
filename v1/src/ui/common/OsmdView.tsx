// Affichage d'un MusicXML par OpenSheetMusicDisplay, avec une couche cliquable par mesure et portée.
//
// La couche (rectangles de couleur sous les notes) est recalculée après chaque rendu d'OSMD, mais
// redessinée seule quand ne changent que les couleurs ou la mesure jouée : re-rendre OSMD coûte
// des centaines de millisecondes sur une partition de plusieurs pages, la couche quelques-unes.
import { useCallback, useEffect, useRef, useState, type MouseEvent } from 'react';
import { OpenSheetMusicDisplay, type GraphicalMeasure } from 'opensheetmusicdisplay';
import './OsmdView.css';

export interface OsmdViewProps {
  xml: string;
  /** suivre les sauts de système du MusicXML */
  keepLayout?: boolean;
  zoom?: number;
  /** ids des lignes, dans l'ordre des portées du MusicXML (pour traduire portée → ligne) */
  lineOrder?: string[];
  /** indice de projet de la 1re mesure écrite (option range de writeMusicXml) */
  firstMeasure?: number;
  /** fond coloré par `${measure}|${lineId}` (mesures signalées, mesure ouverte…) */
  cellColors?: Map<string, string>;
  /** mesure en cours de lecture (indice projet), surlignée sur toutes les portées */
  playingMeasure?: number | null;
  onMeasureClick?: (measure: number, lineId?: string) => void;
  /** amène cette mesure (indice projet) à l'écran quand elle change */
  scrollToMeasure?: number | null;
}

/** Une mesure d'une portée sur le dessin, en coordonnées du SVG de sa page. */
interface Cell {
  /** indice de la mesure dans le MusicXML (0 = première mesure écrite) */
  measure: number;
  /** portée graphique (0 = la plus haute) */
  staff: number;
  /** page OSMD (un SVG par page) */
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

const NS = 'http://www.w3.org/2000/svg';
/** unitInPixels d'OSMD : une unité de son modèle = 10 px à zoom 1 */
const UNIT = 10;
const PLAYING = 'rgba(79, 70, 229, 0.20)';

/** Relève la position de chaque (mesure, portée) dans le dessin. Lit des internes d'OSMD : en cas de
 *  surprise on renonce à la couche plutôt que de casser l'affichage. */
function collectCells(osmd: OpenSheetMusicDisplay, host: HTMLElement): Cell[] {
  try {
    const sheet = osmd.GraphicSheet;
    const sources = osmd.Sheet?.SourceMeasures ?? [];
    const index = new Map<unknown, number>(sources.map((s, i) => [s, i]));
    const pages: unknown[] = sheet?.MusicPages ?? [];
    const svgs = host.querySelectorAll('svg');
    const cells: Cell[] = [];
    for (const perStaff of sheet?.MeasureList ?? []) {
      (perStaff ?? []).forEach((gm: GraphicalMeasure | undefined, k) => {
        const b = gm?.PositionAndShape;
        const i = gm && index.get(gm.parentSourceMeasure);
        if (!gm || !b || i === undefined) return;
        const page = Math.max(0, pages.indexOf(gm.ParentMusicSystem?.Parent));
        const svg = svgs[page];
        // VexFlow règle le viewBox à la taille non zoomée ; sans viewBox les coordonnées suivent le zoom
        const scale = svg?.getAttribute('viewBox') ? UNIT : UNIT * (osmd.zoom || 1);
        cells.push({
          measure: i, staff: k, page,
          x: (b.AbsolutePosition.x + b.BorderLeft) * scale,
          y: (b.AbsolutePosition.y + b.BorderTop) * scale,
          w: (b.BorderRight - b.BorderLeft) * scale,
          h: (b.BorderBottom - b.BorderTop) * scale,
        });
      });
    }
    return cells;
  } catch {
    return [];
  }
}

export function OsmdView({
  xml, keepLayout = false, zoom = 1, lineOrder, firstMeasure = 0, cellColors, playingMeasure,
  onMeasureClick, scrollToMeasure,
}: OsmdViewProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const osmdRef = useRef<OpenSheetMusicDisplay | null>(null);
  const cellsRef = useRef<Cell[]>([]);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const widthRef = useRef(0);
  const scrolledRef = useRef<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** compteur de rendus : la couche se redessine après chacun */
  const [renders, setRenders] = useState(0);

  const render = useCallback(() => {
    const osmd = osmdRef.current, host = hostRef.current;
    if (!osmd || !host || !osmd.IsReadyToRender()) return;
    // OSMD vide son conteneur avant de redessiner : on fige la hauteur pour que la page ne remonte pas
    host.style.minHeight = host.offsetHeight + 'px';
    try {
      osmd.zoom = zoomRef.current;
      osmd.render();
      cellsRef.current = collectCells(osmd, host);
      widthRef.current = host.clientWidth;
      setError(null);
    } catch (e) {
      setError('Affichage impossible : ' + (e instanceof Error ? e.message : String(e)));
    } finally {
      host.style.minHeight = '';
      setLoading(false);
      setRenders(r => r + 1);
    }
  }, []);

  // Démontage : on libère OSMD (déclaré avant le chargement, cf. double montage du mode strict).
  useEffect(() => () => {
    osmdRef.current?.clear();
    osmdRef.current = null;
    if (hostRef.current) hostRef.current.innerHTML = '';
  }, []);

  // Chargement : une seule instance, rechargée à chaque nouveau MusicXML (l'ancien dessin reste
  // affiché jusqu'au nouveau rendu, sans clignotement).
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    try {
      if (!osmdRef.current) {
        osmdRef.current = new OpenSheetMusicDisplay(host, {
          backend: 'svg',
          autoResize: false,            // remplacé par l'observateur ci-dessous (rendu débouncé)
          autoBeam: true,
          drawingParameters: 'compacttight',
          coloringEnabled: true,
          colorStemsLikeNoteheads: true,
          drawTitle: false,
          drawPartNames: true,
          // sinon des mesures vides consécutives deviennent une pause multiple : la correspondance
          // « i-ème mesure dessinée = mesure firstMeasure + i » serait rompue
          autoGenerateMultipleRestMeasuresFromRestMeasures: false,
        });
      }
      osmdRef.current.setOptions({
        newSystemFromXML: keepLayout, newSystemFromNewPageInXML: keepLayout, newPageFromXML: keepLayout,
      });
    } catch (e) {
      setError('Affichage impossible : ' + (e instanceof Error ? e.message : String(e)));
      return;
    }
    const osmd = osmdRef.current;
    osmd.load(xml)
      .then(() => { if (!cancelled) render(); })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoading(false);
        setError('Partition illisible : ' + (e instanceof Error ? e.message : String(e)));
      });
    return () => { cancelled = true; };
  }, [xml, keepLayout, render]);

  useEffect(() => { render(); }, [zoom, render]);

  // Pas d'autoResize natif : il re-rend à chaque pixel. On attend que la largeur se stabilise.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    let timer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (Math.abs(host.clientWidth - widthRef.current) > 4) render();
      }, 250);
    });
    ro.observe(host);
    return () => { ro.disconnect(); window.clearTimeout(timer); };
  }, [render]);

  // Couche de surlignage, sous les notes.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const svgs = [...host.querySelectorAll('svg')];
    const layers = svgs.map(svg => {
      svg.querySelector(':scope > g.osmd-layer')?.remove();
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'osmd-layer');
      svg.insertBefore(g, svg.firstChild);
      return g;
    });
    const rect = (c: Cell, fill: string, cls = '') => {
      const g = layers[c.page];
      if (!g) return null;
      const r = document.createElementNS(NS, 'rect');
      // un peu de marge verticale : la mesure se lit mieux qu'avec un cadre collé aux lignes
      const pad = 4 * zoom;
      r.setAttribute('x', String(c.x));
      r.setAttribute('y', String(c.y - pad));
      r.setAttribute('width', String(c.w));
      r.setAttribute('height', String(c.h + 2 * pad));
      r.setAttribute('rx', String(3 * zoom));
      if (cls) r.setAttribute('class', cls);
      r.style.fill = fill;
      g.appendChild(r);
      return r;
    };
    let target: SVGRectElement | null = null;
    for (const c of cellsRef.current) {
      const m = firstMeasure + c.measure;
      const lineId = lineOrder?.[c.staff];
      const color = lineId !== undefined ? cellColors?.get(`${m}|${lineId}`) : undefined;
      if (color) rect(c, color);
      if (playingMeasure === m) rect(c, PLAYING);
      if (scrollToMeasure === m && !target) target = rect(c, 'transparent', 'osmd-target');
    }
    if (scrollToMeasure == null) scrolledRef.current = null;
    else if (target && scrolledRef.current !== scrollToMeasure) {
      scrolledRef.current = scrollToMeasure;
      target.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [renders, cellColors, playingMeasure, lineOrder, firstMeasure, scrollToMeasure, zoom]);

  /** Cellule sous le pointeur : même colonne, portée la plus proche verticalement. */
  const hit = (e: MouseEvent): Cell | null => {
    const host = hostRef.current;
    const svg = (e.target as Element).closest?.('svg');
    if (!host || !svg) return null;
    const page = [...host.querySelectorAll('svg')].indexOf(svg);
    const ctm = svg.getScreenCTM();
    if (page < 0 || !ctm) return null;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(ctm.inverse());
    let best: Cell | null = null;
    let bestD = Infinity;
    for (const c of cellsRef.current) {
      if (c.page !== page || p.x < c.x || p.x > c.x + c.w) continue;
      const d = p.y < c.y ? c.y - p.y : p.y > c.y + c.h ? p.y - (c.y + c.h) : 0;
      if (d < bestD) { best = c; bestD = d; }
    }
    return best && bestD < Math.max(30 * zoom, (best.h || 40) * 0.9) ? best : null;
  };

  const onClick = (e: MouseEvent) => {
    if (!onMeasureClick) return;
    const c = hit(e);
    if (c) onMeasureClick(firstMeasure + c.measure, lineOrder?.[c.staff]);
  };
  const onMove = (e: MouseEvent) => {
    if (!onMeasureClick || !hostRef.current) return;
    hostRef.current.style.cursor = hit(e) ? 'pointer' : '';
  };

  return (
    <div className="osmd-view">
      {error && <div className="note err">{error}</div>}
      {loading && !error && <div className="osmd-loading"><span className="spin" /> Mise en page de la partition…</div>}
      <div ref={hostRef} className="osmd-host" onClick={onClick} onMouseMove={onMove} />
    </div>
  );
}
