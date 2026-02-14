import { Router, type Request, type Response } from "express";
import { storage } from "../storage.js";
import { DocumentService } from "../services/DocumentService.js";
import { TranslationService, type UserPlan } from "../services/TranslationService.js";
import { GeminiService } from "../services/GeminiService.js";
import { LanguageDetectionService } from "../services/LanguageDetectionService.js";
import { TokenTrackingService } from "../services/TokenTrackingService.js";
import { PLAN_LIMITS } from "@shared/schema";
import multer from "multer";
import * as mammoth from "mammoth";
import { parsePDFWithArchetype, type Block, type PDFParseResult } from "../pdfUtils.js";
import { validateUrl, fetchHtml, extractArticle, extractMetadata, normalizeUrl } from "../utils/urlUtils.js";
import { generateStructuredBlocks } from "../utils/structuredUtils.js";
import { authenticateJWT, optionalAuthenticateJWT, type AuthenticatedRequest } from "../auth.js";
import { z } from "zod";

const router = Router();

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY;
if (!GOOGLE_API_KEY) {
  console.error("[SUMMARY] GOOGLE_API_KEY environment variable is not set");
}

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max
  },
  fileFilter: (_req, file, cb) => {
    // Accept text, PDF and various DOCX mimetypes
    const allowedMimes = [
      "text/plain",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/msword",
      "application/vnd.ms-word.document.macroEnabled.12",
    ];

    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// DELETE /:id - Delete a document
router.delete("/:id", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  const documentId = parseInt(req.params.id);
  const userId = req.userId!;

  try {
    // Check if document exists and belongs to user
    const document = await storage.getDocument(documentId);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Check ownership for non-admin users
    if (document.userId !== userId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: "You don't have permission to delete this document" });
    }

    const success = await storage.deleteDocument(documentId);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(500).json({ error: "Failed to delete document" });
    }
  } catch (error) {
    console.error("Error deleting document:", error);
    res.status(500).json({ error: "Failed to delete document" });
  }
});

// PATCH /:id - Update a document (e.g., category)
router.patch("/:id", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  const documentId = parseInt(req.params.id);
  const userId = req.userId!;

  try {
    // Check if document exists and belongs to user
    const document = await storage.getDocument(documentId);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Check ownership for non-admin users
    if (document.userId !== userId && req.user?.role !== 'admin') {
      return res.status(403).json({ error: "You don't have permission to update this document" });
    }

    // Validate the update payload
    const { category } = req.body;
    const validCategories = ['Academic', 'Literature', 'News', 'Essays'];
    
    if (category && !validCategories.includes(category)) {
      return res.status(400).json({ error: "Invalid category. Must be one of: Academic, Literature, News, Essays" });
    }

    // Update the document
    const updatedDocument = await storage.updateDocument(documentId, { category });
    res.json(updatedDocument);
  } catch (error) {
    console.error("Error updating document:", error);
    res.status(500).json({ error: "Failed to update document" });
  }
});

// Add to Library endpoint
router.post("/:id/add-to-library", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const documentId = parseInt(req.params.id);
    const userId = req.userId;
    
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Get the document to copy
    const originalDoc = await storage.getDocumentWithParagraphs(documentId);
    if (!originalDoc) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Check if this is a public document that we're adding to our library
    if (!originalDoc.isPublic) {
      return res
        .status(400)
        .json({ error: "Document is already in your library" });
    }

    // STEP 1: Create new document with V2 metadata preservation
    console.log(`[LIBRARY_SAVE] Creating library copy with V2 metadata preservation`);
    const newDocument = await storage.createDocumentWithParagraphs({
      title: originalDoc.title,
      sourceLanguage: originalDoc.sourceLanguage,
      userId: userId, // ✅ Correctly set userId for library documents
      fileType: originalDoc.fileType || "text",
      sourceType: "explore", // Mark as saved from explore
      author: originalDoc.author ?? undefined,
      source: originalDoc.source ?? undefined,
      category: originalDoc.category ?? undefined,
      difficulty: originalDoc.difficulty ?? undefined,
      // P0 FIX: V2 metadata preservation using ?? instead of ||
      structuredContent: originalDoc.structuredContent ?? undefined,
      structuredVersion: originalDoc.structuredVersion ?? 2, // Default to V2 if null
      anchorSchemaVersion: originalDoc.anchorSchemaVersion ?? 2,
      contentSourceType: originalDoc.contentSourceType ?? undefined,
      tokenizerVersion: originalDoc.tokenizerVersion ?? undefined,
      processingState: "ps_committed", // Start with PS committed for anchor reattachment
      tags: originalDoc.tags ?? undefined,
      originalUrl: originalDoc.originalUrl ?? undefined,
      licenseType: originalDoc.licenseType ?? undefined,
      isPublic: false, // Not public in user's library
      paragraphs: (originalDoc.paragraphs || []).map((p: any) => ({
        order: p.order,
        title: p.title || null,
        sentences: (p.sentences || []).map((s: any) => ({
          order: s.order,
          source: s.source,
          sourceHash: s.sourceHash || undefined, // Preserve sourceHash for anchor matching
          target: s.target || undefined,
        })),
      })),
    });

    // STEP 2: Anchor reattachment if structured content exists
    if (originalDoc.structuredContent && (originalDoc.structuredVersion ?? 0) >= 2) {
      try {
        console.log(`[LIBRARY_SAVE] Starting anchor reattachment for document ${newDocument.id}`);

        // Import anchor utilities
        const { attachAnchorsToStructuredContent } = await import("../utils/anchorUtils.js");

        // Get the newly created document with full paragraph/sentence data
        const newDocumentWithData = await storage.getDocumentWithParagraphs(newDocument.id);
        if (!newDocumentWithData) {
          throw new Error("Failed to retrieve newly created document");
        }

        // Parse structured content
        let structuredBlocks;
        if (typeof originalDoc.structuredContent === 'string') {
          structuredBlocks = JSON.parse(originalDoc.structuredContent);
        } else {
          structuredBlocks = originalDoc.structuredContent;
        }

        if (Array.isArray(structuredBlocks) && structuredBlocks.length > 0) {
          // Reattach anchors to new sentence IDs
          const blocksWithNewAnchors = await attachAnchorsToStructuredContent(
            structuredBlocks,
            newDocumentWithData
          );

          // Update the document with reattached anchors
          await storage.updateDocument(newDocument.id, {
            structuredContent: JSON.stringify(blocksWithNewAnchors),
            processingState: "completed" // Mark as fully processed
          });

          console.log(`[LIBRARY_SAVE] ✅ Anchor reattachment completed for document ${newDocument.id}`);
        } else {
          console.log(`[LIBRARY_SAVE] No structured blocks found, marking as completed`);
          await storage.updateDocument(newDocument.id, {
            processingState: "completed"
          });
        }
      } catch (anchorError) {
        console.error(`[LIBRARY_SAVE] Anchor reattachment failed:`, anchorError);
        // Still mark as completed to prevent blocking, but log the issue
        await storage.updateDocument(newDocument.id, {
          processingState: "completed"
        });
      }
    } else {
      // No structured content, mark as completed directly
      await storage.updateDocument(newDocument.id, {
        processingState: "completed"
      });
    }

    res.json({
      success: true,
      documentId: newDocument.id,
      message: "Document added to your library",
    });
  } catch (error) {
    console.error("Error adding document to library:", error);
    res.status(500).json({ error: "Failed to add document to library" });
  }
});

