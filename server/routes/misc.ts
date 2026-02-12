import { Router, Request, Response } from "express";
import { storage } from "../storage.js";
import { authenticateJWT, AuthenticatedRequest } from "../auth.js";
import { db } from "../db.js";
import { glossary, sentences, documents, notes, paragraphs } from "@shared/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { GeminiService } from "../services/GeminiService.js";

const router = Router();

// Get today's featured sentence for the hero section
router.get("/today-sentence", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    
    if (!userId) {
      return res.json(null);
    }

    // Get a random highlighted sentence from user's notes (sentences they've engaged with)
    // Join: notes → sentences → paragraphs → documents
    const userNotes = await db
      .select({
        sentenceId: notes.sentenceId,
        sentenceText: sentences.source,
        translation: sentences.target,
        documentId: paragraphs.documentId,
        documentTitle: documents.title,
        documentSource: documents.source,
      })
      .from(notes)
      .innerJoin(sentences, eq(notes.sentenceId, sentences.id))
      .innerJoin(paragraphs, eq(sentences.paragraphId, paragraphs.id))
      .innerJoin(documents, eq(paragraphs.documentId, documents.id))
      .where(
        and(
          eq(notes.userId, userId),
          isNotNull(sentences.source)
        )
      )
      .orderBy(sql`RANDOM()`)
      .limit(1);

    if (userNotes.length > 0) {
      const note = userNotes[0];
      return res.json({
        id: note.sentenceId,
        text: note.sentenceText,
        translation: note.translation,
        source: note.documentSource || note.documentTitle,
        documentId: note.documentId,
        documentTitle: note.documentTitle,
      });
    }

    // Fallback: Get a random sentence from user's documents
    // Join: sentences → paragraphs → documents
    const userSentences = await db
      .select({
        sentenceId: sentences.id,
        sentenceText: sentences.source,
        translation: sentences.target,
        documentId: paragraphs.documentId,
        documentTitle: documents.title,
        documentSource: documents.source,
      })
      .from(sentences)
      .innerJoin(paragraphs, eq(sentences.paragraphId, paragraphs.id))
      .innerJoin(documents, eq(paragraphs.documentId, documents.id))
      .where(
        and(
          eq(documents.userId, userId),
          isNotNull(sentences.source)
        )
      )
      .orderBy(sql`RANDOM()`)
      .limit(1);

    if (userSentences.length > 0) {
      const sentence = userSentences[0];
      return res.json({
        id: sentence.sentenceId,
        text: sentence.sentenceText,
        translation: sentence.translation,
        source: sentence.documentSource || sentence.documentTitle,
        documentId: sentence.documentId,
        documentTitle: sentence.documentTitle,
      });
    }

    // No sentences found
    return res.json(null);
  } catch (error) {
    console.error("Error fetching today's sentence:", error);
    return res.json(null);
  }
});

// Miscellaneous routes will be moved here from main routes.ts
// This file will contain:
// - GET /api/health  
// - POST /api/translate
// - POST /api/translate/batch
// - POST /api/feedback/evaluate-translation
// - POST /api/feedback/back-translate
// - GET /api/glossary
// - POST /api/glossary
// - PUT /api/glossary/:id
// - DELETE /api/glossary/:id
// - POST /api/glossary/generate
// - GET /api/glossary/stats
// - GET /api/glossary/practice-words
// - POST /api/glossary/practice
// - POST /api/glossary/generate-quiz
// - GET /api/notebooks
// - POST /api/notebooks
// - GET /api/notebooks/:id/sentences
// - PUT /api/notebooks/:id
// - DELETE /api/notebooks/:id
// - DELETE /api/notebooks/:notebookId/sentences/:sentenceId
// - POST /api/notebooks/:id/refresh
// - POST /api/review/:id
// - GET /api/thumbnails/:filename

