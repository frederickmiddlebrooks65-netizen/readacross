import { Router, type Request, type Response } from "express";
import { storage } from "../storage.js";
import { db } from "../db.js";
import { documents, paragraphs, sentences } from "@shared/schema";
import { eq, inArray, and, isNotNull, asc } from "drizzle-orm";
// Guardian and NPR crawlers removed
import { seedPublicLibrary } from "../seed.js";
import { authenticateJWT, optionalAuthenticateJWT, type AuthenticatedRequest } from "../auth.js";
import {
  processRSSArticles,
  validateRSSFeed,
  convertRSSArticleToDocument,
  syncAllActiveFeeds,
  // regenerateAnchorsForRSSDocuments, // Removed - no regeneration during retrieval
} from "../rssCrawler.js";
import rateLimit from "express-rate-limit";
import { crawlerScheduler } from "../scheduler.js";
import { SENTENCE_TOKENIZER_VERSION } from "../utils/textUtils.js";
import { CURRENT_ANCHOR_SCHEMA_VERSION } from "../utils/anchorUtils.js";

const router = Router();

// API Routes - Documents
router.get("/documents", async (_req: any, res: any) => {
  try {
    const documents = await storage.getAllDocuments();
    // Filter to show only user documents (not public library content)
    const userDocuments = documents.filter((doc: any) => !doc.isPublic);
    res.json(userDocuments);
  } catch (error) {
    console.error("Error fetching documents:", error);
    res.status(500).json({ message: "Failed to fetch documents" });
  }
});

// API Routes - Public Library
router.get("/library/explore", async (req: any, res: any) => {
  try {
    const { category, difficulty, sortBy = "latest", page = "1", limit = "24" } = req.query;

    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 24));
    const offset = (pageNum - 1) * limitNum;

    if (category && category !== "all") {
      console.log(`[CATEGORY_DEBUG] Filtering by category: ${category}`);
    }

    const publicDocuments = await storage.getPublicLibraryDocuments({
      category: category as string,
      difficulty: difficulty as string,
      sortBy: sortBy as string,
      limit: limitNum,
      offset,
    });

    const lightweightDocs = publicDocuments.map((doc: any) => ({
      id: doc.id,
      title: doc.title,
      source: doc.source,
      author: doc.author,
      category: doc.category,
      difficulty: doc.difficulty,
      tags: doc.tags,
      originalUrl: doc.originalUrl,
      thumbnailUrl: doc.thumbnailUrl,
      originalImageUrl: doc.originalImageUrl,
      dominantColor: doc.dominantColor,
      blurhash: doc.blurhash,
      isPublic: doc.isPublic,
      createdAt: doc.createdAt,
      publishedAt: doc.publishedAt,
      sourceLanguage: doc.sourceLanguage,
      feedId: doc.feedId,
      snippetContent: doc.snippet || doc.rawContent?.substring(0, 500) || '',
      wordCount: doc.wordCount || null,
    }));

    res.json(lightweightDocs);
  } catch (error) {
    console.error("Error fetching public library documents:", error);
    res.status(500).json({ message: "Failed to fetch library documents" });
  }
});

