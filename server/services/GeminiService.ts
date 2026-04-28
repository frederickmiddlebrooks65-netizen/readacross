import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  SchemaType,
  type ResponseSchema,
} from "@google/generative-ai";
import { storage } from "../storage.js";
import { TokenTrackingService } from "./TokenTrackingService.js";
import { PLAN_LIMITS } from "@shared/schema";

export type UserPlan = "starter" | "pro" | "admin" | "beta_pro";

export const MAX_CONVERSATION_MESSAGES = 5;
export const MAX_SESSION_QUESTIONS = 15;

const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || "";

const genAI = new GoogleGenerativeAI(GOOGLE_API_KEY);

const SAFETY_SETTINGS = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_NONE,
  },
];

const MODEL_CONFIG = {
  pro: "gemini-2.5-flash",
  flash: "gemini-2.5-flash-lite",
} as const;

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface TranslationContext {
  userEmail?: string;
  userPlan: UserPlan;
  sourceLanguage: string;
  targetLanguage: string;
  userId?: number;
}

export interface TranslationResult {
  translation: string;
  modelUsed: string;
  modelTier: "Basic" | "Premium";
  isFallback?: boolean;
  remainingCalls?: number;
  error?: string;
}

export interface AIConversationResult {
  response: string;
  modelUsed: string;
  modelTier: "Basic" | "Premium";
  isFallback?: boolean;
  remainingCalls?: number;
  sessionEnded?: boolean;
  sessionEndMessage?: string;
  error?: string;
}

export interface UsageLimitError {
  error: true;
  errorCode: "DAILY_LIMIT_EXCEEDED" | "SESSION_LIMIT_EXCEEDED";
  message: string;
  remainingCalls: number;
}

interface DocumentCacheEntry {
  documentContent: string;
  systemInstruction: string;
  expiresAt: Date;
}

// ===== Global Translation Engine Types =====
export interface TranslationSentence {
  id: number;
  source: string;
  type?: 'heading' | 'sentence';
}

export interface ChunkTranslationResult {
  sentenceId: number;
  translation: string;
  status: "success" | "failed";
  error?: string;
}

export interface GlobalTranslationResult {
  results: Map<number, string>;
  failedSentences: number[];
  totalChunks: number;
  successfulChunks: number;
}

// Token estimation constants
const TOKEN_ESTIMATION = {
  ENGLISH_CHARS_PER_TOKEN: 4,
  KOREAN_CHARS_PER_TOKEN: 2,
  CJK_CHARS_PER_TOKEN: 2,
  DEFAULT_CHARS_PER_TOKEN: 3,
  // Tightened so a single chunk stays comfortably below the model's reliable
  // output ceiling, avoiding mid-array truncation on long Korean dialogue.
  MIN_CHUNK_TOKENS: 800,
  MAX_CHUNK_TOKENS: 1200,
  // Hard cap on sentences per chunk regardless of token estimate.
  // Keeps each request small enough that the model rarely drops or merges entries.
  MAX_SENTENCES_PER_CHUNK: 30,
  OVERLAP_SENTENCES: 3, // Number of sentences to include as context
} as const;

const documentCacheMap = new Map<string, DocumentCacheEntry>();
const CACHE_TTL_HOURS = 1;

function getCacheKey(userId: number, documentId: number): string {
  return `${userId}-${documentId}`;
}

export class GeminiService {
  static getModelForPlan(plan: UserPlan, isFallback: boolean = false): string {
    if (plan === "starter" || isFallback) {
      return MODEL_CONFIG.flash;
    }
    return MODEL_CONFIG.pro;
  }

  static getModelTier(
    plan: UserPlan,
    isFallback: boolean = false,
  ): "Basic" | "Premium" {
    if (plan === "starter" || isFallback) {
      return "Basic";
    }
    return "Premium";
  }

  static async checkUsageLimit(
    userId: number,
    plan: UserPlan,
  ): Promise<{
    canProceed: boolean;
    remainingCalls: number;
    shouldFallback: boolean;
    error?: UsageLimitError;
  }> {
    if (plan === "admin") {
      return {
        canProceed: true,
        remainingCalls: Infinity,
        shouldFallback: false,
      };
    }

    const tokenCheck = await TokenTrackingService.checkTokenLimit(userId, plan);

    if (!tokenCheck.canProceed) {
      return {
        canProceed: false,
        remainingCalls: 0,
        shouldFallback: false,
        error: {
          error: true,
          errorCode: "DAILY_LIMIT_EXCEEDED",
          message: tokenCheck.message || "이번 달 토큰 사용량을 초과했습니다.",
          remainingCalls: 0,
        },
      };
    }

    return {
      canProceed: true,
      remainingCalls: Math.max(0, tokenCheck.limit - tokenCheck.currentUsage),
      shouldFallback: tokenCheck.shouldFallbackModel,
    };
  }

  static extractAndRecordTokens(
    response: any,
    userId: number | undefined,
    modelName: string
  ): number {
    if (!userId) return 0;

    let totalTokens = 0;
    try {
      const usageMetadata = response?.usageMetadata;
      if (usageMetadata) {
        totalTokens =
          (usageMetadata.promptTokenCount || 0) +
          (usageMetadata.candidatesTokenCount || 0);
      }
    } catch (e) {
      // Fallback: no metadata available
    }

    if (totalTokens > 0) {
      const isPremium = modelName === MODEL_CONFIG.pro;
      TokenTrackingService.recordTokens(userId, totalTokens, isPremium).catch(
        (err) => console.error("[TokenTracking] Failed to record tokens:", err)
      );
    }

    return totalTokens;
  }

