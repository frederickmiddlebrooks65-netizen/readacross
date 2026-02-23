import { Router, Request, Response } from "express";
import { db } from "../db.js";
import { 
  notebooks, 
  notebookSentences, 
  noteNotebooks,
  notebookGroups,
  notes,
  sentences, 
  translations, 
  coaching,
  users,
  userSentenceState,
  userGlossaryState,
  glossary,
  quizResults
} from "@shared/schema.js";
import { eq, and, desc, asc, lte, or, isNull, inArray } from "drizzle-orm";
import { GeminiService } from "../services/GeminiService.js";
import { authenticateJWT, requireAdmin, AuthenticatedRequest } from "../auth.js";

const router = Router();

const adminOnlyQuiz = [authenticateJWT, requireAdmin];

// GET /api/quiz/generate?notebookId=...&mode=comprehension|production
router.get("/quiz/generate", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { notebookId, mode = "comprehension" } = req.query;
    const userId = req.userId!;

    if (!notebookId) {
      return res.status(400).json({ error: "notebookId is required" });
    }

    if (mode !== "comprehension" && mode !== "production") {
      return res.status(400).json({ error: "mode must be 'comprehension' or 'production'" });
    }

    // Get user's language settings
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { baseLanguage, learningLanguage } = user;

    // Verify notebook belongs to user
    const notebook = await db.query.notebooks.findFirst({
      where: and(
        eq(notebooks.id, parseInt(notebookId as string)),
        eq(notebooks.userId, userId)
      ),
    });

    if (!notebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }

    // Get all sentences in the notebook
    const notebookSentenceRows = await db
      .select({
        sentenceId: notebookSentences.sentenceId,
      })
      .from(notebookSentences)
      .where(eq(notebookSentences.notebookId, parseInt(notebookId as string)));

    if (notebookSentenceRows.length === 0) {
      return res.json({ items: [], notebook: { id: notebook.id, title: notebook.title } });
    }

    const sentenceIds = notebookSentenceRows.map(row => row.sentenceId);

    // Fetch sentences with translations and coaching
    const quizItems = [];

    for (const sentenceId of sentenceIds) {
      // Get the sentence
      const sentence = await db.query.sentences.findFirst({
        where: eq(sentences.id, sentenceId),
      });

      if (!sentence) continue;

      // Skip if sentence language doesn't match learningLanguage
      // If sentence.language is null, assume it matches (backward compatibility)
      if (sentence.language && sentence.language !== learningLanguage) {
        continue;
      }

      // Get translation (prefer user origin, fallback to AI)
      const userTranslation = await db.query.translations.findFirst({
        where: and(
          eq(translations.sentenceId, sentenceId),
          eq(translations.targetLanguage, baseLanguage),
          eq(translations.origin, "user")
        ),
      });

      const aiTranslation = userTranslation ? null : await db.query.translations.findFirst({
        where: and(
          eq(translations.sentenceId, sentenceId),
          eq(translations.targetLanguage, baseLanguage),
          eq(translations.origin, "ai")
        ),
      });

      const translation = userTranslation || aiTranslation;

      // If no translation available, try to use sentence.target as fallback
      const meaning = translation?.text || sentence.target;

      // Skip if no meaning available for comprehension/production quiz
      if (!meaning) continue;

      // Get coaching hint if available
      const coachingMode = mode === "comprehension" ? "comprehension" : "composition";
      const coachingEntry = await db.query.coaching.findFirst({
        where: and(
          eq(coaching.sentenceId, sentenceId),
          eq(coaching.mode, coachingMode)
        ),
      });

      quizItems.push({
        id: sentenceId,
        original: sentence.source, // The learningLanguage text
        meaning: meaning, // The baseLanguage translation
        coachingHint: coachingEntry?.explanation || null,
        mode: mode as "comprehension" | "production",
      });
    }

    res.json({
      items: quizItems,
      notebook: { id: notebook.id, title: notebook.title },
      userLanguages: { baseLanguage, learningLanguage },
    });
  } catch (error) {
    console.error("[QUIZ] Error generating quiz:", error);
    res.status(500).json({ error: "Failed to generate quiz" });
  }
});

// POST /api/quiz/check - AI Answer Checker for Production Mode
router.post("/quiz/check", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sentenceId, userAnswer, expectedAnswer, mode } = req.body;
    const userId = req.userId!;

    if (!sentenceId || !userAnswer || !expectedAnswer) {
      return res.status(400).json({ error: "sentenceId, userAnswer, and expectedAnswer are required" });
    }

    // Get user's language settings for context
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { baseLanguage, learningLanguage } = user;

    // Use AI to check semantic equivalence
    const systemPrompt = `You are a language learning assistant. Check if the user's answer is semantically equivalent to the expected answer.
Rules:
- Focus on meaning, not exact wording
- Minor spelling or grammar differences are acceptable if the meaning is correct
- Be encouraging but accurate
- Respond ONLY with valid JSON, no other text

Output format (JSON only):
{"isCorrect": boolean, "feedback": "brief feedback in ${baseLanguage}"}`;

    const userPrompt = `Expected answer (in ${learningLanguage}): "${expectedAnswer}"
User's answer: "${userAnswer}"

Check if the user's answer conveys the same meaning as the expected answer.`;

    try {
      const content = await GeminiService.generateText(
        `${systemPrompt}\n\n${userPrompt}`,
        undefined,
        { maxTokens: 150, temperature: 0.1, plan: "starter", jsonMode: true, userId }
      );

      const result = JSON.parse(content || '{"isCorrect": false, "feedback": "Unable to check answer"}');

      await db.insert(quizResults).values({
        userId,
        sentenceId: parseInt(sentenceId),
        mode: mode || "production",
        userAnswer,
        isCorrect: result.isCorrect,
        userBaseLanguage: baseLanguage,
        userLearningLanguage: learningLanguage,
      });

      await updateMasteryProgress(userId, parseInt(sentenceId), result.isCorrect);

      res.json(result);
    } catch (aiError) {
      console.error("[QUIZ] AI check error:", aiError);
      res.status(500).json({ error: "Failed to check answer with AI" });
    }
  } catch (error) {
    console.error("[QUIZ] Error checking answer:", error);
    res.status(500).json({ error: "Failed to check answer" });
  }
});

