import express from "express";
import multer from "multer";
import { storage } from "../storage.js";
import { ObjectStorageService } from "../objectStorage.js";
import { TokenTrackingService } from "../services/TokenTrackingService.js";
import {
  updateUserProfileSchema,
  updateUserPreferencesSchema,
  insertUserSourceSchema,
  updateUserSourceSchema,
  updateUserLanguageSchema,
  PLAN_LIMITS,
  type UserProfile,
  type UserPreferences,
  type UserSource,
  type UserSession,
} from "@shared/schema";
import { AuthenticatedRequest, authenticateJWT } from "../auth.js";

const router = express.Router();

// Configure multer for avatar uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
  fileFilter: (_req, file, cb) => {
    // Accept only image files
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

const objectStorage = new ObjectStorageService();

// User Profile endpoints
router.get("/profile", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  // Disable caching to ensure fresh data is always returned
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  
  try {
    const userId = req.userId!;
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    let profile = await storage.getUserProfile(userId);
    
    // Create default profile if it doesn't exist
    if (!profile) {
      profile = await storage.createUserProfile({
        userId,
        fullName: user.username, // Use username as default full name
        email: user.email, // Include user's actual email
      });
    }
    
    // Always include the user's actual email from the auth table
    const profileWithEmail = {
      ...profile,
      email: user.email
    };
    
    res.json(profileWithEmail);
  } catch (error) {
    console.error("Error fetching user profile:", error);
    res.status(500).json({ error: "Failed to fetch profile" });
  }
});

router.put("/profile", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    console.log('[PROFILE UPDATE] Request body:', JSON.stringify(req.body));
    console.log('[PROFILE UPDATE] User ID:', userId);
    
    // Clean the data before validation - convert empty strings to null
    const cleanedBody = {
      ...req.body,
      fullName: req.body.fullName === "" ? null : req.body.fullName,
      bio: req.body.bio === "" ? null : req.body.bio,
      avatarUrl: req.body.avatarUrl === "" ? null : req.body.avatarUrl,
    };
    console.log('[PROFILE UPDATE] Cleaned body:', JSON.stringify(cleanedBody));
    
    const result = updateUserProfileSchema.safeParse(cleanedBody);
    
    if (!result.success) {
      console.error("Profile validation failed:", result.error.errors);
      return res.status(400).json({ 
        error: "Invalid profile data", 
        details: result.error.errors 
      });
    }
    
    // Check if profile exists, create if not
    let profile = await storage.getUserProfile(userId);
    if (!profile) {
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      profile = await storage.createUserProfile({
        userId,
        ...result.data,
      });
    } else {
      profile = await storage.updateUserProfile(userId, result.data);
      if (!profile) {
        return res.status(404).json({ error: "Failed to update profile" });
      }
    }
    
    res.json(profile);
  } catch (error) {
    console.error("Error updating user profile:", error);
    res.status(500).json({ error: "Failed to update profile" });
  }
});

// User Language Preferences endpoint (Phase 1: Language-Agnostic)
router.patch("/language", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    console.log('[LANGUAGE UPDATE] Request body:', JSON.stringify(req.body));
    console.log('[LANGUAGE UPDATE] User ID:', userId);
    
    const result = updateUserLanguageSchema.safeParse(req.body);
    
    if (!result.success) {
      console.error('[LANGUAGE UPDATE] Validation failed:', result.error.errors);
      return res.status(400).json({ 
        error: "Invalid language data", 
        details: result.error.errors 
      });
    }
    
    // Update only language fields on the user record
    const updatedUser = await storage.updateUser(userId, {
      baseLanguage: result.data.baseLanguage,
      learningLanguage: result.data.learningLanguage,
    });
    
    if (!updatedUser) {
      return res.status(404).json({ error: "User not found" });
    }
    
    console.log('[LANGUAGE UPDATE] Success - baseLanguage:', result.data.baseLanguage, 'learningLanguage:', result.data.learningLanguage);
    res.json({ 
      baseLanguage: updatedUser.baseLanguage,
      learningLanguage: updatedUser.learningLanguage,
    });
  } catch (error: any) {
    console.error("Error updating user language:", error);
    res.status(500).json({ error: "Failed to update language preferences", details: error?.message });
  }
});

