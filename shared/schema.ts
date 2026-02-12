import { pgTable, text, serial, integer, boolean, timestamp, json, unique, primaryKey, real } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  // Enhanced security fields
  role: text("role", { enum: ["user", "admin", "moderator"] }).default("user").notNull(),
  email: text("email").unique(),
  emailVerifiedAt: timestamp("email_verified_at"),
  status: text("status", { enum: ["active", "locked", "pending"] }).default("pending").notNull(),
  failedAttempts: integer("failed_attempts").default(0).notNull(),
  lockedUntil: timestamp("locked_until"),
  lastLoginAt: timestamp("last_login_at"),
  passwordVersion: integer("password_version").default(1).notNull(),
  // Subscription plan for monetization
  plan: text("plan", { enum: ["starter", "pro", "admin"] }).default("starter").notNull(),
  // Specific plan type (e.g., 'pro_1month', 'pro_1year', 'starter')
  planType: text("plan_type").default("starter"),
  // Plan expiration date for non-auto-renewal subscriptions
  planExpiresAt: timestamp("plan_expires_at"),
  // Daily AI usage tracking for rate limiting
  dailyAiCount: integer("daily_ai_count").default(0).notNull(),
  lastResetDate: text("last_reset_date"), // KST date string (YYYY-MM-DD) for daily reset tracking
  // Starter plan lifetime usage counters
  documentsUploaded: integer("documents_uploaded").default(0).notNull(),
  ocrUsed: integer("ocr_used").default(0).notNull(),
  // OAuth fields
  oauthProvider: text("oauth_provider"), // 'google', 'github', etc. null for email/password users
  oauthProviderId: text("oauth_provider_id"), // Google's 'sub' claim or provider's user ID
  needsUsernameSetup: boolean("needs_username_setup").default(false), // Flag for first-time OAuth users
  // Language-agnostic learning settings (Phase 1)
  baseLanguage: text("base_language").default("ko").notNull(), // The language used for understanding explanations
  learningLanguage: text("learning_language").default("en").notNull(), // The language the user is actively learning
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// User profile information table
export const userProfiles = pgTable("user_profiles", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull().unique(),
  fullName: text("full_name"),
  email: text("email").unique(),
  avatarUrl: text("avatar_url"),
  bio: text("bio"),
  language: text("language").default("ko"), // 기본 인터페이스 언어
  timezone: text("timezone").default("Asia/Seoul"),
  isProfilePublic: boolean("is_profile_public").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// User preferences and viewer settings
export const userPreferences = pgTable("user_preferences", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull().unique(),
  // Viewer settings
  defaultViewerMode: text("default_viewer_mode").default("translation"), // "translation", "original", "side-by-side"
  fontSize: integer("font_size").default(16), // px
  lineHeight: integer("line_height").default(150), // percentage
  isDarkMode: boolean("is_dark_mode").default(false),
  // Translation settings
  defaultSourceLanguage: text("default_source_language").default("en"),
  defaultTargetLanguage: text("default_target_language").default("ko"),
  translationStyle: text("translation_style").default("natural"), // "natural", "literal", "academic"
  showTranslationHints: boolean("show_translation_hints").default(true),
  autoSaveTranslations: boolean("auto_save_translations").default(true),
  // Notification settings
  emailNotifications: boolean("email_notifications").default(true),
  practiceReminders: boolean("practice_reminders").default(true),
  weeklyReports: boolean("weekly_reports").default(true),
  // Learning settings
  dailyGoal: integer("daily_goal").default(10), // sentences per day
  practiceMode: text("practice_mode").default("mixed"), // "translation", "back-translation", "mixed"
  difficultyPreference: text("difficulty_preference").default("adaptive"), // "easy", "medium", "hard", "adaptive"
  // Notebook organization
  notebookGroups: text("notebook_groups"), // JSON array of created group names
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// User's personal sources (RSS feeds, bookmarks, etc.)
export const userSources = pgTable("user_sources", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  sourceType: text("source_type").notNull(), // "rss", "bookmark", "pocket", "instapaper"
  title: text("title").notNull(),
  url: text("url").notNull(),
  description: text("description"),
  category: text("category").default("General"),
  tags: text("tags"), // JSON array
  isEnabled: boolean("is_enabled").default(true),
  syncInterval: integer("sync_interval").default(12), // hours
  lastSyncAt: timestamp("last_sync_at"),
  lastStatus: text("last_status").default("pending"), // "success", "failed", "pending"
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Enhanced refresh token management with rotation tracking
export const refreshTokens = pgTable("refresh_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull().unique(), // Store hash only, never plaintext
  rotatedFromHash: text("rotated_from_hash"), // Track token rotation for forensics
  deviceLabel: text("device_label"), // User-editable device name for session management UI
  platform: text("platform"), // 'web', 'mobile', 'desktop' for filtering
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Password reset tokens (separate from sessions)
export const passwordResets = pgTable("password_resets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull(), // Hash-only storage (SHA-256+random salt)
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  ipAddress: text("ip_address"), // Track reset request origin
});

// Email verification tokens
export const emailVerifications = pgTable("email_verifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  tokenHash: text("token_hash").notNull(), // Hash-only storage (SHA-256+random salt)
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Audit log for security events
export const auditLogs = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id),
  eventType: text("event_type").notNull(), // 'login_success', 'login_failed', 'password_changed', etc.
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  details: json("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// User session management (keeping for compatibility)
export const userSessions = pgTable("user_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  sessionToken: text("session_token").notNull().unique(),
  deviceInfo: text("device_info"), // User agent, device type etc.
  ipAddress: text("ip_address"),
  isActive: boolean("is_active").default(true),
  lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  sourceLanguage: text("source_language").notNull(),
  targetLanguage: text("target_language").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  publishedAt: timestamp("published_at"), // Original publication date from source
  lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(), // For sorting by recent activity
  userId: integer("user_id").references(() => users.id),
  progress: integer("progress").default(0),
  fileType: text("file_type").default("text"), // "pdf", "docx", "txt", "text"
  isArchived: boolean("is_archived").default(false), // Archive status for document management
  sourceType: text("source_type", { enum: ["uploaded", "explore"] }).notNull().default("uploaded"), // Source type for document management
  origin: json("origin").$type<{ provider?: string; sourceId?: string; url?: string; }>(), // Origin metadata for explore documents
  // Public content library fields
  author: text("author"), // Author name for library content
  source: text("source"), // "gutenberg", "user", "guardian", etc.
  category: text("category", { enum: ["Academic", "Literature", "News", "Essays"] }).notNull(), // 4-category system
  difficulty: text("difficulty"), // "beginner", "intermediate", "advanced"
  tags: text("tags"), // JSON array for topic/category tags
  originalUrl: text("original_url"), // Source URL
  licenseType: text("license_type"), // "public_domain", "cc", etc.
  isPublic: boolean("is_public").default(false), // Whether this is public library content
  isPermanent: boolean("is_permanent").default(false), // Foundation Classics - never auto-expire
  expiresAt: timestamp("expires_at"), // Auto-cleanup date for public content
  feedId: integer("feed_id").references(() => rssFeeds.id), // RSS 피드와의 관계
  // Thumbnail image fields
  thumbnailUrl: text("thumbnail_url"), // Public URL for serving the thumbnail
  thumbnailPath: text("thumbnail_path"), // Internal storage path
  originalImageUrl: text("original_image_url"), // Original source image URL
  thumbnailStatus: text("thumbnail_status", { enum: ["pending", "processing", "success", "failed"] }).default("pending"), // Status of thumbnail extraction
  dominantColor: text("dominant_color"), // Hex color for fallback backgrounds
  blurhash: text("blurhash"), // Blurhash for progressive loading
  // Structured view content blocks
  // Type union includes translatable blocks (heading, paragraph, abstract_body) and metadata blocks (doi, author, journal, affiliation, abstract_label)
  structuredContent: json("structured_content").$type<{
    type: "heading" | "paragraph" | "abstract_body" | "abstract_label" | "doi" | "author" | "journal" | "affiliation" | "image" | "table" | "list" | "code" | "quote" | "figure";
    order: number;
    page?: number;
    caption?: string;
    origin?: { page: number; bbox: [number, number, number, number] };
    src?: string; // For images
    html?: string; // For tables  
    imageSnapshot?: boolean;
    level?: number; // For headings
    content?: string; // For text blocks
    sentences?: Array<{ id: string; text: string; order: number }>; // STRUCTURAL FIX: Translatable blocks own sentences[]
    anchor?: { sentenceStartId: number; sentenceEndId: number }; // Sentence ID range for precise mapping
  }[]>(), // Structured blocks for enhanced viewer
  structuredVersion: integer("structured_version"), // Version for structured content rules migration
  contentSourceType: text("content_source_type", { enum: ["html", "text", "pdf", "rss_html"] }), // Processing pipeline type
  anchorSchemaVersion: integer("anchor_schema_version").default(1), // Anchor format version for migration
  tokenizerVersion: text("tokenizer_version"), // STEP 3 FIX: Track sentence splitting version for consistency
  processingState: text("processing_state", { enum: ["pending", "ps_committed", "structured_ready", "completed", "structure_only"] }).default("pending"), // Processing state tracking
  rawContent: text("raw_content"), // Raw HTML/text content for structure_only documents
  // Translation status tracking
  translationStatus: text("translation_status", { enum: ["idle", "running", "completed", "failed"] }).default("idle"), // Translation job status
  translationProgress: integer("translation_progress").default(0), // Translation progress (0-100)
  translatedCount: integer("translated_count").default(0), // Number of translated sentences
  totalCount: integer("total_count").default(0), // Total number of sentences
  translationUpdatedAt: timestamp("translation_updated_at"), // Last translation update timestamp
  translationError: text("translation_error"), // Translation error message if failed
  // AI-generated document summaries (multilingual)
  summaryEn: text("summary_en"), // English summary (3-5 sentences)
  summaryKo: text("summary_ko"), // Korean summary (3-5 sentences)
  // Document archetype fields per instructions.md - determines parsing strategy
  archetype: text("archetype", { enum: ["academic", "literary", "essay", "generic"] }).default("generic"), // Structural interpretation strategy
  archetypeConfidence: real("archetype_confidence").default(0), // 0-1 confidence score
  archetypeSource: text("archetype_source", { enum: ["source", "auto", "user"] }).default("auto"), // How archetype was determined
});

export const paragraphs = pgTable("paragraphs", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").references(() => documents.id).notNull(),
  order: integer("order").notNull(),
  title: text("title"),
});

export const sentences = pgTable("sentences", {
  id: serial("id").primaryKey(),
  paragraphId: integer("paragraph_id").references(() => paragraphs.id).notNull(),
  order: integer("order").notNull(),
  source: text("source").notNull(),
  sourceHash: text("source_hash"), // STEP 2 FIX: Store normalized hash for consistent anchor matching
  target: text("target"),
  targetAi: text("target_ai"), // AI-generated original translation (immutable, for comparison)
  targetEdited: text("target_edited"), // User-edited translation (displayed, modifiable)
  language: text("language"), // The language of this specific sentence (Phase 1: language-agnostic)
});

// Translation cache table - stores previously translated text
export const translationCache = pgTable("translation_cache", {
  id: serial("id").primaryKey(),
  sourceText: text("source_text").notNull(),
  targetText: text("target_text").notNull(),
  sourceLanguage: text("source_language").notNull(), 
  targetLanguage: text("target_language").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  usageCount: integer("usage_count").default(1).notNull(),
  lastUsed: timestamp("last_used").defaultNow().notNull(),
});

// User sentence state table for learning and bookmark status
export const userSentenceState = pgTable("user_sentence_state", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  sentenceId: integer("sentence_id").references(() => sentences.id, { onDelete: "cascade" }).notNull(),
  isBookmarked: boolean("is_bookmarked").default(false),
  learningStatus: text("learning_status", { enum: ["new", "learning", "review", "mastered"] }).default("new").notNull(),
  lastPracticedAt: timestamp("last_practiced_at"),
  aiCoachingCache: text("ai_coaching_cache"),
  aiCoachingCachedAt: timestamp("ai_coaching_cached_at"),
  // Phase 3: Mastery tracking for quiz system
  masteryLevel: integer("mastery_level").default(0).notNull(), // 0=new, 1=learning, 2=mastered (0-5 for SRS)
  correctStreak: integer("correct_streak").default(0).notNull(), // Consecutive correct answers
  lastReviewedAt: timestamp("last_reviewed_at"), // Last quiz review timestamp
  nextReviewDate: timestamp("next_review_date"), // SRS: Next scheduled review date (Leitner algorithm)
}, (table) => ({
  userSentenceUnique: unique().on(table.userId, table.sentenceId),
}));

// Notebook Groups table for logical grouping of notebooks
export const notebookGroups = pgTable("notebook_groups", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  name: text("name").notNull(),
  color: text("color").default("blue"), // Color theme for the group
  icon: text("icon").default("📁"), // Emoji icon for visual identification
  order: integer("order").default(0), // Display order
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  // Ensure unique group names per user
  userGroupUnique: unique().on(table.userId, table.name),
}));