// POST /api/quiz/submit - Submit quiz result (for Comprehension mode)
router.post("/quiz/submit", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sentenceId, userAnswer, isCorrect, mode } = req.body;
    const userId = req.userId!;

    if (sentenceId === undefined || isCorrect === undefined) {
      return res.status(400).json({ error: "sentenceId and isCorrect are required" });
    }

    // Get user's language settings
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Save quiz result
    await db.insert(quizResults).values({
      userId,
      sentenceId: parseInt(sentenceId),
      mode: mode || "comprehension",
      userAnswer: userAnswer || "",
      isCorrect,
      userBaseLanguage: user.baseLanguage,
      userLearningLanguage: user.learningLanguage,
    });

    // Update mastery tracking
    await updateMasteryProgress(userId, parseInt(sentenceId), isCorrect);

    res.json({ success: true });
  } catch (error) {
    console.error("[QUIZ] Error submitting result:", error);
    res.status(500).json({ error: "Failed to submit quiz result" });
  }
});

// Leitner SRS algorithm - calculate next review date based on mastery level
function calculateNextReviewDate(masteryLevel: number): Date {
  const now = new Date();
  // Leitner box intervals in days: Box 0=1day, Box 1=2days, Box 2=4days, Box 3=8days, Box 4=16days, Box 5=32days
  const intervals = [1, 2, 4, 8, 16, 32];
  const interval = intervals[Math.min(masteryLevel, 5)] || 1;
  now.setDate(now.getDate() + interval);
  return now;
}

// Helper function to update mastery progress with SRS
async function updateMasteryProgress(userId: number, sentenceId: number, isCorrect: boolean) {
  try {
    // Get or create user sentence state
    let state = await db.query.userSentenceState.findFirst({
      where: and(
        eq(userSentenceState.userId, userId),
        eq(userSentenceState.sentenceId, sentenceId)
      ),
    });

    const now = new Date();

    if (!state) {
      // Create new state
      const initialMastery = isCorrect ? 1 : 0;
      const nextReview = calculateNextReviewDate(initialMastery);
      
      await db.insert(userSentenceState).values({
        userId,
        sentenceId,
        isBookmarked: false,
        learningStatus: isCorrect ? "learning" : "new",
        masteryLevel: initialMastery,
        correctStreak: isCorrect ? 1 : 0,
        lastReviewedAt: now,
        lastPracticedAt: now,
        nextReviewDate: nextReview,
      });
    } else {
      // Update existing state with Leitner logic
      let newStreak = isCorrect ? (state.correctStreak || 0) + 1 : 0;
      let newMasteryLevel = state.masteryLevel || 0;
      let newLearningStatus = state.learningStatus;

      if (isCorrect) {
        // Move up one box (max 5)
        newMasteryLevel = Math.min((state.masteryLevel || 0) + 1, 5);
        if (newMasteryLevel >= 3) {
          newLearningStatus = "mastered";
        } else if (newMasteryLevel >= 1) {
          newLearningStatus = "learning";
        }
      } else {
        // Reset to box 0 on incorrect
        newMasteryLevel = 0;
        newStreak = 0;
        newLearningStatus = "new";
      }

      const nextReview = calculateNextReviewDate(newMasteryLevel);

      await db
        .update(userSentenceState)
        .set({
          correctStreak: newStreak,
          masteryLevel: newMasteryLevel,
          learningStatus: newLearningStatus,
          lastReviewedAt: now,
          lastPracticedAt: now,
          nextReviewDate: nextReview,
        })
        .where(
          and(
            eq(userSentenceState.userId, userId),
            eq(userSentenceState.sentenceId, sentenceId)
          )
        );
    }
  } catch (error) {
    console.error("[QUIZ] Error updating mastery progress:", error);
  }
}

// GET /api/quiz/stats?notebookId=... - Get quiz statistics for a notebook
router.get("/quiz/stats", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { notebookId } = req.query;
    const userId = req.userId!;

    if (!notebookId) {
      return res.status(400).json({ error: "notebookId is required" });
    }

    // Get all sentences in the notebook
    const notebookSentenceRows = await db
      .select({
        sentenceId: notebookSentences.sentenceId,
      })
      .from(notebookSentences)
      .where(eq(notebookSentences.notebookId, parseInt(notebookId as string)));

    const sentenceIds = notebookSentenceRows.map(row => row.sentenceId);
    
    if (sentenceIds.length === 0) {
      return res.json({
        total: 0,
        practiced: 0,
        mastered: 0,
        learning: 0,
        new: 0,
      });
    }

    // Get mastery states for these sentences
    let mastered = 0;
    let learning = 0;
    let practiced = 0;

    for (const sentenceId of sentenceIds) {
      const state = await db.query.userSentenceState.findFirst({
        where: and(
          eq(userSentenceState.userId, userId),
          eq(userSentenceState.sentenceId, sentenceId)
        ),
      });

      if (state) {
        if (state.masteryLevel === 2) {
          mastered++;
          practiced++;
        } else if (state.masteryLevel === 1) {
          learning++;
          practiced++;
        } else if (state.lastReviewedAt) {
          practiced++;
        }
      }
    }

    res.json({
      total: sentenceIds.length,
      practiced,
      mastered,
      learning,
      new: sentenceIds.length - practiced,
    });
  } catch (error) {
    console.error("[QUIZ] Error getting stats:", error);
    res.status(500).json({ error: "Failed to get quiz stats" });
  }
});

