import { Router, Response } from "express";
import { authenticateJWT, type AuthenticatedRequest } from "../auth.js";
import { storage } from "../storage.js";
import { z } from "zod";

const router = Router();

const paymentCompleteSchema = z.object({
  paymentId: z.string().min(1),
  merchant_uid: z.string().min(1),
  planType: z.enum(["monthly", "annual"]),
});

router.get("/payment/config", (req, res: Response) => {
  const storeId = process.env.PORTONE_STORE_ID;
  const channelKey = process.env.PORTONE_CHANNEL_KEY;
  
  if (!storeId) {
    console.error("[PAYMENT] PORTONE_STORE_ID not configured");
    return res.status(500).json({ 
      error: "Payment system not configured",
      message: "Payment store ID is not available. Please contact support."
    });
  }
  
  if (!channelKey) {
    console.error("[PAYMENT] PORTONE_CHANNEL_KEY not configured");
    return res.status(500).json({ 
      error: "Payment system not configured",
      message: "Payment channel key is not available. Please contact support."
    });
  }

  console.log(`[PAYMENT] Config requested - storeId: ${storeId.substring(0, 8)}..., channelKey: ${channelKey.substring(0, 15)}...`);
  
  res.json({ storeId, channelKey });
});

router.post("/payment/complete", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const parsed = paymentCompleteSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ 
        error: "Invalid payment data",
        details: parsed.error.issues 
      });
    }

    const { paymentId, merchant_uid, planType } = parsed.data;

    const expectedAmount = planType === "annual" ? 118800 : 14900;
    let isVerified = false;
    let paymentData: any = null;

    try {
      const apiSecret = process.env.PORTONE_API_SECRET;
      if (!apiSecret) {
        throw new Error("PORTONE_API_SECRET not configured");
      }

      const encodedPaymentId = encodeURIComponent(paymentId);
      const paymentResponse = await fetch(`https://api.portone.io/payments/${encodedPaymentId}`, {
        method: "GET",
        headers: {
          "Authorization": `PortOne ${apiSecret}`,
          "Content-Type": "application/json",
        },
      });

      paymentData = await paymentResponse.json();
      console.log(`[PAYMENT] PortOne API response status: ${paymentResponse.status}, data:`, JSON.stringify(paymentData, null, 2));

      if (paymentResponse.ok && paymentData) {
        const status = paymentData.status;
        const amount = paymentData.amount?.total ?? paymentData.totalAmount;

        console.log(`[PAYMENT] Verification check: status=${status}, amount=${amount}, expected=${expectedAmount}`);

        if (status === "PAID" && amount === expectedAmount) {
          isVerified = true;
        } else {
          console.warn(`[PAYMENT] Verification mismatch: status=${status}, amount=${amount}, expected=${expectedAmount}`);
        }
      } else {
        console.error(`[PAYMENT] PortOne API error: HTTP ${paymentResponse.status}`, paymentData);
      }
    } catch (apiError) {
      console.error("[PAYMENT] PortOne API call failed:", apiError);
    }

    if (!isVerified && process.env.NODE_ENV === "development") {
      console.log("[DEV] Test mode: Bypassing payment verification for development");
      isVerified = true;
      paymentData = { status: "PAID", totalAmount: expectedAmount };
    }

    if (!isVerified) {
      return res.status(400).json({
        error: "Payment verification failed",
        message: "Could not verify payment. Please try again or contact support.",
      });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const expiresAt = new Date();
    if (planType === "annual") {
      expiresAt.setFullYear(expiresAt.getFullYear() + 1);
    } else {
      expiresAt.setMonth(expiresAt.getMonth() + 1);
    }

    await storage.updateUser(userId, { 
      plan: "pro",
      planType: planType === "annual" ? "pro_annual" : "pro_monthly",
      planExpiresAt: expiresAt,
    });

    console.log(`[PAYMENT] User ${userId} upgraded to Pro (${planType}). paymentId: ${paymentId}, merchant_uid: ${merchant_uid}, expires: ${expiresAt.toISOString()}`);

    res.json({
      success: true,
      message: "Payment verified successfully. Your account has been upgraded to Pro!",
      plan: "pro",
      paymentId,
      merchant_uid,
    });
  } catch (error) {
    console.error("Payment completion error:", error);
    res.status(500).json({
      error: "Payment processing failed",
      message: "An error occurred while processing your payment. Please contact support.",
    });
  }
});

router.get("/payment/status", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({
      plan: user.plan === "beta_pro" ? "pro" : user.plan,
      isPro: user.plan === "pro" || user.plan === "admin" || user.plan === "beta_pro",
    });
  } catch (error) {
    console.error("Payment status check error:", error);
    res.status(500).json({ error: "Failed to check payment status" });
  }
});

export default router;
