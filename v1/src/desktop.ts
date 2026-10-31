// Pont avec l'application de bureau (desktop/preload.cjs) : absent dans la version web.

export interface UpdateInfo {
  version: string;
  /** changelog du projet sur GitHub */
  notesUrl: string;
  /** page de téléchargement de la version */
  pageUrl: string;
  /** auto : l'application se met à jour elle-même ; download : on ouvre la page de téléchargement */
  mode: 'auto' | 'download';
}

export type UpdateState =
  | { status: 'none' }
  | { status: 'available'; info: UpdateInfo }
  | { status: 'downloading'; info: UpdateInfo; percent: number }
  | { status: 'ready'; info: UpdateInfo }
  | { status: 'error'; info: UpdateInfo; message: string };

export interface DesktopBridge {
  desktop: true;
  getUpdate(): Promise<UpdateState>;
  onUpdate(cb: (s: UpdateState) => void): () => void;
  downloadUpdate(): void;
  installUpdate(): void;
  openDownloadPage(): void;
  openChangelog(): void;
}

declare global {
  interface Window { lectonote?: DesktopBridge }
}

export const desktop = (): DesktopBridge | undefined => (typeof window !== 'undefined' ? window.lectonote : undefined);
