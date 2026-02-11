import { Router, Response } from "express";
import { authenticateJWT, AuthenticatedRequest } from "../auth.js";
import { db } from "../db.js";
import { storage } from "../storage.js";
import { z } from "zod";
import * as schema from "@shared/schema";
import { eq, and, gte, sql } from "drizzle-orm";
import {
  GeminiService,
  STARTER_DAILY_LIMIT,
  PRO_DAILY_THRESHOLD,
  MAX_CONVERSATION_MESSAGES,
  MAX_SESSION_QUESTIONS,
} from "../services/GeminiService.js";

const router = Router();

const aiAssistRequestSchema = z.object({
  document_summary: z.string().optional().default(""),
  selected_sentence: z.string(),
  context_window: z
    .object({
      previous: z.array(z.string()).default([]),
      next: z.array(z.string()).default([]),
    })
    .default({ previous: [], next: [] }),
  user_draft: z.string().optional().default(""),
  chat_history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .default([]),
  mode: z.enum(["hover", "edit", "chat"]),
  user_message: z.string().optional(),
  questionCount: z.number().optional().default(0),
  documentId: z.number().optional(),
  fullDocumentContent: z.string().optional(),
});

async function checkAndUpdateDailyUsage(
  userId: number,
  userPlan: string,
): Promise<{
  allowed: boolean;
  remaining: number;
  isFallback?: boolean;
}> {
  const usageData = await storage.getDailyAiCount(userId);
  const currentCount = usageData.count;

  if (userPlan === "pro" || userPlan === "admin") {
    const isFallback = currentCount >= PRO_DAILY_THRESHOLD;
    await storage.incrementDailyAiCount(userId);
    return { allowed: true, remaining: -1, isFallback };
  }

  if (currentCount >= STARTER_DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }

  await storage.incrementDailyAiCount(userId);
  return { allowed: true, remaining: STARTER_DAILY_LIMIT - currentCount - 1 };
}

function buildSystemPrompt(
  mode: "hover" | "edit" | "chat",
  userBaseLanguage: string = "ko",
): string {
  const languageNames: Record<string, string> = {
    ko: "Korean",
    en: "English",
    ja: "Japanese",
    zh: "Chinese",
    es: "Spanish",
    fr: "French",
    de: "German",
  };

  const baseLanguageName = languageNames[userBaseLanguage] || "Korean";
  const roleTitle = "Insightful Language Guide";

  // 기본 정체성: 나열식 분석을 지양하고 '관계와 흐름'에 집중
  const baseIdentity = `You are the '${roleTitle}' for ReadAcross.
Always respond in ${baseLanguageName} with "Intellectual Warmth".
- **Tone**: Use natural, polite Korean (~해요, ~입니다). No dry textbook language.
- **Zero Intro/Outro**: Do NOT use any greetings or conversational fillers.
- **No Prompt Leaks**: Never use internal terms like "Hard Knot" or "매듭".
- **Anti-Listing Rule**: NEVER list sentence components (Subject, Verb, Object, Prepositional Phrase, etc.) in a glossary-like format. 
- **Focus on Flow**: Instead of labeling parts, explain how the segments connect to create meaning. (e.g., Instead of "Subject: A, Verb: B", say "A is doing B to achieve...").
- **Visual Brevity**: Keep descriptions short and punchy. Avoid long-winded grammatical justifications.`;

  // Chat 모드: 자유 대화 및 후속 질문 대응
  if (mode === "chat") {
    return `${baseIdentity}
  CHAT MODE: Respond naturally without headers. Address the user's specific curiosity directly.`;
  }

  // Hover/Edit 모드: 사용자의 구체적 요청(칩 메시지)에 따른 동적 지침
  return `${baseIdentity}

  RESPONSE STRATEGY (Structured Mode):
  - Start IMMEDIATELY with a header. No greetings.
  - **Match the User's Intent**: 
    - If the user asks for 'Grammar/Structure' (구문 해설): Unravel the logic and provide ONE short, relatable example sentence.
    - If the user asks for 'Simple Explanation' (쉬운 설명): Summarize the essence in 1-2 intuitive sentences, followed by minimal details.
    - If the user asks for 'Translation/Review' (번역 검토): Focus 100% on "Why it feels awkward" and provide a polished natural version. Skip original sentence analysis.
  
  - **Constraint**: Total response must be high-density and under 500 characters.`;
}

function buildUserPrompt(
  mode: "hover" | "edit" | "chat",
  selectedSentence: string,
  contextWindow: { previous: string[]; next: string[] },
  userDraft: string,
  documentSummary: string,
  userMessage?: string,
): string {
  let prompt = "";

  if (documentSummary) {
    prompt += `Document context: ${documentSummary}\n\n`;
  }

  if (contextWindow.previous.length > 0) {
    prompt += `Previous context:\n${contextWindow.previous.join("\n")}\n\n`;
  }

  prompt += `Selected sentence: ${selectedSentence}\n`;

  if (contextWindow.next.length > 0) {
    prompt += `\nFollowing context:\n${contextWindow.next.join("\n")}\n`;
  }

  if (mode === "edit" && userDraft) {
    prompt += `\nUser's translation draft: ${userDraft}\n`;
  }

  if (mode === "chat" && userMessage) {
    prompt += `\nUser's question: ${userMessage}`;
  } else if (mode === "hover") {
    prompt += `\nPlease explain the meaning, grammar, and nuance of this sentence.`;
  } else if (mode === "edit") {
    prompt += `\nPlease review this translation and suggest improvements.`;
  }

  return prompt;
}

