// Contenu des visites guidées : une visite par écran, chaque étape désigne sa cible (sélecteur CSS ou
// fonction de recherche) et l'explique en quelques phrases. Les cibles absentes sont sautées à l'affichage :
// une visite peut donc nommer des éléments qui n'existent que dans certains cas (image d'origine, mesure
// qui déborde…).
import type { ReactNode } from 'react';
import { findIssues } from '../../model/check';
import { getState, setState } from '../../state/store';
import { openDemo } from '../import/demo';

export type TourName = 'import' | 'analyse' | 'score' | 'editor' | 'print';

/** Sélecteur CSS (premier élément trouvé) ou recherche plus fine (plusieurs éléments = leur rectangle englobant). */
export type Target = string | (() => Element[]);

export interface TourStep {
  target?: Target;
  title: string;
  body: ReactNode;
  /** Bouton de plus dans la bulle : il prépare l'écran suivant et renvoie la visite à enchaîner. */
  action?: { label: string; run: () => Promise<TourName | void> };
}

// ---------- Recherche des cibles ----------

const all = (sel: string): (() => Element[]) => () => [...document.querySelectorAll(sel)];

/** Premier élément `sel` dont le texte contient l'un des `texts` (boutons sans classe propre). */
const byText = (sel: string, ...texts: string[]): (() => Element[]) => () => {
  const el = [...document.querySelectorAll(sel)].find(e => texts.some(t => e.textContent?.includes(t)));
  return el ? [el] : [];
};

/** Bloc qui contient le premier `sel` dont le texte contient `text` (une carte d'après son titre). */
const around = (sel: string, text: string, container: string): (() => Element[]) => () => {
  const el = [...document.querySelectorAll(sel)].find(e => e.textContent?.includes(text))?.closest(container);
  return el ? [el] : [];
};

const fieldset = (legend: string) => around('.print-options legend', legend, 'fieldset');

// ---------- Enchaînements ----------

/** Ouvre l'exemple, puis la visite de « Relire et écouter ». */
async function demoThenScore(): Promise<TourName> {
  await openDemo();
  return 'score';
}

/** Ouvre l'éditeur sur la première mesure à relire (la première mesure s'il n'y en a pas). */
async function openEditor(): Promise<TourName | void> {
  const p = getState().project;
  if (!p) return;
  let issue: { measure: number; lineId: string } | undefined;
  try { issue = findIssues(p).find(i => !i.checked); } catch { /* diagnostics impossibles : première mesure */ }
  setState({ selection: issue ? { measure: issue.measure, lineId: issue.lineId } : { measure: 0 } });
  return 'editor';
}

// ---------- Visites ----------

const IMPORT: TourStep[] = [
  {
    title: 'Bienvenue',
    body: <>
      <p>Lect'O'Note lit une partition à partir de ses images : <b>Audiveris</b> reconnaît les notes, vous <b>relisez
        et corrigez</b> ce qui a été mal lu, vous <b>écoutez</b>, puis vous <b>réimprimez</b> une partition propre.</p>
      <p>Cette visite présente l'écran Importer.</p>
    </>,
  },
  {
    target: '.import-drop',
    title: 'Vos pages',
    body: <>
      <p>Glissez ici des images PNG ou JPG, ou cliquez pour les choisir. <b>Une image = une page</b> de partition,
        dans l'ordre de lecture (les flèches sous les miniatures le corrigent).</p>
      <p>Un scan de deux pages côte à côte est à couper en deux avant.</p>
    </>,
  },
  {
    target: byText('.btn', 'Prendre une photo'),
    title: 'Prendre une photo',
    body: <p>Sur téléphone ou tablette, photographiez directement la page : <b>à plat, droite et nette</b>, une page par photo.</p>,
  },
  {
    target: byText('.btn', 'Ouvrir un projet'),
    title: 'Reprendre un projet',
    body: <>
      <p>Un projet <b>.json</b> exporté plus tôt se rouvre ici, corrections et réglages compris, sans refaire l'analyse.</p>
      <p>L'application ne garde rien une fois fermée : <b>exportez le projet</b> pour continuer plus tard.</p>
    </>,
  },
  {
    target: '[data-tour="blank-score"]',
    title: 'Partition vierge',
    body: <p>Pas d'image sous la main ? Partez d'une <b>partition vide</b> et écrivez les notes vous-même dans l'éditeur de mesure.</p>,
  },
  {
    target: '[data-tour="demo"]',
    title: 'Un exemple',
    body: <p><b>Au clair de la lune</b>, déjà analysé, pour découvrir la relecture, l'écoute et l'impression sans attendre.
      Une mesure y est volontairement fausse, à corriger.</p>,
  },
  {
    target: '.import-opt',
    title: 'Choix automatique de la police',
    body: <p>Audiveris reconnaît les têtes de notes d'après une police de référence. Coché, il essaie <b>cinq polices</b> sur
      le début de la page 1 et propose la meilleure, que vous validerez à l'étape suivante. Laissez coché.</p>,
  },
  {
    target: around('.card label', 'Agrandissement', 'label'),
    title: 'Agrandissement',
    body: <p>En <b>Auto</b>, une page de trop faible résolution est agrandie puis réanalysée. À ne changer que si une page est mal lue.</p>,
  },
  {
    target: byText('.btn.primary', 'Analyser'),
    title: 'Analyser',
    body: <p>Lance la reconnaissance, <b>page par page</b> : de quelques dizaines de secondes à une minute par page, choix de la police compris.</p>,
  },
  {
    target: '[data-tour="help"]',
    title: 'Cette visite, sur chaque écran',
    body: <p>Le bouton <b>🎓 Didacticiel</b> présente l'écran affiché, à chaque étape (et l'éditeur de mesure quand il est ouvert).</p>,
  },
  {
    title: 'À vous !',
    body: <p>Pour voir la suite sans attendre d'analyse, <b>ouvrez l'exemple</b> : la visite continue sur l'écran
      « Relire et écouter ».</p>,
    action: { label: "Ouvrir l'exemple", run: demoThenScore },
  },
];

