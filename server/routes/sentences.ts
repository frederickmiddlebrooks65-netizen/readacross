import { Router } from "express";
import { storage } from "../storage.js";
import { z } from "zod";
import { updateSentenceSchema, sentences, paragraphs, documents } from "@shared/schema";
import { SentenceService } from "../services/SentenceService.js";
import { authenticateJWT, AuthenticatedRequest } from "../auth.js";
import { Response } from "express";
import { db } from "../db.js";
import { eq, and, sql } from "drizzle-orm";
import { GeminiService } from "../services/GeminiService.js";

const router = Router();

// Set explicit bookmark status (true/false)
router.put("/:id/bookmark", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const sentenceId = parseInt(req.params.id);
    const { isBookmarked } = req.body;

    if (isNaN(sentenceId)) {
      return res.status(400).json({ error: "Invalid sentence ID" });
    }

    // Get current state to preserve other fields
    const currentState = await storage.getUserSentenceState(userId, sentenceId);
    
    // Explicitly set bookmark status (no toggle)
    const result = await storage.upsertUserSentenceState({
      userId,
      sentenceId,
      isBookmarked: isBookmarked,
      learningStatus: currentState?.learningStatus || 'new',
      lastPracticedAt: currentState?.lastPracticedAt || null,
    });

    res.json({ 
      success: true,
      sentenceId,
      isBookmarked: result.isBookmarked,
      message: isBookmarked ? "문장이 저장되었습니다" : "문장 저장이 해제되었습니다" 
    });
  } catch (error) {
    console.error("Error updating sentence bookmark:", error);
    res.status(500).json({ error: "Failed to update bookmark" });
  }
});

// Update a sentence (note, scrapped status)
router.patch("/:id", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log('[PATCH SENTENCE] Request received:', {
      sentenceId: req.params.id,
      userId: req.userId,
      body: req.body,
      headers: { authorization: req.headers.authorization ? 'Bearer ***' : 'none' }
    });

    const id = parseInt(req.params.id);
    const userId = req.userId!;

    // Handle bookmark toggle directly with new schema
    if (req.body.isScrapped !== undefined) {
      const result = await storage.upsertUserSentenceState({
        userId,
        sentenceId: id,
        isBookmarked: req.body.isScrapped,
        learningStatus: 'new',
        lastPracticedAt: null,
      });
      
      const message = result.isBookmarked ? '문장을 북마크에 추가했습니다' : '문장을 북마크에서 제거했습니다';
      return res.json({ 
        success: true,
        isBookmarked: result.isBookmarked,
        sentenceId: id,
        message
      });
    }

    // For other updates, use the service
    const validatedData = updateSentenceSchema.parse(req.body);
    const updatedSentence = await SentenceService.updateSentenceWithNotebook(
      id,
      { ...validatedData, userId: userId }
    );

    res.json(updatedSentence);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorDetails = error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
        code: err.code
      }));
      console.error("Zod validation error:", {
        request: req.body,
        errors: errorDetails
      });
      return res
        .status(400)
        .json({
          message: "Validation failed",
          errors: errorDetails,
          details: `Field '${errorDetails[0]?.field}': ${errorDetails[0]?.message}`
        });
    }
    console.error("Error updating sentence:", error);
    res.status(500).json({ message: "Failed to update sentence" });
  }
});

// Get user's saved sentences with enhanced filtering and sorting
router.get("/my", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    console.log('[MY SENTENCES] Request received for user:', userId);

    const { document: documentId, status, search, sortBy } = req.query;

    const filters = {
      userId,
      documentId: documentId ? parseInt(documentId as string) : undefined,
      status: status as string,
      search: search as string,
      sortBy: (sortBy as string) || 'recent'
    };

    console.log('[MY SENTENCES] Filtering with:', filters);

    // Get user sentences with proper user filtering
    const sentences = await storage.getUserSentences(filters);
    console.log(`[MY SENTENCES] Found ${sentences.length} sentences for user ${userId}`);

    // Debug: Total count for user
    console.log(`[MY SENTENCES DEBUG] Total sentences returned for user ${userId}:`, sentences.length);

    // Disable caching to ensure fresh data
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.json(sentences);
  } catch (error) {
    console.error("Error fetching saved sentences:", error);
    res.status(500).json({ error: "Failed to fetch saved sentences" });
  }
});