router.post(
  "/assist",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId!;

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const validatedData = aiAssistRequestSchema.parse(req.body);
      const userPlan = user.plan as string;
      const isStarter = userPlan === "starter";
      const isPro = userPlan === "pro" || userPlan === "admin";

      const sessionCheck = GeminiService.checkSessionLimit(
        validatedData.questionCount + 1,
      );
      if (sessionCheck.shouldEnd) {
        const usageData = await storage.getDailyAiCount(userId);
        return res.json({
          response: sessionCheck.message,
          sessionEnded: true,
          sessionEndMessage: sessionCheck.message,
          remaining: isStarter
            ? Math.max(0, STARTER_DAILY_LIMIT - usageData.count)
            : -1,
          isFallback: false,
          dailyLimit: isStarter ? STARTER_DAILY_LIMIT : undefined,
        });
      }

      const usageCheck = await checkAndUpdateDailyUsage(userId, user.plan);
      if (!usageCheck.allowed) {
        return res.json({
          limitReached: true,
          message: "오늘의 대화 횟수를 모두 사용했습니다",
          remaining: 0,
          isFallback: false,
          dailyLimit: STARTER_DAILY_LIMIT,
        });
      }

      const recentHistory = validatedData.chat_history.slice(
        -MAX_CONVERSATION_MESSAGES,
      );

      const systemPrompt = buildSystemPrompt(
        validatedData.mode,
        user.baseLanguage,
      );
      const userPrompt = buildUserPrompt(
        validatedData.mode,
        validatedData.selected_sentence,
        validatedData.context_window,
        validatedData.user_draft,
        validatedData.document_summary,
        validatedData.user_message,
      );

      let assistantResponse: string;
      let modelUsed: string;

      if (
        isPro &&
        validatedData.documentId &&
        validatedData.fullDocumentContent
      ) {
        const cacheKey = GeminiService.cacheDocumentContent(
          userId,
          validatedData.documentId,
          validatedData.fullDocumentContent,
          systemPrompt,
        );

        const chatHistory = recentHistory.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        }));

        const result = await GeminiService.chatWithCachedContext(
          cacheKey,
          userPrompt,
          chatHistory,
          userPlan as "pro" | "admin",
        );

        if (result.error) {
          const fallbackResult = await GeminiService.generateText(
            userPrompt,
            systemPrompt,
            {
              plan: userPlan as "pro" | "admin",
              maxTokens: 1000,
              temperature: 0.7,
            },
          );
          assistantResponse = fallbackResult;
          modelUsed = GeminiService.getModelForPlan(
            userPlan as "pro" | "admin",
            false,
          );
        } else {
          assistantResponse = result.response;
          modelUsed = result.modelUsed;
        }
      } else {
        const messages = [
          { role: "system" as const, content: systemPrompt },
          ...recentHistory.map((msg) => ({
            role: msg.role as "user" | "assistant",
            content: msg.content,
          })),
          { role: "user" as const, content: userPrompt },
        ];

        const result = await GeminiService.chat(messages, {
          userPlan: userPlan as "starter" | "pro" | "admin",
          userId,
          userEmail: user.email || undefined,
          sourceLanguage: user.learningLanguage || "en",
          targetLanguage: user.baseLanguage || "ko",
        });

        assistantResponse =
          result.response ||
          "I couldn't generate a response. Please try again.";
        modelUsed = result.modelUsed;
      }

      res.json({
        response: assistantResponse,
        remaining: usageCheck.remaining,
        isFallback: usageCheck.isFallback || false,
        modelUsed,
        dailyLimit: isStarter ? STARTER_DAILY_LIMIT : undefined,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: "Invalid request",
          details: error.errors,
        });
      }

      console.error("[AI Assist Error]", error);
      res.status(500).json({ error: "Failed to process AI request" });
    }
  },
);

router.get(
  "/usage-status",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const user = await storage.getUser(userId);

      if (!user) {
        return res.status(401).json({ error: "User not found" });
      }

      const userPlan = user.plan as string;
      const isStarter = userPlan === "starter";

      const usageData = await storage.getDailyAiCount(userId);
      const currentCount = usageData.count;

      if (isStarter) {
        const remaining = Math.max(0, STARTER_DAILY_LIMIT - currentCount);
        return res.json({
          plan: userPlan,
          remaining,
          dailyLimit: STARTER_DAILY_LIMIT,
          limitReached: remaining === 0,
        });
      }

      const isFallback = currentCount >= PRO_DAILY_THRESHOLD;
      return res.json({
        plan: userPlan,
        remaining: -1,
        isFallback,
        usageCount: currentCount,
        fallbackThreshold: PRO_DAILY_THRESHOLD,
      });
    } catch (error) {
      console.error("[Usage Status Error]", error);
      res.status(500).json({ error: "Failed to get usage status" });
    }
  },
);

router.post(
  "/cache-document",
  authenticateJWT,
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const userId = req.userId!;
      const { documentId, documentContent } = req.body;

      if (!documentId || !documentContent) {
        return res
          .status(400)
          .json({ error: "documentId and documentContent are required" });
      }

      const user = await storage.getUser(userId);
      if (!user || (user.plan !== "pro" && user.plan !== "admin")) {
        return res
          .status(403)
          .json({ error: "Pro plan required for document caching" });
      }

      const systemPrompt = buildSystemPrompt("chat", user.baseLanguage || "ko");
      const cacheKey = GeminiService.cacheDocumentContent(
        userId,
        documentId,
        documentContent,
        systemPrompt,
      );

      res.json({ success: true, cacheKey });
    } catch (error) {
      console.error("[Cache Document Error]", error);
      res.status(500).json({ error: "Failed to cache document" });
    }
  },
);

export default router;
