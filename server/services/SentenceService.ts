import { storage } from "../storage.js";
import type { Sentence, Notebook } from "@shared/schema";

export class SentenceService {
  /**
   * Get or create document-based notebook for sentence organization
   */
  static async getOrCreateDocumentNotebook(documentId: number): Promise<Notebook> {
    const document = await storage.getDocument(documentId);
    if (!document) {
      throw new Error("Document not found");
    }

    const existingNotebooks = await storage.getAllNotebooks();
    const documentNotebook = existingNotebooks.find(
      (notebook: any) => notebook.title === document.title,
    );

    if (documentNotebook) {
      return documentNotebook;
    }

    // Create new document-based notebook
    const newNotebook = await storage.createNotebook({
      title: document.title,
      description: `Auto-generated notebook for "${document.title}"`,
      userId: null,
      tags: null,
      isPublic: false,
      type: "system",
      documentId: documentId,
    });

    // Add all sentences with notes or scrapped status to the notebook
    const documentWithParagraphs = await storage.getDocumentWithParagraphs(
      documentId,
    );
    if (documentWithParagraphs) {
      for (const paragraph of documentWithParagraphs.paragraphs) {
        for (const sentence of paragraph.sentences) {
          if (sentence.isScrapped || sentence.note) {
            try {
              await storage.addSentenceToNotebook(
                newNotebook.id,
                sentence.id,
              );
            } catch (error) {
              // Ignore duplicate relationship errors
              console.log(
                `Sentence ${sentence.id} already in notebook ${newNotebook.id}`,
              );
            }
          }
        }
      }
    }

    return newNotebook;
  }

  /**
   * Validate anchor consistency for translation updates
   */
  static async validateTranslationAnchorConsistency(
    sentenceId: number,
    translation: string,
  ): Promise<void> {
    const sentence = await storage.getSentence(sentenceId);
    if (!sentence) return;

    const paragraph = await storage.getParagraph(sentence.paragraphId);
    if (!paragraph) return;

    const document = await storage.getDocument(paragraph.documentId);
    if (
      !document ||
      !document.structuredContent ||
      document.structuredVersion !== 2
    ) {
      return;
    }

    try {
      const structuredBlocks =
        typeof document.structuredContent === "string"
          ? JSON.parse(document.structuredContent)
          : document.structuredContent;
      
      const containingBlock = structuredBlocks.find(
        (block: any) =>
          block.anchor &&
          sentenceId >= block.anchor.sentenceStartId &&
          sentenceId <= block.anchor.sentenceEndId,
      );

      if (containingBlock) {
        console.log(
          "[ANCHOR_CONSISTENCY] Server: Translation update validated:",
          {
            documentId: document.id,
            sentenceId: sentenceId,
            blockOrder: containingBlock.order,
            anchorRange: [
              containingBlock.anchor.sentenceStartId,
              containingBlock.anchor.sentenceEndId,
            ],
            translationLength: translation.length,
          },
        );
      } else {
        console.warn(
          "[ANCHOR_CONSISTENCY] Server: Translation update outside anchor ranges:",
          {
            documentId: document.id,
            sentenceId: sentenceId,
            availableAnchors: structuredBlocks
              .filter((b: any) => b.anchor)
              .map((b: any) => ({
                order: b.order,
                range: [
                  b.anchor.sentenceStartId,
                  b.anchor.sentenceEndId,
                ],
              })),
          },
        );
      }
    } catch (error) {
      console.warn(
        "[ANCHOR_CONSISTENCY] Server: Failed to parse structured content for consistency check:",
        error,
      );
    }
  }

  /**
   * Update sentence with automatic notebook management (new schema)
   */
  static async updateSentenceWithNotebook(
    sentenceId: number,
    updateData: any,
  ): Promise<Sentence> {
    // Validate anchor consistency for translation updates
    if (updateData.target || updateData.targetEdited) {
      await this.validateTranslationAnchorConsistency(
        sentenceId,
        updateData.targetEdited || updateData.target,
      );
    }

    // userId should be passed from the route handler via updateData
    const userId = updateData.userId;
    if (!userId) {
      throw new Error("User ID is required for sentence updates");
    }

    // For new schema, handle bookmark state separately
    if (updateData.isScrapped !== undefined) {
      await storage.upsertUserSentenceState({
        userId,
        sentenceId,
        isBookmarked: updateData.isScrapped,
        learningStatus: 'new',
        lastPracticedAt: null,
      });
    }

    // Handle note separately in new schema
    if (updateData.note && updateData.note.trim()) {
      try {
        await storage.upsertNote({
          userId,
          sentenceId,
          content: updateData.note,
          tags: [],
        });
      } catch (error) {
        console.error("Error adding note:", error);
      }
    }

    // Update the actual sentence (target or targetEdited)
    const sentenceUpdates: any = {};
    if (updateData.target) {
      sentenceUpdates.target = updateData.target;
    }
    if (updateData.targetEdited !== undefined) {
      sentenceUpdates.targetEdited = updateData.targetEdited;
    }

    if (Object.keys(sentenceUpdates).length > 0) {
      const updatedSentence = await storage.updateSentence(sentenceId, sentenceUpdates);
      if (!updatedSentence) {
        throw new Error("Sentence not found");
      }
      return updatedSentence;
    } else {
      // If no sentence update needed, just return the existing sentence
      const sentence = await storage.getSentence(sentenceId);
      if (!sentence) {
        throw new Error("Sentence not found");
      }
      return sentence;
    }
  }

  /**
   * Process sentence practice session
   */
  static async processPracticeSession(
    sentenceId: number,
    userTranslation?: string,
    feedback?: string,
  ): Promise<Sentence> {
    const updates: any = {
      practiced: true,
      lastPracticedAt: new Date(),
    };

    if (userTranslation) {
      updates.userTranslation = userTranslation;
    }

    if (feedback) {
      updates.note = feedback;
    }

    const updatedSentence = await storage.updateSentence(sentenceId, updates);
    if (!updatedSentence) {
      throw new Error("Sentence not found");
    }

    return updatedSentence;
  }

  /**
   * Toggle sentence favorite status
   */
  static async toggleFavorite(sentenceId: number): Promise<Sentence & { message: string }> {
    const sentence = await storage.getSentence(sentenceId);
    if (!sentence) {
      throw new Error("Sentence not found");
    }

    const updatedSentence = await storage.updateSentence(sentenceId, {
      isFavorite: !(sentence.isFavorite || false),
    });

    if (!updatedSentence) {
      throw new Error("Failed to update sentence");
    }

    return {
      ...updatedSentence,
      message: updatedSentence.isFavorite
        ? "Added to favorites"
        : "Removed from favorites",
    };
  }

  /**
   * Bulk delete sentences
   */
  static async bulkDelete(sentenceIds: number[]): Promise<{ success: boolean; deletedCount: number; message: string }> {
    if (!Array.isArray(sentenceIds) || sentenceIds.length === 0) {
      throw new Error("Invalid sentence IDs provided");
    }

    const success = await storage.bulkDeleteSentences(sentenceIds);

    if (!success) {
      throw new Error("Failed to delete sentences");
    }

    return {
      success: true,
      message: `Successfully deleted ${sentenceIds.length} sentences`,
      deletedCount: sentenceIds.length,
    };
  }
}