// Helper function to get HIGHLIGHT sentence IDs from a notebook (excludes user notes)
// Highlights are identified by notes.content IS NULL
async function getNotebookHighlightSentenceIds(notebookId: number, userId: number): Promise<number[]> {
  const noteLinks = await db
    .select({ noteId: noteNotebooks.noteId })
    .from(noteNotebooks)
    .where(and(
      eq(noteNotebooks.notebookId, notebookId),
      eq(noteNotebooks.userId, userId)
    ));

  if (noteLinks.length === 0) return [];

  const sentenceIds: number[] = [];
  for (const link of noteLinks) {
    const note = await db.query.notes.findFirst({
      where: and(
        eq(notes.id, link.noteId),
        eq(notes.userId, userId),
        isNull(notes.content) // HIGHLIGHT-ONLY: content is null
      ),
    });
    if (note && note.sentenceId) {
      sentenceIds.push(note.sentenceId);
    }
  }

  return Array.from(new Set(sentenceIds));
}

// Legacy helper - kept for backward compatibility but renamed
async function getNotebookSentenceIds(notebookId: number, userId: number): Promise<number[]> {
  return getNotebookHighlightSentenceIds(notebookId, userId);
}

// GET /api/quiz/notebooks - Get all notebooks with quiz stats
router.get("/quiz/notebooks", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;

    // Get all user's notebook groups
    const userGroups = await db.query.notebookGroups.findMany({
      where: eq(notebookGroups.userId, userId),
      orderBy: [asc(notebookGroups.order)],
    });

    // Get all user's notebooks
    const userNotebooks = await db.query.notebooks.findMany({
      where: eq(notebooks.userId, userId),
      orderBy: [desc(notebooks.updatedAt)],
    });

    const notebooksWithStats = await Promise.all(
      userNotebooks.map(async (notebook) => {
        // Get sentence IDs via noteNotebooks -> notes relationship
        const sentenceIds = await getNotebookSentenceIds(notebook.id, userId);

        let mastered = 0;
        let practiced = 0;

        for (const sentenceId of sentenceIds) {
          const state = await db.query.userSentenceState.findFirst({
            where: and(
              eq(userSentenceState.userId, userId),
              eq(userSentenceState.sentenceId, sentenceId)
            ),
          });

          if (state) {
            if (state.masteryLevel === 2) {
              mastered++;
              practiced++;
            } else if (state.masteryLevel === 1 || state.lastReviewedAt) {
              practiced++;
            }
          }
        }

        // Find group name if notebook belongs to a group
        const group = notebook.groupId 
          ? userGroups.find(g => g.id === notebook.groupId)
          : null;

        return {
          id: notebook.id,
          title: notebook.title,
          description: notebook.description,
          language: notebook.language,
          totalSentences: sentenceIds.length,
          practiced,
          mastered,
          colorLabel: notebook.colorLabel,
          groupId: notebook.groupId,
          groupName: group?.name || null,
          updatedAt: notebook.updatedAt,
        };
      })
    );

    // Filter out notebooks with no sentences
    const notebooksWithSentences = notebooksWithStats.filter(n => n.totalSentences > 0);

    // Return groups list for filter chips
    const groups = userGroups.map(g => ({ id: g.id, name: g.name, color: g.color }));

    res.json({ notebooks: notebooksWithSentences, groups });
  } catch (error) {
    console.error("[QUIZ] Error getting notebooks:", error);
    res.status(500).json({ error: "Failed to get notebooks" });
  }
});

// POST /api/quiz/commit-translations - Hard-commit translation edits to sentences.target
router.post("/quiz/commit-translations", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { edits } = req.body;
    const userId = req.userId!;

    if (!edits || !Array.isArray(edits)) {
      return res.status(400).json({ error: "edits array is required" });
    }

    // Validate edits structure: [{ sentenceId, newTranslation }]
    const validEdits = edits.filter(
      (edit: any) => edit.sentenceId && typeof edit.newTranslation === "string"
    );

    if (validEdits.length === 0) {
      return res.status(400).json({ error: "No valid edits provided" });
    }

    // Update sentences.target for each edit (only translation field is editable)
    const results = [];
    for (const edit of validEdits) {
      try {
        await db
          .update(sentences)
          .set({ target: edit.newTranslation })
          .where(eq(sentences.id, edit.sentenceId));
        results.push({ sentenceId: edit.sentenceId, success: true });
      } catch (err) {
        console.error(`[QUIZ] Failed to commit translation for sentence ${edit.sentenceId}:`, err);
        results.push({ sentenceId: edit.sentenceId, success: false });
      }
    }

    const successCount = results.filter(r => r.success).length;
    console.log(`[QUIZ] Committed ${successCount}/${validEdits.length} translation edits for user ${userId}`);

    res.json({ 
      success: true, 
      committed: successCount, 
      total: validEdits.length,
      results 
    });
  } catch (error) {
    console.error("[QUIZ] Error committing translations:", error);
    res.status(500).json({ error: "Failed to commit translations" });
  }
});

