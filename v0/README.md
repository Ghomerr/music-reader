# Music Reader — v0 (banc de test OMR)

Page simple pour vérifier, sur de vraies partitions, si la reconnaissance d'Audiveris est assez bonne avant de construire l'application (voir [PLAN.md](../PLAN.md), étape 1).

## Ce que fait la v0

- Envoi d'**une ou plusieurs pages** (PNG/JPG), dans l'ordre choisi.
- Analyse de chaque page par **Audiveris 5.11** en ligne de commande, l'une après l'autre.
- Si l'image est en trop basse résolution (interligne trop petit), **agrandissement automatique** puis nouvel essai. On peut aussi forcer ×1,5 / ×2 / ×3 et relancer une page.
- **Comparaison côte à côte** : image d'origine / partition reconstruite (MusicXML affiché avec OpenSheetMusicDisplay), journal Audiveris, téléchargement du MusicXML.
- **Verdict par page** (bon / erreurs mineures / inutilisable + commentaire) et **bilan** en tableau Markdown à copier.
- **Écoute** de la musique assemblée : choix des lignes (par portée, ou par voix), tempo lu ou 100 par défaut, transposition, lecture.
- **Export JSON** au format du plan (rechargeable dans la maquette).

Hors périmètre : reprises / D.C. / coda, nuances, PDF, interface mobile soignée.

## Installation (Windows)

Prérequis : **Node.js 20+**. Pas besoin de Java ni de Python : Audiveris embarque son propre Java.

```powershell
cd v0
npm run setup      # télécharge Audiveris + OCR dans .\tools, et 2 exemples dans .\samples
npm start          # http://localhost:8787
```

`setup.ps1` extrait le MSI d'Audiveris dans `tools\` sans l'installer sur le système : supprimer le dossier suffit pour tout retirer.

Variables d'environnement facultatives :

| Variable | Rôle | Défaut |
|---|---|---|
| `PORT` | port HTTP | `8787` |
| `HOST` | interface d'écoute (`0.0.0.0` pour tester depuis un téléphone du réseau local) | `127.0.0.1` |
| `AUDIVERIS_CMD` | chemin d'un Audiveris déjà installé (Windows, Linux…) | `tools\audiveris\…` |
| `TESSDATA_PREFIX` | dossier des modèles OCR | `tools\tessdata` |

## Fonctionnement

```
Navigateur (public/index.html)
  ├─ agrandit l'image si besoin (canvas), POST /api/jobs?name=…  (corps = image brute)
  ├─ interroge GET /api/jobs/:id chaque seconde (statut, journal, interligne)
  ├─ récupère le MusicXML (GET /api/jobs/:id/files/…), l'affiche (OSMD) et le lit (DOMParser)
  └─ assemble les pages : lignes raccordées par position (partie + portée [+ voix])

server.mjs (Node, sans dépendance)
  ├─ file d'attente : une analyse à la fois
  ├─ Audiveris -batch -export -output jobs/<id>/out -- image
  ├─ décompresse le .mxl → MusicXML
  └─ supprime les jobs de plus de 2 h (rien n'est conservé)
```

## Premiers constats

| Partition | Résultat |
|---|---|
| Yankee Doodle (piano 2 portées, 1075×239) | Analysée en ~6 s. Mesures et rythme cohérents à première vue, mais **clé de fa de la basse lue comme une clé de sol** : la basse sonne à la mauvaise hauteur. |
| Bach BWV 1052, adagio (1820×232) | Rejetée telle quelle (interligne 10 px). **Agrandie ×2 automatiquement** : analysée en ~9 s, 7 mesures, armure à 2 bémols correcte. |

Les images trouvées sur internet sont souvent en basse résolution : l'agrandissement automatique est indispensable.
