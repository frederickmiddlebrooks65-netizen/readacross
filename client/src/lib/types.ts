// Re-export shared types for client use
export type {
  Document,
  Paragraph,
  Sentence,
  User,
  Notebook,
  NotebookSentence,
  TranslationCache,
  TranslationAttempt,
  UpdateSentence,
  InsertNotebook,
  InsertNotebookSentence,
  InsertLibraryDocument,
  Glossary,
  WordPracticeSession
} from "@shared/schema";

import type { Document, Paragraph, Sentence, Notebook } from "@shared/schema";

// Client-specific types and enums
export type ViewMode = "ORIGINAL" | "SIDE_BY_SIDE" | "TRANSLATION" | "HOVER_TO_TRANSLATE";

export interface LibraryDocument {
  id: number;
  title: string;
  sourceLanguage: string;
  targetLanguage: string;
  createdAt: string;
  progress: number;
  fileType?: string;
  author?: string;
  source?: string;
  category?: '뉴스' | '문학' | '논문' | '에세이/오피니언' | '기타';
  difficulty?: string;
  tags?: string;
  originalUrl?: string;
  licenseType?: string;
  isPublic?: boolean;
  expiresAt?: string;
  feedId?: number; // RSS feed ID
  feedAlias?: string; // RSS feed alias for display
}

export interface PublicLibraryDocument extends LibraryDocument {
  author: string;
  source: string;
  category: '뉴스' | '문학' | '논문' | '에세이/오피니언' | '기타';
  difficulty: string;
  fileType: string;
  isPublic: true;
  expiresAt?: string;
}

export type LibraryDocumentType = LibraryDocument | PublicLibraryDocument;

export interface ParagraphWithSentences extends Paragraph {
  sentences: Sentence[];
}

export interface DocumentWithParagraphs extends Document {
  paragraphs: ParagraphWithSentences[];
}

// Practice-related types
export interface PracticeSession {
  sentenceId: number;
  userTranslation: string;
  gptTranslation: string;
  feedback?: string;
  timestamp: string;
}

export interface PracticeHistory {
  sessions: PracticeSession[];
  totalSessions: number;
  averageScore?: number;
}

// Filter and search types for My Sentences
export type SentenceFilter = "ALL" | "PRACTICED" | "SCRAPPED" | "TAGGED" | "FAVORITE";

export interface SentenceWithMetadata extends Sentence {
  documentTitle?: string;
  notebooks?: Notebook[];
  lastPracticed?: string;
}

// Notebook with sentence count
export interface NotebookWithStats extends Notebook {
  sentenceCount: number;
  lastModified: string;
}