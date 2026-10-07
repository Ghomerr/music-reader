# Composants tiers embarqués

Lect'O'Note Matic 3000 est distribué sous licence MIT (voir LICENSE.txt). L'application embarque, sans les
modifier, les composants suivants, chacun sous sa propre licence.

## Audiveris 5.11.0

Reconnaissance optique de partitions, exécutée comme un programme séparé (dossier `engine/audiveris`).

- Licence : GNU Affero General Public License v3.0 (AGPL-3.0), https://www.gnu.org/licenses/agpl-3.0.html
- Code source correspondant à la version embarquée : https://github.com/Audiveris/audiveris/tree/5.11.0
- Paquets d'origine : https://github.com/Audiveris/audiveris/releases/tag/5.11.0
- Audiveris embarque son propre environnement Java (OpenJDK, GPL-2.0 avec exception « Classpath »).

## Modèles Tesseract (tessdata)

Modèles de reconnaissance de texte `eng`, `fra` et `ita` (dossier `engine/tessdata`).

- Licence : Apache License 2.0, https://github.com/tesseract-ocr/tessdata

## Electron

Environnement de l'application de bureau (Chromium et Node.js).

- Licence : MIT, https://github.com/electron/electron ; licences de Chromium jointes par Electron (`LICENSES.chromium.html`).
