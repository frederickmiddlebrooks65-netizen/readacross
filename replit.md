# ReadAcross: Advanced Multilingual Document Processing Platform

## Overview
ReadAcross is an advanced multilingual document processing and language learning platform designed to provide intelligent file management, seamless translation workflows, and AI-powered learning. Its core purpose is to deliver consistent, high-quality multilingual document translations and an intuitive learning environment, integrating public domain literature and academic papers to enrich content. The platform aims to become a leader in multilingual content engagement and language proficiency development through innovative AI applications.

## User Preferences
No specific user preferences recorded yet. Update this section as the user expresses preferences about coding style, workflow, tools, or communication style.

## System Architecture

### UI/UX Decisions
The platform features a modern dual-tab interface ("My Library" and "Explore"), multi-selection for sentences, a persistent selection bar, and a professional library interface with smart filtering. A comprehensive dashboard provides learning statistics, and control panels for notebooks and sentences offer integrated search, filter, and sort options, emphasizing a clean, modern aesthetic with consistent styling.

### Technical Implementations
The system is built with TypeScript, using React for the frontend and Express.js for the backend. PostgreSQL with Drizzle ORM is used for the database. Google Gemini API (gemini-2.5-flash and gemini-2.0-flash-lite models) is integrated for translation, AI-powered learning, OCR, and context-aware document assistance. Serverless storage handles documents, and secure session-based Google OAuth manages authentication. An internationalization (i18n) system using React Context API supports seamless language switching (English/Korean).

### Feature Specifications
- **Translation System**: Optimized batch translation with context preservation, JSON response, Server-Sent Events (SSE), and Gemini-based text type detection.
- **Content Integration**: Automated crawling and storage of public domain literature (e.g., Project Gutenberg) and academic papers (arXiv), including PDF text extraction and section-based processing.
- **Practice & Learning**: Comprehensive session data recording, dynamic difficulty adaptation, flashcard and quiz modes, intelligent distractor generation, AI-powered daily review recommendations, and a Spaced Repetition System (Leitner algorithm).
- **Document & Sentence Management**: Sorting, filtering, real-time searching, favorites system, enhanced status filters, bulk operations, and editable category dropdowns.
- **AI Coaching**: Provides AI-powered sentence coaching (polished translation, grammar insights, nuance tips) in comprehension and composition modes with tier-based access.
- **Context-Aware AI Assistant**: Leverages full document context for intelligent Q&A for Pro users.
- **Monetization**: Subscription tiers (Free/Pro/Admin) with differentiated AI model access (gemini-1.5-flash for Free, gemini-1.5-pro for Pro) and PortOne payment gateway integration.
- **Core Enhancements**: Gemini-based language detection, language-agnostic schema for multi-language pair support, and a `translations` table for storing multiple language pair translations.
- **User Authentication**: Secure session-based Google OAuth, email verification, and password reset.
- **Document Processing**: AI-generated document summaries with caching, and a robust document upload process including automatic source language detection.

### System Design Choices
Core architectural decisions include smart routing, a unified practice flow, and a 3-tier Practice Hub structure. Enhanced document processing leverages Gemini for text type detection and cost-efficient single-pass translation. Data separation distinguishes and handles `is_public` documents. The platform features robust error handling, user feedback systems, and a subscription tier system with AI model differentiation as a central monetization strategy. Safety settings are configured to BLOCK_ONLY_HIGH to allow discussion of complex literary and academic themes.

The PDF processing pipeline prioritizes stable position anchoring with a 2-track system (Layout Track for viewer, Translation Track for sentences). It uses a unified pipeline for both uploaded and arXiv PDFs. Header/footer detection is based on HF Zone, signal rules, and running header exceptions. Subheading detection relies on visual signals and keyword forcing. A safe hyphen joining policy is implemented. Archetype-aware sentence splitting (Academic, Literary, Essay, Generic modes) ensures specialized logic for different content types, including handling abbreviations, citations, fragments, and dialogue. A Sentence/Utterance Type System explicitly categorizes content for Translation Memory (TM) eligibility, preventing TM pollution from fragments while allowing user override. The paragraph separation logic adheres to a single source of truth: paragraph boundaries derived from layout, and sentence boundaries from grammar, processed in separate stages.

## External Dependencies
- **Google Gemini API**: Used for document translation, text type detection, glossary generation, AI-powered language practice, AI coaching, OCR, and document summarization. Models: gemini-2.5-flash (Pro users) and gemini-2.0-flash-lite (Free/Starter users and OCR).
- **arXiv API**: Integrated for fetching and processing academic papers.
- **PyMuPDF (pymupdf)**: Primary PDF text extraction library for layout-first processing with line-level extraction.
- **pdftotext**: Legacy/fallback dependency for extracting text from PDF documents.
- **PortOne (Iamport)**: Payment gateway integrated for subscription management.
- **Email Service**: Used for transactional emails (e.g., verification, password reset).