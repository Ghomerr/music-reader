import { describe, expect, it } from 'vitest';
import type { NoteEvent, Pitch, Step } from '../../model/types';
import {
  clefAt, clefBottom, contentEnd, decompose, deleteEvent, figureDuration, figureOf, fitToMeter, flagCount, insertEvent,
  keySignature, lyricDisplay, measureBox, moveInTime, movePitch, setAlter, setDuration, setLyric, setVoice, snapOffset,
  toggleTie, type EditCtx,
} from './edit';

const P = (s: string): Pitch => ({ step: s[0] as Step, alter: 0, octave: +s.slice(1) });
let seq = 0;
const ctx = (over: Partial<EditCtx> = {}): EditCtx => ({ measure: 0, fifths: 0, shift: true, newId: () => `x${++seq}`, ...over });
const ev = (id: string, offset: number, duration: number, pitch: string | null, voice = 1): NoteEvent =>
  ({ id, measure: 0, offset, duration, pitch: pitch ? P(pitch) : null, voice });
/** résumé lisible : « 0:C4/1 1:-/1 » */
const sum = (ns: NoteEvent[]) => ns.map(n => `${+n.offset.toFixed(3)}:${n.pitch ? n.pitch.step + n.pitch.octave : '-'}/${+n.duration.toFixed(3)}`).join(' ');

describe('figures', () => {
  it('reconnaît points et triolets', () => {
    expect(figureOf(1)).toEqual({ base: 1, dots: 0, triplet: false });
    expect(figureOf(1.5)).toEqual({ base: 1, dots: 1, triplet: false });
    expect(figureOf(0.375)).toEqual({ base: 0.25, dots: 1, triplet: false });
    expect(figureOf(1 / 3)).toEqual({ base: 0.5, dots: 0, triplet: true });
    expect(figureOf(1.25)).toBeNull();
    expect(figureDuration({ base: 0.5, dots: 0, triplet: true })).toBeCloseTo(1 / 3);
    expect(flagCount(0.25)).toBe(2);
    expect(flagCount(1)).toBe(0);
  });
  it('découpe les durées en figures écrivables', () => {
    expect(decompose(1.25)).toEqual([1, 0.25]);
    expect(decompose(3)).toEqual([3]);
    expect(decompose(5 / 6).map(x => +x.toFixed(4))).toEqual([0.6667, 0.1667]);
    expect(decompose(0)).toEqual([]);
  });
});

describe('insertEvent', () => {
  it('remplace et raccourcit un silence', () => {
    const r = insertEvent([ev('a', 0, 4, null)], ctx(), { offset: 1, duration: 1, pitch: P('G4'), voice: 1 });
    expect(sum(r.notes)).toBe('0:-/1 1:G4/1 2:-/2');
    expect(r.notes.find(n => n.id === r.id)!.manual).toBe(true);
    expect(r.notes[0].id).toBe('a');
  });
  it('forme un accord au début d\'une note, avec sa durée', () => {
    const r = insertEvent([ev('a', 0, 2, 'C4')], ctx(), { offset: 0, duration: 1, pitch: P('E4'), voice: 1 });
    expect(sum(r.notes)).toBe('0:C4/2 0:E4/2');
  });
  it('ne double pas une note déjà présente dans l\'accord', () => {
    const notes = [ev('a', 0, 2, 'C4')];
    const r = insertEvent(notes, ctx(), { offset: 0, duration: 1, pitch: P('C4'), voice: 1 });
    expect(r.notes).toBe(notes);
    expect(r.id).toBe('a');
  });
  it('en mode insertion, repousse la suite de la voix', () => {
    const notes = [ev('a', 0, 1, 'C4'), ev('b', 1, 1, 'D4'), ev('c', 0, 4, 'C3', 2)];
    const r = insertEvent(notes, ctx(), { offset: 1, duration: 0.5, pitch: P('E4'), voice: 1, insert: true });
    expect(sum(r.notes.filter(n => n.voice === 1))).toBe('0:C4/1 1:E4/0.5 1.5:D4/1');
    expect(r.notes.find(n => n.id === 'c')!.offset).toBe(0);
  });
  it('repousse la note suivante quand la nouvelle déborde (décalage actif)', () => {
    const notes = [ev('a', 0, 1, 'C4'), ev('b', 1.5, 1, 'D4')];
    const r = insertEvent(notes, ctx(), { offset: 1, duration: 1, pitch: P('E4'), voice: 1 });
    expect(sum(r.notes)).toBe('0:C4/1 1:E4/1 2:D4/1');
    const r2 = insertEvent(notes, ctx({ shift: false }), { offset: 1, duration: 1, pitch: P('E4'), voice: 1 });
    expect(sum(r2.notes)).toBe('0:C4/1 1:E4/1 1.5:D4/1');
  });
  it('un silence posé sur une note la remplace', () => {
    const notes = [ev('a', 0, 1, 'C4'), ev('b', 1, 1, 'D4')];
    const r = insertEvent(notes, ctx(), { offset: 1, duration: 1, pitch: null, voice: 1 });
    expect(sum(r.notes)).toBe('0:C4/1 1:-/1');
  });
});

