// Service worker de Music Reader, écrit à la main (sans dépendance).
// But : l'application s'ouvre et joue hors ligne (relecture, écoute, impression, export) ; seule l'analyse
// exige le serveur. Changer VERSION à chaque évolution de ce fichier ou de la liste PRECACHE : l'activation
// supprime alors les caches des versions précédentes.
const VERSION = 'v2';
const PREFIX = 'music-reader-';
const CACHE = PREFIX + VERSION;
const PRECACHE = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png'];
/** au-delà, une navigation sans réponse du réseau est servie depuis le cache (réseau très lent) */
const NAV_TIMEOUT = 4000;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(PRECACHE);
    // Les scripts et feuilles de la page d'accueil sont chargés avant que ce service worker ne contrôle la
    // page : on les met en cache tout de suite, sinon le premier passage hors ligne trouverait une page vide.
    try {
      const html = await (await cache.match('/')).text();
      const assets = [...new Set([...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map(m => m[1]))];
      await cache.addAll(assets);
    } catch { /* pas bloquant : ils seront mis en cache à la prochaine visite */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // API : toujours le réseau, jamais de cache (analyses, état des jobs)
  if (url.pathname.startsWith('/api/')) return;

  if (req.mode === 'navigate') event.respondWith(navigate(event));
  else if (url.pathname.startsWith('/assets/')) event.respondWith(cacheFirst(req));
  else event.respondWith(networkFirst(req));
});

/**
 * Navigation : réseau d'abord (on reçoit la dernière version déployée), copie gardée sous « / » — l'appli
 * n'a qu'une page — et repli sur cette copie hors ligne ou si le réseau ne répond pas à temps.
 */
async function navigate(event) {
  const cache = await caches.open(CACHE);
  const network = fetch(event.request).then(res => {
    if (res.ok) {
      const copy = res.clone();
      event.waitUntil(cache.put('/', copy));
    }
    return res;
  });
  network.catch(() => {});   // échec traité plus bas ; évite un rejet non intercepté si le cache a déjà répondu
  const timeout = new Promise(resolve => setTimeout(resolve, NAV_TIMEOUT));
  try {
    const res = await Promise.race([network, timeout.then(() => cache.match('/'))]);
    if (res) return res;
    return await network;
  } catch {
    return (await cache.match('/')) || offlinePage();
  }
}

/** Ressources versionnées par Vite (/assets/nom-HASH.js) : leur contenu ne change jamais. */
async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

/** Autres fichiers (manifeste, icônes…) : réseau d'abord, cache en secours. */
async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw new Error('hors ligne');
  }
}

function offlinePage() {
  return new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Lect’O’Note Matic 3000</title>'
    + '<p style="font:16px system-ui;padding:24px">Hors ligne : Lect’O’Note Matic 3000 n’a pas encore été ouvert avec une connexion sur cet appareil.</p>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
