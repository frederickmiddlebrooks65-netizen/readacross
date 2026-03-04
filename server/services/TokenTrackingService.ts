import { db } from "../db.js";
import { tokenUsage, users, PLAN_LIMITS, type TokenUsage } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";
import { NotificationService } from "./NotificationService.js";

export type PlanType = "starter" | "pro" | "admin" | "beta_pro";

const notifiedThresholdUsers = new Set<string>();

function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export interface UsageSnapshot {
  plan: PlanType;
  totalTokensUsed: number;
  remainingTokens: number;
  premiumTokensUsed: number;
  remainingPremiumTokens: number;
  fullDocTranslations: number;
  ocrCount: number;
  month: string;
}

export interface TokenCheckResult {
  canProceed: boolean;
  shouldFallbackModel: boolean;
  errorCode?: "MONTHLY_LIMIT_EXCEEDED" | "PREMIUM_LIMIT_EXCEEDED";
  message?: string;
  currentUsage: number;
  limit: number;
}

export class TokenTrackingService {
  static async getOrCreateMonthlyUsage(userId: number): Promise<TokenUsage> {
    const month = getCurrentMonth();

    const existing = await db
      .select()
      .from(tokenUsage)
      .where(and(eq(tokenUsage.userId, userId), eq(tokenUsage.month, month)))
      .limit(1);

    if (existing.length > 0) {
      return existing[0];
    }

    const [created] = await db
      .insert(tokenUsage)
      .values({
        userId,
        month,
        totalTokensUsed: 0,
        premiumTokensUsed: 0,
        fullDocTranslations: 0,
        ocrCount: 0,
      })
      .onConflictDoNothing()
      .returning();

    if (created) return created;

    const [refetched] = await db
      .select()
      .from(tokenUsage)
      .where(and(eq(tokenUsage.userId, userId), eq(tokenUsage.month, month)))
      .limit(1);

    return refetched;
  }

  static async recordTokens(
    userId: number,
    tokensUsed: number,
    isPremiumModel: boolean
  ): Promise<TokenUsage> {
    const month = getCurrentMonth();

    await this.getOrCreateMonthlyUsage(userId);

    const updateValues: any = {
      totalTokensUsed: sql`${tokenUsage.totalTokensUsed} + ${tokensUsed}`,
      updatedAt: new Date(),
    };

    if (isPremiumModel) {
      updateValues.premiumTokensUsed = sql`${tokenUsage.premiumTokensUsed} + ${tokensUsed}`;
    }

    const [updated] = await db
      .update(tokenUsage)
      .set(updateValues)
      .where(and(eq(tokenUsage.userId, userId), eq(tokenUsage.month, month)))
      .returning();

    console.log(
      `[TokenTracking] User ${userId}: +${tokensUsed} tokens (premium: ${isPremiumModel}), ` +
      `total: ${updated.totalTokensUsed}, premium: ${updated.premiumTokensUsed}`
    );

    this.checkAndNotifyThreshold(userId, updated.totalTokensUsed, month).catch(() => { });

    return updated;
  }

  static async incrementFullDocTranslation(userId: number): Promise<void> {
    const month = getCurrentMonth();
    await this.getOrCreateMonthlyUsage(userId);

    await db
      .update(tokenUsage)
      .set({
        fullDocTranslations: sql`${tokenUsage.fullDocTranslations} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(tokenUsage.userId, userId), eq(tokenUsage.month, month)));
  }

  static async incrementOcrCount(userId: number): Promise<void> {
    const month = getCurrentMonth();
    await this.getOrCreateMonthlyUsage(userId);

    await db
      .update(tokenUsage)
      .set({
        ocrCount: sql`${tokenUsage.ocrCount} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(tokenUsage.userId, userId), eq(tokenUsage.month, month)));
  }

  static readonly MONTHLY_CAP_BUFFER = 500;
  static readonly PREMIUM_FALLBACK_BUFFER = 2_000;

  static async checkTokenLimit(
    userId: number,
    plan: PlanType
  ): Promise<TokenCheckResult> {
    if (plan === "admin") {
      return {
        canProceed: true,
        shouldFallbackModel: false,
        currentUsage: 0,
        limit: Infinity,
      };
    }

    const usage = await this.getOrCreateMonthlyUsage(userId);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
    if (!PLAN_LIMITS[plan]) {
      console.warn(`[TokenTracking] Unknown plan "${plan}" for user ${userId}, falling back to starter limits`);
    }

    const remainingTokens = limits.monthlyTokenCap - usage.totalTokensUsed;
    if (remainingTokens <= this.MONTHLY_CAP_BUFFER) {
      return {
        canProceed: false,
        shouldFallbackModel: false,
        errorCode: "MONTHLY_LIMIT_EXCEEDED",
        message: "이번 달 토큰 사용량을 초과했습니다.",
        currentUsage: usage.totalTokensUsed,
        limit: limits.monthlyTokenCap,
      };
    }

    let shouldFallbackModel = false;
    if (plan === "pro" || plan === "beta_pro") {
      const remainingPremium = limits.premiumTokenCap - usage.premiumTokensUsed;
      if (remainingPremium <= this.PREMIUM_FALLBACK_BUFFER) {
        shouldFallbackModel = true;
      }
    }

    return {
      canProceed: true,
      shouldFallbackModel,
      currentUsage: usage.totalTokensUsed,
      limit: limits.monthlyTokenCap,
    };
  }