router.get("/library/recommendations", optionalAuthenticateJWT, async (req: AuthenticatedRequest, res: any) => {
  try {
    const userId = req.user?.id;
    const MINIMUM_DOCS_FOR_PERSONALIZATION = 3;
    
    let userLibraryCount = 0;
    let userCategories: string[] = [];
    let userKeywords: string[] = [];
    
    if (userId) {
      const userDocs = await storage.getUserDocuments({ userId });
      userLibraryCount = userDocs.length;
      
      if (userLibraryCount >= MINIMUM_DOCS_FOR_PERSONALIZATION) {
        const categoryCount: Record<string, number> = {};
        const keywordSet = new Set<string>();
        
        for (const doc of userDocs) {
          if (doc.category) {
            categoryCount[doc.category] = (categoryCount[doc.category] || 0) + 1;
          }
          
          if (doc.title) {
            const titleWords = doc.title
              .toLowerCase()
              .split(/\s+/)
              .filter((w: string) => w.length > 3 && !['the', 'and', 'for', 'with', 'from'].includes(w));
            titleWords.forEach((w: string) => keywordSet.add(w));
          }
        }
        
        userCategories = Object.entries(categoryCount)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([cat]) => cat);
        
        userKeywords = Array.from(keywordSet).slice(0, 10);
      }
    }
    
    const allPublicDocs = await storage.getPublicLibraryDocuments({
      sortBy: "recent",
    });
    
    let recommendedDocs: any[];
    
    if (userLibraryCount < MINIMUM_DOCS_FOR_PERSONALIZATION) {
      recommendedDocs = allPublicDocs
        .sort((a: any, b: any) => {
          const scoreA = (a.savedCount || 0) + (a.viewCount || 0) * 0.1;
          const scoreB = (b.savedCount || 0) + (b.viewCount || 0) * 0.1;
          return scoreB - scoreA;
        })
        .slice(0, 6);
    } else {
      const scoredDocs = allPublicDocs.map((doc: any) => {
        let score = 0;
        
        if (doc.category && userCategories.includes(doc.category)) {
          const categoryIndex = userCategories.indexOf(doc.category);
          score += (3 - categoryIndex) * 10;
        }
        
        if (doc.title && userKeywords.length > 0) {
          const titleLower = doc.title.toLowerCase();
          for (const keyword of userKeywords) {
            if (titleLower.includes(keyword)) {
              score += 5;
            }
          }
        }
        
        score += (doc.savedCount || 0) * 2;
        score += (doc.viewCount || 0) * 0.1;
        
        const createdAt = new Date(doc.createdAt || Date.now());
        const daysSinceCreated = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceCreated < 7) score += 3;
        else if (daysSinceCreated < 30) score += 1;
        
        return { ...doc, recommendationScore: score };
      });
      
      recommendedDocs = scoredDocs
        .sort((a: any, b: any) => b.recommendationScore - a.recommendationScore)
        .slice(0, 6);
    }
    
    const documentIds = recommendedDocs.map((doc: any) => doc.id);
    
    const snippetData = await db
      .select({
        documentId: paragraphs.documentId,
        source: sentences.source,
        paragraphOrder: paragraphs.order,
        sentenceOrder: sentences.order,
      })
      .from(sentences)
      .innerJoin(paragraphs, eq(sentences.paragraphId, paragraphs.id))
      .where(inArray(paragraphs.documentId, documentIds.length > 0 ? documentIds : [0]))
      .orderBy(asc(paragraphs.documentId), asc(paragraphs.order), asc(sentences.order));

    const snippetMap = new Map<number, string>();
    for (const row of snippetData) {
      const existing = snippetMap.get(row.documentId) || '';
      const currentSentences = existing.split('. ').filter(s => s.length > 0);
      if (currentSentences.length < 25) {
        snippetMap.set(row.documentId, existing + (existing ? ' ' : '') + row.source);
      }
    }

    const enrichedRecommendations = recommendedDocs.map((doc: any) => ({
      ...doc,
      snippetContent: snippetMap.get(doc.id) || doc.rawContent || '',
    }));
    
    res.json({
      recommendations: enrichedRecommendations,
      isPersonalized: userLibraryCount >= MINIMUM_DOCS_FOR_PERSONALIZATION,
      userLibraryCount,
    });
  } catch (error) {
    console.error("Error fetching recommendations:", error);
    res.status(500).json({ message: "Failed to fetch recommendations" });
  }
});

// Seed Gutenberg books
router.post("/library/seed-gutenberg", async (_req: any, res: any) => {
  try {
    const { seedGutenbergBooks } = await import("../gutenbergCrawler.js");
    await seedGutenbergBooks();
    res.json({ message: "Successfully seeded Gutenberg books" });
  } catch (error) {
    console.error("Error seeding Gutenberg books:", error);
    res.status(500).json({ message: "Failed to seed Gutenberg books" });
  }
});

// Seed arXiv papers
router.post("/library/seed-arxiv", async (_req: any, res: any) => {
  try {
    const { seedArxivPapers } = await import("../arxivCrawler.js");
    await seedArxivPapers();
    res.json({ message: "Successfully seeded arXiv papers" });
  } catch (error) {
    console.error("Error seeding arXiv papers:", error);
    res.status(500).json({ message: "Failed to seed arXiv papers" });
  }
});

// Update existing document categories to English
router.post("/library/update-categories", async (_req: any, res: any) => {
  try {
    const updates = [
      { from: "뉴스", to: "News" },
      { from: "문학", to: "Literature" },
      { from: "논문", to: "Academic" },
      { from: "에세이/오피니언", to: "Essays" },
      { from: "칼럼·에세이", to: "Essays" },
      { from: "교육", to: "Academic" }, // Educational -> Academic
      { from: "기타", to: "Essays" }, // Other -> Essays
      { from: "classic", to: "Literature" },
      { from: "science", to: "Academic" },
      { from: "Non-fiction", to: "Essays" }, // Non-fiction -> Essays
      { from: "Opinion", to: "Essays" }, // Old Opinion -> Essays
      { from: "Other", to: "Essays" }, // Old Other -> Essays
      { from: "Educational", to: "Academic" }, // Old Educational -> Academic
    ];

    let totalUpdated = 0;

    for (const update of updates) {
      const result = await db
        .update(documents)
        .set({ category: update.to })
        .where(eq(documents.category, update.from))
        .returning({ id: documents.id });

      totalUpdated += result.length;
    }

    res.json({
      message: `Successfully updated ${totalUpdated} document categories to English`,
      updatedCount: totalUpdated,
    });
  } catch (error) {
    console.error("Error updating categories:", error);
    res.status(500).json({ message: "Failed to update categories" });
  }
});

