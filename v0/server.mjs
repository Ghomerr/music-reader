// Music Reader v0 — serveur de test OMR (Audiveris), sans dépendance.
// Usage : node server.mjs   puis http://localhost:8787
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';
const JOBS_DIR = path.join(ROOT, 'jobs');
const PUBLIC_DIR = path.join(ROOT, 'public');
const TESSDATA = process.env.TESSDATA_PREFIX || path.join(ROOT, 'tools', 'tessdata');
// Audiveris reconnait les tetes de notes en les comparant aux gabarits d'une police de reference.
// La famille retenue change tout : sur une gravure classique, Leland retrouve des rondes que
// Bravura (le defaut d'Audiveris) laisse entierement passer ; sur une grille de jazz calligraphiee,
// FinaleJazz retrouve en plus les barres de mesure. D'ou le choix page par page dans l'interface.
const MUSIC_FONTS = ['Leland', 'Bravura', 'FinaleJazz', 'Primus', 'MusicalSymbols', 'JazzPerc'];
const MUSIC_FONT = MUSIC_FONTS.includes(process.env.MUSIC_FONT) ? process.env.MUSIC_FONT : 'Leland';
// Bonus accorde aux tetes sans hampe (les rondes). Sans effet des lors que la police est la bonne,
// et nuisible au-dela de 0,5 : desactive par defaut, la variable reste la pour experimenter.
const STEM_LESS_BOOST = process.env.STEM_LESS_BOOST ?? '';
const MAX_UPLOAD = 30 * 1024 * 1024;
const OMR_TIMEOUT = 5 * 60 * 1000;
const JOB_TTL = 2 * 60 * 60 * 1000;

const AUDIVERIS = [
  process.env.AUDIVERIS_CMD,
  path.join(ROOT, 'tools', 'audiveris', 'Audiveris', 'Audiveris.exe'),
  path.join(ROOT, 'tools', 'audiveris', 'bin', 'Audiveris'),
  'C:\\Program Files\\Audiveris\\Audiveris.exe',
  '/opt/audiveris/bin/Audiveris',
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
                  '-constant', `org.audiveris.omr.ui.symbol.MusicFont.defaultMusicFamily=${job.font}`];
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
        // exporte, et la mesure peut quand meme tomber juste. Seul le journal le signale.
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
    const timer = setTimeout(() => { job.log.push(`[v0] Délai dépassé (${OMR_TIMEOUT / 1000} s), arrêt d'Audiveris.`); child.kill(); }, OMR_TIMEOUT);
    child.on('error', err => { job.log.push('[v0] ' + err.message); });
    child.on('close', code => {
      clearTimeout(timer);
      job.exitCode = code;
      job.finishedAt = Date.now();
      try {
        const files = fs.readdirSync(path.join(job.dir, 'out')).filter(f => /\.(mxl|xml|musicxml)$/i.test(f)).sort();
        job.scores = files.map(f => {
          const xml = readScore(path.join(job.dir, 'out', f));
          const out = path.join(job.dir, f.replace(/\.(mxl|musicxml)$/i, '') + '.xml');
          if (!fs.existsSync(out)) fs.writeFileSync(out, xml);
          return { file: f, xml: path.basename(out) };
        });
      } catch (err) {
        job.log.push('[v0] Lecture du résultat impossible : ' + err.message);
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

// .mxl = zip : on extrait le fichier MusicXML racine (déclaré dans META-INF/container.xml).
function readScore(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x04034b50) return buf.toString('utf8');
  const entries = unzip(buf);
  const container = entries.get('META-INF/container.xml');
  const root = container && /full-path="([^"]+)"/.exec(container.toString('utf8'))?.[1];
  const name = root && entries.has(root) ? root : [...entries.keys()].find(n => /\.(xml|musicxml)$/i.test(n) && !n.startsWith('META-INF/'));
  if (!name) throw new Error('MusicXML introuvable dans ' + path.basename(file));
  return entries.get(name).toString('utf8');
}

function unzip(buf) {
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('archive zip invalide');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nLen = buf.readUInt16LE(p + 28), xLen = buf.readUInt16LE(p + 30), cLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    entries.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw);
    p += 46 + nLen + xLen + cLen;
  }
  return entries;
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
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.xml': 'application/vnd.recordare.musicxml+xml; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml' };

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

function sendFile(res, file) {
  fs.readFile(file, (err, data) => err ? send(res, 404, { error: 'introuvable' }) : send(res, 200, data, MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'));
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
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
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
    if (parts[0] === 'api' && parts[1] === 'jobs' && parts[2]) {
      const job = jobs.get(parts[2]);
      if (!job) return send(res, 404, { error: 'job inconnu (expiré ?)' });
      if (parts.length === 3) return send(res, 200, jobView(job));
      if (parts[3] === 'input') return sendFile(res, job.input);
      if (parts[3] === 'files' && parts[4] && job.scores.some(s => s.xml === parts[4])) return sendFile(res, path.join(job.dir, parts[4]));
      return send(res, 404, { error: 'introuvable' });
    }
    if (req.method === 'GET') {
      const file = path.normalize(path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname));
      if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, { error: 'interdit' });
      return sendFile(res, file);
    }
    send(res, 405, { error: 'méthode non autorisée' });
  } catch (err) {
    send(res, 500, { error: err.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Music Reader v0 : http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(AUDIVERIS ? `Audiveris : ${AUDIVERIS}` : 'ATTENTION : Audiveris introuvable (lancer setup.ps1 ou définir AUDIVERIS_CMD).');
  console.log(`OCR (tessdata) : ${TESSDATA}`);
  console.log(`Police des tetes par defaut : ${MUSIC_FONT} (familles : ${MUSIC_FONTS.join(', ')})`);
  if (STEM_LESS_BOOST) console.log(`Bonus tetes sans hampe : ${STEM_LESS_BOOST}`);
});