  static applySlidingWindow(
    messages: ConversationMessage[],
    maxMessages: number = MAX_CONVERSATION_MESSAGES,
  ): ConversationMessage[] {
    const systemMessages = messages.filter((m) => m.role === "system");
    const nonSystemMessages = messages.filter((m) => m.role !== "system");
    const windowedMessages = nonSystemMessages.slice(-maxMessages);
    return [...systemMessages, ...windowedMessages];
  }

  static checkSessionLimit(questionCount: number): {
    shouldEnd: boolean;
    message?: string;
  } {
    if (questionCount >= MAX_SESSION_QUESTIONS) {
      return {
        shouldEnd: true,
        message: "다른 문맥에서 새로운 통찰을 찾아보시는 건 어떨까요?",
      };
    }
    return { shouldEnd: false };
  }

  static cacheDocumentContent(
    userId: number,
    documentId: number,
    documentContent: string,
    systemInstruction: string,
  ): string {
    const cacheKey = getCacheKey(userId, documentId);
    const existing = documentCacheMap.get(cacheKey);

    if (existing && existing.expiresAt > new Date()) {
      console.log(
        `[GeminiService] Using existing cache for document ${documentId}`,
      );
      return cacheKey;
    }

    const ttlMs = CACHE_TTL_HOURS * 60 * 60 * 1000;
    const expiresAt = new Date(Date.now() + ttlMs);

    documentCacheMap.set(cacheKey, {
      documentContent,
      systemInstruction,
      expiresAt,
    });

    console.log(
      `[GeminiService] Created in-memory cache for document ${documentId}`,
    );
    return cacheKey;
  }

