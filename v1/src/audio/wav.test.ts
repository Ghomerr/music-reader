import { describe, expect, it } from 'vitest';
import { encodeWav, slug } from './wav';

const str = (v: DataView, o: number, n: number) => String.fromCharCode(...Array.from({ length: n }, (_, i) => v.getUint8(o + i)));

describe('encodeWav', () => {
  it('écrit un en-tête RIFF/WAVE PCM 16 bits mono correct', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]);
    const buf = encodeWav(samples, 44100);
    const v = new DataView(buf);
    expect(buf.byteLength).toBe(44 + samples.length * 2);
    expect(str(v, 0, 4)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
    expect(str(v, 8, 4)).toBe('WAVE');
    expect(str(v, 12, 4)).toBe('fmt ');
    expect(v.getUint32(16, true)).toBe(16);
    expect(v.getUint16(20, true)).toBe(1);        // PCM
    expect(v.getUint16(22, true)).toBe(1);        // mono
    expect(v.getUint32(24, true)).toBe(44100);
    expect(v.getUint32(28, true)).toBe(88200);    // octets par seconde
    expect(v.getUint16(32, true)).toBe(2);
    expect(v.getUint16(34, true)).toBe(16);
    expect(str(v, 36, 4)).toBe('data');
    expect(v.getUint32(40, true)).toBe(samples.length * 2);
  });

  it('convertit les échantillons en entiers 16 bits, avec écrêtage', () => {
    const v = new DataView(encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1, 2, -2]), 8000));
    const s = Array.from({ length: 7 }, (_, i) => v.getInt16(44 + i * 2, true));
    expect(s).toEqual([0, 16383, -16384, 32767, -32768, 32767, -32768]);
  });

  it('gère un rendu vide', () => {
    expect(encodeWav(new Float32Array(0), 44100).byteLength).toBe(44);
  });
});

describe('slug', () => {
  it('produit un nom de fichier sans accents ni ponctuation', () => {
    expect(slug('Ode à la joie !')).toBe('ode-a-la-joie');
    expect(slug('Über « Fortunio »')).toBe('uber-fortunio');
    expect(slug('  ')).toBe('partition');
  });
});
