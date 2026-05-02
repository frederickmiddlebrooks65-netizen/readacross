# ReadAcross: Advanced Multilingual Document Processing Platform

## Overview
ReadAcross is an advanced multilingual document processing and language learning platform designed to enhance user interactions through intelligent file management, seamless translation workflows, and AI-powered learning. Its core purpose is to provide consistent, high-quality multilingual document translations and an intuitive learning environment for improving language skills, integrating public domain literature and academic papers. The business vision is to become a leading platform for multilingual content engagement and language proficiency development, utilizing innovative AI applications to expand market reach.

## User Preferences
No specific user preferences recorded yet. Update this section as the user expresses preferences about coding style, workflow, tools, or communication style.

## System Architecture

### UI/UX Decisions
The platform features a modern dual-tab interface ("My Library" and "Explore"), a multi-selection interface for sentences, and a persistent selection bar. It includes a professional library interface with smart filtering, a comprehensive dashboard for learning statistics, and control panels for notebooks and sentences with integrated search, filter, and sort options. The design prioritizes a clean, modern aesthetic with consistent styling.

### Technical Implementations
The system is built using TypeScript, with React for the frontend and Express.js for the backend. PostgreSQL with Drizzle ORM handles database management. The Google Gemini API (gemini-2.5-flash and gemini-2.0-flash-lite) is integrated for translation, AI-powered learning, OCR, and context-aware document assistance. Serverless storage is used for documents, and secure session-based Google OAuth manages authentication. An internationalization (i18n) system using React Context API supports English and Korean language switching.

### Feature Specifications
- **Translation System**: Offers optimized batch translation with context preservation, JSON response format, Server-Sent Events (SSE) for real-time updates, and Gemini-based text type detection.
- **Content Integration**: Automated crawling and storage of public domain literature (Project Gutenberg) and curated RSS sources (VOA Learning English – "As It Is" and the general News feed). arXiv automatic ingestion is disabled; arXiv papers can still be added through URL-based import (handled by the generic URL importer in `server/routes/documents.ts`) and arXiv documents are excluded from the Explore page server-side via `getPublicLibraryDocuments` in `server/storage.ts`.
- **Practice & Learning**: Features comprehensive session data recording, dynamic difficulty adaptation, flashcard and quiz modes, intelligent distractor generation, AI-powered daily review recommendations, and a Spaced Repetition System (Leitner algorithm).
- **Document & Sentence Management**: Includes sorting, filtering, real-time searching within notebooks, a favorites system, enhanced status filters, bulk operations, and editable category dropdowns for documents.
- **AI Coaching**: Provides AI-powered sentence coaching (polished translation, grammar insights, nuance tips) in comprehension and composition modes, with tier-based access.
- **Context-Aware AI Assistant**: Leverages full document context for intelligent Q&A for Pro users.
- **Monetization**: Implements subscription tiers (Free/Pro/Admin) with differentiated AI model access (gemini-2.0-flash-lite for Free, gemini-2.5-flash for Pro) and integrates the PortOne payment gateway. All AI features route through TokenTrackingService for accurate per-user usage tracking in the token_usage table.
- **Core Enhancements**: Incorporates Gemini-based language detection, a language-agnostic schema for multi-language pair support, and a `translations` table for storing multiple language pair translations.
- **User Authentication**: Utilizes secure session-based Google OAuth, email verification, and password reset.
- **Document Processing**: Provides AI-generated document summaries with caching and a robust document upload process including automatic source language detection.

### System Design Choices
Core architectural decisions include smart routing, a unified practice flow, and a 3-tier Practice Hub structure. Enhanced document processing leverages Gemini for text type detection and cost-efficient single-pass translation. Data separation distinguishes and handles public documents. The platform features robust error handling, user feedback systems, and a subscription tier system with AI model differentiation as a central monetization strategy. Safety settings are configured to BLOCK_ONLY_HIGH to allow discussion of complex literary and academic themes.

The PDF processing pipeline prioritizes stable position anchoring with a 2-track system (Layout Track for viewer, Translation Track for sentences). It uses a unified pipeline for both uploaded and arXiv PDFs. Header/footer detection is based on HF Zone, signal rules, and running header exceptions. Subheading detection relies on visual signals and keyword forcing. A safe hyphen joining policy is implemented. Archetype-aware sentence splitting (Academic, Literary, Essay, Generic modes) ensures specialized logic for different content types, including handling abbreviations, citations, fragments, and dialogue. A Sentence/Utterance Type System explicitly categorizes content for Translation Memory (TM) eligibility, preventing TM pollution from fragments while allowing user override.

