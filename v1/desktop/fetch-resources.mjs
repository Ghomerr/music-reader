// Prépare le moteur embarqué dans l'application de bureau pour la plateforme courante :
// Audiveris (Java compris) et les modèles OCR, dans desktop/resources/<plateforme>-<arch>/.
// electron-builder les copie ensuite dans les ressources de l'application (cf. electron-builder.yml).
//
// Chaque système a son paquet Audiveris officiel, qu'on extrait sans rien installer :
// - Windows : MSI « console » (journal sur la sortie standard, que le serveur lit), installation administrative ;
// - Mac : image disque .dmg (Apple Silicon ou Intel), dont on copie Audiveris.app ;
// - Linux : paquet .deb, décompressé tel quel (son script d'installation n'intègre qu'au bureau).
// L'extraction se fait donc sur le système visé (msiexec, hdiutil, dpkg-deb) : en intégration continue,
// une machine par plateforme.
//
// Usage : node desktop/fetch-resources.mjs [--arch=arm64|x64] [--force]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const VERSION = '5.11.0';
const LANGS = ['eng', 'fra', 'ita'];
const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = name => process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const platform = process.platform;
const arch = arg('arch') || process.arch;
const force = process.argv.includes('--force');
const OUT = path.join(HERE, 'resources', `${platform}-${arch}`);
const CACHE = path.join(HERE, '.cache');
const RELEASE = `https://github.com/Audiveris/audiveris/releases/download/${VERSION}`;

const PACKAGES = {
  'win32-x64': `Audiveris-${VERSION}-windowsConsole-x86_64.msi`,
  'darwin-arm64': `Audiveris-${VERSION}-macosx-arm64.dmg`,
  'darwin-x64': `Audiveris-${VERSION}-macosx-x86_64.dmg`,
  // paquet Ubuntu 22.04 : glibc plus ancienne, donc compatible avec davantage de distributions
  'linux-x64': `Audiveris-${VERSION}-ubuntu22.04-x86_64.deb`,
};
const LAUNCHER = {
  win32: ['Audiveris', 'Audiveris.exe'],
  darwin: ['Audiveris.app', 'Contents', 'MacOS', 'Audiveris'],
  linux: ['opt', 'audiveris', 'bin', 'Audiveris'],
};

async function download(url, file) {
  if (fs.existsSync(file) && fs.statSync(file).size > 0 && !force) return file;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 1; ; attempt++) {
    try {
      console.log(`Téléchargement : ${url}`);
      const res = await fetch(url, { headers: { 'User-Agent': 'lectonote-build' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      fs.writeFileSync(file + '.part', Buffer.from(await res.arrayBuffer()));
      fs.renameSync(file + '.part', file);
      return file;
    } catch (e) {
      if (attempt >= 3) throw new Error(`${url} : ${e instanceof Error ? e.message : e}`);
      await new Promise(r => setTimeout(r, 2000 * attempt));
    }
  }
}

const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' });

function extractAudiveris(pkg, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });
  if (platform === 'win32') {
    // installation administrative : déploie l'arborescence du MSI dans dest, sans rien inscrire au système
    run('msiexec', ['/a', pkg, '/qn', `TARGETDIR=${dest}`]);
    fs.rmSync(path.join(dest, path.basename(pkg)), { force: true });
  } else if (platform === 'darwin') {
    // L'image disque d'Audiveris porte un contrat de licence (AGPL) : l'ouvrir l'affiche et attend qu'on clique
    // « Accepter », ce qui échoue sans personne devant (« hdiutil: attach canceled »). Comme Homebrew, on la
    // convertit d'abord en image brute (sans contrat), et on répond quand même à l'invite si elle apparaît.
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'audiveris-dmg-'));
    const raw = path.join(work, 'audiveris.cdr');
    run('hdiutil', ['convert', '-quiet', '-format', 'UDTO', '-o', raw, pkg]);
    const mount = path.join(work, 'mnt');
    fs.mkdirSync(mount);
    execFileSync('hdiutil', ['attach', raw, '-nobrowse', '-readonly', '-noverify', '-mountpoint', mount], {
      input: 'qn\n', stdio: ['pipe', 'inherit', 'inherit'], env: { ...process.env, PAGER: 'cat' },
    });
    try {
      const appName = fs.readdirSync(mount).find(f => f.endsWith('.app'));
      if (!appName) throw new Error('aucune application dans l’image disque');
      // ditto conserve liens symboliques, attributs et signature du paquet
      run('ditto', [path.join(mount, appName), path.join(dest, 'Audiveris.app')]);
    } finally {
      run('hdiutil', ['detach', mount, '-force']);
      fs.rmSync(work, { recursive: true, force: true });
    }
  } else {
    run('dpkg-deb', ['-x', pkg, dest]);
  }
  const launcher = path.join(dest, ...LAUNCHER[platform]);
  if (!fs.existsSync(launcher)) throw new Error(`lanceur d'Audiveris introuvable après extraction : ${launcher}`);
  prune(dest);
  return launcher;
}

