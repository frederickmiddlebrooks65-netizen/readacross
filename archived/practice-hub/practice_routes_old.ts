import { Router, type Request, type Response } from "express";
import { storage } from "../storage.js";
import { sql } from "drizzle-orm";
import { z } from "zod";
import OpenAI from "openai";
import * as crypto from "crypto";
import { authenticateJWT, type AuthenticatedRequest } from "../auth.js";
import { TranslationService, type UserPlan } from "../services/TranslationService.js";

const router = Router();

// Initialize OpenAI (kept for non-translation API calls)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "your-api-key",
});

// Model configuration - can be changed via environment variable
// Recommended: gpt-4o-mini for better instruction following with reasonable cost
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

// Helper to get user plan from request
async function getUserPlan(userId?: number): Promise<UserPlan> {
  if (!userId) return "free";
  const user = await storage.getUser(userId);
  return (user?.plan as UserPlan) || "free";
}

// Get user AI tier info (requires authentication)
router.get("/ai-tier", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const userPlan = await getUserPlan(userId);
    const modelTier = TranslationService.getModelTier(userPlan);
    const model = TranslationService.getModelForPlan(userPlan);
    
    res.json({
      plan: userPlan,
      modelTier,
      model,
      description: modelTier === "Premium" 
        ? "Using GPT-4o for highest quality translations"
        : "Using GPT-4o-mini for efficient translations"
    });
  } catch (error) {
    console.error("Error fetching AI tier:", error);
    res.status(500).json({ error: "Failed to fetch AI tier info" });
  }
});

// Basic translation endpoint (requires authentication)
router.post("/translate", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { text, sourceLanguage, targetLanguage } = req.body;
    const userId = req.userId;

    if (!text || !sourceLanguage || !targetLanguage) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const userPlan = await getUserPlan(userId);
    const user = userId ? await storage.getUser(userId) : null;
    
    const result = await TranslationService.translateText(text, {
      userEmail: user?.email || undefined,
      userPlan,
      sourceLanguage,
      targetLanguage,
    });
    
    res.json({ 
      translation: result.translation,
      modelTier: result.modelTier,
      modelUsed: result.modelUsed
    });
  } catch (error) {
    console.error("Translation error:", error);
    res.status(500).json({ error: "Translation failed" });
  }
});

// Batch translate sentences (requires authentication)
router.post("/translate/batch", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { texts, sourceLanguage, targetLanguage } = req.body;
    const userId = req.userId;

    if (!texts || !Array.isArray(texts) || texts.length === 0) {
      return res.status(400).json({ error: "No texts provided for translation" });
    }

    const userPlan = await getUserPlan(userId);
    const user = userId ? await storage.getUser(userId) : null;
    
    const results = await TranslationService.batchTranslate(texts, {
      userEmail: user?.email || undefined,
      userPlan,
      sourceLanguage,
      targetLanguage,
    });

    res.json({ 
      translations: results.map(r => r.translation),
      modelTier: results[0]?.modelTier || "Basic"
    });
  } catch (error) {
    console.error("Batch translation error:", error);
    res.status(500).json({ error: "Batch translation failed" });
  }
});

// Single sentence translation (requires authentication)
router.post("/sentences/:id/translate", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const sentenceId = parseInt(req.params.id);
  const userId = req.userId;

  try {
    const sentence = await storage.getSentence(sentenceId);
    if (!sentence) {
      return res.status(404).json({ error: "Sentence not found" });
    }

    // Get document to determine languages
    const document = await storage.getDocument(sentence.documentId);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    const sourceLanguage = document.sourceLanguage;
    const targetLanguage = document.targetLanguage;

    // Check if already translated
    if (sentence.target && sentence.target.trim() !== "") {
      return res.json({
        translation: sentence.target,
        cached: true,
      });
    }

    const userPlan = await getUserPlan(userId);
    const user = userId ? await storage.getUser(userId) : null;
    
    const result = await TranslationService.translateText(sentence.source, {
      userEmail: user?.email || undefined,
      userPlan,
      sourceLanguage,
      targetLanguage,
    });

    // Update the sentence with the translation
    await storage.updateSentence(sentenceId, { target: result.translation });

    res.json({ 
      translation: result.translation, 
      cached: false,
      modelTier: result.modelTier
    });
  } catch (error) {
    console.error("Error translating sentence:", error);
    res.status(500).json({ message: "Failed to translate sentence" });
  }
});

