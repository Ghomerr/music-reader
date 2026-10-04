// Music Reader v1 — serveur : analyse des pages par Audiveris (file d'attente, une à la fois) et
// service du front construit (dist/). Node seul, sans dépendance : il doit tourner tel quel sur un
// petit VPS ou dans le conteneur Docker.
// Usage : node server/server.mjs   puis http://localhost:8787
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readLayout, readScore } from './omr.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const JOBS_DIR = process.env.JOBS_DIR || path.join(ROOT, 'jobs');
const DIST_DIR = process.env.DIST_DIR || path.join(ROOT, 'dist');
// Outils locaux : ceux de la v1 d'abord, sinon ceux déjà téléchargés pour la v0 (rien à refaire).
const TOOL_DIRS = [path.join(ROOT, 'tools'), path.join(ROOT, '..', 'v0', 'tools')];
const TESSDATA = process.env.TESSDATA_PREFIX
  || TOOL_DIRS.map(d => path.join(d, 'tessdata')).find(d => fs.existsSync(d))
  || path.join(TOOL_DIRS[0], 'tessdata');
// Audiveris reconnaît les têtes de notes en les comparant aux gabarits d'une police de référence.
// La famille retenue change tout (cf. v0/README.md, « Le cas des rondes ») : l'interface en choisit
// une par page, ou la fait choisir par un essai sur la première page.
const MUSIC_FONTS = ['Leland', 'Bravura', 'FinaleJazz', 'Primus', 'MusicalSymbols', 'JazzPerc'];
const MUSIC_FONT = MUSIC_FONTS.includes(process.env.MUSIC_FONT) ? process.env.MUSIC_FONT : 'Leland';
// Bonus accordé aux têtes sans hampe : sans effet si la police est la bonne, nuisible au-delà de 0,5.
const STEM_LESS_BOOST = process.env.STEM_LESS_BOOST ?? '';
const MAX_UPLOAD = 30 * 1024 * 1024;
const OMR_TIMEOUT = 5 * 60 * 1000;
const JOB_TTL = 2 * 60 * 60 * 1000;

const AUDIVERIS = [
  process.env.AUDIVERIS_CMD,
  ...TOOL_DIRS.flatMap(d => [path.join(d, 'audiveris', 'Audiveris', 'Audiveris.exe'), path.join(d, 'audiveris', 'bin', 'Audiveris')]),
  'C:\\Program Files\\Audiveris\\Audiveris.exe',
  '/opt/audiveris/bin/Audiveris',
  '/opt/audiveris/bin/audiveris',
].find(p => p && fs.existsSync(p));

fs.mkdirSync(JOBS_DIR, { recursive: true });

// ---------- Jobs ----------
const jobs = new Map();
const queue = [];
let busy = false;

function createJob(name, data, font) {
  const id = crypto.randomBytes(6).toString('hex');
  const dir = path.join(JOBS_DIR, id);
  fs.mkdirSync(path.join(dir, 'out'), { recursive: true });
  const ext = (path.extname(name).toLowerCase().match(/^\.(png|jpe?g|gif|bmp|tiff?)$/) || ['.png'])[0];
  const input = path.join(dir, 'input' + ext);
  fs.writeFileSync(input, data);
  const job = { id, name, dir, input, font, status: 'queued', createdAt: Date.now(), log: [], scores: [], unplaced: [] };
  jobs.set(id, job);
  queue.push(job);
  pump();
  return job;
}

function pump() {
  if (busy || !queue.length) return;
  busy = true;
  runJob(queue.shift()).finally(() => { busy = false; pump(); });
}