/** Premier fichier `name` trouvé sous `dir` (parcours en largeur). */
function findFile(dir, name) {
  const todo = [dir];
  while (todo.length) {
    const d = todo.shift();
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isFile() && e.name === name) return path.join(d, e.name);
      if (e.isDirectory()) todo.push(path.join(d, e.name));
    }
  }
  return null;
}

/**
 * Les paquets d'Audiveris 5.11 contiennent, à côté de ses .jar, une copie décompressée de ses classes (app/org,
 * 2 333 fichiers) et des icônes de son interface graphique (app/crystal, 138 fichiers). Le lanceur ne les charge
 * pas : son classpath ne cite que des .jar. Les retirer divise par dix le nombre de fichiers de l'application
 * (décompression, analyse antivirus, chemins les plus longs) ; vérifié sous Windows sur deux partitions :
 * MusicXML identiques à l'octet près et journaux équivalents. Garde-fou : rien n'est retiré si le classpath
 * référence autre chose que des .jar.
 */
function prune(dest) {
  const cfg = findFile(dest, 'Audiveris.cfg');
  if (!cfg) return console.warn('Audiveris.cfg introuvable : paquet laissé tel quel');
  const cp = fs.readFileSync(cfg, 'utf8').split(/\r?\n/).filter(l => l.startsWith('app.classpath='));
  if (!cp.length || cp.some(l => !/\.jar$/i.test(l.trim()))) return console.warn('classpath inattendu : paquet laissé tel quel');
  for (const d of ['org', 'crystal']) {
    const p = path.join(path.dirname(cfg), d);
    if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); console.log(`Retiré (inutilisé) : ${p}`); }
  }
}

async function main() {
  const key = `${platform}-${arch}`;
  const name = PACKAGES[key];
  if (!name) throw new Error(`plateforme non prise en charge par Audiveris ${VERSION} : ${key}`);
  if (process.arch !== arch && platform !== 'darwin')
    throw new Error(`extraction pour ${arch} impossible sur une machine ${process.arch}`);

  const audiverisDir = path.join(OUT, 'audiveris');
  const launcher = path.join(audiverisDir, ...LAUNCHER[platform]);
  if (fs.existsSync(launcher) && !force) console.log(`Audiveris déjà prêt : ${launcher}`);
  else {
    const pkg = await download(`${RELEASE}/${name}`, path.join(CACHE, name));
    console.log(`Extraction de ${name}…`);
    console.log(`Audiveris prêt : ${extractAudiveris(pkg, audiverisDir)}`);
  }

  // Modèles OCR « standard » : Audiveris utilise le mode legacy de Tesseract, absent des modèles « fast »
  const tess = path.join(OUT, 'tessdata');
  fs.mkdirSync(tess, { recursive: true });
  for (const lang of LANGS) {
    const file = path.join(tess, `${lang}.traineddata`);
    const cached = await download(`https://github.com/tesseract-ocr/tessdata/raw/main/${lang}.traineddata`, path.join(CACHE, `${lang}.traineddata`));
    if (!fs.existsSync(file) || force) fs.copyFileSync(cached, file);
  }
  console.log(`Modèles OCR prêts : ${LANGS.join(', ')}`);
  console.log(`Ressources de ${key} : ${OUT}`);
}

main().catch(e => { console.error('ÉCHEC :', e instanceof Error ? e.message : e); process.exit(1); });