// GET /:id - Get a single document (public documents accessible without auth)
router.get("/:id", optionalAuthenticateJWT, async (req: AuthenticatedRequest, res) => {
  const documentId = parseInt(req.params.id);

  try {
    // Get user ID from authentication if available
    const userId = req.userId || undefined;

    const document = await storage.getDocumentWithParagraphs(documentId, userId);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Basic access control: allow access to public documents or documents without userId restriction
    // In a more robust implementation, you would implement proper user-specific access control
    if (!document.isPublic && document.userId && userId && document.userId !== userId) {
      console.log(`[DEBUG] Document ${documentId} access denied for user ${userId}`);
      return res.status(403).json({
        error: 'Access denied to this document'
      });
    }

    // Phase 1: Generate sentencesById with NEW SCHEMA data
    const sentencesById: Record<number, any> = {};

    // Collect all sentence IDs from the document
    const sentenceIds: number[] = [];
    document.paragraphs?.forEach((paragraph: any) => {
      paragraph.sentences?.forEach((sentence: any) => {
        sentenceIds.push(sentence.id);
      });
    });

    // Get user-specific data for all sentences in one query (if user is authenticated)
    let userSentenceStates: Record<number, any> = {};
    let userNotes: Record<number, any> = {};

    if (userId && sentenceIds.length > 0) {
      // Fetch user sentence states (bookmarks, learning status) 
      try {
        const stateData = await storage.getUserSentenceStates(userId, sentenceIds);
        userSentenceStates = stateData.reduce((acc: any, state: any) => {
          acc[state.sentenceId] = state;
          return acc;
        }, {});
      } catch (error) {
        console.log(`[DEBUG] No user sentence states found for user ${userId}`);
      }

      // Fetch user notes for sentences
      try {
        const notesData = await storage.getUserNotesForSentences(userId, sentenceIds);
        userNotes = notesData.reduce((acc: any, note: any) => {
          acc[note.sentenceId] = note;
          return acc;
        }, {});
      } catch (error) {
        console.log(`[DEBUG] No user notes found for user ${userId}`);
      }
    }

    document.paragraphs?.forEach((paragraph: any) => {
      paragraph.sentences?.forEach((sentence: any) => {
        const userState = userSentenceStates[sentence.id];
        const userNote = userNotes[sentence.id];

        sentencesById[sentence.id] = {
          ...sentence,
          // NEW SCHEMA: Use user_sentence_state data
          isBookmarked: userState?.isBookmarked || false,
          isScrapped: userState?.isBookmarked || false, // Legacy compatibility
          learningStatus: userState?.learningStatus || 'new',
          lastPracticedAt: userState?.lastPracticedAt || null,

          // NEW SCHEMA: Use notes table data - note field removed, use noteContent
          noteContent: userNote?.content || undefined,
          noteId: userNote?.id || undefined,
          noteTags: userNote?.tags || undefined,
          noteCreatedAt: userNote?.createdAt || undefined,

          // Legacy fields for compatibility (keep existing if no new data)
          practiceCount: sentence.practiceCount || 0,
          score: sentence.score || 0,
          lastPracticed: userState?.lastPracticedAt || sentence.lastPracticed,
          isFavorite: userState?.isBookmarked || sentence.isFavorite || false,
          isArchived: sentence.isArchived || false,
          difficulty: sentence.difficulty,
          masteryLevel: sentence.masteryLevel,
          reviewCount: sentence.reviewCount || 0,
          streak: sentence.streak || 0,
        };
      });
    });

    console.log(`[DEBUG] GET /:id - Generated sentencesById with ${Object.keys(sentencesById).length} sentences`);
    console.log(`[DEBUG] hasSentencesById: ${Object.keys(sentencesById).length > 0}`);
    console.log(`[DEBUG] User ${userId} - Found ${Object.keys(userSentenceStates).length} states, ${Object.keys(userNotes).length} notes`);

    // Check for stale translation status (running for more than 10 minutes)
    const TRANSLATION_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
    let effectiveTranslationStatus = document.translationStatus;
    
    if (document.translationStatus === 'running' && document.translationUpdatedAt) {
      const elapsedMs = Date.now() - new Date(document.translationUpdatedAt).getTime();
      if (elapsedMs > TRANSLATION_TIMEOUT_MS) {
        console.log(`[TRANSLATE] Document ${documentId} translation stale (${Math.round(elapsedMs / 1000 / 60)} min), resetting to idle`);
        // Update in background, don't wait
        storage.updateDocument(documentId, { 
          translationStatus: 'idle',
          translationError: 'Translation timed out. Please try again.'
        }).catch(err => console.error('[TRANSLATE] Failed to reset stale status:', err));
        effectiveTranslationStatus = 'idle';
      }
    }

    // Reorganize data structure to match expected format (Phase 1: Core logic preservation)
    const transformedDocument = {
      ...document,
      translationStatus: effectiveTranslationStatus, // Use effective status (may be reset from stale)
      sentencesById, // Add the sentencesById object for anchor resolution
      paragraphs: document.paragraphs?.map((paragraph: any) => ({
        ...paragraph,
        sentences: paragraph.sentences?.map((sentence: any) => ({
          ...sentence,
          practiceCount: sentence.practiceCount,
          score: sentence.score,
          lastPracticed: sentence.lastPracticed,
          isFavorite: sentence.isFavorite,
          isArchived: sentence.isArchived,
          // Legacy note field removed - notes now come from sentencesById via userNote?.content
          difficulty: sentence.difficulty,
          masteryLevel: sentence.masteryLevel,
          reviewCount: sentence.reviewCount,
          streak: sentence.streak,
        })),
      })),
    };

    res.json(transformedDocument);
  } catch (error) {
    console.error("Error fetching document:", error);
    res.status(500).json({ error: "Failed to fetch document" });
  }
});

