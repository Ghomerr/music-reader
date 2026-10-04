# Lect'O'Note Matic 3000 — v1

Application complète, construite sur les enseignements de la [v0](../v0/README.md) : on importe les pages
d'une partition, Audiveris les reconnaît, on relit et corrige ce qui a été mal lu, on écoute, puis on
réimprime une partition propre. Voir [PLAN.md](../PLAN.md) pour le cadrage.

## Parcours

1. **Importer** — une image par page (PNG/JPG, glisser-déposer, sélecteur ou appareil photo), à réordonner.
   Avertissement si une image semble contenir deux pages. Ou **ouvrir un projet `.json`** : on arrive
   directement à la relecture, réglages et corrections compris.
2. **Analyser** — Audiveris page par page, avec agrandissement automatique si la résolution est trop faible.
   - **Choix automatique de la police** sur la première page (voir plus bas), proposée ensuite pour les autres
     pages : on la valide, ou on en choisit une autre et on relance toutes les pages. Police et agrandissement
     restent réglables page par page.
   - Pour chaque page : image d'origine et partition reconstruite côte à côte, mesures signalées, journal
     Audiveris, MusicXML brut.
   - Résumé de la partition assemblée : lignes, mesures, notes, répartition des durées, tonalité, métrique.
3. **Relire et écouter** — la partition entière, mesures douteuses en couleur :
   - orange : rythme faux, trou dans la mesure, ou note vue par Audiveris puis jetée (lue dans son journal) ;
   - rouge : mesure vide ;
   - gris : mesure validée à la main.
   Un clic sur une mesure ouvre l'**éditeur** (voir plus bas). À côté, le panneau d'écoute : lignes (activer,
   solo, instrument, volume), tempo (100 au départ, jamais lu sur la partition), transposition (demi-ton et
   octave), boucle, et exports **projet `.json`** et **audio `.wav`**.
4. **Imprimer** — aperçu A4 de la partition finale, **sans couleurs de diagnostic** : lignes choisies (la seule
   voix, par exemple), tonalité choisie (notes et armure transposées), corrections comprises, **paroles avec ou
   sans, couplet par couplet**, mise en page libre ou celle de l'original. « Imprimer / PDF » passe par la boîte
   d'impression du navigateur (« Enregistrer au format PDF »). Export MusicXML possible.

## Corriger une mesure

L'éditeur s'ouvre en bas de l'écran sur la mesure cliquée, avec **l'extrait correspondant de l'image
d'origine** pour comparer ce qui est écrit et ce qui a été lu (quand l'image est disponible, donc pas sur un
projet rechargé).

Trois **modes** exclusifs disent ce que fait un clic sur la portée, pour qu'il ne soit jamais ambigu :

