import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import multer from "multer";
import { z } from "zod";
import {
  updateSentenceSchema,
  documents,
  insertRssFeedSchema,
  notes,
  sentences,
} from "@shared/schema";
import * as schema from "@shared/schema";
import { db } from "./db";
import {
  eq,
  desc,
  sql,
  asc,
  and,
  or,
  isNull,
  not,
  gte,
  lt,
  inArray,
} from "drizzle-orm";
import * as mammoth from "mammoth";
import { parsePDF } from "./pdfUtils";
import { authenticateJWT, type AuthenticatedRequest } from "./auth";
import {
  processRSSArticles,
  validateRSSFeed,
  convertRSSItemToDocument,
  convertRSSArticleToDocument,
  syncAllActiveFeeds,
  regenerateAnchorsForRSSDocuments,
} from "./rssCrawler";
import rateLimit from "express-rate-limit";
import { thumbnailQueue } from "./thumbnailQueue";
import { crawlerScheduler } from "./scheduler";
import * as crypto from "crypto";

// Import utilities from extracted modules
import { splitIntoParagraphs, splitIntoSentences, extractTitleFromParagraph } from "./utils/textUtils.js";
import { normalizeTextForMatching, generateSentenceHash, createSentenceWithHash } from "./utils/hashUtils.js";
import { attachAnchorsToStructuredContent, type StructuredBlockWithAnchor, type DocumentWithSentenceHashes } from "./utils/anchorUtils.js";
import { generateStructuredContent as utilsGenerateStructuredContent, type StructuredBlock } from "./utils/structuredUtils.js";

// Import route modules
import documentsRoutes from "./routes/documents.js";
import sentencesRoutes from "./routes/sentences.js";
import adminRoutes from "./routes/admin.js";
import accountRoutes from "./routes/account.js";
import authRoutes from "./routes/auth.js";
import { handleImageProxy } from "./imageProxy.js";

// Content retention policy based on category (in days)
const RETENTION_POLICY: Record<string, number> = {
  News: 30,
  Opinion: 60,
  Educational: 90,
  Academic: 90,
  Literature: 180,
  Other: 30,
};

function calculateExpirationDate(category: string): Date {
  const retentionDays = RETENTION_POLICY[category] || 30; // Default 30 days
  const expirationDate = new Date();
  expirationDate.setDate(expirationDate.getDate() + retentionDays);
  return expirationDate;
}

// Import DocumentService for structured content generation
import { DocumentService } from "./services/DocumentService.js";

export async function registerRoutes(app: Express): Promise<Server> {
  // Register route modules
  app.use("/api/auth", authRoutes);
  app.use("/api/documents", documentsRoutes);
  app.use("/api/sentences", sentencesRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/me", accountRoutes);

  // Register notes routes
  const notesRoutes = await import("./routes/notes.js");
  app.use("/api", notesRoutes.default);

  // Register user sentence state routes (bookmarks, learning status)
  const userSentenceStateRoutes = await import("./routes/user-sentence-state.js");
  app.use("/api", userSentenceStateRoutes.default);

  // Register misc routes (glossary endpoints)
  const miscRoutes = await import("./routes/misc.js");
  app.use("/api", miscRoutes.default);

  // Register payment routes
  const paymentRoutes = await import("./routes/payment.js");
  app.use("/api", paymentRoutes.default);

  // Register quiz routes (Phase 3: Practice Hub)
  const quizRoutes = await import("./routes/quiz.js");
  app.use("/api", quizRoutes.default);

  // Register AI routes (AI Side-Drawer)
  const aiRoutes = await import("./routes/ai.js");
  app.use("/api/ai", aiRoutes.default);

  // Register OCR routes (Photo Import)
  const ocrRoutes = await import("./routes/ocr.js");
  app.use("/api/ocr", ocrRoutes.default);

  // Basic test route to ensure the app is working
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Image proxy endpoint for CORS handling and optimization
  app.get("/api/image-proxy", handleImageProxy);

  // All routes moved to specific modules

  // Register library routes
  const libraryRoutes = await import("./routes/library.js");
  app.use("/api", libraryRoutes.default);

  // Get all notes for a specific document
  app.get("/api/notes/document/:documentId", authenticateJWT, async (req: AuthenticatedRequest, res) => {
    try {
      const documentId = parseInt(req.params.documentId);
      const userId = req.userId!;

      console.log(`[DOCUMENT_NOTES] Fetching notes for document ${documentId}, user: ${userId}`);

      const notes = await db
        .select({
          id: schema.notes.id,
          sentenceId: schema.notes.sentenceId,
          content: schema.notes.content,
          color: schema.notes.color,
          tags: schema.notes.tags,
          createdAt: schema.notes.createdAt,
          updatedAt: schema.notes.updatedAt,
          source: schema.sentences.source,
          target: schema.sentences.target,
          paragraphNumber: schema.paragraphs.order,
          sentenceNumber: schema.sentences.order,
        })
        .from(schema.notes)
        .innerJoin(schema.sentences, eq(schema.notes.sentenceId, schema.sentences.id))
        .innerJoin(schema.paragraphs, eq(schema.sentences.paragraphId, schema.paragraphs.id))
        .where(
          and(
            eq(schema.paragraphs.documentId, documentId),
            eq(schema.notes.userId, userId)
          )
        )
        .orderBy(desc(schema.notes.updatedAt));

      console.log(`[DOCUMENT_NOTES] Found ${notes.length} notes for document ${documentId}`);

      res.json(notes);
    } catch (error) {
      console.error("[DOCUMENT_NOTES] Error fetching notes:", error);
      res.status(500).json({ message: "Failed to fetch notes" });
    }
  });

  // Create and return the HTTP server
  const server = createServer(app);
  return server;
}

// All routes have been moved to their respective modules