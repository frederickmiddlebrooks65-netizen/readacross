import { GeminiService } from "./GeminiService.js";
import { storage } from "../storage.js";

export type UserPlan = "starter" | "pro" | "admin";

export const MAX_CONVERSATION_MESSAGES = 5;
export const MAX_SESSION_QUESTIONS = 15;

export interface TranslationContext {
  userEmail?: string;
  userPlan: UserPlan;
  sourceLanguage: string;
  targetLanguage: string;
  userId?: number;
}

export interface ConversationMessage {
  role: "user" | "assistant" | "system";
  content: string;
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

export class TranslationService {
  static getModelForPlan(plan: UserPlan): string {
    return GeminiService.getModelForPlan(plan);
  }

  static getModelTier(plan: UserPlan): "Basic" | "Premium" {
    return GeminiService.getModelTier(plan);
  }

  static async checkUsageLimit(userId: number, plan: UserPlan) {
    return GeminiService.checkUsageLimit(userId, plan);
  }

  static applySlidingWindow(
    messages: ConversationMessage[],
    maxMessages: number = MAX_CONVERSATION_MESSAGES
  ): ConversationMessage[] {
    return GeminiService.applySlidingWindow(messages, maxMessages);
  }

  static checkSessionLimit(questionCount: number): { shouldEnd: boolean; message?: string } {
    return GeminiService.checkSessionLimit(questionCount);
  }

  static async chat(
    messages: ConversationMessage[],
    context: TranslationContext & { questionCount?: number }
  ): Promise<AIConversationResult> {
    return GeminiService.chat(messages, context);
  }

  static async translateText(text: string, context: TranslationContext): Promise<TranslationResult> {
    return GeminiService.translateText(text, context);
  }

  static async batchTranslate(texts: string[], context: TranslationContext): Promise<TranslationResult[]> {
    return GeminiService.batchTranslate(texts, context);
  }
}

export const AI_LIMITS = {
  MAX_CONVERSATION_MESSAGES,
  MAX_SESSION_QUESTIONS
};
