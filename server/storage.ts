import {
  users,
  documents,
  paragraphs,
  sentences,
  sentenceTranslationHistory,
  translationCache,
  translationAttempts,
  notebooks,
  notebookGroups,
  notebookSentences,
  notes,
  glossary,
  userProgress,
  wordPracticeSessions,
  practiceSessions,
  rssFeeds,
  rssSubscriptions,
  rssPolicy,
  rssArticles,
  userRssFeeds,
  userProfiles,
  userPreferences,
  userSources,
  userSessions,
  // New schema tables
  userSentenceState,
  noteNotebooks,
  // Phase 1: Language-agnostic tables
  translations,
  coaching,
  // Authentication tables
  refreshTokens,
  passwordResets,
  emailVerifications,
  auditLogs,
  type User,
  type InsertUser,
  type Document,
  type Paragraph,
  type Sentence,
  type UpdateSentence,
  type UpdateDocument,
  type InsertTranslationCache,
  type TranslationCache,
  type SentenceTranslationHistory,
  type InsertSentenceTranslationHistory,
  type TranslationAttempt,
  type InsertTranslationAttempt,
  type Notebook,
  type InsertNotebook,
  type NotebookGroup,
  type InsertNotebookGroup,
  type UpdateNotebookGroup,
  type NotebookSentence,
  type InsertNotebookSentence,
  type Note,
  type InsertNote,
  // New schema types
  type UserSentenceState,
  type InsertUserSentenceState,
  type NoteNotebooks,
  type InsertNoteNotebooks,
  type Notes,
  type InsertNotes,
  type Glossary,
  type InsertGlossary,
  type UpdateGlossary,
  type UserProgress,
  type InsertUserProgress,
  type WordPracticeSession,
  type InsertWordPracticeSession,
  type PracticeSession,
  type InsertPracticeSession,
  type RssFeed,
  type InsertRssFeed,
  type RssSubscription,
  type InsertRssSubscription,
  type RssPolicy,
  type InsertRssPolicy,
  type RssArticle,
  type InsertRssArticle,
  type UserRssFeed,
  type UserProfile,
  type InsertUserProfile,
  type UpdateUserProfile,
  type UserPreferences,
  type InsertUserPreferences,
  type UpdateUserPreferences,
  type UserSource,
  type InsertUserSource,
  type UpdateUserSource,
  type UserSession,
  type InsertUserSession,
  // Authentication types
  type RefreshToken,
  type InsertRefreshToken,
  type PasswordReset,
  type InsertPasswordReset,
  type EmailVerification,
  type InsertEmailVerification,
  type AuditLog,
  type InsertAuditLog,
  // Phase 1: Language-agnostic types
  type Translation,
  type InsertTranslation,
  type Coaching,
  type InsertCoaching
} from "@shared/schema";
import { db } from "./db";
import { eq, and, or, sql, inArray, like, desc, isNull, lt, isNotNull, asc, count, ilike } from "drizzle-orm";
import { normalizeUrl, generateUrlHash, generateUrlCandidates, isValidFeedUrl } from "./utils/urlUtils";

// Extended sentence interface that includes note data
export interface SentenceWithNote extends Sentence {
  noteId: number;
  noteContent: string | null;
  noteTags: string[];
  noteCreatedAt: Date;
  noteUpdatedAt: Date;
  documentId: number | null;
  documentTitle: string;
  note: string; // Legacy compatibility
  tags: string[]; // Legacy compatibility
  isBookmarked: boolean;
  learningStatus: 'new' | 'learning' | 'known';
  notebookCount: number;
}

export interface IStorage {
  // User operations
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: number, updates: Partial<User>): Promise<User | undefined>;
  updateUserLoginAttempts(id: number, failedAttempts: number, lockedUntil?: Date): Promise<User | undefined>;
  
  // Daily AI usage tracking (KST midnight reset)
  getDailyAiCount(userId: number): Promise<{ count: number; lastResetDate: string | null }>;
  incrementDailyAiCount(userId: number): Promise<number>;
  resetDailyAiCountIfNeeded(userId: number): Promise<{ wasReset: boolean; currentCount: number }>;

  // Authentication operations
  createRefreshToken(token: InsertRefreshToken): Promise<RefreshToken>;
  getRefreshToken(tokenHash: string): Promise<RefreshToken | undefined>;
  getRefreshTokensByUserId(userId: number): Promise<RefreshToken[]>;
  updateRefreshToken(id: number, updates: Partial<RefreshToken>): Promise<RefreshToken | undefined>;
  deleteRefreshToken(id: number): Promise<boolean>;
  deleteRefreshTokensByUserId(userId: number): Promise<number>;
  deleteExpiredRefreshTokens(): Promise<number>;

  createPasswordReset(reset: InsertPasswordReset): Promise<PasswordReset>;
  getPasswordReset(tokenHash: string): Promise<PasswordReset | undefined>;
  markPasswordResetAsUsed(id: number): Promise<PasswordReset | undefined>;
  deleteExpiredPasswordResets(): Promise<number>;

  createEmailVerification(verification: InsertEmailVerification): Promise<EmailVerification>;
  getEmailVerification(tokenHash: string): Promise<EmailVerification | undefined>;
  markEmailVerificationAsUsed(id: number): Promise<EmailVerification | undefined>;
  deleteExpiredEmailVerifications(): Promise<number>;

  createAuditLog(log: InsertAuditLog): Promise<AuditLog>;
  getAuditLogs(filters?: { userId?: number; eventType?: string; limit?: number; offset?: number }): Promise<AuditLog[]>;

  // Document operations
  getAllDocuments(): Promise<Document[]>;
  getUserDocuments(options?: {
    userId?: number;
    category?: string;
    sortBy?: string;
    search?: string;
    status?: 'active' | 'archived' | 'all';
    includeUserDocuments?: boolean;
  }): Promise<Document[]>;
  getDocument(id: number): Promise<Document | undefined>;
  getDocumentByTitleAndUrl(title: string, url: string | null): Promise<Document | undefined>;
  getDocumentWithParagraphs(id: number, userId?: number): Promise<DocumentWithParagraphs | undefined>;
  createDocument(document: Omit<Document, "id" | "createdAt" | "progress">): Promise<Document>;
  createDocumentWithParagraphs(data: CreateDocumentWithParagraphsParams): Promise<Document>;
  updateDocument(id: number, updates: UpdateDocument): Promise<Document | undefined>;
  updateDocumentProgress(id: number, progress: number): Promise<Document | undefined>;
  updateDocumentActivity(id: number): Promise<Document | undefined>;
  deleteDocument(id: number): Promise<boolean>;

  // Archive operations
  archiveDocument(id: number): Promise<Document | undefined>;
  restoreDocument(id: number): Promise<Document | undefined>;
  getUserUploadDocuments(options?: { userId?: number; status?: 'active' | 'archived' | 'all'; search?: string; }): Promise<Document[]>;
  getUserSavedDocuments(options?: { userId?: number; status?: 'active' | 'archived' | 'all'; search?: string; }): Promise<Document[]>;
  getUserRSSDocuments(options?: { userId?: number; category?: string; sortBy?: string; search?: string; feedId?: number; }): Promise<(Document & { feedAlias?: string })[]>;

  // Admin operations
  getAdminStats(): Promise<{ totalDocuments: number; userDocuments: number; publicDocuments: number; }>;
  getAdminDocuments(filters?: { search?: string; category?: string; type?: string; page?: number; limit?: number; }): Promise<{ documents: Document[], total: number }>;

  // Document cleanup operations
  getExpiredDocuments(): Promise<Document[]>;
  cleanupExpiredDocuments(): Promise<number>;
  setDocumentExpiration(documentId: number, expiresAt: Date): Promise<Document | undefined>;
  setExpirationDatesForExistingDocuments(): Promise<number>;



  // Public library operations
  getPublicLibraryDocuments(filters: LibraryFilters): Promise<Document[]>;

  // Paragraph operations
  getParagraphsForDocument(documentId: number): Promise<Paragraph[]>;
  getParagraph(id: number): Promise<Paragraph | undefined>;
  createParagraph(paragraph: Omit<Paragraph, "id">): Promise<Paragraph>;

  // Sentence operations
  getSentencesForParagraph(paragraphId: number, userId?: number): Promise<Sentence[]>;
  getSentence(id: number): Promise<Sentence | undefined>;
  getSentenceById(id: number): Promise<Sentence | undefined>;
  getAllSentences(): Promise<Sentence[]>;
  getSentencesWithFilters(filters: SentenceFilters): Promise<SentenceWithDocument[]>;
  createSentence(sentence: Omit<Sentence, "id" | "isScrapped" | "note" | "userTranslation" | "tags" | "practiced" | "practiceHistory" | "lastPracticedAt" | "status" | "practiceCount" | "userFeedback" | "styleVariations" | "notebookName" | "isFavorite">): Promise<Sentence>;
  updateSentence(id: number, changes: UpdateSentence): Promise<Sentence | undefined>;
  deleteSentence(id: number): Promise<boolean>;
  // Translation history
  getSentenceTranslationHistory(sentenceId: number): Promise<SentenceTranslationHistory[]>;
  addSentenceTranslationHistory(entry: InsertSentenceTranslationHistory): Promise<SentenceTranslationHistory>;
  bulkDeleteSentences(sentenceIds: number[]): Promise<boolean>;
  validateSentenceOwnership(sentenceIds: number[], userId: number): Promise<number[]>;
  getUserSentences(filters: {
    userId: number;
    documentId?: number;
    status?: string;
    search?: string;
    sortBy?: string;
  }): Promise<any[]>;

  // Notebook Groups operations
  getNotebookGroups(userId: number): Promise<NotebookGroup[]>;
  getNotebookGroup(id: number): Promise<NotebookGroup | undefined>;
  createNotebookGroup(group: InsertNotebookGroup): Promise<NotebookGroup>;
  updateNotebookGroup(id: number, changes: UpdateNotebookGroup): Promise<NotebookGroup | undefined>;
  deleteNotebookGroup(id: number): Promise<boolean>;

  // Notebook operations
  getAllNotebooks(userId?: number): Promise<Notebook[]>;
  getNotebooks(userId?: number): Promise<Notebook[]>;
  getNotebook(id: number): Promise<Notebook | undefined>;
  getNotebookByTitle(title: string): Promise<Notebook | undefined>;
  getNotebookByDocumentId(documentId: number): Promise<Notebook | undefined>;
  createNotebook(notebook: Omit<Notebook, "id" | "createdAt" | "updatedAt">): Promise<Notebook>;
  updateNotebook(id: number, changes: Partial<Pick<Notebook, "title" | "description" | "groupLabel" | "groupOrder" | "colorLabel" | "tags" | "isPublic" | "groupId">>): Promise<Notebook | undefined>;
  updateNotebooksGrouping(items: Array<{ id: number; groupLabel?: string | null; groupOrder?: number }>): Promise<Notebook[]>;
  deleteNotebook(id: number): Promise<boolean>;

  // Notebook-sentence relationship operations
  addSentenceToNotebook(notebookId: number, sentenceId: number): Promise<NotebookSentence>;
  removeSentenceFromNotebook(notebookId: number, sentenceId: number): Promise<boolean>;
  getSentencesInNotebook(notebookId: number, userId?: number): Promise<SentenceWithNote[]>;
  getNotebooksForSentence(sentenceId: number): Promise<Notebook[]>;
  isSentenceInNotebook(sentenceId: number, notebookId: number): Promise<boolean>;
  updateNotebookSentenceNote(notebookId: number, sentenceId: number, personalNote: string): Promise<void>;

  // Notes operations
  addNote(note: Omit<Note, "id" | "createdAt" | "updatedAt">): Promise<Note>;
  upsertNote(data: InsertNotes): Promise<Notes>;
  getNotes(userId: number, sentenceId?: number, notebookId?: number): Promise<Note[]>;
  getNote(id: number): Promise<Note | undefined>;
  updateNote(id: number, changes: Partial<Pick<Note, "content" | "tags" | "color">>): Promise<Note | undefined>;
  deleteNote(id: number): Promise<boolean>;
  getNotesForDocument(documentId: number, userId: number): Promise<Array<{
    id: number;
    sentenceId: number;
    content: string | null;
    tags: string[] | null;
    createdAt: Date;
    updatedAt: Date;
    source: string;
    target?: string;
    paragraphNumber?: number;
    sentenceNumber?: number;
  }>>;

  // Note-Notebook relationship operations
  addNoteToNotebook(noteId: number, notebookId: number, userId: number): Promise<void>;
  removeNoteFromNotebook(noteId: number, notebookId: number, userId: number): Promise<void>;
  getNoteNotebooks(noteId: number): Promise<any[]>;
  copyNotesToNotebook(noteIds: number[], targetNotebookId: number, userId: number): Promise<{
    success: boolean;
    copiedCount: number;
    newNoteIds: number[];
    errors: string[];
  }>;

  // User sentence state operations (bookmarks, learning status)
  getUserSentenceState(userId: number, sentenceId: number): Promise<UserSentenceState | undefined>;
  upsertUserSentenceState(data: InsertUserSentenceState): Promise<UserSentenceState>;
  updateUserSentenceBookmark(userId: number, sentenceId: number, isBookmarked: boolean): Promise<UserSentenceState>;
  updateUserSentenceState(userId: number, sentenceId: number, updates: Partial<{
    aiCoachingCache: string;
    aiCoachingCachedAt: Date;
    isBookmarked: boolean;
    learningStatus: string;
    lastPracticedAt: Date;
  }>): Promise<UserSentenceState>;
  getUserSentenceStates(userId: number, sentenceIds: number[]): Promise<UserSentenceState[]>;
  getUserNotesForSentences(userId: number, sentenceIds: number[]): Promise<any[]>;
  getUserBookmarkedSentences(userId: number, filters?: {
    bookmarked?: boolean;
    status?: string;
    limit?: number;
  }): Promise<Array<{
    id: number;
    text: string;
    isBookmarked: boolean;
    learningStatus: string;
    lastPracticedAt?: Date | null;
  }>>;

  // AI Coaching cache operations
  getAICoachingCache(userId: number, sentenceId: number): Promise<UserSentenceState | null>;
  saveAICoachingCache(userId: number, sentenceId: number, coachingData: string): Promise<void>;

  // Phase 2: Language-agnostic coaching operations
  getCoaching(sentenceId: number, mode: 'comprehension' | 'composition'): Promise<Coaching | undefined>;
  saveCoaching(data: InsertCoaching): Promise<Coaching>;
  getSentenceTranslation(sentenceId: number, sourceLanguage: string, targetLanguage: string): Promise<Translation | undefined>;
  saveSentenceTranslation(data: InsertTranslation): Promise<Translation>;
  updateSentenceLanguage(sentenceId: number, language: string): Promise<void>;
  updateNotebookLanguage(notebookId: number, language: string): Promise<void>;

  // Translation cache operations
  findTranslation(sourceText: string, sourceLanguage: string, targetLanguage: string): Promise<TranslationCache | undefined>;
  saveTranslation(translation: InsertTranslationCache): Promise<TranslationCache>;
  updateTranslationUsage(id: number): Promise<TranslationCache | undefined>;
  clearTranslationCache(pattern?: string): Promise<number>;
  clearAllTranslationCache(): Promise<number>;

  // Glossary operations
  getAllGlossaryTerms(userId: number): Promise<Glossary[]>;
  getAllGlossaryEntries(): Promise<Glossary[]>;
  getGlossaryTerm(id: number): Promise<Glossary | undefined>;
  getGlossaryEntry(id: number): Promise<Glossary | undefined>;
  createGlossaryTerm(term: Omit<Glossary, "id" | "createdAt" | "lastReviewed" | "reviewCount">): Promise<Glossary>;
  updateGlossaryTerm(id: number, changes: Partial<Pick<Glossary, "definition" | "contextSentence" | "notes" | "tags">>): Promise<Glossary | undefined>;
  updateGlossaryEntry(id: number, changes: UpdateGlossary): Promise<Glossary | undefined>;
  deleteGlossaryTerm(id: number): Promise<boolean>;

  // Word practice session operations
  createWordPracticeSession(session: Omit<WordPracticeSession, "id" | "createdAt">): Promise<WordPracticeSession>;
  getWordPracticeSessions(userId: number, wordId?: number): Promise<WordPracticeSession[]>;

  // Practice session operations
  createPracticeSession(session: Omit<PracticeSession, "id" | "createdAt" | "updatedAt">): Promise<PracticeSession>;
  updatePracticeSession(id: number, changes: Partial<Omit<PracticeSession, "id" | "createdAt" | "updatedAt">>): Promise<PracticeSession | undefined>;
  getPracticeSession(id: number): Promise<PracticeSession | undefined>;
  getUserPracticeSessions(userId: number, status?: string): Promise<PracticeSession[]>;

  // Translation attempts operations
  createTranslationAttempt(attempt: Omit<TranslationAttempt, "id" | "createdAt">): Promise<TranslationAttempt>;
  getTranslationAttemptsForSentence(sentenceId: number, userId: number): Promise<TranslationAttempt[]>;
  getTranslationAttempt(id: number): Promise<TranslationAttempt | undefined>;
  getLatestTranslationAttempt(sentenceId: number, userId: number): Promise<TranslationAttempt | undefined>;

  // User progress operations
  getUserProgress(userId: number): Promise<UserProgress | undefined>;
  createUserProgress(progress: Omit<UserProgress, "id" | "updatedAt">): Promise<UserProgress>;
  updateUserProgress(userId: number, changes: Partial<Omit<UserProgress, "id" | "userId">>): Promise<UserProgress | undefined>;

  // Document content update operations
  deleteDocumentContent(documentId: number): Promise<boolean>;
  addParagraphsToDocument(documentId: number, paragraphsData: any[]): Promise<boolean>;

  // RSS Feed operations (new Feed/Subscription model)
  getAllRSSFeeds(): Promise<RssFeed[]>;
  getRSSFeedById(id: number): Promise<RssFeed | undefined>;
  createNewRSSFeed(feed: Omit<RssFeed, "id" | "createdAt" | "updatedAt">): Promise<RssFeed>;
  updateNewRSSFeed(id: number, changes: Partial<Omit<RssFeed, "id" | "createdAt" | "updatedAt">>): Promise<RssFeed | undefined>;
  deleteNewRSSFeed(id: number): Promise<boolean>;

  // RSS Subscription operations
  getRSSSubscriptions(userId?: number): Promise<RssSubscription[]>;
  getRSSSubscription(id: number): Promise<RssSubscription | undefined>;
  createRSSSubscription(subscription: Omit<RssSubscription, "id" | "createdAt" | "updatedAt">): Promise<RssSubscription>;
  updateRSSSubscription(id: number, changes: Partial<Omit<RssSubscription, "id" | "createdAt" | "updatedAt">>): Promise<RssSubscription | undefined>;
  deleteRSSSubscription(id: number): Promise<boolean>;

  // RSS Policy operations
  getRSSPolicy(): Promise<RssPolicy | undefined>;
  updateRSSPolicy(changes: Partial<Omit<RssPolicy, "id" | "createdAt" | "updatedAt">>): Promise<RssPolicy | undefined>;

  // Legacy RSS feed operations (for backward compatibility)
  getRSSFeeds(userId: number): Promise<UserRssFeed[]>;
  getRSSFeed(id: number): Promise<UserRssFeed | undefined>;
  createRSSFeed(feed: Omit<UserRssFeed, "id" | "createdAt" | "lastFetchedAt" | "lastSuccessAt" | "errorCount" | "lastError">): Promise<UserRssFeed>;
  updateRSSFeed(id: number, changes: Partial<Omit<UserRssFeed, "id" | "userId" | "createdAt">>): Promise<UserRssFeed | undefined>;
  deleteRSSFeed(id: number): Promise<boolean>;
  updateRSSFeedSyncStatus(id: number, lastFetchedAt: Date, lastSuccessAt?: Date, errorCount?: number, lastError?: string): Promise<void>;

  // RSS article operations
  getRSSArticles(feedId: number): Promise<RssArticle[]>;
  getRSSArticle(id: number): Promise<RssArticle | undefined>;
  createRSSArticle(article: Omit<RssArticle, "id" | "createdAt">): Promise<RssArticle>;
  updateRSSArticle(id: number, changes: Partial<Omit<RssArticle, "id" | "feedId" | "createdAt">>): Promise<RssArticle | undefined>;
  deleteRSSArticle(id: number): Promise<boolean>;
  getUnprocessedRSSArticles(feedId?: number): Promise<RssArticle[]>;
  markRSSArticleAsProcessed(id: number, documentId: number): Promise<void>;

  // User Profile operations
  getUserProfile(userId: number): Promise<UserProfile | undefined>;
  createUserProfile(profile: InsertUserProfile): Promise<UserProfile>;
  updateUserProfile(userId: number, changes: UpdateUserProfile): Promise<UserProfile | undefined>;

  // User Preferences operations
  getUserPreferences(userId: number): Promise<UserPreferences | undefined>;
  createUserPreferences(preferences: InsertUserPreferences): Promise<UserPreferences>;
  updateUserPreferences(userId: number, changes: UpdateUserPreferences): Promise<UserPreferences | undefined>;

  // User Sources operations
  getUserSources(userId: number): Promise<UserSource[]>;
  getUserSource(id: number): Promise<UserSource | undefined>;
  createUserSource(source: InsertUserSource): Promise<UserSource>;
  updateUserSource(id: number, changes: UpdateUserSource): Promise<UserSource | undefined>;
  deleteUserSource(id: number): Promise<boolean>;

  // User Sessions operations
  getUserSessions(userId: number): Promise<UserSession[]>;
  getUserSession(id: number): Promise<UserSession | undefined>;
  getUserSessionByToken(sessionToken: string): Promise<UserSession | undefined>;
  createUserSession(session: InsertUserSession): Promise<UserSession>;
  updateUserSession(id: number, isActive: boolean): Promise<UserSession | undefined>;
  deleteUserSession(id: number): Promise<boolean>;
  cleanupExpiredSessions(): Promise<number>;

  // User Sentence State operations
  upsertUserSentenceState(data: InsertUserSentenceState): Promise<UserSentenceState>;
  getUserSentenceState(userId: number, sentenceId: number): Promise<UserSentenceState | undefined>;

  // User account deletion
  deleteUserData(userId: number): Promise<boolean>;
  deleteUser(userId: number): Promise<boolean>;

  // Sync Log operations
  createSyncLog(log: { sourceType: 'arxiv' | 'gutenberg' | 'rss'; status: 'success' | 'failed' | 'partial'; documentsAdded?: number; documentsSkipped?: number; errorMessage?: string; details?: any }): Promise<any>;
  updateSyncLog(id: number, updates: { status?: 'success' | 'failed' | 'partial'; documentsAdded?: number; documentsSkipped?: number; errorMessage?: string; details?: any; completedAt?: Date }): Promise<any>;
  getSyncLogs(limit?: number): Promise<any[]>;

  // Auto-approval keyword operations
  getAutoApprovalKeywords(): Promise<any[]>;
  checkAutoApproval(title: string, abstract?: string): Promise<{ approved: boolean; matchedKeywords: string[] }>;
  incrementKeywordMatchCount(keyword: string): Promise<void>;
}

