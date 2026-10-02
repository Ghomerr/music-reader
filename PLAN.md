# Music Reader — Plan du projet

Application qui lit une partition à partir d'images, en extrait les notes et les joue par synthèse, avec réglage du tempo, transposition et choix des lignes musicales.

## 1. Décisions de cadrage

| Sujet | Décision |
|---|---|
| Lignes musicales | Une ligne = une partie jouée en même temps (mélodie, harmonie, basse…). Les systèmes successifs d'une même partie sont enchaînés automatiquement. |
| Sources | Scans ou images issues d'internet : bonne qualité, droites. Pas de manuscrit, pas de recadrage/redressement en V1. |
| Plusieurs pages | Une musique peut s'étendre sur plusieurs images, ordonnables par l'utilisateur. |
| Formats d'entrée | Images uniquement (PNG, JPG). **Pas de PDF en V1.** |
| Tempo | Lu sur la partition si indiqué, sinon **100 BPM** par défaut. Toujours modifiable. |
| Visualisation | Uniquement la partition **reconstruite** à partir de l'analyse (pas d'affichage de l'image d'origine à l'étape d'écoute). |
| Sauvegarde | Pas de base de données. **Fichier projet JSON** exporté puis rechargeable à la place d'une partition. |
| Export audio | **WAV** (généré dans le navigateur). |
| Plateforme | Serveur web hébergé + **PWA** compatible mobile (installable, lecture hors ligne). |

## 2. Parcours utilisateur

1. **Importer**
   - Ajouter une ou plusieurs images (glisser-déposer, sélecteur, appareil photo sur mobile).
   - Miniatures numérotées : réordonner, supprimer, ajouter des pages.
   - Ou **ouvrir un projet `.json`** → saute l'analyse, arrive directement à l'étape 3 avec les réglages restaurés.
2. **Analyser**
   - Reconnaissance page par page avec progression, puis assemblage en une seule musique.
   - Résumé : pages, lignes détectées, mesures, armure/tonalité, mesure, tempo (lu ou défaut).
   - Avertissement si le nombre de lignes diffère d'une page à l'autre.
3. **Écouter**
   - **Lignes** : activer/désactiver, solo, instrument et volume par ligne.
   - **Tempo** : curseur, saisie, ±1/±10, réinitialiser.
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
Serveur Python FastAPI (Docker, sans état, sans BDD)
  ├─ Audiveris (OMR) → MusicXML (un seul livre multi-pages)
  ├─ Conversion MusicXML → modèle JSON (music21)
  └─ Suppression des fichiers temporaires après traitement
```

### Briques et difficulté

| Brique | Difficulté | Approche |
|---|---|---|
| OMR (image → notes) | 🔴 Élevée — **risque principal** | Audiveris (open source, MusicXML). Alternatives : homr, oemer. |
| Assemblage multi-pages | 🟠 Moyenne | Audiveris traite un « book » multi-images. Sinon, raccord des parties par position (rang de portée). |
| Lecture du tempo | 🟠 Moyenne | Indication métronomique via Audiveris ; mots (Allegro, Andante…) → table de correspondance ; sinon 100 BPM. |
| Séparation des lignes | 🟢 Faible | Native dans MusicXML (parties / portées). |
| Transposition | 🟢 Faible | Décalage MIDI en demi-tons à la lecture. |
| Synthèse / lecture | 🟢 Faible | Tone.js + échantillons. |
| Export JSON / WAV | 🟢 Faible | Entièrement côté navigateur. |
| PWA hors ligne | 🟢 Faible | Manifest + service worker. |

### Contraintes d'hébergement
- Audiveris (Java) : prévoir **1–2 Go de RAM**. Petit VPS, Fly.io ou Render conviennent.
- Analyse : ~10–30 s par page → traitement asynchrone (job + interrogation périodique du statut) et progression par page.
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
    "key": "C",
    "detectedTempo": 96
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

- `start` et `duration` en temps (noires) ; `pitch` en notation scientifique (silences implicites).
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
| 5 | Finitions | PWA hors ligne, déploiement, gestion des erreurs, tempo en toutes lettres. | 1–2 j |

## 7. Hors V1 (pistes V2)

- Import PDF.
- Export MIDI / MP3.
- Correction manuelle des notes mal reconnues.
- Affichage de la partition transposée.
- Recadrage/redressement des photos.

## 8. Risques

| Risque | Mitigation |
|---|---|
| Qualité OMR insuffisante sur certaines partitions | Étape 1 de test avant développement ; alternatives (homr, oemer) ; correction manuelle en V2. |
| Lignes incohérentes entre pages | Raccord par position + avertissement à l'utilisateur. |
| Temps d'analyse / mémoire serveur | Jobs asynchrones, une analyse à la fois, dimensionnement 2 Go. |
| Téléchargement de fichiers sur iOS en PWA | Web Share API en priorité. |