  static async chatWithCachedContext(
    cacheKey: string,
    userMessage: string,
    chatHistory: ConversationMessage[] = [],
    plan: UserPlan = "pro",
  ): Promise<AIConversationResult> {
    const cached = documentCacheMap.get(cacheKey);

    if (!cached || cached.expiresAt < new Date()) {
      if (cached) documentCacheMap.delete(cacheKey);
      return {
        response: "",
        modelUsed: "",
        modelTier: "Basic",
        error: "Cache expired or not found",
      };
    }

    const modelName = this.getModelForPlan(plan, false);

    const executeCachedChat = async (
      retryCount: number = 0,
    ): Promise<string> => {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: cached.systemInstruction,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
          maxOutputTokens: 4000,
          temperature: 0.7,
        },
      });

      const history = chatHistory.map((msg) => ({
        role: msg.role === "user" ? ("user" as const) : ("model" as const),
        parts: [{ text: msg.content }],
      }));

      const chat = model.startChat({
        history: [
          {
            role: "user" as const,
            parts: [
              { text: `Full Document Content:\n\n${cached.documentContent}` },
            ],
          },
          {
            role: "model" as const,
            parts: [
              {
                text: "I have read the entire document and am ready to answer questions about it as your Knowledgeable Reading Partner.",
              },
            ],
          },
          ...history,
        ],
      });

      const timeoutMs = 45000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("API_TIMEOUT")), timeoutMs),
      );

      try {
        const result = await Promise.race([
          chat.sendMessage(userMessage),
          timeoutPromise,
        ]);

        const finishReason = result.response.candidates?.[0]?.finishReason;
        const responseText = result.response.text();

        console.log(
          `[GeminiService] Cached chat finishReason: ${finishReason}, length: ${responseText.length} chars`,
        );

        if (finishReason === "MAX_TOKENS") {
          console.warn(
            `[GeminiService] WARNING: Cached chat response was truncated due to MAX_TOKENS limit`,
          );
        } else if (finishReason !== "STOP" && finishReason !== undefined) {
          console.warn(
            `[GeminiService] WARNING: Cached chat unexpected finishReason: ${finishReason}`,
          );
        }

        const parts = cacheKey.split("-");
        const cacheUserId = parseInt(parts[0]);
        GeminiService.extractAndRecordTokens(result.response, cacheUserId, modelName);

        return responseText;
      } catch (error: any) {
        if (
          retryCount < 1 &&
          (error.message === "API_TIMEOUT" ||
            error.message?.includes("stream") ||
            error.message?.includes("ECONNRESET"))
        ) {
          console.log(
            `[GeminiService] Cached chat attempt ${retryCount + 1} failed, retrying...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return executeCachedChat(retryCount + 1);
        }
        throw error;
      }
    };

    try {
      const response = await executeCachedChat();

      return {
        response,
        modelUsed: modelName,
        modelTier: "Premium",
      };
    } catch (error: any) {
      console.error("[GeminiService] Cached chat error:", error);
      const errorMessage =
        error.message === "API_TIMEOUT"
          ? "응답 시간이 초과되었습니다. 다시 시도해주세요."
          : error.message || "Chat failed";
      return {
        response: "",
        modelUsed: MODEL_CONFIG.pro,
        modelTier: "Premium",
        error: errorMessage,
      };
    }
  }

  static clearDocumentCache(userId: number, documentId: number): void {
    const cacheKey = getCacheKey(userId, documentId);
    documentCacheMap.delete(cacheKey);
  }

  static async chat(
    messages: ConversationMessage[],
    context: TranslationContext & { questionCount?: number },
  ): Promise<AIConversationResult> {
    const userId = context.userId;

    if (!userId) {
      return {
        response: "",
        modelUsed: "",
        modelTier: "Basic",
        error: "User authentication required",
      };
    }

    const questionCount = context.questionCount || 0;
    const sessionCheck = this.checkSessionLimit(questionCount);
    if (sessionCheck.shouldEnd) {
      return {
        response: "",
        modelUsed: "",
        modelTier: "Basic",
        sessionEnded: true,
        sessionEndMessage: sessionCheck.message,
      };
    }

    const usageCheck = await this.checkUsageLimit(userId, context.userPlan);
    if (!usageCheck.canProceed) {
      return {
        response: "",
        modelUsed: "",
        modelTier: "Basic",
        remainingCalls: 0,
        error: usageCheck.error?.message,
      };
    }

    let modelName = this.getModelForPlan(
      context.userPlan,
      usageCheck.shouldFallback,
    );
    let modelTier = this.getModelTier(
      context.userPlan,
      usageCheck.shouldFallback,
    );
    let isFallback = usageCheck.shouldFallback;

    const windowedMessages = this.applySlidingWindow(messages);

    const systemMessage = windowedMessages.find((m) => m.role === "system");
    const chatMessages = windowedMessages.filter((m) => m.role !== "system");

    console.log(
      `User [${context.userEmail || "anonymous"}] (Plan: ${context.userPlan}) chat request using model [${modelName}]${isFallback ? " (fallback)" : ""}`,
    );

    const executeChat = async (retryCount: number = 0): Promise<string> => {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemMessage?.content,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
          maxOutputTokens: 4000,
          temperature: 0.7,
        },
      });

      const history = chatMessages.slice(0, -1).map((msg) => ({
        role: msg.role === "user" ? ("user" as const) : ("model" as const),
        parts: [{ text: msg.content }],
      }));

      const lastMessage = chatMessages[chatMessages.length - 1];
      const chat = model.startChat({ history });

      const timeoutMs = 45000;
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("API_TIMEOUT")), timeoutMs),
      );

      try {
        const result = await Promise.race([
          chat.sendMessage(lastMessage?.content || ""),
          timeoutPromise,
        ]);

        const finishReason = result.response.candidates?.[0]?.finishReason;
        const responseText = result.response.text();

        console.log(
          `[GeminiService] Response finishReason: ${finishReason}, length: ${responseText.length} chars`,
        );

        if (finishReason === "MAX_TOKENS") {
          console.warn(
            `[GeminiService] WARNING: Response was truncated due to MAX_TOKENS limit`,
          );
        } else if (finishReason !== "STOP" && finishReason !== undefined) {
          console.warn(
            `[GeminiService] WARNING: Unexpected finishReason: ${finishReason}`,
          );
        }

        GeminiService.extractAndRecordTokens(result.response, userId, modelName);

        return responseText;
      } catch (error: any) {
        if (
          retryCount < 1 &&
          (error.message === "API_TIMEOUT" ||
            error.message?.includes("stream") ||
            error.message?.includes("ECONNRESET"))
        ) {
          console.log(
            `[GeminiService] Chat attempt ${retryCount + 1} failed, retrying...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return executeChat(retryCount + 1);
        }
        throw error;
      }
    };

    try {
      const response = await executeChat();

      const usage = await TokenTrackingService.getOrCreateMonthlyUsage(userId);
      const limits = PLAN_LIMITS[context.userPlan] || PLAN_LIMITS.starter;
      const remainingCalls = Math.max(0, limits.monthlyTokenCap - usage.totalTokensUsed);

      return {
        response,
        modelUsed: modelName,
        modelTier,
        isFallback,
        remainingCalls,
      };
    } catch (error: any) {
      console.error("AI chat error:", error);
      const errorMessage =
        error.message === "API_TIMEOUT"
          ? "응답 시간이 초과되었습니다. 다시 시도해주세요."
          : "AI 응답 생성 중 오류가 발생했습니다.";
      return {
        response: "",
        modelUsed: modelName,
        modelTier,
        isFallback,
        error: errorMessage,
      };
    }
  }

  static async translateText(
    text: string,
    context: TranslationContext,
  ): Promise<TranslationResult> {
    const userId = context.userId;
    let isFallback = false;
    let remainingCalls: number | undefined;

    if (userId) {
      const usageCheck = await this.checkUsageLimit(userId, context.userPlan);
      if (!usageCheck.canProceed) {
        return {
          translation: "",
          modelUsed: "",
          modelTier: "Basic",
          remainingCalls: 0,
          error: usageCheck.error?.message,
        };
      }
      if (usageCheck.shouldFallback && context.userPlan === "pro") {
        isFallback = true;
        console.log(
          `[Translation] Pro user ${userId} exceeded threshold, falling back to flash model`,
        );
      }
    }

    const modelName = this.getModelForPlan(context.userPlan, isFallback);
    const modelTier = this.getModelTier(context.userPlan, isFallback);

    console.log(
      `User [${context.userEmail || "anonymous"}] (Plan: ${context.userPlan}) requested translation using model [${modelName}]${isFallback ? " (fallback)" : ""}`,
    );

    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
          maxOutputTokens: Math.min(text.length * 2, 2048),
          temperature: 0.3,
        },
      });

      const isKoreanTarget = context.targetLanguage === "ko";

      const systemPrompt = isKoreanTarget
        ? `You are a professional translator for ${context.sourceLanguage}→${context.targetLanguage}.
Output must be Korean 'plain academic style' (하다체): only ~다/~는다/~했다/~이다/~되다 endings.

STRICT RULES:
- Never use honorific endings (~습니다/~입니다/~됩니다/~하세요 등)
- Prefer declarative academic tone; convert requests to "~하도록 한다"
- Preserve meaning, numbers, entities, formatting; no extra commentary
- Replace semicolons with appropriate punctuation; normalize dashes
- No colloquialisms, no honorifics, no emojis`
        : `You are a professional translator for ${context.sourceLanguage}→${context.targetLanguage}.

STRICT RULES:
- Write in natural, professional ${context.targetLanguage}
- Preserve meaning, numbers, entities, formatting; no extra commentary
- Do not add explanations or comments
- No emojis`;

      const prompt = `${systemPrompt}

Translate from ${context.sourceLanguage} to ${context.targetLanguage}:

${text}`;

      const result = await model.generateContent(prompt);
      const translatedText = result.response.text();
      const finalTranslation = isKoreanTarget
        ? this.applyLocalCleanup(translatedText)
        : translatedText;

      if (this.containsHonorific(finalTranslation)) {
        console.warn(
          `[Translation Monitor] Honorific patterns detected after cleanup. Length: ${finalTranslation.length}`,
        );
      }

      this.extractAndRecordTokens(result.response, userId, modelName);

      if (userId) {
        const usage = await TokenTrackingService.getOrCreateMonthlyUsage(userId);
        const limits = PLAN_LIMITS[context.userPlan] || PLAN_LIMITS.starter;
        remainingCalls = Math.max(0, limits.monthlyTokenCap - usage.totalTokensUsed);
      }

      return {
        translation: finalTranslation,
        modelUsed: modelName,
        modelTier,
        isFallback,
        remainingCalls,
      };
    } catch (error) {
      console.error("Translation error:", error);
      return {
        translation: `[Translation unavailable] ${text}`,
        modelUsed: modelName,
        modelTier,
        isFallback,
        error: "번역 중 오류가 발생했습니다.",
      };
    }
  }

  static async batchTranslate(
    texts: string[],
    context: TranslationContext,
  ): Promise<TranslationResult[]> {
    const results = await Promise.all(
      texts.map((text) => this.translateText(text, context)),
    );
    return results;
  }

  /**
   * Refactored translateParagraphBatch - now uses Global Translation Engine
   * 
   * Automatically triggers chunked translation when content exceeds 2,000 tokens.
   * Maintains backward compatibility with existing API.
   */
  static async translateParagraphBatch(
    sentences: Array<{ id: number; source: string; type?: 'heading' | 'sentence' }>,
    context: TranslationContext,
    previousContext?: string,
  ): Promise<Map<number, string>> {
    if (sentences.length === 0) {
      return new Map<number, string>();
    }

    const translationSentences: TranslationSentence[] = sentences.map(s => ({
      id: s.id,
      source: s.source,
      type: s.type,
    }));

    // Estimate total tokens
    const totalTokens = this.estimateSentencesTokenCount(translationSentences);
    console.log(`[BATCH_TRANSLATE] Received ${sentences.length} sentences (~${totalTokens} tokens)`);

    // Route to Global Translation Engine for all translations
    // This provides consistent handling with chunking, overlap, and fault tolerance
    const globalResult = await this.translateGlobal(translationSentences, context);

    // Log results
    if (globalResult.failedSentences.length > 0) {
      console.warn(`[BATCH_TRANSLATE] ${globalResult.failedSentences.length} sentences failed translation`);
    }

    // `globalResult.results` already excludes any sentences the model failed to
    // return, so `results.size` IS the successful count. Report that directly
    // rather than subtracting `failedSentences.length` (which would double-count
    // and could even go negative).
    console.log(
      `[BATCH_TRANSLATE] Completed: ${globalResult.successfulChunks}/${globalResult.totalChunks} chunks, ` +
      `${globalResult.results.size}/${sentences.length} sentences successful`
    );

    return globalResult.results;
  }

  static async generateText(
    prompt: string,
    systemPrompt?: string,
    options?: {
      maxTokens?: number;
      temperature?: number;
      plan?: UserPlan;
      jsonMode?: boolean;
      userId?: number;
      model?: "pro" | "flash";
    },
  ): Promise<string> {
    const modelName = options?.model
      ? MODEL_CONFIG[options.model]
      : this.getModelForPlan(options?.plan || "starter", false);

    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        systemInstruction: systemPrompt,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
          maxOutputTokens: options?.maxTokens || 1000,
          temperature: options?.temperature || 0.7,
          responseMimeType: options?.jsonMode ? "application/json" : undefined,
        },
      });

      const result = await model.generateContent(prompt);
      this.extractAndRecordTokens(result.response, options?.userId, modelName);
      return result.response.text();
    } catch (error) {
      console.error("Text generation error:", error);
      throw error;
    }
  }

  static async processImageOCR(imageBase64: string, userId?: number): Promise<string> {
    try {
      const model = genAI.getGenerativeModel({
        model: MODEL_CONFIG.flash,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
          maxOutputTokens: 4096,
        },
      });

      const base64Data = imageBase64.startsWith("data:")
        ? imageBase64.split(",")[1]
        : imageBase64;

      const result = await model.generateContent([
        {
          inlineData: {
            mimeType: "image/jpeg",
            data: base64Data,
          },
        },
        {
          text: "Extract text from this image, preserving paragraph structures and fixing line breaks. If the text is ambiguous, infer based on context but do not invent content. Focus on the main body text only. Return only the extracted text.",
        },
      ]);

      this.extractAndRecordTokens(result.response, userId, MODEL_CONFIG.flash);

      return result.response.text();
    } catch (error) {
      console.error("OCR error:", error);
      throw error;
    }
  }

  static async detectLanguage(
    text: string,
  ): Promise<{ language: string; confidence: number }> {
    const LANGUAGE_CODE_MAP: Record<string, string> = {
      english: "en",
      korean: "ko",
      japanese: "ja",
      chinese: "zh",
      spanish: "es",
      french: "fr",
      german: "de",
      portuguese: "pt",
      italian: "it",
      russian: "ru",
      arabic: "ar",
      hindi: "hi",
      vietnamese: "vi",
      thai: "th",
      indonesian: "id",
    };

    try {
      const model = genAI.getGenerativeModel({
        model: MODEL_CONFIG.flash,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
          maxOutputTokens: 100,
          temperature: 0,
          responseMimeType: "application/json",
        },
      });

      const sampleText = text.slice(0, 500);
      const prompt = `Analyze the given text and respond with ONLY a JSON object containing:
- "language": the detected language name in lowercase English (e.g., "english", "korean", "japanese")
- "confidence": a number from 0 to 1 indicating confidence level

Text: "${sampleText}"`;

      const result = await model.generateContent(prompt);
      const content = result.response.text();
      const parsed = JSON.parse(content);
      const languageName = parsed.language?.toLowerCase() || "english";
      const languageCode =
        LANGUAGE_CODE_MAP[languageName] || languageName.slice(0, 2);

      console.log(
        `[LANG_DETECT] Detected: ${languageCode} (confidence: ${parsed.confidence})`,
      );
      return { language: languageCode, confidence: parsed.confidence || 0.8 };
    } catch (error) {
      console.error("[LANG_DETECT] Detection failed, using fallback:", error);
      return this.fallbackLanguageDetection(text);
    }
  }

  // ===== Global Translation Engine Methods =====

  /**
   * Estimate token count for a given text
   * Uses language-aware approximation: English ~4 chars/token, Korean/CJK ~2 chars/token
   */
  static estimateTokenCount(text: string): number {
    if (!text) return 0;

    let tokenCount = 0;
    const koreanRegex = /[\uAC00-\uD7AF\u1100-\u11FF]/g;
    const cjkRegex = /[\u4E00-\u9FFF\u3040-\u309F\u30A0-\u30FF]/g;

    const koreanMatches = text.match(koreanRegex) || [];
    const cjkMatches = text.match(cjkRegex) || [];
    const asianCharCount = koreanMatches.length + cjkMatches.length;

    const nonAsianText = text.replace(koreanRegex, "").replace(cjkRegex, "");
    const nonAsianCharCount = nonAsianText.length;

    tokenCount += asianCharCount / TOKEN_ESTIMATION.KOREAN_CHARS_PER_TOKEN;
    tokenCount += nonAsianCharCount / TOKEN_ESTIMATION.ENGLISH_CHARS_PER_TOKEN;

    return Math.ceil(tokenCount);
  }

  /**
   * Estimate total tokens for an array of sentences
   */
  static estimateSentencesTokenCount(sentences: TranslationSentence[]): number {
    return sentences.reduce((sum, s) => sum + this.estimateTokenCount(s.source), 0);
  }

  /**
   * Divide sentences into chunks respecting sentence boundaries
   * Each chunk is 2,000-2,500 tokens (configurable)
   */
  static createSentenceAwareChunks(
    sentences: TranslationSentence[],
    minTokens: number = TOKEN_ESTIMATION.MIN_CHUNK_TOKENS,
    maxTokens: number = TOKEN_ESTIMATION.MAX_CHUNK_TOKENS,
    maxSentences: number = TOKEN_ESTIMATION.MAX_SENTENCES_PER_CHUNK
  ): TranslationSentence[][] {
    const chunks: TranslationSentence[][] = [];
    let currentChunk: TranslationSentence[] = [];
    let currentTokens = 0;

    for (const sentence of sentences) {
      const sentenceTokens = this.estimateTokenCount(sentence.source);

      // Start a new chunk if adding this sentence would exceed either the
      // token budget or the hard sentence-count cap.
      const wouldExceedTokens = currentTokens + sentenceTokens > maxTokens;
      const wouldExceedCount = currentChunk.length >= maxSentences;
      if ((wouldExceedTokens || wouldExceedCount) && currentChunk.length > 0) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentTokens = 0;
      }

      currentChunk.push(sentence);
      currentTokens += sentenceTokens;
    }

    // Don't forget the last chunk
    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    return chunks;
  }

  /**
   * Get overlap context sentences from the previous chunk
   * Returns the last N sentences as read-only context
   */
  static getOverlapContext(
    previousChunk: TranslationSentence[] | null,
    previousTranslations: Map<number, string>,
    overlapCount: number = TOKEN_ESTIMATION.OVERLAP_SENTENCES
  ): { source: string; translation: string }[] {
    if (!previousChunk || previousChunk.length === 0) {
      return [];
    }

    const overlapSentences = previousChunk.slice(-overlapCount);
    return overlapSentences.map((s) => ({
      source: s.source,
      translation: previousTranslations.get(s.id) || "",
    })).filter(o => o.translation); // Only include successfully translated sentences
  }

  /**
   * Validate LLM response format for batch translation
   * Returns parsed translations if valid, throws error if invalid
   */
  /**
   * Parse a translation response that conforms to the array schema:
   *   [{ "id": <int>, "text": "<translation>" }, ...]
   *
   * The Gemini SDK enforces the schema when responseSchema + responseMimeType
   * are set, so we just need to JSON.parse and shape-check. Returns a Map of
   * id → translation containing only entries with non-empty text.
   */
  static parseTranslationResponse(
    responseText: string
  ): Map<number, string> {
    const out = new Map<number, string>();

    let parsed: any;
    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      throw new Error(`Invalid JSON response: ${e}`);
    }

    // The schema declares an array at the root, but be defensive:
    // also accept { translations: [...] } in case the model wraps it.
    let arr: any[] | null = null;
    if (Array.isArray(parsed)) {
      arr = parsed;
    } else if (parsed && Array.isArray(parsed.translations)) {
      arr = parsed.translations;
    }

    if (!arr) {
      throw new Error("Response must be a JSON array of {id, text} objects");
    }

    for (const entry of arr) {
      if (!entry || typeof entry !== "object") continue;
      const idRaw = entry.id;
      const textRaw = entry.text;
      const id = typeof idRaw === "number" ? idRaw : parseInt(String(idRaw), 10);
      if (!Number.isFinite(id)) continue;
      const text = typeof textRaw === "string" ? textRaw.trim() : "";
      if (text.length === 0) continue;
      out.set(id, text);
    }

    return out;
  }

  /**
   * Translate a single chunk and return only the IDs that came back with a
   * non-empty translation. Missing or failed IDs are simply absent from the
   * returned map so the caller (translateGlobal / gap-fill loop) can retry
   * just those sentences instead of writing placeholder text to the database.
   *
   * The model output is constrained by responseSchema so the SDK enforces a
   * `[{id:int, text:string}, ...]` shape with proper string escaping. This
   * avoids the unescaped-quote / truncated-array failure modes that broke
   * earlier JSON-object and `<<<id>>>` line formats on Korean dialogue.
   */
  static async translateChunk(
    chunk: TranslationSentence[],
    context: TranslationContext,
    overlapContext: { source: string; translation: string }[],
    retryCount: number = 0
  ): Promise<Map<number, string>> {
    const MAX_RETRIES = 3;
    const modelName = this.getModelForPlan(context.userPlan, false);

    // Build the context section from overlap
    let contextSection = "";
    if (overlapContext.length > 0) {
      contextSection = `\n\n[PREVIOUS CONTEXT - DO NOT TRANSLATE, for reference only]:\n`;
      for (const ctx of overlapContext) {
        contextSection += `Original: ${ctx.source}\nTranslation: ${ctx.translation}\n\n`;
      }
      contextSection += `[END OF CONTEXT]\n`;
    }

    const sentenceList = chunk
      .map((s) => s.type === 'heading' ? `[${s.id}] [HEADING]: ${s.source}` : `[${s.id}]: ${s.source}`)
      .join("\n\n");

    const isKoreanTarget = context.targetLanguage === "ko";
    const expectedIds = chunk.map(s => s.id);
    const expectedIdSet = new Set(expectedIds);

    const baseStyleRules = isKoreanTarget
      ? `You are a professional translator for ${context.sourceLanguage}→${context.targetLanguage}.
Output must be Korean 'plain academic style' (하다체): only ~다/~는다/~했다/~이다/~되다 endings.

CRITICAL RULES:
- Never use honorific endings (~습니다/~입니다/~됩니다/~하세요 등)
- Prefer declarative academic tone; convert requests to "~하도록 한다"
- Preserve ALL HTML tags, bold formatting, and structural markup - translate ONLY the content within tags
- Preserve meaning, numbers, entities, formatting; no extra commentary
- Replace semicolons with appropriate punctuation; normalize dashes
- No colloquialisms, no honorifics, no emojis
- Use UTF-8 encoding for all text
- Maintain consistency with the previous context if provided
- Sentences marked [HEADING] are section titles: translate as noun phrases (명사구), NOT full sentences. Do NOT add verb endings like ~이다/~하다. Example: "Ethical considerations" → "윤리적 고려 사항" (NOT "윤리적 고려 사항이다.")`
      : `You are a professional translator for ${context.sourceLanguage}→${context.targetLanguage}.

CRITICAL RULES:
- Write in natural, professional ${context.targetLanguage}
- Preserve ALL HTML tags, bold formatting, and structural markup - translate ONLY the content within tags
- Preserve meaning, numbers, entities, formatting; no extra commentary
- Do not add explanations or comments
- Use UTF-8 encoding for all text
- Maintain consistency with the previous context if provided
- Sentences marked [HEADING] are section titles: translate as noun phrases, NOT full sentences. Keep them concise without verb endings.`;

    const outputFormatRules = `STRICT OUTPUT FORMAT:
- Return ONLY a JSON array. Each element MUST be an object with exactly two fields: "id" (integer) and "text" (string).
- Include EVERY input sentence ID exactly once, in the same order as the input.
- "text" must be the translation only — no commentary, no quotes around the translation, no markdown.
- Do NOT merge sentences. Do NOT skip sentences. Do NOT renumber.
- Total number of array elements MUST equal the number of input sentences (${chunk.length}).`;

    const systemPrompt = `${baseStyleRules}\n\n${outputFormatRules}${contextSection}`;

    const prompt = `${systemPrompt}

Translate the following ${chunk.length} sentences from ${context.sourceLanguage} to ${context.targetLanguage}. Each sentence is prefixed with its ID in brackets. The expected output is a JSON array of length ${chunk.length} containing the translation for every ID listed below.

${sentenceList}

Return the JSON array now:`;

    // Generous output budget so a chunk of 30 short sentences can never be
    // truncated mid-array. Korean output is roughly 1-1.5x the source length;
    // English output of Korean source is shorter. 8192 is plenty for a 1200-token chunk.
    const sourceChars = chunk.reduce((sum, s) => sum + s.source.length, 0);
    const maxOutputTokens = Math.min(8192, Math.max(4096, sourceChars * 4));

    const responseSchema: ResponseSchema = {
      type: SchemaType.ARRAY,
      items: {
        type: SchemaType.OBJECT,
        properties: {
          id: { type: SchemaType.INTEGER },
          text: { type: SchemaType.STRING },
        },
        required: ["id", "text"],
      },
    };

    let parsed: Map<number, string>;
    try {
      const model = genAI.getGenerativeModel({
        model: modelName,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: {
          maxOutputTokens,
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema,
        },
      });

      const timeoutMs = 60000; // 60 second timeout per chunk
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("CHUNK_TIMEOUT")), timeoutMs)
      );

      const result = await Promise.race([
        model.generateContent(prompt),
        timeoutPromise,
      ]);

      this.extractAndRecordTokens(result.response, context.userId, modelName);

      const responseText = result.response.text();
      parsed = this.parseTranslationResponse(responseText);
    } catch (error: any) {
      console.error(`[CHUNK_TRANSLATE] Chunk translation error (attempt ${retryCount + 1}):`, error.message);

      if (retryCount < MAX_RETRIES) {
        console.log(`[CHUNK_TRANSLATE] Retrying chunk translation (attempt ${retryCount + 2}/${MAX_RETRIES + 1})...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return this.translateChunk(chunk, context, overlapContext, retryCount + 1);
      }

      // Out of retries: return empty so caller can decide what to do (gap-fill).
      return new Map<number, string>();
    }

    // Build the result, restricted to expected IDs only.
    const results = new Map<number, string>();
    for (const [id, text] of parsed) {
      if (!expectedIdSet.has(id)) continue;
      const cleaned = isKoreanTarget ? this.applyLocalCleanup(text) : text;
      if (cleaned && cleaned.trim().length > 0) {
        results.set(id, cleaned);
      }
    }

    // If we missed any IDs, retry just the missing ones.
    const missingIds = expectedIds.filter(id => !results.has(id));
    if (missingIds.length > 0 && retryCount < MAX_RETRIES) {
      const missingChunk = chunk.filter(s => missingIds.includes(s.id));
      console.warn(
        `[CHUNK_TRANSLATE] Missing ${missingIds.length}/${chunk.length} translations after attempt ${retryCount + 1}; retrying missing IDs only`
      );
      await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
      const retryResults = await this.translateChunk(
        missingChunk,
        context,
        overlapContext,
        retryCount + 1
      );
      for (const [id, text] of retryResults) {
        results.set(id, text);
      }
    } else if (missingIds.length > 0) {
      console.warn(
        `[CHUNK_TRANSLATE] Giving up on ${missingIds.length} missing IDs after ${MAX_RETRIES + 1} attempts: ${missingIds.slice(0, 10).join(", ")}${missingIds.length > 10 ? "..." : ""}`
      );
    }

    return results;
  }

  /**
   * Global Translation Engine - Main entry point
   * Handles any array of sentences with chunking, overlap, and fault tolerance
   */
  static async translateGlobal(
    sentences: TranslationSentence[],
    context: TranslationContext
  ): Promise<GlobalTranslationResult> {
    const results = new Map<number, string>();
    const failedSentences: number[] = [];

    if (sentences.length === 0) {
      return { results, failedSentences, totalChunks: 0, successfulChunks: 0 };
    }

    const totalTokens = this.estimateSentencesTokenCount(sentences);
    console.log(`[GLOBAL_TRANSLATE] Starting translation of ${sentences.length} sentences (~${totalTokens} tokens)`);

    // If under threshold AND under sentence cap, use direct translation.
    if (
      totalTokens <= TOKEN_ESTIMATION.MIN_CHUNK_TOKENS &&
      sentences.length <= TOKEN_ESTIMATION.MAX_SENTENCES_PER_CHUNK
    ) {
      console.log(`[GLOBAL_TRANSLATE] Under threshold, using direct batch translation`);
      const directResult = await this.translateChunk(sentences, context, []);

      directResult.forEach((translation, id) => {
        results.set(id, translation);
      });
      for (const sentence of sentences) {
        if (!directResult.has(sentence.id)) {
          failedSentences.push(sentence.id);
        }
      }

      return {
        results,
        failedSentences,
        totalChunks: 1,
        successfulChunks: failedSentences.length === 0 ? 1 : 0,
      };
    }

    // Create sentence-aware chunks
    const chunks = this.createSentenceAwareChunks(sentences);
    console.log(`[GLOBAL_TRANSLATE] Created ${chunks.length} chunks for processing`);

    let successfulChunks = 0;
    let previousChunk: TranslationSentence[] | null = null;

    // Process each chunk sequentially (to maintain overlap context)
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`[GLOBAL_TRANSLATE] Processing chunk ${i + 1}/${chunks.length} (${chunk.length} sentences)`);

      // Get overlap context from previous chunk
      const overlapContext = this.getOverlapContext(previousChunk, results);

      try {
        const chunkResults = await this.translateChunk(chunk, context, overlapContext);

        // Successful translations get added to results.
        chunkResults.forEach((translation, id) => {
          results.set(id, translation);
        });

        // Anything missing from this chunk's response is a failure.
        let chunkHasFailures = false;
        for (const sentence of chunk) {
          if (!chunkResults.has(sentence.id)) {
            failedSentences.push(sentence.id);
            chunkHasFailures = true;
          }
        }

        if (!chunkHasFailures) {
          successfulChunks++;
        }

        previousChunk = chunk;

      } catch (error: any) {
        console.error(`[GLOBAL_TRANSLATE] Fatal error on chunk ${i + 1}:`, error);

        // Record failures without writing placeholder text — caller's gap-fill
        // pass will retry these sentences.
        for (const sentence of chunk) {
          failedSentences.push(sentence.id);
        }
      }
    }

    console.log(`[GLOBAL_TRANSLATE] Completed: ${successfulChunks}/${chunks.length} chunks successful, ${failedSentences.length} failed sentences`);

    return {
      results,
      failedSentences,
      totalChunks: chunks.length,
      successfulChunks,
    };
  }

  // ===== End Global Translation Engine Methods =====

  private static fallbackLanguageDetection(text: string): {
    language: string;
    confidence: number;
  } {
    const koreanRegex = /[\uAC00-\uD7AF\u1100-\u11FF]/;
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF]/;
    const chineseRegex = /[\u4E00-\u9FFF]/;
    const arabicRegex = /[\u0600-\u06FF]/;
    const cyrillicRegex = /[\u0400-\u04FF]/;

    if (koreanRegex.test(text)) return { language: "ko", confidence: 0.9 };
    if (japaneseRegex.test(text)) return { language: "ja", confidence: 0.9 };
    if (chineseRegex.test(text) && !japaneseRegex.test(text))
      return { language: "zh", confidence: 0.8 };
    if (arabicRegex.test(text)) return { language: "ar", confidence: 0.9 };
    if (cyrillicRegex.test(text)) return { language: "ru", confidence: 0.8 };

    return { language: "en", confidence: 0.7 };
  }

  private static containsHonorific(text: string): boolean {
    const honorificPatterns = [
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

  private static normalizePoliteToPlain(text: string): string {
    return text
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
      .replace(/없습니다/g, "없다")
      .replace(/있습니다/g, "있다")
      .replace(/같습니다/g, "같다")
      .replace(/많습니다/g, "많다")
      .replace(/적습니다/g, "적다")
      .replace(/해 주시기 바랍니다/g, "하도록 한다")
      .replace(/부탁드립니다/g, "하도록 한다")
      .replace(/권장드립니다/g, "권장한다")
      .replace(/권고드립니다/g, "권고한다")
      .replace(/주시길 바랍니다/g, "하도록 한다")
      .replace(/주세요/g, "하도록 한다")
      .replace(/해 주세요/g, "하도록 한다")
      .replace(/하세요/g, "한다")
      .replace(/입니까\?/g, "인가?")
      .replace(/습니까\?/g, "는가?")
      .replace(/겠습니까\?/g, "겠는가?")
      .replace(/습니다/g, "다")
      .replace(/니다/g, "다")
      .replace(/니까/g, "냐");
  }

  private static applyLocalCleanup(translatedText: string): string {
    return this.normalizePoliteToPlain(
      translatedText
        .replace(/;/g, ".")
        .replace(/—/g, " — ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
}

export const AI_LIMITS = {
  MAX_CONVERSATION_MESSAGES,
  MAX_SESSION_QUESTIONS,
};