// Notebooks table for organizing sentence collections
export const notebooks = pgTable("notebooks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  tags: text("tags"), // JSON array for topic/category tags
  type: text("type").default("user"), // "user" or "system" (auto-generated)
  documentId: integer("document_id").references(() => documents.id), // Optional reference for document-based notebooks
  isPublic: boolean("is_public").default(false),
  colorLabel: text("color_label"), // Color label for visual organization (blue, green, purple, etc.)
  // New logical groups system
  groupId: integer("group_id").references(() => notebookGroups.id), // FK to notebook_groups (null = ungrouped)
  // Legacy group fields - will be removed after migration
  groupLabel: text("group_label"), // DEPRECATED: Group label for organizing notebooks into sections
  groupOrder: integer("group_order").default(0), // Order within the group
  language: text("language"), // The actual language of the notebook's content (Phase 1: language-agnostic)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
});

// Junction table for notebook-sentence relationships (simplified)
export const notebookSentences = pgTable("notebook_sentences", {
  id: serial("id").primaryKey(),
  notebookId: integer("notebook_id").references(() => notebooks.id).notNull(),
  sentenceId: integer("sentence_id").references(() => sentences.id).notNull(),
  addedAt: timestamp("added_at").defaultNow().notNull(),
});

// Note-notebook relationship table
export const noteNotebooks = pgTable("note_notebooks", {
  noteId: integer("note_id").references(() => notes.id, { onDelete: "cascade" }).notNull(),
  notebookId: integer("notebook_id").references(() => notebooks.id, { onDelete: "cascade" }).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.notebookId, table.noteId] }),
}));

