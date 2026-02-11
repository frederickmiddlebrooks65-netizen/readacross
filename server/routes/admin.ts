import { Router } from "express";
import { storage } from "../storage.js";
import { AdminService } from "../services/AdminService.js";
import { DocumentService } from "../services/DocumentService.js";
import { authenticateJWT, requireRole, type AuthenticatedRequest } from "../auth.js";
import type { Request, Response } from "express";

const router = Router();

// Clear translation cache for testing improved translations (development only)
router.post("/clear-translation-cache", authenticateJWT, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { pattern } = req.body;
    const result = await AdminService.clearTranslationCache(pattern);
    res.json(result);
  } catch (error) {
    console.error("Error clearing translation cache:", error);
    res.status(500).json({ error: "Failed to clear translation cache" });
  }
});

// Get admin statistics
router.get("/stats", authenticateJWT, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const stats = await AdminService.getAdminStats();
    res.json(stats);
  } catch (error) {
    console.error("Error fetching admin stats:", error);
    res.status(500).json({ message: "Failed to fetch admin stats" });
  }
});

// Get admin documents with filtering and pagination
router.get("/documents", authenticateJWT, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { search, category, type, page, limit } = req.query;
    const filters = {
      search: typeof search === "string" ? search : undefined,
      category: typeof category === "string" ? category : undefined,
      type: typeof type === "string" ? type : undefined,
      page: typeof page === "string" ? parseInt(page) : undefined,
      limit: typeof limit === "string" ? parseInt(limit) : undefined,
    };

    const result = await AdminService.getAdminDocuments(filters);
    res.json(result);
  } catch (error) {
    console.error("Error fetching admin documents:", error);
    res.status(500).json({ message: "Failed to fetch admin documents" });
  }
});

// Admin: Update document
router.patch(
  "/documents/:id",
  authenticateJWT,
  requireRole(['admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      // Validate Content-Type
      const contentType = req.headers['content-type'];
      if (!contentType || !contentType.includes('application/json')) {
        console.log(`[ADMIN] Invalid Content-Type: ${contentType}`);
        return res.status(415).json({ 
          error: "Content-Type must be application/json" 
        });
      }

      console.log('[DEBUG ROUTE] Request body:', req.body);
      console.log('[DEBUG ROUTE] Content-Type:', contentType);
      
      const documentId = parseInt(req.params.id);
      const { title, category, isPublic, author } = req.body;
      
      console.log('[DEBUG ROUTE] Extracted fields:', { title, category, isPublic, author });

      // Validate that at least one field is provided
      if (!title && !category && isPublic === undefined && !author) {
        return res.status(400).json({
          error: "At least one field (title, category, isPublic, author) must be provided"
        });
      }

      await AdminService.updateDocument(documentId, {
        title,
        category,
        isPublic,
        author,
      });

      res.json({ message: "Document updated successfully" });
    } catch (error) {
      console.error("Error updating document:", error);
      if (error instanceof Error && error.message === "Document not found") {
        res.status(404).json({ error: "Document not found" });
      } else {
        res.status(500).json({ error: "Failed to update document" });
      }
    }
  },
);

// Admin: Preview document deletion (what will be deleted)
router.get(
  "/documents/:id/delete-preview",
  authenticateJWT,
  requireRole(['admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const documentId = parseInt(req.params.id);
      const preview = await DocumentService.previewDocumentDeletion(documentId);
      res.json(preview);
    } catch (error) {
      console.error("Error previewing document deletion:", error);
      if (error instanceof Error && error.message === "Document not found") {
        res.status(404).json({ error: "Document not found" });
      } else {
        res.status(500).json({ error: "Failed to preview document deletion" });
      }
    }
  },
);

// Admin: Delete document (with safe deletion)
router.delete(
  "/documents/:id",
  authenticateJWT,
  requireRole(['admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const documentId = parseInt(req.params.id);
      const { skipPreview } = req.query;

      // Use new safe deletion method
      const result = await DocumentService.deleteDocumentSafely(documentId, {
        skipPreview: skipPreview === 'true',
      });

      if (!result.success) {
        return res.status(500).json({ 
          error: "Failed to delete document",
          details: result.errors 
        });
      }

      res.json({ 
        message: "Document deleted successfully",
        deletedCounts: result.deletedCounts,
        duration: result.duration 
      });
    } catch (error) {
      console.error("Error deleting document:", error);
      res.status(500).json({ error: "Failed to delete document" });
    }
  },
);