// Get current user language preferences
router.get("/language", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const user = await storage.getUser(userId);
    
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    
    res.json({ 
      baseLanguage: user.baseLanguage,
      learningLanguage: user.learningLanguage,
    });
  } catch (error: any) {
    console.error("Error fetching user language:", error);
    res.status(500).json({ error: "Failed to fetch language preferences" });
  }
});

// User Preferences endpoints
router.get("/preferences", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    let preferences = await storage.getUserPreferences(userId);
    
    // Create default preferences if they don't exist
    if (!preferences) {
      preferences = await storage.createUserPreferences({
        userId,
      });
    }
    
    res.json(preferences);
  } catch (error) {
    console.error("Error fetching user preferences:", error);
    res.status(500).json({ error: "Failed to fetch preferences" });
  }
});

router.put("/preferences", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    console.log('[PREFERENCES UPDATE] Request body:', JSON.stringify(req.body));
    console.log('[PREFERENCES UPDATE] User ID:', userId);
    
    const result = updateUserPreferencesSchema.safeParse(req.body);
    
    if (!result.success) {
      console.error('[PREFERENCES UPDATE] Validation failed:', result.error.errors);
      return res.status(400).json({ 
        error: "Invalid preferences data", 
        details: result.error.errors 
      });
    }
    
    // Check if preferences exist, create if not
    let preferences = await storage.getUserPreferences(userId);
    console.log('[PREFERENCES UPDATE] Existing preferences:', preferences ? 'found' : 'not found');
    
    if (!preferences) {
      console.log('[PREFERENCES UPDATE] Creating new preferences');
      preferences = await storage.createUserPreferences({
        userId,
        ...result.data,
      });
    } else {
      console.log('[PREFERENCES UPDATE] Updating existing preferences');
      preferences = await storage.updateUserPreferences(userId, result.data);
      if (!preferences) {
        return res.status(404).json({ error: "Failed to update preferences" });
      }
    }
    
    console.log('[PREFERENCES UPDATE] Success');
    res.json(preferences);
  } catch (error: any) {
    console.error("Error updating user preferences:", error);
    console.error("Error stack:", error?.stack);
    console.error("Error message:", error?.message);
    res.status(500).json({ error: "Failed to update preferences", details: error?.message });
  }
});

// User Sources endpoints
router.get("/sources", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const sources = await storage.getUserSources(userId);
    res.json(sources);
  } catch (error) {
    console.error("Error fetching user sources:", error);
    res.status(500).json({ error: "Failed to fetch sources" });
  }
});

router.post("/sources", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const result = insertUserSourceSchema.safeParse({
      ...req.body,
      userId,
    });
    
    if (!result.success) {
      return res.status(400).json({ 
        error: "Invalid source data", 
        details: result.error.errors 
      });
    }
    
    const source = await storage.createUserSource(result.data);
    res.status(201).json(source);
  } catch (error) {
    console.error("Error creating user source:", error);
    res.status(500).json({ error: "Failed to create source" });
  }
});

router.put("/sources/:id", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const sourceId = parseInt(req.params.id);
    
    // Check ownership
    const existingSource = await storage.getUserSource(sourceId);
    if (!existingSource || existingSource.userId !== userId) {
      return res.status(404).json({ error: "Source not found" });
    }
    
    const result = updateUserSourceSchema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ 
        error: "Invalid source data", 
        details: result.error.errors 
      });
    }
    
    const source = await storage.updateUserSource(sourceId, result.data);
    if (!source) {
      return res.status(404).json({ error: "Failed to update source" });
    }
    
    res.json(source);
  } catch (error) {
    console.error("Error updating user source:", error);
    res.status(500).json({ error: "Failed to update source" });
  }
});

