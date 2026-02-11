import { db } from "./db";
import { noteNotebooks, notebooks, notes, users } from "./schema";
import { eq, asc } from "drizzle-orm";

// Note operations
export async function getNotes(userId: number): Promise<Note[]> {
  console.log(`[GET_NOTES] Fetching notes for user ${userId}`);
  try {
    const result = await db
      .select({
        id: notes.id,
        title: notes.title,
        content: notes.content,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
        notebookId: notes.notebookId,
      })
      .from(notes)
      .where(eq(notes.userId, userId))
      .orderBy(asc(notes.createdAt));
    console.log(`[GET_NOTES] Found ${result.length} notes.`);
    return result as Note[];
  } catch (error) {
    console.error(`[GET_NOTES] Error:`, error);
    throw error;
  }
}

export async function addNote(
  userId: number,
  title: string,
  content: string,
  notebookId?: number
): Promise<Note> {
  console.log(`[ADD_NOTE] Adding new note for user ${userId}`);
  try {
    const result = await db
      .insert(notes)
      .values({ userId, title, content, notebookId })
      .returning();
    console.log(`[ADD_NOTE] Successfully added note with ID: ${result[0].id}`);
    return result[0] as Note;
  } catch (error) {
    console.error(`[ADD_NOTE] Error:`, error);
    throw error;
  }
}

export async function updateNote(
  noteId: number,
  userId: number,
  title: string,
  content: string,
  notebookId?: number
): Promise<Note> {
  console.log(`[UPDATE_NOTE] Updating note ${noteId} for user ${userId}`);
  try {
    const result = await db
      .update(notes)
      .set({ title, content, notebookId, updatedAt: new Date() })
      .where(eq(notes.id, noteId))
      .returning();
    if (result.length === 0) {
      throw new Error(`[UPDATE_NOTE] Note with ID ${noteId} not found for user ${userId}`);
    }
    console.log(`[UPDATE_NOTE] Successfully updated note with ID: ${result[0].id}`);
    return result[0] as Note;
  } catch (error) {
    console.error(`[UPDATE_NOTE] Error:`, error);
    throw error;
  }
}

export async function deleteNote(noteId: number, userId: number): Promise<void> {
  console.log(`[DELETE_NOTE] Deleting note ${noteId} for user ${userId}`);
  try {
    const result = await db.delete(notes).where(eq(notes.id, noteId)).returning();
    if (result.length === 0) {
      throw new Error(`[DELETE_NOTE] Note with ID ${noteId} not found for user ${userId}`);
    }
    console.log(`[DELETE_NOTE] Successfully deleted note with ID: ${noteId}`);
  } catch (error) {
    console.error(`[DELETE_NOTE] Error:`, error);
    throw error;
  }
}

// Notebook operations
export async function getNotebooks(userId: number): Promise<Notebook[]> {
  console.log(`[GET_NOTEBOOKS] Fetching notebooks for user ${userId}`);
  try {
    const result = await db
      .select({
        id: notebooks.id,
        name: notebooks.name,
        createdAt: notebooks.createdAt,
        updatedAt: notebooks.updatedAt,
      })
      .from(notebooks)
      .where(eq(notebooks.userId, userId))
      .orderBy(asc(notebooks.createdAt));
    console.log(`[GET_NOTEBOOKS] Found ${result.length} notebooks.`);
    return result as Notebook[];
  } catch (error) {
    console.error(`[GET_NOTEBOOKS] Error:`, error);
    throw error;
  }
}

export async function addNotebook(
  userId: number,
  name: string
): Promise<Notebook> {
  console.log(`[ADD_NOTEBOOK] Adding new notebook for user ${userId}`);
  try {
    const result = await db
      .insert(notebooks)
      .values({ userId, name })
      .returning();
    console.log(`[ADD_NOTEBOOK] Successfully added notebook with ID: ${result[0].id}`);
    return result[0] as Notebook;
  } catch (error) {
    console.error(`[ADD_NOTEBOOK] Error:`, error);
    throw error;
  }
}

export async function updateNotebook(
  notebookId: number,
  userId: number,
  name: string
): Promise<Notebook> {
  console.log(`[UPDATE_NOTEBOOK] Updating notebook ${notebookId} for user ${userId}`);
  try {
    const result = await db
      .update(notebooks)
      .set({ name, updatedAt: new Date() })
      .where(eq(notebooks.id, notebookId))
      .returning();
    if (result.length === 0) {
      throw new Error(`[UPDATE_NOTEBOOK] Notebook with ID ${notebookId} not found for user ${userId}`);
    }
    console.log(`[UPDATE_NOTEBOOK] Successfully updated notebook with ID: ${result[0].id}`);
    return result[0] as Notebook;
  } catch (error) {
    console.error(`[UPDATE_NOTEBOOK] Error:`, error);
    throw error;
  }
}

