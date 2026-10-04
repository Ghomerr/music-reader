import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assemble } from './assemble';
import { readMusicXml } from './musicxml-read';
import { DIVISIONS, splitDuration, writeMusicXml } from './musicxml-write';
import { midi, parsePitchCode } from './pitch';
import type { IssueKind, Line, Lyric, Measure, NoteEvent, Project } from './types';

// ---------- Construction de projets à la main ----------

let seq = 0;
function n(measure: number, offset: number, duration: number, pitch: string | null, extra: Partial<NoteEvent> = {}): NoteEvent {
  return { id: `n${++seq}`, measure, offset, duration, pitch: pitch ? parsePitchCode(pitch)! : null, voice: 1, ...extra };
}

function line(id: string, notes: NoteEvent[], extra: Partial<Line> = {}): Line {
  const [part, staff] = id.split('|').map(Number);
  return {
    id, name: id, part, partName: part ? 'Piano' : 'Voix', staff,
    clef: { sign: 'G', line: 2 }, notes, ...extra,
  };
}

function project(measures: Partial<Measure>[], lines: Line[]): Project {
  return {
    format: 'music-reader', version: 2, title: 'Essai', createdAt: '2026-10-04T00:00:00Z',
    pages: [{ key: 'p1', name: 'p1.png', font: 'Leland', scale: 1 }],
    measures: measures.map((m, i) => ({
      pageKey: 'p1', page: 1, local: i, label: String(i + 1), beats: 4, beatType: 4, fifths: 0, mode: 'major', ...m,
    })),
    lines,
    settings: {
      tempo: 100, transpose: 0, loop: false, lines: {},
      print: { lines: [], lyrics: true, verses: [], title: '', keepLayout: false },
    },
    review: { lost: [], checked: [] },
  };
}

// ---------- Lecture du résultat ----------

function parse(xml: string): Document {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  expect(doc.getElementsByTagName('parsererror').length).toBe(0);
  return doc;
}

const kids = (el: Element, tag: string) => [...el.children].filter(c => c.tagName === tag);
const kid = (el: Element, tag: string) => kids(el, tag)[0];
const txt = (el: Element | undefined, tag: string) => (el ? kid(el, tag)?.textContent ?? null : null);
const measures = (doc: Document, part = 0) => kids(doc.getElementsByTagName('part')[part], 'measure');
const notes = (m: Element) => kids(m, 'note');

/** Durée cumulée (notes hors accord + forward) de chaque voix d'une mesure. */
function voiceSums(m: Element): Map<string, number> {
  const sums = new Map<string, number>();
  for (const e of m.children) {
    if ((e.tagName !== 'note' || kid(e, 'chord')) && e.tagName !== 'forward') continue;
    const v = txt(e, 'voice')!;
    sums.set(v, (sums.get(v) ?? 0) + Number(txt(e, 'duration')));
  }
  return sums;
}

/** Hauteur lisible d'un élément <note>, ex. « Bb4 », ou « r » pour un silence. */
function code(note: Element): string {
  const p = kid(note, 'pitch');
  if (!p) return 'r';
  const alter = Number(txt(p, 'alter') ?? 0);
  return txt(p, 'step')! + (alter > 0 ? '#'.repeat(alter) : 'b'.repeat(-alter)) + txt(p, 'octave');
}

// ---------- Tests ----------

describe('découpage des durées', () => {
  it('une figure quand c’est possible', () => {
    expect(splitDuration(72)).toMatchObject([{ type: 'quarter', dots: 1, triplet: false }]);
    expect(splitDuration(16)).toMatchObject([{ type: 'eighth', triplet: true }]);
    expect(splitDuration(32)).toMatchObject([{ type: 'quarter', triplet: true }]);
    expect(splitDuration(8)).toMatchObject([{ type: '16th', triplet: true }]);
    expect(splitDuration(6)).toMatchObject([{ type: '32nd', dots: 0 }]);
    expect(splitDuration(288)).toMatchObject([{ type: 'whole', dots: 1 }]);
  });
  it('sinon des figures liées, la plus longue d’abord, sans perte de durée', () => {
    expect(splitDuration(60).map(f => f.ticks)).toEqual([48, 12]);
    expect(splitDuration(240).map(f => f.ticks)).toEqual([192, 48]);
    for (const t of [1, 2, 5, 7, 10, 11, 13, 100, 250, 1000]) {
      expect(splitDuration(t).reduce((s, f) => s + f.ticks, 0)).toBe(t);
    }
  });
});

