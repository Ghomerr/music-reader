// Bandeau de mise à jour (application de bureau) : une nouvelle version est publiée sur GitHub. Lien vers le
// changelog, puis mise à jour automatique (version installée) ou page de téléchargement (version portable, Mac).
import { useEffect, useState } from 'react';
import { desktop, type UpdateState } from '../../desktop';
import './UpdateBanner.css';

export function UpdateBanner() {
  const bridge = desktop();
  const [state, setState] = useState<UpdateState>({ status: 'none' });
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    void bridge.getUpdate().then(setState).catch(() => {});
    return bridge.onUpdate(setState);
  }, [bridge]);

  if (!bridge || hidden || state.status === 'none') return null;
  const { info } = state;
  const notes = (
    <a href={info.notesUrl} onClick={e => { e.preventDefault(); bridge.openChangelog(); }}>Voir les nouveautés</a>
  );

  return (
    <div className={'update-banner' + (state.status === 'error' ? ' err' : '')} role="status">
      {state.status === 'available' && (
        <>
          <span>🎁 La version <b>{info.version}</b> est disponible.</span>
          {notes}
          <span className="spacer" />
          {info.mode === 'auto'
            ? <button className="btn sm primary" onClick={bridge.downloadUpdate}>Mettre à jour</button>
            : <button className="btn sm primary" onClick={bridge.openDownloadPage}
                      title="Ouvre la page de téléchargement : remplacez cette version par la nouvelle">Télécharger</button>}
        </>
      )}
      {state.status === 'downloading' && (
        <>
          <span><span className="spin" /> Téléchargement de la version <b>{info.version}</b>… {state.percent} %</span>
          <span className="update-bar" aria-hidden><i style={{ width: `${state.percent}%` }} /></span>
          {notes}
        </>
      )}
      {state.status === 'ready' && (
        <>
          <span>✅ La version <b>{info.version}</b> est prête.</span>
          <small className="update-warn">L'application redémarre : exportez d'abord votre projet (.json) s'il n'est pas enregistré.</small>
          <span className="spacer" />
          <button className="btn sm primary" onClick={bridge.installUpdate}>Redémarrer et installer</button>
        </>
      )}
      {state.status === 'error' && (
        <>
          <span>La mise à jour automatique a échoué : {state.message}</span>
          <span className="spacer" />
          <button className="btn sm" onClick={bridge.openDownloadPage}>Télécharger la version {info.version}</button>
        </>
      )}
      {state.status !== 'downloading' && (
        <button className="update-close" onClick={() => setHidden(true)} aria-label="Masquer" title="Masquer jusqu'au prochain lancement">✕</button>
      )}
    </div>
  );
}
