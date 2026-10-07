# Lect'O'Note Matic 3000 — Plan du projet

*(Nom de code du dépôt et du format de fichier : `music-reader`.)*

Application qui lit une partition à partir d'images, en extrait les notes et les joue par synthèse, avec réglage du tempo, transposition et choix des lignes musicales.

## 1. Décisions de cadrage

| Sujet | Décision |
|---|---|
| Lignes musicales | Une ligne = une partie jouée en même temps (mélodie, harmonie, basse…). Les systèmes successifs d'une même partie sont enchaînés automatiquement. |
| Sources | Scans ou images issues d'internet : bonne qualité, droites. Pas de manuscrit, pas de recadrage/redressement en V1. |
| Découpage | **Une image = une page de partition.** Les scans de recueils où deux pages se font face doivent être séparés **en amont, au moment du scan**. Ni détection ni découpage automatique. |
| Plusieurs pages | Une musique peut s'étendre sur plusieurs images, ordonnables par l'utilisateur. |
| Formats d'entrée | Images uniquement (PNG, JPG). **Pas de PDF en V1.** |
| Tempo | **Non analysé.** Départ à **100 BPM**, ajusté à l'oreille après la synthèse. |
| Objectif de l'analyse | Les **hauteurs** et les **durées** (blanche, noire, croche…). C'est d'elles seules que dépend la justesse de la restitution ; le reste (tempo, nuances, titres) est accessoire. |
| Visualisation | Uniquement la partition **reconstruite** à partir de l'analyse (pas d'affichage de l'image d'origine à l'étape d'écoute). |
| Sauvegarde | Pas de base de données. **Fichier projet JSON** exporté puis rechargeable à la place d'une partition. |
| Export audio | **WAV** (généré dans le navigateur). |
| Plateforme | Serveur web hébergé + **PWA** compatible mobile (installable, lecture hors ligne). |

## 2. Parcours utilisateur

1. **Importer**
   - Ajouter une ou plusieurs images (glisser-déposer, sélecteur, appareil photo sur mobile), **une page de partition par image**.
   - Miniatures numérotées : réordonner, supprimer, ajouter des pages.
   - Avertissement si une image est plus large que haute : c'est en général un scan de deux pages à séparer.
   - Ou **ouvrir un projet `.json`** → saute l'analyse, arrive directement à l'étape 3 avec les réglages restaurés.
2. **Analyser**
   - Reconnaissance page par page avec progression, puis assemblage en une seule musique.
   - Résumé : pages, lignes détectées, mesures, notes et répartition des durées, armure/tonalité, métrique.
   - Avertissement si le nombre de lignes diffère d'une page à l'autre.
   - **Signalement des mesures dont les durées ne retombent pas sur la métrique** : principal indicateur de qualité.
3. **Écouter**
   - **Lignes** : activer/désactiver, solo, instrument et volume par ligne.
   - **Tempo** : curseur, saisie, ±1/±10, réinitialiser (départ à 100 BPM, jamais lu sur la partition).
   - **Tonalité** : ± demi-ton, ± octave, affichage de la tonalité résultante.
   - **Lecture** : Play/Pause, Stop, boucle, déplacement dans la barre de progression, notes surlignées sur la partition. Réglages appliqués en direct.
   - **Exporter** : projet `.json` et audio `.wav`.

## 3. Architecture

```
PWA (React + TypeScript + Vite)
  ├─ Import multi-pages, réordonnancement
  ├─ Analyse : choix automatique de la police sur la page 1, puis pages une à une
  ├─ Conversion MusicXML → modèle interne, assemblage des pages, contrôle des durées
  ├─ Relecture et correction (notes, paroles), historique annuler / rétablir
  ├─ Affichage : modèle → MusicXML → OpenSheetMusicDisplay (écran et impression)
  ├─ Lecture : synthèse maison (Web Audio), sans échantillons
  ├─ Export JSON / import JSON, export WAV (OfflineAudioContext)
  └─ Service worker : app utilisable hors ligne (hors analyse)
          │  POST d'une page (image brute)
          ▼
Serveur Node.js (Docker, sans état, sans BDD, sans dépendance npm)
  ├─ Audiveris (OMR) → MusicXML, une page à la fois
  ├─ Lecture du journal (notes vues puis jetées) et de la géométrie de la page (.omr)
  └─ Suppression des fichiers temporaires après 2 h
```

