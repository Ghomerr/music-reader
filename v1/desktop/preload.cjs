// Pont entre l'interface (page web, isolée) et l'application de bureau : seulement ce dont le bandeau de mise à
// jour a besoin. CommonJS : un preload en bac à sable ne peut pas être un module ES.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lectonote', {
  desktop: true,
  getUpdate: () => ipcRenderer.invoke('update:get'),
  onUpdate: cb => {
    const listener = (_event, state) => cb(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },
  downloadUpdate: () => ipcRenderer.send('update:download'),
  installUpdate: () => ipcRenderer.send('update:install'),
  openDownloadPage: () => ipcRenderer.send('update:open'),
  openChangelog: () => ipcRenderer.send('update:notes'),
});