// Migrate RSS documents to use proper feed titles
router.post("/library/migrate-rss-sources", async (_req: any, res: any) => {
  try {
    // Find all RSS documents with generic "RSS" source (even without feedId)
    const rssDocuments = await db
      .select()
      .from(documents)
      .where(eq(documents.source, "RSS"));

    console.log(`Found ${rssDocuments.length} RSS documents to migrate`);

    let updatedCount = 0;
    const allFeeds = await storage.getAllRSSFeeds();

    for (const doc of rssDocuments) {
      try {
        let feedToUse = null;

        // Method 1: Try to get feed by feedId if it exists
        if (doc.feedId) {
          feedToUse = await storage.getRSSFeedById(doc.feedId);
        }

        // Method 2: If no feedId or feed not found, try to match by URL domain
        if (!feedToUse && doc.originalUrl) {
          feedToUse = allFeeds.find(feed => {
            try {
              const feedDomain = new URL(feed.canonicalUrl).hostname;
              const docDomain = new URL(doc.originalUrl!).hostname;
              return feedDomain === docDomain;
            } catch {
              return false;
            }
          });
        }

        // Method 3: Try to match by similar titles or content patterns
        if (!feedToUse) {
          // For documents from WIRED, look for WIRED feed
          if (doc.originalUrl?.includes('wired.com')) {
            feedToUse = allFeeds.find(feed => feed.title?.toLowerCase().includes('wired'));
          }
          // For documents from HitRecord, look for Joe's Journal
          else if (doc.originalUrl?.includes('hitrecord.org')) {
            feedToUse = allFeeds.find(feed => feed.title?.toLowerCase().includes("joe"));
          }
        }

        if (feedToUse && feedToUse.title) {
          // Update the document source with the feed title and set feedId if missing
          const updateData: any = { source: feedToUse.title };
          if (!doc.feedId && feedToUse.id) {
            updateData.feedId = feedToUse.id;
          }

          await db
            .update(documents)
            .set(updateData)
            .where(eq(documents.id, doc.id));

          updatedCount++;
          console.log(`Updated document ${doc.id} source to: ${feedToUse.title}`);
        }
      } catch (error) {
        console.error(`Failed to update document ${doc.id}:`, error);
      }
    }

    res.json({
      message: `Successfully migrated ${updatedCount} RSS document sources`,
      totalFound: rssDocuments.length,
      updatedCount,
    });
  } catch (error) {
    console.error("Error migrating RSS sources:", error);
    res.status(500).json({ message: "Failed to migrate RSS sources" });
  }
});

// Cleanup expired documents
router.post("/library/cleanup", async (_req: any, res: any) => {
  try {
    const deletedCount = await storage.cleanupExpiredDocuments();
    res.json({
      message: `Successfully cleaned up ${deletedCount} expired documents`,
      deletedCount,
    });
  } catch (error) {
    console.error("Error cleaning up documents:", error);
    res.status(500).json({ message: "Failed to clean up documents" });
  }
});

// Manual delete public library document (admin only)
router.delete("/library/documents/:id", async (req: any, res: any) => {
  try {
    const documentId = parseInt(req.params.id);

    // Verify it's a public document
    const document = await storage.getDocument(documentId);
    if (!document) {
      return res.status(404).json({ message: "Document not found" });
    }

    if (!document.isPublic) {
      return res
        .status(403)
        .json({ message: "Can only delete public library documents" });
    }

    const success = await storage.deleteDocument(documentId);

    if (success) {
      res.json({
        success: true,
        message: "Public document deleted successfully",
      });
    } else {
      res.status(500).json({ message: "Failed to delete document" });
    }
  } catch (error) {
    console.error("Error deleting public document:", error);
    res.status(500).json({ message: "Failed to delete document" });
  }
});

// Set expiration dates for existing public documents
router.post("/library/set-expiration-dates", async (_req: any, res: any) => {
  try {
    const updatedCount =
      await storage.setExpirationDatesForExistingDocuments();
    res.json({
      message: `Successfully set expiration dates for ${updatedCount} public documents`,
      updatedCount,
    });
  } catch (error) {
    console.error("Error setting expiration dates:", error);
    res.status(500).json({ message: "Failed to set expiration dates" });
  }
});

// Guardian API test endpoint removed

// Guardian seeding endpoint removed

// NPR RSS test endpoint removed

// NPR seeding endpoint removed

// NPR extraction test endpoint removed

// NPR document update endpoint removed

