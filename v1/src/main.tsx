import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);

// Application installable et utilisable hors ligne (hors analyse, qui exige le serveur). Inutile dans
// l'application de bureau, qui embarque son serveur et ne doit rien garder d'une session à l'autre.
if ('serviceWorker' in navigator && import.meta.env.PROD && !navigator.userAgent.includes('Electron')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