const ANALYSE: TourStep[] = [
  {
    target: around('.an-fold h2', 'Analyse', 'section'),
    title: 'Progression',
    body: <p>Les pages passent <b>une à une</b> dans Audiveris ; chacune affiche son état et sa durée.</p>,
  },
  {
    target: around('.an-fold h3', 'Choix de la police', 'section'),
    title: 'Choix de la police',
    body: <p>Le début de la page 1 a été lu avec chaque police ; la meilleure (★) est <b>proposée</b>. <b>Validez-la</b>,
      ou choisissez-en une autre et relancez toutes les pages.</p>,
  },
  {
    target: around('.an-fold h3', 'Partition assemblée', 'section'),
    title: 'Partition assemblée',
    body: <p>Les pages mises bout à bout : lignes, mesures, notes, tonalité, métrique, et surtout les <b>mesures
      signalées</b>, dont le rythme ne retombe pas juste.</p>,
  },
  {
    target: '.an-page',
    title: 'Une page',
    body: <p><b>Image d'origine</b> et <b>partition reconstruite</b> côte à côte. Les mesures douteuses sont teintées :
      orange pour un rythme faux, rouge pour une mesure vide. Un clic sur une mesure l'ouvre dans l'éditeur.</p>,
  },
  {
    target: '.an-page .an-rerun',
    title: 'Relancer une page',
    body: <p>Page mal lue (barres de mesure manquées, rondes disparues) ? <b>Relancez-la</b> avec une autre police ou
      un autre agrandissement.</p>,
  },
  {
    target: '.an-page .an-issues',
    title: 'Mesures signalées',
    body: <p>Le détail de ce qui cloche sur la page ; chaque lien ouvre la mesure dans l'éditeur.</p>,
  },
  {
    target: byText('.btn', 'Tout replier', 'Tout déplier'),
    title: 'Replier',
    body: <p>Un clic sur l'en-tête d'une zone la replie une fois lue ; <b>Tout replier</b> ne garde que les en-têtes.</p>,
  },
  {
    target: byText('.btn.primary', 'Relire et écouter'),
    title: 'Passer à la relecture',
    body: <p>Une fois l'analyse terminée : <b>Relire et écouter</b>, pour corriger, écouter et exporter.</p>,
  },
];