describe('setDuration', () => {
  const eighths = () => [ev('a', 0, 0.5, 'C4'), ev('b', 0.5, 1, 'D4'), ev('c', 1.5, 0.5, 'E4'), ev('d', 2, 0.5, 'F4')];
  it('une croche lue comme noire se corrige d\'un geste (décalage)', () => {
    const out = setDuration(eighths(), ctx(), 'b', 0.5);
    expect(sum(out)).toBe('0:C4/0.5 0.5:D4/0.5 1:E4/0.5 1.5:F4/0.5');
    expect(out.find(n => n.id === 'b')!.manual).toBe(true);
  });
  it('sans décalage, un raccourcissement laisse un silence', () => {
    expect(sum(setDuration(eighths(), ctx({ shift: false }), 'b', 0.5))).toBe('0:C4/0.5 0.5:D4/0.5 1:-/0.5 1.5:E4/0.5 2:F4/0.5');
  });
  it('sans décalage, un allongement mange les silences suivants', () => {
    const notes = [ev('a', 0, 1, 'C4'), ev('r', 1, 2, null)];
    expect(sum(setDuration(notes, ctx({ shift: false }), 'a', 2))).toBe('0:C4/2 2:-/1');
  });
  it('change tout l\'accord', () => {
    const notes = [ev('a', 0, 1, 'C4'), ev('b', 0, 1, 'E4'), ev('c', 1, 1, 'G4')];
    expect(sum(setDuration(notes, ctx(), 'b', 2))).toBe('0:C4/2 0:E4/2 2:G4/1');
  });
  it('ne touche pas aux autres voix', () => {
    const notes = [ev('a', 0, 1, 'C4'), ev('b', 1, 1, 'D4'), ev('z', 1, 1, 'C3', 2)];
    const out = setDuration(notes, ctx(), 'a', 0.5);
    expect(out.find(n => n.id === 'z')!.offset).toBe(1);
    expect(out.find(n => n.id === 'b')!.offset).toBe(0.5);
  });
});

describe('deleteEvent', () => {
  it('ramène la suite (décalage) ou laisse un silence', () => {
    const notes = [ev('a', 0, 1, 'C4'), ev('b', 1, 1, 'D4'), ev('c', 2, 1, 'E4')];
    expect(sum(deleteEvent(notes, ctx(), 'b'))).toBe('0:C4/1 1:E4/1');
    expect(sum(deleteEvent(notes, ctx({ shift: false }), 'b'))).toBe('0:C4/1 1:-/1 2:E4/1');
  });
  it('une note d\'accord part seule', () => {
    const notes = [ev('a', 0, 1, 'C4'), ev('b', 0, 1, 'E4'), ev('c', 1, 1, 'G4')];
    expect(sum(deleteEvent(notes, ctx(), 'b'))).toBe('0:C4/1 1:G4/1');
  });
  it('garde une trace manuelle pour survivre à une réanalyse', () => {
    const out = deleteEvent([ev('a', 0, 1, 'C4'), ev('b', 1, 1, 'D4')], ctx(), 'b');
    expect(out.some(n => n.manual)).toBe(true);
  });
  it('la dernière note supprimée laisse un silence manuel', () => {
    const out = deleteEvent([ev('a', 0, 2, 'C4')], ctx(), 'a');
    expect(sum(out)).toBe('0:-/2');
    expect(out[0].manual).toBe(true);
  });
});