// Toggle bookmark status for a sentence (for UI interactions)
router.patch("/:id/bookmark", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sentenceId = parseInt(req.params.id);
    const userId = req.userId!;
    
    // Get current state
    const currentState = await storage.getUserSentenceState(userId, sentenceId);
    const newBookmarkStatus = !currentState?.isBookmarked;
    
    // Upsert the user sentence state
    const result = await storage.upsertUserSentenceState({
      userId,
      sentenceId,
      isBookmarked: newBookmarkStatus,
      learningStatus: currentState?.learningStatus || 'new',
      lastPracticedAt: currentState?.lastPracticedAt || null,
    });
    
    const message = result.isBookmarked ? '문장을 북마크에 추가했습니다' : '문장을 북마크에서 제거했습니다';
    res.json({ 
      sentenceId, 
      isBookmarked: result.isBookmarked,
      success: true,
      message
    });
  } catch (error) {
    console.error("Error toggling bookmark:", error);
    res.status(500).json({ error: "Failed to toggle bookmark" });
  }
});

// Legacy endpoint for backward compatibility
router.patch("/:id/favorite", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sentenceId = parseInt(req.params.id);
    const userId = req.userId!;
    
    // Get current state
    const currentState = await storage.getUserSentenceState(userId, sentenceId);
    const newBookmarkStatus = !currentState?.isBookmarked;
    
    // Upsert the user sentence state
    const result = await storage.upsertUserSentenceState({
      userId,
      sentenceId,
      isBookmarked: newBookmarkStatus,
      learningStatus: currentState?.learningStatus || 'new',
      lastPracticedAt: currentState?.lastPracticedAt || null,
    });
    
    const message = result.isBookmarked ? '문장을 즐겨찾기에 추가했습니다' : '문장을 즐겨찾기에서 제거했습니다';
    res.json({ 
      sentenceId, 
      isFavorite: result.isBookmarked, // Legacy field name
      success: true,
      message
    });
  } catch (error) {
    console.error("Error toggling favorite:", error);
    res.status(500).json({ error: "Failed to toggle favorite" });
  }
});

// Bulk delete sentences
router.post("/bulk-delete", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sentenceIds } = req.body;
    const userId = req.userId!;

    console.log('[BULK DELETE] Request:', { userId, sentenceIds });

    if (!Array.isArray(sentenceIds) || sentenceIds.length === 0) {
      console.log('[BULK DELETE] Invalid sentence IDs');
      return res.status(400).json({ error: "Invalid sentence IDs provided" });
    }

    // Verify sentences belong to user before deleting - check ownership directly
    const validIds = await storage.validateSentenceOwnership(sentenceIds, userId);

    console.log('[BULK DELETE] Valid IDs to delete:', validIds);

    if (validIds.length === 0) {
      return res.status(400).json({ error: "No valid sentences to delete" });
    }

    console.log('[BULK DELETE] Calling storage.bulkDeleteSentences with IDs:', validIds);
    const success = await storage.bulkDeleteSentences(validIds);

    if (success) {
      console.log('[BULK DELETE] Success - deleted:', validIds.length, 'sentences');
      res.json({
        success: true,
        message: `Successfully deleted ${validIds.length} sentences`,
        deletedCount: validIds.length,
      });
    } else {
      console.error('[BULK DELETE] Failed to delete sentences - storage returned false');
      res.status(500).json({ error: "Failed to delete sentences" });
    }
  } catch (error) {
    console.error("Error bulk deleting sentences:", error);
    res.status(500).json({ error: "Failed to delete sentences" });
  }
});

