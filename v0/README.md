# Music Reader — v0 (banc de test OMR)

Page simple pour vérifier, sur de vraies partitions, si la reconnaissance d'Audiveris est assez bonne avant de construire l'application (voir [PLAN.md](../PLAN.md), étape 1).

## Ce que fait la v0

- Envoi d'**une ou plusieurs pages** (PNG/JPG), dans l'ordre choisi — **une page de partition par image** (voir ci-dessous).
- Analyse de chaque page par **Audiveris 5.11** en ligne de commande, l'une après l'autre.
- Si l'image est en trop basse résolution (interligne trop petit), **agrandissement automatique** puis nouvel essai. On peut aussi forcer ×1,5 / ×2 / ×3 et relancer une page.
- **Comparaison côte à côte** : image d'origine / partition reconstruite (MusicXML affiché avec OpenSheetMusicDisplay), journal Audiveris, téléchargement du MusicXML.
- **Contrôle du rythme** : pour chaque mesure et chaque ligne musicale, les durées doivent remplir exactement la métrique, en tenant compte des voix simultanées. Les mesures fautives sont listées avec la ligne en cause et l'écart, et colorées sur la partition reconstruite : orange pour un rythme faux, rouge pour une mesure sans aucune note reconnue.
- **Notes perdues par Audiveris** : le serveur lit son journal et relève les notes qu'il a reconnues sans savoir les placer dans le temps (`No timeOffset`). Elles ne sont pas exportées, et la mesure peut alors sembler juste ; elles sont donc signalées à part, avec leur portée. Audiveris ne fait ce contrôle que s'il connaît la métrique : sur une page de suite qui ne la réimprime pas, seul notre contrôle des durées veille.
- **Répartition des durées** lues (rondes, blanches, noires, croches…), pour vérifier d'un coup d'œil que les figures sont bien reconnues.
- **Verdict par page** (bon / erreurs mineures / inutilisable + commentaire) et **bilan** en tableau Markdown à copier.
- **Écoute** de la musique assemblée : choix des lignes (par portée, ou par voix), transposition, lecture.
- **Export JSON** au format du plan (rechargeable dans la maquette).

Hors périmètre : reprises / D.C. / coda, nuances, PDF, interface mobile soignée.

## Trois partis pris

**Une image = une page.** Audiveris cherche les systèmes sur toute la largeur de l'image. Un scan de recueil
où deux pages se font face est donc mélangé : sur « Over The Rainbow » (3508×2480), il a reconstruit 17 systèmes
dont neuf à une seule portée au lieu de 8 systèmes de 3 portées, inventé une troisième partie et produit des
mesures vides. Les deux moitiés analysées séparément donnent chacune 4 systèmes de 3 portées et 2 parties.
Le découpage se fait **au scan**, pas dans l'outil ; la v0 se contente d'afficher un avertissement quand une
image est plus large que haute.

**Le tempo n'est pas analysé.** La lecture démarre toujours à 100 BPM et se règle à l'oreille. Ce qui compte
ici, c'est que les **hauteurs** et les **durées** soient justes : un tempo approximatif se corrige d'un curseur,
une croche lue comme une noire, non.