// Seed entire public library endpoint
router.post("/library/seed", async (req: Request, res: Response) => {
  try {
    console.log("Starting public library seeding...");
    await seedPublicLibrary();

    res.json({
      message: "Successfully seeded public library with all sources",
    });
  } catch (error) {
    console.error("Public library seeding error:", error);
    res.status(500).json({ message: "Failed to seed public library" });
  }
});

// Admin routes
router.get("/admin/stats", async (_req: Request, res: Response) => {
  try {
    const stats = await storage.getAdminStats();
    res.json(stats);
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    res.status(500).json({ message: "Failed to fetch admin stats" });
  }
});

router.get("/admin/documents", async (req: Request, res: Response) => {
  try {
    const { search, category, type, page, limit } = req.query;
    const filters = {
      search: typeof search === "string" ? search : undefined,
      category: typeof category === "string" ? category : undefined,
      type: typeof type === "string" ? type : undefined,
      page: typeof page === "string" ? parseInt(page) : undefined,
      limit: typeof limit === "string" ? parseInt(limit) : undefined,
    };

    const result = await storage.getAdminDocuments(filters);
    res.json(result);
  } catch (error) {
    console.error("Error fetching admin documents:", error);
    res.status(500).json({ message: "Failed to fetch admin documents" });
  }
});