// POST /api/quiz/ai-diff - AI feedback for Level 3 Full Typing
router.post("/quiz/ai-diff", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { userAnswer, correctAnswer, direction } = req.body;
    const userId = req.userId!;

    if (!userAnswer || !correctAnswer) {
      return res.status(400).json({ error: "userAnswer and correctAnswer are required" });
    }

    // Get user's language settings for context
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { baseLanguage, learningLanguage } = user;
    const feedbackLang = baseLanguage === "ko" ? "Korean" : "English";
    const computedDirection = direction || `${learningLanguage}-${baseLanguage}`;
    const targetLangCode = computedDirection.split("-")[1] || baseLanguage;
    const targetLang = targetLangCode === "ko" ? "Korean" : "English";

    const systemPrompt = `You are a language learning assistant providing constructive feedback on translation attempts.
Compare the user's translation with the expected answer and provide:
1. Whether the meaning is correct (isCorrect: boolean)
2. Detailed feedback on any differences in meaning, nuance, or grammar
3. Suggestions for improvement if needed

Respond in ${feedbackLang}. Be encouraging but accurate.
Output format (JSON only):
{
  "isCorrect": boolean,
  "feedback": "detailed feedback text",
  "suggestions": ["suggestion1", "suggestion2"]
}`;

    const userPrompt = `Target language: ${targetLang}
Expected answer: "${correctAnswer}"
User's answer: "${userAnswer}"

Analyze the semantic accuracy and provide feedback.`;

    try {
      const content = await GeminiService.generateText(
        `${systemPrompt}\n\n${userPrompt}`,
        undefined,
        { maxTokens: 300, temperature: 0.3, plan: "starter", jsonMode: true, userId }
      );

      const result = JSON.parse(content || '{"isCorrect": false, "feedback": "분석 실패", "suggestions": []}');

      res.json(result);
    } catch (aiError) {
      console.error("[QUIZ] AI diff error:", aiError);
      res.status(500).json({ error: "Failed to analyze with AI" });
    }
  } catch (error) {
    console.error("[QUIZ] Error in AI diff:", error);
    res.status(500).json({ error: "Failed to process AI diff request" });
  }
});

// GET /api/quiz/sentences/:notebookId - Get sentences for practice with SRS info
router.get("/quiz/sentences/:notebookId", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { notebookId } = req.params;
    const userId = req.userId!;
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    const defaultDirection = `${user?.learningLanguage || "en"}-${user?.baseLanguage || "ko"}`;
    const { direction = defaultDirection } = req.query;

    if (!notebookId) {
      return res.status(400).json({ error: "notebookId is required" });
    }

    // Verify notebook belongs to user
    const notebook = await db.query.notebooks.findFirst({
      where: and(
        eq(notebooks.id, parseInt(notebookId)),
        eq(notebooks.userId, userId)
      ),
    });

    if (!notebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }

    // Get all sentences in the notebook via noteNotebooks -> notes
    const sentenceIds = await getNotebookSentenceIds(parseInt(notebookId), userId);

    if (sentenceIds.length === 0) {
      return res.json({ sentences: [], notebook: { id: notebook.id, title: notebook.title } });
    }

    // Fetch sentences with their mastery state
    const practiceItems = [];

    for (const sentenceId of sentenceIds) {
      const sentence = await db.query.sentences.findFirst({
        where: eq(sentences.id, sentenceId),
      });

      if (!sentence) continue;

      // Get user's mastery state for this sentence
      const state = await db.query.userSentenceState.findFirst({
        where: and(
          eq(userSentenceState.userId, userId),
          eq(userSentenceState.sentenceId, sentenceId)
        ),
      });

      practiceItems.push({
        id: sentence.id,
        type: "sentence" as const,
        source: sentence.source, // Original English text (immutable)
        target: sentence.target, // Korean translation (editable)
        masteryLevel: state?.masteryLevel || 0,
        nextReviewDate: state?.nextReviewDate || null,
        lastReviewedAt: state?.lastReviewedAt || null,
        direction: direction as string,
      });
    }

    // Sort by nextReviewDate (due items first) and masteryLevel (lower first)
    practiceItems.sort((a, b) => {
      // Items due for review come first
      const now = new Date();
      const aDue = a.nextReviewDate ? new Date(a.nextReviewDate) <= now : true;
      const bDue = b.nextReviewDate ? new Date(b.nextReviewDate) <= now : true;
      
      if (aDue !== bDue) return aDue ? -1 : 1;
      
      // Then by mastery level (lower first)
      return (a.masteryLevel || 0) - (b.masteryLevel || 0);
    });

    res.json({
      sentences: practiceItems,
      notebook: { id: notebook.id, title: notebook.title },
      direction,
    });
  } catch (error) {
    console.error("[QUIZ] Error fetching practice sentences:", error);
    res.status(500).json({ error: "Failed to fetch practice sentences" });
  }
});

