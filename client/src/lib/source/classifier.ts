
import {
  SOURCE_TYPES, UI_SOURCES,
  SYSTEM_PROVIDERS, RSS_PROVIDERS, SAVED_PROVIDERS,
  type DocumentLite, type Origin, type UISource
} from './types';

// Export UI_SOURCES as array for iteration
export const UI_SOURCES_ARRAY: UISource[] = Object.values(UI_SOURCES);

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();

const isUploaded = (d: DocumentLite) =>
  !!d.fileId || !!d.uploadId || d.source === 'Upload';

const isSystem = (d: DocumentLite) =>
  d.sourceType === 'system' ||
  SYSTEM_PROVIDERS.has(norm(d.sourceProvider ?? d.source));

const isRSS = (d: DocumentLite) =>
  d.feedId != null ||
  d.sourceType === 'rss' ||
  RSS_PROVIDERS.has(norm(d.sourceProvider ?? d.source));

/** Internal origin classification: uploaded > system > rss > saved */
export function classifyOrigin(doc: DocumentLite): Origin {
  // Check uploads first (fileId, uploadId, or Upload source)
  if (isUploaded(doc)) return SOURCE_TYPES.UPLOADED;
  
  // Check RSS feeds (feedId or known RSS providers)  
  if (isRSS(doc)) return SOURCE_TYPES.RSS;
  
  // Check system sources (known system providers)
  if (isSystem(doc)) return SOURCE_TYPES.SYSTEM;
  
  // Everything else is saved
  return SOURCE_TYPES.SAVED;
}

/** UI display mapping (system → saved absorption) */
export function toUISource(origin: Origin): UISource {
  return origin === SOURCE_TYPES.SYSTEM ? UI_SOURCES.SAVED : (origin as UISource);
}

/** Check if document matches selected source filters */
export function matchesSource(doc: DocumentLite, activeSources: UISource[]): boolean {
  if (activeSources.length === 0) return true; // Empty means 'all'
  const ui = toUISource(classifyOrigin(doc));
  return activeSources.includes(ui);
}

/** Count documents by UI source type */
export function countBySource(docs: DocumentLite[]): Record<UISource, number> {
  const acc = { uploaded: 0, rss: 0, saved: 0 } as Record<UISource, number>;
  for (const d of docs) {
    const ui = toUISource(classifyOrigin(d));
    acc[ui]++;
  }
  return acc;
}