describe('writeMusicXml', () => {
  it('durées variées, triolets, en-tête et barre finale', () => {
    const p = project([{}], [line('0|1', [
      n(0, 0, 1.5, 'C4'), n(0, 1.5, 0.5, 'D4'),
      n(0, 2, 1 / 3, 'E4'), n(0, 2 + 1 / 3, 1 / 3, 'F4'), n(0, 2 + 2 / 3, 1 / 3, 'G4'),
      n(0, 3, 1, 'A4'),
    ])]);
    const doc = parse(writeMusicXml(p));
    expect(doc.documentElement.getAttribute('version')).toBe('3.1');
    expect(doc.querySelector('work-title')?.textContent).toBe('Essai');
    const [m] = measures(doc);
    expect(m.getAttribute('number')).toBe('1');
    expect(m.getAttribute('implicit')).toBeNull();
    expect(txt(kid(m, 'attributes'), 'divisions')).toBe(String(DIVISIONS));
    const ns = notes(m);
    expect(ns.map(x => Number(txt(x, 'duration')))).toEqual([72, 24, 16, 16, 16, 48]);
    expect(ns.map(x => txt(x, 'type'))).toEqual(['quarter', 'eighth', 'eighth', 'eighth', 'eighth', 'quarter']);
    expect(kids(ns[0], 'dot').length).toBe(1);
    expect(ns.slice(2, 5).every(x => kid(x, 'time-modification'))).toBe(true);
    expect(ns[2].querySelector('tuplet')?.getAttribute('type')).toBe('start');
    expect(ns[3].querySelector('tuplet')).toBeNull();
    expect(ns[4].querySelector('tuplet')?.getAttribute('type')).toBe('stop');
    expect(voiceSums(m).get('1')).toBe(192);
    expect(m.querySelector('barline bar-style')?.textContent).toBe('light-heavy');
  });

  it('durée non représentable : notes liées ; liaison du modèle vers la mesure suivante', () => {
    const p = project([{}, {}], [line('0|1', [
      n(0, 0, 1.25, 'C4'), n(0, 1.25, 0.75, 'D4'), n(0, 2, 2, 'E4', { tie: true }),
      n(1, 0, 1, 'E4'), n(1, 1, 3, 'F4'),
    ])]);
    const doc = parse(writeMusicXml(p));
    const [m1, m2] = measures(doc);
    const ns = notes(m1);
    expect(ns.map(x => Number(txt(x, 'duration')))).toEqual([48, 12, 36, 96]);
    expect(kids(ns[0], 'tie').map(t => t.getAttribute('type'))).toEqual(['start']);
    expect(kids(ns[1], 'tie').map(t => t.getAttribute('type'))).toEqual(['stop']);
    expect(ns[0].querySelector('notations tied')?.getAttribute('type')).toBe('start');
    expect(kids(ns[3], 'tie').map(t => t.getAttribute('type'))).toEqual(['start']);
    const first2 = notes(m2)[0];
    expect(kids(first2, 'tie').map(t => t.getAttribute('type'))).toEqual(['stop']);
    expect(kids(notes(m2)[1], 'tie')).toHaveLength(0);
    expect(m1.querySelector('barline')).toBeNull();
  });

  it('contenu qui déborde écrit tel quel, notes de durée nulle ignorées', () => {
    const p = project([{}], [line('0|1', [n(0, 0, 5, 'C4'), n(0, 1, 0, 'D4')])]);
    const [m] = measures(parse(writeMusicXml(p)));
    expect(notes(m).map(x => Number(txt(x, 'duration')))).toEqual([192, 48]);
    expect(notes(m).map(code)).toEqual(['C4', 'C4']);
  });

  it('accords, chevauchement dans une voix, deux voix, trous comblés', () => {
    const p = project([{}], [line('0|1', [
      n(0, 0, 1, 'C4'), n(0, 0, 1, 'E4'), n(0, 0, 1, 'G4'),   // accord
      n(0, 0, 2, 'C3'),                                       // même début, autre durée : autre voix
      n(0, 2, 1, 'D4'),                                       // trou de 1 temps à la fin
      n(0, 1, 1, 'A4', { voice: 2 }), n(0, 3, 1, 'B4', { voice: 2 }),
    ])]);
    const [m] = measures(parse(writeMusicXml(p)));
    const v = (e: Element) => txt(e, 'voice');
    const ns = notes(m);
    // voix 1 : accord, silence comblant le temps 2, D4, silence final
    const v1 = ns.filter(x => v(x) === '1');
    expect(v1.map(code)).toEqual(['C4', 'E4', 'G4', 'r', 'D4', 'r']);
    expect(v1.slice(0, 3).map(x => !!kid(x, 'chord'))).toEqual([false, true, true]);
    // voix 2 d'origine : forward pour les trous, pas de silence inventé
    expect(ns.filter(x => v(x) === '2').map(code)).toEqual(['A4', 'B4']);
    expect(kids(m, 'forward').filter(f => v(f) === '2').map(f => Number(txt(f, 'duration')))).toEqual([48, 48]);
    // le C3 qui chevauche passe dans une voix supplémentaire
    expect(ns.filter(x => v(x) === '3').map(code)).toEqual(['C3']);
    const sums = voiceSums(m);
    expect(sums.get('1')).toBe(192);
    expect(sums.get('2')).toBe(192);
    expect(sums.get('3')).toBe(96);
    expect(kids(m, 'backup').map(b => Number(txt(b, 'duration')))).toEqual([192, 192]);
  });

  it('mesure-ligne vide : silence de mesure ; anacrouse non comblée', () => {
    const p = project([{}, {}], [line('0|1', [n(0, 0, 1, 'G4'), n(1, 0, 4, 'C4')]), line('0|2', [])]);
    const doc = parse(writeMusicXml(p));
    const [m1, m2] = measures(doc);
    // anacrouse : 1 temps, sur les deux portées
    expect(voiceSums(m1)).toEqual(new Map([['1', 48], ['5', 48]]));
    const rest = notes(m2).find(x => txt(x, 'staff') === '2')!;
    expect(kid(rest, 'rest').getAttribute('measure')).toBe('yes');
    expect(Number(txt(rest, 'duration'))).toBe(192);
    expect(txt(kid(m1, 'attributes'), 'staves')).toBe('2');
  });

  it('transposition : Fa majeur + 2 → Sol majeur, mode conservé', () => {
    const p = project([{ fifths: -1 }, { fifths: -1, mode: 'minor' }], [line('0|1', [
      n(0, 0, 2, 'Bb4'), n(0, 2, 2, 'F4'), n(1, 0, 4, 'D4'),
    ])]);
    const doc = parse(writeMusicXml(p, { transpose: 2 }));
    const [m1, m2] = measures(doc);
    expect(txt(m1.querySelector('key')!, 'fifths')).toBe('1');
    expect(txt(m1.querySelector('key')!, 'mode')).toBe('major');
    expect(notes(m1).map(code)).toEqual(['C5', 'G4']);
    // changement de mode : l'armure est réécrite
    expect(txt(m2.querySelector('key')!, 'mode')).toBe('minor');
    expect(notes(m2).map(code)).toEqual(['E4']);
    // sans transposition : armure d'origine
    expect(txt(parse(writeMusicXml(p)).querySelector('key')!, 'fifths')).toBe('-1');
  });

  it('couleurs de diagnostic seulement si demandées', () => {
    const p = project([{}, {}, {}], [line('0|1', [n(0, 0, 4, 'E4'), n(1, 0, 3, 'C4')])]);
    const colors = new Map<string, IssueKind>([['1|0|1', 'rhythm'], ['2|0|1', 'empty']]);
    const doc = parse(writeMusicXml(p, { colors }));
    const [m1, m2, m3] = measures(doc);
    expect(notes(m1)[0].getAttribute('color')).toBeNull();
    expect(notes(m2).map(x => x.getAttribute('color'))).toEqual(['#e8590c', '#e8590c']);   // note + silence de comblement
    expect(notes(m3)[0].getAttribute('color')).toBe('#d6336c');
    expect(writeMusicXml(p)).not.toContain('color');
  });

  it('paroles : couplets, filtre, échappement, désactivation', () => {
    const ly = (verse: number, text: string, syllabic?: Lyric['syllabic']): Lyric => ({ verse, text, syllabic });
    const p = project([{}], [line('0|1', [
      n(0, 0, 2, 'C4', { lyrics: [ly(1, 'L\'é', 'begin'), ly(2, 'Tom & <Jo>')] }),
      n(0, 2, 2, 'D4', { lyrics: [ly(1, 'té', 'end')] }),
    ])]);
    const all = parse(writeMusicXml(p));
    const l0 = [...all.querySelectorAll('note')][0].querySelectorAll('lyric');
    expect([...l0].map(l => l.getAttribute('number'))).toEqual(['1', '2']);
    expect(l0[0].querySelector('syllabic')?.textContent).toBe('begin');
    expect(l0[0].querySelector('text')?.textContent).toBe('L\'é');
    expect(l0[1].querySelector('text')?.textContent).toBe('Tom & <Jo>');
    const v2 = parse(writeMusicXml(p, { verses: [2] }));
    expect([...v2.querySelectorAll('lyric')].map(l => l.getAttribute('number'))).toEqual(['2']);
    expect(writeMusicXml(p, { lyrics: false })).not.toContain('<lyric');
  });

  it('sélection des lignes : parties et portées', () => {
    const p = project([{}], [
      line('0|1', [n(0, 0, 4, 'G4')]),
      line('1|1', [n(0, 0, 4, 'C5')]),
      line('1|2', [n(0, 0, 4, 'C3')], { clef: { sign: 'F', line: 4 } }),
    ]);
    const full = parse(writeMusicXml(p));
    expect([...full.querySelectorAll('score-part part-name')].map(e => e.textContent)).toEqual(['Voix', 'Piano']);
    const piano = measures(full, 1)[0];
    expect(txt(kid(piano, 'attributes'), 'staves')).toBe('2');
    expect([...piano.querySelectorAll('clef')].map(c => `${c.getAttribute('number')}:${txt(c, 'sign')}`)).toEqual(['1:G', '2:F']);
    expect(notes(piano).map(x => `${txt(x, 'staff')}/${txt(x, 'voice')}/${code(x)}`)).toEqual(['1/1/C5', '2/5/C3']);
    expect(kids(piano, 'backup')).toHaveLength(1);

    // une seule ligne du piano gardée : une seule portée, numérotée 1, avec sa clé de fa
    const one = parse(writeMusicXml(p, { lines: ['1|2'] }));
    expect(one.querySelectorAll('score-part')).toHaveLength(1);
    const m = measures(one)[0];
    expect(m.querySelector('staves')).toBeNull();
    expect(txt(m.querySelector('clef')!, 'sign')).toBe('F');
    expect(notes(m).map(x => `${txt(x, 'staff')}/${code(x)}`)).toEqual(['1/C3']);
  });

  it('plage de mesures, numéros, changements de métrique, de clé et mise en page', () => {
    const p = project([{}, { newSystem: true }, { beats: 3, newPage: true }, { beats: 3, newSystem: true }], [line('0|1', [
      n(0, 0, 4, 'C4'), n(1, 0, 4, 'D4'), n(2, 0, 1, 'E4'), n(2, 1, 2, 'F4'), n(3, 0, 3, 'G4'),
    ], { clefChanges: [{ measure: 2, offset: 1, clef: { sign: 'F', line: 4 } }, { measure: 3, offset: 0, clef: { sign: 'G', line: 2 } }] })]);
    const doc = parse(writeMusicXml(p, { range: [1, 3], keepLayout: true, title: '' }));
    expect(doc.querySelector('work')).toBeNull();
    const ms = measures(doc);
    expect(ms.map(m => m.getAttribute('number'))).toEqual(['2', '3', '4']);
    // 1re mesure écrite : attributs complets, pas de saut
    expect(ms[0].querySelector('print')).toBeNull();
    expect(txt(kid(ms[0], 'attributes'), 'divisions')).toBe('48');
    expect(ms[1].querySelector('print')?.getAttribute('new-page')).toBe('yes');
    expect(ms[2].querySelector('print')?.getAttribute('new-system')).toBe('yes');
    // changement de métrique écrit, pas de répétition ensuite
    expect(txt(ms[1].querySelector('time')!, 'beats')).toBe('3');
    expect(ms[2].querySelector('time')).toBeNull();
    // clé de fa au temps 2 : entre la 1re et la 2e note
    const seq3 = [...ms[1].children].map(e =>
      e.tagName === 'note' ? code(e) : e.tagName === 'attributes' ? (e.querySelector('clef') ? 'clef' : 'attr') : e.tagName);
    expect(seq3).toEqual(['print', 'attr', 'E4', 'clef', 'F4']);
    expect(txt(ms[2].querySelector('attributes clef')!, 'sign')).toBe('G');
    expect(ms[2].querySelector('barline bar-style')?.textContent).toBe('light-heavy');
    // sans keepLayout : aucun saut
    expect(writeMusicXml(p, { range: [1, 3] })).not.toContain('<print');
    // plage qui ne va pas jusqu'au bout : pas de barre finale
    expect(writeMusicXml(p, { range: [0, 1] })).not.toContain('<barline');
    // clé en vigueur au début de la plage
    const late = parse(writeMusicXml(p, { range: [3, 3] }));
    expect(txt(late.querySelector('clef')!, 'sign')).toBe('G');
  });
});

