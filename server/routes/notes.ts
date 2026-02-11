import { Router } from "express";
import { storage } from "../storage.js";
import { authenticateJWT, type AuthenticatedRequest } from "../auth.js";
import { z } from "zod";
import type { Response } from "express";
import { NOTE_COLORS } from "@shared/schema";
import { LanguageDetectionService } from "../services/LanguageDetectionService.js";

// Define valid colors for notes/highlights - using shared type definition
const colorSchema = z.enum(NOTE_COLORS).default("yellow");

const router = Router();

// Get all notes for a document
router.get("/notes/document/:documentId", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const documentId = parseInt(req.params.documentId);
    
    console.log(`[DOCUMENT_NOTES] Fetching notes for document ${documentId}, user: ${userId}`);
    
    if (!userId) {
      console.error('[DOCUMENT_NOTES] No userId found in authenticated request');
      return res.status(401).json({ error: "User authentication required" });
    }

    if (isNaN(documentId)) {
      return res.status(400).json({ error: "Invalid document ID" });
    }

    // Get all notes for the document from storage
    const notes = await storage.getNotesForDocument(documentId, userId);
    console.log(`[DOCUMENT_NOTES] Found ${notes.length} notes for document ${documentId}`);
    res.json(notes);
  } catch (error) {
    console.error("Error fetching document notes:", error);
    res.status(500).json({ error: "Failed to fetch document notes" });
  }
});

// Get all notebooks for current user
router.get("/notebooks", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    console.log(`[NOTEBOOKS] Fetching notebooks for user: ${userId}`);
    console.log(`[NOTEBOOKS] Auth headers:`, {
      authorization: req.headers.authorization ? 'Present' : 'Missing',
      userId: req.userId,
      user: req.user ? 'Present' : 'Missing'
    });

    if (!userId) {
      console.error('[NOTEBOOKS] No userId found in authenticated request');
      return res.status(401).json({ error: "User authentication required" });
    }

    const notebooks = await storage.getNotebooks(userId);
    console.log(`[NOTEBOOKS] Found ${notebooks.length} notebooks for user ${userId}`);
    res.json(notebooks);
  } catch (error) {
    console.error("Error fetching notebooks:", error);
    res.status(500).json({ error: "Failed to fetch notebooks" });
  }
});

// Create a new notebook
router.post("/notebooks", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { title, name, description, tags, isPublic, colorLabel, groupId } = req.body;
  const notebookTitle = title || name; // Accept both for compatibility

  console.log(`[NOTEBOOK_CREATE] Creating notebook with:`, {
    title: notebookTitle, description, tags, isPublic, colorLabel, groupId
  });

  if (!notebookTitle || !notebookTitle.trim()) {
    return res.status(400).json({ error: "Notebook title is required" });
  }

  // Check if a notebook with the same title already exists for this user
  const existingNotebooks = await storage.getNotebooks(userId!);
  const existingNotebook = existingNotebooks.find(
    nb => nb.title.trim().toLowerCase() === notebookTitle.trim().toLowerCase()
  );

  if (existingNotebook) {
    console.log(`[NOTEBOOK_CREATE] Notebook already exists:`, {
      id: existingNotebook.id,
      title: existingNotebook.title,
      userId
    });
    // Return existing notebook instead of creating a duplicate
    return res.status(200).json({
      ...existingNotebook,
      message: '노트북이 이미 존재합니다',
      success: true,
      isExisting: true
    });
  }

  const notebook = await storage.createNotebook({
    userId: userId!,
    title: notebookTitle.trim(),
    description: description?.trim() || "",
    tags: tags || null,
    type: "user",
    documentId: null,
    isPublic: isPublic || false,
    colorLabel: colorLabel || "white", // Use colorLabel from request or default to white
    groupLabel: null,
    groupId: groupId || null,
    groupOrder: 0,
  });

    // Phase 2: Detect and set notebook language (non-blocking)
    const textToDetect = notebookTitle + (description ? ' ' + description : '');
    LanguageDetectionService.detectLanguage(textToDetect).then(async (result) => {
      try {
        await storage.updateNotebookLanguage(notebook.id, result.language);
        console.log(`[NOTEBOOK_LANG] Set language for notebook ${notebook.id}: ${result.language}`);
      } catch (e) {
        console.log(`[NOTEBOOK_LANG] Failed to set language: ${e}`);
      }
    }).catch((e) => console.log(`[NOTEBOOK_LANG] Detection failed: ${e}`));

    res.status(201).json({
      ...notebook,
      message: '새 노트북이 생성되었습니다',
      success: true,
      isExisting: false
    });
  } catch (error) {
    console.error("Error creating notebook:", error);
    res.status(500).json({ error: "Failed to create notebook" });
  }
});

