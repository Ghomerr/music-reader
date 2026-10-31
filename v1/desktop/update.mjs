// Mises à jour de l'application de bureau, publiées sur la page Releases du dépôt GitHub.
//
// Au lancement, on demande à GitHub la dernière version publiée ; si elle est plus récente, l'interface affiche
// un bandeau (lien vers le changelog). Ensuite, selon la forme de l'application :
// - « auto » : installateur Windows, AppImage Linux. electron-updater télécharge la nouvelle version à la demande
//   puis l'installe au redémarrage. Il garde le téléchargement dans le cache de l'utilisateur : c'est une version
//   installée, elle écrit déjà sur la machine.
// - « download » : archive portable Windows (pas d'installateur pour la remplacer) et Mac (la mise à jour
//   automatique y exige une signature Apple payante). Le bandeau ouvre la page de téléchargement.
//
// Variables de test (jamais utiles à l'utilisateur) : LECTONOTE_UPDATE_API (réponse façon GitHub),
// LECTONOTE_UPDATE_FEED (dépôt de mise à jour « generic »), LECTONOTE_UPDATE_MODE (auto | download) ;
// LECTONOTE_NO_UPDATE=1 coupe tout.
import { app, ipcMain, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { isNewer } from './version.mjs';

const REPO = 'Ghomerr/music-reader';
const LATEST_API = process.env.LECTONOTE_UPDATE_API || `https://api.github.com/repos/${REPO}/releases/latest`;
export const CHANGELOG_URL = `https://github.com/${REPO}/blob/main/CHANGELOG.md`;
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

/** @typedef {{ version: string, notesUrl: string, pageUrl: string, mode: 'auto' | 'download' }} UpdateInfo */
/** @typedef {{ status: 'none' } | { status: 'available', info: UpdateInfo } | { status: 'downloading', info: UpdateInfo, percent: number }
 *   | { status: 'ready', info: UpdateInfo } | { status: 'error', info: UpdateInfo, message: string }} UpdateState */

/** @type {UpdateState} */
let state = { status: 'none' };
/** @type {Electron.WebContents | null} */
let target = null;
let updater = null;

function setUpdateState(next) {
  state = next;
  if (target && !target.isDestroyed()) target.send('update:state', state);
}

/** Forme de l'application : elle décide si elle peut se remplacer elle-même. */
export function updateMode() {
  const forced = process.env.LECTONOTE_UPDATE_MODE;
  if (forced === 'auto' || forced === 'download') return forced;
  if (process.platform === 'win32') {
    // l'installateur pose un désinstalleur à côté de l'exécutable ; l'archive portable, non
    const dir = path.dirname(process.execPath);
    try { if (fs.readdirSync(dir).some(f => /^Uninstall .*\.exe$/i.test(f))) return 'auto'; } catch { /* illisible */ }
    return 'download';
  }
  if (process.platform === 'linux' && process.env.APPIMAGE) return 'auto';
  return 'download';
}

async function check() {
  const res = await fetch(LATEST_API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'lectonote-update' } });
  if (!res.ok) throw new Error(`GitHub : HTTP ${res.status}`);
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/, '');
  if (!version || rel.draft || rel.prerelease || !isNewer(version, app.getVersion())) return;
  setUpdateState({
    status: 'available',
    info: { version, notesUrl: CHANGELOG_URL, pageUrl: rel.html_url || RELEASES_URL, mode: updateMode() },
  });
}

/** electron-updater, chargé seulement quand on en a besoin (versions installées). */
async function getUpdater() {
  if (updater) return updater;
  const { default: pkg } = await import('electron-updater');
  const u = pkg.autoUpdater;
  u.autoDownload = false;
  u.autoInstallOnAppQuit = false;
  if (process.env.LECTONOTE_UPDATE_FEED) u.setFeedURL({ provider: 'generic', url: process.env.LECTONOTE_UPDATE_FEED });
  u.on('download-progress', p => {
    if (state.status === 'available' || state.status === 'downloading')
      setUpdateState({ status: 'downloading', info: state.info, percent: Math.round(p.percent || 0) });
  });
  u.on('update-downloaded', () => { if ('info' in state) setUpdateState({ status: 'ready', info: state.info }); });
  u.on('error', err => {
    if ('info' in state) setUpdateState({ status: 'error', info: state.info, message: err?.message || String(err) });
  });
  updater = u;
  return u;
}

async function download() {
  if (!('info' in state)) return;
  const info = state.info;
  if (info.mode !== 'auto') { await shell.openExternal(info.pageUrl); return; }
  try {
    setUpdateState({ status: 'downloading', info, percent: 0 });
    const u = await getUpdater();
    await u.checkForUpdates();
    await u.downloadUpdate();
  } catch (e) {
    setUpdateState({ status: 'error', info, message: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * À appeler une fois la fenêtre créée. `onEvent` reçoit les étapes marquantes (statistiques).
 * Ne fait rien en développement, pendant le test sans fenêtre, ou si LECTONOTE_NO_UPDATE est posé.
 */
export function setupUpdates(win, { enabled, onEvent = () => {} }) {
  target = win.webContents;
  ipcMain.handle('update:get', () => state);
  ipcMain.on('update:download', () => { onEvent('telechargement'); void download(); });
  ipcMain.on('update:open', () => { if ('info' in state) void shell.openExternal(state.info.pageUrl); });
  ipcMain.on('update:notes', () => { void shell.openExternal(CHANGELOG_URL); });
  ipcMain.on('update:install', async () => {
    if (state.status !== 'ready') return;
    onEvent('installation');
    const u = await getUpdater();
    // silencieux, puis relance de l'application mise à jour
    u.quitAndInstall(true, true);
  });
  if (!enabled || process.env.LECTONOTE_NO_UPDATE) return;
  // après l'ouverture de la fenêtre, sans gêner le démarrage ; hors ligne, on n'insiste pas
  setTimeout(() => {
    check().then(() => { if (state.status === 'available') onEvent('disponible'); })
      .catch(e => console.warn('Vérification des mises à jour impossible :', e instanceof Error ? e.message : e));
  }, 3000);
}