// ---------- Aller-retour sur de vrais fichiers d'Audiveris ----------

const JOBS = join(__dirname, '../../../v0/jobs');
const inputs = existsSync(JOBS)
  ? readdirSync(JOBS).map(d => join(JOBS, d, 'input.xml')).filter(f => existsSync(f))
  : [];

describe.skipIf(!inputs.length)('aller-retour readMusicXml → writeMusicXml → readMusicXml', () => {
  /** Notes jouées, ligne par ligne : mesure, position, durée, hauteur MIDI. */
  const played = (lines: Line[]) => lines.map(l => l.notes
    .filter(x => x.pitch && x.duration > 1e-6)
    .map(x => `${x.measure}@${+x.offset.toFixed(3)}+${+x.duration.toFixed(3)}:${midi(x.pitch!)}`)
    .sort());

  for (const file of inputs) {
    it(file.split(/[\\/]/).slice(-2, -1)[0], () => {
      const score = readMusicXml(readFileSync(file, 'utf8'));
      const { project: p } = assemble([{ key: 'p1', name: 'p1', font: 'Leland', scale: 1, score, unplaced: [] }], null);
      const xml = writeMusicXml(p, { transpose: 0 });
      parse(xml);
      const back = readMusicXml(xml);
      expect(back.measures).toHaveLength(p.measures.length);
      expect(back.lines.map(l => l.id)).toEqual(p.lines.map(l => l.id));
      // les notes découpées en figures liées reviennent en plusieurs morceaux : on compare les
      // notes dont la durée tient en une figure, et le total joué de chaque ligne
      const single = (x: string) => splitDuration(Math.round(Number(x.split('+')[1].split(':')[0]) * DIVISIONS)).length === 1;
      expect(played(back.lines).map(a => a.filter(single))).toEqual(played(p.lines).map(a => a.filter(single)));
      expect(played(p.lines).flat().length).toBeGreaterThan(20);
      const total = (lines: Line[]) => lines.map(l => l.notes.filter(x => x.pitch).reduce((s, x) => s + x.duration, 0).toFixed(3));
      expect(total(back.lines)).toEqual(total(p.lines));
      // transposé d'une tierce mineure : chaque hauteur sonne 3 demi-tons plus haut
      const up = readMusicXml(writeMusicXml(p, { transpose: 3 }));
      const shifted = (lines: Line[], t: number) => lines.map(l => l.notes.filter(x => x.pitch).map(x => midi(x.pitch!) + t).sort());
      expect(shifted(up.lines, 0)).toEqual(shifted(back.lines, 3));
    });
  }
});