Recent PDF pipeline improvements (Feb 2026):
- **Universal running header removal**: Detects and removes text repeated on 3+ pages in top 12% Y-zone (20-120 chars), applied across all academic profiles before profile-specific filtering.
- **Stateful author/affiliation classification**: `fixupAuthorClassifications` post-pass in pdfLineClassifier.ts extends author zone detection beyond initial pattern matches until body-start markers (Abstract/Introduction/CCS) are found.
- **Table/list cluster heading protection**: postProcessBlocksStructural now blocks heading promotion for single-word blocks and blocks surrounded by 3+ nearby short blocks (table cell / summary table patterns).
- **arxiv profile paragraph segmentation**: Dedicated `arxiv` branch in shouldEndParagraphSimplified with page-boundary tolerance (allows sentence continuation across pages, unlike strict journal mode).

Text upload pipeline (May 2026):
- `DocumentService.createFromText` builds structured blocks **directly** from the paragraphs/sentences it just inserted into the DB (one block per paragraph, anchor IDs taken from the inserted sentence rows). It no longer calls `generateStructuredBlocks` + `attachAnchorsToStructuredContent` for plain text uploads. This removes the heavy CJK-unfriendly re-parse + hash/similarity matching that caused Korean .txt uploads (e.g. "최애의 아이", ~24KB) to hang and trip the autoscale proxy timeout in production. Other paths (HTML/PDF / `createDocumentWithPSAndStructure*`) still use the full structured-parse pipeline.

Performance optimizations (Feb 2026):
- **Legacy thumbnail queue disabled**: Removed `thumbnailQueue.addJob()` calls from rssCrawler.ts and arxivCrawler.ts to eliminate unnecessary CPU/storage usage from background image processing.
- **Image proxy bypass**: `getProxiedImageUrl` in SegmentViewer.tsx now returns original URLs directly, bypassing the server-side image proxy for faster CDN-direct loading.
- **Explore page pagination**: Server-side pagination (`?page=N&limit=N`) with lightweight DTO (excludes `content`, `structuredContent`, `rawContent`) for the `/api/library/explore` endpoint.
- **Snippet denormalization**: `snippet` column added to `documents` table, pre-generated at document creation time, eliminating expensive sentences+paragraphs JOIN queries on every Explore page load.
- **DB connection pool expanded**: `max` increased from 5 to 15 in server/db.ts for better concurrent request handling.

- **Pre-computed document metrics**: `wordCount` and `difficulty` columns on `documents` table, computed at document creation time (in `DocumentService.ts`). Explore page reads these DB values for accurate read-time/difficulty badges instead of client-side text analysis. Backfilled for all existing documents.

Admin & Operations tooling (Feb 2026):
- **Telegram notification service**: `server/services/NotificationService.ts` sends fire-and-forget alerts via Telegram Bot API. Requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` env vars. Triggers: new user signup, token 80% threshold, system errors. Uses per-month dedup for threshold alerts.
- **Admin user management**: `GET/PATCH /api/admin/users` endpoints with search, plan/status filtering, pagination, and inline editing. Admin UI section in AdminNew.tsx with table view, edit dialog for plan/status/role changes.
- **Token threshold notifications**: TokenTrackingService.recordTokens automatically checks 80% usage and sends Telegram alert (deduplicated per user per month).

RSS Security & Policy (Feb 2026):
- **Public/Private feed isolation**: User-added RSS feeds create documents with `isPublic: false` and `sourceType: "rss"`, preventing Explore page exposure. System sources (arXiv, Gutenberg, etc.) remain `isPublic: true` + `sourceType: "explore"`.
- **JWT authentication on feed creation**: `POST /api/rss-feeds` requires `authenticateJWT`, blocking unauthenticated feed submissions.
- **Policy enforcement**: `rss_policy` table settings (`requireApproval`, `maxFeedsPerUser`, `blockedDomains`) are now actively enforced at the API route level. Approval-required feeds are created with `isBlocked: true` and skip immediate crawling.
- **Quota enforcement**: Per-user feed count checked via `rss_subscriptions` table against `policy.maxFeedsPerUser`.
- **Admin feed approval UI**: AdminNew.tsx feed list shows pending (user-added blocked) feeds with orange badges and inline approve/block toggle buttons.

## External Dependencies
- **Google Gemini API**: Used for document translation, text type detection, glossary generation, AI-powered language practice, AI coaching, OCR, and document summarization. Models include gemini-2.5-flash and gemini-2.0-flash-lite.
- **arXiv API**: Integrated for fetching and processing academic papers.
- **PyMuPDF (pymupdf)**: Primary PDF text extraction library for layout-first processing.
- **pdftotext**: Legacy/fallback dependency for extracting text from PDF documents.
- **PortOne (Iamport)**: Payment gateway integrated for subscription management.
- **Email Service**: Used for transactional emails (e.g., verification, password reset).