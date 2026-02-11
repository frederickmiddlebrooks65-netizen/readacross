
// Source classification types and constants for SSOT implementation
export const SOURCE_TYPES = {
  UPLOADED: 'uploaded',
  SYSTEM: 'system',
  RSS: 'rss',
  SAVED: 'saved',
} as const;

export type Origin = typeof SOURCE_TYPES[keyof typeof SOURCE_TYPES];

export const UI_SOURCES = {
  UPLOADED: 'uploaded',
  RSS: 'rss',
  SAVED: 'saved',
} as const;

export type UISource = typeof UI_SOURCES[keyof typeof UI_SOURCES];

// Standardized provider identifiers (lowercase)
export const SYSTEM_PROVIDERS = new Set<string>([
  'guardian',
  'npr', 
  'the guardian',
  'nature',
  'sciencedirect',
  'project gutenberg',
  'arxiv'
]);

export const RSS_PROVIDERS = new Set<string>([
  'wired',
  'hitrecord',
  'marginalian',
]);

// Policy-based saved providers (optional)
export const SAVED_PROVIDERS = new Set<string>([
  'project gutenberg',
  'arxiv',
  'gutenberg',
]);

export type DocumentLite = {
  id: number | string;
  sourceType?: 'uploaded' | 'system' | 'rss' | 'explore' | string | null;
  source?: string | null;
  sourceProvider?: string | null;
  feedId?: number | null;
  fileId?: string | null;
  uploadId?: string | null;
  isPublic?: boolean | null;
};
