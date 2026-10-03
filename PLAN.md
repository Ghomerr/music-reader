# Music Reader — Plan du projet

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
  ├─ Affichage partition reconstruite (OpenSheetMusicDisplay ou rendu maison)
  ├─ Lecture : Tone.js + échantillons d'instruments
  ├─ Export JSON / import JSON, export WAV (OfflineAudioContext)
  └─ Service worker : app utilisable hors ligne (hors analyse)
          │  POST des pages (ordonnées)
          ▼
Serveur Node.js (Docker, sans état, sans BDD)
  ├─ Audiveris (OMR) → MusicXML (un seul livre multi-pages)
  ├─ Conversion MusicXML → modèle JSON
  └─ Suppression des fichiers temporaires après traitement
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

Contient la musique analysée et les réglages, sans les images ni le MusicXML. Quelques Ko.

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

## 7. Hors V1 (pistes V2)

- Import PDF.
- Découpage automatique des scans contenant deux pages en vis-à-vis.
- Lecture automatique du tempo (indication métronomique, ou en toutes lettres via OCR).
- Export MIDI / MP3.
- **Correction manuelle des notes** — voir ci-dessous.
- **Correction manuelle des paroles** — voir ci-dessous.
- **Réimpression de la partition** — voir ci-dessous.
- Recadrage/redressement des photos.

### Correction manuelle des notes

Quand la reconnaissance se trompe sur une ou deux notes seulement, relancer l'analyse ne sert à rien : il faut pouvoir corriger à la main. Deux gestes suffisent :

1. **Placer la note** — cliquer sur la portée reconstruite à l'endroit voulu. La hauteur se déduit de la ligne ou de l'interligne visé, aimantée au degré le plus proche, et s'affiche pendant le geste pour confirmation.
2. **Choisir la figure** — une palette de durées montrées en **symboles** (ronde, blanche, noire, croche, double, plus le point) plutôt que nommées.

Les mêmes gestes servent à **modifier** une note mal lue (déplacer sa tête, changer sa figure) et à en **supprimer** une de trop.

Deux raccords avec le reste du projet :

- Le contrôle des durées de la V1 **désigne déjà les mesures à reprendre** : la correction s'applique en priorité là où il signale un total faux ou une mesure vide. L'un ne vaut pas grand-chose sans l'autre.
- Une note posée à la main est **marquée comme telle** et conservée dans le fichier projet, pour qu'une réanalyse de la page ne l'efface pas en silence.

### Correction manuelle des paroles

L'OCR des paroles est le maillon le plus fragile de la chaîne : sur les essais, les syllabes ressortent souvent déformées (« Là - haut » lu « Lia - hunt »). Elles doivent donc être **éditables**, syllabe par syllabe, sous la note à laquelle elles sont rattachées. Comme pour les notes, une paroles corrigée à la main est conservée dans le fichier projet et survit à une réanalyse.

Les paroles n'entrent pas dans la synthèse : leur qualité n'empêche jamais d'écouter. Elles ne comptent que pour la relecture et pour l'impression.

### Réimprimer la partition

Une fois la partition relue, corrigée et réglée, on doit pouvoir **la ressortir propre** — pour la jouer, l'archiver ou la donner. L'impression (ou l'export PDF) reprend l'état courant du projet :

- **les seules lignes sélectionnées** — n'extraire que la partie de voix, par exemple ;
- **la tonalité choisie**, transposition appliquée aux notes *et* à l'armure ;
- **les corrections manuelles**, de notes comme de paroles ;
- **les paroles au choix**, avec ou sans.

Un point à ne pas oublier : l'impression se fait **sans les couleurs de diagnostic** (orange et rouge). Elles servent à la relecture, pas à la partition finale — et une partition où subsistent des mesures douteuses doit malgré tout pouvoir s'imprimer proprement.

## 8. Risques

| Risque | Mitigation |
|---|---|
| Qualité OMR insuffisante sur certaines partitions | Étape 1 de test avant développement ; alternatives (homr, oemer) ; correction manuelle en V2. |
| Rythme faux alors que les hauteurs sont bonnes | Contrôle automatique des durées mesure par mesure, affiché dès l'analyse : l'utilisateur sait quelles mesures se méfier. |
| Image contenant deux pages | Avertissement à l'import quand l'image est plus large que haute. |
| Lignes incohérentes entre pages | Raccord par position + avertissement à l'utilisateur. |
| Temps d'analyse / mémoire serveur | Jobs asynchrones, une analyse à la fois, dimensionnement 2 Go. |
| Téléchargement de fichiers sur iOS en PWA | Web Share API en priorité. |