// GET /:id/notes - Get all notes for a specific document
router.get("/:id/notes", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const documentId = parseInt(req.params.id);

    if (!documentId || isNaN(documentId)) {
      return res.status(400).json({ error: "Valid document ID is required" });
    }

    // Get notes for all sentences in the document
    const notesWithSentences = await storage.getNotesForDocument(documentId, userId!);
    res.json(notesWithSentences);
  } catch (error) {
    console.error("Error fetching document notes:", error);
    res.status(500).json({ error: "Failed to fetch document notes" });
  }
});

// POST /upload - Upload and process document
router.post("/upload", authenticateJWT, upload.single("file"),
  async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const userId = req.userId!;
    const user = await storage.getUser(userId);
    const userPlan = (user?.plan || "starter") as UserPlan;
    const limits = PLAN_LIMITS[userPlan] || PLAN_LIMITS.starter;

    if (userPlan === "starter") {
      const userDocs = await storage.getUserDocuments({ userId, status: 'active' });
      if (userDocs.length >= limits.maxConcurrentDocuments) {
        return res.status(403).json({
          error: "Upload limit reached",
          errorCode: "CONCURRENT_DOC_LIMIT",
          message: `Starter 플랜에서는 동시에 ${limits.maxConcurrentDocuments}개의 문서만 보관할 수 있습니다. 기존 문서를 삭제한 후 업로드해 주세요.`,
        });
      }
    }

    const tokenCheck = await TokenTrackingService.checkTokenLimit(userId, userPlan);
    if (!tokenCheck.canProceed) {
      return res.status(403).json({
        error: "Token limit exceeded",
        errorCode: tokenCheck.errorCode,
        message: tokenCheck.message,
      });
    }

    const { title } = req.body;

    try {
      let content: string;
      let filename = req.file.originalname || "document";

      let document;

      // Process based on file type using STRUCTURAL DIRECT-PASS for PDFs
      if (req.file.mimetype === "application/pdf") {
        console.log("========================================");
        console.log("!!!!!! PDF UPLOAD - STRUCTURAL DIRECT-PASS !!!!!!");
        console.log("========================================");
        console.log(`[PDF Upload] Processing PDF: ${filename}, size: ${req.file.buffer.length} bytes`);

        // 🔧 STRUCTURAL DIRECT-PASS with ARCHETYPE DETECTION per instructions.md
        // Get Block[] AND archetype info from pdfUtils
        const { blocks, archetype } = await parsePDFWithArchetype(req.file.buffer);

        // Validation
        if (!blocks || blocks.length === 0) {
          return res.status(400).json({ error: "PDF appears to be empty or could not be processed" });
        }

        // Calculate total content length for validation
        const totalContentLength = blocks.reduce((sum, b) => sum + (b.content?.length || 0), 0);
        if (totalContentLength > 500000) {
          return res.status(400).json({ error: "PDF is too large (max 500KB of text)" });
        }

        console.log(`[PDF Upload] 🔧 Direct-pass: ${blocks.length} blocks, ${totalContentLength} chars total`);
        console.log(`[PDF Upload] 🎯 Archetype: ${archetype.archetype} (confidence: ${archetype.confidence.toFixed(2)})`);
        
        // 🔧 VERIFICATION LOG: Block[] JSON before DocumentService
        console.log(`[PDF Upload] 📋 Block[] sample (first 2):`);
        console.log(JSON.stringify(blocks.slice(0, 2), null, 2));

        // 🌐 AUTO LANGUAGE DETECTION: Extract sample text from blocks for detection
        const sampleText = blocks.slice(0, 5).map(b => b.content).join(" ").substring(0, 500);
        const langDetection = await LanguageDetectionService.detectLanguage(sampleText);
        const detectedSourceLanguage = langDetection.language || "en";
        console.log(`[PDF Upload] 🌐 Detected language: ${detectedSourceLanguage} (confidence: ${langDetection.confidence.toFixed(2)})`);

        // 🔧 PASSIVE PERSISTENCE: DocumentService receives Block[] + archetype directly
        document = await DocumentService.createDocumentFromBlocks({
          title: title || filename,
          blocks,
          sourceLanguage: detectedSourceLanguage,
          userId: req.userId,
          source: "Upload",
          archetype: archetype.archetype,
          archetypeConfidence: archetype.confidence,
          archetypeSource: archetype.source
        });

        console.log(`[PDF Upload] ✅ Document ${document.id} created via direct-pass pipeline (archetype: ${archetype.archetype}, lang: ${detectedSourceLanguage})`);

      } else {
        // Handle other file types with legacy pipeline
        if (
          req.file.mimetype ===
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
          req.file.mimetype === "application/msword"
        ) {
          const result = await mammoth.extractRawText({
            buffer: req.file.buffer,
          });
          content = result.value;
        } else {
          // Text file
          content = req.file.buffer.toString("utf-8");
        }

        // Basic content validation for non-PDF files
        if (!content || content.trim().length === 0) {
          return res.status(400).json({ error: "File appears to be empty" });
        }

        if (content.length > 500000) {
          return res.status(400).json({ error: "File is too large (max 500KB of text)" });
        }

        // 🌐 AUTO LANGUAGE DETECTION for non-PDF files
        const sampleText = content.substring(0, 500);
        const langDetection = await LanguageDetectionService.detectLanguage(sampleText);
        const detectedSourceLanguage = langDetection.language || "en";
        console.log(`[File Upload] 🌐 Detected language: ${detectedSourceLanguage} (confidence: ${langDetection.confidence.toFixed(2)})`);

        // Use legacy pipeline for non-PDF files
        document = await DocumentService.createFromText({
          title: title || filename,
          content,
          sourceLanguage: detectedSourceLanguage,
        });
      }

      res.status(201).json({
        success: true,
        document: document,
        message: "Document uploaded and processed successfully",
      });
    } catch (error) {
      console.error("File upload error:", error);
      res.status(500).json({
        error: "Failed to process uploaded file",
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
);

// NOTE: Legacy structured content processing endpoint removed
// Documents are processed during creation only - no regeneration during retrieval

// GET /:id/download - Download document as file
router.get("/:id/download", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  const documentId = parseInt(req.params.id);
  const userId = req.userId!;

  try {
    const user = await storage.getUser(userId);
    const userPlan = (user?.plan || "starter") as UserPlan;
    const limits = PLAN_LIMITS[userPlan] || PLAN_LIMITS.starter;

    if (!limits.canExport) {
      return res.status(403).json({
        error: "Export not available",
        errorCode: "EXPORT_NOT_AVAILABLE",
        message: "문서 다운로드는 Pro 플랜에서 이용하실 수 있습니다.",
      });
    }

    const document = await storage.getDocumentWithParagraphs(documentId);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Generate text content from paragraphs and sentences
    let textContent = `${document.title}\n\n`;

    if (document.paragraphs && document.paragraphs.length > 0) {
      for (const paragraph of document.paragraphs) {
        if (paragraph.title) {
          textContent += `${paragraph.title}\n\n`;
        }

        if (paragraph.sentences && paragraph.sentences.length > 0) {
          for (const sentence of paragraph.sentences) {
            textContent += `${sentence.source}\n`;
            if (sentence.target) {
              textContent += `${sentence.target}\n`;
            }
            textContent += "\n";
          }
        }
        textContent += "\n";
      }
    }

    // Set headers for file download
    const filename = `${document.title || "document"}.txt`;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`,
    );

    res.send(textContent);
  } catch (error) {
    console.error("Error downloading document:", error);
    res.status(500).json({ error: "Failed to download document" });
  }
});

// Create document from text content
router.post("/create-from-text", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const { title, content, sourceLanguage } = req.body;
    const userId = req.userId!;

    const user = await storage.getUser(userId);
    if (user && user.plan === "starter" && user.documentsUploaded >= 3) {
      return res.status(403).json({
        error: "Upload limit reached",
        errorCode: "UPLOAD_LIMIT_REACHED",
        message: "Starter 플랜에서는 문서를 최대 3회까지 체험할 수 있어요.",
      });
    }

    const document = await DocumentService.createFromText({
      title,
      content,
      sourceLanguage,
      userId,
    });

    if (user && user.plan === "starter") {
      await storage.updateUser(userId, { documentsUploaded: (user.documentsUploaded || 0) + 1 });
    }

    res.status(201).json(document);
  } catch (error) {
    console.error("Error creating document from text:", error);
    if (error instanceof Error && error.message === "Missing required fields") {
      return res.status(400).json({ message: error.message });
    }
    res.status(500).json({ message: "Failed to create document" });
  }
});

// Get user documents with type filtering (uploads, saved, rss)
router.get("/", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { category, sortBy, type, status = "active", feedId, search } = req.query;
    const userId = req.userId; // Get authenticated user ID

    console.log(`[DEBUG] Documents API called with:`, { 
      type, 
      feedId, 
      userId: userId,
      status,
      category,
      sortBy,
      search 
    });

    // CRITICAL: Validate userId is present
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Use DocumentService for consistent filtering with strict user isolation
    const documents = await DocumentService.getUserDocuments({
      userId: userId, // CRITICAL: Pass userId to ensure user isolation
      category: category as string,
      sortBy: sortBy as string,
      type: type as string,
      search: search as string,
      status: status as "active" | "archived" | "all",
      feedId: feedId ? parseInt(feedId as string) : undefined,
    });

    console.log(`[DEBUG] User ${userId} - returned ${documents.length} documents from storage`);

    // No additional filtering needed since storage already handles user isolation
    res.json(documents);
  } catch (error) {
    console.error("Error fetching user documents:", error);
    res.status(500).json({ error: "Failed to fetch user documents" });
  }
});

// Archive a document
router.post("/:id/archive", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    console.log(`[ARCHIVE] Attempting to archive document ${id}`);

    // Check if document exists and is not archived
    const document = await storage.getDocument(id);
    if (!document) {
      console.log(`[ARCHIVE] Document ${id} not found`);
      return res.status(404).json({ message: "Document not found" });
    }

    console.log(
      `[ARCHIVE] Document ${id} found, isArchived: ${document.isArchived}`,
    );

    if (document.isArchived) {
      console.log(`[ARCHIVE] Document ${id} is already archived`);
      return res
        .status(400)
        .json({ message: "Document is already archived" });
    }

    const updatedDocument = await storage.archiveDocument(id);
    if (!updatedDocument) {
      console.log(`[ARCHIVE] Failed to archive document ${id}`);
      return res.status(500).json({ message: "Failed to archive document" });
    }

    console.log(
      `[ARCHIVE] Document ${id} archived successfully, isArchived: ${updatedDocument.isArchived}`,
    );
    res.json({
      message: "Document archived successfully",
      document: updatedDocument,
    });
  } catch (error) {
    console.error("Error archiving document:", error);
    res.status(500).json({ message: "Failed to archive document" });
  }
});

// Restore an archived document
router.post("/:id/restore", async (req, res) => {
  try {
    const id = parseInt(req.params.id);

    // Check if document exists and is archived
    const document = await storage.getDocument(id);
    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    if (!document.isArchived) {
      return res.status(400).json({ message: "Document is not archived" });
    }

    const updatedDocument = await storage.restoreDocument(id);
    if (!updatedDocument) {
      return res.status(500).json({ message: "Failed to restore document" });
    }

    res.json({
      message: "Document restored successfully",
      document: updatedDocument,
    });
  } catch (error) {
    console.error("Error restoring document:", error);
    res.status(500).json({ message: "Failed to restore document" });
  }
});

// Schema for URL import request
const createFromUrlSchema = z.object({
  url: z.string().url("올바른 URL을 입력해주세요"),
  folderId: z.number().optional(),
});

// URL Preview endpoint (doesn't create document, just extracts metadata)
router.post("/preview-url", async (req: Request, res: Response) => {
  try {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    // Import URL processing utilities
    const { extractContentFromUrl } = await import("../utils/urlUtils.js");

    // Extract content and metadata without creating document
    const result = await extractContentFromUrl(url);

    res.json({
      title: result.title,
      author: result.author,
      source: result.source,
      content: result.content,
      contentLength: result.content.length
    });

  } catch (error) {
    console.error("Error previewing URL:", error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to preview URL" 
    });
  }
});

// Create Library document directly from URL (same as file upload)
router.post("/create-from-url-library", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { url, title, author, sourceLanguage } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!url || !title || !sourceLanguage) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Import URL processing utilities
    const { extractContentFromUrl } = await import("../utils/urlUtils.js");

    // Extract content from URL
    const urlResult = await extractContentFromUrl(url);

    // Use DocumentService to create Library document directly
    const { DocumentService } = await import("../services/DocumentService.js");

    const document = await DocumentService.createDocumentWithPSAndStructureV2({
      title: title,
      content: urlResult.content,
      sourceLanguage: sourceLanguage,
      userId: userId,
      source: urlResult.source || "Web Import",
      contentType: "html",
      isPublic: false, // Library documents are private
      category: "Other",
      author: author || urlResult.author,
      originalUrl: url
    });

    // Set thumbnail status for web content
    await storage.updateDocument(document.id, { 
      thumbnailStatus: "pending"
    });

    console.log(`[CREATE_URL_LIBRARY] Created Library document ${document.id} from URL: ${url}`);

    res.json(document);

  } catch (error) {
    console.error("Error creating Library document from URL:", error);
    res.status(500).json({ 
      error: error instanceof Error ? error.message : "Failed to create document from URL" 
    });
  }
});

// Create document from URL (Explore용)
router.post("/create-from-url", async (req: Request, res: Response) => {
  try {
    console.log(`[URL_IMPORT] Starting URL import process`);

    // Validate request body
    const validation = createFromUrlSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ 
        error: validation.error.errors[0]?.message || "잘못된 요청입니다" 
      });
    }

    const { url, folderId } = validation.data;

    // Additional URL validation
    const urlValidation = validateUrl(url);
    if (!urlValidation.isValid) {
      return res.status(400).json({ error: urlValidation.error });
    }

    // Check for duplicates using original URL (simplified approach)
    // In a more robust implementation, we would use canonical URL matching
    const existingDocuments = await storage.getAllDocuments();
    const existingDocument = existingDocuments.find(doc => 
      doc.originalUrl && (doc.originalUrl === url || normalizeUrl(doc.originalUrl) === normalizeUrl(url))
    );

    if (existingDocument) {
      console.log(`[URL_IMPORT] Duplicate found, returning existing document ${existingDocument.id}`);
      return res.json({ 
        documentId: existingDocument.id,
        isDuplicate: true,
        message: "이미 존재하는 문서입니다" 
      });
    }

    // Step 1: Fetch HTML content
    console.log(`[URL_IMPORT] Fetching HTML from: ${url}`);
    const html = await fetchHtml(url);

    // Step 2: Extract article content using Readability
    console.log(`[URL_IMPORT] Extracting article content`);
    const article = extractArticle(html, url);

    // Step 3: Extract metadata
    const metadata = extractMetadata(html);

    // Step 4: Generate structured blocks using HTML parser
    console.log(`[URL_IMPORT] Generating structured blocks`);
    const structuredBlocks = await generateStructuredBlocks(
      article.content,
      "html", // Force HTML mode for web content
      "Web Import"
    );

    // Step 5: Determine document properties from metadata
    const hostname = new URL(url).hostname;
    const title = article.title || metadata.title || `Web Import from ${hostname}`;
    const author = article.byline || metadata.author || hostname;
    const category = "Other"; // Default category for web imports

    // Detect language (simple heuristic)
    const sourceLanguage = metadata.language?.substring(0, 2) || "en"; // Default to English

    // Step 6: Create document using DocumentService V2
    const document = await DocumentService.createDocumentWithPSAndStructureV2({
      title,
      content: article.content,
      sourceLanguage,
      source: metadata.siteName || hostname,
      contentType: "html",
      isPublic: true, // Create in Explore initially
      category,
      author,
      originalUrl: url,
      publishedAt: metadata.publishedTime ? new Date(metadata.publishedTime) : new Date(),
    });

    console.log(`[URL_IMPORT] ✅ Document created successfully: ${document.id}`);

    res.json({
      documentId: document.id,
      title: document.title,
      blocksCount: structuredBlocks.length,
      contentLength: article.content.length,
      message: "문서가 성공적으로 생성되었습니다"
    });

  } catch (error) {
    console.error(`[URL_IMPORT] Error creating document from URL:`, error);

    let errorMessage = "URL에서 문서를 생성하는 중 오류가 발생했습니다";

    if (error instanceof Error) {
      if (error.message.includes('요청 시간이 초과')) {
        errorMessage = "웹페이지 로딩 시간이 초과되었습니다. 다시 시도해주세요";
      } else if (error.message.includes('HTTP 403') || error.message.includes('HTTP 404')) {
        errorMessage = "해당 웹페이지에 접근할 수 없습니다";
      } else if (error.message.includes('메인 콘텐츠를 추출할 수 없습니다')) {
        errorMessage = "페이지에서 읽을 수 있는 콘텐츠를 찾을 수 없습니다";
      }
    }

    res.status(500).json({ error: errorMessage });
  }
});

// POST /:id/generate-summary - Generate AI summary for a document
router.post("/:id/generate-summary", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    if (!GOOGLE_API_KEY) {
      return res.status(500).json({ 
        error: "AI summary generation is not configured. Please set GOOGLE_API_KEY environment variable." 
      });
    }

    const documentId = parseInt(req.params.id);
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const document = await storage.getDocumentWithParagraphs(documentId);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    if (!document.isPublic && document.userId !== userId) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (document.summaryEn && document.summaryKo) {
      return res.json({
        summaryEn: document.summaryEn,
        summaryKo: document.summaryKo,
        cached: true,
      });
    }

    const paragraphs = document.paragraphs || [];
    let fullText = "";
    
    for (const paragraph of paragraphs) {
      const sentences = paragraph.sentences || [];
      for (const sentence of sentences) {
        fullText += sentence.source + " ";
      }
      fullText += "\n\n";
    }

    const textToSummarize = fullText.substring(0, 3000);

    const englishSummaryPrompt = `Summarize the following document in English in 3-5 clear, concise sentences. Focus on the main ideas and key points.

Document:
${textToSummarize}

Summary (3-5 sentences):`;

    const summaryEn = await GeminiService.generateText(
      englishSummaryPrompt,
      "You are a professional document summarizer. Provide clear, concise summaries.",
      { maxTokens: 300, temperature: 0.3, plan: "starter", userId }
    );

    const koreanSummaryPrompt = `Summarize the following document in Korean in 3-5 clear, concise sentences. Focus on the main ideas and key points.

Document:
${textToSummarize}

Summary (Korean, 3-5 sentences):`;

    const summaryKo = await GeminiService.generateText(
      koreanSummaryPrompt,
      "You are a professional document summarizer. Provide clear, concise summaries in Korean.",
      { maxTokens: 300, temperature: 0.3, plan: "starter", userId }
    );

    await storage.updateDocument(documentId, {
      summaryEn: summaryEn.trim(),
      summaryKo: summaryKo.trim(),
    });

    console.log(`[SUMMARY] Generated summaries for document ${documentId}`);

    res.json({
      summaryEn: summaryEn.trim(),
      summaryKo: summaryKo.trim(),
      cached: false,
    });
  } catch (error) {
    console.error("Error generating document summary:", error);
    res.status(500).json({ error: "Failed to generate summary" });
  }
});

// Start translation for entire document
router.post("/:id/translate", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const documentId = parseInt(req.params.id);
    const userId = req.userId!;
    
    const document = await storage.getDocumentWithParagraphs(documentId);
    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    const user = await storage.getUser(userId);
    const userPlan: UserPlan = (user?.plan as UserPlan) || "starter";

    const tokenCheck = await TokenTrackingService.checkTokenLimit(userId, userPlan);
    if (!tokenCheck.canProceed) {
      return res.status(403).json({
        error: "Token limit exceeded",
        errorCode: tokenCheck.errorCode,
        message: tokenCheck.message,
      });
    }

    const docTransCheck = await TokenTrackingService.checkFullDocTranslationLimit(userId, userPlan);
    if (!docTransCheck.canProceed) {
      return res.status(403).json({
        error: "Full document translation limit reached",
        errorCode: docTransCheck.errorCode,
        message: docTransCheck.message,
      });
    }

    await TokenTrackingService.incrementFullDocTranslation(userId);

    await storage.updateDocument(documentId, { 
      translationStatus: "running",
      translationUpdatedAt: new Date(),
      translationError: null,
    });

    res.json({ message: "Translation started", documentId });

    translateDocumentInBackground(documentId, document, userPlan, user?.email || undefined, userId);
  } catch (error) {
    console.error("Document translation request error:", error);
    res.status(500).json({ message: "Failed to start document translation" });
  }
});

// SSE clients for real-time translation updates
const translationSSEClients = new Map<number, Set<Response>>();

// Register SSE client for a document
function registerSSEClient(documentId: number, res: Response) {
  if (!translationSSEClients.has(documentId)) {
    translationSSEClients.set(documentId, new Set());
  }
  translationSSEClients.get(documentId)!.add(res);
}

// Unregister SSE client
function unregisterSSEClient(documentId: number, res: Response) {
  const clients = translationSSEClients.get(documentId);
  if (clients) {
    clients.delete(res);
    if (clients.size === 0) {
      translationSSEClients.delete(documentId);
    }
  }
}

// Send SSE event to all clients watching a document
function sendSSEEvent(documentId: number, event: { type: string; data: any }) {
  const clients = translationSSEClients.get(documentId);
  if (clients) {
    const message = `data: ${JSON.stringify(event)}\n\n`;
    clients.forEach(client => {
      try {
        client.write(message);
      } catch (error) {
        console.error(`[SSE] Error sending event:`, error);
      }
    });
  }
}

// SSE endpoint for translation progress
// EventSource cannot send Authorization headers, so we accept token via query parameter
router.get("/:id/translation-stream", async (req: AuthenticatedRequest, res) => {
  const token = req.query.token as string;
  
  if (!token) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const jwt = await import('jsonwebtoken');
    const decoded = jwt.default.verify(token, process.env.JWT_SECRET || 'default-secret-change-in-production') as any;
    const user = await storage.getUser(decoded.id);
    if (!user) {
      return res.status(403).json({ error: "Invalid token" });
    }
    req.userId = user.id;
    req.user = user;
  } catch (err) {
    return res.status(403).json({ error: "Invalid token" });
  }

  const documentId = parseInt(req.params.id);
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  
  registerSSEClient(documentId, res);
  
  res.write(`data: ${JSON.stringify({ type: 'connected', documentId })}\n\n`);
  
  req.on('close', () => {
    unregisterSSEClient(documentId, res);
  });
});

// Background translation function with batch processing
async function translateDocumentInBackground(
  documentId: number,
  document: any,
  userPlan: UserPlan,
  userEmail?: string,
  userId?: number
) {
  try {
    console.log(`[TRANSLATE] Starting batch translation for document ${documentId}`);
    
    const paragraphs = document.paragraphs || [];
    let translatedCount = 0;
    let totalSentences = 0;
    let previousContext = "";

    const headingSentenceIds = new Set<number>();
    try {
      let structuredBlocks: any[] = [];
      const sc = document.structuredContent;
      if (sc) {
        structuredBlocks = typeof sc === 'string' ? JSON.parse(sc) : (Array.isArray(sc) ? sc : []);
      }
      const headingTypes = new Set(['heading', 'document_title', 'abstract_label']);
      for (const block of structuredBlocks) {
        if (headingTypes.has(block.type) && block.anchor?.sentenceStartId != null) {
          for (let id = block.anchor.sentenceStartId; id <= block.anchor.sentenceEndId; id++) {
            headingSentenceIds.add(id);
          }
        }
      }
      if (headingSentenceIds.size > 0) {
        console.log(`[TRANSLATE] Found ${headingSentenceIds.size} heading sentence IDs from structured content`);
      }
    } catch (e) {
      console.warn(`[TRANSLATE] Failed to parse structured content for heading detection:`, e);
    }

    // Compute target language dynamically from user preferences
    const sourceLanguage = document.sourceLanguage || "en";
    const translationUser = userId ? await storage.getUser(userId) : null;
    const targetLanguage = sourceLanguage === translationUser?.baseLanguage
      ? (translationUser?.learningLanguage || "en")
      : (translationUser?.baseLanguage || "ko");

    console.log(`[TRANSLATE] Dynamic target language: ${targetLanguage} (source: ${sourceLanguage}, user base: ${translationUser?.baseLanguage}, learning: ${translationUser?.learningLanguage})`);

    // Count total sentences
    for (const paragraph of paragraphs) {
      totalSentences += (paragraph.sentences || []).length;
    }

    console.log(`[TRANSLATE] Document ${documentId}: ${paragraphs.length} paragraphs, ${totalSentences} total sentences`);

    // Process paragraphs sequentially for context continuity
    for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
      const paragraph = paragraphs[pIdx];
      const sentences = paragraph.sentences || [];
      
      // Filter untranslated sentences
      const untranslatedSentences = sentences
        .filter((s: any) => !s.target)
        .map((s: any) => ({
          id: s.id,
          source: s.source,
          type: headingSentenceIds.has(s.id) ? 'heading' as const : 'sentence' as const,
        }));
      
      // Count already translated
      const alreadyTranslated = sentences.filter((s: any) => s.target).length;
      translatedCount += alreadyTranslated;
      
      if (untranslatedSentences.length === 0) {
        console.log(`[TRANSLATE] Paragraph ${pIdx + 1}/${paragraphs.length}: Already translated`);
        continue;
      }

      console.log(`[TRANSLATE] Paragraph ${pIdx + 1}/${paragraphs.length}: Translating ${untranslatedSentences.length} sentences`);

      try {
        // Batch translate the paragraph
        const translations = await GeminiService.translateParagraphBatch(
          untranslatedSentences,
          {
            userEmail,
            userPlan,
            userId,
            sourceLanguage,
            targetLanguage,
          },
          previousContext
        );

        // Update sentences in database
        const translatedSentences: Array<{ id: number; target: string }> = [];
        for (const [sentenceId, translation] of translations) {
          await storage.updateSentence(sentenceId, { target: translation });
          translatedSentences.push({ id: sentenceId, target: translation });
          translatedCount++;
        }

        // Build context for next paragraph
        const paragraphTranslations = Array.from(translations.values()).join(" ");
        previousContext = paragraphTranslations.slice(-800);

        // Update translationUpdatedAt to prevent stale detection during active translation
        await storage.updateDocument(documentId, { 
          translationUpdatedAt: new Date(),
          translatedCount: translatedCount,
        });

        // Send SSE update for this paragraph
        sendSSEEvent(documentId, {
          type: 'paragraph_complete',
          paragraphIndex: pIdx,
          paragraphId: paragraph.id,
          sentences: translatedSentences,
          progress: { translated: translatedCount, total: totalSentences },
        });

        console.log(`[TRANSLATE] Document ${documentId}: ${translatedCount}/${totalSentences} sentences translated`);
      } catch (paragraphError) {
        console.error(`[TRANSLATE] Failed to translate paragraph ${pIdx}:`, paragraphError);
        sendSSEEvent(documentId, {
          type: 'paragraph_error',
          paragraphIndex: pIdx,
          error: String(paragraphError),
        });
      }
    }

    // Mark document as translation complete
    await storage.updateDocument(documentId, { translationStatus: "completed" });
    
    sendSSEEvent(documentId, {
      type: 'complete',
      progress: { translated: translatedCount, total: totalSentences },
    });
    
    console.log(`[TRANSLATE] ✅ Document ${documentId} batch translation completed: ${translatedCount}/${totalSentences} sentences`);
  } catch (error) {
    console.error(`[TRANSLATE] Background translation error for document ${documentId}:`, error);
    await storage.updateDocument(documentId, { translationStatus: "failed" });
    sendSSEEvent(documentId, {
      type: 'error',
      error: String(error),
    });
  }
}

export default router;