describe('hauteurs', () => {
  it('déplace d\'un degré avec l\'altération de l\'armure', () => {
    // Fa majeur : Si devient Si bémol
    const out = movePitch([ev('a', 0, 1, 'A4')], ctx({ fifths: -1 }), 'a', 1);
    expect(out[0].pitch).toEqual({ step: 'B', octave: 4, alter: -1 });
    expect(movePitch([ev('a', 0, 1, 'B4')], ctx(), 'a', 1)[0].pitch).toEqual({ step: 'C', octave: 5, alter: 0 });
  });
  it('altérations et liaisons', () => {
    const n = [ev('a', 0, 1, 'F4')];
    expect(setAlter(n, ctx(), 'a', 1)[0].pitch!.alter).toBe(1);
    expect(setAlter(setAlter(n, ctx({ fifths: 1 }), 'a', 0), ctx({ fifths: 1 }), 'a', 'key')[0].pitch!.alter).toBe(1);
    const t = toggleTie(n, 'a');
    expect(t[0].tie).toBe(true);
    expect(toggleTie(t, 'a')[0].tie).toBeUndefined();
  });
});

describe('paroles', () => {
  const line = () => [ev('a', 0, 1, 'C4'), ev('b', 1, 1, 'D4'), ev('c', 2, 1, 'E4')];
  it('trait d\'union final = le mot continue', () => {
    let ns = setLyric(line(), 'a', 1, 'Là-');
    ns = setLyric(ns, 'b', 1, 'haut');
    expect(ns[0].lyrics).toEqual([{ verse: 1, text: 'Là', syllabic: 'begin', manual: true }]);
    expect(ns[1].lyrics![0].syllabic).toBe('end');
    expect(lyricDisplay(ns[0].lyrics![0])).toBe('Là-');
  });
  it('réajuste la syllabe suivante', () => {
    let ns = setLyric(line(), 'b', 1, 'haut');
    expect(ns[1].lyrics![0].syllabic).toBe('single');
    ns = setLyric(ns, 'a', 1, 'Là-');
    expect(ns[1].lyrics![0].syllabic).toBe('end');
    ns = setLyric(ns, 'a', 1, 'Là');
    expect(ns[1].lyrics![0].syllabic).toBe('single');
  });
  it('syllabe du milieu et suppression', () => {
    let ns = setLyric(line(), 'a', 1, 'ar-');
    ns = setLyric(ns, 'b', 1, 'c-');
    ns = setLyric(ns, 'c', 1, 'en-ciel');
    expect(ns.map(n => n.lyrics?.[0].syllabic)).toEqual(['begin', 'middle', 'end']);
    ns = setLyric(ns, 'b', 1, '');
    expect(ns[1].lyrics).toBeUndefined();
    expect(ns[2].lyrics![0].syllabic).toBe('end');   // le mot continue toujours depuis « ar- »
  });
  it('couplets indépendants', () => {
    let ns = setLyric(line(), 'a', 1, 'un');
    ns = setLyric(ns, 'a', 2, 'deux');
    expect(ns[0].lyrics!.map(l => l.text)).toEqual(['un', 'deux']);
  });
});