// GET /api/quiz/multi-notebook - Get sentences from multiple notebooks for practice
router.get("/quiz/multi-notebook", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    const defaultDirection = `${user?.learningLanguage || "en"}-${user?.baseLanguage || "ko"}`;
    const { notebookIds, direction = defaultDirection } = req.query;

    if (!notebookIds || typeof notebookIds !== 'string') {
      return res.status(400).json({ error: "notebookIds query parameter is required (comma-separated)" });
    }

    const notebookIdList = notebookIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));

    if (notebookIdList.length === 0) {
      return res.status(400).json({ error: "No valid notebook IDs provided" });
    }

    // Verify all notebooks belong to user and collect their titles
    const userNotebooks = await db.query.notebooks.findMany({
      where: and(
        inArray(notebooks.id, notebookIdList),
        eq(notebooks.userId, userId)
      ),
    });

    if (userNotebooks.length === 0) {
      return res.status(404).json({ error: "No notebooks found" });
    }

    // Get all sentence IDs from all selected notebooks
    const allSentenceIds = new Set<number>();
    for (const notebook of userNotebooks) {
      const sentenceIds = await getNotebookSentenceIds(notebook.id, userId);
      sentenceIds.forEach(id => allSentenceIds.add(id));
    }

    if (allSentenceIds.size === 0) {
      return res.json({ 
        sentences: [], 
        notebooks: userNotebooks.map(n => ({ id: n.id, title: n.title })),
        totalNotebooks: userNotebooks.length,
      });
    }

    // Fetch sentences with their mastery state
    const practiceItems = [];

    for (const sentenceId of Array.from(allSentenceIds)) {
      const sentence = await db.query.sentences.findFirst({
        where: eq(sentences.id, sentenceId),
      });

      if (!sentence) continue;

      // Get user's mastery state for this sentence
      const state = await db.query.userSentenceState.findFirst({
        where: and(
          eq(userSentenceState.userId, userId),
          eq(userSentenceState.sentenceId, sentenceId)
        ),
      });

      practiceItems.push({
        id: sentence.id,
        type: "sentence" as const,
        source: sentence.source,
        target: sentence.target,
        masteryLevel: state?.masteryLevel || 0,
        nextReviewDate: state?.nextReviewDate || null,
        lastReviewedAt: state?.lastReviewedAt || null,
        direction: direction as string,
      });
    }

    // Sort by nextReviewDate (due items first) and masteryLevel (lower first)
    practiceItems.sort((a, b) => {
      const now = new Date();
      const aDue = a.nextReviewDate ? new Date(a.nextReviewDate) <= now : true;
      const bDue = b.nextReviewDate ? new Date(b.nextReviewDate) <= now : true;
      
      if (aDue !== bDue) return aDue ? -1 : 1;
      return (a.masteryLevel || 0) - (b.masteryLevel || 0);
    });

    // Limit to reasonable session size (e.g., 10 items)
    const MAX_SESSION_SIZE = 10;
    const sessionItems = practiceItems.slice(0, MAX_SESSION_SIZE);

    res.json({
      sentences: sessionItems,
      notebooks: userNotebooks.map(n => ({ id: n.id, title: n.title })),
      totalNotebooks: userNotebooks.length,
      totalSentences: practiceItems.length,
      direction,
    });
  } catch (error) {
    console.error("[QUIZ] Error fetching multi-notebook sentences:", error);
    res.status(500).json({ error: "Failed to fetch multi-notebook sentences" });
  }
});

// GET /api/quiz/vocabulary - Vocabulary Master: Learning→Native direction quiz
// Shows term (learning language), user selects correct translation (native language)
// Supports freeReview=true query param to skip SRS date filtering (practice all terms)
router.get("/quiz/vocabulary", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const now = new Date();
    const MIN_ITEMS_REQUIRED = 3;
    const MAX_SESSION_SIZE = 7;
    const FREE_REVIEW_SESSION_SIZE = 10;
    
    // Free Review mode: practice all terms regardless of nextReviewDate
    const isFreeReview = req.query.freeReview === "true";

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { baseLanguage, learningLanguage } = user;

    const allGlossary = await db
      .select()
      .from(glossary)
      .where(eq(glossary.userId, userId));

    console.log(`[VOCABULARY] User ${userId} has ${allGlossary.length} total vocabulary items (freeReview: ${isFreeReview})`);

    if (allGlossary.length < MIN_ITEMS_REQUIRED) {
      return res.json({
        items: [],
        total: 0,
        totalAvailable: allGlossary.length,
        insufficientItems: true,
        minRequired: MIN_ITEMS_REQUIRED,
        userLanguages: { base: baseLanguage, learning: learningLanguage },
      });
    }

    let itemsToReview: typeof allGlossary;
    
    if (isFreeReview) {
      // Free Review mode: use all terms regardless of due date
      itemsToReview = allGlossary;
      console.log(`[VOCABULARY] Free Review mode - using all ${allGlossary.length} items`);
    } else {
      // Standard mode: filter by due date
      const dueItems: typeof allGlossary = [];
      for (const term of allGlossary) {
        const state = await db.query.userGlossaryState.findFirst({
          where: and(
            eq(userGlossaryState.userId, userId),
            eq(userGlossaryState.glossaryId, term.id)
          ),
        });
        const isDue = !state || !state.nextReviewDate || state.nextReviewDate <= now;
        if (isDue) dueItems.push(term);
      }

      console.log(`[VOCABULARY] Due items: ${dueItems.length}`);

      if (dueItems.length === 0) {
        return res.json({
          items: [],
          total: 0,
          totalAvailable: allGlossary.length,
          noDueItems: true,
          userLanguages: { base: baseLanguage, learning: learningLanguage },
        });
      }
      
      itemsToReview = dueItems;
    }

    const maxSize = isFreeReview ? FREE_REVIEW_SESSION_SIZE : MAX_SESSION_SIZE;
    const sessionLimit = itemsToReview.length <= maxSize ? itemsToReview.length : maxSize;
    const shuffled = itemsToReview.sort(() => Math.random() - 0.5).slice(0, sessionLimit);

    const items = await Promise.all(
      shuffled.map(async (term) => {
        const state = await db.query.userGlossaryState.findFirst({
          where: and(
            eq(userGlossaryState.userId, userId),
            eq(userGlossaryState.glossaryId, term.id)
          ),
        });
        
        let quizType: 1 | 2 | 3;
        const masteryLevel = state?.masteryLevel || 0;
        if (masteryLevel === 0) quizType = 1;
        else if (masteryLevel === 1) quizType = 2;
        else quizType = 3;

        if (!term.translation) return null;

        // Randomly assign quiz format: flashcard (reveal answer) or fill-in-blank (type answer)
        // Higher mastery = more likely to get fill-in-blank
        const fibProbability = masteryLevel === 0 ? 0.3 : masteryLevel === 1 ? 0.5 : 0.7;
        const quizFormat = Math.random() < fibProbability ? "fill-in-blank" : "flashcard";
        
        return {
          id: term.id,
          type: "glossary" as const,
          quizType,
          quizFormat,
          masteryLevel,
          hint: term.term,
          hintLanguage: learningLanguage,
          expectedAnswer: term.translation,
          answerLanguage: baseLanguage,
          term: term.term,
          definition: term.definition,
          translation: term.translation,
          contextSentence: term.contextSentence,
        };
      })
    );

    const validItems = items.filter((i): i is NonNullable<typeof i> => i !== null);
    
    res.json({
      items: validItems,
      total: itemsToReview.length,
      totalAvailable: allGlossary.length,
      sessionSize: validItems.length,
      isFreeReview,
      userLanguages: { base: baseLanguage, learning: learningLanguage },
    });
  } catch (error) {
    console.error("[VOCABULARY] Error getting vocabulary items:", error);
    res.status(500).json({ error: "Failed to get vocabulary items" });
  }
});