// Practice a sentence (save user translation and feedback)
router.post("/:id/practice", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sentenceId = parseInt(req.params.id);
    const { userTranslation, feedback } = req.body;

    const updatedSentence = await SentenceService.processPracticeSession(
      sentenceId,
      userTranslation,
      feedback,
    );
    res.json(updatedSentence);
  } catch (error) {
    console.error("Error saving practice session:", error);
    res.status(500).json({ error: "Failed to save practice session" });
  }
});

// AI Precision Coaching endpoint
router.post("/:id/coach", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sentenceId = parseInt(req.params.id);
    const userId = req.userId!;

    if (isNaN(sentenceId)) {
      return res.status(400).json({ error: "Invalid sentence ID" });
    }

    // Get the sentence
    const sentence = await storage.getSentence(sentenceId);
    if (!sentence) {
      return res.status(404).json({ error: "Sentence not found" });
    }

    // Check user tier for premium feature (optional - can be removed if free for all)
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    const prompt = `You are a Korean language learning coach. Analyze the following sentence and provide helpful coaching for a language learner.

Original (Korean): ${sentence.source}
User's Translation (English): ${sentence.target || "Not yet translated"}

Please provide:
1. A polished, natural English translation of the Korean sentence
2. Key grammar insights that would help a learner understand the sentence structure
3. Nuance tips about cultural context, formality levels, or common usage patterns

Respond in JSON format:
{
  "polishedTranslation": "...",
  "grammarInsight": "...",
  "nuanceTips": "..."
}`;

    const content = await GeminiService.generateText(
      prompt,
      "You are a helpful Korean language tutor. Respond only in valid JSON format.",
      { maxTokens: 1000, plan: "starter", jsonMode: true }
    );

    if (!content) {
      return res.status(500).json({ error: "Failed to generate coaching" });
    }

    const coaching = JSON.parse(content);
    
    res.json({
      polishedTranslation: coaching.polishedTranslation || "",
      grammarInsight: coaching.grammarInsight || "",
      nuanceTips: coaching.nuanceTips || "",
      cached: false
    });
  } catch (error) {
    console.error("Error generating AI coaching:", error);
    res.status(500).json({ error: "Failed to generate AI coaching" });
  }
});

// Update edited translation for a sentence
router.patch("/:id/translation", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const sentenceId = parseInt(req.params.id);
    const { targetEdited } = req.body;

    if (isNaN(sentenceId)) {
      return res.status(400).json({ error: "Invalid sentence ID" });
    }

    if (typeof targetEdited !== 'string') {
      return res.status(400).json({ error: "targetEdited must be a string" });
    }

    // Update only the targetEdited field
    const updatedSentence = await storage.updateSentence(sentenceId, { targetEdited });

    if (!updatedSentence) {
      return res.status(404).json({ error: "Sentence not found" });
    }

    res.json({
      success: true,
      sentence: updatedSentence,
      isEdited: updatedSentence.targetAi !== updatedSentence.targetEdited,
    });
  } catch (error) {
    console.error("Error updating sentence translation:", error);
    res.status(500).json({ error: "Failed to update sentence translation" });
  }
});

// Get document info for a sentence
router.get("/:id/document", async (req, res) => {
  try {
    const sentenceId = parseInt(req.params.id);

    const sentence = await storage.getSentence(sentenceId);
    if (!sentence) {
      return res.status(404).json({ error: "Sentence not found" });
    }

    const paragraph = await storage.getParagraph(sentence.paragraphId);
    if (!paragraph) {
      return res.status(404).json({ error: "Paragraph not found" });
    }

    const document = await storage.getDocument(paragraph.documentId);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    res.json(document);
  } catch (error) {
    console.error("Error fetching document for sentence:", error);
    res.status(500).json({ error: "Failed to fetch document" });
  }
});

export default router;