describe('aimantation', () => {
  const notes = [ev('a', 0, 1, 'C4'), ev('b', 1, 2, 'D4')];
  it('préfère le début d\'une note proche (accord)', () => {
    expect(snapOffset(1.1, notes, 1, 0.5, 4, 0.25)).toEqual({ offset: 1, kind: 'chord' });
  });
  it("aimante aussi à l'intérieur des notes (la note posée y passera dans une autre voix)", () => {
    // 2,5 est à l'intérieur de la blanche (1..3) : la grille de croches y reste disponible
    expect(snapOffset(2.4, notes, 1, 0.5, 4, 0.2).offset).toBe(2.5);
  });
  it('grille = min(figure, 1 temps)', () => {
    expect(snapOffset(3.6, notes, 1, 0.5, 4, 0.1).offset).toBe(3.5);
    // blanche : grille d'un temps, et rien ne commence à la fin de la mesure
    expect(snapOffset(3.6, [], 1, 2, 4, 0.1).offset).toBe(3);
  });
});

describe('portée', () => {
  it('ligne du bas selon la clé', () => {
    expect(clefBottom({ sign: 'G', line: 2 })).toBe(30);   // Mi4
    expect(clefBottom({ sign: 'F', line: 4 })).toBe(18);   // Sol2
    expect(clefBottom({ sign: 'C', line: 3 })).toBe(24);   // Fa3
    expect(clefBottom({ sign: 'G', line: 2, octaveChange: -1 })).toBe(23);
  });
  it('changements de clé', () => {
    const line = { id: '0|1', name: '', part: 0, partName: '', staff: 1, clef: { sign: 'G' as const, line: 2 }, notes: [],
      clefChanges: [{ measure: 3, offset: 2, clef: { sign: 'F' as const, line: 4 } }] };
    expect(clefAt(line, 3, 0).sign).toBe('G');
    expect(clefAt(line, 3, 2).sign).toBe('F');
    expect(clefAt(line, 5).sign).toBe('F');
  });
  it('armure transposée dans la clé', () => {
    expect(keySignature(2, 30)).toEqual([38, 35]);   // Fa5, Do5
    expect(keySignature(-1, 18)).toEqual([20]);      // Si2 en clé de fa
  });
});

describe('extrait de l\'original', () => {
  const layout = {
    width: 2000, height: 3000, interline: 20,
    systems: [
      { id: 1, left: 100, right: 1900, top: 400, bottom: 900, staves: [], measures: [{ id: 1, left: 150, right: 600 }, { id: 2, left: 600, right: 1900 }] },
      { id: 2, left: 100, right: 1900, top: 1200, bottom: 1700, staves: [], measures: [{ id: 3, left: 120, right: 800 }] },
    ],
  };
  it('parcourt les systèmes dans l\'ordre, avec marges', () => {
    expect(measureBox(layout, 2)).toEqual({ x: 90, y: 1140, w: 740, h: 640, left: 120, right: 800 });
    expect(measureBox(layout, 1)!.w).toBe(1930 - 570);
    expect(measureBox({ ...layout, width: 1910 }, 1)!.w).toBe(1910 - 570);   // bornée à l'image
    expect(measureBox(layout, 3)).toBeNull();
  });
});