// GET /api/quiz/vocabulary-stats - Lightweight stats for PracticeHub
router.get("/quiz/vocabulary-stats", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    
    const allGlossary = await db
      .select({ id: glossary.id })
      .from(glossary)
      .where(eq(glossary.userId, userId));

    res.json({
      total: allGlossary.length,
    });
  } catch (error) {
    console.error("[VOCABULARY-STATS] Error:", error);
    res.status(500).json({ error: "Failed to get vocabulary stats" });
  }
});

// GET /api/quiz/glossary-items - Legacy endpoint (kept for backward compatibility)
router.get("/quiz/glossary-items", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { limit = 20 } = req.query;

    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    
    const { baseLanguage = "ko", learningLanguage = "en" } = user || {};

    const glossaryItems = await db
      .select()
      .from(glossary)
      .where(eq(glossary.userId, userId))
      .limit(parseInt(limit as string));

    const itemsWithState = await Promise.all(
      glossaryItems.map(async (term) => {
        const state = await db.query.userGlossaryState.findFirst({
          where: and(
            eq(userGlossaryState.userId, userId),
            eq(userGlossaryState.glossaryId, term.id)
          ),
        });
        
        const masteryLevel = state?.masteryLevel || 0;
        let quizType: 1 | 2 | 3;
        if (masteryLevel === 0) quizType = 1;
        else if (masteryLevel === 1) quizType = 2;
        else quizType = 3;
        
        const fibProbability = masteryLevel === 0 ? 0.3 : masteryLevel === 1 ? 0.5 : 0.7;
        const quizFormat = Math.random() < fibProbability ? "fill-in-blank" : "flashcard";
        
        return {
          id: term.id,
          type: "glossary" as const,
          quizType,
          quizFormat,
          masteryLevel,
          nextReviewDate: state?.nextReviewDate || null,
          hint: term.term,
          hintLanguage: learningLanguage,
          expectedAnswer: term.translation || term.definition || "",
          answerLanguage: baseLanguage,
          term: term.term,
          definition: term.definition,
          translation: term.translation,
          contextSentence: term.contextSentence,
        };
      })
    );

    const validItems = itemsWithState.filter(item => item.expectedAnswer);
    const shuffled = validItems.sort(() => Math.random() - 0.5);

    res.json({
      items: shuffled,
      total: validItems.length,
    });
  } catch (error) {
    console.error("[QUIZ] Error getting glossary items:", error);
    res.status(500).json({ error: "Failed to get glossary items" });
  }
});

