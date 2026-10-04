// Cartes repliables de l'étape d'analyse : une fois une zone lue (progression, choix de la police, une page
// et ses signalements), on la replie pour ne garder que son en-tête. L'état vit hors des composants : il
// survit à un aller-retour vers l'étape « Relire et écouter » (pour la durée de la session).
import { useSyncExternalStore, type ReactNode } from 'react';

const folded = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;
const emit = () => { version++; listeners.forEach(l => l()); };
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

/** Replie (true) ou déplie (false) d'un coup les zones `ids`. */
export function setFolded(ids: string[], value: boolean): void {
  for (const id of ids) if (value) folded.add(id); else folded.delete(id);
  emit();
}

export function useFolded(id: string): boolean {
  useSyncExternalStore(subscribe, () => version);
  return folded.has(id);
}

/** Tout est-il replié parmi `ids` ? (pour le bouton « Tout replier / Tout déplier ») */
export function useAllFolded(ids: string[]): boolean {
  useSyncExternalStore(subscribe, () => version);
  return ids.length > 0 && ids.every(id => folded.has(id));
}

/** En-tête cliquable d'une carte repliable : chevron + titre ; `children` = ce qui reste visible replié. */
export function FoldHead({ id, title, level = 3, children }: { id: string; title: ReactNode; level?: 2 | 3; children?: ReactNode }) {
  const isFolded = useFolded(id);
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <div className="row an-head">
      <button className="an-fold" aria-expanded={!isFolded} title={isFolded ? 'Déplier' : 'Replier'}
              onClick={() => setFolded([id], !isFolded)}>
        <span className="an-chevron" aria-hidden>{isFolded ? '▸' : '▾'}</span>
        <H style={{ margin: 0 }}>{title}</H>
      </button>
      {children}
    </div>
  );
}
