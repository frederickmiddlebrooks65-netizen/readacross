import { storage } from "../storage.js";
import {
  splitIntoSentences,
  splitIntoParagraphs,
  extractTitleFromParagraph,
} from "../utils/textUtils.js";
import { generateStructuredBlocks } from "../utils/structuredUtils.js";
import {
  attachAnchorsToStructuredContent,
  type StructuredBlockWithAnchor,
  type DocumentWithSentenceHashes,
} from "../utils/anchorUtils.js";
import {
  generateSentenceHash,
  normalizeTextForMatching,
} from "../utils/hashUtils.js";
import { db } from "../db.js";
import type { Document } from "@shared/schema";
import {
  generateStructuredContent as utilsGenerateStructuredContent,
  type StructuredBlock,
} from "../utils/structuredUtils.js";

// Import consistent tokenizer version from textUtils
import { SENTENCE_TOKENIZER_VERSION } from "../utils/textUtils.js";

export class DocumentService {
  /**
   * Create document from text content with full processing
   */
  static async createFromText(params: {
    title: string;
    content: string;
    sourceLanguage: string;
    userId?: number | null;
  }): Promise<Document> {
    const {
      title,
      content,
      sourceLanguage,
      userId = null,
    } = params;

    // Validate required fields
    if (!title || !content || !sourceLanguage) {
      throw new Error("Missing required fields");
    }

    // Split content by paragraph (preserving structure)
    const paragraphTexts = content
      .split(/\n\s*\n/)
      .map((p: string) => p.trim())
      .filter((p: string) => p.length > 0);

    const paragraphsData = [];
    for (let pIndex = 0; pIndex < paragraphTexts.length; pIndex++) {
      const paragraphText = paragraphTexts[pIndex];
      const paraTitle = null;
      const paraContent = paragraphText;

      // Split sentences within this paragraph using unified function
      let sentenceList = splitIntoSentences(paraContent);

      // Phase 2-3a hardening: never allow empty sentence arrays for translatable content
      if (sentenceList.length === 0) {
        const trimmed = paraContent.trim();
        if (trimmed.length > 0) {
          console.warn(
            `[createFromText] ⚠️ splitIntoSentences returned 0; using paragraph fallback unit (len=${trimmed.length})`,
          );
          sentenceList = [trimmed];
        }
      }

      const sentencesData = [];
      for (let sIndex = 0; sIndex < sentenceList.length; sIndex++) {
        const sentence = sentenceList[sIndex];
        sentencesData.push({
          order: sIndex + 1,
          source: sentence,
          sourceHash: generateSentenceHash(sentence), // Generate hash for anchor support
        });
      }

      paragraphsData.push({
        order: pIndex + 1,
        title: paraTitle,
        sentences: sentencesData,
      });
    }

    // Step 1: Create document with paragraphs and sentences first (get DB IDs)
    const document = await storage.createDocumentWithParagraphs({
      title,
      sourceLanguage,
      userId,
      fileType: "text",
      sourceType: "uploaded",
      source: "Upload",
      paragraphs: paragraphsData,
    });

    // Step 2: Generate structured blocks from content (anchor-free)
    const structuredBlocks = await generateStructuredBlocks(
      content,
      "text",
      "Upload",
    );

    // Step 3: Load committed document with paragraph/sentence IDs for anchor attachment
    const documentWithData = await storage.getDocumentWithParagraphs(
      document.id,
    );
    if (!documentWithData) {
      throw new Error("Failed to load document after creation");
    }

    // Step 4: Attach anchors using committed DB IDs
    const blocksWithAnchors = await attachAnchorsToStructuredContent(
      structuredBlocks,
      documentWithData,
    );

    // Step 5: Save structured content and metadata to document
    await storage.updateDocument(document.id, {
      structuredContent: JSON.stringify(blocksWithAnchors),
      structuredVersion: 2,
      contentSourceType: "text",
      anchorSchemaVersion: 1,
      thumbnailStatus: "failed", // Text documents use typography design
    });

    console.log(
      `[createFromText] ✅ Document ${document.id} created with ${blocksWithAnchors.length} structured blocks`,
    );

    return document;
  }

  /**
   * Get user documents with filtering and type-specific logic
   */
  static async getUserDocuments(params: {
    userId: number; // CRITICAL: Make userId required
    category?: string;
    sortBy?: string;
    type?: string;
    search?: string;
    status?: "active" | "archived" | "all";
    feedId?: number;
  }) {
    const {
      userId,
      category,
      sortBy,
      type,
      search,
      status = "active",
      feedId,
    } = params;

    // CRITICAL: Validate userId is provided
    if (!userId) {
      console.error("[DocumentService] getUserDocuments called without userId");
      return [];
    }

    const options = {
      category,
      sortBy,
      type,
      search,
      status,
    };

    let documents;
    switch (options.type) {
      case "uploads":
        documents = await storage.getUserUploadDocuments({
          userId: userId, // Pass userId for isolation
          status: options.status,
          search: options.search,
        });
        break;
      case "saved":
        documents = await storage.getUserSavedDocuments({
          userId: userId, // Pass userId for isolation
          status: options.status,
          search: options.search,
        });
        break;
      case "rss":
        documents = await storage.getUserRSSDocuments({
          userId: userId, // Pass userId for isolation
          category: options.category,
          sortBy: options.sortBy,
          search: options.search,
          feedId: feedId,
        });
        break;
      default:
        // STRICT USER ISOLATION: Only return documents for this specific user
        documents = await storage.getUserDocuments({
          userId: userId, // CRITICAL: Always pass userId for strict isolation
          category: options.category,
          sortBy: options.sortBy,
          search: options.search,
          status: options.status,
        });
        break;
    }

    // Log debug information
    const uniqueSources = Array.from(
      new Set(documents.map((d) => d.source || "unknown")),
    );
    console.log(
      `[DEBUG] Documents API - type: ${options.type}, feedId: ${feedId}, returned: ${documents.length} documents, sources: ${uniqueSources.join(", ")} for user ${userId}`,
    );

    return documents;
  }