// GET /api/quiz/smart-review - Modern Zen: Simplified N-item payload with random quiz types
router.get("/quiz/smart-review", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { limit = 5 } = req.query; // Default 5 questions per session
    const now = new Date();
    const limitNum = Math.min(parseInt(limit as string), 20);

    // Get user's language settings for personalized direction
    const user = await db.query.users.findFirst({
      where: eq(users.id, userId),
    });
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const { baseLanguage, learningLanguage } = user;
    console.log(`[SMART-REVIEW] User ${userId} languages: base=${baseLanguage}, learning=${learningLanguage}`);

    // Collect all eligible practice items
    const allItems: Array<{
      id: number;
      type: "sentence" | "glossary";
      masteryLevel: number;
      source: string | null;
      target: string | null;
      term?: string;
      definition?: string | null;
      translation?: string | null;
      contextSentence?: string | null;
    }> = [];

    // 1. Get sentences from user's notebooks
    const userNotebooks = await db.query.notebooks.findMany({
      where: eq(notebooks.userId, userId),
    });
    
    console.log(`[SMART-REVIEW] Found ${userNotebooks.length} user notebooks`);

    const sentenceIds = new Set<number>();
    
    for (const notebook of userNotebooks) {
      const notebookSentenceIds = await getNotebookSentenceIds(notebook.id, userId);
      console.log(`[SMART-REVIEW] Notebook "${notebook.title}" has ${notebookSentenceIds.length} sentences`);
      notebookSentenceIds.forEach(id => sentenceIds.add(id));
    }

    // Get sentence data and mastery state
    for (const sentenceId of Array.from(sentenceIds)) {
      const sentence = await db.query.sentences.findFirst({
        where: eq(sentences.id, sentenceId),
      });
      
      if (!sentence) continue;

      const state = await db.query.userSentenceState.findFirst({
        where: and(
          eq(userSentenceState.userId, userId),
          eq(userSentenceState.sentenceId, sentenceId)
        ),
      });

      // Include if: no state yet, or due for review
      const isDue = !state || !state.nextReviewDate || state.nextReviewDate <= now;
      if (isDue) {
        allItems.push({
          id: sentence.id,
          type: "sentence",
          masteryLevel: state?.masteryLevel || 0,
          source: sentence.source,
          target: sentence.target,
        });
      }
    }

    // 2. Get glossary items
    const userGlossary = await db.query.glossary.findMany({
      where: eq(glossary.userId, userId),
    });

    for (const term of userGlossary) {
      const state = await db.query.userGlossaryState.findFirst({
        where: and(
          eq(userGlossaryState.userId, userId),
          eq(userGlossaryState.glossaryId, term.id)
        ),
      });

      const isDue = !state || !state.nextReviewDate || state.nextReviewDate <= now;
      if (isDue) {
        allItems.push({
          id: term.id,
          type: "glossary",
          masteryLevel: state?.masteryLevel || 0,
          source: term.term,
          target: term.translation,
          term: term.term,
          definition: term.definition,
          translation: term.translation,
          contextSentence: term.contextSentence,
        });
      }
    }

    // Count total available items (including not-yet-due items) for minimum check
    const totalSavedSentences = Array.from(sentenceIds).length;
    const totalGlossaryTerms = userGlossary.length;
    const totalAvailable = totalSavedSentences + totalGlossaryTerms;
    
    console.log(`[SMART-REVIEW] Total available: ${totalAvailable} (sentences: ${totalSavedSentences}, glossary: ${totalGlossaryTerms})`);
    console.log(`[SMART-REVIEW] Total eligible (due) items: ${allItems.length}`);

    // Check minimum items requirement based on TOTAL saved content (not just due items)
    const MIN_ITEMS_REQUIRED = 3;
    const MAX_SESSION_SIZE = 7;
    
    if (totalAvailable < MIN_ITEMS_REQUIRED) {
      console.log(`[SMART-REVIEW] Insufficient saved items: ${totalAvailable} < ${MIN_ITEMS_REQUIRED}`);
      return res.json({
        items: [],
        total: allItems.length,
        totalAvailable,
        sessionSize: 0,
        insufficientItems: true,
        minRequired: MIN_ITEMS_REQUIRED,
        userLanguages: {
          base: baseLanguage,
          learning: learningLanguage,
        },
      });
    }
    
    // If user has enough saved content but no items are due, return special status
    if (allItems.length === 0) {
      console.log(`[SMART-REVIEW] No items due for review, but user has ${totalAvailable} saved items`);
      return res.json({
        items: [],
        total: 0,
        totalAvailable,
        sessionSize: 0,
        noDueItems: true,
        userLanguages: {
          base: baseLanguage,
          learning: learningLanguage,
        },
      });
    }

    // Variable count logic: 3-7 items = use all, 7+ items = random 7
    const sessionLimit = allItems.length <= MAX_SESSION_SIZE ? allItems.length : MAX_SESSION_SIZE;
    const shuffled = allItems.sort(() => Math.random() - 0.5).slice(0, sessionLimit);

    // Assign quiz type (L1, L2, L3) based on mastery level - more deterministic
    const items = shuffled.map(item => {
      // Determine quiz type based on mastery level
      let quizType: 1 | 2 | 3;
      if (item.masteryLevel === 0) {
        // New items: always L1 (word bank) for gentle introduction
        quizType = 1;
      } else if (item.masteryLevel === 1) {
        // Learning items: L2 (partial fill)
        quizType = 2;
      } else {
        // Mastered items: L3 (full production)
        quizType = 3;
      }

      // For glossary items, determine quiz format (fill-in-blank vs flashcard)
      const fibProbability = item.masteryLevel === 0 ? 0.3 : item.masteryLevel === 1 ? 0.5 : 0.7;
      const quizFormat = item.type === "glossary" 
        ? (Math.random() < fibProbability ? "fill-in-blank" : "flashcard")
        : undefined;

      // For sentences: hint is in baseLanguage (target/translation), answer is in learningLanguage (source)
      // For glossary: hint is definition/translation, answer is the term
      let hint: string;
      let answer: string;
      
      if (item.type === "sentence") {
        // Sentence: hint = Korean translation (target), answer = English original (source)
        hint = item.target || "";
        answer = item.source || "";
        
        // Skip items without proper translations
        if (!hint || !answer) {
          return null;
        }
      } else {
        // Glossary: hint = translation/definition, answer = term
        hint = item.translation || item.definition || "";
        answer = item.term || "";
        
        if (!hint || !answer) {
          return null;
        }
      }

      return {
        id: item.id,
        type: item.type,
        quizType,
        quizFormat,
        masteryLevel: item.masteryLevel,
        hint,
        hintLanguage: baseLanguage,
        expectedAnswer: answer,
        answerLanguage: learningLanguage,
        source: item.source,
        target: item.target,
        term: item.term,
        definition: item.definition,
        translation: item.translation,
        contextSentence: item.contextSentence || null,
      };
    }).filter(Boolean);

    console.log(`[SMART-REVIEW] Returning ${items.length} items`);

    res.json({
      items,
      total: allItems.length,
      sessionSize: items.length,
      userLanguages: {
        base: baseLanguage,
        learning: learningLanguage,
      },
    });
  } catch (error) {
    console.error("[QUIZ] Error getting smart review:", error);
    res.status(500).json({ error: "Failed to get smart review items" });
  }
});