  static async checkFullDocTranslationLimit(
    userId: number,
    plan: PlanType
  ): Promise<{ canProceed: boolean; errorCode?: string; message?: string; used: number; limit: number }> {
    if (plan === "admin" || plan === "pro" || plan === "beta_pro") {
      return { canProceed: true, used: 0, limit: Infinity };
    }

    const usage = await this.getOrCreateMonthlyUsage(userId);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;

    if (usage.fullDocTranslations >= limits.maxFullDocTranslations) {
      return {
        canProceed: false,
        errorCode: "FULL_DOC_TRANSLATION_LIMIT",
        message: "이번 달 전체 문서 번역 횟수를 초과했습니다.",
        used: usage.fullDocTranslations,
        limit: limits.maxFullDocTranslations,
      };
    }

    return { canProceed: true, used: usage.fullDocTranslations, limit: limits.maxFullDocTranslations };
  }

  static async checkOcrLimit(
    userId: number,
    plan: PlanType
  ): Promise<{ canProceed: boolean; errorCode?: string; message?: string; used: number; limit: number }> {
    if (plan === "admin" || plan === "pro" || plan === "beta_pro") {
      return { canProceed: true, used: 0, limit: Infinity };
    }

    const usage = await this.getOrCreateMonthlyUsage(userId);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;

    if (usage.ocrCount >= limits.maxOcr) {
      return {
        canProceed: false,
        errorCode: "OCR_LIMIT_REACHED",
        message: "이번 달 OCR 사용 횟수를 초과했습니다.",
        used: usage.ocrCount,
        limit: limits.maxOcr,
      };
    }

    return { canProceed: true, used: usage.ocrCount, limit: limits.maxOcr };
  }

  static async getUsageSnapshot(
    userId: number,
    plan: PlanType
  ): Promise<UsageSnapshot> {
    const usage = await this.getOrCreateMonthlyUsage(userId);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;

    return {
      plan,
      totalTokensUsed: usage.totalTokensUsed,
      remainingTokens: Math.max(0, limits.monthlyTokenCap - usage.totalTokensUsed),
      premiumTokensUsed: usage.premiumTokensUsed,
      remainingPremiumTokens:
        (plan === "pro" || plan === "beta_pro")
          ? Math.max(0, limits.premiumTokenCap - usage.premiumTokensUsed)
          : 0,
      fullDocTranslations: usage.fullDocTranslations,
      ocrCount: usage.ocrCount,
      month: usage.month,
    };
  }

  static async getGlobalTokenUsage(costPerMillionTokens: number = 0.15): Promise<{
    totalGlobalTokens: number;
    totalGlobalPremiumTokens: number;
    estimatedCost: number;
    perUserBreakdown: Array<{
      userId: number;
      month: string;
      totalTokensUsed: number;
      premiumTokensUsed: number;
      fullDocTranslations: number;
      ocrCount: number;
      estimatedCost: number;
    }>;
  }> {
    const month = getCurrentMonth();

    const allUsage = await db
      .select()
      .from(tokenUsage)
      .where(eq(tokenUsage.month, month));

    let totalGlobalTokens = 0;
    let totalGlobalPremiumTokens = 0;

    const perUserBreakdown = allUsage.map((u) => {
      totalGlobalTokens += u.totalTokensUsed;
      totalGlobalPremiumTokens += u.premiumTokensUsed;
      return {
        userId: u.userId,
        month: u.month,
        totalTokensUsed: u.totalTokensUsed,
        premiumTokensUsed: u.premiumTokensUsed,
        fullDocTranslations: u.fullDocTranslations,
        ocrCount: u.ocrCount,
        estimatedCost: (u.totalTokensUsed / 1_000_000) * costPerMillionTokens,
      };
    });

    return {
      totalGlobalTokens,
      totalGlobalPremiumTokens,
      estimatedCost: (totalGlobalTokens / 1_000_000) * costPerMillionTokens,
      perUserBreakdown,
    };
  }

  static isNearing80Percent(
    totalTokensUsed: number,
    plan: PlanType
  ): boolean {
    if (plan === "admin") return false;
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
    return totalTokensUsed >= limits.monthlyTokenCap * 0.8;
  }

  private static async checkAndNotifyThreshold(
    userId: number,
    totalTokensUsed: number,
    month: string
  ): Promise<void> {
    const dedupKey = `${userId}-${month}`;
    if (notifiedThresholdUsers.has(dedupKey)) return;

    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return;

    const plan = (user.plan || "starter") as PlanType;
    if (!this.isNearing80Percent(totalTokensUsed, plan)) return;

    notifiedThresholdUsers.add(dedupKey);
    const limits = PLAN_LIMITS[plan];
    const usagePercent = (totalTokensUsed / limits.monthlyTokenCap) * 100;
    await NotificationService.notifyTokenThreshold(
      user.username,
      user.email,
      plan,
      usagePercent
    );
  }
}
