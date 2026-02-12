# ReadAcross: Advanced Multilingual Document Processing Platform

## Overview
ReadAcross is an advanced multilingual document processing and language learning platform. It provides intelligent file management, seamless translation workflows, and AI-powered learning to enhance user interactions. The platform aims to deliver consistent, high-quality multilingual document translations and an intuitive learning environment for improving language skills, integrating public domain literature and academic papers to enrich content. The business vision is to become a leading platform for multilingual content engagement and language proficiency development, expanding market reach through innovative AI applications.

## User Preferences
No specific user preferences recorded yet. Update this section as the user expresses preferences about coding style, workflow, tools, or communication style.

## System Architecture

### UI/UX Decisions
The platform features a modern dual-tab interface ("My Library" and "Explore"), a multi-selection interface for sentences, a persistent selection bar, and a professional library interface with smart filtering. A comprehensive dashboard provides learning statistics, and control panels for notebooks and sentences offer integrated search, filter, and sort options. The design emphasizes a clean, modern aesthetic with consistent styling.

### Technical Implementations
The system is built with TypeScript, using React for the frontend and Express.js for the backend. PostgreSQL with Drizzle ORM is used for the database. Google Gemini API (gemini-2.5-flash and gemini-2.0-flash-lite models) is integrated for translation, AI-powered learning, OCR, and context-aware document assistance. Serverless storage handles documents, and secure session-based Google OAuth manages authentication. An internationalization (i18n) system using React Context API supports seamless language switching (English/Korean).

### Feature Specifications
- **Translation System**: Optimized batch translation with context preservation, JSON response format, Server-Sent Events (SSE) for real-time updates, and Gemini-based text type detection.
- **Content Integration**: Automated crawling and storage of public domain literature (e.g., Project Gutenberg) and academic papers (arXiv), including PDF text extraction and section-based processing.
- **Practice & Learning**: Comprehensive session data recording, dynamic difficulty adaptation, flashcard and quiz modes, intelligent distractor generation, AI-powered daily review recommendations, and a Spaced Repetition System (Leitner algorithm).
- **Document & Sentence Management**: Sorting, filtering, real-time searching within notebooks, a favorites system, enhanced status filters, bulk operations, and editable category dropdowns for documents.
- **AI Coaching**: Provides AI-powered sentence coaching (polished translation, grammar insights, nuance tips) in comprehension and composition modes, with tier-based access.
- **Context-Aware AI Assistant**: Leverages full document context for intelligent Q&A for Pro users.
- **Monetization**: Subscription tiers (Free/Pro/Admin) with differentiated AI model access (gemini-1.5-flash for Free, gemini-1.5-pro for Pro) and PortOne payment gateway integration.
- **Core Enhancements**: Gemini-based language detection, language-agnostic schema for multi-language pair support, and a `translations` table for storing multiple language pair translations.
- **User Authentication**: Secure session-based Google OAuth, email verification, and password reset.
- **Document Processing**: AI-generated document summaries with caching, and a robust document upload process.

### System Design Choices
Core architectural decisions include smart routing, a unified practice flow, and a 3-tier Practice Hub structure. Enhanced document processing leverages Gemini for text type detection and cost-efficient single-pass translation. Data separation distinguishes and handles `is_public` documents. The platform features robust error handling, user feedback systems, and a subscription tier system with AI model differentiation as a central monetization strategy. Safety settings are configured to BLOCK_ONLY_HIGH to allow discussion of complex literary and academic themes.

The PDF processing pipeline prioritizes stable position anchoring with a 2-track system (Layout Track for viewer, Translation Track for sentences). It uses a unified pipeline for both uploaded and arXiv PDFs. Header/footer detection is based on HF Zone, signal rules, and running header exceptions. Subheading detection relies on visual signals and keyword forcing. A safe hyphen joining policy is implemented. Archetype-aware sentence splitting (Academic, Literary, Essay, Generic modes) ensures specialized logic for different content types, including handling abbreviations, citations, fragments, and dialogue. A Sentence/Utterance Type System explicitly categorizes content for Translation Memory (TM) eligibility, preventing TM pollution from fragments while allowing user override.

## External Dependencies
- **Google Gemini API**: Used for document translation, text type detection, glossary generation, AI-powered language practice, AI coaching, OCR, and document summarization. Models: gemini-2.5-flash (Pro users) and gemini-2.0-flash-lite (Free/Starter users and OCR).
- **arXiv API**: Integrated for fetching and processing academic papers.
- **PyMuPDF (pymupdf)**: Primary PDF text extraction library for layout-first processing with line-level extraction.
- **pdftotext**: Legacy/fallback dependency for extracting text from PDF documents.
- **PortOne (Iamport)**: Payment gateway integrated for subscription management.
- **Email Service**: Used for transactional emails (e.g., verification, password reset).

## Recent Changes

### 2026-02-12: Beta Pro Plan for Private Beta
- **New Plan**: `beta_pro` added to plan enum in `shared/schema.ts`
- **Behavior**: Identical to `pro` plan (500K tokens, 200K premium cap, unlimited docs/OCR, export enabled, premium model)
- **New Field**: `betaExpiresAt` (nullable timestamp) on `users` table
- **Auto Downgrade**: In `authenticateJWT` and `optionalAuthenticateJWT` middleware (`server/auth.ts`), if `plan === "beta_pro"` and `betaExpiresAt < now`, silently downgrade to `starter` and clear `betaExpiresAt`
- **UI Masking**: `/api/auth/me`, `/api/ai/usage-status`, and `/api/payment/status` return `"pro"` instead of `"beta_pro"` — UI never displays "Beta Pro"
- **Type Updates**: `PlanType` and `UserPlan` types extended in `TokenTrackingService`, `GeminiService`, `TranslationService`
- **No Admin UI**: Beta users managed via direct DB update (`UPDATE users SET plan='beta_pro', beta_expires_at='...' WHERE id=...`)