// Admin: Delete document
router.delete(
  "/admin/documents/:id",
  authenticateJWT,
  async (req: Request, res: Response) => {
    try {
      const documentId = parseInt(req.params.id);

      // Use storage interface to properly delete document with cascade
      const success = await storage.deleteDocument(documentId);

      if (!success) {
        return res.status(404).json({ error: "Document not found" });
      }

      res.json({ message: "Document deleted successfully" });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  },
);

// Admin: Bulk delete documents
router.post(
  "/admin/documents/bulk-delete",
  authenticateJWT,
  async (req: Request, res: Response) => {
    try {
      const { documentIds } = req.body;

      if (!Array.isArray(documentIds) || documentIds.length === 0) {
        return res.status(400).json({ error: "Invalid document IDs" });
      }

      // Delete documents one by one to ensure proper cascade deletion
      let deletedCount = 0;
      for (const documentId of documentIds) {
        try {
          const success = await storage.deleteDocument(documentId);
          if (success) {
            deletedCount++;
          }
        } catch (error) {
          console.error(`Failed to delete document ${documentId}:`, error);
          // Continue with other documents
        }
      }

      res.json({
        message: "Documents deleted successfully",
        deletedCount,
      });
    } catch (error) {
      console.error("Error bulk deleting documents:", error);
      res.status(500).json({ error: "Failed to bulk delete documents" });
    }
  },
);

// Admin: Bulk update category
router.post(
  "/admin/documents/bulk-update-category",
  authenticateJWT,
  async (req: Request, res: Response) => {
    try {
      const { documentIds, category } = req.body;

      if (!Array.isArray(documentIds) || documentIds.length === 0) {
        return res.status(400).json({ error: "Invalid document IDs" });
      }

      if (!category) {
        return res.status(400).json({ error: "Category is required" });
      }

      // Update the documents' category
      await db
        .update(documents)
        .set({ category })
        .where(inArray(documents.id, documentIds));

      res.json({
        message: "Documents category updated successfully",
        updatedCount: documentIds.length,
      });
    } catch (error) {
      console.error("Error bulk updating category:", error);
      res.status(500).json({ error: "Failed to bulk update category" });
    }
  },
);

// Admin: Bulk update source
router.post(
  "/admin/documents/bulk-update-source",
  authenticateJWT,
  async (req: Request, res: Response) => {
    try {
      const { documentIds, source } = req.body;

      if (!Array.isArray(documentIds) || documentIds.length === 0) {
        return res.status(400).json({ error: "Invalid document IDs" });
      }

      if (!source) {
        return res.status(400).json({ error: "Source is required" });
      }

      // Update the documents' source
      await db
        .update(documents)
        .set({ source })
        .where(inArray(documents.id, documentIds));

      res.json({
        message: "Documents source updated successfully",
        updatedCount: documentIds.length,
      });
    } catch (error) {
      console.error("Error bulk updating source:", error);
      res.status(500).json({ error: "Failed to bulk update source" });
    }
  },
);

// Document cleanup and expiration management
router.get(
  "/admin/expired-documents",
  async (_req: Request, res: Response) => {
    try {
      const expiredDocuments = await storage.getExpiredDocuments();
      res.json(expiredDocuments);
    } catch (error) {
      console.error("Error fetching expired documents:", error);
      res.status(500).json({ message: "Failed to fetch expired documents" });
    }
  },
);

router.post(
  "/admin/cleanup-expired",
  async (_req: Request, res: Response) => {
    try {
      const deletedCount = await storage.cleanupExpiredDocuments();
      res.json({
        message: `Successfully cleaned up ${deletedCount} expired documents`,
        deletedCount,
      });
    } catch (error) {
      console.error("Error cleaning up expired documents:", error);
      res
        .status(500)
        .json({ message: "Failed to cleanup expired documents" });
    }
  },
);

router.post(
  "/admin/set-expiration-dates",
  async (_req: Request, res: Response) => {
    try {
      const updatedCount =
        await storage.setExpirationDatesForExistingDocuments();
      res.json({
        message: `Successfully set expiration dates for ${updatedCount} documents`,
        updatedCount,
      });
    } catch (error) {
      console.error("Error setting expiration dates:", error);
      res.status(500).json({ message: "Failed to set expiration dates" });
    }
  },
);

// Scheduler management endpoints
router.get(
  "/admin/scheduler/status",
  async (_req: Request, res: Response) => {
    try {
      const status = crawlerScheduler.getStatus();
      res.json(status);
    } catch (error) {
      console.error("Error getting scheduler status:", error);
      res.status(500).json({ message: "Failed to get scheduler status" });
    }
  },
);

router.post(
  "/admin/scheduler/trigger-sync",
  async (req: Request, res: Response) => {
    try {
      const { type } = req.body;
      const sourceType = type as 'all' | 'rss' | 'system';

      const result = await crawlerScheduler.triggerManualSync(sourceType);

      if (result.success) {
        res.json({
          message: `Manual sync completed for ${sourceType}`,
          timestamp: result.timestamp,
          sourceType,
        });
      } else {
        res.status(500).json({
          message: `Manual sync failed for ${sourceType}`,
          error: result.error,
          sourceType,
        });
      }
    } catch (error) {
      console.error("Error triggering manual sync:", error);
      res.status(500).json({ message: "Failed to trigger manual sync" });
    }
  },
);

router.post(
  "/admin/scheduler/restart",
  async (_req: Request, res: Response) => {
    try {
      // Stop all current jobs
      crawlerScheduler.stopAll();

      // Wait a moment
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Restart schedulers
      crawlerScheduler.startRSSScheduler();
      crawlerScheduler.startUnifiedScheduler();

      const status = crawlerScheduler.getStatus();

      res.json({
        message: "Scheduler restarted successfully",
        status,
      });
    } catch (error) {
      console.error("Error restarting scheduler:", error);
      res.status(500).json({ message: "Failed to restart scheduler" });
    }
  },
);

router.post(
  "/admin/scheduler/stop",
  async (_req: Request, res: Response) => {
    try {
      crawlerScheduler.stopAll();

      const status = crawlerScheduler.getStatus();

      res.json({
        message: "All scheduled jobs stopped",
        status,
      });
    } catch (error) {
      console.error("Error stopping scheduler:", error);
      res.status(500).json({ message: "Failed to stop scheduler" });
    }
  },
);

// System management endpoint
router.get("/admin/system-status", async (_req: Request, res: Response) => {
  try {
    const status = crawlerScheduler.getStatus();
    res.json({ 
      system: {
        isRunning: status.isRunning || false,
        lastRun: status.lastRun || null,
        nextRun: status.nextRun || null,
        scheduler: {
          isRunning: status.isRunning || false,
          lastRun: status.lastRun || null,
          nextRun: status.nextRun || null,
        }
      }
    });
  } catch (error) {
    console.error("Error getting system status:", error);
    res.status(500).json({ message: "Failed to get system status" });
  }
});

// RSS Feed management
router.get("/admin/feeds", async (_req: Request, res: Response) => {
  try {
    const feeds = await storage.getAllRSSFeeds();
    res.json(feeds);
  } catch (error) {
    console.error("Error getting RSS feeds:", error);
    res.status(500).json({ message: "Failed to get RSS feeds" });
  }
});

// RSS Feed health endpoint
router.get("/admin/feeds/health", async (_req: Request, res: Response) => {
  try {
    const feeds = await storage.getAllRSSFeeds();

    // Calculate health metrics for all feeds
    const healthData = {
      totalFeeds: feeds.length,
      activeFeedsCount: feeds.filter(f => !f.isBlocked).length,
      healthyFeedsCount: feeds.filter(f => (f.healthScore || 0) >= 80).length,
      errorFeedsCount: feeds.filter(f => (f.errorCount || 0) > 3).length,
      averageHealthScore: feeds.length > 0 ? 
        feeds.reduce((sum, f) => sum + (f.healthScore || 0), 0) / feeds.length : 0,
      lastSyncTime: feeds.reduce((latest, f) => {
        const feedTime = f.lastRunAt ? new Date(f.lastRunAt).getTime() : 0;
        return Math.max(latest, feedTime);
      }, 0)
    };

    res.json(healthData);
  } catch (error) {
    console.error("Error getting RSS feed health:", error);
    res.status(500).json({ message: "Failed to get RSS feed health" });
  }
});

// Get RSS feed by ID (global Feed)
router.get("/admin/feeds/:id", async (req: Request, res: Response) => {
  try {
    const feedId = parseInt(req.params.id);

    const feed = await storage.getRSSFeedById(feedId);
    if (!feed) {
      return res.status(404).json({ message: "RSS feed not found" });
    }

    res.json(feed);
  } catch (error) {
    console.error("Error getting RSS feed:", error);
    res.status(500).json({ message: "Failed to get RSS feed" });
  }
});

// Update RSS feed (global Feed)
router.patch("/admin/feeds/:id", async (req: Request, res: Response) => {
  try {
    const feedId = parseInt(req.params.id);

    const updatedFeed = await storage.updateNewRSSFeed(feedId, {
      ...req.body,
    });

    if (!updatedFeed) {
      return res.status(404).json({ message: "RSS feed not found" });
    }

    res.json(updatedFeed);
  } catch (error) {
    console.error("Error updating RSS feed:", error);
    res.status(500).json({ message: "Failed to update RSS feed" });
  }
});

// Bulk operations on RSS feeds
router.post("/admin/feeds/bulk-action", async (req: Request, res: Response) => {
  try {
    const { feedIds, action, data } = req.body;

    if (!Array.isArray(feedIds) || feedIds.length === 0) {
      return res.status(400).json({ message: "feedIds is required" });
    }

    // Validate feed IDs exist
    const feeds = await Promise.all(
      feedIds.map((id) => storage.getRSSFeedById(parseInt(id))),
    );

    const validFeeds = feeds.filter(Boolean);
    if (validFeeds.length !== feedIds.length) {
      return res.status(400).json({
        message: "Some feed IDs are invalid",
        validCount: validFeeds.length,
        totalCount: feedIds.length,
      });
    }

    let result;
    switch (action) {
      case "sync":
        await syncAllActiveFeeds();
        result = { message: "Bulk sync triggered for all active feeds" };
        break;

      default:
        return res.status(400).json({ message: "Invalid action" });
    }

    res.json(result);
  } catch (error) {
    console.error("Error in bulk feed action:", error);
    res.status(500).json({ message: "Failed to perform bulk action" });
  }
});

// Get RSS subscriptions
router.get("/admin/subscriptions", async (req: Request, res: Response) => {
  try {
    const subscriptions = await storage.getRSSSubscriptions(
      req.query.feedId ? parseInt(req.query.feedId as string) : undefined,
    );
    res.json(subscriptions);
  } catch (error) {
    console.error("Error getting RSS subscriptions:", error);
    res.status(500).json({ message: "Failed to get RSS subscriptions" });
  }
});

// RSS Policy management
router.get("/admin/rss-policy", async (_req: Request, res: Response) => {
  try {
    const policy = await storage.getRSSPolicy();
    res.json(policy);
  } catch (error) {
    console.error("Error getting RSS policy:", error);
    res.status(500).json({ message: "Failed to get RSS policy" });
  }
});

router.patch("/admin/rss-policy", async (req: Request, res: Response) => {
  try {
    const updatedPolicy = await storage.updateRSSPolicy(req.body);
    res.json(updatedPolicy);
  } catch (error) {
    console.error("Error updating RSS policy:", error);
    res.status(500).json({ message: "Failed to update RSS policy" });
  }
});

// Save document to library from explore
router.post("/library/save", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  console.log("[SAVE_TO_LIBRARY] Save to library request received");

  const {
    documentId,
    title,
    author,
    sourceLanguage,
    sourceType,
    origin,
  } = req.body;

  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ error: "Authentication required" });
  }

  if (!title) {
    return res.status(400).json({ error: "Title is required" });
  }

  if (!documentId) {
    return res.status(400).json({ error: "Document ID is required" });
  }

  try {
    // Get the original document
    const originalDoc = await storage.getDocument(documentId);
    if (!originalDoc) {
      return res.status(404).json({ error: "Original document not found" });
    }

    // Check if document already exists in user's library (only active documents)
    const existingUploadDocs = await storage.getUserUploadDocuments({
      userId: userId,
      status: "active",
    });
    const existingSavedDocs = await storage.getUserSavedDocuments({
      userId: userId,
      status: "active",
    });
    const allUserDocs = [...existingUploadDocs, ...existingSavedDocs];

    const existingDoc = allUserDocs.find(
      (doc: any) => doc.title === title && doc.author === author,
    );

    if (existingDoc) {
      return res.status(409).json({
        error: "Document already exists in library",
        message: "This document has already been saved to your library",
      });
    }

    // ✅ Phase 2 Implementation: Use new single library creation function
    console.log(`[SAVE_TO_LIBRARY] Using Phase 2 createLibraryFromExplore for document ${documentId}`);

    // Import DocumentService
    const { DocumentService } = await import("../services/DocumentService.js");

    // Use new single function to create library document
    const libraryDocument = await DocumentService.createLibraryFromExplore({
      originalDocument: originalDoc as any,
      userId: userId,
      title: title,
      author: author
    });

    // Copy thumbnail information separately after document creation
    if (
      originalDoc.thumbnailUrl ||
      originalDoc.thumbnailPath ||
      originalDoc.thumbnailStatus
    ) {
      await storage.updateDocument(libraryDocument.id, {
        thumbnailUrl: originalDoc.thumbnailUrl || undefined,
        thumbnailPath: originalDoc.thumbnailPath || undefined,
        thumbnailStatus: originalDoc.thumbnailStatus || undefined,
        originalImageUrl: originalDoc.originalImageUrl || undefined,
        dominantColor: originalDoc.dominantColor || undefined,
      });
    }

    console.log(
      "[SAVE_TO_LIBRARY] Document saved successfully with Phase 2 pipeline:",
      libraryDocument.id,
    );

    // Phase 1 Fix: Include redirect information in response
    res.json({ 
      success: true, 
      document: libraryDocument,
      redirectUrl: `/viewer/${libraryDocument.id}`,
      newDocumentId: libraryDocument.id
    });
  } catch (error) {
    console.error("[SAVE_TO_LIBRARY] Error saving document:", error);
    res.status(500).json({ error: "Failed to save document to library" });
  }
});