- **Sélectionner** (par défaut, touche S) : un clic sur une note la sélectionne (elle s'éclaire au survol), un
  clic ailleurs désélectionne ; rien n'est jamais posé. On la modifie ensuite : ↑/↓ (ou la faire glisser),
  ♯ ♭ ♮, une autre figure dans la palette, « liée à la suivante », ou Supprimer (Suppr). Avec « décaler la
  suite » (coché par défaut), changer une durée ou supprimer une note recale la suite de la voix : une croche
  lue comme une noire se corrige d'un geste.
- **Ajouter** (A, ou choisir une figure sans note sélectionnée) : chaque clic pose la figure choisie (ronde →
  triple croche, point, triolet, silence), même par-dessus une note. Une tête fantôme suit le pointeur, aimantée
  à la ligne ou à l'interligne le plus proche, avec le nom de la note (« Ré5 · accord »). L'armure est appliquée
  d'office ; la note posée reste sélectionnée pour lui ajouter un ♭ au besoin.
- **Gommer** (G) : un clic supprime la note ou le silence visé (en rose au survol).
- **Notes superposées** : une note posée à l'intérieur d'une autre (une noire au temps 2 sous une blanche du
  temps 1) passe d'elle-même dans une voix libre, annoncée par l'étiquette (« La4 · voix 2 »). Une note ou un
  accord sélectionné se déplace avec « ◀ plus tôt / plus tard ▶ » (Maj+←/→, par pas de sa figure, au plus un
  temps) et change de voix avec le sélecteur « voix » (V).
- **Seconde voix mal placée** : Audiveris met parfois la seconde voix d'une portée à la suite de la première
  au lieu de la superposer, et la mesure déborde d'un temps (Over The Rainbow, mesures 3, 11 et 16 du piano).
  On la recale en déplaçant ses accords et en les passant en voix 2 : chaque voix retombe sur la métrique.
- **« ✂ Ramener à 4/4 »** (par ligne, ou pour toute la mesure) : coupe ce qui dépasse la barre de mesure, quand
  le contenu en trop est vraiment de trop.
- **Paroles** : un champ sous chaque note ; un trait d'union final (« Là- ») lie la syllabe à la suivante. Tous
  les couplets s'affichent ensemble, une rangée numérotée par couplet. « + couplet » ouvre une rangée vide ;
  « n ✕ » supprime le couplet n dans toute la partition (annulable), les suivants remontant d'un cran : sur une
  partition qui imprime deux langues, on ne garde ainsi qu'une ligne de texte.
- « Écouter la mesure », « Marquer comme vérifiée », mesure précédente / suivante (PgPréc / PgSuiv).
- Raccourcis : 1–6 pour les figures, « . » pour le point, flèches, Suppr, Échap. **Ctrl+Z / Ctrl+Y** annulent et
  rétablissent les corrections (pas les réglages d'écoute).
- L'extrait d'origine, les diagnostics et la palette restent en place ; seules les portées défilent.

**Lignes affichées.** Une ligne décochée dans le panneau d'écoute n'est plus jouée, ni affichée sur la partition,
dans l'éditeur ou dans la liste à relire (qui indique combien de points elle masque). Elle n'allonge plus non
plus les mesures : une mesure dure sa métrique, ou le contenu le plus long **des lignes cochées** s'il déborde.
Si l'on n'écoute que le chant, il reste en 4/4 même quand le piano déborde encore. En contrepartie, cocher ou
décocher une ligne peut déplacer les mesures suivantes dans le temps. L'impression applique la même règle aux
lignes imprimées.

Les diagnostics sont recalculés à chaque correction : une mesure réparée perd sa couleur aussitôt. Une note
posée ou modifiée à la main est marquée comme telle (en indigo) et **survit à une réanalyse** de sa page, de même
qu'une syllabe corrigée.

## Choix automatique de la police

Audiveris reconnaît les têtes de notes en les comparant aux gabarits d'une police, et la bonne police dépend
de la gravure (cf. « Le cas des rondes » dans la v0). Dès qu'on analyse, la première page passe seule :

1. analyse complète avec Leland, qui donne aussi la géométrie de la page (fichier `.omr` d'Audiveris) ;
2. découpe d'un **extrait** : toute la largeur, au moins **2 systèmes et 4 mesures** ;
3. analyse de l'extrait avec Leland, Bravura, FinaleJazz, Primus et MusicalSymbols ;
4. note de chaque police :
   `1,5 × mesures × lignes − mesures fausses − 0,5 × symboles perdus + notes / 1000` ;
5. la meilleure est retenue (Leland en cas d'égalité) ; si ce n'est pas Leland, la page 1 est réanalysée avec
   elle, puis les autres pages suivent avec la même police, marquée « proposée » jusqu'à validation.

Pourquoi ces choix :

- **Un seul système ne suffit pas.** Audiveris calcule ses statistiques (épaisseur des ligatures, position des
  têtes) sur toute l'image : sur un seul système d'Over The Rainbow, Leland ne trouvait aucune ronde et Primus
  gagnait à tort. Avec deux systèmes, l'extrait redonne exactement le résultat de la page entière sur ces
  mesures.
- **Chaque mesure vaut 1,5.** Une barre de mesure manquée fusionne deux mesures en une seule erreur, et l'éditeur
  ne sait pas recréer une barre : à poids 1, FinaleJazz et Leland seraient à égalité sur Fly Me.
- **Les notes ne font que départager** : une police qui invente des têtes en « trouve » davantage.
- JazzPerc n'est pas essayée : elle est la pire partout.

Résultats (extrait de 2 systèmes ; « fausses » = couples mesure-ligne au rythme faux ou vides ; « perdus » =
symboles vus par Audiveris mais absents du résultat) :

| Partition | Police | Mesures | Fausses | Perdus | Score |
|---|---|---|---|---|---|
| Over The Rainbow p1 | **Leland** = Primus = MusicalSymbols | 8 | 2 | 1 | 33,6 |
| | Bravura = FinaleJazz | 8 | 3 | 1 | 32,6 |
| Fly Me to the Moon | **FinaleJazz** | 8 | 3 | 0 | 9,0 |
| | Leland | 7 | 2 | 0 | 8,5 |
| | Bravura | 7 | 3 | 0 | 7,5 |
| Fortunio p1 | Leland = Bravura = Primus | 9 | 15 | 0 | 12,05 |

- L'extrait désigne la même police que la page entière sur **6 pages sur 7** essayées. L'exception, Fortunio p1,
  est une page reconnue en grande partie fausse : l'extrait y voit une égalité, la page préfère Bravura/Primus.
- **Temps** : −42 % par rapport à l'essai de chaque police sur la page entière (−73 % sur Fly Me), mais chaque
  lancement d'Audiveris coûte environ 5 s de démarrage, quelle que soit la taille. Compter environ 1 min 40
  pour analyser 2 pages, choix de police compris.
- La police de la page 1 n'est pas toujours la meilleure pour les suivantes (Rainbow p2 préfère Primus de deux
  mesures) : d'où la validation manuelle et le choix page par page.

## Ce qui a changé côté serveur

- **Une page = une partition.** Audiveris prenait un système en retrait pour le début d'un nouveau mouvement :
  Fortunio p1 sortait en deux fichiers, et seule l'introduction était lue. Le serveur désactive cette détection
  (`ProcessingSwitches.indentations=false`).
- **Géométrie de la page** (`GET /api/jobs/:id/layout`), lue dans le `.omr` : systèmes, portées, mesures. Elle
  sert à découper l'extrait du choix de police et à montrer l'original dans l'éditeur. Les mesures de rappel
  qu'Audiveris ajoute en fin de système (`CAUTIONARY`, non exportées) sont écartées : la k-ième mesure du
  découpage est alors la k-ième mesure du MusicXML.
- Le serveur sert aussi l'interface construite (`dist/`).

## Installation (Windows)

Prérequis : **Node.js 20+**. Audiveris embarque son propre Java.

```powershell
cd v1
npm install
npm run setup      # télécharge Audiveris + OCR dans .\tools, sauf s'ils sont déjà dans ..\v0\tools
npm run build      # construit l'interface dans .\dist
npm start          # http://localhost:8787
```

Développement : `npm start` dans un terminal, `npm run dev` dans un autre (Vite sur http://localhost:5173,
qui relaie `/api` vers le serveur). Vérifications : `npm run typecheck`, `npm test`.

Variables d'environnement : celles de la v0 (`PORT`, `HOST`, `AUDIVERIS_CMD`, `TESSDATA_PREFIX`,
`MUSIC_FONT`, `STEM_LESS_BOOST`), plus `JOBS_DIR` et `DIST_DIR`.

**Docker** : `docker build -t music-reader .` puis `docker run --rm -p 8787:8787 music-reader`. Le `Dockerfile`
(Ubuntu 24.04, paquet officiel d'Audiveris 5.11, modèles OCR standard eng/fra/ita) **n'a pas encore été testé** :
Docker n'était pas disponible sur le poste de développement. Prévoir 1 à 2 Go de mémoire.

## Organisation du code

```
server/            serveur Node sans dépendance : file d'analyse Audiveris, journal, géométrie (.omr)
src/model/         modèle interne et tout ce qui en dérive, sans interface
  types.ts           le modèle : notes en (mesure, position dans la mesure, durée), en noires
  musicxml-read.ts   MusicXML d'Audiveris → page
  assemble.ts        pages → projet ; garde les corrections manuelles lors d'une réanalyse
  check.ts           placement des mesures dans le temps, diagnostics
  musicxml-write.ts  projet → MusicXML (affichage, impression), transposition orthographiée
  project-io.ts      fichier projet v2 (et lecture des fichiers v1 de la maquette et de la v0)
  pitch.ts           hauteurs, armures, transposition
src/analysis/      envoi au serveur, agrandissement, extrait et choix de la police
src/audio/         synthèse, lecteur, export WAV
src/state/store.ts état de l'application, historique des corrections
src/ui/            les quatre étapes ; common/OsmdView affiche un MusicXML avec une couche cliquable
public/            manifeste, service worker et icônes de la PWA
```

Le **modèle interne fait foi** dès la fin de l'analyse : l'affichage, la lecture, l'impression et le fichier
projet en dérivent tous, si bien qu'une correction se propage partout d'un coup. Chaque note est placée par
rapport au début de sa mesure : une note fausse ne décale jamais le reste de la partition.

## Limites connues

- Pas de ligatures dans l'éditeur de mesure (crochets séparés) ; elles sont bien dessinées sur la partition.
- Une barre de mesure manquée ou en trop ne se corrige pas : relancer la page avec une autre police.
- Reprises, D.C. et coda ne sont pas pris en compte à l'écoute.
- Le son, l'export WAV et le partage sur mobile n'ont été vérifiés que par des tests automatiques (contexte audio
  simulé) et un essai de lecture dans Edge, pas à l'oreille sur plusieurs navigateurs.
- Le service worker ne vide son cache que si l'on change `VERSION` dans `public/sw.js`.
- Un projet rechargé n'a pas ses images : ajouter des pages repart d'un nouveau projet.
