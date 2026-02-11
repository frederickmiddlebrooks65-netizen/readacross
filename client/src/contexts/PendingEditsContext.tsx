import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type EditableType = "sentence" | "glossary";

export interface PendingEdit {
  id: number;
  type: EditableType;
  originalValue: string | null;
  newValue: string;
  fieldName: "target" | "definition" | "translation";
  timestamp: number;
}

interface PendingEditsContextType {
  pendingEdits: PendingEdit[];
  sessionId: string;
  addEdit: (edit: Omit<PendingEdit, "timestamp">) => void;
  removeEdit: (id: number, type: EditableType) => void;
  getEditForItem: (id: number, type: EditableType) => PendingEdit | undefined;
  hasEdits: boolean;
  clearAllEdits: () => void;
  getEditCount: () => number;
}

const PendingEditsContext = createContext<PendingEditsContextType | null>(null);

const STORAGE_KEY = "practice_pending_edits";
const SESSION_ID_KEY = "practice_session_id";

function generateSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

interface StoredData {
  sessionId: string;
  pendingEdits: PendingEdit[];
  lastUpdated: number;
}

export function PendingEditsProvider({ children }: { children: ReactNode }) {
  const [pendingEdits, setPendingEdits] = useState<PendingEdit[]>([]);
  const [sessionId, setSessionId] = useState<string>("");

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data: StoredData = JSON.parse(stored);
        const hoursSinceUpdate = (Date.now() - data.lastUpdated) / (1000 * 60 * 60);
        if (hoursSinceUpdate < 24) {
          setPendingEdits(data.pendingEdits);
          setSessionId(data.sessionId);
          return;
        }
      }
    } catch (e) {
      console.error("[PendingEdits] Failed to load from localStorage:", e);
    }
    const newSessionId = generateSessionId();
    setSessionId(newSessionId);
    localStorage.setItem(SESSION_ID_KEY, newSessionId);
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    
    const data: StoredData = {
      sessionId,
      pendingEdits,
      lastUpdated: Date.now(),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [pendingEdits, sessionId]);

  const addEdit = useCallback((edit: Omit<PendingEdit, "timestamp">) => {
    setPendingEdits((prev) => {
      const existingIndex = prev.findIndex(
        (e) => e.id === edit.id && e.type === edit.type && e.fieldName === edit.fieldName
      );
      
      const newEdit: PendingEdit = {
        ...edit,
        timestamp: Date.now(),
      };

      if (existingIndex >= 0) {
        const updated = [...prev];
        updated[existingIndex] = newEdit;
        return updated;
      }
      
      return [...prev, newEdit];
    });
  }, []);

  const removeEdit = useCallback((id: number, type: EditableType) => {
    setPendingEdits((prev) => prev.filter((e) => !(e.id === id && e.type === type)));
  }, []);

  const getEditForItem = useCallback(
    (id: number, type: EditableType): PendingEdit | undefined => {
      return pendingEdits.find((e) => e.id === id && e.type === type);
    },
    [pendingEdits]
  );

  const clearAllEdits = useCallback(() => {
    setPendingEdits([]);
    const newSessionId = generateSessionId();
    setSessionId(newSessionId);
    localStorage.removeItem(STORAGE_KEY);
  }, []);

  const getEditCount = useCallback(() => pendingEdits.length, [pendingEdits]);

  return (
    <PendingEditsContext.Provider
      value={{
        pendingEdits,
        sessionId,
        addEdit,
        removeEdit,
        getEditForItem,
        hasEdits: pendingEdits.length > 0,
        clearAllEdits,
        getEditCount,
      }}
    >
      {children}
    </PendingEditsContext.Provider>
  );
}

export function usePendingEdits() {
  const context = useContext(PendingEditsContext);
  if (!context) {
    throw new Error("usePendingEdits must be used within a PendingEditsProvider");
  }
  return context;
}