// Valid note/highlight colors - shared between client and server
export const NOTE_COLORS = ["yellow", "red", "blue", "green", "orange", "purple", "pink"] as const;
export type NoteColor = typeof NOTE_COLORS[number];

// Notes table for storing user notes on sentences (single source of truth)
// Unified model: content=null means highlight-only note, content!=null means note with content
// Note: userId+sentenceId is NOT unique to support copying notes to multiple notebooks as independent entries
export const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  sentenceId: integer("sentence_id").references(() => sentences.id, { onDelete: "cascade" }).notNull(),
  content: text("content"), // Nullable to support highlight-only notes
  color: text("color", { enum: NOTE_COLORS }).default("yellow"), // Color for highlights/notes
  tags: text("tags").array(), // JSON array for tags
  copiedFromNoteId: integer("copied_from_note_id"), // Track original note if this is a copy
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Glossary table for user vocabulary
export const glossary = pgTable("glossary", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  term: text("term").notNull(),
  definition: text("definition"),
  translation: text("translation"),
  pronunciation: text("pronunciation"),
  difficulty: text("difficulty").notNull().default("beginner"), // "beginner", "intermediate", "advanced"
  sourceLanguage: text("source_language").notNull().default("English"),
  targetLanguage: text("target_language").notNull().default("Korean"),
  contextSentence: text("context_sentence"),
  documentId: integer("document_id").references(() => documents.id),
  sentenceId: integer("sentence_id").references(() => sentences.id, { onDelete: "set null" }),
  notes: text("notes"),
  tags: text("tags"), // JSON array stored as text
  createdAt: timestamp("created_at").defaultNow().notNull(),
  lastReviewed: timestamp("last_reviewed"),
  reviewCount: integer("review_count").default(0),
  // 단어 학습 관련 필드들 추가
  masteryLevel: integer("mastery_level").default(1), // 숙련도 (1-5)
  correctCount: integer("correct_count").default(0), // 정답 횟수
  incorrectCount: integer("incorrect_count").default(0), // 오답 횟수
  nextReviewDate: timestamp("next_review_date"), // 다음 복습 예정일
});

// User glossary state table for learning progress (separate from glossary content)
// Mirrors userSentenceState design pattern for consistency
export const userGlossaryState = pgTable("user_glossary_state", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  glossaryId: integer("glossary_id").references(() => glossary.id, { onDelete: "cascade" }).notNull(),
  // SRS and mastery tracking (matches userSentenceState pattern)
  masteryLevel: integer("mastery_level").default(0).notNull(), // 0-5 for Leitner boxes
  correctStreak: integer("correct_streak").default(0).notNull(), // Consecutive correct answers
  lastReviewedAt: timestamp("last_reviewed_at"),
  nextReviewDate: timestamp("next_review_date"), // SRS: Next scheduled review date
  // Self-rating history for flashcard mode
  lastRating: text("last_rating", { enum: ["again", "hard", "good"] }), // Last self-rating
  totalReviews: integer("total_reviews").default(0).notNull(),
  correctCount: integer("correct_count").default(0).notNull(),
  incorrectCount: integer("incorrect_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userGlossaryUnique: unique().on(table.userId, table.glossaryId),
}));