// Add note to a sentence
router.post("/notes", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { sentenceId, content, tags, notebookId, color } = req.body;

    console.log("[NOTE_API] Full request body:", req.body);
    console.log("[NOTE_API] Adding note request:", {
      userId,
      sentenceId,
      content: content ? content.substring(0, 50) + "..." : content,
      tags,
      notebookId,
      color,
    });

    // Updated validation: content can be null for highlight-only notes
    if (!sentenceId) {
      return res.status(400).json({ error: "sentenceId is required" });
    }

    // Auto-assign notebook for highlights if notebookId is null
    let finalNotebookId = notebookId;
    if (!notebookId) {
      // Get the sentence to find its document
      const sentence = await storage.getSentence(sentenceId);
      if (sentence) {
        const paragraph = await storage.getParagraph(sentence.paragraphId);
        if (paragraph) {
          const document = await storage.getDocument(paragraph.documentId);
          if (document) {
            // Look for existing user notebook for this document
            const userNotebooks = await storage.getNotebooks(userId!);
            let documentNotebook = userNotebooks.find(
              (nb: any) => nb.documentId === document.id || nb.title === document.title
            );
            
            if (documentNotebook) {
              finalNotebookId = documentNotebook.id;
              console.log(`[NOTE_API] Found existing document notebook "${documentNotebook.title}" (${finalNotebookId}) for highlight`);
            } else {
              // Create a notebook for this document
              const newNotebook = await storage.createNotebook({
                userId: userId!,
                title: document.title,
                description: `Notes from "${document.title}"`,
                tags: null,
                type: "user",
                documentId: document.id,
                isPublic: false,
                colorLabel: "white",
                groupLabel: null,
                groupId: null,
                groupOrder: 0,
                language: document.sourceLanguage || 'en',
              });
              finalNotebookId = newNotebook.id;
              console.log(`[NOTE_API] Created document notebook "${newNotebook.title}" (${finalNotebookId}) for highlight`);
            }
          }
        }
      }
      
      // Fallback: if no document found, use first notebook or create default
      if (!finalNotebookId) {
        const userNotebooks = await storage.getNotebooks(userId!);
        if (userNotebooks.length > 0) {
          finalNotebookId = userNotebooks[0].id;
          console.log(`[NOTE_API] Fallback: auto-assigned existing notebook ${finalNotebookId} for highlight`);
        } else {
          const defaultNotebook = await storage.createNotebook({
            userId: userId!,
            title: "My Notes",
            description: "Default notebook for notes and highlights",
            tags: null,
            type: "user",
            documentId: null,
            isPublic: false,
            colorLabel: "blue",
            groupLabel: null,
            groupId: null,
            groupOrder: 0,
            language: 'en',
          });
          finalNotebookId = defaultNotebook.id;
          console.log(`[NOTE_API] Fallback: created default notebook ${finalNotebookId} for highlight`);
        }
      }
    }

    // Validate that either content exists or it's a highlight-only note
    if (content === null || content === undefined || content === '') {
      console.log("[NOTE_API] Creating highlight-only note");
    } else if (typeof content !== 'string') {
      return res.status(400).json({ error: "content must be a string or null for highlight-only notes" });
    }

    // Validate color field if provided
    if (color !== undefined) {
      const colorValidation = colorSchema.safeParse(color);
      if (!colorValidation.success) {
        return res.status(400).json({ 
          error: "Invalid color value", 
          allowedColors: ["yellow", "red", "blue", "green", "orange", "purple", "pink"] 
        });
      }
    }

    // Create or update note using new schema (UPSERT with UNIQUE constraint)
    console.log("[NOTE_API] About to call upsertNote with:", { 
      userId: userId!, 
      sentenceId, 
      content: content ? content.substring(0, 50) : content, 
      tags,
      color: color || 'yellow'
    });
    const note = await storage.upsertNote({
      userId: userId!,
      sentenceId,
      content: content || null, // Ensure null for empty content
      color: color || 'yellow', // Default color for highlights
      tags: tags || [],
    });
    console.log("[NOTE_API] Note upserted successfully:", { id: note.id, userId: note.userId, sentenceId: note.sentenceId });

    // Add note to notebook using new note_notebooks relationship
    console.log("[NOTE_API] About to call addNoteToNotebook with:", { noteId: note.id, notebookId: finalNotebookId, userId: userId! });
    try {
      await storage.addNoteToNotebook(note.id, finalNotebookId, userId!);
      console.log(`[NOTE_API] Successfully added note ${note.id} to notebook ${finalNotebookId}`);
    } catch (error) {
      console.error("[NOTE_API] Error adding note to notebook:", error);
      // If notebook linking fails, delete the note and return error
      await storage.deleteNote(note.id);
      return res.status(500).json({ error: "Failed to link note to notebook" });
    }

    console.log("Note created successfully:", note);
    res.status(201).json({
      ...note,
      message: '노트가 성공적으로 추가되었습니다',
      success: true
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorDetails = error.errors.map(err => ({
        field: err.path.join('.'),
        message: err.message,
        code: err.code,
        received: (err as any).received
      }));
      console.error("Zod validation error for notes:", {
        request: req.body,
        errors: errorDetails
      });
      return res
        .status(400)
        .json({
          message: "Validation failed",
          errors: errorDetails,
          details: `Field '${errorDetails[0]?.field}': ${errorDetails[0]?.message}. Received: ${JSON.stringify(errorDetails[0]?.received)}`
        });
    }
    console.error("Error adding note:", error);
    res.status(500).json({ error: "Failed to add note" });
  }
});

