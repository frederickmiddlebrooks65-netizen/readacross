import { Router, Response } from "express";
import { authenticateJWT, AuthenticatedRequest } from "../auth.js";
import { z } from "zod";
import { GeminiService } from "../services/GeminiService.js";
import { TokenTrackingService } from "../services/TokenTrackingService.js";
import { storage } from "../storage.js";

const router = Router();

const ocrRequestSchema = z.object({
  images: z.array(z.string()).min(1).max(2),
});

router.post("/extract", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const user = await storage.getUser(userId);
    const userPlan = (user?.plan || "starter") as "starter" | "pro" | "admin";

    const tokenCheck = await TokenTrackingService.checkTokenLimit(userId, userPlan);
    if (!tokenCheck.canProceed) {
      return res.status(403).json({
        error: "Token limit exceeded",
        errorCode: tokenCheck.errorCode,
        message: tokenCheck.message,
      });
    }

    const ocrCheck = await TokenTrackingService.checkOcrLimit(userId, userPlan);
    if (!ocrCheck.canProceed) {
      return res.status(403).json({
        error: "OCR limit reached",
        errorCode: ocrCheck.errorCode,
        message: ocrCheck.message,
      });
    }

    const validatedData = ocrRequestSchema.parse(req.body);
    const { images } = validatedData;

    console.log(`[OCR] Processing ${images.length} image(s) for user ${userId}`);

    const extractedTexts: string[] = [];

    for (const imageBase64 of images) {
      const extractedText = await GeminiService.processImageOCR(imageBase64, userId);
      extractedTexts.push(extractedText);
      console.log(`[OCR] Extracted ${extractedText.length} characters from image`);
    }

    const combinedText = extractedTexts.join("\n\n---\n\n");

    await TokenTrackingService.incrementOcrCount(userId);

    res.json({
      success: true,
      text: combinedText,
      imageCount: images.length,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Invalid request",
        details: error.errors,
      });
    }

    console.error("[OCR Error]", error);
    res.status(500).json({ error: "Failed to process OCR request" });
  }
});

export default router;