function runJob(job) {
  return new Promise(resolve => {
    job.status = 'running';
    job.startedAt = Date.now();
    const args = ['-batch', '-export', '-output', path.join(job.dir, 'out'),
                  '-constant', `org.audiveris.omr.ui.symbol.MusicFont.defaultMusicFamily=${job.font}`,
                  // Un système en retrait marque pour Audiveris le début d'un nouveau mouvement : il coupe
                  // alors la page en plusieurs partitions (Fortunio p. 1 : deux MusicXML dont le premier
                  // ne contient que l'introduction). Une image = une page = une partition : on désactive.
                  '-constant', 'org.audiveris.omr.sheet.ProcessingSwitches.indentations=false'];
    if (STEM_LESS_BOOST) args.push('-constant', `org.audiveris.omr.sheet.note.NoteHeadsBuilder.stemLessBoost=${STEM_LESS_BOOST}`);
    args.push('--', job.input);
    const child = spawn(AUDIVERIS, args, { env: { ...process.env, TESSDATA_PREFIX: TESSDATA }, windowsHide: true });
    const onData = buf => {
      for (const line of buf.toString('utf8').split(/\r?\n/)) {
        if (!line.trim()) continue;
        job.log.push(line);
        const low = /too low interline value of (\d+)/.exec(line);
        if (low) job.interline = +low[1], job.interlineTooLow = true;
        const sc = /Scale\{\s*interline\((\d+),(\d+),(\d+)\)/.exec(line);
        if (sc) job.interline = +sc[2];
        const ms = /(\d+) raw measures/.exec(line);
        if (ms) job.measures = (job.measures || 0) + +ms[1];
        // Note ou silence qu'Audiveris a reconnu sans savoir le placer dans le temps : il ne sera pas
        // exporté, et la mesure peut quand même tomber juste. Seul le journal le signale.
        // Ex. : Measure{#3P2} No timeOffset for HeadChordInter#6510{(0.905/0.905) staff:2 slot#4 dur:1/4}
        const lost = /Measure\{#(\d+)(?:P(\d+))?\} No timeOffset for (Head|Rest)ChordInter#(\d+)\{[^}]*?staff:(\d+)[^}]*?dur:(\d+)\/(\d+)/.exec(line);
        if (lost && !job.unplaced.some(u => u.id === lost[4]))
          job.unplaced.push({ measure: lost[1], part: lost[2] ? +lost[2] : null, rest: lost[3] === 'Rest',
                              id: lost[4], staff: +lost[5], dur: [+lost[6], +lost[7]] });
      }
      if (job.log.length > 2000) job.log.splice(0, job.log.length - 2000);
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    const timer = setTimeout(() => { job.log.push(`[serveur] Délai dépassé (${OMR_TIMEOUT / 1000} s), arrêt d'Audiveris.`); child.kill(); }, OMR_TIMEOUT);
    child.on('error', err => { job.log.push('[serveur] ' + err.message); });
    child.on('close', code => {
      clearTimeout(timer);
      job.exitCode = code;
      job.finishedAt = Date.now();
      try {
        const out = path.join(job.dir, 'out');
        const files = fs.readdirSync(out);
        job.scores = files.filter(f => /\.(mxl|xml|musicxml)$/i.test(f)).sort().map(f => {
          const xml = readScore(path.join(out, f));
          const dest = path.join(job.dir, f.replace(/\.(mxl|musicxml)$/i, '') + '.xml');
          if (!fs.existsSync(dest)) fs.writeFileSync(dest, xml);
          return { file: f, xml: path.basename(dest) };
        });
        const omr = files.find(f => /\.omr$/i.test(f));
        if (omr) job.omr = path.join(out, omr);
      } catch (err) {
        job.log.push('[serveur] Lecture du résultat impossible : ' + err.message);
      }
      if (job.scores.length) job.status = 'done';
      else {
        job.status = 'error';
        job.error = job.interlineTooLow
          ? `Résolution trop faible (interligne de ${job.interline} px). Agrandir l'image puis réessayer.`
          : `Aucune partition exportée par Audiveris (code ${code}).`;
      }
      resolve();
    });
  });
}

function jobView(job) {
  const pos = queue.indexOf(job);
  return {
    id: job.id, name: job.name, status: job.status, error: job.error,
    queuePosition: pos >= 0 ? pos + 1 : 0,
    elapsedMs: job.startedAt ? (job.finishedAt || Date.now()) - job.startedAt : 0,
    interline: job.interline ?? null, interlineTooLow: !!job.interlineTooLow, measures: job.measures ?? null, font: job.font,
    unplaced: job.unplaced,
    scores: job.scores.map(s => ({ name: path.parse(job.name).name + s.file.slice('input'.length), url: `/api/jobs/${job.id}/files/${encodeURIComponent(s.xml)}` })),
    ...(job.status === 'done' && job.omr ? { layoutUrl: `/api/jobs/${job.id}/layout` } : {}),
    log: job.log.slice(-400),
  };
}

// Nettoyage des anciens jobs (le serveur ne garde rien durablement).
function cleanup() {
  const now = Date.now();
  for (const [id, job] of jobs) if (job.status !== 'running' && job.status !== 'queued' && now - job.createdAt > JOB_TTL) {
    fs.rmSync(job.dir, { recursive: true, force: true });
    jobs.delete(id);
  }
  for (const d of fs.readdirSync(JOBS_DIR)) if (!jobs.has(d)) fs.rmSync(path.join(JOBS_DIR, d), { recursive: true, force: true });
}
cleanup();
setInterval(cleanup, 10 * 60 * 1000).unref();

// ---------- HTTP ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.xml': 'application/vnd.recordare.musicxml+xml; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg',
};

const send = (res, code, body, type = 'application/json', cache = 'no-store') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': cache });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

function sendFile(res, file, cache = 'no-store') {
  fs.readFile(file, (err, data) => err ? send(res, 404, { error: 'introuvable' })
    : send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', cache));
}

// Front construit par Vite : les fichiers de dist/assets portent une empreinte dans leur nom et se
// gardent indéfiniment ; index.html et sw.js doivent toujours être revalidés, sinon une nouvelle
// version n'arrive jamais. Toute route inconnue hors /api renvoie index.html (application à page unique).
function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.normalize(path.join(DIST_DIR, rel));
  if (!file.startsWith(DIST_DIR)) return send(res, 403, { error: 'interdit' });
  fs.stat(file, (err, st) => {
    if (!err && st.isFile()) {
      const cache = rel.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache';
      return sendFile(res, file, cache);
    }
    const index = path.join(DIST_DIR, 'index.html');
    if (!fs.existsSync(index))
      return send(res, 404, 'Interface non construite : lancer « npm run build » (ou « npm run dev » pour le développement).', 'text/plain; charset=utf-8');
    sendFile(res, index, 'no-cache');
  });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_UPLOAD) { reject(new Error('fichier trop volumineux')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/health') {
      const langs = fs.existsSync(TESSDATA) ? fs.readdirSync(TESSDATA).filter(f => f.endsWith('.traineddata')).map(f => f.slice(0, -12)) : [];
      return send(res, 200, { audiveris: AUDIVERIS || null, ocrLanguages: langs, queue: queue.length, busy,
                              musicFonts: MUSIC_FONTS, musicFont: MUSIC_FONT });
    }
    if (url.pathname === '/api/jobs' && req.method === 'POST') {
      if (!AUDIVERIS) return send(res, 503, { error: 'Audiveris introuvable : lancer setup.ps1 ou définir AUDIVERIS_CMD.' });
      const data = await readBody(req);
      if (!data.length) return send(res, 400, { error: 'image vide' });
      const asked = url.searchParams.get('font');
      const job = createJob(url.searchParams.get('name') || 'page.png', data, MUSIC_FONTS.includes(asked) ? asked : MUSIC_FONT);
      return send(res, 201, jobView(job));
    }
    if (url.pathname.startsWith('/api/')) {
      const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts[1] !== 'jobs' || !parts[2]) return send(res, 404, { error: 'introuvable' });
      const job = jobs.get(parts[2]);
      if (!job) return send(res, 404, { error: 'job inconnu (expiré ?)' });
      if (parts.length === 3) return send(res, 200, jobView(job));
      if (parts[3] === 'input') return sendFile(res, job.input);
      if (parts[3] === 'files' && parts[4] && job.scores.some(s => s.xml === parts[4])) return sendFile(res, path.join(job.dir, parts[4]));
      if (parts[3] === 'layout') {
        if (!job.omr) return send(res, 404, { error: 'découpage indisponible (analyse non terminée ou échouée)' });
        job.layout ??= readLayout(job.omr);
        return send(res, 200, job.layout);
      }
      return send(res, 404, { error: 'introuvable' });
    }
    if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(res, decodeURIComponent(url.pathname));
    send(res, 405, { error: 'méthode non autorisée' });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Music Reader v1 : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(AUDIVERIS ? `Audiveris : ${AUDIVERIS}` : 'ATTENTION : Audiveris introuvable (lancer setup.ps1 ou définir AUDIVERIS_CMD).');
  console.log(`OCR (tessdata) : ${TESSDATA}`);
  console.log(`Police des têtes par défaut : ${MUSIC_FONT} (familles : ${MUSIC_FONTS.join(', ')})`);
  if (STEM_LESS_BOOST) console.log(`Bonus têtes sans hampe : ${STEM_LESS_BOOST}`);
});