// Thumbnail API routes
router.get("/thumbnails/:filename", async (req: Request, res: Response) => {
  try {
    const filename = req.params.filename;
    const privateObjectDir = process.env.PRIVATE_OBJECT_DIR;
    if (!privateObjectDir) {
      return res.status(500).json({ error: "Object storage not configured" });
    }

    const { ObjectStorageService } = await import("../objectStorage.js");
    const objectStorageService = new ObjectStorageService();

    const thumbnailPath = `${privateObjectDir}/thumbnails/${filename}`;
    const file = await objectStorageService.getThumbnailFile(thumbnailPath);
    await objectStorageService.downloadObject(file, res);
  } catch (error) {
    console.error("Error serving thumbnail:", error);
    res.status(404).json({ error: "Thumbnail not found" });
  }
});

// Process thumbnail extraction for a document (async job)
router.post(
  "/documents/:id/extract-thumbnail",
  async (req: Request, res: Response) => {
    try {
      const documentId = parseInt(req.params.id);
      const { sourceType, sourceData } = req.body;

      // Validate inputs
      if (!sourceType || !sourceData) {
        return res
          .status(400)
          .json({ error: "sourceType and sourceData are required" });
      }

      // Update document status to processing
      await storage.updateDocument(documentId, {
        thumbnailStatus: "processing",
      });

      // Start async thumbnail extraction
      setImmediate(async () => {
        try {
          const { ThumbnailService } = await import("../thumbnailService.js");
          const thumbnailService = new ThumbnailService();

          const result = await thumbnailService.extractThumbnail(
            sourceType,
            sourceData,
          );

          // Update document with thumbnail info
          const updateData: any = {
            thumbnailStatus: result.status,
            originalImageUrl: result.originalImageUrl || null,
            dominantColor: result.dominantColor || null,
          };

          if (result.thumbnailPath && result.thumbnailUrl) {
            updateData.thumbnailPath = result.thumbnailPath;
            updateData.thumbnailUrl = result.thumbnailUrl;
          }

          await storage.updateDocument(documentId, updateData);
          console.log(
            `Thumbnail extraction completed for document ${documentId}: ${result.status}`,
          );
        } catch (error) {
          console.error(
            `Thumbnail extraction failed for document ${documentId}:`,
            error,
          );
          await storage.updateDocument(documentId, {
            thumbnailStatus: "failed",
          });
        }
      });

      res.json({ success: true, message: "Thumbnail extraction started" });
    } catch (error) {
      console.error("Error starting thumbnail extraction:", error);
      res.status(500).json({ error: "Failed to start thumbnail extraction" });
    }
  },
);

