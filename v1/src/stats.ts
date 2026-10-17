// Statistiques d'usage anonymes : le serveur local les relaie à PostHog quand c'est activé (application de
// bureau packagée), sinon il les ignore. Jamais bloquant, jamais de nom de fichier ni de contenu de partition.

export type StatsEvent = 'partition_analysee' | 'projet_charge' | 'projet_exporte';

export function track(event: StatsEvent, properties: Record<string, string | number | boolean> = {}): void {
  try {
    void fetch('/api/stats', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, properties }),
      keepalive: true,
    }).catch(() => { /* serveur indisponible : tant pis */ });
  } catch { /* fetch absent (tests) */ }
}
