import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { X, Plus, FileText, Check, ChevronDown, Trash2, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { DocumentWithParagraphs } from "@/lib/types.d";
import { Note } from "@/lib/types.d";

interface SentenceForNote {
  id: number;
  source: string;
  target?: string | null;
  documentTitle?: string;
  paragraphId: number;
  documentId?: number; // Added for cache invalidation
}

interface Notebook {
  id: number;
  title: string;
  description: string | null;
  tags?: string | null;
  type?: string;
  documentId?: number | null;
  isPublic?: boolean;
  colorLabel?: string | null;
  groupLabel?: string | null;
  groupId?: number | null;
  groupOrder?: number;
  createdAt?: string;
  updatedAt?: string;
}

interface AddNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  sentence: SentenceForNote;
  selectedText?: string; // For glossary creation
}

interface AddGlossaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedText: string;
  contextSentence: string;
}

// Remove local type definitions - using imported types instead


export default function AddNoteModal({ isOpen, onClose, sentence }: AddNoteModalProps) {
  const [noteText, setNoteText] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [selectedNotebookIds, setSelectedNotebookIds] = useState<string[]>([]);
  const [showNewNotebookForm, setShowNewNotebookForm] = useState(false);
  const [newNotebookTitle, setNewNotebookTitle] = useState("");
  const [newNotebookDescription, setNewNotebookDescription] = useState("");
  const [currentNote, setCurrentNote] = useState<Note | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  
  // Ref for autofocus on note textarea and save button
  const noteTextRef = useRef<HTMLTextAreaElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Get existing notebooks
  const { data: notebooks } = useQuery<Notebook[]>({
    queryKey: ["/api/notebooks"],
    queryFn: () => apiRequest("/api/notebooks"),
  });

  // Get document info for source display
  const { data: documentInfo, isLoading: isDocumentInfoLoading, error: documentInfoError } = useQuery({
    queryKey: ["/api/sentences", sentence?.id, "document"],
    queryFn: () => apiRequest(`/api/sentences/${sentence.id}/document`),
    enabled: !!(isOpen && sentence?.id),
  });

  // Get existing notes for this sentence
  const { data: existingNotes, isLoading: notesLoading, error: notesError } = useQuery({
    queryKey: ["/api/notes", { sentenceId: sentence?.id }],
    queryFn: async () => {
      const result = await apiRequest(`/api/notes?sentenceId=${sentence.id}`);
      console.log("[AddNoteModal] API Response for notes:", result);
      return result;
    },
    enabled: !!(isOpen && sentence?.id),
  });


  // Set existing note data when loaded
  useEffect(() => {
    console.log("[AddNoteModal] existingNotes useEffect triggered:", { existingNotes, isOpen, notebooks });
    if (existingNotes && existingNotes.length > 0 && isOpen) {
      // Filter notes for current sentence
      const currentSentenceNotes = existingNotes.filter((note: Note) => note.sentenceId === sentence?.id);
      console.log("[AddNoteModal] Filtered notes for sentence", sentence?.id, ":", currentSentenceNotes);
      
      if (currentSentenceNotes.length > 0) {
        const latestNote = currentSentenceNotes[0]; // Get the most recent note for this sentence
        console.log("[AddNoteModal] Setting existing note data:", latestNote);
        console.log("[AddNoteModal] Available notebooks:", notebooks?.map(nb => ({id: nb.id, title: nb.title})));
        setCurrentNote(latestNote);
        setNoteText(latestNote.content || "");
        setTags(latestNote.tags || []);
        
        // Enhanced notebook selection with validation - handle many-to-many relationships
        if (notebooks) {
          const connectedNotebookIds: string[] = [];
          
          console.log("[AddNoteModal] Checking note for notebook connections:", {
            noteId: latestNote.id,
            primaryNotebookId: latestNote.notebookId,
            noteData: latestNote
          });
          
          // Check primary notebookId from note record (backward compatibility)
          if (latestNote.notebookId) {
            const primaryNotebook = notebooks.find(nb => nb.id === latestNote.notebookId);
            if (primaryNotebook) {
              connectedNotebookIds.push(latestNote.notebookId.toString());
              console.log("[AddNoteModal] Found primary notebook:", primaryNotebook.title);
            } else {
              console.warn("[AddNoteModal] Primary notebook not found in available notebooks:", {
                searchingFor: latestNote.notebookId,
                availableNotebooks: notebooks.map(nb => ({ id: nb.id, title: nb.title }))
              });
            }
          } else {
            console.log("[AddNoteModal] Note has no primary notebookId, will use default selection");
          }
          
          // TODO: Also check noteNotebooks junction table for additional connections
          // This would require an API endpoint to get connected notebooks for a note
          // For now, we'll work with the primary notebookId
          
          console.log("[AddNoteModal] Connected notebook IDs:", connectedNotebookIds);
          
          // Always ensure default notebook is included
          const defaultNotebook = notebooks.find(nb => nb.title === documentInfo?.title);
          if (defaultNotebook) {
            const defaultId = defaultNotebook.id.toString();
            if (!connectedNotebookIds.includes(defaultId)) {
              connectedNotebookIds.unshift(defaultId); // Add to beginning
              console.log("[AddNoteModal] Added default notebook to existing note:", defaultNotebook.title);
            }
          }
          
          if (connectedNotebookIds.length > 0) {
            setSelectedNotebookIds(connectedNotebookIds);
            console.log("[AddNoteModal] Set notebook selection (with default):", connectedNotebookIds);
          } else {
            console.warn("[AddNoteModal] No connected notebooks found, will apply default selection logic");
            // Don't reset here - let the default notebook logic handle this
          }
        }
      } else {
        console.log("[AddNoteModal] No notes found for this sentence - resetting form");
        setCurrentNote(null);
        setNoteText("");
        setTags([]);
      }
    } else if (isOpen) {
      // Reset form when opening modal with no existing notes
      console.log("[AddNoteModal] Resetting form - no existing notes");
      setCurrentNote(null);
      setNoteText("");
      setTags([]);
    }
  }, [existingNotes, isOpen, sentence?.id, notebooks]);

  // Reset form when closing modal - preserve notebook selection for better UX
  useEffect(() => {
    if (!isOpen) {
      setNoteText("");
      setTags([]);
      setTagInput("");
      // Don't reset selectedNotebookIds to preserve selection across modal opens
      // setSelectedNotebookIds([]);
      setShowNewNotebookForm(false);
      setNewNotebookTitle("");
      setNewNotebookDescription("");
      setCurrentNote(null);
      setShowDeleteConfirm(false);
    }
  }, [isOpen]);

  // Create display notebooks list (includes virtual default notebook if not exists)
  const displayNotebooks = useMemo(() => {
    if (!notebooks || !documentInfo?.title) return notebooks || [];
    
    // Check if default notebook already exists
    const defaultExists = notebooks.some(nb => nb.title === documentInfo.title);
    
    if (defaultExists) {
      return notebooks; // Return as-is if default already exists
    }
    
    // Create virtual default notebook entry
    const virtualDefaultNotebook: Notebook = {
      id: -1, // Use -1 to indicate it's virtual (not yet created)
      title: documentInfo.title,
      description: `${documentInfo.title}에 대한 노트`,
      tags: null,
      type: 'user',
      documentId: null,
      isPublic: false,
      colorLabel: 'white',
      groupLabel: null,
      groupId: null,
      groupOrder: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    // Add virtual notebook at the beginning
    return [virtualDefaultNotebook, ...notebooks];
  }, [notebooks, documentInfo?.title]);

  // Auto-select default notebook when modal opens
  useEffect(() => {
    if (displayNotebooks && displayNotebooks.length > 0 && isOpen && documentInfo?.title) {
      // Only auto-select if no notebooks are currently selected
      if (selectedNotebookIds.length === 0) {
        // Find document's default notebook (real or virtual)
        const defaultNotebook = displayNotebooks.find((nb: Notebook) => nb.title === documentInfo.title);
        
        if (defaultNotebook) {
          const defaultId = defaultNotebook.id.toString();
          console.log("[AddNoteModal] Auto-selecting default notebook:", defaultNotebook.title, "isVirtual:", defaultNotebook.id === -1);
          setSelectedNotebookIds([defaultId]);
        }
      }
    }
  }, [displayNotebooks, documentInfo?.title, isOpen, selectedNotebookIds.length]);


  // Create notebook mutation
  const createNotebookMutation = useMutation({
    mutationFn: async (data: { title: string; description: string }) => {
      const response = await apiRequest("/api/notebooks", {
        method: "POST",
        json: {
          title: data.title, // Use 'title' instead of 'name'
          description: data.description,
          userId: null, // Will be set on server side
        }
      });
      return response;
    },
    onSuccess: (newNotebook) => {
      // Add to existing selection if not already present
      setSelectedNotebookIds(prev => 
        prev.includes(newNotebook.id.toString()) 
          ? prev 
          : [...prev, newNotebook.id.toString()]
      );
      setShowNewNotebookForm(false);
      setNewNotebookTitle("");
      setNewNotebookDescription("");
      queryClient.invalidateQueries({ queryKey: ["/api/notebooks"] });
      toast({
        title: "노트북 생성 완료",
        description: `"${newNotebook.name || newNotebook.title}" 노트북이 생성되었습니다.`,
      });
    },
    onError: () => {
      toast({
        title: "오류",
        description: "노트북 생성에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  // Add note mutation
  const addNoteMutation = useMutation({
    mutationFn: async (data: { sentenceId: number; noteText: string; tags: string[]; notebookId: number; additionalNotebookIds?: number[] }) => {
      console.log("Attempting to add note with data:", data);

      try {
        const requestBody = {
          sentenceId: data.sentenceId,
          content: data.noteText,
          tags: data.tags,
          notebookId: data.notebookId,
        };

        console.log("Request body:", requestBody);

        const response = await apiRequest("/api/notes", { method: "POST", json: requestBody });

        console.log("Note creation response:", response);
        return response;
      } catch (error) {
        console.error("Detailed error in note creation:", {
          error,
          errorMessage: error instanceof Error ? error.message : String(error),
          sentenceId: data.sentenceId,
          notebookId: data.notebookId,
        });
        throw error;
      }
    },
    onSuccess: async (data, variables) => {
      console.log("Note added successfully:", data);

      // Handle copying to additional notebooks if more than 1 notebook selected
      const additionalNotebookIds = variables.additionalNotebookIds || [];
      
      if (additionalNotebookIds.length > 0) {
        console.log("[AddNoteModal] Copying note to additional notebooks:", {
          noteId: data.id,
          additionalNotebookIds
        });
        
        try {
          // Copy note to each additional notebook
          for (const notebookId of additionalNotebookIds) {
            await apiRequest("/api/notes/copy", {
              method: "POST",
              json: {
                noteIds: [data.id],
                targetNotebookId: notebookId
              }
            });
          }
          console.log("[AddNoteModal] Successfully copied note to all additional notebooks");
        } catch (error) {
          console.error("[AddNoteModal] Failed to copy note to additional notebooks:", error);
          toast({
            title: "부분적 저장 완료",
            description: "노트가 기본 노트북에만 저장되었습니다. 추가 노트북 복사에 실패했습니다.",
            variant: "destructive",
          });
        }
      }

      // Update the document cache to reflect the new note using correct query key
      if (sentence.documentId) {
        queryClient.setQueryData(
          [`/api/documents/${sentence.documentId}`],
          (oldDoc: DocumentWithParagraphs | undefined) => {
            if (!oldDoc) return oldDoc;

            // Update both sentencesById AND paragraphs for comprehensive cache update
            const updatedSentencesById = oldDoc.sentencesById ? {
              ...oldDoc.sentencesById,
              [sentence.id]: {
                ...oldDoc.sentencesById[sentence.id],
                noteContent: data.content,
                noteId: data.id,
                noteTags: data.tags || [],
                noteCreatedAt: data.createdAt,
              }
            } : {};

            return {
              ...oldDoc,
              sentencesById: updatedSentencesById,
              paragraphs: oldDoc.paragraphs.map(p => ({
                ...p,
                sentences: p.sentences.map(s => 
                  s.id === sentence?.id 
                    ? { ...s, noteContent: data.content, hasNote: true }
                    : s
                )
              }))
            };
          }
        );
      }

      // Invalidate multiple related queries for proper UI refresh
      queryClient.invalidateQueries({ queryKey: ["/api/notebooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quiz/notebooks"] });
      
      // Invalidate specific notebook sentences queries for all selected notebooks
      const allNotebookIds = [variables.notebookId, ...additionalNotebookIds];
      allNotebookIds.forEach(notebookId => {
        if (notebookId) {
          queryClient.invalidateQueries({ queryKey: [`/api/notebooks/${notebookId}/sentences`] });
        }
      });

      // SidePanel now uses document.sentencesById, so this is covered by document cache invalidation

      // Invalidate document-specific queries only (not the document list)
      if (sentence.documentId) {
        queryClient.invalidateQueries({ queryKey: [`/api/documents/${sentence.documentId}`] });
        queryClient.invalidateQueries({ queryKey: ["/api/notes/document", sentence.documentId] });
      }

      console.log("[AddNoteModal] Successfully added note and invalidated caches:", data);
      
      const notebookCount = 1 + additionalNotebookIds.length;
      const successMessage = notebookCount > 1 
        ? `노트 1개가 ${notebookCount}개의 노트북에 저장되었습니다.`
        : "노트가 성공적으로 추가되었습니다.";
        
      toast({
        title: "노트 추가 완료",
        description: successMessage,
      });

      onClose();
    },
    onError: (error) => {
      console.error("[AddNoteModal] Failed to add note:", error);
      const errorMessage = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다";
      toast({
        title: "노트 추가 실패",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });


  // Delete note entity mutation (complete deletion)
  const deleteNoteMutation = useMutation({
    mutationFn: async () => {
      if (!currentNote) throw new Error("No note to delete");
      return apiRequest(`/api/notes/${currentNote.id}`, {
        method: "DELETE"
      });
    },
    onSuccess: (data) => {
      const deletedNoteData = data.deletedNote || currentNote;
      toast({
        title: "노트 삭제됨",
        description: "노트가 완전히 삭제되었습니다.",
        action: (
          <Button variant="outline" size="sm" onClick={() => {
            // Recreate the deleted note
            apiRequest('/api/notes', {
              method: 'POST',
              json: {
                sentenceId: deletedNoteData.sentenceId,
                content: deletedNoteData.content,
                tags: deletedNoteData.tags || [],
                notebookId: deletedNoteData.notebookId,
                color: deletedNoteData.color || 'yellow'
              }
            }).then(() => {
              queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
              queryClient.invalidateQueries({ queryKey: ["/api/quiz/notebooks"] });
              if (sentence.documentId) {
                queryClient.invalidateQueries({ queryKey: ["/api/notes/document", sentence.documentId] });
                queryClient.invalidateQueries({ queryKey: [`/api/documents/${sentence.documentId}`] });
              }
              toast({ title: "복구됨", description: "노트가 복구되었습니다." });
            });
          }}>
            실행 취소
          </Button>
        ),
      });
      // Invalidate relevant caches (not the document list)
      queryClient.invalidateQueries({ queryKey: ["/api/notes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quiz/notebooks"] });
      if (sentence.documentId) {
        queryClient.invalidateQueries({ queryKey: ["/api/notes/document", sentence.documentId] });
        queryClient.invalidateQueries({ queryKey: [`/api/documents/${sentence.documentId}`] });
      }
      onClose();
    },
    onError: (error) => {
      console.error("Failed to delete note:", error);
      toast({
        title: "삭제 실패",
        description: "노트 삭제에 실패했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleAddTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput("");
    }
  };

  const handleRemoveTag = (tagToRemove: string) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      handleAddTag();
    }
  };

  // Handle notebook selection toggle
  const handleNotebookToggle = (notebookId: string, checked: boolean) => {
    const notebook = notebooks?.find(nb => nb.id.toString() === notebookId);
    const isDefaultNotebook = notebook && documentInfo?.title === notebook.title;
    
    if (checked) {
      setSelectedNotebookIds(prev => [...prev, notebookId]);
    } else {
      // Prevent unchecking the default notebook
      if (isDefaultNotebook) {
        console.log("[AddNoteModal] Cannot uncheck default notebook:", notebook.title);
        toast({
          title: "기본 노트북",
          description: "기본 노트북은 항상 포함되어야 합니다.",
          variant: "destructive",
        });
        return;
      }
      setSelectedNotebookIds(prev => prev.filter(id => id !== notebookId));
    }
  };

  // Handle keyboard shortcuts for saving
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === "Enter" && (e.metaKey || e.ctrlKey)) || 
        (e.key === "Enter" && e.shiftKey)) {
      e.preventDefault();
      handleSave();
    }
  };

  const handleSave = async () => {
    // Require note content
    if (!noteText.trim()) {
      toast({
        title: "오류",
        description: "노트 내용을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }

    // Check if default notebook for this document exists
    let defaultNotebook = documentInfo?.title 
      ? notebooks?.find(nb => nb.title === documentInfo.title)
      : null;
    
    // If no default notebook exists, create it first
    if (documentInfo?.title && !defaultNotebook) {
      console.log("[AddNoteModal] Creating default notebook before saving note:", documentInfo.title);
      
      try {
        // Create the default notebook and wait for it
        const newNotebook = await new Promise<Notebook>((resolve, reject) => {
          createNotebookMutation.mutate(
            {
              title: documentInfo.title,
              description: `${documentInfo.title}에 대한 노트`,
            },
            {
              onSuccess: (data) => {
                console.log("[AddNoteModal] Default notebook created successfully:", data);
                resolve(data);
              },
              onError: (error) => {
                console.error("[AddNoteModal] Failed to create default notebook:", error);
                reject(error);
              }
            }
          );
        });
        
        // Use the newly created notebook as default
        defaultNotebook = newNotebook;
        
        // Auto-select the newly created notebook if no notebooks were selected
        if (selectedNotebookIds.length === 0) {
          setSelectedNotebookIds([newNotebook.id.toString()]);
        }
      } catch (error) {
        toast({
          title: "노트북 생성 실패",
          description: "기본 노트북을 생성하는 데 실패했습니다. 다시 시도해주세요.",
          variant: "destructive",
        });
        return;
      }
    }

    // Prepare final notebook selection
    let finalNotebookIds = [...selectedNotebookIds];
    
    // If user selected notebooks, ensure default notebook is first
    if (finalNotebookIds.length > 0 && defaultNotebook) {
      const defaultId = defaultNotebook.id.toString();
      // Remove default from current position (if exists) and add to beginning
      finalNotebookIds = finalNotebookIds.filter(id => id !== defaultId);
      finalNotebookIds.unshift(defaultId);
      console.log("[AddNoteModal] Ensured default notebook is first:", defaultNotebook.title);
    } else if (finalNotebookIds.length === 0 && defaultNotebook) {
      // No notebooks selected, use default only
      finalNotebookIds = [defaultNotebook.id.toString()];
      console.log("[AddNoteModal] Using default notebook only:", defaultNotebook.title);
    } else if (finalNotebookIds.length === 0) {
      // No notebooks at all (shouldn't happen, but handle it)
      toast({
        title: "오류",
        description: "노트북을 선택해주세요.",
        variant: "destructive",
      });
      return;
    }

    // Use first notebook (which is now the default) as primary for the note
    const primaryNotebookId = parseInt(finalNotebookIds[0]);
    
    console.log("[AddNoteModal] Final notebook selection:", {
      finalNotebookIds,
      primaryNotebookId,
      defaultNotebook: defaultNotebook?.title
    });

    // Get additional notebook IDs (excluding the primary one)
    const additionalNotebookIds = finalNotebookIds.slice(1).map(id => parseInt(id));

    // Prepare note data
    const noteData = {
      sentenceId: sentence.id,
      noteText: noteText.trim(),
      tags: tags.length > 0 ? tags : [],
      notebookId: primaryNotebookId,
      additionalNotebookIds: additionalNotebookIds,
    };

    console.log("Saving note with data:", noteData);
    addNoteMutation.mutate(noteData);
  };

  const handleClose = () => {
    setNoteText("");
    setTags([]);
    setTagInput("");
    setSelectedNotebookIds([]);
    setShowNewNotebookForm(false);
    setNewNotebookTitle("");
    setNewNotebookDescription("");

    onClose();
  };


  const handleDeleteNote = () => {
    if (currentNote) {
      setShowDeleteConfirm(true);
    }
  };

  const confirmDeleteNote = () => {
    if (currentNote) {
      deleteNoteMutation.mutate();
      setShowDeleteConfirm(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>노트 추가</DialogTitle>
          <DialogDescription>
            선택한 문장에 대한 노트를 작성하고 노트북에 저장할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Document Source */}
          {documentInfo && (
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:border-gray-600">
                <FileText className="h-3 w-3 mr-1" />
                {documentInfo.title}
              </Badge>
            </div>
          )}

          {/* Original Sentence */}
          <div className="space-y-3">
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 dark:bg-gray-800 dark:border-gray-700">
              <div className="space-y-4">
                <div>
                  <div className="text-xs font-bold text-black dark:text-white mb-2">원문</div>
                  <div className="text-gray-900 dark:text-gray-100 leading-relaxed">
                    {sentence.source}
                  </div>
                </div>
                {sentence.target && (
                  <div>
                    <div className="text-xs font-bold text-black dark:text-white mb-2">번역</div>
                    <div className="text-gray-800 dark:text-gray-200 leading-relaxed">
                      {sentence.target}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>


          {/* Note Text - Primary Input */}
          <div>
            <Label>노트 내용</Label>
            <Textarea
              ref={noteTextRef}
              placeholder="노트 입력..."
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={6}
              aria-label="노트 내용 입력"
              className="resize-none text-base leading-relaxed p-4 bg-white dark:bg-gray-900 border-2 border-gray-300 dark:border-gray-600 rounded-lg placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-[hsl(var(--brand))] dark:focus:border-[hsl(var(--brand))] transition-colors"
            />
          </div>


          {/* Notebook Selection */}
          <div className="space-y-3">
            <div>
              <Label>노트북 선택</Label>
              <p className="text-xs text-muted-foreground mt-1">
                기본 노트북에 자동 저장되며, 추가 노트북을 선택할 수 있습니다.
              </p>
            </div>
            
            {!showNewNotebookForm ? (
              <div className="space-y-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className="w-full justify-between h-auto min-h-[40px] p-3"
                    >
                      <div className="flex flex-wrap gap-1">
                        {selectedNotebookIds.length > 0 ? (
                          selectedNotebookIds.map(id => {
                            const notebook = displayNotebooks?.find(nb => nb.id.toString() === id);
                            return notebook ? (
                              <Badge key={id} variant="secondary" className="text-xs">
                                {notebook.title}
                                {notebook.id === -1 && <span className="ml-1 text-[10px]">*</span>}
                              </Badge>
                            ) : null;
                          })
                        ) : (
                          <span className="text-muted-foreground">노트북 선택...</span>
                        )}
                      </div>
                      <ChevronDown className="h-4 w-4 opacity-50" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-80 p-0">
                    <div className="p-2 space-y-1">
                      {/* Create new notebook option */}
                      <Button
                        variant="ghost"
                        className="w-full justify-start h-8 px-2"
                        onClick={() => setShowNewNotebookForm(true)}
                      >
                        <Plus className="h-4 w-4 mr-2" />
                        새 노트북 만들기
                      </Button>
                      
                      {/* Existing notebooks */}
                      {displayNotebooks && displayNotebooks.length > 0 && (
                        <>
                          <div className="px-2 py-1 text-xs font-semibold text-muted-foreground border-t pt-2">
                            내 노트북
                          </div>
                          {displayNotebooks.map((notebook) => {
                            const isDefaultNotebook = documentInfo?.title === notebook.title;
                            const isVirtual = notebook.id === -1;
                            return (
                              <div key={notebook.id} className="flex items-center space-x-2 px-2 py-1.5 hover:bg-accent rounded-sm">
                                <Checkbox
                                  id={`notebook-${notebook.id}`}
                                  checked={selectedNotebookIds.includes(notebook.id.toString())}
                                  disabled={isDefaultNotebook}
                                  onCheckedChange={(checked) => 
                                    handleNotebookToggle(notebook.id.toString(), checked as boolean)
                                  }
                                />
                                <label 
                                  htmlFor={`notebook-${notebook.id}`}
                                  className={`text-sm flex-1 leading-none ${
                                    isDefaultNotebook 
                                      ? 'cursor-default opacity-70' 
                                      : 'cursor-pointer peer-disabled:cursor-not-allowed peer-disabled:opacity-70'
                                  }`}
                                >
                                  {notebook.title}
                                  {/* Show if this is document's default notebook */}
                                  {isDefaultNotebook && (
                                    <span className="text-xs text-green-600 dark:text-green-400 ml-1 font-medium">
                                      (기본{isVirtual ? ' - 저장 시 생성' : ' - 자동 포함'})
                                    </span>
                                  )}
                                </label>
                              </div>
                            );
                          })}
                        </>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
              ) : (
                <div className="space-y-3 border border-gray-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">새 노트북 만들기</Label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowNewNotebookForm(false)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="space-y-2">
                  <Input
                    placeholder="노트북 제목"
                    value={newNotebookTitle}
                    onChange={(e) => setNewNotebookTitle(e.target.value)}
                  />
                  <Textarea
                    placeholder="노트북 설명 (선택사항)"
                    value={newNotebookDescription}
                    onChange={(e) => setNewNotebookDescription(e.target.value)}
                    rows={2}
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (newNotebookTitle.trim()) {
                        createNotebookMutation.mutate({
                          title: newNotebookTitle.trim(),
                          description: newNotebookDescription.trim() || "",
                        });
                      }
                    }}
                    disabled={!newNotebookTitle.trim() || createNotebookMutation.isPending}
                  >
                    {createNotebookMutation.isPending ? "생성 중..." : "노트북 생성"}
                  </Button>
                </div>
              </div>
            )}
          </div>



          {/* Tags */}
          <div className="space-y-2">
            <Label>태그</Label>
              <Input
                placeholder="태그 입력... (Enter 또는 쉼표로 추가)"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleKeyPress}
              />
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag, index) => (
                    <Badge key={index} variant="secondary" className="flex items-center gap-1">
                      #{tag}
                      <button
                        onClick={() => handleRemoveTag(tag)}
                        className="ml-1 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
          </div>

          {/* Actions */}
          <div className="flex justify-between pt-2">
            {/* Delete actions - only show when editing existing note */}
            {currentNote && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteNote}
                  disabled={deleteNoteMutation.isPending}
                  className="text-red-600 border-red-300 hover:bg-red-50 dark:text-red-400 dark:border-red-600 dark:hover:bg-red-950"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  {deleteNoteMutation.isPending ? "삭제 중..." : "완전 삭제"}
                </Button>
              </div>
            )}
            
            {/* Main actions */}
            <div className="flex gap-3">
              <Button variant="outline" onClick={handleClose} className="px-6">
                취소
              </Button>
              <Button
                ref={saveButtonRef}
                onClick={handleSave}
                disabled={!noteText.trim() || selectedNotebookIds.length === 0 || addNoteMutation.isPending}
                className="bg-[hsl(var(--brand))] hover:bg-[hsl(var(--brand-hover))] text-[hsl(var(--brand-foreground))] px-6"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleSave();
                  }
                }}
              >
                {addNoteMutation.isPending ? "저장 중..." : "노트 저장"}
              </Button>
            </div>
          </div>

          {/* Delete confirmation modal using AlertDialog */}
          <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-100 dark:bg-red-900/30 rounded-full">
                    <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
                  </div>
                  <AlertDialogTitle className="text-red-600 dark:text-red-400">
                    노트 완전 삭제
                  </AlertDialogTitle>
                </div>
                <AlertDialogDescription>
                  이 노트를 완전히 삭제하시겠습니까? 모든 노트북에서 제거되며, 이 작업은 실행 취소할 수 있습니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={deleteNoteMutation.isPending}>
                  취소
                </AlertDialogCancel>
                <AlertDialogAction
                  className="bg-red-600 hover:bg-red-700 text-white"
                  onClick={confirmDeleteNote}
                  disabled={deleteNoteMutation.isPending}
                >
                  {deleteNoteMutation.isPending ? "삭제 중..." : "삭제"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </DialogContent>
    </Dialog>
  );
}