// RSS Feed CRUD endpoints
router.get("/rss-feeds", async (_req: Request, res: Response) => {
  try {
    const feeds = await storage.getAllRSSFeeds();
    // Filter out system sources - only return user-added feeds
    const userFeeds = feeds.filter(feed => !feed.isSystemSource);
    res.json(userFeeds);
  } catch (error) {
    console.error("Error getting RSS feeds:", error);
    res.status(500).json({ message: "Failed to get RSS feeds" });
  }
});

router.post("/rss-feeds", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { feedUrl, category, alias, language, syncInterval, isActive } = req.body;

    if (!feedUrl) {
      return res.status(400).json({ message: "feedUrl is required" });
    }

    const policy = await storage.getRSSPolicy();

    if (policy?.blockedDomains) {
      try {
        const blockedDomains: string[] = JSON.parse(policy.blockedDomains);
        const feedDomain = new URL(feedUrl).hostname.toLowerCase();
        if (blockedDomains.some(domain => feedDomain === domain || feedDomain.endsWith(`.${domain}`))) {
          return res.status(400).json({ message: "This domain is not allowed" });
        }
      } catch (e) {
        console.warn("[RSS_CREATE] Failed to parse blockedDomains:", e);
      }
    }

    const userSubscriptions = await storage.getRSSSubscriptions(userId);
    const maxFeeds = policy?.maxFeedsPerUser ?? 10;
    if (userSubscriptions.length >= maxFeeds) {
      return res.status(403).json({ message: `Feed limit reached. You can add up to ${maxFeeds} feeds.` });
    }

    // Validate RSS feed
    const isValid = await validateRSSFeed(feedUrl);
    if (!isValid) {
      return res.status(400).json({ message: "Invalid RSS feed URL" });
    }

    // Fetch RSS feed metadata to get actual title
    let feedTitle = alias || "RSS Feed";
    let feedDescription = null;

    try {
      const Parser = (await import('rss-parser')).default;
      const parser = new Parser();
      const feed = await parser.parseURL(feedUrl);
      feedTitle = alias || feed.title || "RSS Feed";
      feedDescription = feed.description || null;
      console.log(`[RSS_CREATE] Fetched feed metadata: title="${feedTitle}", description="${feedDescription?.substring(0, 100)}..."`);
    } catch (error) {
      console.warn(`[RSS_CREATE] Failed to fetch feed metadata, using fallback title: ${feedTitle}`);
    }

    const shouldBlock = policy?.requireApproval === true;

    // Create RSS feed using storage
    const crypto = await import('crypto');
    const newFeed = await storage.createNewRSSFeed({
      canonicalUrl: feedUrl,
      normalizedUrlHash: crypto.createHash('sha256').update(feedUrl).digest('hex'),
      title: feedTitle,
      description: feedDescription,
      language: language || "en",
      category: category || "News",
      etag: null,
      lastModified: null,
      healthScore: 100,
      lastRunAt: null,
      lastStatus: shouldBlock ? "pending" : "pending",
      errorCount: 0,
      lastError: null,
      isBlocked: shouldBlock,
      isSystemSource: false
    });

    try {
      await storage.createRSSSubscription({
        feedId: newFeed.id,
        userId: userId,
        alias: feedTitle,
        visibility: "private",
        enabled: true,
        userTags: null,
        notifyPolicy: "none",
        syncInterval: syncInterval || 12,
      });
    } catch (subError) {
      console.warn(`[RSS_CREATE] Failed to create subscription for user ${userId}:`, subError);
    }

    if (!shouldBlock) {
      try {
        console.log(`[RSS_CREATE] Starting immediate crawling for new feed: ${newFeed.id}`);
        await processRSSArticles(newFeed.id);
        console.log(`[RSS_CREATE] Completed crawling for feed: ${newFeed.id}`);
      } catch (crawlingError) {
        console.error(`[RSS_CREATE] Failed to crawl new feed ${newFeed.id}:`, crawlingError);
      }
    } else {
      console.log(`[RSS_CREATE] Feed ${newFeed.id} requires approval, skipping immediate crawling`);
    }

    res.status(201).json(newFeed);
  } catch (error) {
    console.error("Error creating RSS feed:", error);
    res.status(500).json({ message: "Failed to create RSS feed" });
  }
});

