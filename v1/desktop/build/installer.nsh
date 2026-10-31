; Ajouts à l'installateur Windows (NSIS), lus automatiquement par electron-builder.
; La désinstallation efface aussi le cache d'electron-updater : il y garde l'installateur de la version courante
; (environ 190 Mo, le double pendant une mise à jour) pour accélérer les mises à jour suivantes, et rien ne le
; retirerait sinon.
!macro customUnInstall
  RMDir /r "$LOCALAPPDATA\music-reader-updater"
!macroend
