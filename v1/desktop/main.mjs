// Application de bureau (Electron) : le serveur local et Audiveris tournent dans l'application, l'interface
// s'affiche dans sa fenêtre. Rien à installer à côté : Audiveris (Java compris) et les modèles OCR sont
// embarqués dans les ressources de l'application (cf. fetch-resources.mjs).
//
// Portable : tout ce qu'écrivent Electron (profil Chromium), le serveur (pages analysées) et Audiveris
// (configuration, journaux) va dans un dossier temporaire propre à ce lancement, effacé à la fermeture.
// Seuls les fichiers que l'utilisateur exporte lui-même (projet, audio, MusicXML) restent, là où il les range.
//
// Test sans fenêtre (intégration continue) : electron . --smoke-test=<image>
import { app, BrowserWindow, Menu, shell } from 'electron';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TITLE = "Lect'O'Note Matic 3000";
const APP_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---------- Dossier temporaire de la session ----------

const PREFIX = 'lectonote-';
const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), PREFIX));
// avant « ready » : sinon Chromium crée son profil dans %APPDATA%, ~/.config ou ~/Library
app.setPath('userData', path.join(TEMP, 'electron'));
app.setPath('sessionData', path.join(TEMP, 'electron'));
app.setPath('crashDumps', path.join(TEMP, 'crash'));
app.setPath('logs', path.join(TEMP, 'logs'));

/** Restes d'une session qui n'a pas pu nettoyer (plantage, arrêt brutal) : on les efface au lancement suivant. */
function sweepStale() {
  const day = 24 * 3600 * 1000;
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith(PREFIX)) continue;
      const dir = path.join(os.tmpdir(), name);
      if (dir === TEMP) continue;
      try { if (Date.now() - fs.statSync(dir).mtimeMs > day) fs.rmSync(dir, { recursive: true, force: true }); } catch { /* utilisé ou protégé */ }
    }
  } catch { /* dossier temporaire illisible : rien à faire */ }
}

/**
 * Efface le dossier de la session une fois l'application entièrement arrêtée. On ne peut pas le faire
 * soi-même en quittant : les processus de Chromium (GPU, rendu) tiennent encore leurs fichiers de cache.
 * Un petit processus détaché (le Node d'Electron) attend leur fin, puis supprime le dossier.
 */
let cleanupScheduled = false;
function scheduleCleanup() {
  if (cleanupScheduled) return;
  cleanupScheduled = true;
  const script = `
    const fs = require('fs'), pid = ${process.pid}, dir = ${JSON.stringify(TEMP)};
    const alive = () => { try { process.kill(pid, 0); return true; } catch { return false; } };
    let tries = 0;
    const tick = () => {
      if (alive() && tries++ < 120) return setTimeout(tick, 500);
      for (let i = 0; i < 20; i++) {
        try { fs.rmSync(dir, { recursive: true, force: true }); if (!fs.existsSync(dir)) return; } catch {}
        const until = Date.now() + 500; while (Date.now() < until);
      }
    };
    tick();`;
  try {
    spawn(process.execPath, ['-e', script], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    }).unref();
  } catch { /* au pire, sweepStale s'en chargera au prochain lancement */ }
}

// ---------- Moteur de reconnaissance embarqué ----------

/** Audiveris et les modèles OCR : dans les ressources de l'application, ou dans desktop/resources en développement. */
function engine() {
  const base = app.isPackaged
    ? path.join(process.resourcesPath, 'engine')
    : path.join(APP_ROOT, 'desktop', 'resources', `${process.platform}-${process.arch}`);
  const launcher = {
    win32: ['audiveris', 'Audiveris', 'Audiveris.exe'],
    darwin: ['audiveris', 'Audiveris.app', 'Contents', 'MacOS', 'Audiveris'],
    linux: ['audiveris', 'opt', 'audiveris', 'bin', 'Audiveris'],
  }[process.platform];
  return { cmd: launcher ? path.join(base, ...launcher) : '', tessdata: path.join(base, 'tessdata') };
}