export async function deleteNotebook(
  notebookId: number,
  userId: number
): Promise<void> {
  console.log(`[DELETE_NOTEBOOK] Deleting notebook ${notebookId} for user ${userId}`);
  try {
    // First, delete the note-notebook relationships
    await db.delete(noteNotebooks).where(eq(noteNotebooks.notebookId, notebookId));

    // Then, delete the notebook itself
    const result = await db.delete(notebooks).where(eq(notebooks.id, notebookId)).returning();
    if (result.length === 0) {
      throw new Error(`[DELETE_NOTEBOOK] Notebook with ID ${notebookId} not found for user ${userId}`);
    }
    console.log(`[DELETE_NOTEBOOK] Successfully deleted notebook with ID: ${notebookId}`);
  } catch (error) {
    console.error(`[DELETE_NOTEBOOK] Error:`, error);
    throw error;
  }
}

// Note-Notebook relationship operations
export async function addNoteToNotebook(noteId: number, notebookId: number, userId: number): Promise<void> {
  console.log(`[ADD_NOTE_TO_NOTEBOOK] Attempting to add note ${noteId} to notebook ${notebookId} for user ${userId}`);
  try {
    await db
      .insert(noteNotebooks)
      .values({ noteId, notebookId, userId })
      .onConflictDoNothing();
    console.log(`[ADD_NOTE_TO_NOTEBOOK] Successfully added note ${noteId} to notebook ${notebookId}`);
  } catch (error) {
    console.error(`[ADD_NOTE_TO_NOTEBOOK] Error:`, error);
    throw error;
  }
}

export async function removeNoteFromNotebook(
  noteId: number,
  notebookId: number,
  userId: number
): Promise<void> {
  console.log(`[REMOVE_NOTE_FROM_NOTEBOOK] Attempting to remove note ${noteId} from notebook ${notebookId} for user ${userId}`);
  try {
    const result = await db
      .delete(noteNotebooks)
      .where(eq(noteNotebooks.noteId, noteId) && eq(noteNotebooks.notebookId, notebookId))
      .returning();
    if (result.length === 0) {
      throw new Error(`[REMOVE_NOTE_FROM_NOTEBOOK] Relationship not found for note ${noteId} and notebook ${notebookId}`);
    }
    console.log(`[REMOVE_NOTE_FROM_NOTEBOOK] Successfully removed note ${noteId} from notebook ${notebookId}`);
  } catch (error) {
    console.error(`[REMOVE_NOTE_FROM_NOTEBOOK] Error:`, error);
    throw error;
  }
}

export async function getNotesInNotebook(
  notebookId: number,
  userId: number
): Promise<Note[]> {
  console.log(`[GET_NOTES_IN_NOTEBOOK] Fetching notes for notebook ${notebookId} for user ${userId}`);
  try {
    const result = await db
      .select({
        id: notes.id,
        title: notes.title,
        content: notes.content,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
        notebookId: notes.notebookId,
      })
      .from(notes)
      .innerJoin(noteNotebooks, eq(notes.id, noteNotebooks.noteId))
      .where(eq(noteNotebooks.notebookId, notebookId) && eq(notes.userId, userId))
      .orderBy(asc(notes.createdAt));
    console.log(`[GET_NOTES_IN_NOTEBOOK] Found ${result.length} notes.`);
    return result as Note[];
  } catch (error) {
    console.error(`[GET_NOTES_IN_NOTEBOOK] Error:`, error);
    throw error;
  }
}

// User operations
export async function getUserById(userId: number): Promise<User | undefined> {
  console.log(`[GET_USER_BY_ID] Fetching user with ID ${userId}`);
  try {
    const result = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      })
      .from(users)
      .where(eq(users.id, userId));
    if (result.length === 0) {
      console.log(`[GET_USER_BY_ID] User with ID ${userId} not found.`);
      return undefined;
    }
    console.log(`[GET_USER_BY_ID] Found user: ${result[0].email}`);
    return result[0] as User;
  } catch (error) {
    console.error(`[GET_USER_BY_ID] Error:`, error);
    throw error;
  }
}

// Helper types (assuming these are defined elsewhere, e.g., in schema.ts)
// If not, they should be defined here or imported.
interface Note {
  id: number;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
  notebookId: number | null;
}

interface Notebook {
  id: number;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

interface User {
  id: number;
  email: string;
  name: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface NoteNotebooks {
  noteId: number;
  notebookId: number;
  userId: number;
}