// AI Coaching for sentence (Pro/Admin feature only)
router.post("/sentences/:id/coach", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const sentenceId = parseInt(req.params.id);
  const userId = req.userId;

  try {
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Get user plan and check if Pro/Admin
    const userPlan = await getUserPlan(userId);
    if (userPlan === "free") {
      return res.status(403).json({ 
        error: "Pro feature", 
        message: "AI Precision Coaching is a Pro feature. Upgrade to Pro to unlock detailed grammar and nuance insights."
      });
    }

    // Get the sentence
    const sentence = await storage.getSentence(sentenceId);
    if (!sentence) {
      return res.status(404).json({ error: "Sentence not found" });
    }

    // Get document for language context
    const document = await storage.getDocument(sentence.documentId);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Check if we have cached coaching for this sentence-user pair
    const sentenceState = await storage.getUserSentenceState(userId, sentenceId);
    if (sentenceState?.aiCoachingCache) {
      try {
        const cached = JSON.parse(sentenceState.aiCoachingCache);
        console.log(`[AI Coaching] Returning cached coaching for sentence ${sentenceId}`);
        return res.json({
          ...cached,
          cached: true,
          cachedAt: sentenceState.aiCoachingCachedAt
        });
      } catch (e) {
        console.log(`[AI Coaching] Failed to parse cached coaching, regenerating`);
      }
    }

    // Generate AI coaching using gpt-4o for Pro/Admin users
    const sourceLanguage = document.sourceLanguage || "en";
    const targetLanguage = document.targetLanguage || "ko";
    
    console.log(`[AI Coaching] Generating coaching for sentence ${sentenceId} (${sourceLanguage} -> ${targetLanguage})`);
    
    const systemPrompt = targetLanguage === "ko" 
      ? `You are an expert language coach helping Korean learners understand English text. 
Provide coaching in Korean (학술적 하다체 문체) for the following English sentence.
Your response must be a valid JSON object with these exact fields:
- polishedTranslation: A polished, natural Korean translation
- grammarInsight: Key grammar points and structures (2-3 sentences)
- nuanceTips: Cultural/contextual nuances and tips for understanding (2-3 sentences)`
      : `You are an expert language coach helping learners understand ${sourceLanguage} text.
Provide coaching in ${targetLanguage} for the following sentence.
Your response must be a valid JSON object with these exact fields:
- polishedTranslation: A polished, natural translation
- grammarInsight: Key grammar points and structures (2-3 sentences)
- nuanceTips: Cultural/contextual nuances and tips for understanding (2-3 sentences)`;

    const userPrompt = `Original sentence: "${sentence.source}"
${sentence.target ? `Current translation: "${sentence.target}"` : ""}

Provide detailed coaching for this sentence. Return only a valid JSON object.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o", // Always use gpt-4o for Pro features
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.3,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0]?.message?.content || "{}";
    let coaching;
    
    try {
      coaching = JSON.parse(responseText);
    } catch (e) {
      console.error("[AI Coaching] Failed to parse OpenAI response:", responseText);
      return res.status(500).json({ error: "Failed to parse AI coaching response" });
    }

    const result = {
      polishedTranslation: coaching.polishedTranslation || sentence.target || "",
      grammarInsight: coaching.grammarInsight || "No grammar insights available.",
      nuanceTips: coaching.nuanceTips || "No nuance tips available."
    };

    // Cache the coaching result
    await storage.updateUserSentenceState(userId, sentenceId, {
      aiCoachingCache: JSON.stringify(result),
      aiCoachingCachedAt: new Date()
    });

    console.log(`[AI Coaching] Successfully generated and cached coaching for sentence ${sentenceId}`);
    
    res.json({
      ...result,
      cached: false
    });
  } catch (error) {
    console.error("[AI Coaching] Error:", error);
    res.status(500).json({ error: "Failed to generate AI coaching" });
  }
});

// Document translation (requires authentication)
router.post("/documents/:id/translate", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const documentId = parseInt(req.params.id);
  const userId = req.userId;

  try {
    const { priority = 10 } = req.body; // Number of sentences to translate with priority

    // Start background translation with user plan
    const userPlan = await getUserPlan(userId);
    const user = userId ? await storage.getUser(userId) : null;
    
    console.log(
      `Starting document translation for document ${documentId} with priority ${priority} (user plan: ${userPlan})`,
    );

    translateDocumentSentences(
      documentId,
      priority,
      userPlan,
      user?.email || undefined,
    );

    res.json({
      message: "Document translation started",
      documentId,
      priority,
      modelTier: TranslationService.getModelTier(userPlan),
    });
  } catch (error) {
    console.error("Error starting document translation:", error);
    res.status(500).json({ error: "Failed to start document translation" });
  }
});

// AI Sentence Coaching endpoint (Pro/Admin only)
// Phase 2: Language-agnostic coaching with Mode A (Comprehension) and Mode B (Composition)
router.post("/sentences/:id/coach", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const sentenceId = parseInt(req.params.id);
  const userId = req.userId;
  const { mode = 'comprehension' } = req.body; // 'comprehension' or 'composition'

  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  try {
    const userPlan = await getUserPlan(userId);
    
    // Check if user has Pro or Admin plan
    if (userPlan === "free") {
      return res.status(403).json({ 
        error: "upgrade_required",
        message: "AI Precision Coaching is a Pro feature. Upgrade now to get your own AI language tutor!",
        upgradeUrl: "/pricing"
      });
    }

    // Get user's language settings
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Get user's language preferences (Phase 1 schema)
    const baseLanguage = user.baseLanguage || 'ko';
    const learningLanguage = user.learningLanguage || 'en';

    // Get the sentence
    const sentence = await storage.getSentence(sentenceId);
    if (!sentence) {
      return res.status(404).json({ error: "Sentence not found" });
    }

    // Determine sentence language (use stored value or derive from document)
    let sentenceLanguage = sentence.language;
    if (!sentenceLanguage) {
      const paragraph = await storage.getParagraph(sentence.paragraphId);
      const document = paragraph ? await storage.getDocument(paragraph.documentId) : null;
      sentenceLanguage = document?.sourceLanguage || learningLanguage;
    }

    // Create cache key that includes mode and language settings
    const cacheKey = `${mode}_${baseLanguage}_${learningLanguage}`;
    
    // Check for cached coaching result
    const cachedCoaching = await storage.getAICoachingCache(userId, sentenceId);
    if (cachedCoaching?.aiCoachingCache) {
      try {
        const cachedData = JSON.parse(cachedCoaching.aiCoachingCache);
        // Check if cached data matches current mode and language settings
        if (cachedData._cacheKey === cacheKey) {
          console.log(`[AI_COACHING] Returning cached result for sentence ${sentenceId} (mode: ${mode})`);
          return res.json({
            ...cachedData,
            cached: true,
            cachedAt: cachedCoaching.aiCoachingCachedAt
          });
        }
      } catch (e) {
        // Cache parse failed, generate new
      }
    }

    // Get document info for context
    const paragraph = await storage.getParagraph(sentence.paragraphId);
    const document = paragraph ? await storage.getDocument(paragraph.documentId) : null;

    // Call OpenAI for coaching
    const coachingModel = process.env.OPENAI_MODEL_PRO || "gpt-4o";
    
    // Language-agnostic prompts based on mode
    let systemPrompt: string;
    let userPrompt: string;

    const languageNames: Record<string, string> = {
      en: 'English',
      ko: 'Korean',
      ja: 'Japanese',
      zh: 'Chinese',
      es: 'Spanish',
      fr: 'French',
      de: 'German',
      pt: 'Portuguese',
      it: 'Italian',
      ru: 'Russian',
      ar: 'Arabic',
      hi: 'Hindi',
      vi: 'Vietnamese',
      th: 'Thai',
    };

    const baseLangName = languageNames[baseLanguage] || baseLanguage;
    const learningLangName = languageNames[learningLanguage] || learningLanguage;

    if (mode === 'composition') {
      // Mode B: Composition - user writes in baseLanguage, AI suggests in learningLanguage
      systemPrompt = `You are an expert language tutor helping a learner improve their ${learningLangName} writing skills.
The learner's native language is ${baseLangName}.

IMPORTANT: Always respond in JSON format with the following structure:
{
  "suggestion": "A polished, natural ${learningLangName} version of the user's text",
  "explanation": "Explanation in ${baseLangName} of what was improved and why",
  "grammarInsight": "Key grammar points explained in ${baseLangName}",
  "nuanceTips": "Usage tips or cultural notes in ${baseLangName}"
}

Guidelines:
- The suggestion should be natural ${learningLangName}
- All explanations must be in ${baseLangName} for the learner to understand
- Focus on what the learner can improve in their composition
- Include cultural or contextual nuances when relevant`;

      const userTranslation = req.body.userText || sentence.target || '';
      userPrompt = `Help improve this ${learningLangName} composition:

Original reference (${learningLangName}): "${sentence.source}"
User's attempt: "${userTranslation}"
${document ? `Context: ${document.title}` : ""}

Provide a polished version and explain the improvements in ${baseLangName}.`;

    } else {
      // Mode A: Comprehension (default) - understand learningLanguage text in baseLanguage
      systemPrompt = `You are an expert language tutor helping a ${baseLangName} speaker understand ${learningLangName} text.

IMPORTANT: Always respond in JSON format with the following structure:
{
  "polishedTranslation": "A natural, accurate ${baseLangName} translation",
  "grammarInsight": "Key grammar points of the ${learningLangName} sentence, explained in ${baseLangName}",
  "nuanceTips": "Usage tips, idioms, or cultural context in ${baseLangName}"
}

Guidelines:
- The translation should be natural ${baseLangName}
- Grammar insights should help the learner understand ${learningLangName} structure
- Include vocabulary notes for difficult or idiomatic expressions
- All explanations must be in ${baseLangName}`;

      userPrompt = `Analyze this ${learningLangName} sentence for a ${baseLangName} speaker:

Sentence: "${sentence.source}"
${sentence.target ? `Existing translation: "${sentence.target}"` : ""}
${document ? `Context: ${document.title}` : ""}

Provide:
1. A polished ${baseLangName} translation
2. Grammar insights about the ${learningLangName} structure
3. Nuance and usage tips`;
    }

    console.log(`[AI_COACHING] Generating coaching for sentence ${sentenceId} (user: ${user?.email}, mode: ${mode}, ${learningLanguage}→${baseLanguage})`);

    const completion = await openai.chat.completions.create({
      model: coachingModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.7,
      response_format: { type: "json_object" }
    });

    const responseText = completion.choices[0]?.message?.content;
    if (!responseText) {
      throw new Error("Empty response from OpenAI");
    }

    const coachingResult = JSON.parse(responseText);

    // Add cache key and mode info
    const resultWithMeta = {
      ...coachingResult,
      _cacheKey: cacheKey,
      mode,
      baseLanguage,
      learningLanguage
    };

    // Cache the result
    await storage.saveAICoachingCache(userId, sentenceId, JSON.stringify(resultWithMeta));

    // Also save to the new coaching table for future use
    try {
      await storage.saveCoaching({
        sentenceId,
        mode: mode as 'comprehension' | 'composition',
        explanation: coachingResult.grammarInsight || coachingResult.explanation || '',
        suggestion: coachingResult.polishedTranslation || coachingResult.suggestion || null,
      });
    } catch (e) {
      console.log(`[AI_COACHING] Warning: Could not save to coaching table: ${e}`);
    }

    console.log(`[AI_COACHING] Coaching generated and cached for sentence ${sentenceId} (mode: ${mode})`);

    res.json({
      ...coachingResult,
      mode,
      baseLanguage,
      learningLanguage,
      cached: false,
      sentenceId,
      originalText: sentence.source
    });

  } catch (error) {
    console.error("Error generating AI coaching:", error);
    res.status(500).json({ error: "Failed to generate AI coaching" });
  }
});

// Get practice statistics for Practice Hub
router.get("/practice/stats", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    // Get all user sentences for statistics
    const allSentences = await storage.getUserSentences({ userId });

    // Get practice attempts
    const practiceData = await Promise.all(
      allSentences.map(async (sentence) => {
        // For now, use the sentence's practice data
        // TODO: Get from separate practice_attempts table
        const attempts = sentence.practiceCount
          ? [
              {
                score: sentence.score || 0,
                date: sentence.lastPracticed || new Date(),
              },
            ]
          : [];

        return {
          sentenceId: sentence.id,
          sentence: sentence.source,
          practiceCount: attempts.length,
          averageScore: attempts.length > 0 ? sentence.score || 0 : 0,
          lastScore: attempts.length > 0 ? sentence.score || 0 : 0,
          lastPracticed: sentence.lastPracticed,
          attempts,
        };
      }),
    );

    const practicedSentences = practiceData.filter(
      (p) => p.practiceCount > 0,
    );
    const totalScore = practicedSentences.reduce(
      (sum, p) => sum + p.averageScore,
      0,
    );
    const averageScore =
      practicedSentences.length > 0
        ? totalScore / practicedSentences.length
        : 0;

    // Find weak sentences (low scores or need more practice)
    const weakSentences = practiceData
      .filter((p) => p.practiceCount === 0 || p.averageScore < 7)
      .slice(0, 10)
      .map((p) => ({
        id: p.sentenceId,
        sentence: p.sentence,
        score: p.lastScore,
        practiceCount: p.practiceCount,
        needsWork: p.practiceCount === 0 ? "never_practiced" : "low_score",
      }));

    // Calculate streak (simplified - just check if practiced today)
    const today = new Date().toDateString();
    const practicedToday = practicedSentences.some(
      (p) => p.lastPracticed && new Date(p.lastPracticed).toDateString() === today,
    );

    // Calculate weekly progress
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const weeklyPractice = practiceData.filter(
      (p) =>
        p.lastPracticed && new Date(p.lastPracticed) > oneWeekAgo,
    );

    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const lastWeekPractice = practiceData.filter((p) => {
      if (!p.lastPracticed) return false;
      const practiceDate = new Date(p.lastPracticed);
      return practiceDate > twoWeeksAgo && practiceDate <= oneWeekAgo;
    });

    const weeklyGrowth =
      lastWeekPractice.length > 0
        ? ((weeklyPractice.length - lastWeekPractice.length) /
            lastWeekPractice.length) *
          100
        : weeklyPractice.length > 0
          ? 100
          : 0;

    res.json({
      totalSentences: allSentences.length,
      practicedSentences: practicedSentences.length,
      averageScore: Math.round(averageScore * 10) / 10,
      streakDays: practicedToday ? 1 : 0, // Simplified streak calculation
      weeklyGrowth: Math.round(weeklyGrowth),
      recentActivity: practicedSentences.slice(0, 5).map((p) => ({
        sentenceId: p.sentenceId,
        sentence: p.sentence.slice(0, 50) + "...",
        score: p.lastScore,
        date: p.lastPracticed,
      })),
      weakSentences,
      practicesByDay: {}, // TODO: Implement daily practice tracking
      improvementSuggestions: [
        "Practice weak sentences more frequently",
        "Focus on consistent daily practice",
        "Review recently practiced sentences",
      ],
    });
  } catch (error) {
    console.error("Error fetching practice stats:", error);
    res.status(500).json({ error: "Failed to fetch practice statistics" });
  }
});

// Get daily review recommendations
router.get("/recommendations/daily-review", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    // Get practice attempts for recommendation algorithm
    const practiceData = await Promise.all(
      // This would normally come from a practice_attempts table
      (await storage.getUserSentences({ userId })).map(async (sentence) => {
        const attempts = sentence.practiceCount
          ? [
              {
                score: sentence.score || 0,
                date: sentence.lastPracticed || new Date(),
              },
            ]
          : [];

        return {
          sentenceId: sentence.id,
          sentence: sentence.source,
          documentId: sentence.documentId,
          practiceCount: attempts.length,
          averageScore: attempts.length > 0 ? sentence.score || 0 : 0,
          lastScore: attempts.length > 0 ? sentence.score || 0 : 0,
          lastPracticed: sentence.lastPracticed,
          attempts,
        };
      }),
    );

    // Recommendation algorithm: prioritize by low score, long gap, or never practiced
    const recommendations = practiceData
      .filter((p) => {
        // Never practiced
        if (p.practiceCount === 0) return true;

        // Low recent score
        if (p.lastScore < 7) return true;

        // Haven't practiced in a while
        if (p.lastPracticed) {
          const daysSinceLastPractice =
            (Date.now() - new Date(p.lastPracticed).getTime()) /
            (1000 * 60 * 60 * 24);
          if (daysSinceLastPractice > 7) return true;
        }

        return false;
      })
      .sort((a, b) => {
        // Priority order:
        // 1. Never practiced (practiceCount = 0)
        // 2. Low scores (ascending by score)
        // 3. Longest time since last practice

        if (a.practiceCount === 0 && b.practiceCount > 0) return -1;
        if (a.practiceCount > 0 && b.practiceCount === 0) return 1;

        if (a.practiceCount === 0 && b.practiceCount === 0) return 0;

        // Both have been practiced - sort by score first, then by recency
        if (a.lastScore !== b.lastScore) {
          return a.lastScore - b.lastScore; // Lower scores first
        }

        // Same score - prioritize older practice dates
        const aTime = a.lastPracticed
          ? new Date(a.lastPracticed).getTime()
          : 0;
        const bTime = b.lastPracticed
          ? new Date(b.lastPracticed).getTime()
          : 0;
        return aTime - bTime; // Older dates first
      })
      .slice(0, 15) // Limit to 15 recommendations
      .map((p) => ({
        sentenceId: p.sentenceId,
        sentence: p.sentence,
        documentId: p.documentId,
        reason:
          p.practiceCount === 0
            ? "Never practiced"
            : p.lastScore < 7
              ? `Low score (${p.lastScore}/10)`
              : "Due for review",
        priority:
          p.practiceCount === 0 ? "high" : p.lastScore < 5 ? "high" : "medium",
        lastPracticed: p.lastPracticed,
        currentScore: p.lastScore,
      }));

    res.json({
      recommendations,
      summary: {
        totalRecommended: recommendations.length,
        neverPracticed: recommendations.filter((r) =>
          r.reason.includes("Never"),
        ).length,
        needsImprovement: recommendations.filter((r) =>
          r.reason.includes("Low score"),
        ).length,
        dueForReview: recommendations.filter((r) =>
          r.reason.includes("Due for"),
        ).length,
      },
    });
  } catch (error) {
    console.error("Error fetching daily recommendations:", error);
    res.status(500).json({ error: "Failed to fetch recommendations" });
  }
});

// Get weak sentences that need more practice
router.get("/recommendations/weak-sentences", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const limit = parseInt((req.query.limit as string) || "20");

    const sentences = await storage.getUserSentences({ userId });

    // Find sentences with low scores or high practice count but still struggling
    const weakSentences = sentences
      .filter((sentence) => {
        // Never practiced OR low average score OR many practices but still low score
        return (
          (sentence.practiceCount || 0) === 0 ||
          (sentence.score || 0) < 6 ||
          ((sentence.practiceCount || 0) > 3 && (sentence.score || 0) < 8)
        );
      })
      .sort((a, b) => {
        // Sort by: lowest score first, then highest practice count
        const scoreDiff = (a.score || 0) - (b.score || 0);
        if (scoreDiff !== 0) return scoreDiff;
        return (b.practiceCount || 0) - (a.practiceCount || 0);
      })
      .slice(0, limit)
      .map((sentence) => ({
        id: sentence.id,
        sentence: sentence.source,
        translation: sentence.target,
        currentScore: sentence.score || 0,
        practiceCount: sentence.practiceCount || 0,
        lastPracticed: sentence.lastPracticed,
        documentId: sentence.documentId,
        weakness:
          (sentence.practiceCount || 0) === 0
            ? "never_practiced"
            : (sentence.score || 0) < 4
              ? "very_low_score"
              : (sentence.score || 0) < 6
                ? "low_score"
                : "inconsistent",
      }));

    res.json({
      weakSentences,
      summary: {
        total: weakSentences.length,
        neverPracticed: weakSentences.filter(
          (s) => s.weakness === "never_practiced",
        ).length,
        lowScore: weakSentences.filter((s) =>
          s.weakness.includes("low_score"),
        ).length,
        inconsistent: weakSentences.filter(
          (s) => s.weakness === "inconsistent",
        ).length,
      },
    });
  } catch (error) {
    console.error("Error fetching weak sentences:", error);
    res.status(500).json({ error: "Failed to fetch weak sentences" });
  }
});

// Quick practice endpoint - get random sentences for quick practice session
router.get("/practice/quick-sentences", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const count = parseInt((req.query.count as string) || "10");
    const difficulty = req.query.difficulty as string; // 'easy', 'medium', 'hard'

    let sentences = await storage.getUserSentences({ userId });

    // Filter by difficulty if specified
    if (difficulty) {
      sentences = sentences.filter((s) => {
        if (difficulty === "easy") {
          return (s.practiceCount || 0) > 2 && (s.score || 0) >= 7;
        } else if (difficulty === "medium") {
          return (
            (s.practiceCount || 0) >= 1 &&
            (s.score || 0) >= 5 &&
            (s.score || 0) < 8
          );
        } else if (difficulty === "hard") {
          return (s.practiceCount || 0) === 0 || (s.score || 0) < 6;
        }
        return true;
      });
    }

    // Shuffle and take requested count
    const shuffled = sentences.sort(() => Math.random() - 0.5);
    const selectedSentences = shuffled.slice(0, count);

    res.json({
      sentences: selectedSentences.map((s) => ({
        id: s.id,
        sentence: s.source,
        translation: s.target,
        documentId: s.documentId,
        practiceCount: s.practiceCount || 0,
        lastScore: s.score || 0,
      })),
      difficulty: difficulty || "mixed",
      totalAvailable: sentences.length,
    });
  } catch (error) {
    console.error("Error fetching quick practice sentences:", error);
    res.status(500).json({ error: "Failed to fetch practice sentences" });
  }
});

// Practice sessions management
router.post("/practice/sessions", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sentenceIds, sessionType = "practice" } = req.body;
    const userId = req.userId;

    if (!sentenceIds || !Array.isArray(sentenceIds)) {
      return res.status(400).json({ error: "Sentence IDs required" });
    }

    // For now, create a simple session tracking object
    // TODO: Store in database
    const sessionId = crypto.randomUUID();
    const session = {
      id: sessionId,
      userId,
      sentenceIds,
      sessionType,
      startTime: new Date(),
      status: "active",
      progress: {
        completed: 0,
        total: sentenceIds.length,
        scores: {},
      },
    };

    res.status(201).json(session);
  } catch (error) {
    console.error("Error creating practice session:", error);
    res.status(500).json({ error: "Failed to create practice session" });
  }
});

// Update practice session progress
router.patch("/practice/sessions/:id", async (req, res) => {
  try {
    const sessionId = req.params.id;
    const { sentenceId, score, userTranslation, completed = false } =
      req.body;

    // TODO: Get session from database and update
    // For now, just update the sentence practice data
    if (sentenceId && score !== undefined) {
      await storage.updateSentence(sentenceId, {
        practiced: true,
        score: score,
        userTranslation: userTranslation || null,
        lastPracticed: new Date(),
        practiceCount: sql`${storage.schema.sentences.practiceCount} + 1`,
      });
    }

    res.json({
      sessionId,
      updated: true,
      completed,
    });
  } catch (error) {
    console.error("Error updating practice session:", error);
    res.status(500).json({ error: "Failed to update practice session" });
  }
});

// Get practice session details
router.get("/practice/sessions/:id", async (req, res) => {
  try {
    const sessionId = req.params.id;

    // TODO: Get from database
    // For now, return a mock session
    res.json({
      id: sessionId,
      status: "completed",
      startTime: new Date(Date.now() - 600000), // 10 minutes ago
      endTime: new Date(),
      progress: {
        completed: 5,
        total: 10,
        averageScore: 7.2,
      },
    });
  } catch (error) {
    console.error("Error fetching practice session:", error);
    res.status(500).json({ error: "Failed to fetch practice session" });
  }
});

// Get all practice sessions for user
router.get("/practice/sessions", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;

    // TODO: Get from database
    // For now, return mock sessions
    res.json([
      {
        id: "session-1",
        sessionType: "daily-review",
        startTime: new Date(Date.now() - 86400000), // 1 day ago
        progress: { completed: 10, total: 10, averageScore: 8.1 },
        status: "completed",
      },
      {
        id: "session-2",
        sessionType: "weak-sentences",
        startTime: new Date(Date.now() - 3600000), // 1 hour ago
        progress: { completed: 3, total: 8, averageScore: 6.5 },
        status: "active",
      },
    ]);
  } catch (error) {
    console.error("Error fetching practice sessions:", error);
    res.status(500).json({ error: "Failed to fetch practice sessions" });
  }
});

// Glossary endpoints

// Glossary endpoint moved to misc.ts to avoid duplication

// REMOVED: Add new note endpoint - moved to notes.ts to avoid conflicts
// This endpoint was causing conflicts with the main /notes endpoint that handles notebook linking

// Add new glossary term
router.post("/glossary", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { term, definition, translation, pronunciation, tags, sourceLanguage, targetLanguage, contextSentence, documentId } = req.body;
    const userId = req.user?.id || 1;

    if (!term) {
      return res
        .status(400)
        .json({ error: "Term and translation are required" });
    }

    const glossaryTerm = await storage.createGlossaryTerm({
      userId,
      term,
      definition: definition || "",
      translation: translation || "",
      pronunciation: pronunciation || "",
      tags: tags || null,
      sourceLanguage: sourceLanguage || "English",
      targetLanguage: targetLanguage || "Korean",
      contextSentence: contextSentence || null,
      documentId: documentId || null,
    });

    res.status(201).json(glossaryTerm);
  } catch (error) {
    console.error("Error adding glossary term:", error);
    res.status(500).json({ error: "Failed to add glossary term" });
  }
});

// Update glossary term
router.put("/glossary/:id", async (req, res) => {
  try {
    const termId = parseInt(req.params.id);
    const updates = req.body;

    const updatedTerm = await storage.updateGlossaryTerm(termId, updates);
    if (!updatedTerm) {
      return res.status(404).json({ error: "Glossary term not found" });
    }

    res.json(updatedTerm);
  } catch (error) {
    console.error("Error updating glossary term:", error);
    res.status(500).json({ error: "Failed to update glossary term" });
  }
});

// Delete glossary term
router.delete("/glossary/:id", async (req, res) => {
  try {
    const termId = parseInt(req.params.id);
    const success = await storage.deleteGlossaryTerm(termId);

    if (!success) {
      return res.status(404).json({ error: "Glossary term not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting glossary term:", error);
    res.status(500).json({ error: "Failed to delete glossary term" });
  }
});

// Generate single glossary term definition
router.post("/glossary/generate", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { term, contextSentence, sourceLanguage, targetLanguage, documentId } = req.body;
    const userId = req.user?.id || 1;

    if (!term) {
      return res.status(400).json({ error: "Term is required" });
    }

    if (!documentId) {
      return res.status(400).json({ error: "Document ID is required" });
    }

    // Generate definition and translation for a single term
    const prompt = `Generate a definition and translation for the term "${term}" in JSON format.

Context sentence: "${contextSentence || 'No context provided'}"
Source language: ${sourceLanguage}
Target language: ${targetLanguage}

Provide ONLY a JSON object with this exact format:
{
  "term": "${term}",
  "definition": "용어의 한국어 정의 (사전 스타일)",
  "translation": "용어의 한국어 번역",
  "category": "noun|verb|adjective|phrase|idiom"
}

IMPORTANT STYLE RULES:
1. Both "definition" and "translation" must be in Korean.
2. Write the definition in DICTIONARY STYLE using noun phrases, NOT polite speech.
   - CORRECT: "컴퓨터가 인간의 언어를 이해하고 처리하는 인공지능 분야." (noun phrase ending)
   - WRONG: "컴퓨터가 인간의 언어를 처리하는 분야입니다." (polite ~입니다 ending)
3. End definitions with a noun or "~것", "~과정", "~분야" etc., not with "~입니다" or "~합니다".`;

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content: "You are a helpful language teacher. Provide accurate definitions and translations in valid JSON format only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 500,
    });

    // Clean the response content by removing markdown code blocks
    let responseContent = response.choices[0].message.content || "{}";
    responseContent = responseContent.replace(/```json\s*|\s*```/g, '').trim();

    const generatedData = JSON.parse(responseContent);
    res.json(generatedData);
  } catch (error) {
    console.error("Error generating glossary term:", error);
    res.status(500).json({ error: "Failed to generate glossary term" });
  }
});

// Auto-generate glossary from document
router.post("/glossary/generate-from-document", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { documentId, maxTerms = 20 } = req.body;
    const userId = req.user?.id || 1;

    if (!documentId) {
      return res.status(400).json({ error: "Document ID is required" });
    }

    const document = await storage.getDocumentWithParagraphs(documentId);
    if (!document) {
      return res.status(404).json({ error: "Document not found" });
    }

    // Extract text from all sentences
    const allText = document.paragraphs?.flatMap((p) => p.sentences?.map((s) => s.source) || [])
      .join(" ");

    if (!allText) {
      return res
        .status(400)
        .json({ error: "No text content found in document" });
    }

    // Use AI to extract key terms and their translations
    const extractionPrompt = `Extract ${maxTerms} important terms, phrases, or vocabulary words from this text and provide Korean translations:

Text: "${allText}"

Return as JSON array with format:
[
  {
    "term": "word or phrase in English",
    "translation": "용어의 한국어 번역",
    "definition": "용어의 한국어 정의 (사전 스타일)",
    "category": "noun|verb|adjective|phrase|idiom"
  }
]

Focus on:
- Key vocabulary words
- Important phrases or expressions
- Technical terms or concepts
- Useful everyday language

IMPORTANT STYLE RULES:
1. Both "definition" and "translation" must be in Korean.
2. Write definitions in DICTIONARY STYLE using noun phrases, NOT polite speech.
   - CORRECT: "데이터를 빠르게 접근할 수 있도록 임시로 저장하는 메모리 공간." (noun phrase ending)
   - WRONG: "데이터를 임시로 저장하는 공간입니다." (polite ~입니다 ending)
3. End definitions with a noun or "~것", "~과정", "~분야" etc., not with "~입니다" or "~합니다".`;

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are a helpful language teacher. Extract useful vocabulary terms and provide accurate Korean translations in valid JSON format only.",
        },
        {
          role: "user",
          content: extractionPrompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 1500,
    });

    // Clean the response content by removing markdown code blocks
    let responseContent = response.choices[0].message.content || "[]";
    responseContent = responseContent.replace(/```json\s*|\s*```/g, '').trim();

    const extractedTerms = JSON.parse(responseContent);

    // Add terms to glossary
    const addedTerms = [];
    for (const termData of extractedTerms.slice(0, maxTerms)) {
      try {
        const glossaryTerm = await storage.createGlossaryTerm({
          userId,
          term: termData.term,
          translation: termData.translation,
          definition: termData.definition || "",
          category: termData.category || "general",
          notes: `Auto-generated from document: ${document.title}`,
        });
        addedTerms.push(glossaryTerm);
      } catch (error) {
        console.log(`Skipped duplicate term: ${termData.term}`);
      }
    }

    res.json({
      success: true,
      addedCount: addedTerms.length,
      terms: addedTerms,
      documentTitle: document.title,
    });
  } catch (error) {
    console.error("Error generating glossary:", error);
    res.status(500).json({ error: "Failed to generate glossary terms" });
  }
});

// Get glossary statistics
router.get("/glossary/stats", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const terms = await storage.getAllGlossaryTerms(userId);

    const stats = {
      totalTerms: terms.length,
      byCategory: terms.reduce(
        (acc, term) => {
          acc[term.category] = (acc[term.category] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      ),
      recentlyAdded: terms
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        )
        .slice(0, 5),
      // TODO: Add more advanced stats like practice frequency, mastery levels
    };

    res.json(stats);
  } catch (error) {
    console.error("Error fetching glossary stats:", error);
    res.status(500).json({ error: "Failed to fetch glossary statistics" });
  }
});

// Get terms for practice (spaced repetition)
router.get("/glossary/practice-words", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const limit = parseInt((req.query.limit as string) || "10");

    const terms = await storage.getAllGlossaryTerms(userId);

    // Simple spaced repetition algorithm
    // TODO: Implement proper spaced repetition with intervals
    const practiceTerms = terms
      .filter((term) => {
        // Include terms that haven't been practiced or need review
        if (!term.lastPracticed) return true;

        const daysSinceLastPractice =
          (Date.now() - new Date(term.lastPracticed).getTime()) /
          (1000 * 60 * 60 * 24);

        // Review interval based on mastery level
        const reviewInterval = Math.pow(2, term.masteryLevel || 0); // 1, 2, 4, 8, 16 days
        return daysSinceLastPractice >= reviewInterval;
      })
      .sort((a, b) => {
        // Prioritize by mastery level (lower first) and then by last practiced
        if ((a.masteryLevel || 0) !== (b.masteryLevel || 0)) {
          return (a.masteryLevel || 0) - (b.masteryLevel || 0);
        }

        const aTime = a.lastPracticed
          ? new Date(a.lastPracticed).getTime()
          : 0;
        const bTime = b.lastPracticed
          ? new Date(b.lastPracticed).getTime()
          : 0;
        return aTime - bTime; // Older first
      })
      .slice(0, limit);

    res.json({
      terms: practiceTerms,
      totalAvailable: terms.length,
      dueForReview: practiceTerms.length,
    });
  } catch (error) {
    console.error("Error fetching practice words:", error);
    res.status(500).json({ error: "Failed to fetch practice words" });
  }
});

// Record practice session for glossary terms
router.post("/glossary/practice", async (req, res) => {
  try {
    const { termId, correct, responseTime } = req.body;

    if (!termId || correct === undefined) {
      return res
        .status(400)
        .json({ error: "Term ID and correct flag are required" });
    }

    const term = await storage.getGlossaryTerm(termId);
    if (!term) {
      return res.status(404).json({ error: "Glossary term not found" });
    }

    // Update practice data
    const updates: any = {
      practiceCount: (term.practiceCount || 0) + 1,
      lastPracticed: new Date(),
    };

    // Adjust mastery level based on performance
    if (correct) {
      updates.masteryLevel = Math.min((term.masteryLevel || 0) + 1, 10);
      updates.correctCount = (term.correctCount || 0) + 1;
    } else {
      updates.masteryLevel = Math.max((term.masteryLevel || 0) - 1, 0);
      updates.incorrectCount = (term.incorrectCount || 0) + 1;
    }

    const updatedTerm = await storage.updateGlossaryTerm(termId, updates);

    res.json({
      success: true,
      term: updatedTerm,
      newMasteryLevel: updates.masteryLevel,
    });
  } catch (error) {
    console.error("Error recording word practice:", error);
    res.status(500).json({ error: "Failed to record practice session" });
  }
});

// Generate quiz from glossary terms
router.post("/glossary/generate-quiz", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const { count = 10, category, difficulty } = req.body;
    const userId = req.userId!;

    let terms = await storage.getGlossaryTerms(userId);

    // Filter by category if specified
    if (category && category !== "all") {
      terms = terms.filter((term) => term.category === category);
    }

    // Filter by difficulty/mastery level if specified
    if (difficulty) {
      terms = terms.filter((term) => {
        const mastery = term.masteryLevel || 0;
        if (difficulty === "easy") return mastery >= 5;
        if (difficulty === "medium") return mastery >= 2 && mastery < 5;
        if (difficulty === "hard") return mastery < 2;
        return true;
      });
    }

    if (terms.length < count) {
      return res.status(400).json({
        error: `Not enough terms available. Found ${terms.length}, requested ${count}`,
      });
    }

    // Randomly select terms
    const selectedTerms = terms.sort(() => Math.random() - 0.5).slice(0, count);

    // Generate quiz questions with multiple choice
    const quizQuestions = selectedTerms.map((term, index) => {
      // Get other terms for wrong answers
      const otherTerms = terms.filter((t) => t.id !== term.id);
      const wrongAnswers = otherTerms
        .sort(() => Math.random() - 0.5)
        .slice(0, 3)
        .map((t) => t.translation);

      const choices = [term.translation, ...wrongAnswers].sort(
        () => Math.random() - 0.5,
      );

      return {
        id: index + 1,
        termId: term.id,
        question: term.term,
        choices,
        correctAnswer: term.translation,
        category: term.category,
        definition: term.definition,
      };
    });

    res.json({
      quizId: crypto.randomUUID(),
      questions: quizQuestions,
      totalQuestions: count,
      category: category || "mixed",
      difficulty: difficulty || "mixed",
    });
  } catch (error) {
    console.error("Error generating quiz:", error);
    res.status(500).json({ error: "Failed to generate quiz" });
  }
});

// Notebook endpoints

// Note: Notebook routes moved to /api/notes.ts for better organization

// Delete notebook
router.delete("/notebooks/:id", async (req, res) => {
  try {
    const notebookId = parseInt(req.params.id);
    const success = await storage.deleteNotebook(notebookId);

    if (!success) {
      return res.status(404).json({ error: "Notebook not found" });
    }

    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting notebook:", error);
    res.status(500).json({ error: "Failed to delete notebook" });
  }
});

// Remove sentence from notebook
router.delete(
  "/notebooks/:notebookId/sentences/:sentenceId",
  async (req, res) => {
    try {
      const notebookId = parseInt(req.params.notebookId);
      const sentenceId = parseInt(req.params.sentenceId);

      const success = await storage.removeSentenceFromNotebook(
        notebookId,
        sentenceId,
      );

      if (!success) {
        return res
          .status(404)
          .json({ error: "Sentence not found in notebook" });
      }

      res.json({ success: true });
    } catch (error) {
      console.error("Error removing sentence from notebook:", error);
      res
        .status(500)
        .json({ error: "Failed to remove sentence from notebook" });
    }
  },
);

// Refresh notebook content (re-sync sentences)
router.post("/notebooks/:id/refresh", async (req, res) => {
  try {
    const notebookId = parseInt(req.params.id);

    // TODO: Implement notebook refresh logic
    // This would typically re-sync sentences based on criteria
    const notebook = await storage.getNotebook(notebookId);
    if (!notebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }

    res.json({
      success: true,
      message: "Notebook refreshed successfully",
      lastRefreshed: new Date(),
    });
  } catch (error) {
    console.error("Error refreshing notebook:", error);
    res.status(500).json({ error: "Failed to refresh notebook" });
  }
});

// Enhanced sentence feedback with style variations
router.post("/sentences/:id/feedback-advanced", async (req, res) => {
  const sentenceId = parseInt(req.params.id);

  try {
    const { userTranslation } = req.body;

    const sentence = await storage.getSentence(sentenceId);
    if (!sentence) {
      return res.status(404).json({ error: "Sentence not found" });
    }

    // Generate style-specific feedback and variations
    const feedbackPrompt = `Analyze this translation and provide detailed feedback:

Original: "${sentence.source}"
User translation: "${userTranslation}"

Provide feedback in JSON format:
{
  "score": 0-10,
  "accuracy": "assessment of accuracy",
  "naturalness": "assessment of naturalness",
  "style": "assessment of style appropriateness",
  "improvements": ["suggestion 1", "suggestion 2"],
  "strengths": ["strength 1", "strength 2"],
  "styleVariations": {
    "formal": "formal version",
    "casual": "casual version",
    "business": "business version"
  }
}`;

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are an expert language teacher. Provide detailed, constructive feedback in valid JSON format only.",
        },
        {
          role: "user",
          content: feedbackPrompt,
        },
      ],
      temperature: 0.3,
    });

    const feedbackData = JSON.parse(
      response.choices[0].message.content || "{}",
    );

    // Save feedback to sentence
    await storage.updateSentence(sentenceId, {
      userFeedback: JSON.stringify(feedbackData),
      styleVariations: JSON.stringify(feedbackData.styleVariations),
      practiceCount: (sentence.practiceCount || 0) + 1,
      lastPracticed: new Date(),
    });

    res.json(feedbackData);
  } catch (error) {
    console.error("Error generating advanced feedback:", error);
    res.status(500).json({ error: "Failed to generate advanced feedback" });
  }
});

// New review session endpoint
router.post("/review/:id", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  const sentenceId = parseInt(req.params.id);

  try {
    const { score, userTranslation, feedback, sessionType } = req.body;
    const userId = req.userId;

    if (score === undefined) {
      return res.status(400).json({ error: "Score is required" });
    }

    // Update sentence with review data
    const updates: any = {
      score: score,
      userTranslation: userTranslation || null,
      lastPracticed: new Date(),
      practiceCount: sql`practiceCount + 1`,
    };

    if (feedback) {
      updates.note = feedback;
    }

    const sentence = await storage.updateSentence(sentenceId, updates);

    // Also record the practice session
    // TODO: Store in separate practice_sessions table
    const practiceSession = {
      sentenceId,
      userId,
      score,
      userTranslation,
      feedback: null,
      sessionType: sessionType || "individual",
      createdAt: new Date(),
      timeSpent: null,
      practiceMode: "individual",
    };

    res.json({
      success: true,
      sentence,
      practiceSession,
    });
  } catch (error) {
    console.error("Error saving review:", error);
    res.status(500).json({ error: "Failed to save review" });
  }
});

// Save review session result - for the new card-based review system
router.post("/practice/review-result", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sentenceId, score, userTranslation, needsReview, sessionTime } = req.body;
    const userId = req.userId;

    if (!sentenceId || score === undefined) {
      return res
        .status(400)
        .json({ error: "Sentence ID and score are required" });
    }

    // Record the practice session
    const practiceSession = {
      sentenceId,
      userId,
      score,
      userTranslation,
      feedback: null,
      sessionType: "review",
      createdAt: new Date(),
      practiceMode: "individual",
      timeSpent: sessionTime || null,
    };

    // Update sentence practice data
    await storage.updateSentence(sentenceId, {
      practiced: true,
      score: score,
      userTranslation: userTranslation || null,
      lastPracticed: new Date(),
      practiceCount: sql`practiceCount + 1`,
      needsReview: needsReview || false,
    });

    res.json({
      success: true,
      practiceSession,
      message: "Review result saved successfully",
      nextReviewDate: needsReview
        ? new Date(Date.now() + 24 * 60 * 60 * 1000) // Tomorrow
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Next week
      sessionTime: sessionTime || 0,
    });
  } catch (error) {
    console.error("Error saving review result:", error);
    res.status(500).json({ error: "Failed to save review result" });
  }
});

// --- Honorific Detection and Normalization Helpers ---

function containsHonorific(text: string): boolean {
  const honorificPatterns = [
    // Broad patterns to catch any polite endings (including with particles)
    /[가-힣]습니다/,
    /[가-힣]니다/,
    /[가-힣]니까/,
    /입니다/,
    /됩니다/,
    /합니다/,
    /하십시오/,
    /하시기 바랍니다/,
    /주시기 바랍니다/,
    /하세요/,
    /주세요/,
    /드립니다/,
    /바랍니다/,
  ];
  return honorificPatterns.some((re) => re.test(text));
}

function normalizePoliteToPlain(text: string): string {
  // Simplified approach: handle only the MOST common and unambiguous patterns
  // Rely on GPT-4o-mini + few-shot examples to get it right in the first place
  // These patterns fix the most frequent slip-ups without breaking conjugation
  return text
    // Core copula and auxiliary patterns (grammatically safe)
    .replace(/입니다/g, "이다")
    .replace(/였습니다/g, "이었다")
    .replace(/이었습니다/g, "이었다")
    .replace(/됩니다/g, "된다")
    .replace(/되었습니다/g, "되었다")
    .replace(/될 것입니다/g, "될 것이다")
    .replace(/합니다/g, "한다")
    .replace(/했습니다/g, "했다")
    .replace(/할 것입니다/g, "할 것이다")
    .replace(/하겠습니다/g, "하겠다")
    .replace(/하고 있습니다/g, "하고 있다")
    .replace(/되고 있습니다/g, "되고 있다")
    .replace(/하는 것입니다/g, "하는 것이다")
    .replace(/것입니다/g, "것이다")
    .replace(/겁니다/g, "것이다")
    .replace(/일 것입니다/g, "일 것이다")
    .replace(/중입니다/g, "중이다")
    
    // Common adjectives (no conjugation issues)
    .replace(/없습니다/g, "없다")
    .replace(/있습니다/g, "있다")
    .replace(/같습니다/g, "같다")
    .replace(/많습니다/g, "많다")
    .replace(/적습니다/g, "적다")
    .replace(/크습니다/g, "크다")
    .replace(/작습니다/g, "작다")
    
    // Polite requests/commands → academic plain form
    .replace(/하십시오/g, "하도록 한다")
    .replace(/하시기 바랍니다/g, "하도록 한다")
    .replace(/해 주시기 바랍니다/g, "하도록 한다")
    .replace(/부탁드립니다/g, "하도록 한다")
    .replace(/권장드립니다/g, "권장한다")
    .replace(/권고드립니다/g, "권고한다")
    .replace(/주시길 바랍니다/g, "하도록 한다")
    .replace(/주세요/g, "하도록 한다")
    .replace(/해 주세요/g, "하도록 한다")
    .replace(/하세요/g, "한다")
    
    // Question forms
    .replace(/입니까\?/g, "인가?")
    .replace(/습니까\?/g, "는가?")
    .replace(/겠습니까\?/g, "겠는가?")
    
    // PRAGMATIC CATCH-ALL: Remove ALL remaining honorific endings
    // Trade-off: Creates dictionary/infinitive forms instead of perfect declaratives
    // Example: "먹습니다" → "먹다" (should be "먹는다" but removing honorific is priority)
    // Rationale: User's goal is honorific removal; imperfect conjugation > honorific speech
    // GPT-4o-mini + few-shot handles most cases correctly; this is the safety net
    .replace(/습니다/g, "다")
    .replace(/니다/g, "다")
    .replace(/니까/g, "냐");
}

// Helper function to translate text using OpenAI with enhanced style enforcement
async function translateText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string,
): Promise<string> {
  try {
    // Concise, powerful system prompt for consistent 하다체
    const systemPrompt = `You are a professional translator for ${sourceLanguage}→${targetLanguage}.
Output must be Korean 'plain academic style' (하다체): only ~다/~는다/~했다/~이다/~되다 endings.

STRICT RULES:
- Never use honorific endings (~습니다/~입니다/~됩니다/~하세요 등)
- Prefer declarative academic tone; convert requests to "~하도록 한다"
- Preserve meaning, numbers, entities, formatting; no extra commentary
- Replace semicolons with appropriate punctuation; normalize dashes
- No colloquialisms, no honorifics, no emojis`;

    // Few-shot examples to demonstrate exact style
    const fewShotExamples = [
      {
        role: "user" as const,
        content: `Translate: "It is recommended that users update the app."\nStyle: academic plain (하다체)`,
      },
      {
        role: "assistant" as const,
        content: "사용자가 앱을 업데이트하도록 한다.",
      },
      {
        role: "user" as const,
        content: `Translate: "The model is trained on public datasets."\nStyle: academic plain (하다체)`,
      },
      {
        role: "assistant" as const,
        content: "모델은 공개 데이터셋으로 학습된다.",
      },
      {
        role: "user" as const,
        content: `Translate: "This result indicates a significant improvement."\nStyle: academic plain (하다체)`,
      },
      {
        role: "assistant" as const,
        content: "이 결과는 유의미한 개선을 나타낸다.",
      },
    ];

    const userContent = `Translate from ${sourceLanguage} to ${targetLanguage} in Korean 'plain academic style' (하다체):\n\n${text}`;

    const response = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        ...fewShotExamples,
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      max_tokens: Math.min(text.length * 2, 1200),
    });

    const translatedText = response.choices[0].message.content || text;

    // Apply post-processing cleanup with enhanced normalization
    const finalTranslation = applyLocalCleanup(translatedText);

    // Monitoring: log if honorifics remain after cleanup
    if (containsHonorific(finalTranslation)) {
      console.warn(
        `[Translation Monitor] Honorific patterns detected after cleanup. Length: ${finalTranslation.length}`,
      );
    }

    return finalTranslation;
  } catch (error) {
    console.error("Translation error:", error);
    return `[Translation unavailable] ${text}`;
  }
}

function applyLocalCleanup(translatedText: string): string {
  return normalizePoliteToPlain(
    translatedText
      .replace(/;/g, ".")
      .replace(/—/g, " — ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

// Helper function for background document translation
async function translateDocumentSentences(
  documentId: number,
  priorityCount: number = 10, // Number of sentences to translate with priority
  userPlan: UserPlan = "free",
  userEmail?: string,
): Promise<void> {
  try {
    const modelTier = TranslationService.getModelTier(userPlan);
    console.log(`Starting translation for document ${documentId} (plan: ${userPlan}, tier: ${modelTier})`);

    const document = await storage.getDocumentWithParagraphs(documentId);
    if (!document) {
      console.error(`Document ${documentId} not found`);
      return;
    }

    // Get all sentences that need translation
    const allSentences = document.paragraphs?.flatMap((p) =>
      p.sentences?.filter((s) => !s.target || s.target.trim() === "") || [],
    ) || [];

    if (allSentences.length === 0) {
      console.log(`No sentences to translate for document ${documentId}`);
      // Mark as completed if no sentences need translation
      await storage.updateDocument(documentId, {
        translationStatus: "completed",
        translationProgress: 100,
        translatedCount: 0,
        totalCount: 0,
        translationUpdatedAt: new Date(),
      });
      return;
    }

    console.log(
      `Found ${allSentences.length} sentences to translate for document ${documentId}`,
    );

    // Initialize translation status
    await storage.updateDocument(documentId, {
      translationStatus: "running",
      translationProgress: 0,
      translatedCount: 0,
      totalCount: allSentences.length,
      translationUpdatedAt: new Date(),
    });
    
    let processedSentences = 0;
    const totalSentences = allSentences.length;

    // Group sentences into priority and regular batches
    const prioritySentences = allSentences.slice(0, priorityCount);
    const regularSentences = allSentences.slice(priorityCount);

    // Translate priority sentences first (with smaller batches for faster feedback)
    if (prioritySentences.length > 0) {
      console.log(
        `Translating ${prioritySentences.length} priority sentences for document ${documentId}`,
      );

      const priorityBatches = [];
      for (let i = 0; i < prioritySentences.length; i += 3) {
        // Smaller batches of 3
        priorityBatches.push(prioritySentences.slice(i, i + 3));
      }

      for (const batch of priorityBatches) {
        await Promise.all(
          batch.map(async (sentence) => {
            try {
              const { id } = sentence;

              // Skip if already translated (double check)
              const currentSentence = await storage.getSentence(id);
              if (currentSentence?.target && currentSentence.target.trim() !== "") {
                processedSentences++;
                return;
              }

              // If not in cache, translate the sentence using TranslationService
              const result = await TranslationService.translateText(sentence.source, {
                userEmail,
                userPlan,
                sourceLanguage: document.sourceLanguage,
                targetLanguage: document.targetLanguage,
              });

              // Update the sentence with the translation
              await storage.updateSentence(id, {
                target: result.translation,
              });

              processedSentences++;
              const progress = Math.floor(
                (processedSentences / totalSentences) * 100,
              );
              await storage.updateDocument(documentId, {
                translationProgress: progress,
                translatedCount: processedSentences,
                translationUpdatedAt: new Date(),
              });

              console.log(
                `Translated priority sentence ${id} for document ${documentId} (${processedSentences}/${totalSentences}) [${result.modelTier}]`,
              );
            } catch (error) {
              console.error(
                `Failed to translate priority sentence ${sentence.id}:`,
                error,
              );
            }
          }),
        );

        // Small delay between priority batches
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    // Translate remaining sentences in larger batches
    if (regularSentences.length > 0) {
      console.log(
        `Translating ${regularSentences.length} regular sentences for document ${documentId}`,
      );

      const regularBatches = [];
      for (let i = 0; i < regularSentences.length; i += 5) {
        // Larger batches of 5
        regularBatches.push(regularSentences.slice(i, i + 5));
      }

      for (const batch of regularBatches) {
        await Promise.all(
          batch.map(async (sentence) => {
            try {
              const { id } = sentence;

              // Skip if already translated (double check)
              const currentSentence = await storage.getSentence(id);
              if (currentSentence?.target && currentSentence.target.trim() !== "") {
                processedSentences++;
                return;
              }

              // If not in cache, translate the sentence using TranslationService
              const result = await TranslationService.translateText(sentence.source, {
                userEmail,
                userPlan,
                sourceLanguage: document.sourceLanguage,
                targetLanguage: document.targetLanguage,
              });

              // Update the sentence with the translation
              await storage.updateSentence(sentence.id, {
                target: result.translation,
              });

              // Update progress
              processedSentences++;
              const progress = Math.floor(
                (processedSentences / totalSentences) * 100,
              );
              await storage.updateDocument(documentId, {
                translationProgress: progress,
                translatedCount: processedSentences,
                translationUpdatedAt: new Date(),
              });
            } catch (error) {
              console.error(`Failed to translate sentence in batch:`, error);
            }
          }),
        );

        // Sleep between batches to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Mark translation as completed
    await storage.updateDocument(documentId, {
      translationStatus: "completed",
      translationProgress: 100,
      translatedCount: processedSentences,
      totalCount: totalSentences,
      translationUpdatedAt: new Date(),
    });
    
    console.log(`Translation completed for document ${documentId} (${processedSentences}/${totalSentences})`);
  } catch (error) {
    console.error(`Failed to translate document ${documentId}:`, error);
    // Mark as failed on error
    await storage.updateDocument(documentId, {
      translationStatus: "failed",
      translationError: error instanceof Error ? error.message : "Unknown error",
      translationUpdatedAt: new Date(),
    });
  }
}

export default router;