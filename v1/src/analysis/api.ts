// Dialogue avec le serveur d'analyse (server/server.mjs) : envoi d'une image, suivi du job, résultats.
import type { PageLayout } from '../model/types';
import type { JobView } from '../state/store';

async function json<T>(r: Response): Promise<T> {
  let body: unknown = null;
  try { body = await r.json(); } catch { /* corps vide ou non JSON */ }
  if (!r.ok) {
    const msg = (body as { error?: string } | null)?.error;
    throw new Error(msg || `Erreur du serveur (${r.status} ${r.statusText})`);
  }
  return body as T;
}

async function call(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error("Serveur d'analyse injoignable");
  }
}

/** Envoie une image (corps brut) : le serveur la met en file d'attente et renvoie le job créé. */
export async function postImage(image: Blob, name: string, font: string): Promise<JobView> {
  const q = new URLSearchParams({ name, font });
  return json<JobView>(await call(`/api/jobs?${q}`, {
    method: 'POST', body: image, headers: { 'Content-Type': image.type || 'application/octet-stream' },
  }));
}

export async function getJob(id: string): Promise<JobView> {
  return json<JobView>(await call(`/api/jobs/${encodeURIComponent(id)}`));
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

/**
 * Suit un job jusqu'à sa fin (interrogation chaque seconde). `onUpdate` reçoit chaque état
 * intermédiaire (file d'attente, temps écoulé, journal) ; `alive` permet d'abandonner le suivi
 * (page retirée ou relancée entre-temps).
 */
export async function waitJob(job: JobView, onUpdate?: (j: JobView) => void, alive: () => boolean = () => true): Promise<JobView> {
  let j = job;
  onUpdate?.(j);
  while ((j.status === 'queued' || j.status === 'running') && alive()) {
    await sleep(1000);
    if (!alive()) break;
    j = await getJob(j.id);
    onUpdate?.(j);
  }
  return j;
}

/** Envoie puis attend la fin de l'analyse. */
export async function analyseImage(image: Blob, name: string, font: string,
                                   onUpdate?: (j: JobView) => void, alive?: () => boolean): Promise<JobView> {
  return waitJob(await postImage(image, name, font), onUpdate, alive);
}

export async function fetchText(url: string): Promise<string> {
  const r = await call(url);
  if (!r.ok) throw new Error(`Résultat introuvable (${r.status}) : le job a peut-être expiré`);
  return r.text();
}

/** MusicXML de la page (première partition exportée par Audiveris). */
export async function fetchMusicXml(job: JobView): Promise<string> {
  const s = job.scores[0];
  if (!s) throw new Error('Aucune partition exportée');
  return fetchText(s.url);
}

/** Découpage de la page (systèmes, portées, mesures), ou null s'il est indisponible. */
export async function fetchLayout(job: JobView): Promise<PageLayout | null> {
  if (!job.layoutUrl) return null;
  return json<PageLayout>(await call(job.layoutUrl));
}