// Additional interfaces for library filtering
export interface LibraryFilters {
  category?: string;
  difficulty?: string;
  sortBy?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

interface DocumentWithParagraphs extends Document {
  paragraphs: ParagraphWithSentences[];
}

interface ParagraphWithSentences extends Paragraph {
  sentences: Sentence[];
}

interface CreateDocumentWithParagraphsParams {
  title: string;
  sourceLanguage: string;
  userId?: number | null;
  fileType?: string;
  sourceType?: "uploaded" | "explore";
  origin?: { provider?: string; sourceId?: string; url?: string; };
  author?: string;
  source?: string;
  category?: string;
  difficulty?: string;
  tags?: string;
  originalUrl?: string;
  publishedAt?: Date;
  licenseType?: string;
  isPublic?: boolean;
  expiresAt?: Date;
  isPermanent?: boolean;
  feedId?: number;
  // V2 NEW FIELDS for instructions.md compliance:
  tokenizerVersion?: string;
  // P0 필수: Save-to-Library 메타데이터 보존 필드들
  structuredContent?: string | any[];
  structuredVersion?: number;
  anchorSchemaVersion?: number;
  contentSourceType?: string;
  processingState?: "pending" | "ps_committed" | "structured_ready" | "completed";
  // Archetype fields per instructions.md - determines parsing strategy
  archetype?: "academic" | "literary" | "essay" | "generic";
  archetypeConfidence?: number;
  archetypeSource?: "source" | "auto" | "user";
  paragraphs: Array<{
    order: number;
    title: string | null;
    sentences: Array<{
      order: number;
      source: string;
      sourceHash?: string; // STEP 2 FIX: Include sourceHash in sentence creation
      target?: string;
    }>;
  }>;
}

interface SentenceFilters {
  userId?: number;
  documentId?: number;
  status?: string;
  isFavorite?: boolean;
  search?: string;
  sortBy?: 'recent' | 'practice-count' | 'alphabetical' | 'status';
}

interface SentenceWithDocument extends Sentence {
  documentTitle: string;
  documentId: number;
  documentSourceLanguage: string;
  averageScore?: number;
  document: {
    id: number;
    title: string;
    sourceLanguage: string;
  };
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user || undefined;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user || undefined;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db
      .insert(users)
      .values(insertUser)
      .returning();
    return user;
  }

  // Document methods
  async getAllDocuments(): Promise<Document[]> {
    return await db.select().from(documents);
  }

  async getUserDocuments(options?: {
    userId?: number;
    category?: string;
    sortBy?: string;
    search?: string;
    status?: 'active' | 'archived' | 'all';
    includeUserDocuments?: boolean;
    type?: 'uploads' | 'rss' | 'saved';
  }): Promise<Document[]> {
    console.log(`[STORAGE DEBUG] getUserDocuments called with options:`, options);

    // CRITICAL: Require userId for all queries
    if (!options?.userId) {
      console.warn('[SECURITY] getUserDocuments called without userId, returning empty array');
      return [];
    }

    // Route to specific functions based on type for clearer logic
    if (options?.type === "uploads") {
      return this.getUserUploadDocuments({ userId: options.userId, status: options.status, search: options.search });
    } else if (options?.type === "rss") {
      return this.getUserRSSDocuments({ userId: options.userId, category: options.category, sortBy: options.sortBy, search: options.search });
    } else if (options?.type === "saved") {
      return this.getUserSavedDocuments({ userId: options.userId, status: options.status, search: options.search });
    }

    // STRICT USER ISOLATION: Only return documents that belong to this specific user
    let conditions = [eq(documents.userId, options.userId)];

    // Add status filter
    if (options.status === 'active') {
      conditions.push(eq(documents.isArchived, false));
    } else if (options.status === 'archived') {
      conditions.push(eq(documents.isArchived, true));
    }
    // 'all' status doesn't add any condition

    // Add search filter
    if (options.search && options.search.trim()) {
      conditions.push(ilike(documents.title, `%${options.search.trim()}%`));
    }

    const baseQuery = db.select().from(documents)
      .where(and(...conditions));

    // Apply sorting
    if (options?.sortBy === "activity") {
      return await baseQuery.orderBy(desc(documents.lastActivityAt));
    } else {
      return await baseQuery.orderBy(desc(documents.createdAt));
    }
  }