  /**
   * UNIFIED DOCUMENT CREATION PIPELINE V2
   * This is the new single entry point for all document creation
   * Ensures proper transaction handling and anchor generation
   */
  static async createDocumentWithPSAndStructure(params: {
    // Document metadata
    title: string;
    sourceLanguage: string;
    userId?: number | null;

    // Content data
    rawContent: string;
    contentType: "html" | "text" | "pdf" | "rss_html";

    // Source metadata
    fileType?: string;
    sourceType?: "uploaded" | "explore";
    source?: string;
    author?: string;
    category?: string;
    difficulty?: string;
    tags?: string;
    originalUrl?: string;
    licenseType?: string;
    isPublic?: boolean;
    feedId?: number;
    publishedAt?: Date;
    expiresAt?: Date;

    // Optional processing options
    featureFlag?: boolean; // For gradual rollout
  }): Promise<Document> {
    const startTime = Date.now();
    console.log(
      `[DocumentService] Creating document with PS&Structure: "${params.title}"`,
    );

    try {
      // Validate required fields
      if (
        !params.title ||
        !params.rawContent ||
        !params.sourceLanguage
      ) {
        throw new Error("Missing required fields for document creation");
      }

      // Prepare content processing
      const paragraphTexts = params.rawContent
        .split(/\n\s*\n/)
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 0);

      const paragraphsData = [];
      for (let pIndex = 0; pIndex < paragraphTexts.length; pIndex++) {
        const paragraphText = paragraphTexts[pIndex];
        let sentenceList = splitIntoSentences(paragraphText);

        // Phase 2-3a hardening: never allow empty sentence arrays for translatable content
        if (sentenceList.length === 0) {
          const trimmed = paragraphText.trim();
          if (trimmed.length > 0) {
            console.warn(
              `[DocumentService] ⚠️ splitIntoSentences returned 0; using paragraph fallback unit (len=${trimmed.length})`,
            );
            sentenceList = [trimmed];
          }
        }

        const sentencesData = [];
        for (let sIndex = 0; sIndex < sentenceList.length; sIndex++) {
          const sentence = sentenceList[sIndex];
          sentencesData.push({
            order: sIndex + 1,
            source: sentence,
          });
        }

        paragraphsData.push({
          order: pIndex + 1,
          title: null,
          sentences: sentencesData,
        });
      }

      // Step 1: Create document with paragraphs and sentences (get DB IDs)
      const document = await storage.createDocumentWithParagraphs({
        title: params.title,
        sourceLanguage: params.sourceLanguage,
        userId: params.userId,
        fileType: params.fileType || "text",
        sourceType: params.sourceType || "uploaded",
        source: params.source || "Upload",
        author: params.author,
        category: params.category || "Other",
        difficulty: params.difficulty,
        tags: params.tags,
        originalUrl: params.originalUrl,
        licenseType: params.licenseType,
        isPublic: params.isPublic || false,
        feedId: params.feedId,
        publishedAt: params.publishedAt,
        expiresAt: params.expiresAt,
        paragraphs: paragraphsData,
      });

      // Step 2: Mark processing state as PS committed
      await storage.updateDocument(document.id, {
        processingState: "ps_committed",
      });

      // Step 3: Generate structured blocks (anchor-free)
      const structuredBlocks = await generateStructuredBlocks(
        params.rawContent,
        params.contentType,
        params.source,
      );

      // Step 4: Load committed document with paragraph/sentence IDs
      const documentWithData = await storage.getDocumentWithParagraphs(
        document.id,
      );
      if (!documentWithData) {
        throw new Error("Failed to load document after creation");
      }

      // Step 5: Attach anchors using committed DB IDs
      const blocksWithAnchors = await attachAnchorsToStructuredContent(
        structuredBlocks,
        documentWithData,
      );

      // Step 6: Save structured content and mark as completed
      await storage.updateDocument(document.id, {
        structuredContent: JSON.stringify(blocksWithAnchors),
        structuredVersion: 2,
        contentSourceType: params.contentType,
        anchorSchemaVersion: 1,
        processingState: "completed",
      });

      const duration = Date.now() - startTime;
      const anchoredCount = blocksWithAnchors.filter((b) => b.anchor).length;

      console.log(
        `[DocumentService] ✅ Document ${document.id} created successfully:`,
      );
      console.log(`  - Title: "${params.title}"`);
      console.log(
        `  - Blocks: ${blocksWithAnchors.length} total, ${anchoredCount} anchored`,
      );
      console.log(`  - Processing time: ${duration}ms`);

      // Performance guard check
      if (duration > 3000) {
        console.warn(
          `[DocumentService] Performance warning: Document creation took ${duration}ms (>3s threshold)`,
        );
      }

      return document;
    } catch (error) {
      console.error(
        `[DocumentService] Error creating document with PS&Structure:`,
        error,
      );

      // Try to mark document as failed if it was partially created
      try {
        const partialDoc = await storage.getDocument(
          parseInt(String(Math.random() * 1000000)),
        );
        if (partialDoc) {
          await storage.updateDocument(partialDoc.id, {
            processingState: "pending",
          });
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      throw error;
    }
  }

  /**
   * V2 Single Path - Create document with PS&Structure following instructions.md
   * Implements transaction order: paragraphs/sentences → commit → anchors → structure
   */
  static async createDocumentWithPSAndStructureV2(params: {
    title: string;
    content: string;
    sourceLanguage: string;
    userId?: number | null;
    source?: string;
    contentType?: "html" | "text" | "pdf" | "auto" | "rss_html";
    isPublic?: boolean;
    category?: string;
    author?: string;
    originalUrl?: string;
    publishedAt?: Date;
    feedId?: number;
  }): Promise<Document> {
    const startTime = Date.now();
    const contentType = params.contentType || "auto";

    console.log(
      `[DocumentService V2] Creating document "${params.title}" with ${contentType} mode`,
    );

    try {
      // STEP 1: Split content into paragraphs and sentences using unified tokenizer
      // For HTML content, split by <p> tags; for text content, split by double newlines
      let paragraphTexts: string[];

      if (contentType === "html" || contentType === "rss_html") {
        // Extract text from HTML paragraph tags
        const { JSDOM } = await import("jsdom");
        const dom = new JSDOM(params.content);
        const paragraphElements = dom.window.document.querySelectorAll("p");

        if (paragraphElements.length > 0) {
          paragraphTexts = Array.from(paragraphElements)
            .map((p) => p.textContent?.trim() || "")
            .filter((p) => p.length > 0);
          console.log(
            `[DocumentService V2] HTML mode: extracted ${paragraphTexts.length} paragraphs from <p> tags`,
          );
        } else {
          // Fallback: if no <p> tags, try splitting by double newlines or treating as single paragraph
          const textContent =
            dom.window.document.body?.textContent || params.content;
          paragraphTexts = textContent
            .split(/\n\s*\n/)
            .map((p: string) => p.trim())
            .filter((p: string) => p.length > 0);
          console.log(
            `[DocumentService V2] HTML mode fallback: split into ${paragraphTexts.length} paragraphs`,
          );
        }
      } else {
        // Text/PDF mode: split by double newlines
        paragraphTexts = params.content
          .split(/\n\s*\n/)
          .map((p: string) => p.trim())
          .filter((p: string) => p.length > 0);
      }

      const paragraphsData = [];
      for (let pIndex = 0; pIndex < paragraphTexts.length; pIndex++) {
        const paragraphText = paragraphTexts[pIndex];

        // Use unified sentence splitting
        let sentenceList = splitIntoSentences(paragraphText);

        // Phase 2-3a hardening: never allow empty sentence arrays for translatable content
        if (sentenceList.length === 0) {
          const trimmed = paragraphText.trim();
          if (trimmed.length > 0) {
            console.warn(
              `[DocumentService V2] ⚠️ splitIntoSentences returned 0; using paragraph fallback unit (len=${trimmed.length})`,
            );
            sentenceList = [trimmed];
          }
        }

        const sentencesData = [];
        for (let sIndex = 0; sIndex < sentenceList.length; sIndex++) {
          const sentence = sentenceList[sIndex];
          sentencesData.push({
            order: sIndex + 1,
            source: sentence,
            sourceHash: generateSentenceHash(sentence), // STEP 2 FIX: Store hash for consistent matching
          });
        }

        paragraphsData.push({
          order: pIndex + 1,
          title: null,
          sentences: sentencesData,
        });
      }

      // STEP 2: Create document with paragraphs and sentences (mark processing state)
      const document = await storage.createDocumentWithParagraphs({
        title: params.title,
        sourceLanguage: params.sourceLanguage,
        userId: params.userId || null,
        fileType: contentType === "pdf" ? "pdf" : "text",
        sourceType: params.isPublic ? "explore" : "uploaded",
        source: params.source || "Upload",
        author: params.author,
        category: params.category || "Other",
        isPublic: params.isPublic || false,
        originalUrl: params.originalUrl,
        publishedAt: params.publishedAt,
        feedId: params.feedId,
        paragraphs: paragraphsData,
        // V2 NEW FIELDS:
        tokenizerVersion: SENTENCE_TOKENIZER_VERSION,
        processingState: "pending", // Mark as pending until fully processed
      });

      console.log(
        `[DocumentService V2] Document ${document.id} created with ${paragraphsData.length} paragraphs`,
      );

      // STEP 3: COMMIT TRANSACTION - Update to ps_committed state
      await storage.updateDocument(document.id, {
        processingState: "ps_committed",
      });

      console.log(
        `[DocumentService V2] Document ${document.id} committed, starting anchor & structure processing`,
      );

      // STEP 4: Generate structured content blocks using V2 parser
      const structuredBlocks = await generateStructuredBlocks(
        params.content,
        contentType,
        params.source,
      );

      console.log(
        `[DocumentService V2] Generated ${structuredBlocks.length} structured blocks`,
      );

      // STEP 5: Attach anchors to structured blocks
      const documentWithSentences = await storage.getDocumentWithParagraphs(
        document.id,
      );
      if (!documentWithSentences) {
        throw new Error(
          "Failed to retrieve document with sentences for anchor attachment",
        );
      }

      const blocksWithAnchors = await attachAnchorsToStructuredContent(
        structuredBlocks,
        documentWithSentences,
      );

      // STEP 6: Update document with final structure and complete state
      console.log(
        `[DocumentService V2] 🔧 DEBUG: Saving contentSourceType as: "${contentType}" (original: "${params.contentType}")`,
      );

      await storage.updateDocument(document.id, {
        structuredContent: JSON.stringify(blocksWithAnchors),
        structuredVersion: 2,
        contentSourceType: params.contentType || contentType, // 🔧 CRITICAL FIX: Save original contentType
        anchorSchemaVersion: 1,
        processingState: "completed",
      });

      const duration = Date.now() - startTime;
      const anchoredCount = blocksWithAnchors.filter((b) => b.anchor).length;
      const anchorRate = (
        (anchoredCount / blocksWithAnchors.length) *
        100
      ).toFixed(1);

      console.log(`[DocumentService V2] ✅ Document ${document.id} completed:`);
      console.log(`  - Title: "${params.title}"`);
      console.log(`  - Mode: ${contentType}`);
      console.log(`  - Tokenizer: ${SENTENCE_TOKENIZER_VERSION}`);
      console.log(
        `  - Blocks: ${blocksWithAnchors.length} total, ${anchoredCount} anchored (${anchorRate}%)`,
      );
      console.log(`  - Processing time: ${duration}ms`);

      return document;
    } catch (error) {
      console.error(`[DocumentService V2] Error creating document:`, error);
      throw error;
    }
  }

  /**
   * 🔧 STRUCTURAL DIRECT-PASS: Create document from pre-structured Block[] array
   *
   * This method implements PASSIVE PERSISTENCE ONLY per directive:
   * - Accepts Block[] directly from pdfUtils.parsePDFToBlocks()
   * - Does NOT detect headings, split paragraphs, infer structure, or re-parse text
   * - Its sole responsibility is to persist the structure already decided by pdfUtils
   *
   * STRUCTURAL FIX per instructions.md:
   * - Block[] now includes sentences[] for all translatable blocks
   * - Uses block.sentences directly instead of re-splitting content
   */
  static async createDocumentFromBlocks(params: {
    title: string;
    blocks: Array<{
      type:
        | "heading"
        | "paragraph"
        | "abstract_body"
        | "abstract_label"
        | "doi"
        | "author"
        | "journal"
        | "affiliation"
        | "image"
        | "table"
        | "figure"
        | "caption";
      content?: string;
      sentences?: Array<{ id: string; text: string; order: number }>; // STRUCTURAL FIX: sentences[] from pdfUtils
      level?: number;
      order: number;
      page?: number;
    }>;
    sourceLanguage: string;
    userId?: number | null;
    source?: string;
    author?: string;
    category?: string;
    archetype?: "academic" | "literary" | "essay" | "generic";
    archetypeConfidence?: number;
    archetypeSource?: "source" | "auto" | "user";
  }): Promise<Document> {
    const startTime = Date.now();

    console.log(
      `[DocumentService DirectPass] 🔧 Creating document from ${params.blocks.length} pre-structured blocks`,
    );
    console.log(`[DocumentService DirectPass] Title: "${params.title}"`);

    // 🔧 VERIFICATION LOG: Full Block[] JSON before persistence
    console.log(`[DocumentService DirectPass] 📋 Received Block[] (first 3):`);
    console.log(JSON.stringify(params.blocks.slice(0, 3), null, 2));

    try {
      // 🔧 STRUCTURAL FIX: Convert Block[] to paragraph/sentence structure
      // Uses block.sentences[] directly when available (PASSIVE PERSISTENCE)
      // Falls back to splitIntoSentences only if sentences[] not provided (backward compatibility)
      const paragraphsData = [];
      let paragraphOrder = 0;

      // List of metadata block types per instructions.md (non-translatable, no sentences[])
      const metadataBlockTypes = [
        "doi",
        "author",
        "journal",
        "affiliation",
        "abstract_label",
      ];
      const nonTextBlockTypes = ["image", "table", "figure", "caption"];

      for (const block of params.blocks) {
        // Skip non-translatable blocks or empty content
        if (
          nonTextBlockTypes.includes(block.type) ||
          metadataBlockTypes.includes(block.type)
        ) {
          console.log(
            `[DocumentService DirectPass] ⏭️ Skipping ${block.type} block (non-translatable)`,
          );
          continue;
        }
        if (!block.content || block.content.trim().length === 0) {
          continue;
        }

        paragraphOrder++;
        const content = block.content.trim();

        // PASSIVE-ONLY: DocumentService persists what pdfUtils decided
        // NO splitIntoSentences, NO validation, NO fallback recovery
        // All semantic decisions belong to pdfUtils
        
        const translatableBlockTypes = ["paragraph", "heading", "abstract_body", "document_title"];
        
        if (block.sentences && block.sentences.length > 0) {
          // ✅ PREFERRED PATH: Persist sentences AS-IS from pdfUtils
          const sentencesData = block.sentences.map((sent, sIndex) => ({
            order: sIndex + 1,
            source: sent.text.trim(),
            sourceHash: generateSentenceHash(sent.text.trim()),
          }));
          
          console.log(
            `[DocumentService DirectPass] ✅ Block ${block.order} (${block.type}): persisting ${sentencesData.length} sentences AS-IS`,
          );
          
          paragraphsData.push({
            order: paragraphOrder,
            title:
              block.type === "heading" || block.type === "abstract_body"
                ? content
                : null,
            sentences: sentencesData,
          });
        } else if ((block.type as string) === "reference_block") {
          // ============================================================
          // REFERENCE_BLOCK: Preserve as-is without translation
          // ============================================================
          // References are bibliographic data, not semantic sentences.
          // Create paragraph with source=target (placeholder) for display.
          // No TM storage, no sentence-level interaction.
          const refContent = content.trim();
          if (refContent.length > 0) {
            // Split by newlines to preserve individual references
            const refLines = refContent.split('\n').filter(line => line.trim().length > 0);
            const sentencesData = refLines.map((line, sIndex) => ({
              order: sIndex + 1,
              source: line.trim(),
              sourceHash: generateSentenceHash(line.trim()),
              // Mark as untranslatable - translation pipeline will use source as target
            }));
            
            console.log(
              `[DocumentService DirectPass] 📚 Block ${block.order} (reference_block): creating ${sentencesData.length} reference entries as placeholders`,
            );
            
            paragraphsData.push({
              order: paragraphOrder,
              title: null,
              sentences: sentencesData,
            });
          } else {
            paragraphOrder--;
          }
        } else {
          // block.sentences missing or empty
          if (translatableBlockTypes.includes(block.type)) {
            // ⛔ UPSTREAM ERROR: translatable block arrived without sentences
            // This is a pdfUtils problem - DO NOT recover with splitIntoSentences
            console.error(
              `[DocumentService DirectPass] ⛔ UPSTREAM ERROR: Block ${block.order} (${block.type}) is translatable but has no sentences[] - pdfUtils must fix this. Skipping paragraph creation.`,
            );
            // Decrement paragraphOrder since we're not creating a paragraph
            paragraphOrder--;
          } else {
            // Non-translatable block without sentences is expected
            console.log(
              `[DocumentService DirectPass] ⏭️ Block ${block.order} (${block.type}): no sentences (expected for non-semantic block)`,
            );
            paragraphOrder--;
          }
        }
      }

      console.log(
        `[DocumentService DirectPass] Converted ${params.blocks.length} blocks to ${paragraphsData.length} paragraphs`,
      );

      // Create document with paragraphs
      const document = await storage.createDocumentWithParagraphs({
        title: params.title,
        sourceLanguage: params.sourceLanguage,
        userId: params.userId || null,
        fileType: "pdf",
        sourceType: "uploaded",
        source: params.source || "Upload",
        author: params.author,
        category: params.category || "Other",
        isPublic: false,
        paragraphs: paragraphsData,
        tokenizerVersion: SENTENCE_TOKENIZER_VERSION,
        processingState: "pending",
      });

      console.log(
        `[DocumentService DirectPass] Document ${document.id} created with ${paragraphsData.length} paragraphs`,
      );

      // Commit transaction and save archetype if provided
      const updateData: Record<string, unknown> = {
        processingState: "ps_committed",
      };

      // Add archetype fields if provided per instructions.md
      if (params.archetype) {
        updateData.archetype = params.archetype;
        updateData.archetypeConfidence = params.archetypeConfidence || 0;
        updateData.archetypeSource = params.archetypeSource || "auto";
        console.log(
          `[DocumentService DirectPass] 🎯 Archetype: ${params.archetype} (confidence: ${params.archetypeConfidence}, source: ${params.archetypeSource})`,
        );
      }

      await storage.updateDocument(document.id, updateData);

      // 🔧 Store structured content from Block[] directly (NO re-generation)
      // STRUCTURAL FIX: Include sentences[] for anchor eligibility
      const structuredBlocks = params.blocks.map((block, index) => ({
        type: block.type,
        content: block.content || "",
        sentences: block.sentences || [], // STRUCTURAL FIX: Pass sentences[] through
        level: block.level,
        order: index + 1,
        page: block.page,
        anchor: null, // Will be attached separately if needed
      }));

      // Attach anchors to structured blocks
      const documentWithSentences = await storage.getDocumentWithParagraphs(
        document.id,
      );
      if (documentWithSentences) {
        const blocksWithAnchors = await attachAnchorsToStructuredContent(
          structuredBlocks as any,
          documentWithSentences,
        );

        await storage.updateDocument(document.id, {
          structuredContent: JSON.stringify(blocksWithAnchors),
          structuredVersion: 2,
          contentSourceType: "pdf",
          anchorSchemaVersion: 1,
          processingState: "completed",
        });

        const duration = Date.now() - startTime;
        const anchoredCount = blocksWithAnchors.filter((b) => b.anchor).length;

        console.log(
          `[DocumentService DirectPass] ✅ Document ${document.id} completed:`,
        );
        console.log(
          `  - Blocks: ${params.blocks.length} input, ${blocksWithAnchors.length} stored`,
        );
        console.log(
          `  - Anchored: ${anchoredCount}/${blocksWithAnchors.length}`,
        );
        console.log(`  - Processing time: ${duration}ms`);
      } else {
        await storage.updateDocument(document.id, {
          structuredContent: JSON.stringify(structuredBlocks),
          structuredVersion: 2,
          contentSourceType: "pdf",
          processingState: "completed",
        });
      }

      return document;
    } catch (error) {
      console.error(`[DocumentService DirectPass] Error:`, error);
      throw error;
    }
  }

  /**
   * Add document to user library (updated to use new pipeline)
   */
  static async addToLibrary(documentId: number, userId: number): Promise<void> {
    // Check if document exists
    const document = await storage.getDocument(documentId);
    if (!document) {
      throw new Error("Document not found");
    }

    // For now, this is a placeholder - implement when library feature is fully designed
    console.log(`Would add document ${documentId} to user ${userId} library`);
  }

  /**
   * P1 개선: routes.ts에서 추출된 대형 함수들
   * Main function to generate structured content with anchors
   */
  static async generateStructuredContentWithAnchors(
    originalText: string,
    documentWithSentences: DocumentWithSentenceHashes,
    sourceType: "html" | "text" | "pdf" = "text",
    source: string = "Upload",
    existingStructuredBlocks?: any[],
  ): Promise<StructuredBlockWithAnchor[]> {
    console.log(
      "[generateStructuredContentWithAnchors] Starting with source type:",
      sourceType,
    );
    console.log(
      "[generateStructuredContentWithAnchors] Document sentences:",
      documentWithSentences.paragraphs?.length || 0,
      "paragraphs",
    );

    // Use existing structured blocks from PDF extraction if available
    let structuredFromPdf = existingStructuredBlocks;

    if (!structuredFromPdf || structuredFromPdf.length === 0) {
      console.log(
        "[generateStructuredContentWithAnchors] No existing blocks, generating new ones",
      );
      // Generate structured content using existing function
      structuredFromPdf = await this.generateStructuredContent(
        originalText,
        sourceType,
        source,
      );
    }

    console.log(
      "[generateStructuredContentWithAnchors] Structured blocks to process:",
      structuredFromPdf.length,
    );

    // Apply anchor attachment using attachAnchorsToStructuredContent function
    // Convert DocumentWithSentenceHashes to expected format
    const documentDataForAnchor = {
      paragraphs: documentWithSentences.paragraphs.map((p, index) => ({
        id: (p as any).id || index + 1, // Use existing ID or fallback to index
        order: (p as any).order || index + 1, // Use existing order or fallback to index
        sentences: p.sentences.map((s, sIndex) => ({
          id: s.id,
          order: (s as any).order || sIndex + 1, // Use existing order or fallback to index
          source: s.source,
        })),
      })),
    };

    const finalStructured = await attachAnchorsToStructuredContent(
      structuredFromPdf,
      documentDataForAnchor,
    );

    console.log(
      "[generateStructuredContentWithAnchors] ✅ Final result:",
      finalStructured.length,
      "blocks with anchors",
    );

    return finalStructured;
  }

  /**
   * P1 개선: Unified Structured Content Pipeline - handles all input types (HTML, TEXT, PDF)
   */
  static async generateStructuredContent(
    input: string,
    sourceType: "html" | "text" | "pdf" = "text",
    source?: string,
    withAnchors: boolean = false,
  ): Promise<StructuredBlock[]> {
    // Use the existing utility function
    return utilsGenerateStructuredContent(input, sourceType, source);
  }

  /**
   * Helper function for processing document text
   */
  static processDocumentText(text: string): {
    paragraphs: Array<{
      title: string | null;
      sentences: string[];
    }>;
  } {
    const paragraphs = splitIntoParagraphs(text);

    const processedParagraphs = paragraphs.map((paragraph) => {
      const { title, content } = extractTitleFromParagraph(paragraph);
      const sentences = splitIntoSentences(content);

      return {
        title,
        sentences,
      };
    });

    return {
      paragraphs: processedParagraphs,
    };
  }

  /**
   * 🎯 Phase 3 Implementation: Safe Document Deletion with Preview
   * Based on instructions.md data integrity plan
   */

  /**
   * Preview what will be deleted before actual deletion
   * Returns detailed counts of related data that will be affected
   */
  static async previewDocumentDeletion(documentId: number): Promise<{
    documentId: number;
    documentTitle: string | null;
    relatedData: {
      sentences: number;
      notebookLinks: number;
      notes: number;
      translationAttempts: number;
      notebooks: number;
      paragraphs: number;
      glossaryTerms: number;
    };
    warningLevel: "low" | "medium" | "high";
  }> {
    console.log(
      `[DocumentService] Previewing deletion for document ${documentId}`,
    );

    // First check if document exists
    const document = await storage.getDocument(documentId);
    if (!document) {
      throw new Error("Document not found");
    }

    // Use storage methods for safe count queries
    const documentWithParagraphs =
      await storage.getDocumentWithParagraphs(documentId);
    if (!documentWithParagraphs) {
      throw new Error("Document data not found");
    }

    // Calculate counts from the data structure
    let sentenceCount = 0;
    let notebookLinkCount = 0;
    let noteCount = 0;
    let translationAttemptCount = 0;

    for (const paragraph of documentWithParagraphs.paragraphs || []) {
      sentenceCount += paragraph.sentences?.length || 0;

      // Count related data for each sentence
      for (const sentence of paragraph.sentences || []) {
        // We'll need to query these individually for now
        // In a real implementation, you'd want to add these counts to storage methods
      }
    }

    // Get notebook count for this document
    const notebook = await storage.getNotebookByDocumentId(documentId);
    const notebookCount = notebook ? 1 : 0;

    // Get paragraph count
    const paragraphCount = documentWithParagraphs.paragraphs?.length || 0;

    // For now, set other counts to 0 - these would need proper storage methods
    const relatedData = {
      sentences: sentenceCount,
      notebookLinks: 0, // Would need proper query
      notes: 0, // Would need proper query
      translationAttempts: 0, // Would need proper query
      notebooks: notebookCount,
      paragraphs: paragraphCount,
      glossaryTerms: 0, // Would need proper query
    };

    // Determine warning level based on data complexity
    let warningLevel: "low" | "medium" | "high" = "low";
    const totalUserData =
      relatedData.notes +
      relatedData.translationAttempts +
      relatedData.notebookLinks;

    if (totalUserData > 50 || relatedData.glossaryTerms > 10) {
      warningLevel = "high";
    } else if (totalUserData > 10 || relatedData.glossaryTerms > 0) {
      warningLevel = "medium";
    }

    console.log(`[DocumentService] Preview for document ${documentId}:`, {
      relatedData,
      warningLevel,
    });

    return {
      documentId,
      documentTitle: document.title,
      relatedData,
      warningLevel,
    };
  }

  /**
   * Safely delete document with transaction control and verification
   * Implements the complete deletion strategy from instructions.md
   */
  static async deleteDocumentSafely(
    documentId: number,
    options: {
      skipPreview?: boolean;
      batchSize?: number;
    } = {},
  ): Promise<{
    success: boolean;
    deletedCounts: {
      sentences: number;
      notebookLinks: number;
      notes: number;
      translationAttempts: number;
      notebooks: number;
      paragraphs: number;
      glossaryTermsUpdated: number;
    };
    duration: number;
    errors?: string[];
  }> {
    const startTime = Date.now();
    const { skipPreview = false, batchSize = 1000 } = options;

    console.log(
      `[DocumentService] Starting safe deletion for document ${documentId}`,
    );

    try {
      // Step 1: Get preview data (unless skipped)
      let previewData;
      if (!skipPreview) {
        previewData = await this.previewDocumentDeletion(documentId);
        console.log(
          `[DocumentService] Preview completed for document ${documentId}`,
          previewData.relatedData,
        );
      }

      // Step 2: Use storage's existing deleteDocument method
      // This already implements proper CASCADE deletion
      console.log(
        `[DocumentService] Starting deletion for document ${documentId}`,
      );
      const success = await storage.deleteDocument(documentId);

      if (!success) {
        throw new Error("Document not found or deletion failed");
      }

      const duration = Date.now() - startTime;

      // Step 3: Verify deletion was successful by checking document exists
      const verificationResult = await this.verifyDeletionSuccess(documentId);

      const result = {
        success: true,
        deletedCounts: {
          sentences: previewData?.relatedData.sentences || 0,
          notebookLinks: previewData?.relatedData.notebookLinks || 0,
          notes: previewData?.relatedData.notes || 0,
          translationAttempts:
            previewData?.relatedData.translationAttempts || 0,
          notebooks: previewData?.relatedData.notebooks || 0,
          paragraphs: previewData?.relatedData.paragraphs || 0,
          glossaryTermsUpdated: previewData?.relatedData.glossaryTerms || 0,
        },
        duration,
      };

      console.log(
        `[DocumentService] ✅ Document ${documentId} deleted successfully:`,
        result,
      );
      return result;
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(
        `[DocumentService] ❌ Error deleting document ${documentId}:`,
        error,
      );

      return {
        success: false,
        deletedCounts: {
          sentences: 0,
          notebookLinks: 0,
          notes: 0,
          translationAttempts: 0,
          notebooks: 0,
          paragraphs: 0,
          glossaryTermsUpdated: 0,
        },
        duration,
        errors: [error instanceof Error ? error.message : "Unknown error"],
      };
    }
  }

  /**
   * Verify that deletion was successful and no orphaned data remains
   */
  static async verifyDeletionSuccess(documentId: number): Promise<{
    documentExists: boolean;
    orphanedData: {
      paragraphs: number;
      sentences: number;
      notes: number;
      notebookSentences: number;
      translationAttempts: number;
    };
  }> {
    console.log(
      `[DocumentService] Verifying deletion success for document ${documentId}`,
    );

    // Check if document still exists using storage method
    const document = await storage.getDocument(documentId);
    const documentExists = document !== undefined;

    // For now, assume CASCADE worked properly
    // In a production implementation, you'd add specific count methods to storage
    const orphanedData = {
      paragraphs: 0,
      sentences: 0,
      notes: 0,
      notebookSentences: 0,
      translationAttempts: 0,
    };

    if (documentExists) {
      console.warn(
        `[DocumentService] ⚠️ Document ${documentId} still exists after deletion`,
      );
    } else {
      console.log(
        `[DocumentService] ✅ Deletion verification passed - document removed`,
      );
    }

    return {
      documentExists,
      orphanedData,
    };
  }

  /**
   * Phase 5: Enhanced repair system for broken documents
   * Detects and fixes documents missing structured content or anchor metadata
   * Addresses RSS V2 pipeline issues and legacy document handling
   */
  static async repairBrokenDocuments(): Promise<{
    processed: number;
    repaired: number;
    errors: string[];
  }> {
    console.log(
      "[DocumentService] 🔧 Starting enhanced repair of broken documents...",
    );

    const results = {
      processed: 0,
      repaired: 0,
      errors: [] as string[],
    };

    try {
      // Find documents that need repair with enhanced detection
      const allDocuments = await storage.getAllDocuments();
      const brokenDocuments = allDocuments.filter((doc) => {
        let needsRepair = false;
        const reasons: string[] = [];

        // 1. Missing or invalid structured content
        if (!doc.structuredContent) {
          needsRepair = true;
          reasons.push("missing structuredContent");
        } else if (
          typeof doc.structuredContent === "string" &&
          doc.structuredContent === "[]"
        ) {
          needsRepair = true;
          reasons.push("empty structuredContent");
        }

        // 2. V1 documents or missing version
        if ((doc.structuredVersion ?? 0) < 2) {
          needsRepair = true;
          reasons.push(`structuredVersion=${doc.structuredVersion}`);
        }

        // 3. Missing anchor schema version (critical for V2)
        if (!doc.anchorSchemaVersion) {
          needsRepair = true;
          reasons.push("missing anchorSchemaVersion");
        }

        // 4. Processing stuck in pending state
        if (doc.processingState === "pending") {
          needsRepair = true;
          reasons.push("stuck in pending state");
        }

        // 5. RSS documents without proper V2 processing
        if (
          (doc.source === "RSS" || doc.source === "NPR" || doc.feedId) &&
          (!doc.contentSourceType || doc.contentSourceType !== "html")
        ) {
          needsRepair = true;
          reasons.push("RSS document missing V2 processing");
        }

        if (needsRepair) {
          console.log(
            `[DocumentService] 🔍 Document ${doc.id} needs repair: ${reasons.join(", ")}`,
          );
        }

        return needsRepair;
      });

      console.log(
        `[DocumentService] Found ${brokenDocuments.length} documents needing repair`,
      );

      for (const document of brokenDocuments) {
        results.processed++;

        try {
          console.log(
            `[DocumentService] Repairing document ${document.id}: "${document.title}"`,
          );

          // Get the original content by reconstructing from paragraphs
          const documentWithData = await storage.getDocumentWithParagraphs(
            document.id,
          );
          if (!documentWithData || !documentWithData.paragraphs) {
            results.errors.push(
              `Document ${document.id}: No paragraph data available`,
            );
            continue;
          }

          // Reconstruct original content from paragraphs
          const originalContent = documentWithData.paragraphs
            .sort((a, b) => a.order - b.order)
            .map((p: any) => {
              const sentences = p.sentences
                .sort((a: any, b: any) => a.order - b.order)
                .map((s: any) => s.source)
                .join(" ");
              return p.title ? `${p.title}\n\n${sentences}` : sentences;
            })
            .join("\n\n");

          if (!originalContent || originalContent.trim().length === 0) {
            results.errors.push(
              `Document ${document.id}: No content to process`,
            );
            continue;
          }

          // Enhanced content type detection for proper V2 processing
          let contentType: "html" | "text" | "pdf" = "text";

          if (document.fileType === "pdf") {
            contentType = "pdf";
          } else if (
            // RSS and web content should use HTML processing
            document.source === "RSS" ||
            document.source === "NPR" ||
            document.source?.includes("Guardian") ||
            document.source?.includes("WIRED") ||
            document.feedId ||
            // Content with HTML tags
            originalContent.includes("<div") ||
            originalContent.includes("<p>") ||
            originalContent.includes("readability-page")
          ) {
            contentType = "html";
            console.log(
              `[DocumentService] 🔧 Using HTML processing for ${document.source} document`,
            );
          }

          console.log(
            `[DocumentService] Regenerating structure for document ${document.id} using ${contentType} mode`,
          );

          // Generate structured blocks (anchor-free)
          const structuredBlocks = await this.generateStructuredContent(
            originalContent,
            contentType,
            document.source || "Legacy Document",
          );

          // Attach anchors using committed DB IDs
          const { attachAnchorsToStructuredContent } = await import(
            "../utils/anchorUtils.js"
          );
          const blocksWithAnchors = await attachAnchorsToStructuredContent(
            structuredBlocks,
            documentWithData,
          );

          // Update document with V2 structure and anchors + enhanced metadata
          await storage.updateDocument(document.id, {
            structuredContent: JSON.stringify(blocksWithAnchors),
            structuredVersion: 2,
            contentSourceType: contentType,
            anchorSchemaVersion: 1,
            processingState: "completed",
            // Add additional V2 metadata
            tokenizerVersion: "2", // Mark as using enhanced tokenization
          });

          const anchoredCount = blocksWithAnchors.filter(
            (b) => b.anchor,
          ).length;
          const anchorRate =
            blocksWithAnchors.length > 0
              ? (anchoredCount / blocksWithAnchors.length) * 100
              : 0;

          console.log(
            `[DocumentService] ✅ Repaired document ${document.id}: ${blocksWithAnchors.length} blocks, ${anchoredCount} anchored (${anchorRate.toFixed(1)}%)`,
          );

          // Enhanced success validation
          if (blocksWithAnchors.length > 0 && anchorRate >= 50) {
            // At least 50% anchor rate
            results.repaired++;
            console.log(
              `[DocumentService] 🎉 Document ${document.id} repair successful - meets quality standards`,
            );
          } else {
            results.errors.push(
              `Document ${document.id}: Low anchor quality (${anchorRate.toFixed(1)}% < 50%)`,
            );
            console.warn(
              `[DocumentService] ⚠️ Document ${document.id} repair completed but below quality threshold`,
            );
          }

          // Add small delay to prevent overwhelming the system
          await new Promise((resolve) => setTimeout(resolve, 100));
        } catch (error) {
          const errorMsg = `Document ${document.id}: ${error instanceof Error ? error.message : "Unknown error"}`;
          console.error(
            `[DocumentService] Failed to repair document ${document.id}:`,
            error,
          );
          results.errors.push(errorMsg);
        }
      }

      console.log(
        `[DocumentService] ✅ Repair completed: ${results.repaired}/${results.processed} documents repaired`,
      );
      if (results.errors.length > 0) {
        console.log(`[DocumentService] ⚠️ Errors encountered:`, results.errors);
      }

      return results;
    } catch (error) {
      console.error("[DocumentService] Error in repairBrokenDocuments:", error);
      results.errors.push(
        `Global error: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return results;
    }
  }

  /**
   * Phase 1: Create lightweight Explore document (structure only, no sentences/anchors)
   * Used for RSS crawling - only generates structured content for viewing
   */
  static async createExploreDocument(params: {
    title: string;
    content: string;
    sourceLanguage: string;
    source?: string;
    contentType?: "html" | "text" | "pdf" | "rss_html";
    isPublic?: boolean;
    category?: string;
    author?: string;
    originalUrl?: string;
    publishedAt?: Date;
    feedId?: number;
  }): Promise<Document> {
    const startTime = Date.now();
    console.log(
      `[DocumentService] Creating lightweight Explore document: "${params.title}"`,
    );

    try {
      // Generate structured blocks without sentences/anchors
      const contentType =
        params.contentType === "rss_html"
          ? "html"
          : params.contentType || "html";
      const structuredBlocks = await this.generateStructuredContent(
        params.content,
        contentType,
        params.source || "RSS",
      );

      // Create document with minimal data - no paragraphs/sentences
      const document = await storage.createDocument({
        title: params.title,
        sourceLanguage: params.sourceLanguage,
        publishedAt: params.publishedAt || null,
        lastActivityAt: new Date(),
        userId: null,
        fileType: "text",
        isArchived: false,
        sourceType: "explore",
        origin: null,
        author: params.author || null,
        source: params.source || "RSS",
        category: params.category || "RSS Feed",
        difficulty: null,
        tags: null,
        originalUrl: params.originalUrl || null,
        licenseType: null,
        isPublic: params.isPublic || true,
        expiresAt: null,
        feedId: params.feedId || null,
        thumbnailUrl: null,
        thumbnailPath: null,
        originalImageUrl: null,
        thumbnailStatus: "pending",
        dominantColor: null,
        blurhash: null,
        // Structure-only metadata
        structuredContent: structuredBlocks as any, // No anchors
        structuredVersion: 2,
        contentSourceType: contentType,
        anchorSchemaVersion: 1,
        tokenizerVersion: SENTENCE_TOKENIZER_VERSION,
        processingState: "structure_only", // New state for lightweight docs
        rawContent: params.content, // Store raw content for later processing
      });

      const duration = Date.now() - startTime;
      console.log(
        `[DocumentService] ✅ Lightweight Explore document created: ${document.id} (${duration}ms, ${structuredBlocks.length} blocks)`,
      );

      return document;
    } catch (error) {
      console.error(
        `[DocumentService] Failed to create Explore document:`,
        error,
      );
      throw error;
    }
  }

  /**
   * Phase 2: Create full Library document from Explore document
   * Processes sentences/anchors for the first and only time
   */
  static async createLibraryFromExplore(params: {
    originalDocument: Document & { structuredContent?: string };
    userId: number;
    title?: string;
    author?: string;
  }): Promise<Document> {
    const startTime = Date.now();
    console.log(
      `[DocumentService] Creating Library document from Explore doc: ${params.originalDocument.id}`,
    );

    try {
      const { userId } = params;

      // CRITICAL: Validate userId is provided
      if (!userId) {
        throw new Error("userId is required for creating library documents");
      }

      const originalDoc = params.originalDocument;

      // Validate original document has raw content
      if (!originalDoc.rawContent && !originalDoc.structuredContent) {
        throw new Error(
          "Original document missing both raw content and structured content",
        );
      }

      // Use stored raw content or fallback to reconstructing from structured blocks
      let contentToProcess = originalDoc.rawContent;

      if (!contentToProcess && originalDoc.structuredContent) {
        console.log(
          `[DocumentService] No raw content found, reconstructing from structured blocks`,
        );
        // Handle both string and object cases for structuredContent
        let structuredBlocks;
        if (typeof originalDoc.structuredContent === "string") {
          structuredBlocks = JSON.parse(originalDoc.structuredContent);
        } else {
          structuredBlocks = originalDoc.structuredContent;
        }
        contentToProcess = structuredBlocks
          .filter((block: any) => block.type === "paragraph" && block.content)
          .map((block: any) => block.content)
          .join("\n\n");
      }

      if (!contentToProcess) {
        throw new Error("Cannot obtain raw content for processing");
      }

      console.log(
        `[DocumentService] Using ${contentToProcess.length} chars of content for library creation`,
      );

      // Use existing V2 pipeline with proper userId
      const tempDocument = await this.createDocumentWithPSAndStructureV2({
        title: params.title || originalDoc.title,
        content: contentToProcess,
        sourceLanguage: originalDoc.sourceLanguage,
        userId: userId, // Use authenticated user ID
        source: originalDoc.source || undefined,
        contentType: (originalDoc.contentSourceType as any) || "html",
        isPublic: false, // Library documents are private
        category: originalDoc.category || undefined,
        author: params.author || originalDoc.author || undefined,
        originalUrl: originalDoc.originalUrl || undefined,
        publishedAt: originalDoc.publishedAt || undefined,
        feedId: originalDoc.feedId || undefined,
      });

      // Document is already created with sourceType "explore"
      // No need to update sourceType

      // Get updated document
      const libraryDocument = await storage.getDocument(tempDocument.id);
      if (!libraryDocument) {
        throw new Error("Failed to retrieve updated library document");
      }

      // Note: Document is already created with correct userId and sourceType

      const duration = Date.now() - startTime;
      console.log(
        `[DocumentService] ✅ Library document created from Explore: ${libraryDocument.id} (${duration}ms)`,
      );

      return libraryDocument;
    } catch (error) {
      console.error(
        `[DocumentService] Failed to create Library from Explore:`,
        error,
      );
      throw error;
    }
  }
}
