// Types de omr.mjs (pour les tests TypeScript du front, qui l'importent directement).
import type { PageLayout } from '../src/model/types';

export function unzip(buf: Uint8Array, keep?: (name: string) => boolean): Map<string, Uint8Array>;
export function readScore(file: string): string;
export function readLayout(omrFile: string): PageLayout;