// Update an existing note
router.put("/notes/:id", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const noteId = parseInt(req.params.id);
    const { content, tags, color } = req.body;

    console.log(`[NOTE_UPDATE] Received update request for note ${noteId}:`, {
      body: req.body,
      content,
      tags,
      tagsType: typeof tags,
      tagsIsArray: Array.isArray(tags),
      color
    });

    if (!noteId || isNaN(noteId)) {
      return res.status(400).json({ error: "Valid note ID is required" });
    }

    // Allow content to be null for highlight-only notes
    if (content !== null && content !== undefined && typeof content !== 'string') {
      return res.status(400).json({ error: "content must be a string or null for highlight-only notes" });
    }

    // Validate color field if provided
    if (color !== undefined) {
      const colorValidation = colorSchema.safeParse(color);
      if (!colorValidation.success) {
        return res.status(400).json({ 
          error: "Invalid color value", 
          allowedColors: ["yellow", "red", "blue", "green", "orange", "purple", "pink"] 
        });
      }
    }

    // Verify note belongs to user
    const existingNote = await storage.getNote(noteId);
    if (!existingNote || existingNote.userId !== userId) {
      return res.status(404).json({ error: "Note not found" });
    }

    const updateData: Partial<{ content: string | null; tags: string[]; color: "yellow" | "red" | "blue" | "green" | "orange" | "purple" | "pink" | null }> = {};
    if (content !== undefined) {
      updateData.content = content || null;
    }
    if (tags !== undefined) {
      updateData.tags = tags || [];
    }
    if (color !== undefined) {
      updateData.color = color;
    }

    console.log(`[NOTE_UPDATE] Calling storage.updateNote with:`, {
      noteId,
      updateData,
      updateDataTags: updateData.tags,
      tagsIncluded: 'tags' in updateData
    });

    const updatedNote = await storage.updateNote(noteId, updateData);

    if (!updatedNote) {
      return res.status(404).json({ error: "Note not found" });
    }

    res.json({
      ...updatedNote,
      message: '노트가 성공적으로 업데이트되었습니다',
      success: true
    });
  } catch (error) {
    console.error("Error updating note:", error);
    res.status(500).json({ error: "Failed to update note" });
  }
});

