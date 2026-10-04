// Lecture des fichiers produits par Audiveris : MusicXML compressé (.mxl) et projet (.omr).
// Les deux sont des archives zip ; on les lit sans dépendance (répertoire central + zlib).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

/** Lecture d'une archive zip, en n'inflatant que les entrées retenues par `keep`. */
export function unzip(buf, keep = () => true) {
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
    if (keep(name)) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const raw = buf.subarray(start, start + size);
      entries.set(name, method === 8 ? zlib.inflateRawSync(raw) : raw);
    }
    p += 46 + nLen + xLen + cLen;
  }
  return entries;
}

/** .mxl = zip : on extrait le fichier MusicXML racine (déclaré dans META-INF/container.xml). */
export function readScore(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32LE(0) !== 0x04034b50) return buf.toString('utf8');
  const entries = unzip(buf);
  const container = entries.get('META-INF/container.xml');
  const root = container && /full-path="([^"]+)"/.exec(container.toString('utf8'))?.[1];
  const name = root && entries.has(root) ? root : [...entries.keys()].find(n => /\.(xml|musicxml)$/i.test(n) && !n.startsWith('META-INF/'));
  if (!name) throw new Error('MusicXML introuvable dans ' + path.basename(file));
  return entries.get(name).toString('utf8');
}

const attrs = s => {
  const o = {};
  for (const m of s.matchAll(/([\w:-]+)="([^"]*)"/g)) o[m[1]] = m[2];
  return o;
};

/** Parcours des balises d'un XML (le texte est ignoré), avec la pile des éléments ouverts. */
function* tags(xml) {
  const stack = [];
  for (const m of xml.matchAll(/<([/?!]?)([\w:#.-]*)([^>]*)>/g)) {
    const [, kind, name, rest] = m;
    if (kind === '?' || kind === '!') continue;
    if (kind === '/') { stack.pop(); continue; }
    const selfClosing = rest.endsWith('/');
    yield { name, attrs: attrs(rest), path: stack, selfClosing };
    if (!selfClosing) stack.push(name);
  }
}

/**
 * Géométrie de la page, d'après le projet .omr d'Audiveris : book.xml (parties logiques de chaque
 * système) et sheet#1/sheet#1.xml (modèle complet de la page). On n'en retient que le découpage :
 *  - systèmes et portées, bornés par les lignes de portée (top = 1re ligne, bottom = dernière) ;
 *  - mesures = « stacks » du système, dans l'ordre. Les mesures de précaution qu'Audiveris ajoute en fin
 *    de système (armure ou métrique de rappel, special="CAUTIONARY") ne sont pas exportées dans le
 *    MusicXML : on les écarte, si bien que la k-ième mesure du découpage est la k-ième mesure du
 *    MusicXML de la page, et que son id est le numéro de mesure qu'Audiveris y écrit.
 * Coordonnées en pixels de l'image analysée (donc agrandie le cas échéant).
 */
export function readLayout(omrFile) {
  const entries = unzip(fs.readFileSync(omrFile), n => n === 'book.xml' || n === 'sheet#1/sheet#1.xml');
  const sheet = entries.get('sheet#1/sheet#1.xml')?.toString('utf8');
  if (!sheet) throw new Error('sheet#1.xml absent du projet Audiveris');
  // Parties logiques de chaque système, dans l'ordre : la k-ième partie d'un système n'est pas forcément
  // la k-ième partie de la partition (système où une partie se tait).
  const logical = [];
  const book = entries.get('book.xml')?.toString('utf8') || '';
  for (const t of tags(book)) {
    if (t.name === 'system' && t.path.at(-1) === 'page') logical.push([]);
    else if (t.name === 'part' && t.path.at(-1) === 'system' && t.attrs['logical-id']) logical.at(-1)?.push(+t.attrs['logical-id']);
  }

  const layout = { width: 0, height: 0, interline: 0, systems: [] };
  let sys = null, part = 0, partIdx = -1, staff = null, sysIdx = -1;
  for (const t of tags(sheet)) {
    const parent = t.path.at(-1);
    if (t.name === 'picture' && parent === 'sheet') { layout.width = +t.attrs.width; layout.height = +t.attrs.height; }
    else if (t.name === 'interline' && parent === 'scale') layout.interline = +t.attrs.main;
    else if (t.name === 'system' && parent === 'page') {
      sysIdx++;
      partIdx = -1;
      staff = null;
      sys = { id: +t.attrs.id, left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity, staves: [], measures: [] };
      layout.systems.push(sys);
    } else if (!sys) continue;
    else if (t.name === 'stack' && parent === 'system') {
      if (t.attrs.special !== 'CAUTIONARY') sys.measures.push({ id: +t.attrs.id, left: +t.attrs.left, right: +t.attrs.right });
    } else if (t.name === 'part' && parent === 'system') {
      partIdx++;
      part = (logical[sysIdx]?.[partIdx] ?? +t.attrs.id) - 1;
    } else if (t.name === 'staff' && parent === 'part' && t.path.at(-2) === 'system') {
      staff = { id: +t.attrs.id, part, top: Infinity, bottom: -Infinity, left: +t.attrs.left, right: +t.attrs.right };
      sys.staves.push(staff);
    } else if (t.name === 'point' && parent === 'line' && t.path.at(-2) === 'lines' && t.path.at(-3) === 'staff' && staff) {
      const y = +t.attrs.y;
      staff.top = Math.min(staff.top, y);
      staff.bottom = Math.max(staff.bottom, y);
    }
  }
  for (const s of layout.systems) {
    s.staves = s.staves.filter(st => Number.isFinite(st.top));
    for (const st of s.staves) {
      st.top = Math.round(st.top); st.bottom = Math.round(st.bottom);
      s.left = Math.min(s.left, st.left); s.right = Math.max(s.right, st.right);
      s.top = Math.min(s.top, st.top); s.bottom = Math.max(s.bottom, st.bottom);
    }
    if (!s.staves.length) s.left = s.right = s.top = s.bottom = 0;
  }
  return layout;
}