async function startServer() {
  const { cmd, tessdata } = engine();
  // Le serveur lit sa configuration dans l'environnement à l'import : on la pose avant.
  Object.assign(process.env, {
    HOST: '127.0.0.1',
    DIST_DIR: path.join(APP_ROOT, 'dist'),
    JOBS_DIR: path.join(TEMP, 'jobs'),
    AUDIVERIS_HOME: path.join(TEMP, 'audiveris'),
    TESSDATA_PREFIX: tessdata,
    ...(fs.existsSync(cmd) ? { AUDIVERIS_CMD: cmd } : {}),
  });
  const { start } = await import(pathToFileURL(path.join(APP_ROOT, 'server', 'server.mjs')).href);
  return start({ port: 0, host: '127.0.0.1' });
}

// ---------- Fenêtre ----------

function createWindow(origin) {
  const win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 820, minHeight: 560,
    title: TITLE, backgroundColor: '#f6f5f2', show: false, autoHideMenuBar: true,
    icon: process.platform === 'linux' ? path.join(APP_ROOT, 'desktop', 'build', 'icon.png') : undefined,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.once('ready-to-show', () => win.show());
  // garder le nom de l'application, pas le <title> de la page
  win.on('page-title-updated', e => e.preventDefault());
  // liens externes (Twitter…) : dans le navigateur de l'utilisateur, jamais dans l'application
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origin)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  win.loadURL(origin);
  return win;
}

/** Menu : indispensable sur Mac (Cmd+Q, copier-coller) ; masqué ailleurs, où les raccourcis marchent sans lui. */
function setMenu() {
  if (process.platform !== 'darwin') { Menu.setApplicationMenu(null); return; }
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' }, { role: 'editMenu' },
    { label: 'Présentation', submenu: [{ role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ]));
}

// ---------- Test sans fenêtre ----------

/** Analyse une image par le serveur embarqué et vérifie qu'un MusicXML en sort (code de sortie 0 sinon 1). */
async function smokeTest(server, image) {
  const base = `http://127.0.0.1:${server.port}`;
  const health = await (await fetch(base + '/api/health')).json();
  console.log('[test] santé :', JSON.stringify({ audiveris: health.audiveris, ocr: health.ocrLanguages }));
  if (!health.audiveris) throw new Error('Audiveris introuvable dans les ressources');
  const index = await (await fetch(base + '/')).text();
  if (!index.includes('<div id="root">')) throw new Error("l'interface (dist/) n'est pas servie");
  const res = await fetch(`${base}/api/jobs?name=${encodeURIComponent(path.basename(image))}`, { method: 'POST', body: fs.readFileSync(image) });
  let job = await res.json();
  const t0 = Date.now();
  while (job.status === 'queued' || job.status === 'running') {
    if (Date.now() - t0 > 5 * 60 * 1000) throw new Error('analyse trop longue');
    await new Promise(r => setTimeout(r, 1000));
    job = await (await fetch(`${base}/api/jobs/${job.id}`)).json();
  }
  console.log(job.log.slice(-15).join('\n'));
  if (job.status !== 'done') throw new Error(`analyse en échec : ${job.error}`);
  const xml = await (await fetch(base + job.scores[0].url)).text();
  if (!xml.includes('<score-partwise')) throw new Error('MusicXML invalide');
  const layout = job.layoutUrl ? await (await fetch(base + job.layoutUrl)).json() : null;
  console.log(`[test] OK : ${((Date.now() - t0) / 1000).toFixed(1)} s, ${job.measures} mesures, ${xml.match(/<note>|<note /g)?.length ?? 0} notes,`
    + ` ${layout?.systems?.length ?? 0} système(s) dans le découpage`);
}

// ---------- Cycle de vie ----------

let server = null;
const smoke = process.argv.find(a => a.startsWith('--smoke-test='))?.slice('--smoke-test='.length);

app.whenReady().then(async () => {
  sweepStale();
  try {
    server = await startServer();
  } catch (e) {
    console.error('Démarrage du serveur impossible :', e);
    app.exit(1);
    return;
  }
  if (smoke) {
    let code = 0;
    try { await smokeTest(server, path.resolve(smoke)); }
    catch (e) { console.error('[test] ÉCHEC :', e instanceof Error ? e.message : e); code = 1; }
    await server.close();
    scheduleCleanup();
    app.exit(code);
    return;
  }
  setMenu();
  createWindow(`http://127.0.0.1:${server.port}`);
});

// Une seule fenêtre : la fermer quitte l'application, Mac compris (sinon le serveur tournerait pour rien).
app.on('window-all-closed', () => app.quit());

app.on('will-quit', () => {
  void server?.close();
  scheduleCleanup();
});