// Get recent notes across all notebooks (for empty state)
router.get("/notes/recent", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const limit = parseInt(req.query.limit as string) || 3;

    console.log(`[NOTES_RECENT] Getting recent ${limit} notes for user ${userId}`);

    if (!userId) {
      return res.status(401).json({ error: "User authentication required" });
    }

    const notes = await storage.getRecentNotesAcrossAllNotebooks(userId, limit);
    
    console.log(`[NOTES_RECENT] Found ${notes.length} recent notes`);
    res.json(notes);
  } catch (error) {
    console.error("Error getting recent notes:", error);
    res.status(500).json({ error: "Failed to get recent notes" });
  }
});

// Search notes across all notebooks
router.get("/notes/search", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const query = req.query.query as string;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({ error: "Search query is required" });
    }

    console.log(`[NOTES_SEARCH] Searching notes for user ${userId} with query: "${query}"`);

    const results = await storage.searchNotesAcrossAllNotebooks(userId!, query.trim());
    
    // Transform results for frontend consumption
    const response = Object.values(results).map(result => ({
      notebook: result.notebook,
      sentences: result.sentences,
      count: result.sentences.length
    }));

    console.log(`[NOTES_SEARCH] Found ${response.length} notebooks with matching notes`);
    res.json(response);
  } catch (error) {
    console.error("Error searching notes:", error);
    res.status(500).json({ error: "Failed to search notes" });
  }
});

// Get all notes for current user, optionally filter by sentenceId
router.get("/notes", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { sentenceId } = req.query;
    
    let notes;
    if (sentenceId) {
      console.log(`[NOTES] Getting notes for user ${userId} and sentence ${sentenceId}`);
      notes = await storage.getNotes(userId!, parseInt(sentenceId as string));
    } else {
      console.log(`[NOTES] Getting all notes for user ${userId}`);
      notes = await storage.getNotes(userId!);
    }
    
    console.log(`[NOTES] Found ${notes.length} notes`);
    res.json(notes);
  } catch (error) {
    console.error("Error fetching notes:", error);
    res.status(500).json({ error: "Failed to fetch notes" });
  }
});

// Get all notes for a specific document - MOVED TO documents router to avoid path conflicts

// Get sentences in a specific notebook
router.get("/notebooks/:id/sentences", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const notebookId = parseInt(req.params.id);

    if (!notebookId || isNaN(notebookId)) {
      return res.status(400).json({ error: "Valid notebook ID is required" });
    }

    // Verify notebook belongs to user
    const notebook = await storage.getNotebook(notebookId);
    if (!notebook || notebook.userId !== userId) {
      return res.status(404).json({ error: "Notebook not found" });
    }

    const sentences = await storage.getSentencesInNotebook(notebookId, userId);
    console.log(`Found ${sentences.length} sentences for notebook ${notebookId} (user ${userId})`);
    res.json(sentences);
  } catch (error) {
    console.error("Error fetching notebook sentences:", error);
    res.status(500).json({ error: "Failed to fetch notebook sentences" });
  }
});

