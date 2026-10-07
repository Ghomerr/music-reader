// Test de l'application PACKAGÉE (release/, après desktop:pack) : on lance le vrai exécutable en mode
// --smoke-test, qui démarre le serveur embarqué et fait analyser une image par l'Audiveris embarqué.
// C'est ce qui vérifie, en intégration continue, chaque système qu'on ne peut pas tester à la main (Mac surtout).
// Sur Mac, on vérifie aussi la signature (ad hoc) de l'application : invalide, macOS la dirait « endommagée ».
//
// Usage : node desktop/smoke-packaged.mjs [image]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE = path.join(ROOT, 'release');
const image = path.resolve(process.argv[2] || path.join(ROOT, 'desktop', 'test', 'yankee-doodle.png'));
const dirs = fs.existsSync(RELEASE) ? fs.readdirSync(RELEASE).map(d => path.join(RELEASE, d)).filter(d => fs.statSync(d).isDirectory()) : [];

function find() {
  if (process.platform === 'win32') {
    const dir = dirs.find(d => path.basename(d) === 'win-unpacked');
    const exe = dir && fs.readdirSync(dir).find(f => f.endsWith('.exe') && !/^Uninstall/i.test(f));
    return exe && { exe: path.join(dir, exe) };
  }
  if (process.platform === 'darwin') {
    for (const dir of dirs.filter(d => path.basename(d).startsWith('mac'))) {
      const app = fs.readdirSync(dir).find(f => f.endsWith('.app'));
      if (!app) continue;
      const bundle = path.join(dir, app);
      const macos = path.join(bundle, 'Contents', 'MacOS');
      return { exe: path.join(macos, fs.readdirSync(macos)[0]), bundle };
    }
    return null;
  }
  const dir = dirs.find(d => path.basename(d) === 'linux-unpacked');
  return dir && { exe: path.join(dir, 'lectonote') };
}

const found = find();
if (!found || !fs.existsSync(found.exe)) {
  console.error(`Application packagée introuvable dans ${RELEASE} : lancer d'abord npm run desktop:pack`);
  process.exit(1);
}
console.log(`Application : ${found.exe}`);

if (found.bundle) {
  const sig = spawnSync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', found.bundle], { encoding: 'utf8' });
  console.log((sig.stdout + sig.stderr).trim());
  if (sig.status !== 0) { console.error('Signature de l’application invalide'); process.exit(1); }
}

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;   // posée par VS Code : ferait tourner Electron comme un simple Node
let cmd = found.exe;
let args = [`--smoke-test=${image}`];
if (process.platform === 'linux') {
  args.push('--no-sandbox');   // machines d'intégration : pas de bac à sable setuid
  if (!process.env.DISPLAY) { args = ['-a', cmd, ...args]; cmd = 'xvfb-run'; }
}
const run = spawnSync(cmd, args, { stdio: 'inherit', env, timeout: 6 * 60 * 1000 });
if (run.error) console.error(run.error.message);
console.log(run.status === 0 ? 'Test de l’application packagée : OK' : `Test de l’application packagée : ÉCHEC (code ${run.status})`);
process.exit(run.status ?? 1);