  async getUserUploadDocuments(options?: {
    userId?: number;
    status?: 'active' | 'archived' | 'all';
    search?: string;
  }): Promise<Document[]> {
    console.log(`[STORAGE DEBUG] getUserUploadDocuments called with status: ${options?.status}`);

    let conditions = [
      eq(documents.sourceType, 'uploaded'),
      eq(documents.isPublic, false)
    ];

    if (options?.userId) {
      conditions.push(eq(documents.userId, options.userId));
    }

    if (options?.status === 'active') {
      conditions.push(eq(documents.isArchived, false));
    } else if (options?.status === 'archived') {
      conditions.push(eq(documents.isArchived, true));
    }
    // 'all' status doesn't add any condition

    if (options?.search) {
      conditions.push(ilike(documents.title, `%${options.search}%`));
    }

    return await db
      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.lastActivityAt));
  }

  async getUserRSSDocuments(options?: {
    userId?: number;
    category?: string;
    sortBy?: string;
    search?: string;
    feedId?: number;
  }): Promise<(Document & { feedAlias?: string })[]> {
    console.log(`[STORAGE DEBUG] getUserRSSDocuments called with options:`, options);

    let conditions = [
      or(eq(documents.isPublic, false), isNull(documents.isPublic)),
      eq(documents.source, "RSS Feed")
    ];

    // Apply feed filter
    if (options?.feedId) {
      conditions.push(eq(documents.feedId, options.feedId));
    }

    // Apply search filter
    if (options?.search && options.search.trim()) {
      const searchTerm = `%${options.search.trim()}%`;
      conditions.push(
        or(
          ilike(documents.title, searchTerm),
          ilike(documents.author, searchTerm)
        )
      );
    }

    const baseQuery = db.select({
      id: documents.id,
      title: documents.title,
      sourceLanguage: documents.sourceLanguage,
      createdAt: documents.createdAt,
      publishedAt: documents.publishedAt,
      lastActivityAt: documents.lastActivityAt,
      userId: documents.userId,
      progress: documents.progress,
      fileType: documents.fileType,
      isArchived: documents.isArchived,
      sourceType: documents.sourceType,
      origin: documents.origin,
      author: documents.author,
      source: documents.source,
      category: documents.category,
      difficulty: documents.difficulty,
      tags: documents.tags,
      originalUrl: documents.originalUrl,
      licenseType: documents.licenseType,
      isPublic: documents.isPublic,
      expiresAt: documents.expiresAt,
      feedId: documents.feedId,
      thumbnailUrl: documents.thumbnailUrl,
      thumbnailPath: documents.thumbnailPath,
      originalImageUrl: documents.originalImageUrl,
      thumbnailStatus: documents.thumbnailStatus,
      dominantColor: documents.dominantColor,
      blurhash: documents.blurhash,
      structuredContent: documents.structuredContent,
      structuredVersion: documents.structuredVersion,
      contentSourceType: documents.contentSourceType,
      anchorSchemaVersion: documents.anchorSchemaVersion,
      tokenizerVersion: documents.tokenizerVersion,
      processingState: documents.processingState,
      rawContent: documents.rawContent,
      translationStatus: documents.translationStatus,
      translationProgress: documents.translationProgress,
      translatedCount: documents.translatedCount,
      totalCount: documents.totalCount,
      translationUpdatedAt: documents.translationUpdatedAt,
      translationError: documents.translationError,
      feedAlias: sql<string>`COALESCE(${userRssFeeds.alias}, '')`  as any,
    })
    .from(documents)
    .leftJoin(userRssFeeds, eq(documents.feedId, userRssFeeds.id))
    .where(and(...conditions));

    // Apply sorting
    if (options?.sortBy === "latest") {
      return await baseQuery.orderBy(desc(documents.createdAt));
    } else {
      return await baseQuery.orderBy(desc(documents.lastActivityAt));
    }
  }

  async getUserSavedDocuments(options?: {
    userId?: number;
    status?: 'active' | 'archived' | 'all';
    search?: string;
  }): Promise<Document[]> {
    console.log(`[STORAGE DEBUG] getUserSavedDocuments called with status: ${options?.status}`);

    let conditions = [
      eq(documents.sourceType, 'explore'),
      eq(documents.isPublic, false)
    ];

    if (options?.userId) {
      conditions.push(eq(documents.userId, options.userId));
    }

    if (options?.status === 'active') {
      conditions.push(eq(documents.isArchived, false));
    } else if (options?.status === 'archived') {
      conditions.push(eq(documents.isArchived, true));
    }
    // 'all' status doesn't add any condition

    if (options?.search) {
      conditions.push(ilike(documents.title, `%${options.search}%`));
    }

    return await db
      .select()
      .from(documents)
      .where(and(...conditions))
      .orderBy(desc(documents.lastActivityAt));
  }

  async getDocument(id: number): Promise<Document | undefined> {
    const [document] = await db.select().from(documents).where(eq(documents.id, id));

    return document || undefined;
  }

  async getDocumentByTitleAndUrl(title: string, url: string | null): Promise<Document | undefined> {
    if (!url) {
      // If no URL provided, check by title only
      const [document] = await db
        .select()
        .from(documents)
        .where(eq(documents.title, title))
        .limit(1);
      return document || undefined;
    }

    // Check by both title and URL
    const [document] = await db
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.title, title),
          eq(documents.originalUrl, url)
        )
      )
      .limit(1);

    return document || undefined;
  }

  async getDocumentWithParagraphs(id: number, userId?: number): Promise<DocumentWithParagraphs | undefined> {
    const document = await this.getDocument(id);
    if (!document) return undefined;

    const paragraphsList = await this.getParagraphsForDocument(id);

    // Single query for all sentences, then group by paragraphId in JS
    const allSentences = await this.getSentencesByDocumentId(id, userId);
    const sentencesByParagraph = new Map<number, Sentence[]>();
    for (const sentence of allSentences) {
      const group = sentencesByParagraph.get(sentence.paragraphId) ?? [];
      group.push(sentence);
      sentencesByParagraph.set(sentence.paragraphId, group);
    }

    return {
      ...document,
      paragraphs: paragraphsList.map(paragraph => ({
        ...paragraph,
        sentences: sentencesByParagraph.get(paragraph.id) ?? [],
      })),
    };
  }

  async createDocument(document: Omit<Document, "id" | "createdAt" | "progress">): Promise<Document> {
    // STEP 3 FIX: Import tokenizer version for tracking consistency
    const { SENTENCE_TOKENIZER_VERSION } = await import('./utils/textUtils.js');

    // Calculate expiration date for public documents based on category
    let expiresAt = document.expiresAt;
    if (document.isPublic && document.category && !expiresAt) {
      const RETENTION_POLICY: Record<string, number> = {
        'News': 30,
        '뉴스': 30,
        'Non-fiction': 60,
        '칼럼·에세이': 60,
        'Educational': 90,
        '교육': 90,
        'Academic': 90,
        '논문': 90,
        'Literature': 180,
        '문학': 180,
      };

      const retentionDays = RETENTION_POLICY[document.category] || 30;
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + retentionDays);
      expiresAt = expirationDate;
    }

    const [newDocument] = await db
      .insert(documents)
      .values({
        title: document.title,
        sourceLanguage: document.sourceLanguage,
        userId: document.userId,
        progress: 0,
        fileType: document.fileType || "text",
        isArchived: document.isArchived || false,
        sourceType: document.sourceType || "uploaded",
        origin: document.origin || null,
        author: document.author || null,
        source: document.source || null,
        category: document.category || "Educational",
        difficulty: document.difficulty || null,
        tags: document.tags || null,
        originalUrl: document.originalUrl || null,
        licenseType: document.licenseType || null,
        tokenizerVersion: SENTENCE_TOKENIZER_VERSION, // Track sentence splitting version
        isPublic: document.isPublic || false,
        expiresAt: expiresAt,
        lastActivityAt: new Date(),
        feedId: document.feedId,
        // V2 metadata fields for structured content
        structuredContent: document.structuredContent as any,
        structuredVersion: document.structuredVersion || null,
        anchorSchemaVersion: document.anchorSchemaVersion || null,
        contentSourceType: document.contentSourceType as any,
        processingState: document.processingState || "pending",
        // Add missing required fields from schema
        blurhash: document.blurhash || null,
        rawContent: document.rawContent || null,
        // Translation tracking fields
        translationStatus: document.translationStatus ?? "idle",
        translationProgress: document.translationProgress ?? 0,
        translatedCount: document.translatedCount ?? 0,
        totalCount: document.totalCount ?? 0,
        translationUpdatedAt: document.translationUpdatedAt ?? null,
        translationError: document.translationError ?? null,
        wordCount: document.wordCount ?? null,
      })
      .returning();

    return newDocument;
  }

  async createDocumentWithParagraphs(data: CreateDocumentWithParagraphsParams): Promise<Document> {
    // STEP 3 FIX: Import tokenizer version for createDocumentWithParagraphs consistency
    const { SENTENCE_TOKENIZER_VERSION } = await import('./utils/textUtils.js');

    if (!SENTENCE_TOKENIZER_VERSION) {
      throw new Error('SENTENCE_TOKENIZER_VERSION is required but not defined');
    }

    // Create the document with V2 fields
    const newDocument = await this.createDocument({
      title: data.title,
      sourceLanguage: data.sourceLanguage,
      userId: data.userId || null,
      fileType: data.fileType || "text",
      isArchived: false,
      sourceType: data.sourceType || "uploaded",
      author: data.author || null,
      source: data.source || null,
      category: data.category || "Educational",
      difficulty: data.difficulty || null,
      tags: data.tags || null,
      originalUrl: data.originalUrl || null,
      licenseType: data.licenseType || null,
      isPublic: data.isPublic || false,
      isPermanent: data.isPermanent || false,
      // 🔧 P0 Critical: Pass V2 metadata to createDocument
      structuredContent: data.structuredContent as any,
      structuredVersion: data.structuredVersion || null,
      anchorSchemaVersion: data.anchorSchemaVersion || null,
      contentSourceType: data.contentSourceType as any,
      processingState: data.processingState || "pending",
      expiresAt: data.expiresAt || null,
      lastActivityAt: new Date(),
      publishedAt: data.publishedAt || null,
      feedId: data.feedId || null,
      tokenizerVersion: data.tokenizerVersion || SENTENCE_TOKENIZER_VERSION,
      thumbnailUrl: null,
      thumbnailPath: null,
      thumbnailStatus: "pending",
      originalImageUrl: null,
      dominantColor: null,
      // Add missing required fields from schema
      origin: data.origin || null,
      blurhash: null,
      rawContent: null,
      translationStatus: "idle",
      translationProgress: 0,
      translatedCount: 0,
      totalCount: 0,
      translationUpdatedAt: null,
      translationError: null,
      // Archetype fields per instructions.md
      archetype: data.archetype || "generic",
      archetypeConfidence: data.archetypeConfidence || 0,
      archetypeSource: data.archetypeSource || "auto",
    });

    // Create paragraphs and sentences
    for (const paragraphData of data.paragraphs) {
      const newParagraph = await this.createParagraph({
        documentId: newDocument.id,
        order: paragraphData.order,
        title: paragraphData.title,
      });

      // Create sentences for this paragraph
      for (const sentenceData of paragraphData.sentences) {
        await this.createSentence({
          paragraphId: newParagraph.id,
          order: sentenceData.order,
          source: sentenceData.source,
          sourceHash: sentenceData.sourceHash || null, // STEP 2 FIX: Include sourceHash
          target: sentenceData.target || null,
          language: null, // Phase 1: Language-agnostic - derived from document sourceLanguage
        });
      }
    }

    return newDocument;
  }

  async updateDocument(id: number, updates: UpdateDocument): Promise<Document | undefined> {
    // Ensure blurhash and other new fields are properly handled
    const updateData: any = { ...updates, lastActivityAt: new Date() };

    const [updatedDocument] = await db
      .update(documents)
      .set(updateData)
      .where(eq(documents.id, id))
      .returning();

    return updatedDocument || undefined;
  }

  async updateDocumentProgress(id: number, progress: number): Promise<Document | undefined> {
    const [updatedDocument] = await db
      .update(documents)
      .set({ progress, lastActivityAt: new Date() })
      .where(eq(documents.id, id))
      .returning();

    return updatedDocument || undefined;
  }

  async updateDocumentActivity(id: number): Promise<Document | undefined> {
    const [updatedDocument] = await db
      .update(documents)
      .set({ lastActivityAt: new Date() })
      .where(eq(documents.id, id))
      .returning();

    return updatedDocument || undefined;
  }

  async deleteDocument(id: number): Promise<boolean> {
    try {
      // Get all sentence IDs for this document first
      const sentenceIds = await db
        .select({ id: sentences.id })
        .from(sentences)
        .innerJoin(paragraphs, eq(sentences.paragraphId, paragraphs.id))
        .where(eq(paragraphs.documentId, id));

      const sentenceIdList = sentenceIds.map(s => s.id);

      if (sentenceIdList.length > 0) {
        // Delete notes first (new addition to fix FK constraint issue)
        await db.delete(notes).where(
          inArray(notes.sentenceId, sentenceIdList)
        );

        // Delete translation attempts first (foreign key dependency)
        await db.delete(translationAttempts).where(
          inArray(translationAttempts.sentenceId, sentenceIdList)
        );

        // Delete notebook-sentence relationships
        await db.delete(notebookSentences).where(
          inArray(notebookSentences.sentenceId, sentenceIdList)
        );

        // Delete user sentence states
        await db.delete(userSentenceState).where(
          inArray(userSentenceState.sentenceId, sentenceIdList)
        );

        // Delete sentences
        await db.delete(sentences).where(
          inArray(sentences.id, sentenceIdList)
        );
      }

      // Delete paragraphs
      await db.delete(paragraphs).where(eq(paragraphs.documentId, id));

      // Delete any system notebooks associated with this document
      await db.delete(notebooks).where(
        and(
          eq(notebooks.documentId, id),
          eq(notebooks.type, "system")
        )
      );

      // Delete glossary entries that reference this document
      await db.delete(glossary).where(eq(glossary.documentId, id));

      // Finally delete the document
      const result = await db.delete(documents).where(eq(documents.id, id));

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error("Error deleting document:", error);
      return false;
    }
  }

  // Archive operations
  async archiveDocument(id: number): Promise<Document | undefined> {
    console.log(`[STORAGE] Archiving document ${id}`);
    const [updatedDocument] = await db
      .update(documents)
      .set({ isArchived: true, lastActivityAt: new Date() })
      .where(eq(documents.id, id))
      .returning();

    console.log(`[STORAGE] Archive result for document ${id}:`, updatedDocument?.isArchived);
    return updatedDocument || undefined;
  }

  async restoreDocument(id: number): Promise<Document | undefined> {
    const [updatedDocument] = await db
      .update(documents)
      .set({ isArchived: false, lastActivityAt: new Date() })
      .where(eq(documents.id, id))
      .returning();

    return updatedDocument || undefined;
  }




  async getPublicLibraryDocuments(filters: LibraryFilters): Promise<Document[]> {
    let conditions = [eq(documents.isPublic, true), eq(documents.isArchived, false)];

    // Apply category filter with comprehensive mapping
    if (filters.category && filters.category !== 'all') {
      console.log(`[CATEGORY_FILTER] Filtering by category: ${filters.category}`);

      const categoryMapping: Record<string, string[]> = {
        'Literature': ['Literature', 'Fiction', 'classic', '문학'],
        'Academic': ['Academic', 'Research', 'science', '논문', '학술논문'],
        'News': ['News', 'Australia news', 'World news', 'UK news', 'US news', 'Politics', 'Technology', 'Business', 'Global development', '뉴스'],
        'Educational': ['Educational', 'Transcript', '교육'],
        'Opinion': ['Opinion', 'Non-fiction', 'Essay', 'Life and style', 'Travel', 'Food', 'Sport', 'Culture', '에세이/오피니언', '칼럼·에세이', 'Television & radio'],
        'Other': ['Other', '기타']
      };

      const mappedCategories = categoryMapping[filters.category] || [filters.category];
      console.log(`[CATEGORY_FILTER] Mapped categories for ${filters.category}:`, mappedCategories);

      // Create OR condition for all mapped categories
      const categoryConditions = mappedCategories.map(cat => eq(documents.category, cat));
      if (categoryConditions.length === 1) {
        conditions.push(categoryConditions[0]);
      } else {
        const orCondition = or(...categoryConditions);
        if (orCondition) {
          conditions.push(orCondition);
        }
      }
    }

    if (filters.difficulty) {
      conditions.push(eq(documents.difficulty, filters.difficulty));
    }

    // Add search functionality if provided
    if (filters.search && filters.search.trim()) {
      const searchTerm = `%${filters.search.trim()}%`;
      const searchCondition = or(
        ilike(documents.title, searchTerm),
        ilike(documents.author, searchTerm)
      );
      if (searchCondition) {
        conditions.push(searchCondition);
      }
    }

    let query = db.select().from(documents).where(and(...conditions));

    // Add pagination support for performance
    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    query = query.limit(limit).offset(offset) as any;

    // Apply simplified sorting (Latest, Title, Author only)
    switch (filters.sortBy) {
      case "author":
        return await query.orderBy(documents.author);
      case "title":
        return await query.orderBy(documents.title);
      case "activity":
        return await query.orderBy(desc(documents.lastActivityAt), desc(documents.createdAt));
      case "created":
      case "latest":
      default:
        return await query.orderBy(desc(documents.createdAt));
    }
  }


  // Set expiration dates for existing public documents that don't have them
  async setExpirationDatesForExistingDocuments(): Promise<number> {
    try {
      // Get public documents without expiration dates
      const documentsWithoutExpiration = await db
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.isPublic, true),
            isNull(documents.expiresAt)
          )
        );

      console.log(`Found ${documentsWithoutExpiration.length} public documents without expiration dates`);

      const RETENTION_POLICY: Record<string, number> = {
        'News': 30,
        '뉴스': 30,
        'Non-fiction': 60,
        '칼럼·에세이': 60,
        'Educational': 90,
        '교육': 90,
        'Academic': 90,
        '논문': 90,
        'Literature': 180,
        '문학': 180,
      };

      let updatedCount = 0;
      for (const doc of documentsWithoutExpiration) {
        const retentionDays = RETENTION_POLICY[doc.category || ''] || 30;
        const expirationDate = new Date();
        expirationDate.setDate(expirationDate.getDate() + retentionDays);

        await db
          .update(documents)
          .set({ expiresAt: expirationDate })
          .where(eq(documents.id, doc.id));

        updatedCount++;
      }

      console.log(`Successfully set expiration dates for ${updatedCount} documents`);
      return updatedCount;
    } catch (error) {
      console.error("Error setting expiration dates:", error);
      throw error;
    }
  }

  // Paragraph methods
  async getParagraphsForDocument(documentId: number): Promise<Paragraph[]> {
    return await db
      .select()
      .from(paragraphs)
      .where(eq(paragraphs.documentId, documentId))
      .orderBy(paragraphs.order);
  }

  async getParagraph(id: number): Promise<Paragraph | undefined> {
    const [paragraph] = await db
      .select()
      .from(paragraphs)
      .where(eq(paragraphs.id, id));

    return paragraph || undefined;
  }

  async createParagraph(paragraph: Omit<Paragraph, "id">): Promise<Paragraph> {
    const [newParagraph] = await db
      .insert(paragraphs)
      .values(paragraph)
      .returning();

    return newParagraph;
  }

  // Sentence methods
  async getSentencesForParagraph(paragraphId: number, userId?: number): Promise<Sentence[]> {
    if (!userId) {
      // Return basic sentence data without user-specific information
      return await db
        .select()
        .from(sentences)
        .where(eq(sentences.paragraphId, paragraphId))
        .orderBy(sentences.order);
    }

    // Include user-specific bookmark and note information
    const result = await db
      .select({
        id: sentences.id,
        paragraphId: sentences.paragraphId,
        order: sentences.order,
        source: sentences.source,
        sourceHash: sentences.sourceHash,
        target: sentences.target,
        targetAi: sentences.targetAi,
        targetEdited: sentences.targetEdited,
        // User-specific fields
        isBookmarked: userSentenceState.isBookmarked,
        learningStatus: userSentenceState.learningStatus,
        lastPracticedAt: userSentenceState.lastPracticedAt,
        noteContent: notes.content,
        noteTags: notes.tags,
        // Legacy compatibility
        isScrapped: userSentenceState.isBookmarked,
        note: notes.content,
      })
      .from(sentences)
      .leftJoin(userSentenceState, and(
        eq(userSentenceState.sentenceId, sentences.id),
        eq(userSentenceState.userId, userId)
      ))
      .leftJoin(notes, and(
        eq(notes.sentenceId, sentences.id),
        eq(notes.userId, userId)
      ))
      .where(eq(sentences.paragraphId, paragraphId))
      .orderBy(sentences.order);

    return result.map(row => ({
      id: row.id,
      paragraphId: row.paragraphId,
      order: row.order,
      source: row.source,
      sourceHash: row.sourceHash,
      target: row.target,
      targetAi: row.targetAi,
      targetEdited: row.targetEdited,
      // Include user-specific data
      isBookmarked: row.isBookmarked || false,
      isScrapped: row.isBookmarked || false,
      note: row.noteContent || undefined,
      learningStatus: row.learningStatus || 'new',
      lastPracticedAt: row.lastPracticedAt || null,
    })) as Sentence[];
  }

  async getSentencesByDocumentId(documentId: number, userId?: number): Promise<Sentence[]> {
    if (!userId) {
      return await db
        .select({
          id: sentences.id,
          paragraphId: sentences.paragraphId,
          order: sentences.order,
          source: sentences.source,
          sourceHash: sentences.sourceHash,
          target: sentences.target,
          targetAi: sentences.targetAi,
          targetEdited: sentences.targetEdited,
        })
        .from(sentences)
        .innerJoin(paragraphs, eq(sentences.paragraphId, paragraphs.id))
        .where(eq(paragraphs.documentId, documentId))
        .orderBy(paragraphs.order, sentences.order) as unknown as Sentence[];
    }

    const result = await db
      .select({
        id: sentences.id,
        paragraphId: sentences.paragraphId,
        order: sentences.order,
        source: sentences.source,
        sourceHash: sentences.sourceHash,
        target: sentences.target,
        targetAi: sentences.targetAi,
        targetEdited: sentences.targetEdited,
        isBookmarked: userSentenceState.isBookmarked,
        learningStatus: userSentenceState.learningStatus,
        lastPracticedAt: userSentenceState.lastPracticedAt,
        noteContent: notes.content,
        noteTags: notes.tags,
        isScrapped: userSentenceState.isBookmarked,
        note: notes.content,
      })
      .from(sentences)
      .innerJoin(paragraphs, eq(sentences.paragraphId, paragraphs.id))
      .leftJoin(userSentenceState, and(
        eq(userSentenceState.sentenceId, sentences.id),
        eq(userSentenceState.userId, userId)
      ))
      .leftJoin(notes, and(
        eq(notes.sentenceId, sentences.id),
        eq(notes.userId, userId)
      ))
      .where(eq(paragraphs.documentId, documentId))
      .orderBy(paragraphs.order, sentences.order);

    return result.map(row => ({
      id: row.id,
      paragraphId: row.paragraphId,
      order: row.order,
      source: row.source,
      sourceHash: row.sourceHash,
      target: row.target,
      targetAi: row.targetAi,
      targetEdited: row.targetEdited,
      isBookmarked: row.isBookmarked || false,
      isScrapped: row.isBookmarked || false,
      note: row.noteContent || undefined,
      learningStatus: row.learningStatus || 'new',
      lastPracticedAt: row.lastPracticedAt || null,
    })) as Sentence[];
  }

  async getSentence(id: number): Promise<Sentence | undefined> {
    const [sentence] = await db
      .select()
      .from(sentences)
      .where(eq(sentences.id, id));

    return sentence || undefined;
  }

  async getSentenceById(id: number): Promise<Sentence | undefined> {
    const [sentence] = await db
      .select()
      .from(sentences)
      .where(eq(sentences.id, id));

    return sentence || undefined;
  }

  async getAllSentences(): Promise<Sentence[]> {
    return await db.select().from(sentences);
  }

  async createSentence(sentence: Omit<Sentence, "id">): Promise<Sentence> {
    // STEP 2 FIX: Generate hash for consistent anchor matching
    const { generateSentenceHash } = await import('./utils/hashUtils.js');
    const sourceHash = generateSentenceHash(sentence.source);

    const [newSentence] = await db
      .insert(sentences)
      .values({
        ...sentence,
        sourceHash, // Store hash for consistent anchor matching
      })
      .returning();

    return newSentence;
  }

  async updateSentence(id: number, changes: UpdateSentence): Promise<Sentence | undefined> {
    // Snapshot prior values to decide whether to log translation history
    let priorTarget: string | null | undefined;
    let priorTargetEdited: string | null | undefined;
    const willTouchTranslation =
      Object.prototype.hasOwnProperty.call(changes, 'target') ||
      Object.prototype.hasOwnProperty.call(changes, 'targetEdited');

    if (willTouchTranslation) {
      const prior = await db
        .select({ target: sentences.target, targetEdited: sentences.targetEdited })
        .from(sentences)
        .where(eq(sentences.id, id))
        .limit(1);
      if (prior.length > 0) {
        priorTarget = prior[0].target ?? null;
        priorTargetEdited = prior[0].targetEdited ?? null;
      }
    }

    const [updatedSentence] = await db
      .update(sentences)
      .set(changes)
      .where(eq(sentences.id, id))
      .returning();

    if (updatedSentence && willTouchTranslation) {
      try {
        // First-time AI translation: previously empty `target` becomes non-empty.
        if (
          Object.prototype.hasOwnProperty.call(changes, 'target') &&
          (changes as any).target &&
          String((changes as any).target).trim().length > 0 &&
          (!priorTarget || String(priorTarget).trim().length === 0)
        ) {
          await this.addSentenceTranslationHistory({
            sentenceId: id,
            type: 'ai',
            translation: String((changes as any).target),
            version: await this.getNextHistoryVersion(id),
          });
        }
        // User edit: targetEdited changed to a different non-empty value.
        if (
          Object.prototype.hasOwnProperty.call(changes, 'targetEdited') &&
          (changes as any).targetEdited &&
          String((changes as any).targetEdited).trim().length > 0 &&
          String((changes as any).targetEdited) !== String(priorTargetEdited ?? '')
        ) {
          await this.addSentenceTranslationHistory({
            sentenceId: id,
            type: 'user',
            translation: String((changes as any).targetEdited),
            version: await this.getNextHistoryVersion(id),
          });
        }
      } catch (historyError) {
        console.error('[updateSentence] Failed to record translation history:', historyError);
      }
    }

    return updatedSentence || undefined;
  }

  private async getNextHistoryVersion(sentenceId: number): Promise<number> {
    const rows = await db
      .select({ version: sentenceTranslationHistory.version })
      .from(sentenceTranslationHistory)
      .where(eq(sentenceTranslationHistory.sentenceId, sentenceId))
      .orderBy(desc(sentenceTranslationHistory.version))
      .limit(1);
    return (rows[0]?.version ?? 0) + 1;
  }

  async getSentenceTranslationHistory(sentenceId: number): Promise<SentenceTranslationHistory[]> {
    // Backfill: if a translation exists but no history rows, seed from current state
    const existing = await db
      .select()
      .from(sentenceTranslationHistory)
      .where(eq(sentenceTranslationHistory.sentenceId, sentenceId))
      .orderBy(desc(sentenceTranslationHistory.version));

    if (existing.length === 0) {
      const sentence = await this.getSentenceById(sentenceId);
      if (sentence) {
        const aiText = sentence.target?.trim();
        const editedText = sentence.targetEdited?.trim();
        let nextVersion = 1;
        if (aiText) {
          await this.addSentenceTranslationHistory({
            sentenceId,
            type: 'ai',
            translation: sentence.target!,
            version: nextVersion++,
          });
        }
        if (editedText && editedText !== aiText) {
          await this.addSentenceTranslationHistory({
            sentenceId,
            type: 'user',
            translation: sentence.targetEdited!,
            version: nextVersion++,
          });
        }
        if (nextVersion > 1) {
          return await db
            .select()
            .from(sentenceTranslationHistory)
            .where(eq(sentenceTranslationHistory.sentenceId, sentenceId))
            .orderBy(desc(sentenceTranslationHistory.version));
        }
      }
    }

    return existing;
  }

  async addSentenceTranslationHistory(entry: InsertSentenceTranslationHistory): Promise<SentenceTranslationHistory> {
    const [row] = await db
      .insert(sentenceTranslationHistory)
      .values(entry)
      .returning();
    return row;
  }

  async deleteSentence(id: number): Promise<boolean> {
    try {
      // First remove from notebook relationships
      await db.delete(notebookSentences).where(eq(notebookSentences.sentenceId, id));

      // Then delete the sentence
      const result = await db.delete(sentences).where(eq(sentences.id, id));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error("Error deleting sentence:", error);
      return false;
    }
  }

  async bulkDeleteSentences(sentenceIds: number[]): Promise<boolean> {
    if (!sentenceIds || sentenceIds.length === 0) {
      console.log("[bulkDeleteSentences] No sentence IDs provided");
      return false;
    }

    console.log(`[bulkDeleteSentences] Attempting to delete ${sentenceIds.length} sentences:`, sentenceIds);

    try {
      // Use transaction for atomic operation
      const result = await db.transaction(async (tx) => {
        // First, delete from related tables that actually exist
        console.log("[bulkDeleteSentences] Deleting from notebook_sentences...");
        await tx.delete(notebookSentences).where(inArray(notebookSentences.sentenceId, sentenceIds));

        // Delete from notes table using Drizzle ORM
        console.log("[bulkDeleteSentences] Deleting from notes...");
        const notesResult = await tx.delete(notes).where(inArray(notes.sentenceId, sentenceIds));
        console.log(`[bulkDeleteSentences] Deleted ${notesResult.rowCount || 0} notes`);

        // Delete from translation_attempts table using Drizzle ORM
        console.log("[bulkDeleteSentences] Deleting from translation_attempts...");
        const attemptsResult = await tx.delete(translationAttempts).where(inArray(translationAttempts.sentenceId, sentenceIds));
        console.log(`[bulkDeleteSentences] Deleted ${attemptsResult.rowCount || 0} translation attempts`);

        // Finally, delete the sentences themselves
        console.log("[bulkDeleteSentences] Deleting sentences...");
        const sentencesResult = await tx.delete(sentences).where(inArray(sentences.id, sentenceIds));

        console.log(`[bulkDeleteSentences] Successfully deleted ${sentencesResult.rowCount || 0} sentences`);
        return sentencesResult.rowCount || 0;
      });

      return result > 0;
    } catch (error) {
      console.error("[bulkDeleteSentences] Transaction failed:", error);
      console.error("[bulkDeleteSentences] Error details:", {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : 'No stack available',
        sentenceIds
      });
      return false;
    }
  }

  async validateSentenceOwnership(sentenceIds: number[], userId: number): Promise<number[]> {
    try {
      console.log(`[validateSentenceOwnership] Checking ownership for ${sentenceIds.length} sentences for user ${userId}`);

      // Get sentences that belong to documents owned by the user or public documents
      // Need to join through paragraphs table: sentences -> paragraphs -> documents
      const ownedSentences = await db
        .select({ id: sentences.id })
        .from(sentences)
        .innerJoin(paragraphs, eq(sentences.paragraphId, paragraphs.id))
        .innerJoin(documents, eq(paragraphs.documentId, documents.id))
        .where(
          and(
            inArray(sentences.id, sentenceIds),
            or(
              eq(documents.userId, userId),  // User owns the document
              isNull(documents.userId)       // Public document
            )
          )
        );

      const validIds = ownedSentences.map(s => s.id);
      console.log(`[validateSentenceOwnership] Found ${validIds.length} valid sentences out of ${sentenceIds.length} requested`);

      return validIds;
    } catch (error) {
      console.error("[validateSentenceOwnership] Error validating ownership:", error);
      return [];
    }
  }

  async getUserSentences(filters: {
    userId: number;
    documentId?: number;
    status?: string;
    search?: string;
    sortBy?: string;
  }): Promise<any[]> {
    const { userId, documentId, status, search, sortBy = 'recent' } = filters;

    try {
      // New schema: Query using user_sentence_state joined with notes
      // For My Sentences page, only show bookmarked sentences
      let whereConditions = [
        eq(userSentenceState.userId, userId),
        eq(userSentenceState.isBookmarked, true) // Only get bookmarked sentences
      ];

      if (documentId) {
        whereConditions.push(eq(documents.id, documentId));
      }

      if (status) {
        if (status === 'favorites') {
          whereConditions.push(eq(userSentenceState.isBookmarked, true));
        } else {
          // Map legacy status values to new learningStatus
          const statusMap: Record<string, string> = {
            'new': 'new',
            'practicing': 'learning',
            'completed': 'review',
            'mastered': 'mastered'
          };
          const mappedStatus = statusMap[status] || status;
          whereConditions.push(eq(userSentenceState.learningStatus, mappedStatus as any));
        }
      }

      if (search) {
        const searchConditions = [
          ilike(sentences.source, `%${search}%`),
          ilike(sentences.target, `%${search}%`)
        ];
        // Add notes search only if notes are joined
        const searchCondition = or(...searchConditions);
        if (searchCondition) {
          whereConditions.push(searchCondition);
        }
      }

      // Build order by
      let orderByClause;
      switch (sortBy) {
        case 'alphabetical':
          orderByClause = asc(sentences.source);
          break;
        case 'status':
          orderByClause = asc(userSentenceState.learningStatus);
          break;
        case 'recent':
        default:
          orderByClause = desc(userSentenceState.lastPracticedAt);
          break;
      }

      const result = await db
        .select({
          id: sentences.id,
          paragraphId: sentences.paragraphId,
          order: sentences.order,
          source: sentences.source,
          sourceHash: sentences.sourceHash,
          target: sentences.target,
          documentId: documents.id,
          documentTitle: documents.title,
          // New schema fields
          isBookmarked: userSentenceState.isBookmarked,
          learningStatus: userSentenceState.learningStatus,
          lastPracticedAt: userSentenceState.lastPracticedAt,
          noteId: notes.id,
          noteContent: notes.content,
          noteTags: notes.tags,
          // Legacy compatibility fields
          isScrapped: userSentenceState.isBookmarked,
          isFavorite: userSentenceState.isBookmarked,
          status: userSentenceState.learningStatus,
          note: notes.content,
        })
        .from(userSentenceState)
        .innerJoin(sentences, eq(sentences.id, userSentenceState.sentenceId))
        .innerJoin(paragraphs, eq(sentences.paragraphId, paragraphs.id))
        .innerJoin(documents, eq(paragraphs.documentId, documents.id))
        .leftJoin(notes, and(
          eq(notes.userId, userSentenceState.userId),
          eq(notes.sentenceId, userSentenceState.sentenceId)
        ))
        .where(and(...whereConditions))
        .orderBy(orderByClause);

      // Transform result to include note status for UI
      const transformedResult = result.map(row => ({
        ...row,
        // Add note status indicator
        hasNote: !!row.noteContent,
        // Preserve bookmark status as isScrapped for backward compatibility
        isScrapped: row.isBookmarked,
      }));

      console.log(`[getUserSentences] Found ${transformedResult.length} sentences for user ${userId}`);
      return transformedResult;
    } catch (error) {
      console.error("Error fetching user sentences:", error);
      throw error;
    }
  }

  async getSentencesWithFilters(filters: SentenceFilters): Promise<SentenceWithDocument[]> {
    // Build base conditions using new schema
    let baseConditions: any[] = [];

    // Add userId filtering if provided
    if (filters.userId) {
      baseConditions.push(eq(userSentenceState.userId, filters.userId));
    }

    const allSentences = await db
      .select({
        id: sentences.id,
        paragraphId: sentences.paragraphId,
        order: sentences.order,
        source: sentences.source,
        target: sentences.target,
        sourceHash: sentences.sourceHash,
        documentTitle: documents.title,
        documentId: documents.id,
        documentSourceLanguage: documents.sourceLanguage,
        // New schema fields
        isBookmarked: userSentenceState.isBookmarked,
        learningStatus: userSentenceState.learningStatus,
        lastPracticedAt: userSentenceState.lastPracticedAt,
        noteContent: notes.content,
        noteTags: notes.tags,
        // Legacy compatibility fields
        isScrapped: userSentenceState.isBookmarked,
        isFavorite: userSentenceState.isBookmarked,
        status: userSentenceState.learningStatus,
        note: notes.content,
      })
      .from(userSentenceState)
      .innerJoin(sentences, eq(sentences.id, userSentenceState.sentenceId))
      .innerJoin(paragraphs, eq(sentences.paragraphId, paragraphs.id))
      .innerJoin(documents, eq(paragraphs.documentId, documents.id))
      .leftJoin(notes, and(
        eq(notes.userId, userSentenceState.userId),
        eq(notes.sentenceId, userSentenceState.sentenceId)
      ))
      .where(and(...baseConditions));

    // Apply client-side filtering (can be optimized later)
    let filtered = allSentences;

    if (filters.documentId) {
      const docSentences = await db
        .select({ id: sentences.id })
        .from(sentences)
        .innerJoin(paragraphs, eq(sentences.paragraphId, paragraphs.id))
        .where(eq(paragraphs.documentId, filters.documentId));

      const sentenceIds = docSentences.map(s => s.id);
      filtered = filtered.filter(s => sentenceIds.includes(s.id));
    }

    if (filters.status) {
      if (filters.status === 'favorites') {
        filtered = filtered.filter(s => s.isBookmarked === true);
      } else {
        const statusMap: Record<string, string> = {
          'new': 'new',
          'practicing': 'learning',
          'completed': 'review',
          'mastered': 'mastered'
        };
        const mappedStatus = statusMap[filters.status] || filters.status;
        filtered = filtered.filter(s => s.learningStatus === mappedStatus);
      }
    }

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(s =>
        s.source.toLowerCase().includes(searchLower) ||
        (s.target && s.target.toLowerCase().includes(searchLower)) ||
        (s.noteContent && s.noteContent.toLowerCase().includes(searchLower))
      );
    }

    // Apply sorting
    switch (filters.sortBy) {
      case 'recent':
        filtered.sort((a, b) => {
          if (!a.lastPracticedAt && !b.lastPracticedAt) return b.id - a.id;
          if (!a.lastPracticedAt) return 1;
          if (!b.lastPracticedAt) return -1;
          return new Date(b.lastPracticedAt).getTime() - new Date(a.lastPracticedAt).getTime();
        });
        break;
      case 'practice-count':
        // Practice count not available in new schema - sort by last practiced instead
        filtered.sort((a, b) => {
          if (!a.lastPracticedAt && !b.lastPracticedAt) return 0;
          if (!a.lastPracticedAt) return 1;
          if (!b.lastPracticedAt) return -1;
          return new Date(b.lastPracticedAt).getTime() - new Date(a.lastPracticedAt).getTime();
        });
        break;
      case 'alphabetical':
        filtered.sort((a, b) => a.source.localeCompare(b.source));
        break;
      case 'status':
        filtered.sort((a, b) => (a.learningStatus || 'new').localeCompare(b.learningStatus || 'new'));
        break;
      default:
        filtered.sort((a, b) => b.id - a.id);
    }

    // Add averageScore calculation and document object
    return filtered.map(sentence => ({
      ...sentence,
      averageScore: undefined, // Can be calculated if needed
      document: {
        id: sentence.documentId,
        title: sentence.documentTitle,
        sourceLanguage: sentence.documentSourceLanguage,
      }
    }));
  }

  // Notebook operations
  async getAllNotebooks(userId?: number): Promise<Notebook[]> {
    const query = db.select().from(notebooks);
    if (userId) {
      return await query.where(eq(notebooks.userId, userId));
    }
    return await query;
  }

  // Notebook Groups operations
  async getNotebookGroups(userId: number): Promise<NotebookGroup[]> {
    return await db
      .select()
      .from(notebookGroups)
      .where(eq(notebookGroups.userId, userId))
      .orderBy(asc(notebookGroups.order), asc(notebookGroups.name));
  }

  async getNotebookGroup(id: number): Promise<NotebookGroup | undefined> {
    const [group] = await db
      .select()
      .from(notebookGroups)
      .where(eq(notebookGroups.id, id));

    return group || undefined;
  }

  async createNotebookGroup(group: InsertNotebookGroup): Promise<NotebookGroup> {
    const [newGroup] = await db
      .insert(notebookGroups)
      .values(group)
      .returning();

    return newGroup;
  }

  async updateNotebookGroup(id: number, changes: UpdateNotebookGroup): Promise<NotebookGroup | undefined> {
    const [updated] = await db
      .update(notebookGroups)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(notebookGroups.id, id))
      .returning();

    return updated || undefined;
  }

  async deleteNotebookGroup(id: number): Promise<boolean> {
    // First, unassign all notebooks from this group (set groupId to null)
    await db
      .update(notebooks)
      .set({ groupId: null, updatedAt: new Date() })
      .where(eq(notebooks.groupId, id));

    // Then delete the group
    const result = await db
      .delete(notebookGroups)
      .where(eq(notebookGroups.id, id));

    return (result.rowCount ?? 0) > 0;
  }

  async getNotebooks(userId?: number): Promise<Notebook[]> {
    if (!userId) {
      console.warn('getNotebooks called without userId - returning empty array');
      return [];
    }

    // Get notebooks with sentence count using noteNotebooks table (new schema)
    const result = await db
      .select({
        id: notebooks.id,
        userId: notebooks.userId,
        title: notebooks.title,
        description: notebooks.description,
        tags: notebooks.tags,
        type: notebooks.type,
        documentId: notebooks.documentId,
        isPublic: notebooks.isPublic,
        colorLabel: notebooks.colorLabel,
        groupId: notebooks.groupId,
        groupLabel: notebooks.groupLabel, // Legacy field for transition
        groupOrder: notebooks.groupOrder, // Legacy field for transition
        createdAt: notebooks.createdAt,
        updatedAt: notebooks.updatedAt,
        sentenceCount: count(noteNotebooks.noteId)
      })
      .from(notebooks)
      .leftJoin(noteNotebooks, and(
        eq(notebooks.id, noteNotebooks.notebookId),
        eq(noteNotebooks.userId, userId)
      ))
      .where(eq(notebooks.userId, userId))
      .groupBy(notebooks.id)
      .orderBy(desc(notebooks.updatedAt));

    return result as any;
  }

  async getNotebookByTitle(title: string): Promise<Notebook | undefined> {
    const [notebook] = await db
      .select()
      .from(notebooks)
      .where(eq(notebooks.title, title));

    return notebook || undefined;
  }

  async getNotebook(id: number): Promise<Notebook | undefined> {
    const [notebook] = await db
      .select()
      .from(notebooks)
      .where(eq(notebooks.id, id));

    return notebook || undefined;
  }

  async getNotebookByDocumentId(documentId: number): Promise<Notebook | undefined> {
    const [notebook] = await db
      .select()
      .from(notebooks)
      .where(and(eq(notebooks.documentId, documentId), eq(notebooks.type, "system")));

    return notebook || undefined;
  }

  async createNotebook(notebook: Omit<Notebook, "id" | "createdAt" | "updatedAt">): Promise<Notebook> {
    const [newNotebook] = await db
      .insert(notebooks)
      .values(notebook)
      .returning();

    return newNotebook;
  }

  async updateNotebook(id: number, changes: Partial<Pick<Notebook, "title" | "description" | "groupLabel" | "groupOrder" | "colorLabel" | "tags" | "isPublic">>): Promise<Notebook | undefined> {
    const [notebook] = await db
      .update(notebooks)
      .set({
        ...changes,
        updatedAt: new Date()
      })
      .where(eq(notebooks.id, id))
      .returning();

    return notebook || undefined;
  }

  async updateNotebooksGrouping(items: Array<{ id: number; groupLabel?: string | null; groupOrder?: number }>): Promise<Notebook[]> {
    const updatedNotebooks: Notebook[] = [];

    // Update each notebook with group information
    for (const item of items) {
      const [notebook] = await db
        .update(notebooks)
        .set({
          groupLabel: item.groupLabel,
          groupOrder: item.groupOrder ?? 0,
          updatedAt: new Date()
        })
        .where(eq(notebooks.id, item.id))
        .returning();

      if (notebook) {
        updatedNotebooks.push(notebook);
      }
    }

    return updatedNotebooks;
  }


  async deleteNotebook(id: number): Promise<boolean> {
    // First delete all note-notebook relationships (new system)
    await db.delete(noteNotebooks).where(eq(noteNotebooks.notebookId, id));

    // Also delete legacy notebook-sentence relationships
    await db.delete(notebookSentences).where(eq(notebookSentences.notebookId, id));

    // Then delete the notebook
    const result = await db.delete(notebooks).where(eq(notebooks.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // Notebook-sentence relationship operations
  async addSentenceToNotebook(notebookId: number, sentenceId: number): Promise<NotebookSentence> {
    const [relationship] = await db
      .insert(notebookSentences)
      .values({ notebookId, sentenceId })
      .returning();

    return relationship;
  }

  async isSentenceInNotebook(sentenceId: number, notebookId: number): Promise<boolean> {
    const [relationship] = await db
      .select()
      .from(notebookSentences)
      .where(
        and(
          eq(notebookSentences.sentenceId, sentenceId),
          eq(notebookSentences.notebookId, notebookId)
        )
      );

    return !!relationship;
  }

  async updateNotebookSentenceNote(notebookId: number, sentenceId: number, personalNote: string): Promise<void> {
    // Since personalNote doesn't exist in notebookSentences, this is a no-op
    // Notes should be managed via the separate notes table
    console.warn('updateNotebookSentenceNote: personalNote field not supported in current schema');
  }

  async removeSentenceFromNotebook(notebookId: number, sentenceId: number): Promise<boolean> {
    const result = await db
      .delete(notebookSentences)
      .where(
        and(
          eq(notebookSentences.notebookId, notebookId),
          eq(notebookSentences.sentenceId, sentenceId)
        )
      );

    return (result.rowCount ?? 0) > 0;
  }

  async getSentencesInNotebook(notebookId: number, userId?: number): Promise<SentenceWithNote[]> {
    console.log(`[NOTEBOOK_SENTENCES] Starting safe query for notebook ${notebookId}, userId: ${userId}`);

    try {
      // Step 1: Get note-notebook relationships (filter by userId if provided for consistency with count)
      const noteLinks = userId 
        ? await db
            .select()
            .from(noteNotebooks)
            .where(and(
              eq(noteNotebooks.notebookId, notebookId),
              eq(noteNotebooks.userId, userId)
            ))
        : await db
            .select()
            .from(noteNotebooks)
            .where(eq(noteNotebooks.notebookId, notebookId));

      if (noteLinks.length === 0) {
        console.log(`[NOTEBOOK_SENTENCES] No note links found for notebook ${notebookId}`);
        return [];
      }

      console.log(`[NOTEBOOK_SENTENCES] Found ${noteLinks.length} note links`);

      // Step 2: Get notes data safely
      const noteIds = noteLinks.map(link => link.noteId);
      const notesData = await db
        .select()
        .from(notes)
        .where(inArray(notes.id, noteIds));

      if (notesData.length === 0) {
        console.log(`[NOTEBOOK_SENTENCES] No notes found for IDs: ${noteIds.join(', ')}`);
        return [];
      }

      console.log(`[NOTEBOOK_SENTENCES] Found ${notesData.length} notes`);

      // Step 3: Get sentence data safely
      const sentenceIds = notesData.map(note => note.sentenceId);
      const sentencesData = await db
        .select()
        .from(sentences)
        .where(inArray(sentences.id, sentenceIds));

      console.log(`[NOTEBOOK_SENTENCES] Found ${sentencesData.length} sentences`);

      // Step 4: Get document info safely - one step at a time
      const result: any[] = [];

      for (const note of notesData) {
        const sentence = sentencesData.find(s => s.id === note.sentenceId);
        if (!sentence) continue;

        // Get paragraph safely
        const [paragraphData] = await db
          .select()
          .from(paragraphs)
          .where(eq(paragraphs.id, sentence.paragraphId))
          .limit(1);

        if (!paragraphData) continue;

        // Get document safely
        const [documentData] = await db
          .select()
          .from(documents)
          .where(eq(documents.id, paragraphData.documentId))
          .limit(1);

        // Build result object safely
        const sentenceResult = {
          id: sentence.id,
          paragraphId: sentence.paragraphId,
          order: sentence.order || 0,
          source: sentence.source || '',
          sourceHash: sentence.sourceHash || null,
          target: sentence.target || null,
          targetAi: sentence.targetAi || null,
          targetEdited: sentence.targetEdited || null,
          // Note data
          noteId: note.id,
          noteContent: note.content,
          noteColor: note.color || 'yellow',
          noteTags: note.tags || [],
          noteCreatedAt: note.createdAt,
          noteUpdatedAt: note.updatedAt,
          // Document info
          documentId: documentData?.id || null,
          documentTitle: documentData?.title || 'Unknown Document',
          // Legacy compatibility
          note: note.content,
          tags: note.tags || [],
          isBookmarked: false,
          learningStatus: 'new' as const,
          notebookCount: 1,
        };

        result.push(sentenceResult);
      }

      // Sort by note update time
      result.sort((a, b) => new Date(b.noteUpdatedAt).getTime() - new Date(a.noteUpdatedAt).getTime());

      console.log(`[NOTEBOOK_SENTENCES] Successfully processed ${result.length} sentences for notebook ${notebookId}`);
      return result as SentenceWithNote[];

    } catch (error) {
      console.error(`[NOTEBOOK_SENTENCES] Error in safe query for notebook ${notebookId}:`, error);
      console.error(`[NOTEBOOK_SENTENCES] Error stack:`, error instanceof Error ? error.stack : 'No stack available');
      return [];
    }
  }

  async getNotebooksForSentence(sentenceId: number): Promise<Notebook[]> {
    const result = await db
      .select({ notebook: notebooks })
      .from(notebookSentences)
      .innerJoin(notebooks, eq(notebookSentences.notebookId, notebooks.id))
      .where(eq(notebookSentences.sentenceId, sentenceId));

    return result.map(row => row.notebook);
  }

  // Notes operations
  async addNote(note: Omit<Note, "id" | "createdAt" | "updatedAt">): Promise<Note> {
    const [newNote] = await db
      .insert(notes)
      .values({
        ...note,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [notes.userId, notes.sentenceId],
        set: {
          content: note.content,
          tags: note.tags,
          updatedAt: new Date(),
        }
      })
      .returning();

    return newNote;
  }

  // Remove duplicate function that's causing compilation error
  // async upsertNote is already implemented above through addNote with onConflictDoUpdate

  async getNotes(userId: number, sentenceId?: number, notebookId?: number): Promise<Note[]> {
    const conditions = [eq(notes.userId, userId)];

    if (sentenceId) {
      conditions.push(eq(notes.sentenceId, sentenceId));
    }

    // notebookId filtering would require joining with noteNotebooks table
    // This parameter is not supported in current implementation
    if (notebookId) {
      console.warn('getNotes: notebookId filtering not supported in current implementation');
    }

    return await db.select().from(notes).where(and(...conditions));
  }

  async getNote(id: number): Promise<Note | undefined> {
    const [note] = await db
      .select()
      .from(notes)
      .where(eq(notes.id, id));

    return note || undefined;
  }

  async getNotesForDocument(documentId: number, userId: number): Promise<Array<{
    id: number;
    sentenceId: number;
    content: string | null;
    tags: string[] | null;
    createdAt: Date;
    updatedAt: Date;
    source: string;
    target?: string;
    paragraphNumber?: number;
    sentenceNumber?: number;
  }>> {
    // Get notes for sentences in this document, joining with paragraphs for position info
    const results = await db
      .select({
        id: notes.id,
        sentenceId: notes.sentenceId,
        content: notes.content,
        tags: notes.tags,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
        source: sentences.source,
        target: sentences.target,
        paragraphNumber: paragraphs.order,
        sentenceNumber: sentences.order,
      })
      .from(notes)
      .innerJoin(sentences, eq(sentences.id, notes.sentenceId))
      .innerJoin(paragraphs, eq(paragraphs.id, sentences.paragraphId))
      .where(and(
        eq(notes.userId, userId),
        eq(paragraphs.documentId, documentId)
      ))
      .orderBy(desc(notes.updatedAt));

    // Convert null to undefined for target field
    return results.map(result => ({
      ...result,
      target: result.target || undefined,
    }));
  }

  async updateNote(id: number, changes: Partial<Pick<Note, "content" | "tags" | "color">>): Promise<Note | undefined> {
    const [note] = await db
      .update(notes)
      .set({
        ...changes,
        updatedAt: new Date()
      })
      .where(eq(notes.id, id))
      .returning();

    return note || undefined;
  }

  async deleteNote(id: number): Promise<boolean> {
    const result = await db.delete(notes).where(eq(notes.id, id));
    return (result.rowCount ?? 0) > 0;
  }



  // Translation cache operations
  async findTranslation(sourceText: string, sourceLanguage: string, targetLanguage: string): Promise<TranslationCache | undefined> {
    const [cached] = await db
      .select()
      .from(translationCache)
      .where(
        and(
          eq(translationCache.sourceText, sourceText),
          eq(translationCache.sourceLanguage, sourceLanguage),
          eq(translationCache.targetLanguage, targetLanguage)
        )
      );

    return cached || undefined;
  }

  async saveTranslation(translation: InsertTranslationCache): Promise<TranslationCache> {
    const [saved] = await db
      .insert(translationCache)
      .values(translation)
      .returning();

    return saved;
  }

  async updateTranslationUsage(id: number): Promise<TranslationCache | undefined> {
    const [updated] = await db
      .update(translationCache)
      .set({
        usageCount: sql`${translationCache.usageCount} + 1`,
        lastUsed: new Date()
      })
      .where(eq(translationCache.id, id))
      .returning();

    return updated || undefined;
  }

  // Clear translation cache (for testing improved translations)
  async clearTranslationCache(pattern?: string): Promise<number> {
    try {
      let result;
      if (pattern) {
        result = await db
          .delete(translationCache)
          .where(like(translationCache.sourceText, `%${pattern}%`));
      } else {
        result = await db.delete(translationCache);
      }
      return result.rowCount ?? 0;
    } catch (error) {
      console.error("Error clearing translation cache:", error);
      return 0;
    }
  }

  // Clear all translation cache
  async clearAllTranslationCache(): Promise<number> {
    try {
      const result = await db.delete(translationCache);
      return result.rowCount ?? 0;
    } catch (error) {
      console.error("Error clearing all translation cache:", error);
      return 0;
    }
  }

  // Glossary operations
  async getAllGlossaryTerms(userId: number): Promise<Glossary[]> {
    console.log(`[STORAGE] getAllGlossaryTerms called with userId: ${userId}`);
    const result = await db
      .select()
      .from(glossary)
      .where(eq(glossary.userId, userId));
    console.log(`[STORAGE] getAllGlossaryTerms found ${result.length} terms for userId: ${userId}`);
    return result;
  }

  async getGlossaryTerm(id: number): Promise<Glossary | undefined> {
    const [term] = await db
      .select()
      .from(glossary)
      .where(eq(glossary.id, id));

    return term || undefined;
  }

  async createGlossaryTerm(term: Omit<Glossary, "id" | "createdAt" | "lastReviewed" | "reviewCount">): Promise<Glossary> {
    const [newTerm] = await db
      .insert(glossary)
      .values(term)
      .returning();

    return newTerm;
  }

  async updateGlossaryTerm(id: number, changes: Partial<Pick<Glossary, "definition" | "contextSentence" | "notes" | "tags">>): Promise<Glossary | undefined> {
    const [updated] = await db
      .update(glossary)
      .set(changes)
      .where(eq(glossary.id, id))
      .returning();

    return updated || undefined;
  }

  async deleteGlossaryTerm(id: number): Promise<boolean> {
    const result = await db.delete(glossary).where(eq(glossary.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  // New Glossary methods for word learning
  async getAllGlossaryEntries(): Promise<Glossary[]> {
    return await db.select().from(glossary);
  }

  async getGlossaryEntry(id: number): Promise<Glossary | undefined> {
    const [entry] = await db
      .select()
      .from(glossary)
      .where(eq(glossary.id, id));

    return entry || undefined;
  }

  async updateGlossaryEntry(id: number, changes: UpdateGlossary): Promise<Glossary | undefined> {
    const [updated] = await db
      .update(glossary)
      .set(changes)
      .where(eq(glossary.id, id))
      .returning();

    return updated || undefined;
  }

  // Word practice session operations
  async createWordPracticeSession(session: Omit<WordPracticeSession, "id" | "createdAt">): Promise<WordPracticeSession> {
    const [newSession] = await db
      .insert(wordPracticeSessions)
      .values(session)
      .returning();

    return newSession;
  }

  async getWordPracticeSessions(userId: number, wordId?: number): Promise<WordPracticeSession[]> {
    if (wordId) {
      return await db
        .select()
        .from(wordPracticeSessions)
        .where(
          and(
            eq(wordPracticeSessions.userId, userId),
            eq(wordPracticeSessions.wordId, wordId)
          )
        );
    }

    return await db
      .select()
      .from(wordPracticeSessions)
      .where(eq(wordPracticeSessions.userId, userId));
  }

  // Practice session operations
  async createPracticeSession(session: Omit<PracticeSession, "id" | "createdAt" | "updatedAt">): Promise<PracticeSession> {
    const [newSession] = await db
      .insert(practiceSessions)
      .values(session)
      .returning();

    return newSession;
  }

  async updatePracticeSession(id: number, changes: Partial<Omit<PracticeSession, "id" | "createdAt" | "updatedAt">>): Promise<PracticeSession | undefined> {
    const [updated] = await db
      .update(practiceSessions)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(practiceSessions.id, id))
      .returning();

    return updated || undefined;
  }

  async getPracticeSession(id: number): Promise<PracticeSession | undefined> {
    const [session] = await db
      .select()
      .from(practiceSessions)
      .where(eq(practiceSessions.id, id));

    return session || undefined;
  }

  async getUserPracticeSessions(userId: number, status?: string): Promise<PracticeSession[]> {
    let conditions = [eq(practiceSessions.userId, userId)];

    if (status) {
      conditions.push(eq(practiceSessions.status, status));
    }

    const query = db
      .select()
      .from(practiceSessions)
      .where(and(...conditions))
      .orderBy(sql`${practiceSessions.updatedAt} DESC`);

    return await query;
  }

  // Translation attempts operations
  async createTranslationAttempt(attempt: Omit<TranslationAttempt, "id" | "createdAt">): Promise<TranslationAttempt> {
    const [newAttempt] = await db
      .insert(translationAttempts)
      .values(attempt)
      .returning();

    return newAttempt;
  }

  async getTranslationAttemptsForSentence(sentenceId: number, userId: number): Promise<TranslationAttempt[]> {
    return await db
      .select()
      .from(translationAttempts)
      .where(
        and(
          eq(translationAttempts.sentenceId, sentenceId),
          eq(translationAttempts.userId, userId)
        )
      )
      .orderBy(sql`${translationAttempts.createdAt} DESC`);
  }

  async getTranslationAttempt(id: number): Promise<TranslationAttempt | undefined> {
    const [attempt] = await db
      .select()
      .from(translationAttempts)
      .where(eq(translationAttempts.id, id));

    return attempt || undefined;
  }

  async getLatestTranslationAttempt(sentenceId: number, userId: number): Promise<TranslationAttempt | undefined> {
    const [attempt] = await db
      .select()
      .from(translationAttempts)
      .where(
        and(
          eq(translationAttempts.sentenceId, sentenceId),
          eq(translationAttempts.userId, userId)
        )
      )
      .orderBy(sql`${translationAttempts.createdAt} DESC`)
      .limit(1);

    return attempt || undefined;
  }

  async getTranslationAttempts(sentenceId: number, userId: number = 1): Promise<TranslationAttempt[]> {
    return this.getTranslationAttemptsForSentence(sentenceId, userId);
  }


  // User progress operations
  async getUserProgress(userId: number): Promise<UserProgress | undefined> {
    const [progress] = await db
      .select()
      .from(userProgress)
      .where(eq(userProgress.userId, userId));

    return progress || undefined;
  }

  async createUserProgress(progress: Omit<UserProgress, "id" | "updatedAt">): Promise<UserProgress> {
    const [newProgress] = await db
      .insert(userProgress)
      .values(progress)
      .returning();

    return newProgress;
  }

  async updateUserProgress(userId: number, changes: Partial<Omit<UserProgress, "id" | "userId">>): Promise<UserProgress | undefined> {
    const [updated] = await db
      .update(userProgress)
      .set({
        ...changes,
        updatedAt: new Date()
      })
      .where(eq(userProgress.userId, userId))
      .returning();

    return updated || undefined;
  }

  // Document content update operations
  async deleteDocumentContent(documentId: number): Promise<boolean> {
    try {
      // Delete sentences first (due to foreign key constraints)
      await db.delete(sentences).where(
        inArray(sentences.paragraphId,
          db.select({ id: paragraphs.id }).from(paragraphs).where(eq(paragraphs.documentId, documentId))
        )
      );

      // Then delete paragraphs
      await db.delete(paragraphs).where(eq(paragraphs.documentId, documentId));

      return true;
    } catch (error) {
      console.error('Error deleting document content:', error);
      return false;
    }
  }

  async addParagraphsToDocument(documentId: number, paragraphsData: any[]): Promise<boolean> {
    try {
      for (const paragraphData of paragraphsData) {
        // Create paragraph
        const [newParagraph] = await db
          .insert(paragraphs)
          .values({
            documentId,
            title: paragraphData.title,
            order: paragraphData.order
          })
          .returning();

        // Create sentences for this paragraph
        const sentencesInsertData = paragraphData.sentences.map((sentence: any) => ({
          paragraphId: newParagraph.id,
          source: sentence.source,
          target: sentence.target || null,
          order: sentence.order
        }));

        if (sentencesInsertData.length > 0) {
          await db.insert(sentences).values(sentencesInsertData);
        }
      }

      return true;
    } catch (error) {
      console.error('Error adding paragraphs to document:', error);
      return false;
    }
  }

  // Admin methods
  async getAdminStats(): Promise<{ totalDocuments: number; userDocuments: number; publicDocuments: number; }> {
    const [totalResult] = await db.select({ count: count() }).from(documents);
    const [userResult] = await db.select({ count: count() }).from(documents)
      .where(sql`${documents.isPublic} = false OR ${documents.isPublic} IS NULL`);
    const [publicResult] = await db.select({ count: count() }).from(documents)
      .where(eq(documents.isPublic, true));

    return {
      totalDocuments: totalResult.count,
      userDocuments: userResult.count,
      publicDocuments: publicResult.count,
    };
  }

  async getAdminDocuments(filters?: {
    search?: string;
    category?: string;
    type?: string;
    page?: number;
    limit?: number;
  }): Promise<{ documents: Document[], total: number }> {
    // Build all conditions first
    const conditions = [];

    // Apply search filter
    if (filters?.search) {
      const searchTerm = `%${filters.search}%`;
      conditions.push(
        or(
          ilike(documents.title, searchTerm),
          ilike(documents.author, searchTerm),
          ilike(documents.source, searchTerm)
        )
      );
    }

    // Apply category filter with comprehensive mapping
    if (filters?.category && filters.category !== "all") {
      const categoryMapping: Record<string, string[]> = {
        'Literature': ['Literature', 'Fiction', 'classic', '문학'],
        'Academic': ['Academic', 'Research', 'science', '논문', '학술논문'],
        'News': ['News', 'Australia news', 'World news', 'UK news', 'US news', 'Politics', 'Technology', 'Business', 'Global development', '뉴스'],
        'Educational': ['Educational', 'Transcript', '교육'],
        'Opinion': ['Opinion', 'Non-fiction', 'Essay', 'Life and style', 'Travel', 'Food', 'Sport', 'Culture', '에세이/오피니언', '칼럼·에세이', 'Television & radio'],
        'Other': ['Other', '기타']
      };

      const mappedCategories = categoryMapping[filters.category] || [filters.category];

      // Create OR condition for all mapped categories
      const categoryConditions = mappedCategories.map(cat => eq(documents.category, cat));
      if (categoryConditions.length === 1) {
        conditions.push(categoryConditions[0]);
      } else {
        const orCondition = or(...categoryConditions);
        if (orCondition) {
          conditions.push(orCondition);
        }
      }
    }

    // Apply type filter
    if (filters?.type && filters.type !== "all") {
      if (filters.type === "public") {
        conditions.push(eq(documents.isPublic, true));
      } else if (filters.type === "user") {
        conditions.push(sql`${documents.isPublic} = false OR ${documents.isPublic} IS NULL`);
      }
    }

    // Build query with all conditions combined
    let query = db.select().from(documents);

    if (conditions.length > 0) {
      const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);
      query = query.where(whereClause) as any;
    }

    // Order by last activity, then creation date
    query = query.orderBy(desc(documents.lastActivityAt), desc(documents.createdAt)) as any;

    // Get all documents first for total count
    const allDocuments = await query;
    const total = allDocuments.length;

    // Apply pagination to results
    const page = filters?.page || 1;
    const limit = filters?.limit || 12;
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedDocuments = allDocuments.slice(startIndex, endIndex);

    return { documents: paginatedDocuments, total };
  }

  // Document cleanup methods
  async getExpiredDocuments(): Promise<Document[]> {
    const now = new Date();
    return await db.select().from(documents)
      .where(
        and(
          eq(documents.isPublic, true),
          lt(documents.expiresAt, now)
        )
      )
      .orderBy(desc(documents.expiresAt));
  }

  async cleanupExpiredDocuments(): Promise<number> {
    try {
      const now = new Date();
      console.log(`Starting cleanup of expired documents at ${now.toISOString()}`);

      // Find expired public documents
      const expiredDocs = await db.select({ id: documents.id }).from(documents)
        .where(
          and(
            eq(documents.isPublic, true),
            lt(documents.expiresAt, now)
          )
        );

      if (expiredDocs.length === 0) {
        console.log("No expired documents found");
        return 0;
      }

      console.log(`Found ${expiredDocs.length} expired documents to clean up`);
      const expiredDocIds = expiredDocs.map(doc => doc.id);

      // Delete in correct order to respect foreign key constraints
      // Only delete if the documents are NOT in user libraries (no user copies)
      let deletedCount = 0;
      for (const docId of expiredDocIds) {
        // Check if there are any user copies (non-public versions) of this document
        const userCopies = await db.select({ id: documents.id }).from(documents)
          .where(
            and(
              or(eq(documents.isPublic, false), isNull(documents.isPublic)),
              eq(documents.title,
                sql`(SELECT title FROM ${documents} WHERE id = ${docId})`
              )
            )
          );

        // Only delete if no user copies exist
        if (userCopies.length === 0) {
          const deleted = await this.deleteDocument(docId);
          if (deleted) {
            deletedCount++;
            console.log(`Deleted expired document ID: ${docId}`);
          }
        } else {
          console.log(`Skipping deletion of document ID ${docId} - user copies exist`);
        }
      }

      console.log(`Cleanup completed: ${deletedCount} documents deleted, ${expiredDocs.length - deletedCount} preserved due to user copies`);
      return deletedCount;
    } catch (error) {
      console.error("Error during document cleanup:", error);
      return 0;
    }
  }

  async setDocumentExpiration(documentId: number, expiresAt: Date): Promise<Document | undefined> {
    const [updatedDocument] = await db
      .update(documents)
      .set({ expiresAt })
      .where(eq(documents.id, documentId))
      .returning();

    return updatedDocument || undefined;
  }



  // ========================================
  // NEW RSS FEED/SUBSCRIPTION MODEL OPERATIONS
  // ========================================

  // URL 정규화 및 중복 처리
  async findExistingFeedByUrl(originalUrl: string): Promise<RssFeed | undefined> {
    if (!isValidFeedUrl(originalUrl)) {
      return undefined;
    }

    const candidates = generateUrlCandidates(originalUrl);
    const hashes = candidates.map(url => generateUrlHash(normalizeUrl(url)));

    const [existingFeed] = await db
      .select()
      .from(rssFeeds)
      .where(inArray(rssFeeds.normalizedUrlHash, hashes))
      .limit(1);

    return existingFeed || undefined;
  }

  async createOrGetFeed(originalUrl: string, feedData: { title: string; description?: string; language?: string; category?: string }): Promise<RssFeed> {
    // 1. URL 정규화
    const canonicalUrl = normalizeUrl(originalUrl);
    const urlHash = generateUrlHash(canonicalUrl);

    // 2. 기존 Feed 검색
    let existingFeed = await this.findExistingFeedByUrl(originalUrl);

    if (existingFeed) {
      // 기존 Feed 업데이트 (메타데이터 갱신)
      return await this.updateNewRSSFeed(existingFeed.id, {
        title: feedData.title,
        description: feedData.description,
        language: feedData.language,
        category: feedData.category,
        lastRunAt: new Date()
      }) || existingFeed;
    }

    // 3. 새 Feed 생성
    const newFeed: Omit<RssFeed, "id" | "createdAt" | "updatedAt"> = {
      canonicalUrl,
      normalizedUrlHash: urlHash,
      title: feedData.title,
      description: feedData.description || null,
      language: feedData.language || "en",
      category: feedData.category || "RSS Feed",
      etag: null,
      lastModified: null,
      healthScore: 100,
      lastRunAt: new Date(),
      lastStatus: "pending",
      errorCount: 0,
      lastError: null,
      isBlocked: false
    };

    return await this.createNewRSSFeed(newFeed);
  }

  // RSS Feed operations (Global canonical feeds)
  async getAllRSSFeeds(): Promise<RssFeed[]> {
    return await db
      .select()
      .from(rssFeeds)
      .orderBy(desc(rssFeeds.lastRunAt), desc(rssFeeds.createdAt));
  }

  async getRSSFeedById(id: number): Promise<RssFeed | undefined> {
    const [feed] = await db
      .select()
      .from(rssFeeds)
      .where(eq(rssFeeds.id, id));
    return feed || undefined;
  }

  async createNewRSSFeed(feed: Omit<RssFeed, "id" | "createdAt" | "updatedAt">): Promise<RssFeed> {
    const [newFeed] = await db
      .insert(rssFeeds)
      .values({
        ...feed,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return newFeed;
  }

  async updateNewRSSFeed(id: number, changes: Partial<Omit<RssFeed, "id" | "createdAt" | "updatedAt">>): Promise<RssFeed | undefined> {
    const [updated] = await db
      .update(rssFeeds)
      .set({
        ...changes,
        updatedAt: new Date(),
      })
      .where(eq(rssFeeds.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteNewRSSFeed(id: number): Promise<boolean> {
    try {
      // Delete all subscriptions first
      await db.delete(rssSubscriptions).where(eq(rssSubscriptions.feedId, id));

      // Delete articles associated with this feed
      await db.delete(rssArticles).where(eq(rssArticles.feedId, id));

      // Delete the feed
      const result = await db.delete(rssFeeds).where(eq(rssFeeds.id, id));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error("Error deleting RSS feed:", error);
      return false;
    }
  }

  // RSS Subscription operations (User-specific feed subscriptions)
  async getRSSSubscriptions(userId?: number): Promise<RssSubscription[]> {
    const conditions = [];

    if (userId) {
      conditions.push(eq(rssSubscriptions.userId, userId));
    }

    const results = await db
      .select()
      .from(rssSubscriptions)
      .innerJoin(rssFeeds, eq(rssSubscriptions.feedId, rssFeeds.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(rssSubscriptions.createdAt));

    return results.map(result => ({
      ...result.rss_subscriptions,
      feed: result.rss_feeds
    })) as any;
  }

  async getRSSSubscription(id: number): Promise<RssSubscription | undefined> {
    const [subscription] = await db
      .select()
      .from(rssSubscriptions)
      .where(eq(rssSubscriptions.id, id));
    return subscription || undefined;
  }

  async createRSSSubscription(subscription: Omit<RssSubscription, "id" | "createdAt" | "updatedAt">): Promise<RssSubscription> {
    const [newSubscription] = await db
      .insert(rssSubscriptions)
      .values({
        ...subscription,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
    return newSubscription;
  }

  async updateRSSSubscription(id: number, changes: Partial<Omit<RssSubscription, "id" | "createdAt" | "updatedAt">>): Promise<RssSubscription | undefined> {
    const [updated] = await db
      .update(rssSubscriptions)
      .set({
        ...changes,
        updatedAt: new Date(),
      })
      .where(eq(rssSubscriptions.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteRSSSubscription(id: number): Promise<boolean> {
    try {
      const result = await db.delete(rssSubscriptions).where(eq(rssSubscriptions.id, id));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error("Error deleting RSS subscription:", error);
      return false;
    }
  }

  // RSS Policy operations
  async getRSSPolicy(): Promise<RssPolicy | undefined> {
    const [policy] = await db
      .select()
      .from(rssPolicy)
      .limit(1);
    return policy || undefined;
  }

  async updateRSSPolicy(changes: Partial<Omit<RssPolicy, "id" | "createdAt" | "updatedAt">>): Promise<RssPolicy | undefined> {
    // RSS Policy는 싱글톤이므로 첫 번째 레코드를 업데이트하거나 생성
    const existingPolicy = await this.getRSSPolicy();

    if (existingPolicy) {
      const [updated] = await db
        .update(rssPolicy)
        .set({
          ...changes,
          updatedAt: new Date(),
        })
        .where(eq(rssPolicy.id, existingPolicy.id))
        .returning();
      return updated || undefined;
    } else {
      // 정책이 없으면 기본값으로 생성
      const [newPolicy] = await db
        .insert(rssPolicy)
        .values({
          ...changes,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();
      return newPolicy;
    }
  }

  // 건강도 스코어링 시스템
  async updateFeedHealthScore(feedId: number, success: boolean, errorMessage?: string): Promise<void> {
    const feed = await this.getRSSFeedById(feedId);
    if (!feed) return;

    let newHealthScore = feed.healthScore ?? 100;
    let newErrorCount = feed.errorCount ?? 0;
    let newLastError = feed.lastError;

    if (success) {
      // 성공시 건강도 증가, 에러 카운트 리셋
      newHealthScore = Math.min(100, newHealthScore + 5);
      newErrorCount = 0;
      newLastError = null;
    } else {
      // 실패시 건강도 감소, 에러 카운트 증가
      newHealthScore = Math.max(0, newHealthScore - 10);
      newErrorCount = newErrorCount + 1;
      newLastError = errorMessage || "Unknown error";
    }

    await this.updateNewRSSFeed(feedId, {
      healthScore: newHealthScore,
      errorCount: newErrorCount,
      lastError: newLastError,
      lastRunAt: new Date(),
      lastStatus: success ? "success" : "failed",
      // 건강도가 20 이하이고 연속 5회 실패시 자동 차단
      isBlocked: newHealthScore <= 20 && newErrorCount >= 5
    });
  }

  async getHealthyFeeds(): Promise<RssFeed[]> {
    return await db
      .select()
      .from(rssFeeds)
      .where(and(
        eq(rssFeeds.isBlocked, false),
        sql`${rssFeeds.healthScore} > 30`
      ))
      .orderBy(desc(rssFeeds.healthScore));
  }

  async getUnhealthyFeeds(): Promise<RssFeed[]> {
    return await db
      .select()
      .from(rssFeeds)
      .where(or(
        eq(rssFeeds.isBlocked, true),
        sql`${rssFeeds.healthScore} <= 30`,
        sql`${rssFeeds.errorCount} >= 3`
      ))
      .orderBy(asc(rssFeeds.healthScore));
  }

  // Feed 기준 1회 fetch 시스템
  async getFeedsReadyForSync(): Promise<RssFeed[]> {
    const now = new Date();
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    return await db
      .select()
      .from(rssFeeds)
      .where(and(
        eq(rssFeeds.isBlocked, false),
        or(
          isNull(rssFeeds.lastRunAt),
          lt(rssFeeds.lastRunAt, twelveHoursAgo)
        )
      ))
      .orderBy(asc(rssFeeds.lastRunAt));
  }

  async getActiveSubscriptionsForFeed(feedId: number): Promise<RssSubscription[]> {
    return await db
      .select()
      .from(rssSubscriptions)
      .where(and(
        eq(rssSubscriptions.feedId, feedId),
        eq(rssSubscriptions.enabled, true)
      ));
  }

  // ========================================
  // LEGACY RSS OPERATIONS (for backward compatibility)
  // ========================================

  // Legacy RSS feed operations - userRssFeeds 테이블 사용
  async getRSSFeeds(userId: number): Promise<UserRssFeed[]> {
    return await db
      .select()
      .from(userRssFeeds)
      .where(eq(userRssFeeds.userId, userId))
      .orderBy(desc(userRssFeeds.createdAt));
  }

  async getRSSFeed(id: number): Promise<UserRssFeed | undefined> {
    const [feed] = await db
      .select()
      .from(userRssFeeds)
      .where(eq(userRssFeeds.id, id));
    return feed || undefined;
  }

  async createRSSFeed(feed: Omit<UserRssFeed, "id" | "createdAt" | "lastFetchedAt" | "lastSuccessAt" | "errorCount" | "lastError">): Promise<UserRssFeed> {
    const [newFeed] = await db
      .insert(userRssFeeds)
      .values(feed)
      .returning();
    return newFeed;
  }

  async updateRSSFeed(id: number, changes: Partial<Omit<UserRssFeed, "id" | "userId" | "createdAt">>): Promise<UserRssFeed | undefined> {
    const [updated] = await db
      .update(userRssFeeds)
      .set(changes)
      .where(eq(userRssFeeds.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteRSSFeed(id: number): Promise<boolean> {
    try {
      // Get all documents associated with this RSS feed
      const feedDocuments = await db
        .select({ id: documents.id })
        .from(documents)
        .where(eq(documents.feedId, id));

      const documentIds = feedDocuments.map(doc => doc.id);

      // FIRST: Delete RSS articles that reference documents (to avoid FK constraint)
      await db.delete(rssArticles).where(eq(rssArticles.feedId, id));

      if (documentIds.length > 0) {
        // Delete in proper order to avoid foreign key constraints

        // 1. Delete translation attempts for sentences in these documents
        const feedSentences = await db
          .select({ id: sentences.id })
          .from(sentences)
          .innerJoin(paragraphs, eq(sentences.paragraphId, paragraphs.id))
          .where(inArray(paragraphs.documentId, documentIds));

        const sentenceIds = feedSentences.map(s => s.id);
        if (sentenceIds.length > 0) {
          await db.delete(translationAttempts).where(inArray(translationAttempts.sentenceId, sentenceIds));
          await db.delete(notebookSentences).where(inArray(notebookSentences.sentenceId, sentenceIds));
        }

        // 2. Delete sentences
        await db.delete(sentences)
          .where(inArray(sentences.paragraphId,
            db.select({ id: paragraphs.id })
              .from(paragraphs)
              .where(inArray(paragraphs.documentId, documentIds))
          ));

        // 3. Delete paragraphs
        await db.delete(paragraphs).where(inArray(paragraphs.documentId, documentIds));

        // 4. Delete glossary entries if they reference these documents
        await db.delete(glossary).where(inArray(glossary.documentId, documentIds));

        // 5. Delete notebooks associated with these documents
        await db.delete(notebooks).where(inArray(notebooks.documentId, documentIds));

        // 6. Delete documents
        await db.delete(documents).where(inArray(documents.id, documentIds));
      }

      // Finally delete the feed
      const result = await db.delete(userRssFeeds).where(eq(userRssFeeds.id, id));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error("Error deleting RSS feed:", error);
      return false;
    }
  }

  async updateRSSFeedSyncStatus(id: number, lastFetchedAt: Date, lastSuccessAt?: Date, errorCount?: number, lastError?: string): Promise<void> {
    const updates: any = { lastFetchedAt };

    if (lastSuccessAt) updates.lastSuccessAt = lastSuccessAt;
    if (errorCount !== undefined) updates.errorCount = errorCount;
    if (lastError !== undefined) updates.lastError = lastError;

    await db
      .update(userRssFeeds)
      .set(updates)
      .where(eq(userRssFeeds.id, id));
  }

  // RSS article operations
  async getRSSArticles(feedId: number): Promise<RssArticle[]> {
    return await db
      .select()
      .from(rssArticles)
      .where(eq(rssArticles.feedId, feedId))
      .orderBy(desc(rssArticles.publishedAt));
  }

  async getRSSArticle(id: number): Promise<RssArticle | undefined> {
    const [article] = await db
      .select()
      .from(rssArticles)
      .where(eq(rssArticles.id, id));
    return article || undefined;
  }

  async createRSSArticle(article: Omit<RssArticle, "id" | "createdAt">): Promise<RssArticle> {
    const [newArticle] = await db
      .insert(rssArticles)
      .values(article)
      .returning();
    return newArticle;
  }

  async updateRSSArticle(id: number, changes: Partial<Omit<RssArticle, "id" | "feedId" | "createdAt">>): Promise<RssArticle | undefined> {
    const [updated] = await db
      .update(rssArticles)
      .set(changes)
      .where(eq(rssArticles.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteRSSArticle(id: number): Promise<boolean> {
    try {
      const result = await db.delete(rssArticles).where(eq(rssArticles.id, id));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error("Error deleting RSS article:", error);
      return false;
    }
  }

  async getUnprocessedRSSArticles(feedId?: number): Promise<RssArticle[]> {
    const conditions = [eq(rssArticles.processed, false)];

    if (feedId) {
      conditions.push(eq(rssArticles.feedId, feedId));
    }

    return await db
      .select()
      .from(rssArticles)
      .where(and(...conditions))
      .orderBy(desc(rssArticles.publishedAt));
  }

  async markRSSArticleAsProcessed(id: number, documentId: number): Promise<void> {
    await db
      .update(rssArticles)
      .set({ processed: true, documentId })
      .where(eq(rssArticles.id, id));
  }

  // User Profile operations
  async getUserProfile(userId: number): Promise<UserProfile | undefined> {
    const [profile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    return profile || undefined;
  }

  async createUserProfile(profile: InsertUserProfile): Promise<UserProfile> {
    const [newProfile] = await db
      .insert(userProfiles)
      .values(profile)
      .returning();
    return newProfile;
  }

  async updateUserProfile(userId: number, changes: UpdateUserProfile): Promise<UserProfile | undefined> {
    const [updated] = await db
      .update(userProfiles)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(userProfiles.userId, userId))
      .returning();
    return updated || undefined;
  }

  // User Preferences operations
  async getUserPreferences(userId: number): Promise<UserPreferences | undefined> {
    const [preferences] = await db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId));
    return preferences || undefined;
  }

  async createUserPreferences(preferences: InsertUserPreferences): Promise<UserPreferences> {
    const [newPreferences] = await db
      .insert(userPreferences)
      .values(preferences)
      .returning();
    return newPreferences;
  }

  async updateUserPreferences(userId: number, changes: UpdateUserPreferences): Promise<UserPreferences | undefined> {
    const [updated] = await db
      .update(userPreferences)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(userPreferences.userId, userId))
      .returning();
    return updated || undefined;
  }

  // User Sources operations
  async getUserSources(userId: number): Promise<UserSource[]> {
    return await db
      .select()
      .from(userSources)
      .where(eq(userSources.userId, userId))
      .orderBy(desc(userSources.createdAt));
  }

  async getUserSource(id: number): Promise<UserSource | undefined> {
    const [source] = await db
      .select()
      .from(userSources)
      .where(eq(userSources.id, id));
    return source || undefined;
  }

  async createUserSource(source: InsertUserSource): Promise<UserSource> {
    const [newSource] = await db
      .insert(userSources)
      .values(source)
      .returning();
    return newSource;
  }

  async updateUserSource(id: number, changes: UpdateUserSource): Promise<UserSource | undefined> {
    const [updated] = await db
      .update(userSources)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(userSources.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteUserSource(id: number): Promise<boolean> {
    try {
      const result = await db.delete(userSources).where(eq(userSources.id, id));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error("Error deleting user source:", error);
      return false;
    }
  }

  // User Sessions operations
  async getUserSessions(userId: number): Promise<UserSession[]> {
    return await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.userId, userId))
      .orderBy(desc(userSessions.lastActivityAt));
  }

  async getUserSession(id: number): Promise<UserSession | undefined> {
    const [session] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.id, id));
    return session || undefined;
  }

  async getUserSessionByToken(sessionToken: string): Promise<UserSession | undefined> {
    const [session] = await db
      .select()
      .from(userSessions)
      .where(eq(userSessions.sessionToken, sessionToken));
    return session || undefined;
  }

  async createUserSession(session: InsertUserSession): Promise<UserSession> {
    const [newSession] = await db
      .insert(userSessions)
      .values(session)
      .returning();
    return newSession;
  }

  async updateUserSession(id: number, isActive: boolean): Promise<UserSession | undefined> {
    const [updated] = await db
      .update(userSessions)
      .set({ isActive, lastActivityAt: new Date() })
      .where(eq(userSessions.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteUserSession(id: number): Promise<boolean> {
    try {
      const result = await db.delete(userSessions).where(eq(userSessions.id, id));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error("Error deleting user session:", error);
      return false;
    }
  }

  async cleanupExpiredSessions(): Promise<number> {
    try {
      const result = await db
        .delete(userSessions)
        .where(lt(userSessions.expiresAt, new Date()));
      return result.rowCount ?? 0;
    } catch (error) {
      console.error("Error cleaning up expired sessions:", error);
      return 0;
    }
  }

  // Enhanced User operations
  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user || undefined;
  }

  async updateUser(id: number, updates: Partial<User>): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({ ...updates, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return updated || undefined;
  }

  async updateUserLoginAttempts(id: number, failedAttempts: number, lockedUntil?: Date): Promise<User | undefined> {
    const [updated] = await db
      .update(users)
      .set({
        failedAttempts,
        lockedUntil,
        updatedAt: new Date()
      })
      .where(eq(users.id, id))
      .returning();
    return updated || undefined;
  }

  // Helper function to get current KST date string (YYYY-MM-DD)
  private getKSTDateString(): string {
    const now = new Date();
    const kstOffset = 9 * 60; // KST is UTC+9
    const utcMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const kstMinutes = utcMinutes + kstOffset;
    
    // Adjust date if KST time crosses midnight
    const kstDate = new Date(now);
    if (kstMinutes >= 24 * 60) {
      kstDate.setUTCDate(kstDate.getUTCDate() + 1);
    }
    
    const year = kstDate.getUTCFullYear();
    const month = String(kstDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(kstDate.getUTCDate()).padStart(2, '0');
    
    return `${year}-${month}-${day}`;
  }

  async getDailyAiCount(userId: number): Promise<{ count: number; lastResetDate: string | null }> {
    const user = await this.getUser(userId);
    if (!user) {
      return { count: 0, lastResetDate: null };
    }
    return {
      count: user.dailyAiCount ?? 0,
      lastResetDate: user.lastResetDate ?? null
    };
  }

  async incrementDailyAiCount(userId: number): Promise<number> {
    // First, check and reset if needed
    await this.resetDailyAiCountIfNeeded(userId);
    
    // Then increment the count
    const [updated] = await db
      .update(users)
      .set({
        dailyAiCount: sql`${users.dailyAiCount} + 1`,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();
    
    return updated?.dailyAiCount ?? 0;
  }

  async resetDailyAiCountIfNeeded(userId: number): Promise<{ wasReset: boolean; currentCount: number }> {
    const user = await this.getUser(userId);
    if (!user) {
      return { wasReset: false, currentCount: 0 };
    }

    const currentKSTDate = this.getKSTDateString();
    const lastResetDate = user.lastResetDate;

    // If the date has changed since last reset, reset the counter
    if (lastResetDate !== currentKSTDate) {
      const [updated] = await db
        .update(users)
        .set({
          dailyAiCount: 0,
          lastResetDate: currentKSTDate,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId))
        .returning();
      
      return { wasReset: true, currentCount: 0 };
    }

    return { wasReset: false, currentCount: user.dailyAiCount ?? 0 };
  }

  // Refresh Token operations
  async createRefreshToken(token: InsertRefreshToken): Promise<RefreshToken> {
    const [newToken] = await db
      .insert(refreshTokens)
      .values(token)
      .returning();
    return newToken;
  }

  async getRefreshToken(tokenHash: string): Promise<RefreshToken | undefined> {
    const [token] = await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash));
    return token || undefined;
  }

  async getRefreshTokensByUserId(userId: number): Promise<RefreshToken[]> {
    return await db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.userId, userId))
      .orderBy(desc(refreshTokens.lastUsedAt));
  }

  async updateRefreshToken(id: number, updates: Partial<RefreshToken>): Promise<RefreshToken | undefined> {
    const [updated] = await db
      .update(refreshTokens)
      .set(updates)
      .where(eq(refreshTokens.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteRefreshToken(id: number): Promise<boolean> {
    try {
      const result = await db.delete(refreshTokens).where(eq(refreshTokens.id, id));
      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      console.error("Error deleting refresh token:", error);
      return false;
    }
  }

  async deleteRefreshTokensByUserId(userId: number): Promise<number> {
    try {
      const result = await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
      return result.rowCount ?? 0;
    } catch (error) {
      console.error("Error deleting refresh tokens for user:", error);
      return 0;
    }
  }

  async deleteExpiredRefreshTokens(): Promise<number> {
    try {
      const result = await db
        .delete(refreshTokens)
        .where(lt(refreshTokens.expiresAt, new Date()));
      return result.rowCount ?? 0;
    } catch (error) {
      console.error("Error cleaning up expired refresh tokens:", error);
      return 0;
    }
  }

  // Password Reset operations
  async createPasswordReset(reset: InsertPasswordReset): Promise<PasswordReset> {
    const [newReset] = await db
      .insert(passwordResets)
      .values(reset)
      .returning();
    return newReset;
  }

  async getPasswordReset(tokenHash: string): Promise<PasswordReset | undefined> {
    const [reset] = await db
      .select()
      .from(passwordResets)
      .where(and(
        eq(passwordResets.tokenHash, tokenHash),
        isNull(passwordResets.usedAt),
        sql`${passwordResets.expiresAt} > NOW()`
      ));
    return reset || undefined;
  }

  async markPasswordResetAsUsed(id: number): Promise<PasswordReset | undefined> {
    const [updated] = await db
      .update(passwordResets)
      .set({ usedAt: new Date() })
      .where(eq(passwordResets.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteExpiredPasswordResets(): Promise<number> {
    try {
      const result = await db
        .delete(passwordResets)
        .where(lt(passwordResets.expiresAt, new Date()));
      return result.rowCount ?? 0;
    } catch (error) {
      console.error("Error cleaning up expired password resets:", error);
      return 0;
    }
  }

  // Email Verification operations
  async createEmailVerification(verification: InsertEmailVerification): Promise<EmailVerification> {
    const [newVerification] = await db
      .insert(emailVerifications)
      .values(verification)
      .returning();
    return newVerification;
  }

  async getEmailVerification(tokenHash: string): Promise<EmailVerification | undefined> {
    const [verification] = await db
      .select()
      .from(emailVerifications)
      .where(and(
        eq(emailVerifications.tokenHash, tokenHash),
        isNull(emailVerifications.usedAt),
        sql`${emailVerifications.expiresAt} > NOW()`
      ));
    return verification || undefined;
  }

  async markEmailVerificationAsUsed(id: number): Promise<EmailVerification | undefined> {
    const [updated] = await db
      .update(emailVerifications)
      .set({ usedAt: new Date() })
      .where(eq(emailVerifications.id, id))
      .returning();
    return updated || undefined;
  }

  async deleteExpiredEmailVerifications(): Promise<number> {
    try {
      const result = await db
        .delete(emailVerifications)
        .where(lt(emailVerifications.expiresAt, new Date()));
      return result.rowCount ?? 0;
    } catch (error) {
      console.error("Error cleaning up expired email verifications:", error);
      return 0;
    }
  }

  // Audit Log operations
  async createAuditLog(log: InsertAuditLog): Promise<AuditLog> {
    const [newLog] = await db
      .insert(auditLogs)
      .values(log)
      .returning();
    return newLog;
  }

  async getAuditLogs(filters?: { userId?: number; eventType?: string; limit?: number; offset?: number }): Promise<AuditLog[]> {
    const conditions = [];

    if (filters?.userId) {
      conditions.push(eq(auditLogs.userId, filters.userId));
    }

    if (filters?.eventType) {
      conditions.push(eq(auditLogs.eventType, filters.eventType));
    }

    let query = db.select().from(auditLogs);

    if (conditions.length > 0) {
      query = query.where(and(...conditions)) as any;
    }

    query = query.orderBy(desc(auditLogs.createdAt)) as any;

    if (filters?.limit) {
      query = query.limit(filters.limit) as any;
    }

    if (filters?.offset) {
      query = query.offset(filters.offset) as any;
    }

    return await query;
  }

  // ========================================
  // NEW SCHEMA API METHODS (Instructions.md)
  // ========================================
  // Removed duplicate functions - already implemented above

  async getUserSentencesForPractice(userId: number, filters?: {
    bookmarked?: boolean;
    status?: string;
    limit?: number;
  }): Promise<Array<{
    id: number;
    text: string;
    isBookmarked: boolean | null;
    learningStatus: string;
    lastPracticedAt: Date | null;
  }>> {
    const conditions = [eq(userSentenceState.userId, userId)];

    if (filters?.bookmarked !== undefined) {
      conditions.push(eq(userSentenceState.isBookmarked, filters.bookmarked));
    }

    if (filters?.status) {
      conditions.push(eq(userSentenceState.learningStatus, filters.status as any));
    }

    let query = db
      .select({
        id: sentences.id,
        text: sentences.source,
        isBookmarked: sql<boolean>`COALESCE(${userSentenceState.isBookmarked}, false)`,
        learningStatus: userSentenceState.learningStatus,
        lastPracticedAt: userSentenceState.lastPracticedAt,
      })
      .from(userSentenceState)
      .innerJoin(sentences, eq(sentences.id, userSentenceState.sentenceId))
      .where(and(...conditions))
      .orderBy(asc(userSentenceState.lastPracticedAt), desc(sentences.id));

    if (filters?.limit) {
      query = query.limit(filters.limit) as any;
    }

    return await query;
  }

  // Note-Notebook relationship operations

  async removeNoteFromNotebook(noteId: number, notebookId: number, userId: number): Promise<void> {
    await db
      .delete(noteNotebooks)
      .where(and(
        eq(noteNotebooks.noteId, noteId),
        eq(noteNotebooks.notebookId, notebookId),
        eq(noteNotebooks.userId, userId)
      ));
  }

  async getNoteNotebooks(noteId: number): Promise<any[]> {
    return await db
      .select({
        notebookId: noteNotebooks.notebookId,
        userId: noteNotebooks.userId,
      })
      .from(noteNotebooks)
      .where(eq(noteNotebooks.noteId, noteId));
  }

  async getNotesInNotebook(notebookId: number, userId: number): Promise<Array<{
    sentenceId: number;
    sentenceText: string;
    noteId: number;
    noteContent: string | null;
    noteTags: string[] | null;
    notebookId: number;
  }>> {
    return await db
      .select({
        sentenceId: sentences.id,
        sentenceText: sentences.source,
        noteId: notes.id,
        noteContent: notes.content,
        noteTags: notes.tags,
        notebookId: noteNotebooks.notebookId,
      })
      .from(noteNotebooks)
      .innerJoin(notes, and(
        eq(notes.id, noteNotebooks.noteId),
        eq(notes.userId, noteNotebooks.userId)
      ))
      .innerJoin(sentences, eq(sentences.id, notes.sentenceId))
      .where(and(
        eq(noteNotebooks.notebookId, notebookId),
        eq(noteNotebooks.userId, userId)
      ))
      .orderBy(desc(notes.updatedAt));
  }

  // Enhanced Notes operations (Manual UPSERT since unique constraint removed for copy feature)
  // This finds the FIRST note for user+sentence (original note) and updates it, or creates new
  async upsertNote(data: InsertNotes): Promise<Notes> {
    // Find existing note for this user+sentence (only non-copied notes, i.e. original notes)
    const existingNotes = await db
      .select()
      .from(notes)
      .where(and(
        eq(notes.userId, data.userId),
        eq(notes.sentenceId, data.sentenceId),
        isNull(notes.copiedFromNoteId) // Only match original notes, not copies
      ))
      .limit(1);
    
    if (existingNotes.length > 0) {
      // Update existing note
      const [updated] = await db
        .update(notes)
        .set({
          content: data.content,
          color: data.color,
          tags: data.tags,
          updatedAt: new Date(),
        })
        .where(eq(notes.id, existingNotes[0].id))
        .returning();
      return updated;
    } else {
      // Insert new note
      const [inserted] = await db
        .insert(notes)
        .values(data)
        .returning();
      return inserted;
    }
  }

  // Copy notes to another notebook as independent entries
  async copyNotesToNotebook(noteIds: number[], targetNotebookId: number, userId: number): Promise<{ 
    success: boolean; 
    copiedCount: number;
    newNoteIds: number[];
    errors: string[];
  }> {
    const errors: string[] = [];
    const newNoteIds: number[] = [];
    
    // Verify target notebook belongs to user
    const [targetNotebook] = await db
      .select()
      .from(notebooks)
      .where(and(
        eq(notebooks.id, targetNotebookId),
        eq(notebooks.userId, userId)
      ));
    
    if (!targetNotebook) {
      return { success: false, copiedCount: 0, newNoteIds: [], errors: ['Target notebook not found or access denied'] };
    }
    
    for (const noteId of noteIds) {
      try {
        // Get original note
        const [originalNote] = await db
          .select()
          .from(notes)
          .where(and(
            eq(notes.id, noteId),
            eq(notes.userId, userId)
          ));
        
        if (!originalNote) {
          errors.push(`Note ${noteId} not found`);
          continue;
        }
        
        // Create a copy of the note
        const [copiedNote] = await db
          .insert(notes)
          .values({
            userId: originalNote.userId,
            sentenceId: originalNote.sentenceId,
            content: originalNote.content,
            color: originalNote.color,
            tags: originalNote.tags ? [...originalNote.tags] : null,
            copiedFromNoteId: originalNote.id,
          })
          .returning();
        
        // Link the copied note to the target notebook
        await db
          .insert(noteNotebooks)
          .values({
            noteId: copiedNote.id,
            notebookId: targetNotebookId,
            userId: userId,
          })
          .onConflictDoNothing();
        
        newNoteIds.push(copiedNote.id);
      } catch (error) {
        errors.push(`Failed to copy note ${noteId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
    
    return {
      success: errors.length === 0,
      copiedCount: newNoteIds.length,
      newNoteIds,
      errors,
    };
  }

  async getNoteByUserAndSentence(userId: number, sentenceId: number): Promise<Notes | undefined> {
    const [note] = await db
      .select()
      .from(notes)
      .where(and(
        eq(notes.userId, userId),
        eq(notes.sentenceId, sentenceId)
      ));
    return note || undefined;
  }

  // User Sentence State operations
  async getUserSentenceState(userId: number, sentenceId: number): Promise<UserSentenceState | undefined> {
    const [state] = await db
      .select()
      .from(userSentenceState)
      .where(
        and(
          eq(userSentenceState.userId, userId),
          eq(userSentenceState.sentenceId, sentenceId)
        )
      );

    return state || undefined;
  }

  async upsertUserSentenceState(data: InsertUserSentenceState): Promise<UserSentenceState> {
    const [state] = await db
      .insert(userSentenceState)
      .values({
        userId: data.userId,
        sentenceId: data.sentenceId,
        isBookmarked: data.isBookmarked || false,
        learningStatus: data.learningStatus || 'new',
        lastPracticedAt: data.lastPracticedAt || null,
      })
      .onConflictDoUpdate({
        target: [userSentenceState.userId, userSentenceState.sentenceId],
        set: {
          isBookmarked: data.isBookmarked,
          learningStatus: data.learningStatus,
          lastPracticedAt: data.lastPracticedAt,
        }
      })
      .returning();

    return state;
  }

  async updateUserSentenceBookmark(userId: number, sentenceId: number, isBookmarked: boolean): Promise<UserSentenceState> {
    return this.upsertUserSentenceState({
      userId,
      sentenceId,
      isBookmarked,
      learningStatus: 'new', // Default value
    });
  }

  async updateUserSentenceState(userId: number, sentenceId: number, updates: Partial<{
    aiCoachingCache: string;
    aiCoachingCachedAt: Date;
    isBookmarked: boolean;
    learningStatus: string;
    lastPracticedAt: Date;
  }>): Promise<UserSentenceState> {
    // First ensure the record exists
    const existing = await this.getUserSentenceState(userId, sentenceId);
    
    if (!existing) {
      // Create new record with defaults and updates
      const [state] = await db
        .insert(userSentenceState)
        .values({
          userId,
          sentenceId,
          isBookmarked: updates.isBookmarked ?? false,
          learningStatus: updates.learningStatus ?? 'new',
          lastPracticedAt: updates.lastPracticedAt ?? null,
          aiCoachingCache: updates.aiCoachingCache ?? null,
          aiCoachingCachedAt: updates.aiCoachingCachedAt ?? null,
        })
        .returning();
      return state;
    }

    // Update existing record
    const [state] = await db
      .update(userSentenceState)
      .set({
        ...(updates.aiCoachingCache !== undefined && { aiCoachingCache: updates.aiCoachingCache }),
        ...(updates.aiCoachingCachedAt !== undefined && { aiCoachingCachedAt: updates.aiCoachingCachedAt }),
        ...(updates.isBookmarked !== undefined && { isBookmarked: updates.isBookmarked }),
        ...(updates.learningStatus !== undefined && { learningStatus: updates.learningStatus }),
        ...(updates.lastPracticedAt !== undefined && { lastPracticedAt: updates.lastPracticedAt }),
      })
      .where(
        and(
          eq(userSentenceState.userId, userId),
          eq(userSentenceState.sentenceId, sentenceId)
        )
      )
      .returning();

    return state;
  }



  async getUserBookmarkedSentences(userId: number, filters?: {
    bookmarked?: boolean;
    status?: string;
    limit?: number;
  }): Promise<Array<{
    id: number;
    text: string;
    isBookmarked: boolean;
    learningStatus: string;
    lastPracticedAt?: Date | null;
  }>> {
    const conditions = [eq(userSentenceState.userId, userId)];

    if (filters?.bookmarked !== undefined) {
      conditions.push(eq(userSentenceState.isBookmarked, filters.bookmarked));
    }

    if (filters?.status) {
      conditions.push(eq(userSentenceState.learningStatus, filters.status as any));
    }

    let query = db
      .select({
        id: sentences.id,
        text: sentences.source,
        isBookmarked: sql<boolean>`COALESCE(${userSentenceState.isBookmarked}, false)`,
        learningStatus: userSentenceState.learningStatus,
        lastPracticedAt: userSentenceState.lastPracticedAt,
      })
      .from(userSentenceState)
      .innerJoin(sentences, eq(sentences.id, userSentenceState.sentenceId))
      .where(and(...conditions))
      .orderBy(asc(userSentenceState.lastPracticedAt), desc(sentences.id));

    if (filters?.limit) {
      query = query.limit(filters.limit) as any;
    }

    return await query;
  }

  async getUserSentenceStates(userId: number, sentenceIds: number[]): Promise<UserSentenceState[]> {
    if (sentenceIds.length === 0) return [];

    return await db
      .select()
      .from(userSentenceState)
      .where(and(
        eq(userSentenceState.userId, userId),
        inArray(userSentenceState.sentenceId, sentenceIds)
      ));
  }

  // AI Coaching cache operations
  async getAICoachingCache(userId: number, sentenceId: number): Promise<UserSentenceState | null> {
    const [state] = await db
      .select()
      .from(userSentenceState)
      .where(and(
        eq(userSentenceState.userId, userId),
        eq(userSentenceState.sentenceId, sentenceId)
      ));
    
    if (state && state.aiCoachingCache) {
      return state;
    }
    return null;
  }

  async saveAICoachingCache(userId: number, sentenceId: number, coachingData: string): Promise<void> {
    await db
      .insert(userSentenceState)
      .values({
        userId,
        sentenceId,
        isBookmarked: false,
        learningStatus: 'new',
        aiCoachingCache: coachingData,
        aiCoachingCachedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [userSentenceState.userId, userSentenceState.sentenceId],
        set: {
          aiCoachingCache: coachingData,
          aiCoachingCachedAt: new Date(),
        }
      });
  }

  // Phase 2: Language-agnostic coaching operations
  async getCoaching(sentenceId: number, mode: 'comprehension' | 'composition'): Promise<Coaching | undefined> {
    const [result] = await db
      .select()
      .from(coaching)
      .where(and(
        eq(coaching.sentenceId, sentenceId),
        eq(coaching.mode, mode)
      ))
      .orderBy(desc(coaching.createdAt))
      .limit(1);
    return result;
  }

  async saveCoaching(data: InsertCoaching): Promise<Coaching> {
    const [result] = await db
      .insert(coaching)
      .values(data)
      .returning();
    return result;
  }

  async getSentenceTranslation(sentenceId: number, sourceLanguage: string, targetLanguage: string): Promise<Translation | undefined> {
    const [result] = await db
      .select()
      .from(translations)
      .where(and(
        eq(translations.sentenceId, sentenceId),
        eq(translations.sourceLanguage, sourceLanguage),
        eq(translations.targetLanguage, targetLanguage)
      ))
      .orderBy(desc(translations.createdAt))
      .limit(1);
    return result;
  }

  async saveSentenceTranslation(data: InsertTranslation): Promise<Translation> {
    const [result] = await db
      .insert(translations)
      .values(data)
      .returning();
    return result;
  }

  async updateSentenceLanguage(sentenceId: number, language: string): Promise<void> {
    await db
      .update(sentences)
      .set({ language })
      .where(eq(sentences.id, sentenceId));
  }

  async updateNotebookLanguage(notebookId: number, language: string): Promise<void> {
    await db
      .update(notebooks)
      .set({ language })
      .where(eq(notebooks.id, notebookId));
  }

  async getUserNotesForSentences(userId: number, sentenceIds: number[]): Promise<any[]> {
    if (sentenceIds.length === 0) return [];

    // Only return notes that are connected to notebooks via note_notebooks
    return await db
      .select({
        id: notes.id,
        sentenceId: notes.sentenceId,
        content: notes.content,
        tags: notes.tags,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .innerJoin(noteNotebooks, eq(noteNotebooks.noteId, notes.id))
      .where(and(
        eq(notes.userId, userId),
        eq(noteNotebooks.userId, userId),
        inArray(notes.sentenceId, sentenceIds)
      ))
      .groupBy(notes.id, notes.sentenceId, notes.content, notes.tags, notes.createdAt, notes.updatedAt);
  }

  async addNoteToNotebook(noteId: number, notebookId: number, userId: number): Promise<void> {
    console.log(`[STORAGE] Adding note ${noteId} to notebook ${notebookId} for user ${userId}`);
    try {
      // First check if the relationship already exists
      const existing = await db
        .select()
        .from(noteNotebooks)
        .where(and(
          eq(noteNotebooks.noteId, noteId),
          eq(noteNotebooks.notebookId, notebookId),
          eq(noteNotebooks.userId, userId)
        ))
        .limit(1);

      if (existing.length > 0) {
        console.log(`[STORAGE] Note ${noteId} already linked to notebook ${notebookId}`);
        return;
      }

      // Insert the new relationship
      const result = await db
        .insert(noteNotebooks)
        .values({
          noteId,
          notebookId,
          userId,
        })
        .returning();

      console.log(`[STORAGE] Successfully added note to notebook:`, result);

      if (result.length === 0) {
        throw new Error(`Failed to insert note-notebook relationship: no rows affected`);
      }
    } catch (error) {
      console.error(`[STORAGE] Failed to add note ${noteId} to notebook ${notebookId}:`, error);
      throw error;
    }
  }

  // Search notes across all notebooks for a user
  async searchNotesAcrossAllNotebooks(userId: number, query: string) {
    try {
      // Get all notebooks for the user
      const userNotebooks = await this.getNotebooks(userId);
      
      const results: { [notebookId: number]: { notebook: any, sentences: any[] } } = {};
      
      // Search in each notebook
      for (const notebook of userNotebooks) {
        const sentences = await this.getSentencesInNotebook(notebook.id, userId);
        
        // Filter sentences by search query
        const filteredSentences = sentences.filter(sentence => {
          const queryLower = query.toLowerCase();
          
          // Search in note content
          if (sentence.noteContent && sentence.noteContent.toLowerCase().includes(queryLower)) {
            return true;
          }
          
          // Search in source text
          if (sentence.source && sentence.source.toLowerCase().includes(queryLower)) {
            return true;
          }
          
          // Search in target text
          if (sentence.target && sentence.target.toLowerCase().includes(queryLower)) {
            return true;
          }
          
          // Search in tags
          if (sentence.tags && Array.isArray(sentence.tags)) {
            const tagsMatch = sentence.tags.some(tag => 
              tag.toLowerCase().includes(queryLower)
            );
            if (tagsMatch) return true;
          }
          
          // Search for hashtag pattern (#tag)
          if (query.startsWith('#')) {
            const tagQuery = query.slice(1).toLowerCase();
            if (sentence.tags && Array.isArray(sentence.tags)) {
              return sentence.tags.some(tag => 
                tag.toLowerCase().includes(tagQuery)
              );
            }
          }
          
          return false;
        });
        
        // Only include notebooks that have matching sentences
        if (filteredSentences.length > 0) {
          results[notebook.id] = {
            notebook: notebook,
            sentences: filteredSentences
          };
        }
      }
      
      return results;
    } catch (error) {
      console.error(`[STORAGE] Error searching notes across notebooks for user ${userId}:`, error);
      throw error;
    }
  }

  // Get recent notes across all notebooks for a user
  async getRecentNotesAcrossAllNotebooks(userId: number, limit: number = 3) {
    try {
      console.log(`[STORAGE] Getting recent ${limit} notes for user ${userId}`);
      
      // Get all notebooks for the user
      const userNotebooks = await this.getNotebooks(userId);
      
      if (userNotebooks.length === 0) {
        return [];
      }
      
      // Get all notebook groups to look up group names
      const userGroups = await this.getNotebookGroups(userId);
      const groupMap = new Map(userGroups.map(g => [g.id, g.name]));
      
      // Collect all notes from all notebooks
      const allNotes: any[] = [];
      
      for (const notebook of userNotebooks) {
        const sentences = await this.getSentencesInNotebook(notebook.id, userId);
        
        // Look up group name from groupId
        const groupName = notebook.groupId ? groupMap.get(notebook.groupId) : null;
        
        // Add notebook info to each sentence (including group info)
        for (const sentence of sentences) {
          allNotes.push({
            ...sentence,
            notebookId: notebook.id,
            notebookTitle: notebook.title,
            notebookGroupId: notebook.groupId,
            notebookGroupLabel: groupName || notebook.groupLabel,
          });
        }
      }
      
      // Sort by noteUpdatedAt descending and take limit
      allNotes.sort((a, b) => {
        const dateA = new Date(a.noteUpdatedAt || a.noteCreatedAt).getTime();
        const dateB = new Date(b.noteUpdatedAt || b.noteCreatedAt).getTime();
        return dateB - dateA;
      });
      
      const result = allNotes.slice(0, limit);
      console.log(`[STORAGE] Returning ${result.length} recent notes`);
      
      return result;
    } catch (error) {
      console.error(`[STORAGE] Error getting recent notes for user ${userId}:`, error);
      throw error;
    }
  }

  // Delete all user-related data (but not the user record itself)
  async deleteUserData(userId: number): Promise<boolean> {
    try {
      console.log(`[STORAGE] Starting data deletion for user ${userId}`);

      // CRITICAL: Delete documents FIRST to leverage cascade deletes
      // Documents will cascade delete: paragraphs, sentences, notes, glossary, etc.
      // This prevents FK constraint violations

      // 1. Delete all documents owned by the user (with cascading deletes)
      const userDocs = await db.select().from(documents).where(eq(documents.userId, userId));
      console.log(`[STORAGE] Deleting ${userDocs.length} documents for user ${userId}`);
      
      for (const doc of userDocs) {
        await this.deleteDocument(doc.id); // Cascades to paragraphs, sentences, notes, etc.
      }

      // 2. Delete note-notebook relationships (must be before notebooks)
      await db.delete(noteNotebooks).where(eq(noteNotebooks.userId, userId));

      // 3. Delete notebook-sentence relationships
      const userNotebooks = await db.select().from(notebooks).where(eq(notebooks.userId, userId));
      const notebookIds = userNotebooks.map(nb => nb.id);
      if (notebookIds.length > 0) {
        await db.delete(notebookSentences).where(inArray(notebookSentences.notebookId, notebookIds));
      }

      // 4. Delete notebooks and notebook groups
      await db.delete(notebooks).where(eq(notebooks.userId, userId));
      await db.delete(notebookGroups).where(eq(notebookGroups.userId, userId));

      // 5. Delete remaining user-specific learning data
      await db.delete(translationAttempts).where(eq(translationAttempts.userId, userId));
      await db.delete(wordPracticeSessions).where(eq(wordPracticeSessions.userId, userId));
      await db.delete(practiceSessions).where(eq(practiceSessions.userId, userId));
      await db.delete(userProgress).where(eq(userProgress.userId, userId));
      
      // 6. Delete any remaining glossary entries (though deleteDocument should have handled most)
      await db.delete(glossary).where(eq(glossary.userId, userId));
      
      // 7. Delete any remaining notes and user sentence states (though deleteDocument should have handled these)
      await db.delete(notes).where(eq(notes.userId, userId));
      await db.delete(userSentenceState).where(eq(userSentenceState.userId, userId));

      // 8. Delete RSS subscriptions and feeds
      await db.delete(rssSubscriptions).where(eq(rssSubscriptions.userId, userId));
      await db.delete(userRssFeeds).where(eq(userRssFeeds.userId, userId));

      // 9. Delete user profile, preferences, sources, and sessions
      await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
      await db.delete(userPreferences).where(eq(userPreferences.userId, userId));
      await db.delete(userSources).where(eq(userSources.userId, userId));
      await db.delete(userSessions).where(eq(userSessions.userId, userId));

      // 10. Delete authentication-related data (refresh tokens, password resets, email verifications)
      await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
      await db.delete(passwordResets).where(eq(passwordResets.userId, userId));
      await db.delete(emailVerifications).where(eq(emailVerifications.userId, userId));

      // Note: auditLogs are kept for compliance/forensics purposes
      // translationCache is shared across users and not user-specific

      console.log(`[STORAGE] Successfully deleted all data for user ${userId}`);
      return true;
    } catch (error) {
      console.error(`[STORAGE] Error deleting user data for user ${userId}:`, error);
      throw error;
    }
  }

  // Delete the user account itself
  async deleteUser(userId: number): Promise<boolean> {
    try {
      console.log(`[STORAGE] Deleting user account ${userId}`);
      
      // This will also cascade delete to tables with onDelete: cascade:
      // - refreshTokens
      // - passwordResets
      // - emailVerifications
      // - auditLogs (if configured)
      const result = await db.delete(users).where(eq(users.id, userId)).returning();
      
      if (result.length === 0) {
        console.error(`[STORAGE] User ${userId} not found`);
        return false;
      }

      console.log(`[STORAGE] Successfully deleted user account ${userId}`);
      return true;
    } catch (error) {
      console.error(`[STORAGE] Error deleting user ${userId}:`, error);
      throw error;
    }
  }

  // Sync Log operations
  async createSyncLog(log: { sourceType: 'arxiv' | 'gutenberg' | 'rss'; status: 'success' | 'failed' | 'partial'; documentsAdded?: number; documentsSkipped?: number; errorMessage?: string; details?: any }): Promise<any> {
    try {
      const result = await db.execute(sql`
        INSERT INTO sync_logs (source_type, status, documents_added, documents_skipped, error_message, details)
        VALUES (${log.sourceType}, ${log.status}, ${log.documentsAdded || 0}, ${log.documentsSkipped || 0}, ${log.errorMessage || null}, ${JSON.stringify(log.details) || null}::jsonb)
        RETURNING *
      `);
      return result.rows[0];
    } catch (error) {
      console.error('[STORAGE] Error creating sync log:', error);
      throw error;
    }
  }

  async updateSyncLog(id: number, updates: { status?: 'success' | 'failed' | 'partial'; documentsAdded?: number; documentsSkipped?: number; errorMessage?: string; details?: any; completedAt?: Date }): Promise<any> {
    try {
      const setParts: string[] = [];
      const values: any[] = [];
      
      if (updates.status !== undefined) {
        setParts.push(`status = $${values.length + 1}`);
        values.push(updates.status);
      }
      if (updates.documentsAdded !== undefined) {
        setParts.push(`documents_added = $${values.length + 1}`);
        values.push(updates.documentsAdded);
      }
      if (updates.documentsSkipped !== undefined) {
        setParts.push(`documents_skipped = $${values.length + 1}`);
        values.push(updates.documentsSkipped);
      }
      if (updates.errorMessage !== undefined) {
        setParts.push(`error_message = $${values.length + 1}`);
        values.push(updates.errorMessage);
      }
      if (updates.details !== undefined) {
        setParts.push(`details = $${values.length + 1}::jsonb`);
        values.push(JSON.stringify(updates.details));
      }
      if (updates.completedAt !== undefined) {
        setParts.push(`completed_at = $${values.length + 1}`);
        values.push(updates.completedAt);
      }
      
      const result = await db.execute(sql`
        UPDATE sync_logs 
        SET ${sql.raw(setParts.join(', '))} 
        WHERE id = ${id}
        RETURNING *
      `);
      return result.rows[0];
    } catch (error) {
      console.error('[STORAGE] Error updating sync log:', error);
      throw error;
    }
  }

  async getSyncLogs(limit: number = 50): Promise<any[]> {
    try {
      const result = await db.execute(sql`
        SELECT * FROM sync_logs 
        ORDER BY started_at DESC 
        LIMIT ${limit}
      `);
      return result.rows;
    } catch (error) {
      console.error('[STORAGE] Error getting sync logs:', error);
      throw error;
    }
  }

  // Auto-approval keyword operations
  async getAutoApprovalKeywords(): Promise<any[]> {
    try {
      const result = await db.execute(sql`
        SELECT * FROM auto_approval_keywords 
        WHERE is_enabled = TRUE
        ORDER BY keyword
      `);
      return result.rows;
    } catch (error) {
      console.error('[STORAGE] Error getting auto-approval keywords:', error);
      throw error;
    }
  }

  async checkAutoApproval(title: string, abstract?: string): Promise<{ approved: boolean; matchedKeywords: string[] }> {
    try {
      const keywords = await this.getAutoApprovalKeywords();
      const textToCheck = `${title} ${abstract || ''}`.toLowerCase();
      const matchedKeywords: string[] = [];
      
      for (const kw of keywords) {
        const keyword = (kw.keyword as string).toLowerCase();
        if (textToCheck.includes(keyword)) {
          matchedKeywords.push(kw.keyword as string);
        }
      }
      
      return {
        approved: matchedKeywords.length > 0,
        matchedKeywords
      };
    } catch (error) {
      console.error('[STORAGE] Error checking auto-approval:', error);
      return { approved: false, matchedKeywords: [] };
    }
  }

  async incrementKeywordMatchCount(keyword: string): Promise<void> {
    try {
      await db.execute(sql`
        UPDATE auto_approval_keywords 
        SET match_count = match_count + 1, updated_at = NOW()
        WHERE keyword = ${keyword}
      `);
    } catch (error) {
      console.error('[STORAGE] Error incrementing keyword match count:', error);
    }
  }

}

export const storage = new DatabaseStorage();