// Move notes to another notebook
router.post("/notes/move", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { noteIds, targetNotebookId, sourceNotebookId } = req.body;

    if (!noteIds || !Array.isArray(noteIds) || !targetNotebookId) {
      return res.status(400).json({ error: "noteIds array and targetNotebookId are required" });
    }

    // Verify target notebook belongs to user
    const targetNotebook = await storage.getNotebook(targetNotebookId);
    if (!targetNotebook || targetNotebook.userId !== userId) {
      return res.status(404).json({ error: "Target notebook not found" });
    }

    // Verify source notebook if provided
    if (sourceNotebookId) {
      const sourceNotebook = await storage.getNotebook(sourceNotebookId);
      if (!sourceNotebook || sourceNotebook.userId !== userId) {
        return res.status(404).json({ error: "Source notebook not found" });
      }
    }

    // Move notes (remove from source, add to target)
    for (const noteId of noteIds) {
      // Verify note belongs to user
      const note = await storage.getNote(noteId);
      if (!note || note.userId !== userId) {
        return res.status(404).json({ error: `Note ${noteId} not found` });
      }

      // Remove from source notebook if specified
      if (sourceNotebookId) {
        await storage.removeNoteFromNotebook(noteId, sourceNotebookId, userId);
      }

      // Add to target notebook
      await storage.addNoteToNotebook(noteId, targetNotebookId, userId);
    }

    res.json({
      message: `${noteIds.length} notes moved successfully`,
      success: true,
      movedNotes: noteIds.length
    });
  } catch (error) {
    console.error("Error moving notes:", error);
    res.status(500).json({ error: "Failed to move notes" });
  }
});

// Copy notes to another notebook as independent entries
router.post("/notes/copy", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { noteIds, targetNotebookId } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "User authentication required" });
    }

    if (!noteIds || !Array.isArray(noteIds) || noteIds.length === 0) {
      return res.status(400).json({ error: "noteIds array is required and must not be empty" });
    }

    if (!targetNotebookId || typeof targetNotebookId !== 'number') {
      return res.status(400).json({ error: "targetNotebookId is required" });
    }

    // Use storage function to copy notes as independent entries
    const result = await storage.copyNotesToNotebook(noteIds, targetNotebookId, userId);

    if (!result.success && result.copiedCount === 0) {
      return res.status(400).json({
        error: result.errors.join(', ') || "Failed to copy notes",
        success: false
      });
    }

    res.json({
      message: `${result.copiedCount} notes copied successfully`,
      success: true,
      copiedCount: result.copiedCount,
      newNoteIds: result.newNoteIds,
      errors: result.errors.length > 0 ? result.errors : undefined
    });
  } catch (error) {
    console.error("Error copying notes:", error);
    res.status(500).json({ error: "Failed to copy notes" });
  }
});

// Delete notes from a notebook with context-based deletion policy
router.delete("/notes/bulk", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { noteIds, notebookId } = req.body;

    if (!noteIds || !Array.isArray(noteIds)) {
      return res.status(400).json({ error: "noteIds array is required" });
    }

    if (!notebookId) {
      return res.status(400).json({ error: "notebookId is required for context-based deletion" });
    }

    let deletedCount = 0;
    let removedCount = 0;

    for (const noteId of noteIds) {
      // Verify note belongs to user
      const note = await storage.getNote(noteId);
      if (!note || note.userId !== userId) {
        continue; // Skip unauthorized notes
      }

      // Check how many notebooks this note belongs to
      const noteNotebooks = await storage.getNoteNotebooks(noteId);
      
      if (noteNotebooks.length === 1) {
        // Note only belongs to this notebook - delete completely from notes table
        await storage.deleteNote(noteId);
        deletedCount++;
      } else {
        // Note belongs to multiple notebooks - only remove from current notebook
        await storage.removeNoteFromNotebook(noteId, notebookId, userId);
        removedCount++;
      }
    }

    res.json({
      message: `${deletedCount} notes deleted completely, ${removedCount} notes removed from notebook`,
      success: true,
      deletedNotes: deletedCount,
      removedNotes: removedCount
    });
  } catch (error) {
    console.error("Error deleting notes:", error);
    res.status(500).json({ error: "Failed to delete notes" });
  }
});

// Delete individual note
router.delete("/notes/:id", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const noteId = parseInt(req.params.id);

    if (!noteId || isNaN(noteId)) {
      return res.status(400).json({ error: "Valid note ID is required" });
    }

    // Verify note belongs to user
    const note = await storage.getNote(noteId);
    if (!note || note.userId !== userId) {
      return res.status(404).json({ error: "Note not found" });
    }

    // Delete the note completely
    const success = await storage.deleteNote(noteId);
    
    if (!success) {
      return res.status(500).json({ error: "Failed to delete note" });
    }

    res.json({
      message: 'Note deleted completely',
      success: true,
      deletedNote: note
    });
  } catch (error) {
    console.error("Error deleting note:", error);
    res.status(500).json({ error: "Failed to delete note" });
  }
});

