// Projet d'exemple : « Au clair de la lune », embarqué dans public/demo (donc servi avec l'interface, en
// version web comme dans l'application de bureau). Pour essayer l'application sans partition sous la main.
import { parseProject } from '../../model/project-io';
import { clearPages } from '../../analysis/run';
import { resetHistory, setProject, setState } from '../../state/store';
import { track } from '../../stats';
import { DEMO_FILE } from './demo-score';

/**
 * Ouvre le projet d'exemple embarqué (public/demo/) comme un projet chargé, et passe à l'étape
 * « Relire et écouter ». Lève une Error lisible si l'exemple est introuvable ou illisible.
 */
export async function openDemo(): Promise<void> {
  let text: string;
  try {
    // URL relative : la page est servie à la racine, par Vite comme par le serveur local (dist/)
    const r = await fetch(DEMO_FILE, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    text = await r.text();
  } catch (e) {
    throw new Error(`Exemple introuvable (${e instanceof Error ? e.message : String(e)}).`);
  }
  const project = parseProject(text);
  clearPages();
  resetHistory();
  setProject(project, []);
  setState({ pages: [], step: 'score', selection: null });
  track('exemple_ouvert');
}
