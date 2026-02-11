import { Router } from "express";
import { storage } from "../storage.js";
import { authenticateJWT, type AuthenticatedRequest } from "../auth.js";
import { z } from "zod";
import type { Response } from "express";

const router = Router();

// Get user sentence state (bookmark, learning status)
router.get("/user-sentence-state/:sentenceId", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const sentenceId = parseInt(req.params.sentenceId);

    if (!sentenceId || isNaN(sentenceId)) {
      return res.status(400).json({ error: "Valid sentence ID is required" });
    }

    const state = await storage.getUserSentenceState(userId!, sentenceId);
    res.json(state || { 
      userId: userId!,
      sentenceId,
      isBookmarked: false,
      learningStatus: 'new'
    });
  } catch (error) {
    console.error("Error fetching user sentence state:", error);
    res.status(500).json({ error: "Failed to fetch user sentence state" });
  }
});

// Upsert user sentence state (bookmark, learning status)
router.post("/user-sentence-state", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { sentenceId, isBookmarked, learningStatus } = req.body;

    console.log("[USER_SENTENCE_STATE] Upsert request:", {
      userId,
      sentenceId,
      isBookmarked,
      learningStatus,
    });

    if (!sentenceId) {
      return res.status(400).json({ error: "sentenceId is required" });
    }

    const state = await storage.upsertUserSentenceState({
      userId: userId!,
      sentenceId,
      isBookmarked: isBookmarked !== undefined ? isBookmarked : false,
      learningStatus: learningStatus || 'new',
      lastPracticedAt: learningStatus === 'learning' || learningStatus === 'review' ? new Date() : null,
    });

    console.log("User sentence state updated successfully:", state);
    res.status(200).json({
      ...state,
      message: '상태가 성공적으로 업데이트되었습니다',
      success: true
    });
  } catch (error) {
    console.error("Error updating user sentence state:", error);
    res.status(500).json({ error: "Failed to update user sentence state" });
  }
});

// Get user's bookmarked sentences
router.get("/bookmarked-sentences", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { status, limit } = req.query;

    const filters: any = { bookmarked: true };
    if (status) filters.status = status as string;
    if (limit) filters.limit = parseInt(limit as string);

    const sentences = await storage.getUserBookmarkedSentences(userId!, filters);
    res.json(sentences);
  } catch (error) {
    console.error("Error fetching bookmarked sentences:", error);
    res.status(500).json({ error: "Failed to fetch bookmarked sentences" });
  }
});

export default router;