// Update notebook with group information
router.patch("/notebooks/:id", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const notebookId = parseInt(req.params.id);
    const { groupLabel, groupOrder } = req.body;

    if (!notebookId || isNaN(notebookId)) {
      return res.status(400).json({ error: "Valid notebook ID is required" });
    }

    // Verify notebook belongs to user
    const notebook = await storage.getNotebook(notebookId);
    if (!notebook || notebook.userId !== userId) {
      return res.status(404).json({ error: "Notebook not found" });
    }

    const updatedNotebook = await storage.updateNotebook(notebookId, {
      groupLabel: groupLabel === undefined ? notebook.groupLabel : groupLabel,
      groupOrder: groupOrder === undefined ? notebook.groupOrder : groupOrder,
    });

    if (!updatedNotebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }

    res.json({
      ...updatedNotebook,
      message: 'Notebook group updated successfully',
      success: true
    });
  } catch (error) {
    console.error("Error updating notebook group:", error);
    res.status(500).json({ error: "Failed to update notebook group" });
  }
});

// Update notebook (including title, description, colorLabel, etc.)
router.put("/notebooks/:id", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const notebookId = parseInt(req.params.id);
    const { title, description, tags, isPublic, colorLabel, groupId } = req.body;

    console.log(`[NOTEBOOK_UPDATE] Updating notebook ${notebookId} with:`, {
      title, description, tags, isPublic, colorLabel, groupId
    });

    if (!notebookId || isNaN(notebookId)) {
      return res.status(400).json({ error: "Valid notebook ID is required" });
    }

    // Verify notebook belongs to user
    const notebook = await storage.getNotebook(notebookId);
    if (!notebook || notebook.userId !== userId) {
      return res.status(404).json({ error: "Notebook not found" });
    }

    // Prepare update data
    const updateData: Partial<{ title: string; description: string; tags: string | null; isPublic: boolean; colorLabel: string; groupId: number | null }> = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (tags !== undefined) updateData.tags = tags;
    if (isPublic !== undefined) updateData.isPublic = isPublic;
    if (colorLabel !== undefined) updateData.colorLabel = colorLabel;
    if (groupId !== undefined) updateData.groupId = groupId;

    console.log(`[NOTEBOOK_UPDATE] Update data:`, updateData);

    const updatedNotebook = await storage.updateNotebook(notebookId, updateData);

    if (!updatedNotebook) {
      return res.status(404).json({ error: "Notebook not found" });
    }

    console.log(`[NOTEBOOK_UPDATE] Successfully updated notebook ${notebookId}`);

    res.json({
      ...updatedNotebook,
      message: 'Notebook updated successfully',
      success: true
    });
  } catch (error) {
    console.error("Error updating notebook:", error);
    res.status(500).json({ error: "Failed to update notebook" });
  }
});

// DELETE notebook by ID
router.delete("/notebooks/:id", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const notebookId = parseInt(req.params.id);
    const userId = req.userId;

    if (isNaN(notebookId)) {
      return res.status(400).json({ error: "Invalid notebook ID" });
    }

    // Verify notebook belongs to user
    const notebook = await storage.getNotebook(notebookId);
    if (!notebook || notebook.userId !== userId) {
      return res.status(404).json({ error: "Notebook not found" });
    }

    const success = await storage.deleteNotebook(notebookId);
    if (!success) {
      return res.status(500).json({ error: "Failed to delete notebook" });
    }

    console.log(`[NOTEBOOK_DELETE] Successfully deleted notebook ${notebookId}`);
    res.json({ success: true, message: "Notebook deleted successfully" });
  } catch (error) {
    console.error("Error deleting notebook:", error);
    res.status(500).json({ error: "Failed to delete notebook" });
  }
});

