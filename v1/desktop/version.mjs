// Comparaison de numéros de version (sans dépendance à Electron, pour pouvoir la tester).

/** « 1.10.0 » est plus récente que « 1.9.3 » ; un « v » initial et les suffixes (-beta…) sont ignorés. */
export function isNewer(candidate, current) {
  const parts = v => String(v).replace(/^v/, '').split('-')[0].split('.').map(n => parseInt(n, 10) || 0);
  const a = parts(candidate), b = parts(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}
