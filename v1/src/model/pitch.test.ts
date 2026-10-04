import { describe, expect, it } from 'vitest';
import { diatonic, fromDiatonic, keyAlter, keyLabel, midi, parsePitchCode, pitchCode, pitchLabel, transposeKey, transposePitch } from './pitch';
import type { Pitch } from './types';

const P = (s: string) => parsePitchCode(s) as Pitch;

describe('hauteurs', () => {
  it('MIDI et noms', () => {
    expect(midi(P('C4'))).toBe(60);
    expect(midi(P('Bb3'))).toBe(58);
    expect(midi(P('B#3'))).toBe(60);
    expect(pitchLabel(P('Eb4'))).toBe('Mi♭4');
    expect(pitchCode(P('F##5'))).toBe('F##5');
    expect(parsePitchCode('H4')).toBeNull();
  });

  it('degrés diatoniques', () => {
    expect(diatonic(P('C4')) - diatonic(P('E4'))).toBe(-2);
    expect(fromDiatonic(diatonic(P('B3')) + 1)).toEqual({ step: 'C', octave: 4 });
  });

  it("altérations de l'armure", () => {
    expect(keyAlter('B', -1)).toBe(-1);
    expect(keyAlter('E', -1)).toBe(0);
    expect(keyAlter('F', 1)).toBe(1);
    expect(keyAlter('C', 1)).toBe(0);
    expect(keyAlter('C', 2)).toBe(1);
    expect(keyAlter('F', -7)).toBe(-1);
    expect(keyAlter('B', 7)).toBe(1);
    expect(keyLabel(-3)).toBe('Mi♭ majeur');
    expect(keyLabel(0, 'minor')).toBe('La mineur');
  });

  it('transposition orthographiée', () => {
    // Fa majeur + 2 demi-tons → Sol majeur ; Si♭ → Do, La → Si
    const k = transposeKey(-1, 2);
    expect(k.fifths).toBe(1);
    expect(transposePitch(P('Bb4'), 2, k.shift)).toEqual(P('C5'));
    expect(transposePitch(P('A4'), 2, k.shift)).toEqual(P('B4'));
    // Do majeur + 1 → Ré♭ (5 bémols) plutôt que Do♯ (7 dièses)
    const up1 = transposeKey(0, 1);
    expect(up1.fifths).toBe(-5);
    expect(transposePitch(P('E4'), 1, up1.shift)).toEqual(P('F4'));
    expect(transposePitch(P('C4'), 1, up1.shift)).toEqual(P('Db4'));
    // Do majeur - 2 → Si♭ majeur
    const down2 = transposeKey(0, -2);
    expect(down2.fifths).toBe(-2);
    expect(transposePitch(P('C4'), -2, down2.shift)).toEqual(P('Bb3'));
    expect(transposePitch(P('B4'), -2, down2.shift)).toEqual(P('A4'));
    // une octave : même écriture
    const oct = transposeKey(2, 12);
    expect(oct).toEqual({ fifths: 2, shift: 0 });
    expect(transposePitch(P('F#4'), 12, oct.shift)).toEqual(P('F#5'));
    // la hauteur sonore suit toujours le nombre de demi-tons
    for (const t of [-13, -7, -1, 3, 5, 6, 11]) {
      const kk = transposeKey(-2, t);
      for (const s of ['C4', 'Eb4', 'F#3', 'Bb5', 'G##4']) expect(midi(transposePitch(P(s), t, kk.shift))).toBe(midi(P(s)) + t);
    }
  });
});
