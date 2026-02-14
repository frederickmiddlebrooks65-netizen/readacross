declare module 'pdf-parse';

// ViewMode type for reading display options  
export type ViewMode = "original-only" | "translation-only" | "side-by-side";

export interface LibraryDocument {
  id: number;
  title: string;
  sourceLanguage: string;
  createdAt: string;
  progress: number;
  fileType?: string;
}

export interface Paragraph {
  id: number;
  documentId: number;
  order: number;
  title: string | null;
}

export interface Sentence {
  id: number;
  paragraphId: number;
  order: number;
  source: string;
  target: string | null;
  sourceHash?: string | null;
}

// New interfaces for user-specific data
export interface UserSentenceState {
  id: number;
  userId: number;
  sentenceId: number;
  isBookmarked: boolean;
  learningStatus: "new" | "learning" | "review" | "mastered";
  lastPracticedAt: Date | null;
}

export interface Note {
  id: number;
  userId: number;
  sentenceId: number;
  content: string;
  tags: string[] | null;
  createdAt: Date;
  updatedAt: Date;
}

// Extended sentence interface with user-specific data for UI
export interface SentenceWithUserData extends Sentence {
  // User state fields
  isBookmarked?: boolean;
  learningStatus?: "new" | "learning" | "review" | "mastered";
  lastPracticedAt?: Date | null;
  
  // Note data
  noteId?: number;
  noteContent?: string;
  noteTags?: string[] | null;
  
  // Practice and translation fields
  userTranslation?: string;
  practiced?: boolean;
  practiceCount?: number;
  lastPracticeScore?: number;
  tags?: string; // JSON string of tags
  note?: string | null; // Legacy note field
  
  // Legacy fields for backward compatibility (computed from new structure)
  isScrapped?: boolean; // maps to isBookmarked
  isFavorite?: boolean; // maps to isBookmarked
  status?: "new" | "practicing" | "completed" | "mastered"; // maps to learningStatus
}

// Sentence with document information for My Sentences page
export interface SentenceWithDocument extends Sentence {
  // Document information
  documentId: number;
  documentTitle: string;
  documentSourceLanguage?: string;
  averageScore?: number;
  document?: {
    id: number;
    title: string;
    sourceLanguage: string;
  };
  
  // User state fields - required for My Sentences page
  isBookmarked?: boolean;
  learningStatus?: "new" | "learning" | "review" | "mastered";
  lastPracticedAt?: Date | null;
  
  // Note data
  noteId?: number;
  noteContent?: string;
  noteTags?: string[] | null;
  
  // Legacy fields for backward compatibility (computed from new structure)
  isScrapped?: boolean; // maps to isBookmarked
  isFavorite?: boolean; // maps to isBookmarked
  status?: "new" | "practicing" | "completed" | "mastered"; // maps to learningStatus
  note?: string | null; // maps to noteContent
}

export interface TranslationAttempt {
  id: number;
  sentenceId: number;
  userId: number;
  userTranslation: string;
  score: number | null;
  grade: string | null;
  feedback: string | null;
  suggestedCorrection: string | null;
  backTranslation: string | null;
  backTranslationFeedback: string | null;
  practiceMode: string;
  timeSpent: number | null;
  createdAt: string;
}

export interface DocumentWithParagraphs {
  id: number;
  title: string;
  sourceLanguage: string;
  createdAt: string;
  publishedAt?: string | null;
  userId: number | null;
  progress: number;
  fileType?: string;
  sourceType: "uploaded" | "explore";
  isPublic?: boolean;
  author?: string;
  source?: string;
  category: string;
  difficulty?: string;
  tags?: string;
  originalUrl?: string;
  licenseType?: string;
  sourceId?: string;
  url?: string;
  paragraphs: ParagraphWithSentences[];
  structuredContent?: any; // Structured blocks for enhanced document rendering
  structured_content?: any; // Legacy field name for backward compatibility
  structuredVersion?: number;
  contentSourceType?: string;
  sentencesById?: Record<number, Sentence>; // Direct sentence lookup for anchor matching
  // Translation status fields
  translationStatus?: "idle" | "running" | "completed" | "failed";
  translationProgress?: number;
  translatedCount?: number;
  totalCount?: number;
  translationUpdatedAt?: string;
  translationError?: string;
  // AI-generated summaries
  summaryEn?: string;
  summaryKo?: string;
}

export interface ParagraphWithSentences extends Paragraph {
  sentences: Sentence[];
}

export interface Notebook {
  id: number;
  title: string;
  description: string | null;
  tags: string | null;
  isPublic: boolean | null;
  colorLabel: string | null;
  groupLabel: string | null;
  groupOrder: number | null;
  createdAt: string;
  updatedAt: string;
  userId: number | null;
}

export interface InsertNotebook {
  title: string;
  description: string | null;
  tags: string | null;
  isPublic: boolean;
  colorLabel?: string | null;
  groupLabel?: string | null;
  userId: number | null;
}

export interface Glossary {
  id: number;
  userId: number;
  term: string;
  definition: string | null;
  translation: string | null;
  pronunciation: string | null;
  difficulty: "beginner" | "intermediate" | "advanced";
  sourceLanguage: string;
  targetLanguage: string;
  contextSentence: string | null;
  documentId: number | null;
  notes: string | null;
  tags: string | null;
  createdAt: string;
  lastReviewed: string | null;
  reviewCount: number;
}