### 2026-02-12: Token-Based Freemium Plan Architecture
- **Architecture**: Replaced daily AI call-count limits with monthly token-based tracking per instructions.md
- **New Table**: `token_usage` (id, user_id, month, total_tokens_used, premium_tokens_used, full_doc_translations, ocr_count, updated_at) with unique constraint on (user_id, month)
- **New Service**: `server/services/TokenTrackingService.ts` - handles token recording, limit checking, monthly reset, usage snapshots
- **Plan Limits** (`PLAN_LIMITS` in `shared/schema.ts`):
  - Starter: 50K tokens/month, 3 concurrent docs, 3 full-doc translations/month, 3 OCR/month, no export
  - Pro: 500K tokens/month (200K premium cap), unlimited features, auto-fallback to lite model after premium cap
  - Admin: unlimited
- **GeminiService Changes**: `extractAndRecordTokens()` captures `usageMetadata` from every Gemini API response and records via TokenTrackingService
- **Route Enforcement**:
  - Upload: concurrent document count check (not cumulative counter)
  - Full-doc translate: monthly limit check via `checkFullDocTranslationLimit()`
  - OCR: monthly limit check via `checkOcrLimit()`
  - Download: blocked for Starter (`canExport: false`)
  - All routes: pre-flight token limit check
- **Error Codes**: `CONCURRENT_DOC_LIMIT`, `MONTHLY_LIMIT_EXCEEDED`, `FULL_DOC_TRANSLATION_LIMIT`, `OCR_LIMIT_REACHED`, `EXPORT_NOT_AVAILABLE`
- **New Endpoints**: `GET /account/me/usage` (user dashboard), `GET /admin/token-usage` (admin monitoring)
- **Model Fallback**: Pro users auto-downgrade from gemini-2.5-flash to gemini-2.0-flash-lite when premium token cap exceeded
- **Safety Buffers**: Pre-flight checks use safety buffers to prevent overshoot:
  - `MONTHLY_CAP_BUFFER = 500`: Blocks when remaining tokens <= 500 (prevents calls that would exceed cap)
  - `PREMIUM_FALLBACK_BUFFER = 2,000`: Triggers lite-model fallback when remaining premium tokens <= 2,000
- **Legacy Cleanup**: Removed all daily-count infrastructure (`STARTER_DAILY_LIMIT`, `PRO_DAILY_THRESHOLD`, `incrementUsage`, `checkAndUpdateDailyUsage`). Frontend `AISideDrawer.tsx` updated to show token-based messaging.

### 2026-02-04: Hard Block Boundary Rule for Headings
- **Root Cause**: Headings were being merged with following prose at paragraph block construction stage
  - Block-level promotion cannot work if heading never exists as a separate block
  - Line classification detected headings correctly, but `shouldEndParagraphSimplified` didn't force break after them
- **File**: `server/pdfUtils.ts`
- **Fix**: Added HARD RULE in `shouldEndParagraphSimplified`:
  ```typescript
  if (currentClassification === "heading") {
    return true;  // Force break AFTER heading
  }
  ```
- **Effect**: If a line is classified as heading and the next line is prose, they are NEVER merged into the same paragraph block
- **Scope**: Global rule for ALL academic documents (journal + essay_academic)
- **Previous Fix (same day)**: Extended block-level heading detection to all academic profiles in `postProcessBlocksForEssayAcademic`

### 2026-02-03: Final Unified Parsing Pipeline (instructions.md compliance)
- **Architectural Principle**: "문단 분리 로직은 하나만 존재해야 한다" (there should be only one paragraph separation logic)
- **File**: `server/pdfUtils.ts`
- **3-Part Change Set** (applied atomically per instructions.md):
  1. **Inline Heading Detection**: Now runs for ALL academic profiles (journal + essay_academic), not just essay_academic
     - `extractInlineHeading()` called unconditionally in `flushParagraph()`
     - Detects "AI VS HUMAN TRANSLATORS When comparing..." patterns in both profiles
  2. **Page Boundary**: ALWAYS breaks paragraph at page boundary for ALL profiles
     - Removed essay_academic page-crossing logic from `shouldEndParagraphSimplified()`
     - "페이지 경계에서는 항상 문단을 끊는다" - paragraph continuity is translation/post-processing concern
  3. **Fail-safe Rule**: Single-column + relaxed → essay_academic (forced)
     - Added in `detectParsingStrictness()` to protect humanities/translation/philosophy papers
     - Catches papers with essay-like layout but score < 3
- **Profile-Specific Branching** (essay_academic differences are SUBTRACTIVE):
  - `classifyLineSimplified()`: isEssayAcademic flag disables ALL CAPS heading (>60 chars), section keyword forcing, aggressive H/F removal
- **Benefits**:
  - Single source of truth for paragraph logic
  - Inline headings work for all academic documents
  - Humanities papers protected by layout-based fail-safe

### 2026-02-02: Auto Language Detection for Document Upload
- Added automatic source language detection using `LanguageDetectionService` during file upload
- **File**: `server/routes/documents.ts`
- **Changes**:
  - PDF uploads: Extracts sample text from first 5 blocks, detects language via Gemini API or fallback regex
  - Text/DOCX uploads: Extracts first 500 chars for language detection
  - Fallback to "en" only if detection fails
  - `targetLanguage` remains "ko" (Korean) as default
- **Supported Languages**: en, ko, ja, zh, es, fr, de, pt, it, ru, ar, hi, vi, th, id
- This fixes the issue where Japanese/Chinese documents were incorrectly saved with `sourceLanguage = 'en'`