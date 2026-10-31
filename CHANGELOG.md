# Nouveautés de Lect'O'Note Matic 3000

Les versions se téléchargent sur la page [Releases](https://github.com/Ghomerr/music-reader/releases).
Chaque section ci-dessous sert aussi de notes de version sur GitHub.

## 1.2.0 — 2026-10-31

- **Partition vierge** : commencer sans image, en choisissant la formation (chant, piano, chant et piano,
  instrument en clé de sol ou de fa), la métrique, l'armure et le nombre de mesures, puis écrire les notes dans
  l'éditeur.
- **Insérer et supprimer des mesures** depuis l'éditeur de mesure (annulable).
- **Exemple à essayer** : « Au clair de la lune », avec ses paroles et une mesure volontairement fausse à corriger.
- **Didacticiel** : une visite guidée de chaque écran (bouton 🎓 dans l'en-tête), qui met en lumière chaque élément
  et l'explique.
- **Mise à jour automatique** : un bandeau annonce les nouvelles versions, avec un lien vers ces notes. La version
  installée (installateur Windows, AppImage Linux) se met à jour d'elle-même ; la version portable et le Mac ouvrent
  la page de téléchargement.
- Le numéro de version est affiché dans l'en-tête.
- L'éditeur s'ouvre en mode Ajouter sur une mesure qui n'a encore que des silences.
- Corrigé : la désinstallation efface aussi le cache de mise à jour ; le serveur local servait mal les fichiers
  `.json` (l'exemple ne s'ouvrait pas dans l'application de bureau).

## 1.1.0 — 2026-10-17

- **Statistiques d'usage anonymes** dans l'application de bureau : lancements, analyses, projets ouverts et exportés.
  Un identifiant tiré au hasard à chaque lancement, sans géolocalisation, jamais de nom de fichier ni de contenu de
  partition. `LECTONOTE_NO_STATS=1` les désactive.

## 1.0.0 — 2026-10-07

Première version de l'application de bureau, sans installation, pour Windows, Mac (Apple Silicon et Intel) et Linux,
avec Audiveris et les modèles OCR embarqués.

- **Analyse** des pages par Audiveris, choix automatique de la police de référence sur la première page, contrôle des
  durées de chaque mesure et signalement des notes perdues.
- **Correction** mesure par mesure, à côté de l'extrait de l'image d'origine : notes, voix superposées, paroles
  couplet par couplet ; tout est annulable.
- **Écoute** : lignes, instruments, tempo, transposition ; export audio WAV.
- **Impression** d'une partition propre (A4 ou PDF) : lignes, tonalité et couplets au choix.
- **Fichier projet** `.json` pour reprendre son travail plus tard.