// Bulk update notebooks grouping
router.post("/notebooks/reorder", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId;
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: "items array is required" });
    }

    // Verify all notebooks belong to user
    for (const item of items) {
      if (!item.id || typeof item.id !== 'number') {
        return res.status(400).json({ error: "Each item must have a valid id" });
      }

      const notebook = await storage.getNotebook(item.id);
      if (!notebook || notebook.userId !== userId) {
        return res.status(404).json({ error: `Notebook ${item.id} not found` });
      }
    }

    const updatedNotebooks = await storage.updateNotebooksGrouping(items);

    res.json({
      updatedNotebooks,
      message: `${updatedNotebooks.length} notebooks updated successfully`,
      success: true
    });
  } catch (error) {
    console.error("Error reordering notebooks:", error);
    res.status(500).json({ error: "Failed to reorder notebooks" });
  }
});

// NEW LOGICAL GROUPS SYSTEM - Replaces old placeholder system

// Get all groups for current user
router.get("/notebook-groups", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const groups = await storage.getNotebookGroups(req.userId!);
    res.json({ groups });
  } catch (error) {
    console.error('Error fetching groups:', error);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// Create new group
router.post("/notebook-groups", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { name, color = 'blue', icon = '📁' } = req.body;
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Group name is required' });
    }

    // Check if group name already exists for this user
    const existingGroups = await storage.getNotebookGroups(req.userId!);
    if (existingGroups.some(group => group.name === name)) {
      return res.status(400).json({ error: 'Group name already exists' });
    }

    const newGroup = await storage.createNotebookGroup({
      userId: req.userId!,
      name,
      color,
      icon,
      order: 0
    });

    res.json({ success: true, group: newGroup, message: `Group "${name}" created successfully` });
  } catch (error) {
    console.error('Error creating group:', error);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// Update group
router.patch("/notebook-groups/:id", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const groupId = parseInt(req.params.id);
    if (isNaN(groupId)) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    // Verify ownership
    const group = await storage.getNotebookGroup(groupId);
    if (!group || group.userId !== req.userId) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const updatedGroup = await storage.updateNotebookGroup(groupId, req.body);
    if (!updatedGroup) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ success: true, group: updatedGroup });
  } catch (error) {
    console.error('Error updating group:', error);
    res.status(500).json({ error: 'Failed to update group' });
  }
});

// Delete group
router.delete("/notebook-groups/:id", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const groupId = parseInt(req.params.id);
    if (isNaN(groupId)) {
      return res.status(400).json({ error: 'Invalid group ID' });
    }

    // Verify ownership
    const group = await storage.getNotebookGroup(groupId);
    if (!group || group.userId !== req.userId) {
      return res.status(404).json({ error: 'Group not found' });
    }

    const success = await storage.deleteNotebookGroup(groupId);
    if (!success) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ success: true, message: `Group "${group.name}" deleted successfully` });
  } catch (error) {
    console.error('Error deleting group:', error);
    res.status(500).json({ error: 'Failed to delete group' });
  }
});

// Move notebook to group (or ungroup)
router.patch("/notebooks/:id/group", authenticateJWT, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const notebookId = parseInt(req.params.id);
    const { groupId } = req.body; // can be null to ungroup

    if (isNaN(notebookId)) {
      return res.status(400).json({ error: 'Invalid notebook ID' });
    }

    // Verify notebook ownership
    const notebook = await storage.getNotebook(notebookId);
    if (!notebook || notebook.userId !== req.userId) {
      return res.status(404).json({ error: 'Notebook not found' });
    }

    // If groupId provided, verify group ownership
    if (groupId) {
      const group = await storage.getNotebookGroup(groupId);
      if (!group || group.userId !== req.userId) {
        return res.status(404).json({ error: 'Group not found' });
      }
    }

    const updatedNotebook = await storage.updateNotebook(notebookId, { groupId } as any);
    if (!updatedNotebook) {
      return res.status(404).json({ error: 'Notebook not found' });
    }

    res.json({ success: true, notebook: updatedNotebook });
  } catch (error) {
    console.error('Error moving notebook:', error);
    res.status(500).json({ error: 'Failed to move notebook' });
  }
});


export default router;