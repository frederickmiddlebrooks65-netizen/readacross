import { storage } from "../storage.js";

export class AdminService {
  /**
   * Clear translation cache with pattern support
   */
  static async clearTranslationCache(pattern?: string): Promise<{ success: boolean; message: string }> {
    let cleared: number;
    
    if (pattern) {
      // Clear specific translations matching pattern
      cleared = await storage.clearTranslationCache(pattern);
      return {
        success: true,
        message: `Cleared ${cleared} translations matching pattern: ${pattern}`,
      };
    } else {
      // Clear all translation cache
      cleared = await storage.clearAllTranslationCache();
      return {
        success: true,
        message: `Cleared all ${cleared} cached translations`,
      };
    }
  }

  /**
   * Get admin documents with filtering and pagination
   */
  static async getAdminDocuments(filters: {
    search?: string;
    category?: string;
    type?: string;
    page?: number;
    limit?: number;
  }) {
    const processedFilters = {
      search: typeof filters.search === "string" ? filters.search : undefined,
      category: typeof filters.category === "string" ? filters.category : undefined,
      type: typeof filters.type === "string" ? filters.type : undefined,
      page: typeof filters.page === "number" ? filters.page : undefined,
      limit: typeof filters.limit === "number" ? filters.limit : undefined,
    };

    return await storage.getAdminDocuments(processedFilters);
  }

  /**
   * Bulk delete documents with error handling
   */
  static async bulkDeleteDocuments(documentIds: number[]): Promise<{ 
    message: string; 
    deletedCount: number; 
  }> {
    if (!Array.isArray(documentIds) || documentIds.length === 0) {
      throw new Error("Invalid document IDs");
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

    return {
      message: "Documents deleted successfully",
      deletedCount,
    };
  }

  /**
   * Clean up expired documents
   */
  static async cleanupExpiredDocuments(documentIds?: number[]): Promise<{
    message: string;
    deletedCount: number;
  }> {
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

    return {
      message: "Document cleanup completed",
      deletedCount,
    };
  }

  /**
   * Delete single document with validation
   */
  static async deleteDocument(documentId: number): Promise<void> {
    const success = await storage.deleteDocument(documentId);
    if (!success) {
      throw new Error("Document not found");
    }
  }

  /**
   * Get expired documents for cleanup management
   */
  static async getExpiredDocuments() {
    return await storage.getExpiredDocuments();
  }

  /**
   * Update document metadata
   */
  static async updateDocument(documentId: number, updates: {
    title?: string;
    category?: string;
    isPublic?: boolean;
    author?: string;
  }): Promise<void> {
    console.log(`[AdminService] Updating document ${documentId} with:`, updates);
    
    const document = await storage.getDocument(documentId);
    if (!document) {
      throw new Error("Document not found");
    }

    // undefined 값들을 필터링하여 실제 변경된 값만 업데이트
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([_, value]) => value !== undefined)
    );

    console.log(`[AdminService] Filtered updates:`, filteredUpdates);

    if (Object.keys(filteredUpdates).length === 0) {
      console.log(`[AdminService] No valid updates provided for document ${documentId}`);
      return;
    }

    await storage.updateDocument(documentId, filteredUpdates);
    console.log(`[AdminService] Document ${documentId} updated successfully`);
  }

  /**
   * Get admin statistics
   */
  static async getAdminStats() {
    return await storage.getAdminStats();
  }
}