### Briques et difficulté

| Brique | Difficulté | Approche |
|---|---|---|
| OMR (image → notes) | 🔴 Élevée — **risque principal** | Audiveris (open source, MusicXML). Alternatives : homr, oemer. |
| Assemblage multi-pages | 🟠 Moyenne | Audiveris traite un « book » multi-images. Sinon, raccord des parties par position (rang de portée). |
| Durées / rythme | 🟠 Moyenne — **critère de réussite** | Lues dans le MusicXML (`duration` ÷ `divisions`). Contrôle automatique : la somme des durées de chaque mesure doit retomber sur la métrique. |
| Séparation des lignes | 🟢 Faible | Native dans MusicXML (parties / portées). |
| Transposition | 🟢 Faible | Décalage MIDI en demi-tons à la lecture. |
| Tempo | 🟢 Faible | Curseur partant de 100 BPM. Aucune lecture sur la partition. |
| Synthèse / lecture | 🟢 Faible | Tone.js + échantillons. |
| Export JSON / WAV | 🟢 Faible | Entièrement côté navigateur. |
| PWA hors ligne | 🟢 Faible | Manifest + service worker. |

### Contraintes d'hébergement
- Audiveris (Java) : prévoir **1–2 Go de RAM**. Petit VPS, Fly.io ou Render conviennent.
- Analyse : ~10–30 s par page → traitement asynchrone (job + interrogation périodique du statut) et progression par page.
- Une image = une page : pas de découpage à faire côté serveur.
- Serveur volatile : aucune donnée conservée ; tout ce qui doit durer passe par le fichier projet.

## 4. Fichier projet (JSON)

Contient la musique analysée, les corrections et les réglages, sans les images ni le MusicXML.