describe('polyphonie', () => {
  // Over The Rainbow, page 1, mesure 3, main droite telle que lue par Audiveris : la seconde voix est mise
  // à la suite de la première (5 temps) et le Mi bémol final est perdu.
  const read = () => [
    ev('c', 0, 2, 'C4'), ev('a', 2, 1, 'A3'), ev('e', 3, 1, 'E4'),
    ev('a2', 3, 2, 'A3', 2), ev('f2', 3, 2, 'F4', 2),
  ];
  const at = (ns: NoteEvent[], v: number) => sum(ns.filter(n => n.voice === v));

  it("se corrige en déplaçant et en changeant de voix", () => {
    const c = ctx();
    let ns = read();
    expect(contentEnd(ns)).toBe(5);
    ns = setVoice(ns, c, 'a', 2);              // La noire → voix 2…
    ns = moveInTime(ns, c, 'a', -1);           // …au 2e temps
    ns = insertEvent(ns, c, { offset: 1, duration: 1, pitch: P('F4'), voice: 2 }).notes;   // accord La/Fa
    ns = moveInTime(ns, c, 'e', -1);           // Mi au 3e temps
    ns = moveInTime(ns, c, 'a2', -1);          // l'accord Fa/La blanche suit en bloc
    ns = insertEvent(ns, c, { offset: 3, duration: 1, pitch: { step: 'E', alter: -1, octave: 4 }, voice: 1 }).notes;
    expect(at(ns, 1)).toBe('0:C4/2 2:E4/1 3:E4/1');
    expect(at(ns, 2)).toBe('1:A3/1 1:F4/1 2:A3/2 2:F4/2');
    expect(contentEnd(ns)).toBe(4);
    expect(ns.filter(n => ['a', 'e', 'a2', 'f2'].includes(n.id)).every(n => n.manual)).toBe(true);
  });

  it('un déplacement mange les silences de la voix et ne passe pas avant le début', () => {
    const ns = moveInTime([ev('r', 0, 2, null), ev('n', 2, 1, 'G4')], ctx(), 'n', -1);
    expect(sum(ns)).toBe('0:-/1 1:G4/1');
    expect(sum(moveInTime([ev('n', 0.5, 1, 'G4')], ctx(), 'n', -2))).toBe('0:G4/1');
  });

  it("changer de voix emporte tout l'accord", () => {
    const ns = setVoice([ev('a', 0, 1, 'C4'), ev('b', 0, 1, 'E4'), ev('r', 0, 4, null, 2)], ctx(), 'b', 2);
    expect(ns.filter(n => n.voice === 2 && n.pitch).map(n => n.id).sort()).toEqual(['a', 'b']);
    expect(at(ns, 2)).toBe('0:C4/1 0:E4/1 1:-/3');   // le silence de la voix 2 a cédé la place
  });

  it('ramener à la métrique coupe ce qui dépasse', () => {
    const ns = fitToMeter(read(), ctx(), 4);
    expect(sum(ns)).toBe('0:C4/2 2:A3/1 3:E4/1 3:A3/1 3:F4/1');
    expect(ns.find(n => n.id === 'a2')!.manual).toBe(true);
    const juste = [ev('x', 0, 4, 'C4')];
    expect(fitToMeter(juste, ctx(), 4)).toBe(juste);
    expect(sum(fitToMeter([ev('y', 4, 1, 'C4')], ctx(), 4))).toBe('0:-/4');
  });
});

describe('notes superposées', () => {
  it("blanche au temps 1 : une noire posée au temps 2 passe en voix 2 au lieu d'être repoussée", () => {
    const notes = [ev('h', 0, 2, 'C4'), ev('r', 2, 2, null)];
    expect(snapOffset(1.05, notes, 1, 1, 4, 0.1).offset).toBe(1);
    const r = insertEvent(notes, ctx(), { offset: 1, duration: 1, pitch: P('A4'), voice: 1 });
    const n = r.notes.find(x => x.id === r.id)!;
    expect([n.offset, n.voice]).toEqual([1, 2]);
    expect(sum(r.notes.filter(x => x.voice === 1))).toBe('0:C4/2 2:-/2');   // la voix 1 n'a pas bougé
    // une troisième note par-dessus les deux : voix 3
    const r2 = insertEvent(r.notes, ctx(), { offset: 1.5, duration: 0.5, pitch: P('E5'), voice: 1 });
    expect(r2.notes.find(x => x.id === r2.id)!.voice).toBe(3);
    // au début de la blanche, c'est toujours un accord dans la voix 1
    const r3 = insertEvent(notes, ctx(), { offset: 0, duration: 1, pitch: P('E4'), voice: 1 });
    expect(r3.notes.find(x => x.id === r3.id)!.voice).toBe(1);
  });
});
