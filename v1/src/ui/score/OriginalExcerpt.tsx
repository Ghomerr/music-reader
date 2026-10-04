// Extrait de l'image d'origine pour la mesure ouverte : comparer « ce qui est écrit » et « ce qui a
// été lu ». Disponible tant que l'image est en mémoire (pas pour un projet rechargé depuis un .json).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Measure } from '../../model/types';
import { useStore } from '../../state/store';
import { measureBox } from './edit';

const images = new Map<string, Promise<HTMLImageElement>>();
function loadImage(url: string): Promise<HTMLImageElement> {
  let p = images.get(url);
  if (!p) {
    p = new Promise((ok, ko) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => { images.delete(url); ko(new Error('image illisible')); };
      img.src = url;
    });
    images.set(url, p);
  }
  return p;
}

/** hauteur maximale dessinée, en pixels de l'image (l'affichage la réduit encore) */
const MAX_H = 520;

export function OriginalExcerpt({ measure }: { measure: Measure }) {
  // référence existante du state : pas de nouvel objet dans le sélecteur
  const page = useStore(s => s.pages.find(p => p.key === measure.pageKey));
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  const box = useMemo(() => (page?.layout ? measureBox(page.layout, measure.local) : null), [page?.layout, measure.local]);
  const url = page?.url, scale = page?.scale || 1;

  useEffect(() => {
    if (!url || !box) return;
    let alive = true;
    setFailed(false);
    loadImage(url).then(img => {
      const c = canvasRef.current;
      if (!alive || !c) return;
      // coordonnées du découpage = image analysée (agrandie de `scale`) → image d'origine
      const W = img.naturalWidth, H = img.naturalHeight;
      const sx = Math.max(0, box.x / scale), sy = Math.max(0, box.y / scale);
      const sw = Math.min(W - sx, box.w / scale), sh = Math.min(H - sy, box.h / scale);
      if (sw <= 0 || sh <= 0) { setFailed(true); return; }
      const k = Math.min(1, MAX_H / sh);
      c.width = Math.round(sw * k);
      c.height = Math.round(sh * k);
      const g = c.getContext('2d');
      if (!g) return;
      g.fillStyle = '#fff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
      // les marges (mesures voisines) sont estompées : la mesure visée reste nette
      g.fillStyle = 'rgba(255,255,255,.55)';
      const l = (box.left / scale - sx) * k, r = (box.right / scale - sx) * k;
      if (l > 0) g.fillRect(0, 0, l, c.height);
      if (r < c.width) g.fillRect(r, 0, c.width - r, c.height);
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [url, scale, box]);

  if (!url || !box || failed) return null;
  return (
    <figure className="me-original">
      <canvas ref={canvasRef} aria-label={`Image d'origine, page ${measure.page}, mesure ${measure.label}`} />
      <figcaption>Original — page {measure.page}, mesure {measure.label}</figcaption>
    </figure>
  );
}