**La police de référence se choisit par page.** Audiveris reconnaît les têtes de notes en les comparant aux
gabarits d'une police, et il en embarque six. Celle qu'il utilise par défaut (Bravura) ne convenait à **aucune**
des deux partitions testées : pas une seule ronde reconnue sur l'une comme sur l'autre, sans le moindre
avertissement. `Leland` les retrouve sur une gravure classique, `FinaleJazz` sur une grille
calligraphiée — et y récupère en prime les barres de mesure. Aucune ne gagne partout : la v0 part sur
`Leland` et laisse changer de police page par page, puis relancer. Voir « Le cas des rondes ».

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
| `MUSIC_FONT` | police de référence des têtes de notes : `Leland`, `Bravura`, `FinaleJazz`, `Primus`, `MusicalSymbols`, `JazzPerc` (aussi réglable page par page dans l'interface) | `Leland` |
| `STEM_LESS_BOOST` | bonus Audiveris pour les têtes sans hampe ; sans effet si la police est la bonne, nuisible au-delà de 0,5 | vide |

## Fonctionnement

```
Navigateur (public/index.html)
  ├─ agrandit l'image si besoin (canvas), POST /api/jobs?name=…  (corps = image brute)
  ├─ interroge GET /api/jobs/:id chaque seconde (statut, journal, interligne)
  ├─ récupère le MusicXML (GET /api/jobs/:id/files/…), l'affiche (OSMD) et le lit (DOMParser)
  └─ assemble les pages : lignes raccordées par position (partie + portée [+ voix])

server.mjs (Node, sans dépendance)
  ├─ file d'attente : une analyse à la fois
  ├─ Audiveris -batch -export -output jobs/<id>/out -constant …MusicFont.defaultMusicFamily=<police> -- image
  ├─ relève dans le journal les notes reconnues mais non placées (No timeOffset)
  ├─ décompresse le .mxl → MusicXML
  └─ supprime les jobs de plus de 2 h (rien n'est conservé)
```

## Premiers constats

| Partition | Résultat |
|---|---|
| Yankee Doodle (piano 2 portées, 1075×239) | Analysée en ~6 s. Mesures et rythme cohérents à première vue, mais **clé de fa de la basse lue comme une clé de sol** : la basse sonne à la mauvaise hauteur. |
| Bach BWV 1052, adagio (1820×232) | Rejetée telle quelle (interligne 10 px). **Agrandie ×2 automatiquement** : analysée en ~9 s, 7 mesures, armure à 2 bémols correcte. |
| Over The Rainbow, scan de deux pages en vis-à-vis (3508×2480) | **Inexploitable telle quelle** : 17 systèmes au lieu de 8, une partie en trop, mesures vides. Découpée en deux : 4 systèmes de 3 portées par page, 2 parties, 17 + 15 mesures conformes. Restent **5 mesures sur 17 et 5 sur 15 dont les durées ne tombent pas juste** (mesures à 5 temps au piano, une mesure de chant vide) : structure correcte, rythme encore à surveiller. |

Les images trouvées sur internet sont souvent en basse résolution : l'agrandissement automatique est indispensable.
Et un scan de deux pages doit être coupé en deux avant d'être envoyé.

### Le cas des rondes

Mesuré sur les deux partitions. « mes. » = mesures détectées, « faux » = mesures dont les durées ne
retombent pas sur la métrique.

| | rondes | blanches | noires | croches | notes | mes. | faux |
|---|---|---|---|---|---|---|---|
| Rainbow p1 — Bravura (défaut Audiveris) | **0** | 83 | 115 | 53 | 240 | 17 | 5 |
| Rainbow p1 — Bravura + boost 0,5 | 13 | 83 | 115 | 53 | 253 | 17 | 5 |
| Rainbow p1 — Bravura + boost 2,0 | 20 | 82 | 116 | 41 | 248 | 17 | 9 |
| Rainbow p1 — **Leland** | **15** | 87 | 115 | 53 | **259** | 17 | **3** |
| Rainbow p1 — Primus | 13 | 88 | 116 | 53 | 259 | 17 | 3 |
| Fly Me — Bravura (défaut Audiveris) | **0** | 82 | 75 | 17 | 170 | 31 | 22 |
| Fly Me — Bravura + boost 0,5 | 12 | 82 | 74 | 17 | 182 | 31 | 20 |
| Fly Me — Leland | 3 | 22 | 82 | 21 | 123 | 39 | 18 |
| Fly Me — **FinaleJazz** | 6 | 17 | 86 | 20 | 125 | **42** | **17** |

Deux enseignements :

- **La police compte bien plus que les seuils.** Sur Rainbow, Leland retrouve 15 rondes *et* fait tomber les
  mesures fausses de 5 à 3, là où le bonus sans-hampe en récupérait 13 sans rien améliorer (il réparait la
  mesure 4 mais en cassait une autre). Au-delà de 0,5, le bonus relit en rondes des notes qui ont bel et bien
  une hampe : les croches passent de 53 à 41.
- **Sur une partition calligraphiée, la police corrige aussi la structure.** Avec Bravura, Fly Me donnait
  31 mesures pour 44 réelles, certaines cumulant 14 temps ; avec FinaleJazz, 42 mesures, et la première
  mesure se lit exactement juste.

Desserrer les seuils de correspondance des gabarits (`Template.maxDistanceLow/High`) **fait planter
Audiveris** à l'étape STEMS (`Comparison method violates its general contract`) : piste à écarter.
