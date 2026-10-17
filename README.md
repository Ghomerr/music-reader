# Lect'O'Note Matic 3000

Lecture de partitions à partir d'images : on photographie ou scanne une partition, le logiciel en reconnaît
les notes (avec [Audiveris](https://github.com/Audiveris/audiveris)), on corrige ce qui a été mal lu, on
l'écoute au tempo et dans la tonalité de son choix, puis on réimprime une partition propre.

## Télécharger

**Version 1.1.0** — page [Releases](https://github.com/Ghomerr/music-reader/releases). Application de bureau,
**sans installation** et utilisable sans connexion :

| Système | Fichier | Taille |
|---|---|---|
| Windows | `LectONote-1.1.0-windows-portable.zip` : décompresser, puis double-clic sur *Lect'O'Note Matic 3000.exe* | 240 Mo |
| Windows | `LectONote-1.1.0-windows-installation.exe` : installateur classique, au choix | 184 Mo |
| Mac Apple Silicon (M1, M2…) | `LectONote-1.1.0-mac-arm64.dmg` (ou `.zip`) | 216 Mo |
| Mac Intel | `LectONote-1.1.0-mac-x64.dmg` (ou `.zip`) | 223 Mo |
| Linux | `LectONote-1.1.0-linux-x86_64.AppImage` : le rendre exécutable, puis le lancer | 227 Mo |

Au **premier lancement**, l'application n'étant pas signée par un éditeur reconnu :
- Windows : « Windows a protégé votre ordinateur » › *Informations complémentaires* › *Exécuter quand même* ;
- Mac : clic droit sur l'application › *Ouvrir*, puis *Ouvrir* (ou Réglages Système › Confidentialité et sécurité ›
  *Ouvrir quand même*).

Rien n'est écrit sur l'ordinateur : tout ce qu'utilise une session va dans un dossier temporaire, effacé à la
fermeture. Seuls restent les fichiers que l'on exporte soi-même.

Depuis la 1.1.0, l'application envoie des **statistiques d'usage anonymes** quand une connexion est disponible
(lancement, partition analysée, projet chargé ou exporté) : ni nom de fichier, ni contenu de partition, ni
identifiant conservé d'un lancement à l'autre. Sans connexion, tout fonctionne de la même façon. Pour les couper :
lancer l'application avec la variable d'environnement `LECTONOTE_NO_STATS=1`.

## Ce qu'il sait faire

- **Importer** une ou plusieurs pages (PNG, JPG), une image par page, dans l'ordre voulu.
- **Analyser** : reconnaissance page par page, choix automatique de la police de référence d'Audiveris sur la
  première page, et contrôle de chaque mesure — celles dont les durées ne tombent pas juste sont signalées.
- **Corriger** une mesure à côté de l'extrait de l'image d'origine : poser, déplacer, changer de figure ou de voix,
  supprimer des notes ; corriger les paroles couplet par couplet. Tout s'annule (Ctrl+Z).
- **Écouter** : choix des lignes (chant, piano…), instrument et volume, tempo, transposition ; export audio WAV.
- **Imprimer** : partition propre au format A4 (ou PDF), lignes et couplets au choix, dans la tonalité choisie.
- **Enregistrer** le travail dans un fichier projet `.json`, à rouvrir plus tard.

## Documentation

- [v1/](v1/README.md) — l'application : fonctionnement détaillé, application de bureau, construction, code
- [PLAN.md](PLAN.md) — cadrage, décisions et état d'avancement
- [v0/](v0/README.md) — le banc de test de la reconnaissance qui a précédé la v1

Licence MIT (voir [LICENSE](LICENSE)). Audiveris, embarqué sans modification, est sous licence AGPL-3.0 :
voir [v1/desktop/THIRD_PARTY.md](v1/desktop/THIRD_PARTY.md).