**Version 2 (v1 de l'application).** C'est le modèle interne tel quel (`v1/src/model/types.ts`) :
`{ format, version: 2, title, createdAt, pages[], measures[], lines[], settings, review: { lost[], checked[] } }`.

- Chaque note est rattachée à sa mesure : `{ "measure": 3, "offset": 1.5, "duration": 0.5, "pitch": "Eb4", "voice": 1 }`,
  plus `tie`, `lyrics` et `manual` s'ils servent. Un silence s'écrit `"pitch": null`. Placer les notes dans leur
  mesure plutôt qu'en temps absolu fait qu'une mesure fausse ne décale pas toute la suite.
- `measures[]` garde la page d'origine, le numéro imprimé sur l'original, la métrique et l'armure de chaque mesure.
- `manual: true` marque une note ou une syllabe corrigée à la main ; `review.checked` liste les mesures validées.
- Une note par ligne de fichier : le projet reste lisible et se compare bien d'une version à l'autre.
- Les fichiers de la version 1 ci-dessous (maquette, v0) se rechargent toujours.

**Version 1 (maquette, v0).** Quelques Ko.

```json
{
  "format": "music-reader",
  "version": 1,
  "title": "Ode à la joie",
  "createdAt": "2026-10-02T10:00:00Z",
  "score": {
    "pages": 2,
    "timeSignature": [4, 4],
    "key": "C"
  },
  "settings": { "tempo": 110, "transpose": 2, "loop": false },
  "parts": [
    {
      "name": "Voix 1",
      "clef": "treble",
      "enabled": true,
      "instrument": "piano",
      "volume": 0.9,
      "notes": [ { "pitch": "E4", "start": 0, "duration": 1 } ]
    }
  ]
}
```

- `start` et `duration` en temps (noires) ; `pitch` en notation scientifique (silences implicites). Ces deux champs sont le cœur du format : tout le reste est du confort.
- Pas de tempo détecté dans le fichier : `settings.tempo` vaut 100 tant que l'utilisateur ne l'a pas changé.
- `version` permet de faire évoluer le format sans casser les anciens fichiers.
- Validation au chargement ; message clair si le fichier est invalide ou d'une version inconnue.

## 5. Export audio

- Rendu hors ligne dans le navigateur (`OfflineAudioContext`) avec les réglages courants : tempo, transposition, lignes actives, instruments, volumes.
- Encodage WAV 16 bits mono 44,1 kHz (~5 Mo/min).
- Mobile : partage via `navigator.share` (fichiers) quand disponible, téléchargement classique sinon (iOS gère mal les téléchargements en PWA).

## 6. Étapes

| # | Étape | Contenu | Estimation |
|---|---|---|---|
| 0 | Maquette v2 | Multi-pages, ouverture/export JSON, export WAV (analyse toujours simulée). Validation du parcours. | ~0,5 j |
| 1 | Test de l'OMR | Audiveris sur une dizaine de vraies partitions, dont multi-pages. Mesure de la qualité avant d'aller plus loin. | 1–2 j |
| 2 | Serveur | API d'upload multi-pages, jobs asynchrones, Audiveris, assemblage, conversion MusicXML → JSON, Dockerfile. | 3–4 j |
| 3 | Front PWA | Import, analyse, affichage, lecture, réglages. | 4–5 j |
| 4 | Sauvegarde | Export/import JSON, export WAV, partage mobile. | 1–2 j |
| 5 | Finitions | PWA hors ligne, déploiement, gestion des erreurs. | 1–2 j |

### État d'avancement

- **Étape 0** : maquette v2 dans [maquette/](maquette/index.html).
- **Étape 1** : banc de test OMR disponible dans [v0/](v0/README.md) (serveur Node sans dépendance + Audiveris 5.11 extrait localement). Premiers enseignements :
  - ~6–10 s par page sur un poste de développement ;
  - les images du web sont souvent sous l'interligne minimal d'Audiveris → **agrandissement automatique indispensable** (intégré à la v0) ;
  - l'OCR (titres) exige les modèles Tesseract « standard », pas « fast » ;
  - des erreurs réelles apparaissent (ex. clé de fa lue en clé de sol) : la correction manuelle (V2) prendra de la valeur ;
  - **un scan contenant deux pages côte à côte est inexploitable** : sur « Over The Rainbow » (3508×2480, deux pages en vis-à-vis), Audiveris a reconstruit 17 systèmes dont neuf à une seule portée au lieu de 8 systèmes de 3 portées, inventé une troisième partie et produit des mesures vides. Les deux moitiés analysées séparément donnent 4 systèmes de 3 portées chacune, 2 parties, 17 + 15 mesures conformes à la partition ;
  - **même bien découpée, une page garde des durées fausses** : sur ces deux moitiés, 5 mesures sur 17 et 5 sur 15 ne totalisent pas 4 temps (mesures à 5 temps dans le piano, et une mesure où la partie de chant est totalement vide). D'où le **contrôle automatique des durées** ajouté à la v0 : c'est lui qui dit si une page est utilisable, pas l'œil sur la partition reconstruite.
- **Décision** : le serveur sera en **Node.js** (et non FastAPI) — une seule stack JS, la lecture du MusicXML est déjà faite côté JS dans la v0.
- **Décision** : **une image = une page**, le découpage se fait au scan. Détecter la gouttière automatiquement coûterait plus cher que le problème qu'il résout.
- **Décision** : **le tempo n'est pas analysé** — 100 BPM au départ, réglés à l'oreille. L'effort porte sur les hauteurs et les durées.
- **Les rondes étaient toutes perdues, et la police de référence en était la cause.** Audiveris compare les têtes de notes aux gabarits d'une police ; celle qu'il utilise par défaut (Bravura) ne convenait à aucune des deux partitions testées — zéro ronde reconnue de part et d'autre, sans le moindre avertissement. `Leland` en retrouve 15 sur la gravure classique **et** fait tomber les mesures fausses de 5 à 3 ; `FinaleJazz`, sur la grille calligraphiée, retrouve en plus les barres de mesure (42 mesures détectées au lieu de 31, pour 44 réelles). **Aucune police ne gagne partout. Décision** : `Leland` par défaut, et le choix de la police se fait **page par page** dans l'interface.
- Ce que cet épisode apprend sur la suite : une figure entière peut disparaître sans qu'Audiveris signale quoi que ce soit, et seul le contrôle des durées l'a révélé. La **correction manuelle** (§7) n'est donc pas un confort, c'est le filet de sécurité du projet.
- **Les notes qui manquent encore ont trois causes distinctes**, établies note par note dans le modèle interne d'Audiveris (fichier `.omr`) sur « Over The Rainbow » :
  - *note vue puis jetée* — page 1, mesure 3 : la noire bémolisée de la main droite est détectée (tête, hampe, accord), mais l'étape qui place les notes dans le temps n'y arrive pas, et une note sans position n'est pas exportée. Le journal le dit (`No timeOffset for HeadChordInter … slot#4`). Même motif, même échec aux mesures 11 et 16 ;
  - *symbole manqué* — page 2, mesure 18 : sept croches sur huit ont leur crochet, la septième non ; elle devient une noire. Sa hampe et son crochet démarrent pile sur une ligne de portée, que l'outil efface avant de chercher les symboles. Rien dans le journal ;
  - *image dégradée* — page 3, mesure 38 : la hampe de la dernière croche est presque effacée sur la photocopie. Sans hampe, une tête noire n'existe pas : elle est écartée et il ne reste rien. Rien dans le journal non plus.
- **Analyser les pages comme un seul livre** permet à Audiveris de reprendre la métrique de la page 1 sur les suivantes (`Time value reused from sheet#1`) ; seul, page par page, il ne peut contrôler aucun rythme sur les pages de suite. Mais quand il ne sait pas placer une note, il la **supprime** et la mesure retombe juste : notre contrôle des durées ne voit alors plus rien. Ce mode n'a de sens que couplé à la lecture du journal.
- Assombrir l'image avant l'analyse a été essayé : aucune note retrouvée, et un peu plus de mesures fausses. Piste écartée.
- **Décision** : la v0 lit le journal d'Audiveris et signale les notes qu'il a jetées ; le mode « livre unique » est écarté ; corriger nous-mêmes Audiveris est mis de côté tant que les erreurs restent assez rares pour être reprises à la main.
- **Étapes 2 à 5 : v1** dans [v1/](v1/README.md). Elle reprend tout le parcours du §2 et intègre dès maintenant quatre pistes prévues pour la V2 : correction manuelle des notes et des paroles, réimpression de la partition, choix des paroles à l'impression, et la fiabilisation sans toucher à Audiveris (journal, choix automatique de la police). Vérifiée de bout en bout dans Edge sur Over The Rainbow (2 pages) : analyse et choix de la police, correction, écoute, aperçu et PDF, export et rechargement du projet. 116 tests automatiques.
- **Décision** : le **modèle interne fait foi** dès la fin de l'analyse. Le MusicXML d'Audiveris n'est lu qu'une fois ; l'affichage, l'écoute, l'impression et le fichier projet dérivent du modèle, qui est réécrit en MusicXML pour OpenSheetMusicDisplay. C'est ce qui permet à une correction de se propager partout.
- **Décision** : **police choisie automatiquement sur la première page**, à partir d'un extrait d'au moins 2 systèmes et 4 mesures analysé avec cinq polices (détail et chiffres dans [v1/README.md](v1/README.md#choix-automatique-de-la-police)). Un extrait d'un seul système trompe : Audiveris y calcule ses statistiques sur trop peu de matière. Avec deux systèmes, l'extrait désigne la même police que la page entière sur 6 pages sur 7, pour 42 % de temps en moins. La police retenue est proposée pour les autres pages, à valider.
- **Une page sortait parfois en deux partitions** : Audiveris prend un système en retrait pour le début d'un nouveau mouvement (Fortunio p1, dont seule l'introduction était lue). La détection est désactivée côté serveur.
- **Décision** : synthèse maison plutôt que Tone.js et des échantillons : rien à télécharger, fonctionne hors ligne, et le même moteur sert à l'export WAV.
- **À vérifier au déploiement** : le `Dockerfile` n'a pas pu être testé (Docker absent du poste) ; le son n'a été contrôlé que par des tests et une lecture dans Edge, pas à l'oreille sur plusieurs navigateurs et mobiles.
- **Hébergement gratuit écarté.** Mesuré : une page analysée demande 480 à 510 Mo avec la mémoire de Java plafonnée (713 Mo avec les réglages d'origine du lanceur d'Audiveris), plus ~60 Mo pour le serveur. L'offre gratuite de Render (512 Mo) ne suffit pas ; Hugging Face exige désormais un abonnement pour les applications Docker, Fly.io n'a plus d'offre gratuite. Restaient Google Cloud Run et une petite VM Oracle (carte bancaire, administration).
- **Décision : application de bureau Electron**, sans installation, pour Windows, Mac (Apple Silicon et Intel) et Linux, avec Audiveris et les modèles OCR embarqués (détails dans [v1/README.md](v1/README.md#application-de-bureau-windows-mac-linux)). Rien n'est écrit sur la machine hors d'un dossier temporaire effacé à la fermeture. Construite et testée par une vraie analyse sur chaque système en intégration continue (GitHub Actions) ; publiée sur la page Releases du dépôt. Vérifiée à la main sous Windows (archive portable, installateur, interface) ; le Mac et Linux ne le sont que par l'intégration continue.

## 7. Hors V1 (pistes V2)

- Import PDF.
- Découpage automatique des scans contenant deux pages en vis-à-vis.
- Lecture automatique du tempo (indication métronomique, ou en toutes lettres via OCR).
- Export MIDI / MP3.
- Recadrage/redressement des photos.
- Corriger une barre de mesure manquée ou en trop (aujourd'hui : relancer la page avec une autre police).
- Corriger Audiveris lui-même, si les erreurs se révèlent trop fréquentes — voir « Fiabiliser la reconnaissance ».

**Avancé en V1** (voir [v1/README.md](v1/README.md)) : la correction manuelle des notes et des paroles, la
réimpression de la partition et la fiabilisation sans toucher à Audiveris. Les sections ci-dessous restent la
référence de ce qui était attendu.

### Correction manuelle des notes

Quand la reconnaissance se trompe sur une ou deux notes seulement, relancer l'analyse ne sert à rien : il faut pouvoir corriger à la main. Deux gestes suffisent :

1. **Placer la note** — cliquer sur la portée reconstruite à l'endroit voulu. La hauteur se déduit de la ligne ou de l'interligne visé, aimantée au degré le plus proche, et s'affiche pendant le geste pour confirmation.
2. **Choisir la figure** — une palette de durées montrées en **symboles** (ronde, blanche, noire, croche, double, plus le point) plutôt que nommées.

Les mêmes gestes servent à **modifier** une note mal lue (déplacer sa tête, changer sa figure) et à en **supprimer** une de trop.

Deux raccords avec le reste du projet :

- Le contrôle des durées de la V1 **désigne déjà les mesures à reprendre** : la correction s'applique en priorité là où il signale un total faux ou une mesure vide. L'un ne vaut pas grand-chose sans l'autre.
- Une note posée à la main est **marquée comme telle** et conservée dans le fichier projet, pour qu'une réanalyse de la page ne l'efface pas en silence.

### Correction manuelle des paroles

L'OCR des paroles est le maillon le plus fragile de la chaîne : sur les essais, les syllabes ressortent souvent déformées (« Là - haut » lu « Lia - hunt »). Elles doivent donc être **éditables**, syllabe par syllabe, sous la note à laquelle elles sont rattachées. Comme pour les notes, une syllabe corrigée à la main est conservée dans le fichier projet et survit à une réanalyse.

Les paroles n'entrent pas dans la synthèse : leur qualité n'empêche jamais d'écouter. Elles ne comptent que pour la relecture et pour l'impression.

### Réimprimer la partition

Une fois la partition relue, corrigée et réglée, on doit pouvoir **la ressortir propre** — pour la jouer, l'archiver ou la donner. L'impression (ou l'export PDF) reprend l'état courant du projet :

- **les seules lignes sélectionnées** — n'extraire que la partie de voix, par exemple ;
- **la tonalité choisie**, transposition appliquée aux notes *et* à l'armure ;
- **les corrections manuelles**, de notes comme de paroles ;
- **les paroles au choix**, avec ou sans.

Un point à ne pas oublier : l'impression se fait **sans les couleurs de diagnostic** (orange et rouge). Elles servent à la relecture, pas à la partition finale — et une partition où subsistent des mesures douteuses doit malgré tout pouvoir s'imprimer proprement.

### Fiabiliser la reconnaissance

Les trois causes relevées à l'étape 1 ne se traitent pas de la même façon :

| Cause | Visible où ? | Ce qu'on peut faire |
|---|---|---|
| Note vue puis jetée par Audiveris | Journal d'Audiveris (`No timeOffset`) | Lire le journal et signaler la mesure, même quand son total tombe juste (fait dans la v0). Correction manuelle. |
| Symbole manqué (crochet, point…) | Contrôle des durées, si la métrique est connue | Correction manuelle. Signaler le cas en amont. |
| Image dégradée | Contrôle des durées | Scanner l'original plutôt qu'une photocopie, en niveaux de gris, 300 à 400 dpi. Correction manuelle. |

Où on en est :

1. **Lire le journal d'Audiveris** — *fait dans la v0.* Le serveur relève les symboles qu'Audiveris a vus sans savoir les placer dans le temps, et la page les rattache à leur mesure et à leur ligne musicale, en orange sur la partition. Limite : Audiveris ne vérifie le rythme que s'il connaît la métrique, donc son journal reste muet sur les pages de suite qui ne la réimpriment pas. Notre contrôle des durées, qui reprend la métrique de la page 1, couvre ces pages-là.
2. **Analyser toutes les pages comme un seul livre** — *écarté.* La métrique se propage bien, mais Audiveris supprime alors les notes qu'il ne sait pas placer : sur l'essai, la détection n'y gagne rien et une note de plus disparaît.
3. **Choisir la police de référence automatiquement** — *fait dans la v1.* La première page est essayée avec cinq polices sur un extrait de deux systèmes ; la meilleure est proposée pour toutes les pages, à valider.
4. **Partir d'une meilleure image** — *pas d'original disponible* pour les partitions actuelles, qui sont des photocopies de photocopies. Les erreurs restantes étant peu nombreuses, la correction manuelle s'en chargera.
5. **Corriger les bibliothèques** — *mis de côté pour l'instant, à reconsidérer si les erreurs se révèlent trop fréquentes à l'usage.* Pour mémoire :
   - **Audiveris** (Java, licence **AGPL-3.0**) : c'est lui qui produit les trois erreurs ci-dessus. On peut le forker et le corriger. Attention à la licence : un Audiveris modifié servi à travers le site oblige à **publier le code source de la version modifiée** à ses utilisateurs. Appeler Audiveris en ligne de commande, comme programme séparé, est généralement considéré comme ne pas étendre l'AGPL au code de notre serveur — à faire confirmer avant la mise en ligne. Coût réel : un gros code Java à prendre en main, et un fork à maintenir à chaque nouvelle version.
   - **OpenSheetMusicDisplay** (TypeScript, licence BSD-3, très permissive) : il ne fait qu'afficher, il n'est pour rien dans les erreurs de reconnaissance. Le forker n'aurait d'intérêt que pour l'affichage (couleurs, saisie des corrections).
   - Avant d'en arriver là, il faudrait d'abord remonter les cas aux mainteneurs d'Audiveris : le projet est actif, et on dispose de cas reproductibles et précis (image, mesure, identifiant de l'objet, étape en cause).

La correction manuelle reste nécessaire quoi qu'il arrive : aucune de ces pistes ne rattrapera une hampe effacée sur une photocopie.

## 8. Risques

| Risque | Mitigation |
|---|---|
| Qualité OMR insuffisante sur certaines partitions | Étape 1 de test avant développement ; alternatives (homr, oemer) ; correction manuelle en V2. |
| Rythme faux alors que les hauteurs sont bonnes | Contrôle automatique des durées mesure par mesure, affiché dès l'analyse : l'utilisateur sait quelles mesures se méfier. |
| Image contenant deux pages | Avertissement à l'import quand l'image est plus large que haute. |
| Note jetée par Audiveris sans trace dans le résultat | Lecture du journal d'Audiveris en plus du contrôle des durées (§7, « Fiabiliser la reconnaissance »). |
| Lignes incohérentes entre pages | Raccord par position + avertissement à l'utilisateur. |
| Temps d'analyse / mémoire serveur | Jobs asynchrones, une analyse à la fois, dimensionnement 2 Go. |
| Téléchargement de fichiers sur iOS en PWA | Web Share API en priorité. |
