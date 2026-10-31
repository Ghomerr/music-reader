import { describe, expect, it } from 'vitest';
import { isNewer } from './version.mjs';

describe('comparaison de versions (mise à jour)', () => {
  it('compare les numéros un à un, pas comme du texte', () => {
    expect(isNewer('1.2.0', '1.1.0')).toBe(true);
    expect(isNewer('v1.10.0', '1.9.3')).toBe(true);
    expect(isNewer('2.0.0', '1.99.99')).toBe(true);
    expect(isNewer('1.2', '1.2.0')).toBe(false);
    expect(isNewer('1.2.0', '1.2.0')).toBe(false);
    expect(isNewer('1.1.9', '1.2.0')).toBe(false);
    expect(isNewer('1.3.0-beta.1', '1.2.0')).toBe(true);
    expect(isNewer('', '1.2.0')).toBe(false);
  });
});