const SCORE: TourStep[] = [
  {
    target: '.score-card',
    title: 'La partition',
    body: <p>Toute la partition reconstruite. En haut à droite : le <b>zoom</b> et la <b>mise en page d'origine</b> (mêmes
      retours à la ligne que l'image, pour comparer).</p>,
  },
  {
    target: '.score-hint .legend',
    title: 'Les couleurs',
    body: <p><b>Orange</b> : rythme faux, trou ou note perdue ; <b>rouge</b> : mesure vide ; <b>gris</b> : mesure
      validée ; <b>indigo</b> : note corrigée à la main. Une mesure en orange est à relire ; ces couleurs ne sont jamais imprimées.</p>,
  },
  {
    target: '.score-card .osmd-host',
    title: 'Corriger une mesure',
    body: <p><b>Cliquez une mesure</b> : l'éditeur s'ouvre en bas de l'écran, sur la ligne cliquée.</p>,
  },
  {
    target: '.issues',
    title: 'À relire',
    body: <p>Les mesures signalées, une par une ; <b>Suivante à relire →</b> les enchaîne. La liste se met à jour à
      chaque correction.</p>,
  },
  {
    target: '.pl > .card:has(.pl-transport)',
    title: 'Écouter',
    body: <p><b>Lecture / pause</b> (barre d'espace), stop, boucle ; cliquer la barre pour se déplacer. La mesure jouée
      s'éclaire sur la partition.</p>,
  },
  {
    target: '.pl > .card:has(.pl-line)',
    title: 'Lignes',
    body: <p>Pour chaque ligne : la cocher, l'écouter seule (<b>Solo</b>), choisir l'instrument et le volume. Une ligne
      décochée disparaît aussi de la partition.</p>,
  },
  {
    target: '.pl > .card:has(.pl-tempo)',
    title: 'Tempo',
    body: <p>Jamais lu sur la partition : on part de <b>100</b> et on ajuste à l'oreille.</p>,
  },
  {
    target: '.pl > .card:has(.pl-stepper)',
    title: 'Tonalité',
    body: <p><b>Transposer</b> d'un demi-ton ou d'une octave, pour chanter plus haut ou plus bas. Le réglage vaut aussi
      pour l'impression.</p>,
  },
  {
    target: '.pl > .card:has(.pl-export)',
    title: 'Exporter',
    body: <p><b>Projet (.json)</b> : notes, corrections et réglages, à rouvrir depuis Importer — l'application ne garde
      rien une fois fermée. <b>Audio (.wav)</b> : la musique avec les réglages en cours.</p>,
  },
  {
    target: () => {
      const b = byText('.app-header .btn', 'Annuler')()[0];
      return b ? [b.closest('.row') ?? b] : [];
    },
    title: 'Annuler, rétablir',
    body: <p><b>Ctrl+Z</b> / <b>Ctrl+Y</b> défont et refont les corrections de notes (pas les réglages d'écoute).</p>,
  },
  {
    target: byText('.steps .step', 'Imprimer'),
    title: 'Ensuite',
    body: <p>Une fois la partition relue : <b>Imprimer</b> en ressort une version propre.</p>,
  },
  {
    title: "L'éditeur de mesure",
    body: <p>Il a sa propre visite : <b>🎓 Didacticiel</b> pendant qu'il est ouvert, ou tout de suite sur une mesure à relire.</p>,
    action: { label: "Ouvrir l'éditeur", run: openEditor },
  },
];

const EDITOR: TourStep[] = [
  {
    target: '.me-head',
    title: 'Éditeur de mesure',
    body: <p>La mesure ouverte, ligne par ligne. <b>← →</b> passent à la mesure voisine, <b>▶ Écouter la mesure</b> la
      joue, <b>✕</b> (ou Échap) ferme.</p>,
  },
  {
    target: '.me-original',
    title: "L'original",
    body: <p>L'extrait de l'<b>image d'origine</b> : comparez ce qui est écrit et ce qui a été lu.</p>,
  },
  {
    target: '.me-issues',
    title: 'Diagnostics',
    body: <p>Ce qui cloche dans cette mesure ; recalculé à chaque correction : une mesure réparée perd sa couleur aussitôt.</p>,
  },
  {
    target: '.me-modes',
    title: 'Trois modes',
    body: <p><b>Sélectionner</b> (S) : un clic choisit une note à modifier. <b>Ajouter</b> (A) : un clic pose la figure
      choisie. <b>Gommer</b> (G) : un clic supprime.</p>,
  },
  {
    target: all('.me-palette > .btn.fig'),
    title: 'Figures',
    body: <p>Ronde → triple croche (touches <b>1 à 6</b>), point, triolet, silence. Sur une note sélectionnée, la figure
      change sa durée ; sinon on passe en mode Ajouter.</p>,
  },
  {
    target: all('.me-opts > label'),
    title: 'Décaler la suite, voix courante',
    body: <p><b>Décaler la suite</b> : changer une durée recale les notes suivantes. <b>Voix courante</b> (V) : les
      autres voix passent en gris et les notes posées vont dans celle-ci.</p>,
  },
  {
    target: '.me-lines .me-line',
    title: 'Une portée',
    body: <p>Cliquez une note pour la sélectionner, puis <b>↑ ↓</b> (ou glissez-la), ♯ ♭ ♮, Suppr. En mode Ajouter, une
      tête fantôme suit le pointeur avec le nom de la note.</p>,
  },
  {
    target: '.me-lines .staff-lyrics',
    title: 'Paroles',
    body: <p>Un champ sous chaque note ; un <b>trait d'union final</b> (« Là- ») lie la syllabe à la suivante.</p>,
  },
  {
    target: '.me-verses',
    title: 'Couplets',
    body: <p><b>+ couplet</b> ajoute une rangée de paroles ; <b>n ✕</b> supprime le couplet n dans toute la partition (annulable).</p>,
  },
  {
    target: byText('.me-line-head .btn', 'Marquer comme vérifiée', 'Vérifiée'),
    title: 'Marquer comme vérifiée',
    body: <p>La mesure est juste pour cette ligne, ou acceptable telle quelle : elle passe en <b>gris</b>, comptée comme validée.</p>,
  },
  {
    target: byText('.me-drawer .btn', 'Ramener'),
    title: 'Ramener à la métrique',
    body: <p>Coupe ce qui <b>dépasse la barre de mesure</b>. Pour une seconde voix mal placée, mieux vaut la déplacer
      (plus tôt / plus tard, voix).</p>,
  },
  {
    target: '[data-tour="measure-ops"]',
    title: 'Insérer, supprimer une mesure',
    body: <p>Ajoute une mesure vide à côté de celle-ci, ou la supprime. Comme toute correction : <b>Ctrl+Z</b> pour annuler.</p>,
  },
  {
    target: '[data-tour="measure-copy"]',
    title: 'Copier une mesure',
    body: (
      <>
        <p>Un motif qui revient (accompagnement, refrain) ? Corrigez-le une fois, puis copiez cette mesure sur d'autres : <i>« 5 »</i>, <i>« 5, 7-9 »</i> ou <i>« jusqu'à la fin »</i>.</p>
        <p>Choisissez les lignes à copier. Les mesures cibles gardent leurs propres paroles, sauf si vous cochez « copier aussi les paroles ».</p>
      </>
    ),
  },
  {
    title: 'Bonne relecture',
    body: <p>Toutes les corrections s'annulent (<b>Ctrl+Z</b>) et survivent à une réanalyse de la page. Raccourcis :
      S, A, G, 1–6, ↑ ↓, Suppr, Échap.</p>,
  },
];

const PRINT: TourStep[] = [
  {
    target: around('.print-options label', 'Titre', 'label'),
    title: 'Titre',
    body: <p>Le titre imprimé en tête de la première page ; vide, pas de titre.</p>,
  },
  {
    target: fieldset('Lignes'),
    title: 'Lignes à imprimer',
    body: <p>Gardez seulement ce qu'il faut : <b>la seule voix</b>, par exemple.</p>,
  },
  {
    target: fieldset('Tonalité'),
    title: 'Tonalité',
    body: <p>Le même réglage que pour l'écoute : <b>notes et armure</b> sont transposées.</p>,
  },
  {
    target: fieldset('Paroles'),
    title: 'Paroles',
    body: <p>Avec ou sans paroles, et <b>couplet par couplet</b> quand il y en a plusieurs.</p>,
  },
  {
    target: fieldset('Mise en page'),
    title: 'Mise en page',
    body: <p>Reprendre les <b>fins de ligne et de page de l'original</b>, ou laisser une mise en page libre.</p>,
  },
  {
    target: '.print-status .note.warn',
    title: 'Mesures douteuses',
    body: <p>Il reste des mesures non relues : l'impression reste possible, sans couleurs de diagnostic.</p>,
  },
  {
    target: '.print-viewport',
    title: 'Aperçu A4',
    body: <p>Exactement ce qui part à l'imprimante : <b>une page par feuille</b>, sans couleurs de diagnostic.</p>,
  },
  {
    target: '.print-actions .btn.primary',
    title: 'Imprimer / PDF',
    body: <p>Ouvre la boîte d'impression ; pour un PDF, choisissez <b>« Enregistrer au format PDF »</b> comme imprimante.</p>,
  },
  {
    target: '.print-actions .btn:not(.primary)',
    title: 'MusicXML',
    body: <p>Le format d'échange des logiciels de partition (MuseScore, Finale…), pour continuer la mise en page ailleurs.</p>,
  },
];

export const TOURS: Record<TourName, TourStep[]> = {
  import: IMPORT, analyse: ANALYSE, score: SCORE, editor: EDITOR, print: PRINT,
};

/** Élément dont la présence dit que l'écran de la visite est affiché (attendu avant de filtrer les étapes). */
export const SCREEN: Record<TourName, string> = {
  import: '.import-drop', analyse: '.an-bar', score: '.score-step', editor: '.me-drawer', print: '.print-step',
};

/** Contenu rendu après coup (partition, aperçu) : attendu un moment de plus, sans bloquer la visite. */
export const READY: Partial<Record<TourName, string>> = {
  score: '.score-card .osmd-host svg', print: '.print-sheet svg',
};