router.patch("/rss-feeds/:id", async (req: Request, res: Response) => {
  try {
    const feedId = parseInt(req.params.id);
    const { title, category } = req.body;

    const updatedFeed = await storage.updateNewRSSFeed(feedId, {
      title,
      category
    });

    if (!updatedFeed) {
      return res.status(404).json({ message: "RSS feed not found" });
    }

    res.json(updatedFeed);
  } catch (error) {
    console.error("Error updating RSS feed:", error);
    res.status(500).json({ message: "Failed to update RSS feed" });
  }
});

router.delete("/rss-feeds/:id", async (req: Request, res: Response) => {
  try {
    const feedId = parseInt(req.params.id);

    const success = await storage.deleteNewRSSFeed(feedId);
    if (!success) {
      return res.status(404).json({ message: "RSS feed not found" });
    }

    res.json({ message: "RSS feed deleted successfully" });
  } catch (error) {
    console.error("Error deleting RSS feed:", error);
    res.status(500).json({ message: "Failed to delete RSS feed" });
  }
});

router.post("/rss-feeds/:id/sync", async (req: Request, res: Response) => {
  try {
    const feedId = parseInt(req.params.id);

    // Trigger sync for specific feed
    await syncAllActiveFeeds(); // For now, sync all feeds

    res.json({ message: "RSS feed sync triggered successfully" });
  } catch (error) {
    console.error("Error syncing RSS feed:", error);
    res.status(500).json({ message: "Failed to sync RSS feed" });
  }
});

export default router;