// Get all glossary terms for authenticated user with document titles
router.get("/glossary", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    console.log(`[GLOSSARY API] Fetching glossary for userId: ${userId}`);

    const glossaryEntries = await db
      .select({
        id: glossary.id,
        userId: glossary.userId,
        term: glossary.term,
        definition: glossary.definition,
        translation: glossary.translation,
        pronunciation: glossary.pronunciation,
        difficulty: glossary.difficulty,
        sourceLanguage: glossary.sourceLanguage,
        targetLanguage: glossary.targetLanguage,
        contextSentence: glossary.contextSentence,
        documentId: glossary.documentId,
        sentenceId: glossary.sentenceId,
        notes: glossary.notes,
        tags: glossary.tags,
        createdAt: glossary.createdAt,
        lastReviewed: glossary.lastReviewed,
        reviewCount: glossary.reviewCount,
        masteryLevel: glossary.masteryLevel,
        correctCount: glossary.correctCount,
        incorrectCount: glossary.incorrectCount,
        nextReviewDate: glossary.nextReviewDate,
        documentTitle: documents.title,
      })
      .from(glossary)
      .leftJoin(documents, eq(glossary.documentId, documents.id))
      .where(eq(glossary.userId, userId));
    
    console.log(`[GLOSSARY API] Found ${glossaryEntries.length} terms for user ${userId}`);

    res.json(glossaryEntries);
  } catch (error) {
    console.error('Error fetching glossary:', error);
    res.status(500).json({ error: 'Failed to fetch glossary entries' });
  }
});

// Generate glossary definition using AI
router.post("/glossary/generate", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const {
      term,
      contextSentence,
      sourceLanguage = "English",
      targetLanguage = "Korean",
    } = req.body;

    if (!term) {
      return res.status(400).json({ error: "Term is required" });
    }

    console.log("[GLOSSARY GENERATE] Generating for term:", term);

    const prompt = `Generate a comprehensive glossary entry for the word/phrase "${term}".
${contextSentence ? `Context: "${contextSentence}"` : ""}

Provide the response in JSON format:
{
  "definition": "Clear, concise definition in ${targetLanguage}",
  "translation": "Translation to ${targetLanguage}",
  "pronunciation": "Pronunciation guide using IPA notation",
  "difficulty": "beginner|intermediate|advanced"
}

Guidelines:
- Definition MUST be written in ${targetLanguage} (user's native language)
- Translation should be natural and commonly used in ${targetLanguage}
- Pronunciation should use IPA notation
- Difficulty based on word complexity and usage frequency
- Consider the context if provided`;

    const userId = req.userId;
    const response = await GeminiService.generateText(prompt, 
      "You are a helpful language learning assistant. Provide educational glossary entries in valid JSON format only. Do not include markdown code blocks.",
      { 
        maxTokens: 500, 
        temperature: 0.3,
        jsonMode: true,
        userId: userId || undefined,
      }
    );

    let content = response || "{}";
    
    // Remove markdown code blocks if present
    content = content
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    let generatedData = JSON.parse(content);
    
    // Handle array response - take first element
    if (Array.isArray(generatedData)) {
      generatedData = generatedData[0] || {};
    }
    
    console.log("[GLOSSARY GENERATE] Generated data:", generatedData);
    
    res.json(generatedData);
  } catch (error) {
    console.error("[GLOSSARY GENERATE] Error:", error);
    res.status(500).json({ error: "Failed to generate glossary data" });
  }
});

// Create a new glossary entry
router.post("/glossary", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { term, definition, contextSentence, notes, tags } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!term || !definition) {
      return res.status(400).json({ error: "Term and definition are required" });
    }

    console.log(`[GLOSSARY] Creating term for user ${userId}:`, { term, definition });

    const glossaryEntry = await storage.createGlossaryTerm({
      term,
      definition,
      contextSentence: contextSentence || null,
      notes: notes || null,
      tags: tags || null,
      userId: userId,
    });

    console.log(`[GLOSSARY] Created term:`, glossaryEntry);
    res.status(201).json(glossaryEntry);
  } catch (error) {
    console.error("Error creating glossary entry:", error);
    res.status(500).json({ error: "Failed to create glossary entry" });
  }
});

export default router;