// POST /api/quiz/submit-glossary - Submit glossary quiz result with self-rating
router.post("/quiz/submit-glossary", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { glossaryId, rating } = req.body;
    const userId = req.userId!;

    if (!glossaryId || !rating) {
      return res.status(400).json({ error: "glossaryId and rating are required" });
    }

    if (!["again", "hard", "good"].includes(rating)) {
      return res.status(400).json({ error: "rating must be 'again', 'hard', or 'good'" });
    }

    // Get or create user glossary state
    let state = await db.query.userGlossaryState.findFirst({
      where: and(
        eq(userGlossaryState.userId, userId),
        eq(userGlossaryState.glossaryId, glossaryId)
      ),
    });

    const now = new Date();
    let newMasteryLevel = 0;
    let newStreak = 0;
    let isCorrect = false;

    // Calculate new mastery based on rating (Leitner-inspired)
    if (rating === "again") {
      newMasteryLevel = 0;
      newStreak = 0;
      isCorrect = false;
    } else if (rating === "hard") {
      newMasteryLevel = state ? Math.max(0, (state.masteryLevel || 0)) : 1;
      newStreak = 0;
      isCorrect = true;
    } else if (rating === "good") {
      newMasteryLevel = state ? Math.min((state.masteryLevel || 0) + 1, 5) : 1;
      newStreak = state ? (state.correctStreak || 0) + 1 : 1;
      isCorrect = true;
    }

    // Calculate next review date using Leitner intervals
    const intervals = [1, 2, 4, 8, 16, 32]; // days
    const interval = intervals[Math.min(newMasteryLevel, 5)] || 1;
    const nextReview = new Date(now);
    nextReview.setDate(nextReview.getDate() + interval);

    if (!state) {
      // Create new state
      await db.insert(userGlossaryState).values({
        userId,
        glossaryId,
        masteryLevel: newMasteryLevel,
        correctStreak: newStreak,
        lastReviewedAt: now,
        nextReviewDate: nextReview,
        lastRating: rating,
        totalReviews: 1,
        correctCount: isCorrect ? 1 : 0,
        incorrectCount: isCorrect ? 0 : 1,
      });
    } else {
      // Update existing state
      await db
        .update(userGlossaryState)
        .set({
          masteryLevel: newMasteryLevel,
          correctStreak: newStreak,
          lastReviewedAt: now,
          nextReviewDate: nextReview,
          lastRating: rating,
          totalReviews: (state.totalReviews || 0) + 1,
          correctCount: (state.correctCount || 0) + (isCorrect ? 1 : 0),
          incorrectCount: (state.incorrectCount || 0) + (isCorrect ? 0 : 1),
          updatedAt: now,
        })
        .where(
          and(
            eq(userGlossaryState.userId, userId),
            eq(userGlossaryState.glossaryId, glossaryId)
          )
        );
    }

    res.json({
      success: true,
      masteryLevel: newMasteryLevel,
      nextReviewDate: nextReview,
    });
  } catch (error) {
    console.error("[QUIZ] Error submitting glossary result:", error);
    res.status(500).json({ error: "Failed to submit glossary result" });
  }
});

// POST /api/quiz/commit-glossary - Hard-commit glossary edits
router.post("/quiz/commit-glossary", adminOnlyQuiz, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { edits } = req.body;
    const userId = req.userId!;

    if (!edits || !Array.isArray(edits)) {
      return res.status(400).json({ error: "edits array is required" });
    }

    const results = [];
    for (const edit of edits) {
      if (!edit.glossaryId) continue;
      
      try {
        const updateData: any = {};
        if (edit.definition !== undefined) updateData.definition = edit.definition;
        if (edit.translation !== undefined) updateData.translation = edit.translation;
        
        if (Object.keys(updateData).length > 0) {
          await db
            .update(glossary)
            .set(updateData)
            .where(and(
              eq(glossary.id, edit.glossaryId),
              eq(glossary.userId, userId)
            ));
          results.push({ glossaryId: edit.glossaryId, success: true });
        }
      } catch (err) {
        console.error(`[QUIZ] Failed to commit glossary edit for ${edit.glossaryId}:`, err);
        results.push({ glossaryId: edit.glossaryId, success: false });
      }
    }

    const successCount = results.filter(r => r.success).length;
    res.json({ success: true, committed: successCount, total: edits.length, results });
  } catch (error) {
    console.error("[QUIZ] Error committing glossary edits:", error);
    res.status(500).json({ error: "Failed to commit glossary edits" });
  }
});

router.get("/practice/due-count", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const now = new Date();
    const { sql, count } = await import("drizzle-orm");

    const sentencesDue = await db.select({ cnt: count() })
      .from(userSentenceState)
      .where(and(
        eq(userSentenceState.userId, userId),
        or(
          isNull(userSentenceState.nextReviewDate),
          lte(userSentenceState.nextReviewDate, now)
        )
      ));

    const glossaryDue = await db.select({ cnt: count() })
      .from(userGlossaryState)
      .where(and(
        eq(userGlossaryState.userId, userId),
        or(
          isNull(userGlossaryState.nextReviewDate),
          lte(userGlossaryState.nextReviewDate, now)
        )
      ));

    const total = (sentencesDue[0]?.cnt || 0) + (glossaryDue[0]?.cnt || 0);
    res.json({ total });
  } catch (error) {
    console.error("[PRACTICE] Error fetching due count:", error);
    res.json({ total: 0 });
  }
});

export default router;