router.delete("/sources/:id", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const sourceId = parseInt(req.params.id);
    
    // Check ownership
    const existingSource = await storage.getUserSource(sourceId);
    if (!existingSource || existingSource.userId !== userId) {
      return res.status(404).json({ error: "Source not found" });
    }
    
    const success = await storage.deleteUserSource(sourceId);
    if (!success) {
      return res.status(404).json({ error: "Failed to delete source" });
    }
    
    res.json({ message: "Source deleted successfully" });
  } catch (error) {
    console.error("Error deleting user source:", error);
    res.status(500).json({ error: "Failed to delete source" });
  }
});

// User Sessions endpoints
router.get("/sessions", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const sessions = await storage.getUserSessions(userId);
    res.json(sessions);
  } catch (error) {
    console.error("Error fetching user sessions:", error);
    res.status(500).json({ error: "Failed to fetch sessions" });
  }
});

router.delete("/sessions/:id", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const sessionId = parseInt(req.params.id);
    
    // Check ownership
    const existingSession = await storage.getUserSession(sessionId);
    if (!existingSession || existingSession.userId !== userId) {
      return res.status(404).json({ error: "Session not found" });
    }
    
    const success = await storage.deleteUserSession(sessionId);
    if (!success) {
      return res.status(404).json({ error: "Failed to delete session" });
    }
    
    res.json({ message: "Session deleted successfully" });
  } catch (error) {
    console.error("Error deleting user session:", error);
    res.status(500).json({ error: "Failed to delete session" });
  }
});

// Cleanup expired sessions
router.post("/sessions/cleanup", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const deletedCount = await storage.cleanupExpiredSessions();
    res.json({ message: `Cleaned up ${deletedCount} expired sessions` });
  } catch (error) {
    console.error("Error cleaning up sessions:", error);
    res.status(500).json({ error: "Failed to cleanup sessions" });
  }
});

// Avatar upload endpoint
router.post("/profile/avatar", authenticateJWT, upload.single('avatar'), async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Validate file type
    if (!req.file.mimetype.startsWith('image/')) {
      return res.status(400).json({ error: "File must be an image" });
    }

    // Validate file size (5MB max)
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: "File too large (max 5MB)" });
    }

    // Process and upload image
    const fileName = `avatar_${userId}_${Date.now()}.webp`;
    const thumbnailPath = await objectStorage.uploadThumbnail(
      req.file.buffer, 
      'image/webp', 
      fileName
    );
    
    const avatarUrl = await objectStorage.getThumbnailUrl(thumbnailPath);
    
    // Update the user profile with the new avatar URL
    let profile = await storage.getUserProfile(userId);
    if (!profile) {
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }
      
      profile = await storage.createUserProfile({
        userId,
        avatarUrl,
      });
    } else {
      profile = await storage.updateUserProfile(userId, { avatarUrl });
      if (!profile) {
        return res.status(404).json({ error: "Failed to update profile" });
      }
    }
    
    res.json({ avatarUrl });
  } catch (error) {
    console.error("Error uploading avatar:", error);
    res.status(500).json({ error: "Failed to upload avatar" });
  }
});

// GET /me/usage - Get current user's token usage for the month
router.get("/me/usage", authenticateJWT, async (req: AuthenticatedRequest, res) => {
  try {
    const userId = req.userId!;
    const user = await storage.getUser(userId);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    const plan = (user.plan || "starter") as "starter" | "pro" | "admin";
    const snapshot = await TokenTrackingService.getUsageSnapshot(userId, plan);
    const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.starter;
    const nearingLimit = TokenTrackingService.isNearing80Percent(snapshot.totalTokensUsed, plan);

    res.json({
      ...snapshot,
      limits: {
        monthlyTokenCap: limits.monthlyTokenCap,
        premiumTokenCap: limits.premiumTokenCap,
        maxConcurrentDocuments: limits.maxConcurrentDocuments,
        maxFullDocTranslations: limits.maxFullDocTranslations,
        maxOcr: limits.maxOcr,
        canExport: limits.canExport,
      },
      nearingLimit,
    });
  } catch (error) {
    console.error("Error fetching usage:", error);
    res.status(500).json({ error: "Failed to fetch usage data" });
  }
});

export default router;