// Admin: Bulk delete documents
router.post(
  "/documents/bulk-delete",
  authenticateJWT,
  requireRole(['admin']),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { documentIds } = req.body;

      if (!Array.isArray(documentIds) || documentIds.length === 0) {
        return res.status(400).json({ error: "Invalid document IDs" });
      }

      // Delete documents one by one using safe deletion method
      let deletedCount = 0;
      const errors: string[] = [];
      
      for (const documentId of documentIds) {
        try {
          const result = await DocumentService.deleteDocumentSafely(documentId, {
            skipPreview: true, // Skip preview for bulk operations
          });
          
          if (result.success) {
            deletedCount++;
          } else {
            errors.push(`Document ${documentId}: ${result.errors?.join(', ') || 'Unknown error'}`);
          }
        } catch (error) {
          console.error(`Failed to delete document ${documentId}:`, error);
          errors.push(`Document ${documentId}: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }

      res.json({
        message: "Documents deleted successfully",
        deletedCount,
        totalRequested: documentIds.length,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error) {
      console.error("Error bulk deleting documents:", error);
      res.status(500).json({ error: "Failed to bulk delete documents" });
    }
  },
);

// Get expired documents for cleanup management
router.get("/documents/expired", authenticateJWT, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const expiredDocuments = await storage.getExpiredDocuments();
    res.json(expiredDocuments);
  } catch (error) {
    console.error("Error fetching expired documents:", error);
    res.status(500).json({ message: "Failed to fetch expired documents" });
  }
});

// Clean up expired documents
router.post("/documents/cleanup", authenticateJWT, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { documentIds } = req.body;
    let deletedCount = 0;

    if (documentIds && Array.isArray(documentIds)) {
      // Clean up specific documents
      for (const documentId of documentIds) {
        try {
          const success = await storage.deleteDocument(documentId);
          if (success) {
            deletedCount++;
          }
        } catch (error) {
          console.error(`Failed to delete document ${documentId}:`, error);
        }
      }
    } else {
      // Clean up all expired documents
      const expiredDocuments = await storage.getExpiredDocuments();
      for (const doc of expiredDocuments) {
        try {
          const success = await storage.deleteDocument(doc.id);
          if (success) {
            deletedCount++;
          }
        } catch (error) {
          console.error(`Failed to delete document ${doc.id}:`, error);
        }
      }
    }

    res.json({
      message: "Document cleanup completed",
      deletedCount,
    });
  } catch (error) {
    console.error("Error during document cleanup:", error);
    res.status(500).json({ message: "Failed to perform document cleanup" });
  }
});

// Admin: Repair broken documents (V2 structure and anchors)
router.post("/documents/repair", authenticateJWT, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    console.log("[Admin API] Starting document repair process...");
    
    const results = await DocumentService.repairBrokenDocuments();
    
    res.json({
      success: true,
      message: "Document repair completed",
      results: {
        processed: results.processed,
        repaired: results.repaired,
        errors: results.errors
      }
    });
  } catch (error) {
    console.error("Error during document repair:", error);
    res.status(500).json({ 
      success: false,
      message: "Failed to repair documents",
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

// Get sync logs
router.get("/sync-logs", authenticateJWT, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const logs = await storage.getSyncLogs(limit);
    res.json(logs);
  } catch (error) {
    console.error("Error fetching sync logs:", error);
    res.status(500).json({ message: "Failed to fetch sync logs" });
  }
});

// Get auto-approval keywords
router.get("/keywords", authenticateJWT, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const keywords = await storage.getAutoApprovalKeywords();
    res.json(keywords);
  } catch (error) {
    console.error("Error fetching auto-approval keywords:", error);
    res.status(500).json({ message: "Failed to fetch keywords" });
  }
});

// Toggle document permanent status
router.patch("/documents/:id/permanent", authenticateJWT, requireRole(['admin']), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const documentId = parseInt(req.params.id);
    const { isPermanent } = req.body;
    
    if (typeof isPermanent !== 'boolean') {
      return res.status(400).json({ error: "isPermanent must be a boolean" });
    }
    
    await storage.updateDocument(documentId, { isPermanent });
    res.json({ message: "Document permanent status updated successfully" });
  } catch (error) {
    console.error("Error updating document permanent status:", error);
    res.status(500).json({ message: "Failed to update document" });
  }
});

export default router;