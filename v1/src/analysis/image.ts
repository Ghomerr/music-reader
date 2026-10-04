// Traitements d'image faits dans le navigateur avant l'envoi : agrandissement et découpe d'un extrait.
import type { Rect } from './sample';

/** Dimensions naturelles d'une image (URL objet). */
export function imageSize(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('Image illisible'));
    img.src = url;
  });
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob(b => (b ? resolve(b) : reject(new Error("Conversion de l'image impossible (mémoire ?)"))), 'image/png'));
}

/**
 * Agrandit l'image d'un facteur f (fond blanc, lissage de qualité). Les images du web ont souvent un
 * interligne inférieur au minimum d'Audiveris : l'agrandir suffit à les rendre lisibles.
 */
export async function scaleImage(file: Blob, f: number): Promise<Blob> {
  if (f === 1) return file;
  const img = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * f);
  c.height = Math.round(img.height * f);
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, c.width, c.height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, c.width, c.height);
  img.close();
  return toBlob(c);
}

/** Découpe un rectangle de l'image (mêmes coordonnées que l'image envoyée à Audiveris). */
export async function cropImage(file: Blob, r: Rect): Promise<Blob> {
  const img = await createImageBitmap(file);
  const x = Math.max(0, Math.min(img.width - 1, Math.round(r.x)));
  const y = Math.max(0, Math.min(img.height - 1, Math.round(r.y)));
  const w = Math.max(1, Math.min(img.width - x, Math.round(r.w)));
  const h = Math.max(1, Math.min(img.height - y, Math.round(r.h)));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(img, x, y, w, h, 0, 0, w, h);
  img.close();
  return toBlob(c);
}