// Translation attempts table for storing practice history
export const translationAttempts = pgTable("translation_attempts", {
  id: serial("id").primaryKey(),
  sentenceId: integer("sentence_id").references(() => sentences.id, { onDelete: "cascade" }).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  userTranslation: text("user_translation").notNull(),
  score: integer("score"), // GPT score out of 10
  grade: text("grade"), // Grade like "A", "B+", etc.
  feedback: text("feedback"), // GPT feedback text
  suggestedCorrection: text("suggested_correction"), // GPT suggested improvement
  backTranslation: text("back_translation"), // Back translated text
  backTranslationFeedback: text("back_translation_feedback"), // Feedback on back translation
  practiceMode: text("practice_mode").default("individual"), // "individual", "quiz", "flashcard"
  mode: text("mode").default("translation"), // "translation" or "back-translation"
  timeSpent: integer("time_spent"), // seconds spent on this attempt
  isCorrect: boolean("is_correct"), // Whether the attempt was correct
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// User progress tracking
export const userProgress = pgTable("user_progress", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  totalSentences: integer("total_sentences").default(0),
  completedSentences: integer("completed_sentences").default(0),
  practiceStreak: integer("practice_streak").default(0),
  averageScore: integer("average_score").default(0),
  weeklyGoal: integer("weekly_goal").default(0),
  currentWeekProgress: integer("current_week_progress").default(0),
  lastActiveDate: timestamp("last_active_date"),
  achievements: text("achievements"), // JSON stored achievements
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Word practice sessions table for tracking learning activities
export const wordPracticeSessions = pgTable("word_practice_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  wordId: integer("word_id").references(() => glossary.id).notNull(),
  sessionType: text("session_type").notNull(), // 'flashcard' | 'quiz'
  isCorrect: boolean("is_correct").notNull(),
  timeSpent: integer("time_spent"), // seconds
  questionType: text("question_type"), // 'meaning' | 'translation' | 'pronunciation'
  selectedAnswer: text("selected_answer"), // for quiz mode
  correctAnswer: text("correct_answer"), // for quiz mode
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Practice sessions table for tracking sentence practice sessions
export const practiceSessions = pgTable("practice_sessions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  title: text("title"), // Optional session title
  totalSentences: integer("total_sentences").notNull(),
  completedSentences: integer("completed_sentences").default(0).notNull(),
  skippedSentences: integer("skipped_sentences").default(0).notNull(),
  averageScore: integer("average_score").default(0),
  totalTimeSpent: integer("total_time_spent").default(0), // seconds
  status: text("status").default("active").notNull(), // "active", "completed", "paused"
  sessionData: text("session_data"), // JSON with sentence IDs, current index, progress
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// RSS Feed/Subscription tables (계획안에 따른 분리 모델)
// Feed: 전역 canonical 피드 관리
export const rssFeeds = pgTable("rss_feeds", {
  id: serial("id").primaryKey(),
  canonicalUrl: text("canonical_url").notNull().unique(), // 정규화된 URL
  normalizedUrlHash: text("normalized_url_hash").notNull().unique(), // 중복 검사용 해시
  title: text("title").notNull(), // 피드 제목
  description: text("description"), // 피드 설명
  language: text("language").default("en"), // 피드 언어
  category: text("category").default("RSS Feed"), // 문서 카테고리
  etag: text("etag"), // HTTP ETag for 효율적 fetching
  lastModified: text("last_modified"), // HTTP Last-Modified
  healthScore: integer("health_score").default(100), // 건강도 점수 (0-100)
  lastRunAt: timestamp("last_run_at"), // 마지막 실행 시간
  lastStatus: text("last_status").default("pending"), // "success", "failed", "pending"
  errorCount: integer("error_count").default(0), // 연속 실패 횟수
  lastError: text("last_error"), // 마지막 에러 메시지
  isBlocked: boolean("is_blocked").default(false), // 관리자 차단 여부
  isSystemSource: boolean("is_system_source").default(false), // 시스템 소스 여부
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Subscription: 사용자별 피드 구독 관리
export const rssSubscriptions = pgTable("rss_subscriptions", {
  id: serial("id").primaryKey(),
  feedId: integer("feed_id").references(() => rssFeeds.id).notNull(),
  userId: integer("user_id").references(() => users.id).notNull(),
  alias: text("alias").notNull(), // 사용자 지정 피드 이름
  visibility: text("visibility").default("private"), // "private", "team:{id}", "org"
  enabled: boolean("enabled").default(true), // 개별 구독 활성화 상태
  userTags: text("user_tags"), // JSON 배열: 사용자 개인 태그
  notifyPolicy: text("notify_policy").default("none"), // "none", "all", "important"
  syncInterval: integer("sync_interval").default(12), // 사용자별 동기화 주기 (시간)
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// RSS Policy: 관리자 정책 설정
export const rssPolicy = pgTable("rss_policy", {
  id: serial("id").primaryKey(),
  maxFeedsPerUser: integer("max_feeds_per_user").default(10), // 사용자당 최대 피드 수
  minSyncInterval: integer("min_sync_interval").default(1), // 최소 동기화 주기 (시간)
  maxSyncInterval: integer("max_sync_interval").default(168), // 최대 동기화 주기 (시간)
  dailyFetchLimit: integer("daily_fetch_limit").default(1000), // 일일 fetch 제한
  allowedDomains: text("allowed_domains"), // JSON 배열: 허용 도메인
  blockedDomains: text("blocked_domains"), // JSON 배열: 차단 도메인
  requireApproval: boolean("require_approval").default(false), // 신규 피드 승인 필요 여부
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const rssArticles = pgTable("rss_articles", {
  id: serial("id").primaryKey(),
  feedId: integer("feed_id").references(() => rssFeeds.id).notNull(),
  title: text("title").notNull(),
  link: text("link").notNull(),
  content: text("content"),
  description: text("description"),
  author: text("author"),
  publishedAt: timestamp("published_at"),
  guid: text("guid").notNull(), // 중복 방지용
  documentId: integer("document_id").references(() => documents.id), // 변환된 문서 ID
  processed: boolean("processed").default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 하위 호환성을 위한 별칭 (기존 코드 지원)
export const userRssFeeds = rssSubscriptions;

// ============================================
// Phase 1: Language-Agnostic Models
// ============================================

// Translation model - stores multiple translations for different language pairs
export const translations = pgTable("translations", {
  id: serial("id").primaryKey(),
  sentenceId: integer("sentence_id").references(() => sentences.id, { onDelete: "cascade" }).notNull(),
  sourceLanguage: text("source_language").notNull(), // Language of the source sentence
  targetLanguage: text("target_language").notNull(), // Usually user's baseLanguage or learningLanguage
  text: text("text").notNull(), // The translated text
  origin: text("origin", { enum: ["ai", "user"] }).notNull(), // 'ai' for AI-generated, 'user' for user-edited
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Coaching model - stores AI explanations for each sentence depending on learning mode
export const coaching = pgTable("coaching", {
  id: serial("id").primaryKey(),
  sentenceId: integer("sentence_id").references(() => sentences.id, { onDelete: "cascade" }).notNull(),
  mode: text("mode", { enum: ["comprehension", "composition"] }).notNull(), // 'comprehension' (learning→base) or 'composition' (base→learning)
  explanation: text("explanation").notNull(), // In user's baseLanguage
  suggestion: text("suggestion"), // In user's learningLanguage
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================
// Phase 3: Quiz System Models
// ============================================

// Quiz Results - stores individual quiz attempt results
export const quizResults = pgTable("quiz_results", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  sentenceId: integer("sentence_id").references(() => sentences.id, { onDelete: "cascade" }).notNull(),
  mode: text("mode", { enum: ["comprehension", "production"] }).notNull(), // Quiz mode
  userAnswer: text("user_answer").notNull(), // User's submitted answer
  isCorrect: boolean("is_correct").notNull(), // Whether the answer was correct
  // Future-proofing: Store language context at time of quiz
  userBaseLanguage: text("user_base_language").notNull(), // User's baseLanguage when quiz was taken
  userLearningLanguage: text("user_learning_language").notNull(), // User's learningLanguage when quiz was taken
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Insert schemas for new tables
export const insertUserSentenceStateSchema = createInsertSchema(userSentenceState).omit({
  id: true,
});

export const insertNoteNotebooksSchema = createInsertSchema(noteNotebooks);

export const insertNotesSchema = createInsertSchema(notes).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertNotebooksSchema = createInsertSchema(notebooks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  email: true,
  role: true,
  emailVerifiedAt: true,
  oauthProvider: true,
  oauthProviderId: true,
  needsUsernameSetup: true,
});

export const insertRefreshTokenSchema = createInsertSchema(refreshTokens).pick({
  userId: true,
  tokenHash: true,
  rotatedFromHash: true,
  deviceLabel: true,
  platform: true,
  userAgent: true,
  ipAddress: true,
  expiresAt: true,
});

export const insertPasswordResetSchema = createInsertSchema(passwordResets).pick({
  userId: true,
  tokenHash: true,
  expiresAt: true,
  ipAddress: true,
});

export const insertEmailVerificationSchema = createInsertSchema(emailVerifications).pick({
  userId: true,
  tokenHash: true,
  expiresAt: true,
});

export const insertAuditLogSchema = createInsertSchema(auditLogs).pick({
  userId: true,
  eventType: true,
  ipAddress: true,
  userAgent: true,
  details: true,
});

// Type definitions for new schema
export type UserSentenceState = typeof userSentenceState.$inferSelect;
export type InsertUserSentenceState = z.infer<typeof insertUserSentenceStateSchema>;

export type NoteNotebooks = typeof noteNotebooks.$inferSelect;
export type InsertNoteNotebooks = z.infer<typeof insertNoteNotebooksSchema>;

export type Notes = typeof notes.$inferSelect;
export type InsertNotes = z.infer<typeof insertNotesSchema>;

export type Notebooks = typeof notebooks.$inferSelect;
export type InsertNotebooks = z.infer<typeof insertNotebooksSchema>;

// Type definitions for authentication system
export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type InsertRefreshToken = z.infer<typeof insertRefreshTokenSchema>;
export type PasswordReset = typeof passwordResets.$inferSelect;
export type InsertPasswordReset = z.infer<typeof insertPasswordResetSchema>;
export type EmailVerification = typeof emailVerifications.$inferSelect;
export type InsertEmailVerification = z.infer<typeof insertEmailVerificationSchema>;
export type AuditLog = typeof auditLogs.$inferSelect;
export type InsertAuditLog = z.infer<typeof insertAuditLogSchema>;

// Auth-related validation schemas
export const loginSchema = z.object({
  email: z.string().email("올바른 이메일 주소를 입력해주세요"),
  password: z.string().min(1, "비밀번호를 입력해주세요"),
});

export const signupSchema = z.object({
  username: z.string()
    .min(3, "사용자명은 최소 3자 이상이어야 합니다")
    .max(20, "사용자명은 최대 20자까지 가능합니다")
    .regex(/^[a-zA-Z0-9_]+$/, "사용자명은 영문, 숫자, 밑줄(_)만 사용 가능합니다"),
  email: z.string().email("올바른 이메일 주소를 입력해주세요"),
  password: z.string()
    .min(8, "비밀번호는 최소 8자 이상이어야 합니다")
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, "비밀번호는 영문 대소문자와 숫자를 포함해야 합니다"),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("올바른 이메일 주소를 입력해주세요"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "토큰이 필요합니다"),
  newPassword: z.string()
    .min(8, "비밀번호는 최소 8자 이상이어야 합니다")
    .regex(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, "비밀번호는 영문 대소문자와 숫자를 포함해야 합니다"),
});

export const insertDocumentSchema = createInsertSchema(documents).pick({
  title: true,
  sourceLanguage: true,
  targetLanguage: true,
  userId: true,
});

export const insertLibraryDocumentSchema = createInsertSchema(documents).pick({
  title: true,
  sourceLanguage: true,
  targetLanguage: true,
  author: true,
  source: true,
  category: true,
  difficulty: true,
  tags: true,
  originalUrl: true,
  licenseType: true,
  isPublic: true,
});

export const insertParagraphSchema = createInsertSchema(paragraphs).pick({
  documentId: true,
  order: true,
  title: true,
});

export const insertSentenceSchema = createInsertSchema(sentences).pick({
  paragraphId: true,
  order: true,
  source: true,
  sourceHash: true,
  target: true,
});

export const insertTranslationCacheSchema = createInsertSchema(translationCache).pick({
  sourceText: true,
  targetText: true,
  sourceLanguage: true,
  targetLanguage: true,
  usageCount: true,
  lastUsed: true,
});

export const updateSentenceSchema = z.object({
  isScrapped: z.boolean().optional(),
  note: z.string().nullable().optional(),
  target: z.string().nullable().optional(),
  targetEdited: z.string().nullable().optional(),
  userTranslation: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),
  practiced: z.boolean().optional(),
  practiceHistory: z.string().nullable().optional(),
  lastPracticedAt: z.date().optional(),
  status: z.enum(["new", "practicing", "completed", "mastered"]).optional(),
  practiceCount: z.number().optional(),
  userFeedback: z.string().nullable().optional(),
  styleVariations: z.string().nullable().optional(),
  notebookName: z.string().nullable().optional(),
  isFavorite: z.boolean().optional(),
});

export const updateDocumentSchema = z.object({
  title: z.string().optional(),
  author: z.string().optional(),
  category: z.string().optional(),
  tags: z.string().optional().refine((val) => {
    if (!val) return true; // Allow null/undefined
    try {
      const parsed = JSON.parse(val);
      return Array.isArray(parsed) && parsed.every(item => typeof item === 'string');
    } catch {
      return false;
    }
  }, "tags must be a valid JSON array of strings"), // JSON array for topic/category tags
  isPublic: z.boolean().optional(),
  thumbnailUrl: z.string().optional(),
  thumbnailPath: z.string().optional(),
  originalImageUrl: z.string().optional(),
  thumbnailStatus: z.enum(["pending", "processing", "success", "failed"]).optional(),
  dominantColor: z.string().optional(),
  blurhash: z.string().optional(),
  progress: z.number().optional(),
  isArchived: z.boolean().optional(),
  structuredContent: z.string().optional(), // JSON string for structured content blocks
  structuredVersion: z.number().optional(), // Version for structured content rules migration
  contentSourceType: z.string().optional(), // "html", "text", "pdf" for processing pipeline
  anchorSchemaVersion: z.number().optional(), // Anchor format version for migration
  tokenizerVersion: z.string().optional(), // Track sentence splitting version for consistency  
  processingState: z.enum(["pending", "ps_committed", "structured_ready", "completed"]).optional(), // Processing state tracking
  // Translation status fields
  translationStatus: z.enum(["idle", "running", "completed", "failed"]).optional(),
  translationProgress: z.number().optional(),
  translatedCount: z.number().optional(),
  totalCount: z.number().optional(),
  translationUpdatedAt: z.date().optional(),
  translationError: z.string().optional(),
  // AI-generated summaries
  summaryEn: z.string().optional(),
  summaryKo: z.string().optional(),
});

// Notebook Groups schemas
export const insertNotebookGroupSchema = createInsertSchema(notebookGroups).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateNotebookGroupSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  color: z.string().optional(),
  icon: z.string().optional(),
  order: z.number().optional(),
});

export const insertNotebookSchema = createInsertSchema(notebooks).pick({
  title: true,
  description: true,
  tags: true,
  isPublic: true,
  userId: true,
  groupId: true,
  // Legacy fields - will be removed after migration
  groupLabel: true,
});

export const insertNotebookSentenceSchema = createInsertSchema(notebookSentences).pick({
  notebookId: true,
  sentenceId: true,
});

export const insertNoteSchema = createInsertSchema(notes).pick({
  userId: true,
  sentenceId: true,
  content: true,
  color: true,
  tags: true,
});

export const insertGlossarySchema = createInsertSchema(glossary).pick({
  userId: true,
  term: true,
  definition: true,
  translation: true,
  pronunciation: true,
  difficulty: true,
  sourceLanguage: true,
  targetLanguage: true,
  contextSentence: true,
  documentId: true,
  notes: true,
  tags: true,
});

export const insertTranslationAttemptSchema = createInsertSchema(translationAttempts).pick({
  sentenceId: true,
  userId: true,
  userTranslation: true,
  score: true,
  grade: true,
  feedback: true,
  suggestedCorrection: true,
  backTranslation: true,
  backTranslationFeedback: true,
  practiceMode: true,
  timeSpent: true,
}).extend({
  isCorrect: z.boolean().optional(),
});

export const insertUserProgressSchema = createInsertSchema(userProgress).pick({
  userId: true,
  totalSentences: true,
  completedSentences: true,
  practiceStreak: true,
  averageScore: true,
  weeklyGoal: true,
  currentWeekProgress: true,
  lastActiveDate: true,
  achievements: true,
});

// RSS Feed/Subscription insert schemas
export const insertRssFeedSchema = createInsertSchema(rssFeeds).pick({
  canonicalUrl: true,
  normalizedUrlHash: true,
  title: true,
  description: true,
  language: true,
  category: true,
});

export const insertRssSubscriptionSchema = createInsertSchema(rssSubscriptions).pick({
  feedId: true,
  userId: true,
  alias: true,
  visibility: true,
  enabled: true,
  userTags: true,
  notifyPolicy: true,
  syncInterval: true,
});

export const insertRssPolicySchema = createInsertSchema(rssPolicy).pick({
  maxFeedsPerUser: true,
  minSyncInterval: true,
  maxSyncInterval: true,
  dailyFetchLimit: true,
  allowedDomains: true,
  blockedDomains: true,
  requireApproval: true,
});

// Legacy RSS feed schema for backward compatibility
export const insertLegacyRssFeedSchema = z.object({
  feedUrl: z.string().url('유효한 URL을 입력해주세요'),
  alias: z.string().optional(), // Make alias optional so it can use feed title as fallback
  category: z.string().optional(),
  language: z.string().optional(), 
  syncInterval: z.number().int().min(1).max(168).optional()
});


export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type InsertLibraryDocument = z.infer<typeof insertLibraryDocumentSchema>;
export type Document = typeof documents.$inferSelect;

export type InsertParagraph = z.infer<typeof insertParagraphSchema>;
export type Paragraph = typeof paragraphs.$inferSelect;

export type InsertSentence = z.infer<typeof insertSentenceSchema>;
export type Sentence = typeof sentences.$inferSelect;
export type UpdateSentence = z.infer<typeof updateSentenceSchema>;

// Extended sentence type for frontend with user-specific data
export type SentenceWithUserData = Sentence & {
  isScrapped?: boolean; // From userSentenceState.isBookmarked
  status?: "new" | "learning" | "review" | "mastered"; // From userSentenceState.learningStatus
  practiceCount?: number; // Calculated from practice sessions
  note?: string; // From notes table
};
export type UpdateDocument = z.infer<typeof updateDocumentSchema>;

export type InsertTranslationCache = z.infer<typeof insertTranslationCacheSchema>;
export type TranslationCache = typeof translationCache.$inferSelect;

// Notebook Groups types  
export type InsertNotebookGroup = z.infer<typeof insertNotebookGroupSchema>;
export type NotebookGroup = typeof notebookGroups.$inferSelect;
export type UpdateNotebookGroup = z.infer<typeof updateNotebookGroupSchema>;

export type InsertNotebook = z.infer<typeof insertNotebookSchema>;
export type Notebook = typeof notebooks.$inferSelect;

export type InsertNotebookSentence = z.infer<typeof insertNotebookSentenceSchema>;
export type NotebookSentence = typeof notebookSentences.$inferSelect;

export type InsertNote = z.infer<typeof insertNoteSchema>;
export type Note = typeof notes.$inferSelect;

export type InsertGlossary = z.infer<typeof insertGlossarySchema>;
export type Glossary = typeof glossary.$inferSelect;

export type InsertTranslationAttempt = z.infer<typeof insertTranslationAttemptSchema>;
export type TranslationAttempt = typeof translationAttempts.$inferSelect;

export type InsertUserProgress = z.infer<typeof insertUserProgressSchema>;
export type UserProgress = typeof userProgress.$inferSelect;

// RSS Feed/Subscription types
export type InsertRssFeed = z.infer<typeof insertRssFeedSchema>;
export type RssFeed = typeof rssFeeds.$inferSelect;

export type InsertRssSubscription = z.infer<typeof insertRssSubscriptionSchema>;
export type RssSubscription = typeof rssSubscriptions.$inferSelect;

export type InsertRssPolicy = z.infer<typeof insertRssPolicySchema>;
export type RssPolicy = typeof rssPolicy.$inferSelect;

export type InsertLegacyRssFeed = z.infer<typeof insertLegacyRssFeedSchema>;

export type InsertRssArticle = z.infer<typeof insertRssArticleSchema>;
export type RssArticle = typeof rssArticles.$inferSelect;

// User profile types
export type InsertUserProfile = z.infer<typeof insertUserProfileSchema>;
export type UpdateUserProfile = z.infer<typeof updateUserProfileSchema>;
export type UserProfile = typeof userProfiles.$inferSelect;

// User preferences types
export type InsertUserPreferences = z.infer<typeof insertUserPreferencesSchema>;
export type UpdateUserPreferences = z.infer<typeof updateUserPreferencesSchema>;
export type UserPreferences = typeof userPreferences.$inferSelect;

// User sources types
export type InsertUserSource = z.infer<typeof insertUserSourceSchema>;
export type UpdateUserSource = z.infer<typeof updateUserSourceSchema>;
export type UserSource = typeof userSources.$inferSelect;

// User sessions types
export type InsertUserSession = z.infer<typeof insertUserSessionSchema>;
export type UserSession = typeof userSessions.$inferSelect;

// Legacy compatibility
export type UserRssFeed = RssSubscription;

export const insertWordPracticeSessionSchema = createInsertSchema(wordPracticeSessions).pick({
  userId: true,
  wordId: true,
  sessionType: true,
  isCorrect: true,
  timeSpent: true,
  questionType: true,
  selectedAnswer: true,
  correctAnswer: true,
});

export const insertPracticeSessionSchema = createInsertSchema(practiceSessions).pick({
  userId: true,
  title: true,
  totalSentences: true,
  sessionData: true,
});



export const insertRssArticleSchema = createInsertSchema(rssArticles).pick({
  feedId: true,
  title: true,
  link: true,
  content: true,
  description: true,
  author: true,
  publishedAt: true,
  guid: true,
});

// User profile schemas
export const insertUserProfileSchema = createInsertSchema(userProfiles).pick({
  userId: true,
  fullName: true,
  email: true,
  avatarUrl: true,
  bio: true,
  language: true,
  timezone: true,
  isProfilePublic: true,
});

export const updateUserProfileSchema = z.object({
  fullName: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  avatarUrl: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  language: z.string().optional(),
  timezone: z.string().optional(),
  isProfilePublic: z.boolean().optional(),
});

// User preferences schemas
export const insertUserPreferencesSchema = createInsertSchema(userPreferences).pick({
  userId: true,
  defaultViewerMode: true,
  fontSize: true,
  lineHeight: true,
  isDarkMode: true,
  defaultSourceLanguage: true,
  defaultTargetLanguage: true,
  translationStyle: true,
  showTranslationHints: true,
  autoSaveTranslations: true,
  emailNotifications: true,
  practiceReminders: true,
  weeklyReports: true,
  dailyGoal: true,
  practiceMode: true,
  difficultyPreference: true,
});

export const updateUserPreferencesSchema = z.object({
  defaultViewerMode: z.enum(["translation", "original", "side-by-side"]).optional(),
  fontSize: z.number().min(12).max(24).optional(),
  lineHeight: z.number().min(100).max(200).optional(),
  isDarkMode: z.boolean().optional(),
  defaultSourceLanguage: z.string().optional(),
  defaultTargetLanguage: z.string().optional(),
  translationStyle: z.enum(["natural", "literal", "academic"]).optional(),
  showTranslationHints: z.boolean().optional(),
  autoSaveTranslations: z.boolean().optional(),
  emailNotifications: z.boolean().optional(),
  practiceReminders: z.boolean().optional(),
  weeklyReports: z.boolean().optional(),
  dailyGoal: z.number().min(1).max(100).optional(),
  practiceMode: z.enum(["translation", "back-translation", "mixed"]).optional(),
  difficultyPreference: z.enum(["easy", "medium", "hard", "adaptive"]).optional(),
});

// User sources schemas
export const insertUserSourceSchema = createInsertSchema(userSources).pick({
  userId: true,
  sourceType: true,
  title: true,
  url: true,
  description: true,
  category: true,
  tags: true,
  isEnabled: true,
  syncInterval: true,
});

export const updateUserSourceSchema = z.object({
  title: z.string().optional(),
  url: z.string().url().optional(),
  description: z.string().optional(),
  category: z.string().optional(),
  tags: z.string().optional(),
  isEnabled: z.boolean().optional(),
  syncInterval: z.number().min(1).max(168).optional(),
});

// User sessions schemas
export const insertUserSessionSchema = createInsertSchema(userSessions).pick({
  userId: true,
  sessionToken: true,
  deviceInfo: true,
  ipAddress: true,
  expiresAt: true,
});

export const updatePracticeSessionSchema = z.object({
  completedSentences: z.number().optional(),
  skippedSentences: z.number().optional(),
  averageScore: z.number().optional(),
  totalTimeSpent: z.number().optional(),
  status: z.enum(["active", "completed", "paused"]).optional(),
  sessionData: z.string().optional(),
  completedAt: z.date().optional(),
});

export const updateGlossarySchema = z.object({
  masteryLevel: z.number().optional(),
  correctCount: z.number().optional(),
  incorrectCount: z.number().optional(),
  nextReviewDate: z.date().optional(),
  lastReviewed: z.date().optional(),
  reviewCount: z.number().optional(),
});


export type InsertWordPracticeSession = z.infer<typeof insertWordPracticeSessionSchema>;
export type WordPracticeSession = typeof wordPracticeSessions.$inferSelect;
export type UpdateGlossary = z.infer<typeof updateGlossarySchema>;

// AI Usage tracking table for daily limits
export const aiUsage = pgTable("ai_usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  date: timestamp("date").notNull(),
  count: integer("count").default(0).notNull(),
});

export type AIUsage = typeof aiUsage.$inferSelect;

// ============================================
// Token Usage Tracking (Monthly)
// ============================================
export const tokenUsage = pgTable("token_usage", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  month: text("month").notNull(), // YYYY-MM format
  totalTokensUsed: integer("total_tokens_used").default(0).notNull(),
  premiumTokensUsed: integer("premium_tokens_used").default(0).notNull(),
  fullDocTranslations: integer("full_doc_translations").default(0).notNull(),
  ocrCount: integer("ocr_count").default(0).notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userMonthUnique: unique().on(table.userId, table.month),
}));

export type TokenUsage = typeof tokenUsage.$inferSelect;
export type InsertTokenUsage = typeof tokenUsage.$inferInsert;

// Plan limits constants
export const PLAN_LIMITS = {
  starter: {
    monthlyTokenCap: 50_000,
    premiumTokenCap: 0,
    maxConcurrentDocuments: 3,
    maxFullDocTranslations: 3,
    maxOcr: 3,
    canExport: false,
    model: "gemini-2.0-flash-lite" as const,
    premiumModel: null,
    priorityProcessing: false,
  },
  pro: {
    monthlyTokenCap: 500_000,
    premiumTokenCap: 200_000,
    maxConcurrentDocuments: Infinity,
    maxFullDocTranslations: Infinity,
    maxOcr: Infinity,
    canExport: true,
    model: "gemini-2.0-flash-lite" as const,
    premiumModel: "gemini-2.5-flash" as const,
    priorityProcessing: true,
  },
  admin: {
    monthlyTokenCap: Infinity,
    premiumTokenCap: Infinity,
    maxConcurrentDocuments: Infinity,
    maxFullDocTranslations: Infinity,
    maxOcr: Infinity,
    canExport: true,
    model: "gemini-2.0-flash-lite" as const,
    premiumModel: "gemini-2.5-flash" as const,
    priorityProcessing: true,
  },
} as const;

export type InsertPracticeSession = z.infer<typeof insertPracticeSessionSchema>;
export type PracticeSession = typeof practiceSessions.$inferSelect;
export type UpdatePracticeSession = z.infer<typeof updatePracticeSessionSchema>;

// ============================================
// Phase 1: Language-Agnostic Schemas & Types
// ============================================

// Insert schemas for Translation and Coaching
export const insertTranslationSchema = createInsertSchema(translations).omit({
  id: true,
  createdAt: true,
});

export const insertCoachingSchema = createInsertSchema(coaching).omit({
  id: true,
  createdAt: true,
});

// Update user language preferences schema
export const updateUserLanguageSchema = z.object({
  baseLanguage: z.string().min(2).max(10),
  learningLanguage: z.string().min(2).max(10),
});

// Types for Translation model
export type Translation = typeof translations.$inferSelect;
export type InsertTranslation = z.infer<typeof insertTranslationSchema>;

// Types for Coaching model
export type Coaching = typeof coaching.$inferSelect;
export type InsertCoaching = z.infer<typeof insertCoachingSchema>;

// Type for update user language
export type UpdateUserLanguage = z.infer<typeof updateUserLanguageSchema>;

// ============================================
// Phase 3: Quiz System Schemas & Types
// ============================================

// Insert schema for QuizResult
export const insertQuizResultSchema = createInsertSchema(quizResults).omit({
  id: true,
  createdAt: true,
});

// Types for QuizResult model
export type QuizResult = typeof quizResults.$inferSelect;
export type InsertQuizResult = z.infer<typeof insertQuizResultSchema>;

// Quiz item returned from the generation API
export type QuizItem = {
  id: number; // sentence ID
  original: string; // sentence in learningLanguage
  meaning: string | null; // translation in baseLanguage (user or AI)
  coachingHint: string | null; // coaching explanation
  mode: "comprehension" | "production";
};

// RSS types defined above at lines 407-411

// ============================================
// Practice Hub: User Glossary State Schemas
// ============================================

// Insert schema for userGlossaryState
export const insertUserGlossaryStateSchema = createInsertSchema(userGlossaryState).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

// Update schema for userGlossaryState
export const updateUserGlossaryStateSchema = z.object({
  masteryLevel: z.number().min(0).max(5).optional(),
  correctStreak: z.number().optional(),
  lastReviewedAt: z.date().optional(),
  nextReviewDate: z.date().optional(),
  lastRating: z.enum(["again", "hard", "good"]).optional(),
  totalReviews: z.number().optional(),
  correctCount: z.number().optional(),
  incorrectCount: z.number().optional(),
});

// Types for userGlossaryState
export type UserGlossaryState = typeof userGlossaryState.$inferSelect;
export type InsertUserGlossaryState = z.infer<typeof insertUserGlossaryStateSchema>;
export type UpdateUserGlossaryState = z.infer<typeof updateUserGlossaryStateSchema>;

// Practice Hub item types for unified queue
export type PracticeItemType = "sentence" | "glossary";

export interface PracticeQueueItem {
  id: number;
  type: PracticeItemType;
  // Common fields
  masteryLevel: number;
  nextReviewDate: Date | null;
  // Sentence-specific (type === "sentence")
  source?: string;
  target?: string;
  // Glossary-specific (type === "glossary")
  term?: string;
  definition?: string;
  translation?: string;
  contextSentence?: string;
}

// ============================================
// Explore Content Pipeline: Sync Logs & Keywords
// ============================================

// Sync logs for tracking content ingestion
export const syncLogs = pgTable("sync_logs", {
  id: serial("id").primaryKey(),
  sourceType: text("source_type", { enum: ["arxiv", "gutenberg", "rss"] }).notNull(),
  status: text("status", { enum: ["success", "failed", "partial"] }).notNull(),
  documentsAdded: integer("documents_added").default(0),
  documentsSkipped: integer("documents_skipped").default(0),
  errorMessage: text("error_message"),
  details: json("details").$type<{
    keywords?: string[];
    autoApproved?: number;
    manualReview?: number;
    selectedBookId?: number;
    selectedBookTitle?: string;
    topChartRank?: number;
  }>(),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

// Auto-approval keywords for content filtering
export const autoApprovalKeywords = pgTable("auto_approval_keywords", {
  id: serial("id").primaryKey(),
  keyword: text("keyword").notNull().unique(),
  isEnabled: boolean("is_enabled").default(true),
  matchCount: integer("match_count").default(0), // Track how many docs matched
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Insert schemas
export const insertSyncLogSchema = createInsertSchema(syncLogs).omit({
  id: true,
  startedAt: true,
});

export const insertAutoApprovalKeywordSchema = createInsertSchema(autoApprovalKeywords).omit({
  id: true,
  matchCount: true,
  createdAt: true,
  updatedAt: true,
});

// Types
export type SyncLog = typeof syncLogs.$inferSelect;
export type InsertSyncLog = z.infer<typeof insertSyncLogSchema>;
export type AutoApprovalKeyword = typeof autoApprovalKeywords.$inferSelect;
export type InsertAutoApprovalKeyword = z.infer<typeof insertAutoApprovalKeywordSchema>;