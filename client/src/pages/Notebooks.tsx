import React, { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Layout from "@/components/Layout";
import PageShell from "@/components/layout/PageShell";
import PageHeader from "@/components/layout/PageHeader";
import PageBody from "@/components/layout/PageBody";
import HeaderBar from "@/components/layout/HeaderBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, BookOpen, Edit, Edit2, Trash2, Calendar, FileText, Download, Tag, Users, Lock, Search, Filter, FolderOpen, Lightbulb, NotebookPen, MoreVertical, Copy, Move, Keyboard, ChevronDown, ChevronRight, Grip, FileSpreadsheet, Type, ArrowLeft, PanelLeft, PanelLeftClose, Highlighter, AlertTriangle, NotepadTextIcon, X } from "lucide-react";
import { exportSentences, downloadFile } from "@/lib/exportUtils";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useUndo } from "@/hooks/useUndo";
import { useAuth } from "@/hooks/useAuth";
import { SentenceWithMetadata } from "@/lib/types";
import NotebookSelectionModal from "@/components/NotebookSelectionModal";
import { useTranslation, useLanguage } from "@/i18n";
import { formatShortDate } from "@/lib/dateUtils";
import { useTimezone } from "@/hooks/useTimezone";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";


interface NotebookWithStats {
  id: number;
  title: string;
  description: string | null;
  tags: string | null;
  type: string | null;
  documentId: number | null;
  isPublic: boolean | null;
  colorLabel: string | null;
  groupId: number | null; // New logical groups system
  groupLabel: string | null; // Legacy field for transition
  groupOrder: number | null; // Legacy field for transition
  createdAt: string;
  updatedAt: string;
  userId: number | null;
  sentenceCount: number;
}

import Pagination from "@/components/common/Pagination";

export default function Notebooks() {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;
  const { language } = useLanguage();
  const { timezone } = useTimezone();
  const [selectedNotebook, setSelectedNotebook] = useState<NotebookWithStats | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [newNotebook, setNewNotebook] = useState({
    title: "",
    description: "",
    isPublic: false,
    colorLabel: "white" as string | null,  // Use white as default since it's the fallback color
    groupLabel: null as string | null,
    groupId: null as number | null
  });
  const [editNotebook, setEditNotebook] = useState({
    title: "",
    description: "",
    isPublic: false,
    colorLabel: null as string | null,
    groupId: null as number | null
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [sortBy, setSortBy] = useState<"alphabetical" | "recent" | "sentence-count" | "created">("recent");
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null);
  const [noteText, setNoteText] = useState("");
  
  // Translation editing state
  const [editingTranslationId, setEditingTranslationId] = useState<number | null>(null);
  const [translationEditText, setTranslationEditText] = useState("");
  
  // Note filter state (similar to RightDrawer)
  const [noteFilter, setNoteFilter] = useState<"all" | "highlights" | "notes">("all");
  
  // Tag filter state for filtering notes by tags
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isTagFilterOpen, setIsTagFilterOpen] = useState(false);
  
  // Tag editing state
  const [tagsText, setTagsText] = useState<string[]>([]);

  // Multi-selection state
  const [selectedNoteIds, setSelectedNoteIds] = useState<number[]>([]);

  // Move/Copy modal state
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);
  const [operationNoteIds, setOperationNoteIds] = useState<number[]>([]);

  // Group management state
  const [showManageGroupsDialog, setShowManageGroupsDialog] = useState(false);
  const [showCreateGroupDialog, setShowCreateGroupDialog] = useState(false);
  const [showEditGroupDialog, setShowEditGroupDialog] = useState(false);
  const [editingGroup, setEditingGroup] = useState<{id: number; name: string} | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [groupToEdit, setGroupToEdit] = useState('');
  
  // Unified Notebook Management Modal state
  const [showNotebookManagementModal, setShowNotebookManagementModal] = useState(false);
  const [managementTab, setManagementTab] = useState<'create' | 'groups'>('create');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [draggedNotebook, setDraggedNotebook] = useState<NotebookWithStats | null>(null);
  const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; type: string; data?: any }>({ open: false, type: '' });
  
  // Left panel collapse state
  const [isLeftPanelCollapsed, setIsLeftPanelCollapsed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('notebooks-left-panel-collapsed');
      return saved ? JSON.parse(saved) : false;
    } catch (e) {
      return false;
    }
  });

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { createUndoableOperation } = useUndo();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  // Ref for scrolling to editing card
  const editingCardRef = useRef<HTMLDivElement>(null);

  // Scroll to editing card when edit mode opens
  useEffect(() => {
    if (editingNoteId !== null && editingCardRef.current) {
      setTimeout(() => {
        editingCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 100);
    }
  }, [editingNoteId]);

  // Persist left panel collapse state
  useEffect(() => {
    localStorage.setItem('notebooks-left-panel-collapsed', JSON.stringify(isLeftPanelCollapsed));
  }, [isLeftPanelCollapsed]);

  const toggleLeftPanel = () => {
    setIsLeftPanelCollapsed(prev => !prev);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Check if Command (Mac) or Ctrl (Windows/Linux) is pressed
      const isModifierPressed = event.metaKey || event.ctrlKey;

      if (isModifierPressed && event.shiftKey) {
        if (event.key === 'M' && selectedNoteIds.length > 0) {
          event.preventDefault();
          handleMoveNotes(selectedNoteIds);
        } else if (event.key === 'V' && selectedNoteIds.length > 0) {
          event.preventDefault();
          handleCopyNotes(selectedNoteIds);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedNoteIds]);

  // Multi-selection helper functions

  const handleToggleNoteSelection = (noteId: number) => {
    setSelectedNoteIds(prev =>
      prev.includes(noteId)
        ? prev.filter(id => id !== noteId)
        : [...prev, noteId]
    );
  };

  const handleSelectAll = () => {
    if (selectedNoteIds.length === filteredSentences.length) {
      setSelectedNoteIds([]);
    } else {
      const allNoteIds = filteredSentences
        .filter((s: any) => s.noteId)
        .map((s: any) => s.noteId);
      setSelectedNoteIds(allNoteIds);
    }
  };

  // Tag editing helper functions
  const parseTags = (tags: any): string[] => {
    if (!tags) return [];
    if (Array.isArray(tags)) return tags;
    try {
      const parsed = JSON.parse(tags);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  // Tag editing handlers

  const handleAddTag = (newTag: string) => {
    console.log(`[TAG_DEBUG] handleAddTag called with: "${newTag}", current tagsText:`, tagsText);
    if (newTag.trim() && !tagsText.includes(newTag.trim())) {
      const newTags = [...tagsText, newTag.trim()];
      console.log(`[TAG_DEBUG] Setting new tagsText:`, newTags);
      setTagsText(newTags);
    }
  };

  const handleRemoveTag = (tagIndex: number) => {
    setTagsText(tagsText.filter((_, index) => index !== tagIndex));
  };

  // Move notes mutation
  const moveNotesMutation = useMutation({
    mutationFn: async ({ noteIds, targetNotebookId }: { noteIds: number[]; targetNotebookId: number }) => {
      return apiRequest('/api/notes/move', {
        method: 'POST',
        json: {
          noteIds,
          targetNotebookId,
          sourceNotebookId: selectedNotebook?.id
        }
      });
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks'] });
      // Invalidate both source and target notebook sentences
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks', selectedNotebook?.id, 'sentences'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks', variables.targetNotebookId, 'sentences'] });
      setSelectedNoteIds([]);
      setShowMoveModal(false);

      toast({
        title: t('common.success'),
        description: t('notebooks.notesMoved', { count: result.movedNotes })
      });
    },
    onError: (error: any) => {
      toast({
        title: t('common.error'),
        description: error.message || t('notebooks.failedToMoveNotes'),
        variant: 'destructive'
      });
    }
  });

  // Copy notes mutation
  const copyNotesMutation = useMutation({
    mutationFn: async ({ noteIds, targetNotebookId }: { noteIds: number[]; targetNotebookId: number }) => {
      return apiRequest('/api/notes/copy', {
        method: 'POST',
        json: {
          noteIds,
          targetNotebookId
        }
      });
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks'] });
      // Invalidate both source and target notebook sentences
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks', selectedNotebook?.id, 'sentences'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks', variables.targetNotebookId, 'sentences'] });
      setSelectedNoteIds([]);
      setShowCopyModal(false);

      toast({
        title: t('common.success'),
        description: t('notebooks.notesCopied', { count: result.copiedCount })
      });
      
      // Show warning if some copies failed
      if (result.errors && result.errors.length > 0) {
        toast({
          title: t('common.warning'),
          description: result.errors.join(', '),
          variant: 'default'
        });
      }
    },
    onError: (error: any) => {
      toast({
        title: t('common.error'),
        description: error.message || t('notebooks.failedToCopyNotes'),
        variant: 'destructive'
      });
    }
  });

  // Delete notes mutation
  const deleteNotesMutation = useMutation({
    mutationFn: async (noteIds: number[]) => {
      return apiRequest('/api/notes/bulk', {
        method: 'DELETE',
        json: {
          noteIds,
          notebookId: selectedNotebook?.id
        }
      });
    },
    onSuccess: (result, variables) => {
      // Get the note IDs that were deleted
      const deletedNoteIds = variables;

      // Immediately update document caches to remove deleted notes from sentencesById
      if (filteredSentences && Array.isArray(filteredSentences) && filteredSentences.length > 0) {
        // Create a map of deleted noteIds to their sentenceIds and documentIds
        const deletedNoteData = filteredSentences
          .filter((sentence: any) => deletedNoteIds.includes(sentence.noteId))
          .map((sentence: any) => ({
            sentenceId: sentence.id,
            noteId: sentence.noteId,
            documentId: sentence.documentId
          }));

        // Group by documentId to update specific document caches
        const documentUpdates = deletedNoteData.reduce((acc: any, item) => {
          if (item.documentId) {
            if (!acc[item.documentId]) acc[item.documentId] = [];
            acc[item.documentId].push(item.sentenceId);
          }
          return acc;
        }, {});

        // Update each document's sentencesById cache immediately
        Object.entries(documentUpdates).forEach(([documentId, sentenceIds]) => {
          queryClient.setQueryData([`/api/documents/${documentId}`], (oldDoc: any) => {
            if (!oldDoc?.sentencesById) return oldDoc;

            const updatedSentencesById = { ...oldDoc.sentencesById };
            (sentenceIds as number[]).forEach(sentenceId => {
              if (updatedSentencesById[sentenceId]) {
                // Remove note-related fields
                delete updatedSentencesById[sentenceId].noteContent;
                delete updatedSentencesById[sentenceId].noteId;
                delete updatedSentencesById[sentenceId].noteTags;
                delete updatedSentencesById[sentenceId].noteCreatedAt;
              }
            });

            return { ...oldDoc, sentencesById: updatedSentencesById };
          });

          // SidePanel now uses document.sentencesById, so this invalidation is handled above
        });
      }

      // Standard cache invalidation
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks', selectedNotebook?.id, 'sentences'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks'] });

      // Force refetch of affected document queries
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });

      setSelectedNoteIds([]);

      toast({
        title: t('common.success'),
        description: t('notebooks.notesRemoved', { count: result.deletedNotes + result.removedNotes })
      });
    },
    onError: (error: any) => {
      toast({
        title: t('common.error'),
        description: error.message || t('notebooks.failedToDeleteNotes'),
        variant: 'destructive'
      });
    }
  });

  // Get all notebooks
  const { data: notebooks, isLoading } = useQuery<NotebookWithStats[]>({
    queryKey: ["/api/notebooks"],
    queryFn: async () => {
      return apiRequest("/api/notebooks", { method: "GET" });
    },
  });

  // Get all available groups using new logical groups system
  const { data: availableGroups } = useQuery<{ groups: Array<{ id: number; name: string; color: string; icon: string }> }>({
    queryKey: ["/api/notebook-groups"],
    queryFn: async () => {
      return apiRequest("/api/notebook-groups", { method: "GET" });
    },
  });

  // Group notebooks by groupId using new logical groups system
  const groupedNotebooks = React.useMemo<Record<string, NotebookWithStats[]>>(() => {
    if (!notebooks || !availableGroups) return {} as Record<string, NotebookWithStats[]>;

    const filtered = notebooks.filter(notebook => {
      // Filter out placeholder group notebooks
      if (notebook.title.startsWith('_GROUP_')) {
        return false;
      }

      const matchesSearch = searchQuery === "" ||
        notebook.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        notebook.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (notebook.tags && notebook.tags.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesTag = tagFilter === "" || tagFilter === "all" ||
        (notebook.tags && parseTags(notebook.tags).includes(tagFilter));

      return matchesSearch && matchesTag;
    });

    const sorted = [...filtered].sort((a, b) => {
      switch (sortBy) {
        case "alphabetical":
          return a.title.localeCompare(b.title);
        case "recent":
          return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
        case "sentence-count":
          return b.sentenceCount - a.sentenceCount;
        case "created":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        default:
          return 0;
      }
    });

    // Group by groupId using new logical groups system
    const groups: { [key: string]: NotebookWithStats[] } = {};

    sorted.forEach(notebook => {
      const unfiledKey = t('notebooks.unfiled');
      let groupKey = unfiledKey;

      if (notebook.groupId) {
        const group = availableGroups.groups.find(g => g.id === notebook.groupId);
        if (group) {
          groupKey = group.name;
        }
      }

      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(notebook);
    });

    // Sort groups alphabetically, but keep "Unfiled" at the end
    const unfiledKey = t('notebooks.unfiled');
    const sortedGroupEntries = Object.entries(groups).sort(([a], [b]) => {
      if (a === unfiledKey) return 1;
      if (b === unfiledKey) return -1;
      return a.localeCompare(b);
    });

    return Object.fromEntries(sortedGroupEntries) as Record<string, NotebookWithStats[]>;
  }, [notebooks, availableGroups, searchQuery, tagFilter, sortBy]);

  // Update note mutation (using new notes API)
  const updateNoteMutation = useMutation({
    mutationFn: async ({ noteId, content, tags, documentId }: { noteId: number; content?: string; tags?: string[]; documentId?: number }) => {
      console.log(`[NOTE_UPDATE_FE] Calling mutation with:`, { noteId, content, tags, tagsType: typeof tags, tagsIsArray: Array.isArray(tags) });
      return apiRequest(`/api/notes/${noteId}`, { method: "PUT", json: { content, tags } });
    },
    onSuccess: (data, variables) => {
      // Invalidate the current notebook's sentences query specifically
      if (selectedNotebook?.id) {
        queryClient.invalidateQueries({ queryKey: ['/api/notebooks', selectedNotebook.id, 'sentences'] });
      }
      
      // Since a note can be in multiple notebooks, invalidate ALL notebook queries
      // to ensure consistency across all notebooks that contain this note
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks'] });
      
      // If we have documentId from the mutation variables, invalidate specific document queries
      if (variables.documentId) {
        console.log(`[NOTES] Invalidating document viewer for document ${variables.documentId}`);
        queryClient.invalidateQueries({ queryKey: [`/api/documents/${variables.documentId}`] });
        queryClient.invalidateQueries({ queryKey: ['/api/notes/document', variables.documentId] });
        queryClient.invalidateQueries({ queryKey: [`/api/notes/document/${variables.documentId}`] });
      }
      
      // Invalidate all document and note queries to ensure consistency
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notes'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notes/search'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notes/recent'] });
      
      setEditingNoteId(null);
      setNoteText("");
      setTagsText([]);
      toast({
        title: t('common.success'),
        description: t('notebooks.noteUpdated'),
      });
    },
    onError: () => {
      toast({
        title: t('common.error'),
        description: t('notebooks.failedToUpdateNote'),
        variant: "destructive",
      });
    },
  });

  // Update translation mutation
  const updateTranslationMutation = useMutation({
    mutationFn: async ({ sentenceId, targetEdited, documentId }: { sentenceId: number; targetEdited: string; documentId?: number }) => {
      return apiRequest(`/api/sentences/${sentenceId}`, {
        method: 'PATCH',
        json: { targetEdited }
      });
    },
    onSuccess: (data, variables) => {
      if (selectedNotebook?.id) {
        queryClient.invalidateQueries({ queryKey: ['/api/notebooks', selectedNotebook.id, 'sentences'] });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notes/recent'] });
      if (variables.documentId) {
        queryClient.invalidateQueries({ queryKey: [`/api/documents/${variables.documentId}`] });
      }
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      setEditingTranslationId(null);
      setTranslationEditText("");
      toast({
        title: t('common.success'),
        description: t('notebooks.translationUpdated') || 'Translation updated',
      });
    },
    onError: () => {
      toast({
        title: t('common.error'),
        description: t('notebooks.failedToUpdateTranslation') || 'Failed to update translation',
        variant: "destructive",
      });
    },
  });

  // Get total notebook count for empty state check
  const totalNotebooksCount = React.useMemo(() => {
    return Object.values(groupedNotebooks).flat().length;
  }, [groupedNotebooks]);

  // Get sentences for selected notebook
  const { data: notebookSentences, isLoading: loadingSentences } = useQuery<SentenceWithMetadata[]>({
    queryKey: ["/api/notebooks", selectedNotebook?.id, "sentences"],
    enabled: !!selectedNotebook,
    queryFn: async () => {
      console.log(`[NOTEBOOKS_API] Fetching sentences for notebook ${selectedNotebook!.id}`);
      const response = await apiRequest(`/api/notebooks/${selectedNotebook!.id}/sentences`, { method: "GET" });
      console.log(`[NOTEBOOKS_API] Raw API response:`, response);
      console.log(`[NOTEBOOKS_API] Response type:`, typeof response);
      console.log(`[NOTEBOOKS_API] Is array:`, Array.isArray(response));
      console.log(`[NOTEBOOKS_API] Response length:`, response?.length);
      return response;
    },
  });

  // Get recent notes across all notebooks (for empty state when no notebook is selected)
  const { data: recentNotes, isLoading: loadingRecentNotes } = useQuery<SentenceWithMetadata[]>({
    queryKey: ["/api/notes/recent"],
    enabled: !selectedNotebook,
    queryFn: async () => {
      console.log(`[NOTEBOOKS] Fetching recent notes`);
      const response = await apiRequest(`/api/notes/recent?limit=3`, { method: "GET" });
      console.log(`[NOTEBOOKS] Recent notes:`, response);
      return response;
    },
  });

  // Search notes across all notebooks (only when no specific notebook is selected)
  const { data: searchResults, isLoading: loadingSearch } = useQuery<Array<{
    notebook: any;
    sentences: SentenceWithMetadata[];
    count: number;
  }>>({
    queryKey: ["/api/notes/search", searchQuery],
    enabled: !!searchQuery && searchQuery.trim().length > 0 && !selectedNotebook,
    queryFn: async () => {
      console.log(`[NOTES_SEARCH] Searching for: "${searchQuery}"`);
      const response = await apiRequest(`/api/notes/search?query=${encodeURIComponent(searchQuery.trim())}`, { method: "GET" });
      console.log(`[NOTES_SEARCH] Search results:`, response);
      return response;
    },
  });

  // Helper function to extract tags from a sentence
  const extractTags = (sentence: any): string[] => {
    const noteTags = sentence.noteTags || sentence.tags;
    if (!noteTags) return [];
    
    if (Array.isArray(noteTags)) {
      return noteTags.filter(tag => typeof tag === 'string');
    }
    
    if (typeof noteTags === 'string') {
      try {
        const parsed = JSON.parse(noteTags);
        if (Array.isArray(parsed)) {
          return parsed.filter(tag => typeof tag === 'string');
        }
      } catch (e) {
        return [];
      }
    }
    
    return [];
  };

  // Helper function to get the translation to display (prioritize targetEdited over target)
  const getDisplayTranslation = (sentence: any): string | null => {
    return sentence.targetEdited || sentence.target || null;
  };

  // Helper function to check if translation has been edited
  const isTranslationEdited = (sentence: any): boolean => {
    return !!sentence.targetAi && !!sentence.targetEdited && 
           sentence.targetAi !== sentence.targetEdited;
  };

  // Calculate available tags from all sentences in the current notebook OR recent notes
  // Includes the system "Edited" tag if any notes have edited translations
  const availableTags = React.useMemo(() => {
    const tagSet = new Set<string>();
    let hasEditedNotes = false;
    
    // If a notebook is selected, use notebook sentences
    if (selectedNotebook && notebookSentences && Array.isArray(notebookSentences)) {
      notebookSentences.forEach((sentence: any) => {
        extractTags(sentence).forEach(tag => tagSet.add(tag));
        if (isTranslationEdited(sentence)) hasEditedNotes = true;
      });
    } else if (recentNotes && Array.isArray(recentNotes)) {
      // Otherwise use recent notes
      recentNotes.forEach((note: any) => {
        extractTags(note).forEach(tag => tagSet.add(tag));
        if (isTranslationEdited(note)) hasEditedNotes = true;
      });
    }
    
    // Add "Edited" system tag if there are edited translations
    if (hasEditedNotes) {
      tagSet.add('Edited');
    }
    
    return Array.from(tagSet).sort();
  }, [selectedNotebook, notebookSentences, recentNotes]);

  // Filter sentences based on search query, note filter, tag filter, and only show sentences with notes
  const filteredSentences = React.useMemo(() => {
    console.log('[NOTEBOOKS_FILTER] === FILTER DEBUG START ===');
    console.log('[NOTEBOOKS_FILTER] notebookSentences raw:', notebookSentences);
    console.log('[NOTEBOOKS_FILTER] noteFilter:', noteFilter);
    console.log('[NOTEBOOKS_FILTER] selectedTags:', selectedTags);

    if (!notebookSentences || !Array.isArray(notebookSentences)) {
      console.log('[NOTEBOOKS_FILTER] No valid sentences data - returning empty array');
      return [];
    }

    if (notebookSentences.length === 0) {
      console.log('[NOTEBOOKS_FILTER] Empty sentences array - returning empty array');
      return [];
    }

    // First apply note type filter (similar to RightDrawer)
    let typeFiltered = notebookSentences;
    if (noteFilter === "highlights") {
      typeFiltered = notebookSentences.filter((sentence: any) => {
        const noteContent = sentence.noteContent || sentence.content || sentence.note;
        return noteContent === null && sentence.noteId;
      });
    } else if (noteFilter === "notes") {
      typeFiltered = notebookSentences.filter((sentence: any) => {
        const noteContent = sentence.noteContent || sentence.content || sentence.note;
        return noteContent !== null && sentence.noteId;
      });
    }

    console.log(`[NOTEBOOKS_FILTER] After type filter (${noteFilter}):`, typeFiltered.length);

    // Apply tag filter if any tags are selected (includes system "Edited" tag)
    let tagFiltered = typeFiltered;
    if (selectedTags.length > 0) {
      tagFiltered = typeFiltered.filter((sentence: any) => {
        const sentenceTags = extractTags(sentence);
        // Check for "Edited" system tag separately
        const hasEditedTag = selectedTags.includes('Edited') && isTranslationEdited(sentence);
        const hasUserTag = selectedTags.some(tag => tag !== 'Edited' && sentenceTags.includes(tag));
        return hasEditedTag || hasUserTag;
      });
      console.log(`[NOTEBOOKS_FILTER] After tag filter:`, tagFiltered.length);
    }

    // Then apply search filter if there's a query
    if (!searchQuery || !selectedNotebook) {
      console.log('[NOTEBOOKS_FILTER] No search query, returning filtered sentences:', tagFiltered.length);
      return tagFiltered;
    }

    const query = searchQuery.toLowerCase();
    const searchFiltered = tagFiltered.filter((sentence: any) => {
      const displayTranslation = sentence.targetEdited || sentence.target;
      const textMatch = 
        sentence.source?.toLowerCase().includes(query) ||
        displayTranslation?.toLowerCase().includes(query) ||
        sentence.userTranslation?.toLowerCase().includes(query) ||
        sentence.noteContent?.toLowerCase().includes(query) ||
        sentence.content?.toLowerCase().includes(query) ||
        sentence.note?.toLowerCase().includes(query);

      const tagsMatch = (() => {
        const noteTags = sentence.noteTags || sentence.tags;
        if (!noteTags) return false;
        
        if (Array.isArray(noteTags)) {
          return noteTags.some(tag => 
            typeof tag === 'string' && tag.toLowerCase().includes(query)
          );
        }
        
        if (typeof noteTags === 'string') {
          try {
            const parsed = JSON.parse(noteTags);
            if (Array.isArray(parsed)) {
              return parsed.some(tag => 
                typeof tag === 'string' && tag.toLowerCase().includes(query)
              );
            }
          } catch (e) {
            return noteTags.toLowerCase().includes(query);
          }
        }
        
        return false;
      })();

      return textMatch || tagsMatch;
    });

    console.log('[NOTEBOOKS_FILTER] Final filtered sentences:', searchFiltered.length);
    return searchFiltered;
  }, [notebookSentences, searchQuery, selectedNotebook, noteFilter, selectedTags, loadingSentences]);

  // Calculate counts for different note types (similar to RightDrawer)
  const noteCounts = React.useMemo(() => {
    if (!notebookSentences || !Array.isArray(notebookSentences)) {
      return { all: 0, highlights: 0, notes: 0 };
    }

    const highlights = notebookSentences.filter((sentence: any) => {
      const noteContent = sentence.noteContent || sentence.content || sentence.note;
      return noteContent === null && sentence.noteId;
    }).length;
    
    const contentNotes = notebookSentences.filter((sentence: any) => {
      const noteContent = sentence.noteContent || sentence.content || sentence.note;
      return noteContent !== null && sentence.noteId;
    }).length;
    
    return {
      all: notebookSentences.length,
      highlights,
      notes: contentNotes
    };
  }, [notebookSentences]);

  // Create notebook mutation
  const createNotebookMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("/api/notebooks", { method: "POST", json: data });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notebooks"] });
      setIsCreateDialogOpen(false);
      setNewNotebook({ title: "", description: "", isPublic: false, colorLabel: "white", groupLabel: null, groupId: null });
      toast({
        title: t('common.success'),
        description: t('notebooks.notebookCreated'),
      });
    },
    onError: () => {
      toast({
        title: t('common.error'),
        description: t('notebooks.failedToCreateNotebook'),
        variant: "destructive",
      });
    },
  });

  // Edit notebook mutation
  const editNotebookMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: any }) => {
      return apiRequest(`/api/notebooks/${id}`, { method: "PUT", json: data });
    },
    onSuccess: (updatedNotebook) => {
      queryClient.invalidateQueries({ queryKey: ["/api/notebooks"] });
      setSelectedNotebook(updatedNotebook);
      setIsEditDialogOpen(false);
      setEditNotebook({ title: "", description: "", isPublic: false, colorLabel: null, groupId: null });
      toast({
        title: t('common.success'),
        description: t('notebooks.notebookUpdated'),
      });
    },
    onError: () => {
      toast({
        title: t('common.error'),
        description: t('notebooks.failedToUpdateNotebook'),
        variant: "destructive",
      });
    },
  });

  // Delete notebook mutation
  const deleteNotebookMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest(`/api/notebooks/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notebooks"] });
      setSelectedNotebook(null);
      toast({
        title: t('common.success'),
        description: t('notebooks.notebookDeleted'),
      });
    },
    onError: () => {
      toast({
        title: t('common.error'),
        description: t('notebooks.failedToDeleteNotebook'),
        variant: "destructive",
      });
    },
  });

  const handleCreateNotebook = () => {
    if (!newNotebook.title.trim()) {
      toast({
        title: "Error",
        description: "Please enter a title for the notebook",
        variant: "destructive",
      });
      return;
    }

    console.log('=== CREATE NOTEBOOK DEBUG ===');
    console.log('newNotebook state before processing:', newNotebook);
    console.log('newNotebook.colorLabel value:', newNotebook.colorLabel);
    console.log('typeof newNotebook.colorLabel:', typeof newNotebook.colorLabel);
    console.log('Will send colorLabel:', newNotebook.colorLabel);
    console.log('================================');

    createNotebookMutation.mutate({
      title: newNotebook.title,
      description: newNotebook.description || null,
      isPublic: newNotebook.isPublic,
      colorLabel: newNotebook.colorLabel || "white", // Ensure colorLabel is never null/undefined
      groupId: newNotebook.groupId ?? null
    });
  };

  const handleEditNotebook = (notebook?: NotebookWithStats) => {
    const notebookToEdit = notebook || selectedNotebook;
    if (!notebookToEdit) return;

    console.log('handleEditNotebook - notebook data:', notebookToEdit);
    console.log('handleEditNotebook - original colorLabel:', notebookToEdit.colorLabel);

    // Populate edit form with current notebook data
    const editData = {
      title: notebookToEdit.title,
      description: notebookToEdit.description || "",
      isPublic: notebookToEdit.isPublic || false,
      colorLabel: notebookToEdit.colorLabel,
      groupId: notebookToEdit.groupId || null,
    };

    console.log('handleEditNotebook - setting editNotebook to:', editData);
    setEditNotebook(editData);

    // Only set the notebook as selected if it's passed as parameter and different from current
    if (notebook && (!selectedNotebook || selectedNotebook.id !== notebook.id)) {
      setSelectedNotebook(notebook);
    }

    setIsEditDialogOpen(true);
  };

  const handleUpdateNotebook = () => {
    if (!selectedNotebook || !editNotebook.title.trim()) {
      toast({
        title: "Error",
        description: "Please enter a title for the notebook",
        variant: "destructive",
      });
      return;
    }

    console.log('handleUpdateNotebook - editNotebook state:', editNotebook);
    console.log('handleUpdateNotebook - editNotebook.colorLabel value:', editNotebook.colorLabel);
    console.log('handleUpdateNotebook - typeof editNotebook.colorLabel:', typeof editNotebook.colorLabel);

    const updateData = {
      title: editNotebook.title,
      description: editNotebook.description || null,
      isPublic: editNotebook.isPublic,
      colorLabel: editNotebook.colorLabel,
      groupId: editNotebook.groupId,
    };

    console.log('handleUpdateNotebook - will send update data:', updateData);

    editNotebookMutation.mutate({
      id: selectedNotebook.id,
      data: updateData
    });
  };

  const handleDeleteNotebook = (notebook: NotebookWithStats) => {
    setConfirmDialog({ open: true, type: 'deleteNotebook', data: notebook });
  };

  const handleExportNotebook = (format: 'markdown' | 'csv' | 'txt') => {
    if (!selectedNotebook || !notebookSentences || !Array.isArray(notebookSentences)) return;

    const content = exportSentences(notebookSentences, {
      format,
      includeTranslations: true,
      includeNotes: true,
      includeTags: true,
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `${selectedNotebook.title.replace(/[^a-zA-Z0-9]/g, '_')}_${timestamp}.${format}`;

    const mimeTypes = {
      markdown: 'text/markdown',
      csv: 'text/csv',
      txt: 'text/plain',
    };

    downloadFile(content, filename, mimeTypes[format]);
  };

  const handleExportSelectedNotes = (format: 'markdown' | 'csv' | 'txt') => {
    if (!selectedNotebook || !notebookSentences || !Array.isArray(notebookSentences) || selectedNoteIds.length === 0) return;

    // Filter sentences to only include selected notes
    const selectedSentences = (notebookSentences as any[]).filter((s: any) =>
      s.noteId && selectedNoteIds.includes(s.noteId)
    );

    if (selectedSentences.length === 0) {
      toast({
        title: 'No data',
        description: 'No valid notes selected for export',
        variant: 'destructive'
      });
      return;
    }

    const content = exportSentences(selectedSentences, {
      format,
      includeTranslations: true,
      includeNotes: true,
      includeTags: true,
    });

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `selected_notes_${timestamp}.${format}`;

    const mimeTypes = {
      markdown: 'text/markdown',
      csv: 'text/csv',
      txt: 'text/plain',
    };

    downloadFile(content, filename, mimeTypes[format]);

    toast({
      title: 'Export successful',
      description: `${selectedSentences.length} notes exported as ${format.toUpperCase()}`
    });
  };

  // Group management functions
  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      toast({
        title: 'Error',
        description: 'Please enter a group name',
        variant: 'destructive'
      });
      return;
    }

    try {
      const response = await apiRequest('/api/notebook-groups', {
        method: 'POST',
        json: {
          name: newGroupName.trim(),
          color: 'blue',
          icon: null
        }
      });

      toast({
        title: t('common.success'),
        description: t('notebooks.groupCreated')
      });

      // If we're in the Create New Notebook flow, auto-select the new group
      if (isCreateDialogOpen && response.group) {
        setNewNotebook(prev => ({ ...prev, groupId: response.group.id }));
      }

      // If we're in the Edit Notebook flow, auto-select the new group
      if (isEditDialogOpen && response.group) {
        setEditNotebook(prev => ({ ...prev, groupId: response.group.id }));
      }

      setNewGroupName('');
      setShowCreateGroupDialog(false);
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notebook-groups'] });
    } catch (error: any) {
      console.error('Create group error:', error);
      toast({
        title: t('common.error'),
        description: error.message || t('notebooks.failedToCreateGroup'),
        variant: 'destructive'
      });
    }
  };

  const handleEditGroup = async () => {
    if (!groupToEdit.trim() || !editingGroup) return;

    try {
      const response = await apiRequest(`/api/notebook-groups/${editingGroup.id}`, {
        method: 'PATCH',
        json: {
          name: groupToEdit.trim()
        }
      });

      toast({
        title: t('common.success'),
        description: t('notebooks.groupUpdated')
      });

      setGroupToEdit('');
      setEditingGroup(null);
      setShowEditGroupDialog(false);
      setShowManageGroupsDialog(true); // Return to Manage Groups modal
      queryClient.invalidateQueries({ queryKey: ['/api/notebooks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notebook-groups'] });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('notebooks.failedToEditGroup'),
        variant: 'destructive'
      });
    }
  };

  const handleDeleteGroup = async (group: {id: number; name: string}) => {
    setConfirmDialog({ open: true, type: 'deleteGroup', data: group });
  };

  const executeDeleteGroup = async (group: {id: number; name: string}) => {
    try {
      await apiRequest(`/api/notebook-groups/${group.id}`, {
        method: 'DELETE'
      });

      toast({
        title: t('common.success'),
        description: t('notebooks.groupDeleted')
      });

      queryClient.invalidateQueries({ queryKey: ['/api/notebooks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notebook-groups'] });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('notebooks.failedToDeleteGroup'),
        variant: 'destructive'
      });
    }
  };

  const handleMoveToGroup = async (notebookId: number, targetGroupId: number | null) => {
    try {
      await apiRequest(`/api/notebooks/${notebookId}/group`, {
        method: 'PATCH',
        json: {
          groupId: targetGroupId
        }
      });

      toast({
        title: t('common.success'),
        description: t('notebooks.notebookMoved')
      });

      queryClient.invalidateQueries({ queryKey: ['/api/notebooks'] });
      queryClient.invalidateQueries({ queryKey: ['/api/notebook-groups'] });
    } catch (error) {
      toast({
        title: t('common.error'),
        description: t('notebooks.failedToMoveNotebook'),
        variant: 'destructive'
      });
    }
  };

  const toggleGroupCollapse = (groupName: string) => {
    setCollapsedGroups(prev => {
      const newSet = new Set(prev);
      if (newSet.has(groupName)) {
        newSet.delete(groupName);
      } else {
        newSet.add(groupName);
      }
      return newSet;
    });
  };

  // Drag and drop handlers
  const handleDragStart = (e: React.DragEvent, notebook: NotebookWithStats) => {
    setDraggedNotebook(notebook);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, groupName: string | null) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverGroup(groupName);
  };

  const handleDragLeave = () => {
    setDragOverGroup(null);
  };

  const handleDrop = async (e: React.DragEvent, targetGroup: string | null) => {
    e.preventDefault();
    setDragOverGroup(null);

    if (!draggedNotebook) return;

    // Convert group name to group ID
    let targetGroupId: number | null = null;
    if (targetGroup && targetGroup !== 'Unfiled') {
      const group = availableGroups?.groups.find(g => g.name === targetGroup);
      targetGroupId = group?.id || null;
    }

    // Move to different group if needed
    if (draggedNotebook.groupId !== targetGroupId) {
      await handleMoveToGroup(draggedNotebook.id, targetGroupId);
    }

    setDraggedNotebook(null);
  };

  // Handle reordering within groups or between groups
  const handleReorderNotebooks = async (sourceIndex: number, targetIndex: number, sourceGroup: string | null, targetGroup: string | null) => {
    try {
      const allNotebooks = notebooks || [];

      // Create array of all notebooks with their current positions
      const notebookUpdates = allNotebooks.map((notebook, index) => ({
        id: notebook.id,
        groupLabel: notebook.groupLabel,
        groupOrder: notebook.groupOrder || index
      }));

      // Find the notebook being moved
      const sourceNotebook = notebookUpdates.find((n, idx) =>
        allNotebooks[idx].groupLabel === sourceGroup && idx === sourceIndex
      );

      if (!sourceNotebook) return;

      // Update the moved notebook's group and position
      sourceNotebook.groupLabel = targetGroup;
      sourceNotebook.groupOrder = targetIndex;

      // Adjust other notebooks' positions
      notebookUpdates.forEach((notebook, index) => {
        if (notebook.id === sourceNotebook.id) return;

        const originalNotebook = allNotebooks[index];

        // If moving within same group
        if (sourceGroup === targetGroup && originalNotebook.groupLabel === targetGroup) {
          if (index < sourceIndex && index >= targetIndex) {
            notebook.groupOrder = (notebook.groupOrder || index) + 1;
          } else if (index > sourceIndex && index <= targetIndex) {
            notebook.groupOrder = (notebook.groupOrder || index) - 1;
          }
        }
        // If moving to different group, adjust positions in both groups
        else {
          // Source group: shift up notebooks after source position
          if (originalNotebook.groupLabel === sourceGroup && index > sourceIndex) {
            notebook.groupOrder = (notebook.groupOrder || index) - 1;
          }
          // Target group: shift down notebooks at/after target position
          if (originalNotebook.groupLabel === targetGroup && index >= targetIndex) {
            notebook.groupOrder = (notebook.groupOrder || index) + 1;
          }
        }
      });

      // Send update to backend
      await apiRequest('/api/notebooks/reorder', {
        method: 'PATCH',
        json: {
          items: notebookUpdates
        }
      });

      queryClient.invalidateQueries({ queryKey: ['/api/notebooks'] });

      toast({
        title: t('common.success'),
        description: t('notebooks.notebooksReordered')
      });
    } catch (error) {
      console.error('Reorder error:', error);
      toast({
        title: t('common.error'),
        description: t('notebooks.failedToReorderNotebooks'),
        variant: 'destructive'
      });
    }
  };

  // Handle Move/Copy/Delete actions
  const handleMoveNotes = (noteIds: number[]) => {
    setOperationNoteIds(noteIds);
    setShowMoveModal(true);
  };

  const handleCopyNotes = (noteIds: number[]) => {
    setOperationNoteIds(noteIds);
    setShowCopyModal(true);
  };

  const handleDeleteNotes = (noteIds: number[]) => {
    setConfirmDialog({ open: true, type: 'deleteNotes', data: noteIds });
  };

  const handleMoveConfirm = (targetNotebookId: number, targetNotebookTitle: string) => {
    moveNotesMutation.mutate({
      noteIds: operationNoteIds,
      targetNotebookId
    });
    setShowMoveModal(false);
    setOperationNoteIds([]);
  };

  const handleCopyConfirm = (targetNotebookId: number, targetNotebookTitle: string) => {
    copyNotesMutation.mutate({
      noteIds: operationNoteIds,
      targetNotebookId
    });
    setShowCopyModal(false);
    setOperationNoteIds([]);
  };

  // Show login required message for non-authenticated users
  if (!authLoading && !isAuthenticated) {
    return (
      <Layout>
        <div className="min-h-[calc(100vh-64px)] flex items-center justify-center bg-muted/30 dark:bg-muted/10">
          <div className="max-w-md w-full px-6">
            <Alert className="mb-6">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t('auth.loginRequired')}</AlertTitle>
              <AlertDescription>
                {t('notebooks.subtitle')}
              </AlertDescription>
            </Alert>
            <div className="text-center">
              <Button onClick={() => setLocation('/login')}>
                {t('auth.login')}
              </Button>
              <Button onClick={() => setLocation('/signup')} variant="outline" className="ml-2">
                {t('auth.signUp')}
              </Button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const handleConfirmAction = () => {
    if (confirmDialog.type === 'deleteNotebook' && confirmDialog.data) {
      deleteNotebookMutation.mutate(confirmDialog.data.id);
    } else if (confirmDialog.type === 'deleteGroup' && confirmDialog.data) {
      executeDeleteGroup(confirmDialog.data);
    } else if (confirmDialog.type === 'deleteNotes' && confirmDialog.data) {
      deleteNotesMutation.mutate(confirmDialog.data);
    }
    setConfirmDialog({ open: false, type: '' });
  };

  const getConfirmDialogProps = () => {
    switch (confirmDialog.type) {
      case 'deleteNotebook':
        return {
          title: t('common.delete'),
          description: t('notebooks.deleteNotebookConfirm', { title: confirmDialog.data?.title || '' }),
        };
      case 'deleteGroup':
        return {
          title: t('common.delete'),
          description: t('notebooks.deleteGroupConfirm', { name: confirmDialog.data?.name || '' }),
        };
      case 'deleteNotes':
        return {
          title: t('common.delete'),
          description: confirmDialog.data?.length === 1
            ? t('notebooks.deleteNoteConfirm')
            : t('notebooks.deleteNotesConfirm', { count: confirmDialog.data?.length || 0 }),
        };
      default:
        return { title: '', description: '' };
    }
  };

  return (
    <Layout>
      <PageShell maxWidth="standard">
        <HeaderBar
          title={t('notebooks.title')}
          subtitle={t('notebooks.subtitle')}
          controlsLeft={
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
              {/* Toggle left panel button */}
              <Button
                variant="secondary"
                size="sm"
                onClick={toggleLeftPanel}
                className="hidden lg:flex w-8 h-8 p-0 items-center justify-center hover:bg-secondary/80 transition-colors flex-shrink-0"
                aria-expanded={!isLeftPanelCollapsed}
                aria-controls="notebooks-left-panel"
                title={isLeftPanelCollapsed ? t('notebooks.showNotebooks') : t('notebooks.hideNotebooks')}
                data-testid="button-toggle-left-panel"
              >
                {isLeftPanelCollapsed ? (
                  <span className="flex items-center justify-center" style={{fontSize: '20px', lineHeight: '1'}}>☰</span>
                ) : (
                  <span className="flex items-center justify-center" style={{fontSize: '20px', lineHeight: '1'}}>◧</span>
                )}
              </Button>
              
              {/* Search - better balanced width */}
              <div className="relative w-full sm:flex-1 sm:min-w-[200px] lg:max-w-[400px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
                <Input
                  data-testid="input-search"
                  placeholder={
                    selectedNotebook
                      ? t('notebooks.searchInNotebook', { title: selectedNotebook.title })
                      : t('notebooks.searchPlaceholder')
                  }
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
                {selectedNotebook && searchQuery && (
                  <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                    <div 
                      className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 px-2 py-1 rounded text-xs flex items-center gap-1 cursor-pointer hover:bg-blue-200 dark:hover:bg-blue-800"
                      onClick={() => setSelectedNotebook(null)}
                    >
                      📓 In "{selectedNotebook.title}" ×
                    </div>
                  </div>
                )}
              </div>

              {/* Sort - compact */}
              <div className="flex-shrink-0 w-[calc(50%-6px)] sm:w-auto">
                <Select value={sortBy} onValueChange={(value) => setSortBy(value as any)}>
                  <SelectTrigger data-testid="select-sort" className="w-full sm:w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">{t('notebooks.recent')}</SelectItem>
                    <SelectItem value="alphabetical">{t('notebooks.alphabetical')}</SelectItem>
                    <SelectItem value="sentence-count">{t('notebooks.sentenceCount')}</SelectItem>
                    <SelectItem value="created">{t('notebooks.created')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Quick filter buttons: All / Highlights / Notes */}
              <div className="hidden md:flex items-center gap-2 flex-shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNoteFilter("all")}
                  className={`h-8 px-3 text-xs rounded-full transition-all duration-200 ${
                    noteFilter === "all" 
                      ? "bg-[#F0F7F4] text-[#2F5D50]" 
                      : "bg-transparent text-muted-foreground/60 hover:bg-muted/50"
                  }`}
                  data-testid="button-filter-all-header"
                >
                  <FileText className={`h-3.5 w-3.5 mr-1.5 stroke-[1.5] ${noteFilter === "all" ? "text-[#2F5D50]" : "text-muted-foreground/60"}`} />
                  {t('notebooks.all')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNoteFilter("highlights")}
                  className={`h-8 px-3 text-xs rounded-full transition-all duration-200 ${
                    noteFilter === "highlights" 
                      ? "bg-amber-50/60 text-[#8B7355]" 
                      : "bg-transparent text-muted-foreground/60 hover:bg-muted/50"
                  }`}
                  data-testid="button-filter-highlights-header"
                >
                  <Highlighter className={`h-3.5 w-3.5 mr-1.5 stroke-[1.5] ${noteFilter === "highlights" ? "text-[#8B7355]" : "text-muted-foreground/60"}`} />
                  {t('notebooks.highlights')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setNoteFilter("notes")}
                  className={`h-8 px-3 text-xs rounded-full transition-all duration-200 ${
                    noteFilter === "notes" 
                      ? "bg-blue-50 text-slate-600" 
                      : "bg-transparent text-muted-foreground/60 hover:bg-muted/50"
                  }`}
                  data-testid="button-filter-notes-header"
                >
                  <NotepadTextIcon className={`h-3.5 w-3.5 mr-1.5 stroke-[1.5] ${noteFilter === "notes" ? "text-slate-600" : "text-muted-foreground/60"}`} />
                  {t('notebooks.notes')}
                </Button>
              </div>

              {/* Tags filter popover - Modern Zen style */}
              <div className="flex-shrink-0 w-[calc(50%-6px)] sm:w-auto">
                <Popover open={isTagFilterOpen} onOpenChange={setIsTagFilterOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={`h-8 px-3 text-xs rounded-full transition-all duration-200 ${
                        selectedTags.length > 0
                          ? "bg-[#F0F7F4] text-[#2F5D50]"
                          : "bg-transparent text-muted-foreground/60 hover:bg-muted/50"
                      }`}
                      data-testid="button-tags-filter"
                    >
                      <Tag className={`h-3.5 w-3.5 mr-1.5 stroke-[1.5] ${selectedTags.length > 0 ? "text-[#2F5D50]" : "text-muted-foreground/60"}`} />
                      {t('notebooks.tags')}
                      {selectedTags.length > 0 && (
                        <span className="ml-1 text-[10px] bg-[#2F5D50]/20 text-[#2F5D50] px-1.5 py-0.5 rounded-full">
                          {selectedTags.length}
                        </span>
                      )}
                      <ChevronDown className={`h-3 w-3 ml-1 ${selectedTags.length > 0 ? "text-[#2F5D50]" : "text-muted-foreground/60"}`} />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-3" align="end">
                    <div className="space-y-3">
                      {/* Header with selected tags as removable chips */}
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="font-medium text-sm flex-shrink-0">{t('notebooks.filterByTags')}</h4>
                        {selectedTags.length > 0 && (
                          <div className="flex items-center gap-1 flex-wrap justify-end">
                            {selectedTags.map((tag: string) => (
                              <Badge
                                key={tag}
                                variant="secondary"
                                className="text-[10px] h-5 px-1.5 cursor-pointer hover:bg-destructive/20"
                                onClick={() => setSelectedTags(prev => prev.filter(t => t !== tag))}
                                data-testid={`selected-tag-${tag}`}
                              >
                                {tag}
                                <X className="h-2.5 w-2.5 ml-0.5" />
                              </Badge>
                            ))}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setSelectedTags([])}
                              className="h-5 px-1.5 text-[10px] text-muted-foreground"
                            >
                              {t('common.clear')}
                            </Button>
                          </div>
                        )}
                      </div>
                      <div className="max-h-48 overflow-y-auto">
                        {availableTags.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-2">
                            {t('notebooks.noTagsAvailable')}
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {availableTags.map((tag: string) => (
                              <Badge
                                key={tag}
                                variant={selectedTags.includes(tag) ? "default" : "outline"}
                                className={`cursor-pointer text-xs ${
                                  selectedTags.includes(tag) 
                                    ? "text-white" 
                                    : "hover:bg-muted"
                                }`}
                                style={{
                                  backgroundColor: selectedTags.includes(tag) ? '#2F5D50' : undefined,
                                  borderColor: selectedTags.includes(tag) ? '#2F5D50' : undefined,
                                }}
                                onClick={() => {
                                  setSelectedTags(prev =>
                                    prev.includes(tag)
                                      ? prev.filter(t => t !== tag)
                                      : [...prev, tag]
                                  );
                                }}
                                data-testid={`tag-filter-${tag}`}
                              >
                                {tag}
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Vertical divider before Manage Notebooks */}
              <div className="hidden md:block h-5 w-px bg-gray-200 dark:bg-gray-700 mx-2 flex-shrink-0" />

              {/* Manage Notebooks button */}
              <Button
                variant="outline"
                data-testid="button-notebook-management"
                className="whitespace-nowrap w-auto flex-shrink-0 rounded-xl border-[#2F5D50]/20 text-[#2F5D50] hover:bg-[hsl(var(--brand-subtle))] hover:text-[#2F5D50]"
                onClick={() => {
                  setManagementTab('create');
                  setShowNotebookManagementModal(true);
                }}
              >
                <NotebookPen className="h-4 w-4 mr-2" />
                {t('notebooks.notebookManagement')}
              </Button>
            </div>
          }
          controlsRight={null}
        />
        
        <PageBody>
          <div className={`grid grid-cols-1 gap-6 pb-20 ${
            isLeftPanelCollapsed 
              ? 'lg:grid-cols-1' 
              : 'lg:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]'
          }`}>
          {!isLeftPanelCollapsed && (
            <aside 
              id="notebooks-left-panel"
              role="region"
              aria-label="Notebooks and groups"
              className="hidden lg:flex min-w-0 flex-col lg:sticky lg:top-4 lg:max-h-[calc(100vh-120px)] transition-all duration-150 ease-out"
            >
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-4">
              {isLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400 mx-auto"></div>
                  <p className="text-gray-600 mt-2 text-sm">{t('notebooks.loading')}</p>
                </div>
              ) : !notebooks || notebooks.length === 0 ? (
                <div className="text-center py-8">
                  <BookOpen className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">{t('notebooks.noNotebooks')}</p>
                  <p className="text-sm text-gray-500">
                    {t('notebooks.noNotebooksDesc')}
                  </p>
                </div>
              ) : totalNotebooksCount === 0 ? (
                <div className="text-center py-8">
                  <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">{t('notebooks.noNotebooksMatch')}</p>
                  <p className="text-sm text-gray-500">
                    {t('notebooks.noNotebooksDesc')}
                  </p>
                </div>
              ) : (
                <div className="space-y-6 mt-4">
                {Object.entries(groupedNotebooks).map(([groupName, notebooksInGroup]) => {
                  const isCollapsed = collapsedGroups.has(groupName);
                  const isDragOver = dragOverGroup === groupName;

                  return (
                  <div
                    key={groupName}
                    className="space-y-3"
                    onDragOver={(e) => handleDragOver(e, groupName)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, groupName)}
                  >
                    {/* Group header */}
                    <div className={`flex items-center gap-2 py-2 px-3 rounded-lg transition-all ${
                      isDragOver ? 'bg-gray-100 dark:bg-gray-800 border-2 border-gray-300 border-dashed dark:border-gray-600' : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                    }`}>
                      <button
                        onClick={() => toggleGroupCollapse(groupName)}
                        className="flex items-center gap-2 flex-1 text-left"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 uppercase tracking-wide flex items-center gap-2">
                          <span className="text-base flex items-center">
                            {groupName === t('notebooks.unfiled')
                              ? <FolderOpen className="h-4 w-4" />
                              : ((availableGroups?.groups || []).find(g => g.name === groupName)?.icon || <FolderOpen className="h-4 w-4" />)
                            }
                          </span>
                          {groupName}
                        </h3>
                        <div className="flex-1 h-px bg-gray-200"></div>
                        <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                          {notebooksInGroup.length}
                        </span>
                      </button>

                    </div>

                    {/* Notebooks in group */}
                    {!isCollapsed && (
                    <div className="space-y-2 px-2">
                      {notebooksInGroup.map((notebook: NotebookWithStats) => (
                  <div
                    key={notebook.id}
                    className={`cursor-pointer transition-all hover:shadow-md shadow-sm rounded-xl ${
                      selectedNotebook?.id === notebook.id ? 'bg-[hsl(var(--brand-subtle))]' : 'bg-card'
                    }`}
                    onClick={() => {
                      if (selectedNotebook?.id === notebook.id) {
                        setSelectedNotebook(null); // deselect if already selected
                      } else {
                        setSelectedNotebook(notebook); // select if different or none selected
                      }
                    }}
                    draggable
                    onDragStart={(e: React.DragEvent) => handleDragStart(e, notebook)}
                  >
                    <div className="py-4 pl-4 pr-2 flex flex-col gap-3">
                      {/* Header: Title + Actions */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <h3 className="font-semibold text-card-foreground truncate">{notebook.title}</h3>
                          {notebook.isPublic && (
                            <Badge variant="outline" className="text-xs flex-shrink-0">
                              <Users className="h-3 w-3 mr-1" />
                              Public
                            </Badge>
                          )}
                        </div>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={(e) => e.stopPropagation()}
                              className="text-gray-400 hover:text-gray-600 h-6 w-6 p-0 flex-shrink-0"
                            >
                              <MoreVertical className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-48">
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditNotebook(notebook);
                              }}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <Edit className="h-4 w-4" />
                              <span>{t('notebooks.editNotebook')}</span>
                            </DropdownMenuItem>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <div className="flex items-center gap-2 w-full px-2 py-1.5 text-sm cursor-pointer hover:bg-accent rounded-sm">
                                  <Move className="h-4 w-4" />
                                  <span>{t('notebooks.moveToGroup')}</span>
                                </div>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent side="left" className="w-40">
                                <DropdownMenuItem
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleMoveToGroup(notebook.id, null);
                                  }}
                                  className="flex items-center gap-2 cursor-pointer"
                                >
                                  <span className="flex items-center gap-2">
                                    <FolderOpen className="h-4 w-4" />
                                    {t('notebooks.unfiled')}
                                  </span>
                                </DropdownMenuItem>
                                {(availableGroups?.groups || [])
                                  .filter(group => group.name !== notebook.groupLabel)
                                  .map(group => (
                                  <DropdownMenuItem
                                    key={group.id}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleMoveToGroup(notebook.id, group.id);
                                    }}
                                    className="flex items-center gap-2 cursor-pointer"
                                  >
                                    <span className="flex items-center gap-2">
                                      {group.icon || <FolderOpen className="h-4 w-4" />}
                                      {group.name}
                                    </span>
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteNotebook(notebook);
                              }}
                              className="flex items-center gap-2 text-red-600 cursor-pointer"
                            >
                              <Trash2 className="h-4 w-4" />
                              <span>{t('notebooks.deleteConfirm')}</span>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>


                      {/* Footer: Meta info only */}
                      <div className="flex items-center gap-3 text-xs text-gray-400 dark:text-gray-500">
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {t('notebooks.notesCount', { count: notebook.sentenceCount })}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          {formatShortDate(notebook.createdAt, { timezone, language })}
                        </span>
                      </div>
                    </div>
                  </div>
                      ))}
                    </div>
                    )}
                  </div>
                  );
                })}
                </div>
              )}
            </div>
            
          </aside>
          )}
          <section className="min-w-0 flex flex-col pt-0 lg:pt-0">
            {selectedNotebook ? (
              /* Selected Notebook View - Use filteredSentences for notebook-specific results */
              (filteredSentences.length === 0 ? (<div className="flex items-center justify-center h-64">
                <div className="text-center">
                  {searchQuery ? (
                    <>
                      <Search className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600 mb-2">
                        {t('notebooks.noFilteredItemsFound', { 
                          filter: noteFilter === 'highlights' ? t('notebooks.highlights') : noteFilter === 'notes' ? t('notebooks.notes') : 'items',
                          query: searchQuery 
                        })}
                      </p>
                      <p className="text-sm text-gray-500">{t('notebooks.tryDifferentKeywords')}</p>
                    </>
                  ) : (
                    <>
                      {noteFilter === 'highlights' ? (
                        <>
                          <Highlighter className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                          <p className="text-gray-600 mb-2">{t('notebooks.noHighlightsYet')}</p>
                          <p className="text-sm text-gray-500">{t('notebooks.highlightTextInDocs')}</p>
                        </>
                      ) : noteFilter === 'notes' ? (
                        <>
                          <NotepadTextIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                          <p className="text-gray-600 mb-2">{t('notebooks.noNotesYet')}</p>
                          <p className="text-sm text-gray-500">{t('notebooks.createNotesFromDocs')}</p>
                        </>
                      ) : (
                        <>
                          <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                          <p className="text-gray-600 mb-2">{t('notebooks.noNotesOrHighlights')}</p>
                          <p className="text-sm text-gray-500">{t('notebooks.createSentencesFromDocs')}</p>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>) : (<div className="flex flex-col">
                {/* Notebook Header */}
                <div className="shrink-0 mt-8 mb-2 px-1">
                  <div className="flex items-start justify-between gap-3">
                    {/* Left side - Title and Description */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setSelectedNotebook(null)}
                          className="h-8 w-8 p-0 text-gray-500 hover:text-gray-700 lg:hidden"
                          title={t('notebooks.backToAllNotebooks')}
                          data-testid="button-back-to-notebooks"
                        >
                          <ArrowLeft className="h-4 w-4" />
                        </Button>
                        <h1 className="text-2xl font-bold text-card-foreground truncate">
                          {selectedNotebook.title}
                          {searchQuery && ` - ${t('notebooks.searchResults')}`}
                        </h1>
                        {selectedNotebook.isPublic && (
                          <Badge variant="outline" className="flex-shrink-0">
                            <Users className="h-3 w-3 mr-1" />
                            {t('notebooks.public')}
                          </Badge>
                        )}
                      </div>

                      {searchQuery && (
                        <p className="text-sm text-card-foreground">
                          {t('notebooks.notesFoundFor', { 
                            count: filteredSentences.length,
                            plural: filteredSentences.length === 1 ? '' : 's',
                            query: searchQuery 
                          })}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                {/* Sub-header: Note count with select all */}
                <div className="shrink-0 px-1 mb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={filteredSentences.length > 0 && selectedNoteIds.length === filteredSentences.length}
                        onCheckedChange={(checked: boolean) => {
                          if (checked) {
                            setSelectedNoteIds(filteredSentences.map((s: any) => s.noteId).filter(Boolean));
                          } else {
                            setSelectedNoteIds([]);
                          }
                        }}
                        disabled={!filteredSentences || filteredSentences.length === 0}
                        data-testid="checkbox-select-all-notes"
                      />
                      <p className="text-sm text-muted-foreground">
                        {t('notebooks.showingNotes', { 
                          count: filteredSentences.length,
                          plural: filteredSentences.length === 1 ? '' : 's'
                        })}
                        {searchQuery && ` ${t('notebooks.matchingQuery', { query: searchQuery })}`}
                        {selectedNoteIds.length > 0 && (
                          <span className="ml-2 text-gray-500 dark:text-gray-500 font-medium">
                            {t('notebooks.selectedCount', { count: selectedNoteIds.length })}
                          </span>
                        )}
                      </p>
                    </div>
                    
                    {/* Bulk actions - show when notes are selected */}
                    {selectedNoteIds.length > 0 && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleMoveNotes(selectedNoteIds)}
                          disabled={moveNotesMutation.isPending}
                          className="h-7 px-2 text-xs"
                          data-testid="button-move-selected"
                        >
                          <Move className="h-3 w-3 mr-1" />
                          {t('notebooks.moveAction', { count: selectedNoteIds.length })}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyNotes(selectedNoteIds)}
                          disabled={copyNotesMutation.isPending}
                          className="h-7 px-2 text-xs"
                          data-testid="button-copy-selected"
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          {t('notebooks.copyAction', { count: selectedNoteIds.length })}
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleExportSelectedNotes('markdown')}
                          className="h-7 px-2 text-xs"
                          data-testid="button-export-selected"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          {t('notebooks.export')} ({selectedNoteIds.length})
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteNotes(selectedNoteIds)}
                          disabled={deleteNotesMutation.isPending}
                          className="h-7 px-2 text-xs text-red-600 border-red-200 hover:bg-red-50"
                          data-testid="button-delete-selected"
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          {t('notebooks.deleteAction', { count: selectedNoteIds.length })}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                {/* Notes List - Use filteredSentences for the selected notebook */}
                <div className="flex-1 flex flex-col">
                  {loadingSentences ? (
                    <div className="flex-1 flex items-center justify-center h-64">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto mb-4"></div>
                        <p className="text-gray-600">Loading notes...</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 px-1 space-y-6">
                      <div className="space-y-3">
                        {filteredSentences.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((sentence: any) => {
                          // Determine if this is a highlight (no content) or note (has content)
                          const noteContent = sentence.noteContent || sentence.content || sentence.note;
                          const isHighlight = noteContent === null && sentence.noteId;
                          const noteColor = sentence.noteColor || sentence.color;
                          
                          return (
                            <Card 
                              key={sentence.id} 
                              ref={editingNoteId === sentence.id ? editingCardRef : null}
                              className="cursor-pointer hover:shadow-md transition-shadow shadow-sm rounded-xl border-0"
                            >
                              <CardContent className="p-4">
                                <div className="relative">
                                  {/* Edit button - top right (for all cards) */}
                                  {editingNoteId !== sentence.id && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="absolute top-0 right-0 h-8 w-8 p-0 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                                      onClick={() => {
                                        setEditingNoteId(sentence.id);
                                        setNoteText(noteContent || "");
                                        try {
                                          const existingTags = parseTags(sentence.tags);
                                          setTagsText(Array.isArray(existingTags) ? existingTags : []);
                                        } catch (e) {
                                          setTagsText([]);
                                        }
                                      }}
                                    >
                                      <Edit2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                  <div className="flex items-start gap-3">
                                    <Checkbox
                                      checked={selectedNoteIds.includes(sentence.noteId)}
                                      onCheckedChange={(checked: boolean) => {
                                        if (checked && sentence.noteId) {
                                          setSelectedNoteIds(prev => [...prev, sentence.noteId]);
                                        } else {
                                          setSelectedNoteIds(prev => prev.filter((id: number) => id !== sentence.noteId));
                                        }
                                      }}
                                      className="mt-1 rounded border-gray-300"
                                      data-testid={`checkbox-note-${sentence.noteId}`}
                                    />
                                    <div className="flex-1 space-y-3">
                                      {/* Top: Original text - Dark gray, Bold */}
                                      <div className="text-gray-800 dark:text-gray-200 text-lg pr-8 font-semibold">
                                        {sentence.source}
                                      </div>

                                      {/* Middle: Translation and Notes */}
                                      <div className="space-y-2">
                                        {/* Translation - Regular gray, Regular - with inline editing */}
                                        {editingTranslationId === sentence.id ? (
                                          <div className="space-y-2">
                                            <Textarea
                                              value={translationEditText}
                                              onChange={(e) => setTranslationEditText(e.target.value)}
                                              placeholder={t('notebooks.enterTranslation') || 'Enter translation...'}
                                              className="min-h-[60px] resize-none text-gray-600 dark:text-gray-400"
                                            />
                                            <div className="flex justify-end gap-2">
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                  setEditingTranslationId(null);
                                                  setTranslationEditText("");
                                                }}
                                              >
                                                {t('common.cancel')}
                                              </Button>
                                              <Button
                                                size="sm"
                                                onClick={() => {
                                                  updateTranslationMutation.mutate({
                                                    sentenceId: sentence.id,
                                                    targetEdited: translationEditText,
                                                    documentId: sentence.documentId
                                                  });
                                                }}
                                                disabled={updateTranslationMutation.isPending}
                                              >
                                                {t('common.save')}
                                              </Button>
                                            </div>
                                          </div>
                                        ) : getDisplayTranslation(sentence) ? (
                                          <div className="text-gray-600 dark:text-gray-400 font-normal leading-relaxed flex items-start gap-2 group/translation">
                                            <span>{getDisplayTranslation(sentence)}</span>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 w-6 p-0 opacity-0 group-hover/translation:opacity-100 transition-opacity shrink-0"
                                              onClick={() => {
                                                setEditingTranslationId(sentence.id);
                                                setTranslationEditText(getDisplayTranslation(sentence) || "");
                                              }}
                                            >
                                              <Edit2 className="h-3 w-3" />
                                            </Button>
                                          </div>
                                        ) : null}

                                        {/* User translation */}
                                        {sentence.userTranslation && (
                                          <div className="text-gray-800 bg-gray-50 p-3 rounded-lg dark:text-gray-200 dark:bg-gray-800">
                                            {sentence.userTranslation}
                                          </div>
                                        )}

                                        {/* Note Content - only show for notes, not highlights */}
                                        {!isHighlight && noteContent && editingNoteId !== sentence.id && (
                                            <div className="mt-4 border-l-[4px] border-blue-400/40 pl-4 py-2 text-sm text-slate-900 dark:text-blue-200 leading-relaxed bg-muted/50 rounded-r">
                                            {noteContent}
                                          </div>
                                        )}
                                      </div>
                                      

                                    {/* Note Editing */}
                                    {editingNoteId === sentence.id && (
                                      <div className="space-y-3">
                                        <Textarea
                                          value={noteText}
                                          onChange={(e) => setNoteText(e.target.value)}
                                          placeholder={t('notebooks.addThoughts')}
                                          className="min-h-[80px] resize-none"
                                        />
                                        
                                        <div className="space-y-2">
                                          <div className="flex items-center gap-2">
                                            <Tag className="h-4 w-4 text-gray-500" />
                                            <label className="text-sm text-gray-600 dark:text-gray-400">Tags</label>
                                          </div>
                                          <div className="flex items-center gap-2 flex-wrap p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800">
                                            {tagsText.map((tag, index) => (
                                              <span 
                                                key={index}
                                                className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 px-2 py-1 rounded text-xs flex items-center gap-1 cursor-pointer"
                                                onClick={() => handleRemoveTag(index)}
                                                title={t('notebooks.clickToRemove')}
                                              >
                                                #{tag}
                                                <span className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200">×</span>
                                              </span>
                                            ))}
                                            <Input
                                              placeholder={t('notebooks.addTag')}
                                              className="text-sm border-none bg-transparent p-0 h-6 flex-1 min-w-[150px]"
                                              onKeyDown={(e) => {
                                                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                                  e.preventDefault();
                                                  handleAddTag(e.currentTarget.value.trim());
                                                  e.currentTarget.value = '';
                                                }
                                              }}
                                            />
                                          </div>
                                        </div>
                                        
                                        <div className="flex justify-end gap-2">
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            onClick={() => {
                                              setEditingNoteId(null);
                                              setNoteText("");
                                              setTagsText([]);
                                            }}
                                          >
                                            {t('common.cancel')}
                                          </Button>
                                          <Button
                                            size="sm"
                                            onClick={() => {
                                              console.log(`[TAG_DEBUG] Save button clicked. tagsText:`, tagsText, `noteText:`, noteText);
                                              if (sentence.noteId) {
                                                updateNoteMutation.mutate({
                                                  noteId: sentence.noteId,
                                                  content: noteText,
                                                  tags: tagsText,
                                                  documentId: sentence.documentId
                                                });
                                              }
                                            }}
                                            disabled={updateNoteMutation.isPending || !sentence.noteId}
                                          >
                                            {updateNoteMutation.isPending ? t('common.saving') : t('notebooks.saveNoteAndTags')}
                                          </Button>
                                        </div>
                                      </div>
                                    )}

                                      {/* Bottom (Metadata): Flex row for Group, Source Badge, Tags, and Date */}
                                      {editingNoteId !== sentence.id && (
                                        <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            {/* Group Info */}
                                            {selectedNotebook?.groupId && availableGroups?.groups && (
                                              <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                                                <FolderOpen className="h-3.5 w-3.5" />
                                                <span>{availableGroups.groups.find(g => g.id === selectedNotebook.groupId)?.name || ''}</span>
                                              </div>
                                            )}
                                            
                                            {/* Source Document Badge */}
                                            {sentence.documentTitle && (
                                              <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-normal">
                                                {sentence.documentTitle}
                                              </Badge>
                                            )}

                                            {/* Tags */}
                                            {(() => {
                                              try {
                                                const tags = parseTags(sentence.tags);
                                                const hasUserTags = Array.isArray(tags) && tags.length > 0;
                                                const hasEditedTag = isTranslationEdited(sentence);
                                                
                                                if (!hasUserTags && !hasEditedTag) return null;
                                                
                                                return (
                                                  <div className="flex items-center gap-1.5">
                                                    {/* System tag: Edited (displayed first, filterable like user tags) */}
                                                    {hasEditedTag && (
                                                      <span 
                                                        className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                                                          selectedTags.includes('Edited')
                                                            ? "bg-brand-subtle text-brand dark:bg-brand-soft dark:text-brand"
                                                            : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                                                        }`}
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          if (selectedTags.includes('Edited')) {
                                                            setSelectedTags(selectedTags.filter(t => t !== 'Edited'));
                                                          } else {
                                                            setSelectedTags([...selectedTags, 'Edited']);
                                                          }
                                                        }}
                                                        data-testid="tag-filter-Edited"
                                                      >
                                                        #Edited
                                                      </span>
                                                    )}
                                                    {/* User tags */}
                                                    {hasUserTags && tags.slice(0, 5).map((tag: string) => (
                                                      <span 
                                                        key={tag} 
                                                        className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                                                          selectedTags.includes(tag)
                                                            ? "bg-brand-subtle text-brand dark:bg-brand-soft dark:text-brand"
                                                            : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                                                        }`}
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          if (selectedTags.includes(tag)) {
                                                            setSelectedTags(selectedTags.filter(t => t !== tag));
                                                          } else {
                                                            setSelectedTags([...selectedTags, tag]);
                                                          }
                                                        }}
                                                        data-testid={`tag-filter-${tag}`}
                                                      >
                                                        #{tag}
                                                      </span>
                                                    ))}
                                                  </div>
                                                );
                                              } catch (e) {
                                                return null;
                                              }
                                            })()}
                                          </div>

                                          {/* Date - Right End */}
                                          {sentence.noteCreatedAt && (
                                            <div className="text-[10px] text-gray-400 dark:text-gray-500 font-light">
                                              {formatShortDate(sentence.noteCreatedAt, { timezone, language })}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })}
                      </div>
                      <div className="pt-4 pb-24 mt-auto">
                        <Pagination
                          currentPage={currentPage}
                          totalPages={Math.ceil(filteredSentences.length / itemsPerPage)}
                          onPageChange={setCurrentPage}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>))
            ) : !selectedNotebook && searchQuery && searchQuery.trim().length > 0 ? (
              /* Search Results Mode */
              (<div className="flex flex-col">
                <div className="shrink-0 bg-white border-b-2 border-gray-200 p-4 shadow-sm">
                  <h1 className="text-xl font-semibold text-card-foreground">
                    Search Results for "{searchQuery}"
                  </h1>
                  <div className="flex items-center justify-between mt-3">
                    <div className="flex items-center gap-2">
                      {searchResults && searchResults.length > 0 && (
                        <Checkbox
                          checked={(() => {
                            const allSearchNoteIds = searchResults.flatMap(result => 
                              result.sentences.map((s: any) => s.noteId).filter(Boolean)
                            );
                            return allSearchNoteIds.length > 0 && selectedNoteIds.length === allSearchNoteIds.length;
                          })()}
                          onCheckedChange={(checked: boolean) => {
                            const allSearchNoteIds = searchResults.flatMap(result => 
                              result.sentences.map((s: any) => s.noteId).filter(Boolean)
                            );
                            if (checked) {
                              setSelectedNoteIds(allSearchNoteIds);
                            } else {
                              setSelectedNoteIds([]);
                            }
                          }}
                          disabled={!searchResults || searchResults.length === 0}
                          data-testid="checkbox-select-all-search-notes"
                        />
                      )}
                      <p className="text-sm text-muted-foreground">
                        {loadingSearch ? 'Searching...' : searchResults && searchResults.length > 0 
                          ? `Found notes in ${searchResults.length} notebook${searchResults.length === 1 ? '' : 's'}`
                          : 'No notes found'
                        }
                        {selectedNoteIds.length > 0 && (
                          <span className="ml-2 text-gray-500 dark:text-gray-500 font-medium">
                            ({selectedNoteIds.length} selected)
                          </span>
                        )}
                      </p>
                    </div>
                    
                    {/* Bulk actions - show when notes are selected */}
                    {selectedNoteIds.length > 0 && (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleMoveNotes(selectedNoteIds)}
                          disabled={moveNotesMutation.isPending}
                          className="h-7 px-2 text-xs"
                          data-testid="button-move-selected-search"
                        >
                          <Move className="h-3 w-3 mr-1" />
                          Move ({selectedNoteIds.length})
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleCopyNotes(selectedNoteIds)}
                          disabled={copyNotesMutation.isPending}
                          className="h-7 px-2 text-xs"
                          data-testid="button-copy-selected-search"
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          Copy ({selectedNoteIds.length})
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleExportSelectedNotes('markdown')}
                          className="h-7 px-2 text-xs"
                          data-testid="button-export-selected-search"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Export ({selectedNoteIds.length})
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleDeleteNotes(selectedNoteIds)}
                          disabled={deleteNotesMutation.isPending}
                          className="h-7 px-2 text-xs text-red-600 border-red-200 hover:bg-red-50"
                          data-testid="button-delete-selected-search"
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Delete ({selectedNoteIds.length})
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col bg-card">
                  {loadingSearch ? (
                    <div className="flex items-center justify-center h-64">
                      <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-400 mx-auto mb-4"></div>
                        <p className="text-gray-600">Searching notes...</p>
                      </div>
                    </div>
                  ) : searchResults && searchResults.length > 0 ? (
                    <div className="p-4">
                      <div className="space-y-6">
                        {searchResults.map((result) => (
                          <div key={result.notebook.id} className="border rounded-lg p-4 bg-white">
                            {/* Notebook Header */}
                            <div className="flex items-center gap-3 mb-4 pb-3 border-b">
                              <NotebookPen className="h-5 w-5 text-blue-600" />
                              <h3 className="text-lg font-semibold text-card-foreground">
                                {result.notebook.title}
                              </h3>
                              <Badge variant="secondary" className="ml-auto">
                                {result.count} note{result.count === 1 ? '' : 's'}
                              </Badge>
                            </div>

                            {/* Search Results in this Notebook - Using Card structure like selected notebook */}
                            <div className="space-y-4">
                              {result.sentences.map((sentence: any) => (
                                <Card key={sentence.id} className="cursor-pointer hover:shadow-md transition-shadow">
                                  <CardContent className="p-4">
                                    <div className="relative">
                                      {/* Edit button - top right */}
                                      {editingNoteId !== sentence.id && (
                                        <Button
                                          variant="ghost"
                                          size="sm"
                                          className="absolute top-0 right-0 h-8 w-8 p-0 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                                          onClick={() => {
                                            setEditingNoteId(sentence.id);
                                            setNoteText(sentence.noteContent || "");
                                            try {
                                              const existingTags = parseTags(sentence.tags);
                                              setTagsText(Array.isArray(existingTags) ? existingTags : []);
                                            } catch (e) {
                                              setTagsText([]);
                                            }
                                          }}
                                        >
                                          <Edit2 className="h-4 w-4" />
                                        </Button>
                                      )}
                                      <div className="flex items-start gap-3">
                                        <Checkbox
                                          checked={selectedNoteIds.includes(sentence.noteId)}
                                          onCheckedChange={(checked: boolean) => {
                                            if (checked && sentence.noteId) {
                                              setSelectedNoteIds(prev => [...prev, sentence.noteId]);
                                            } else {
                                              setSelectedNoteIds(prev => prev.filter((id: number) => id !== sentence.noteId));
                                            }
                                          }}
                                          className="mt-1 rounded border-gray-300"
                                          data-testid={`checkbox-note-${sentence.noteId}`}
                                        />
                                        <div className="flex-1 space-y-2">
                                          <div className="flex items-center gap-2 mb-2">
                                            {sentence.documentTitle && (
                                              <Badge variant="outline" className="text-xs">
                                                {sentence.documentTitle}
                                              </Badge>
                                            )}
                                          </div>

                                          {/* Original text - Dark gray, Bold */}
                                          <div className="text-gray-800 dark:text-gray-200 font-bold leading-relaxed">
                                            {sentence.source}
                                          </div>

                                          {/* Translation - Regular gray, Regular - with inline editing */}
                                          {editingTranslationId === sentence.id ? (
                                            <div className="space-y-2">
                                              <Textarea
                                                value={translationEditText}
                                                onChange={(e) => setTranslationEditText(e.target.value)}
                                                placeholder={t('notebooks.enterTranslation') || 'Enter translation...'}
                                                className="min-h-[60px] resize-none text-gray-600 dark:text-gray-400"
                                              />
                                              <div className="flex justify-end gap-2">
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  onClick={() => {
                                                    setEditingTranslationId(null);
                                                    setTranslationEditText("");
                                                  }}
                                                >
                                                  {t('common.cancel')}
                                                </Button>
                                                <Button
                                                  size="sm"
                                                  onClick={() => {
                                                    updateTranslationMutation.mutate({
                                                      sentenceId: sentence.id,
                                                      targetEdited: translationEditText,
                                                      documentId: sentence.documentId
                                                    });
                                                  }}
                                                  disabled={updateTranslationMutation.isPending}
                                                >
                                                  {t('common.save')}
                                                </Button>
                                              </div>
                                            </div>
                                          ) : getDisplayTranslation(sentence) ? (
                                            <div className="text-gray-600 dark:text-gray-400 font-normal leading-relaxed flex items-start gap-2 group/translation">
                                              <span>{getDisplayTranslation(sentence)}</span>
                                              <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 w-6 p-0 opacity-0 group-hover/translation:opacity-100 transition-opacity shrink-0"
                                                onClick={() => {
                                                  setEditingTranslationId(sentence.id);
                                                  setTranslationEditText(getDisplayTranslation(sentence) || "");
                                                }}
                                              >
                                                <Edit2 className="h-3 w-3" />
                                              </Button>
                                            </div>
                                          ) : null}

                                          {/* User translation */}
                                          {sentence.userTranslation && (
                                            <div className="text-gray-800 bg-gray-50 p-3 rounded-lg dark:text-gray-200 dark:bg-gray-800">
                                              {sentence.userTranslation}
                                            </div>
                                          )}

                                          {/* Note Section with divider */}
                                          {(sentence.noteContent || editingNoteId === sentence.id) && (
                                            <div>
                                              {/* Subtle divider before note */}
                                              <div className="border-t border-gray-200 dark:border-gray-700 my-2"></div>
                                              {editingNoteId === sentence.id ? (
                                            <div className="space-y-3">
                                              <Textarea
                                                value={noteText}
                                                onChange={(e) => setNoteText(e.target.value)}
                                                placeholder={t('notebooks.addThoughts')}
                                                className="min-h-[80px] resize-none"
                                              />
                                              
                                              {/* Tags input field */}
                                              <div className="space-y-2">
                                                <div className="flex items-center gap-2">
                                                  <Tag className="h-4 w-4 text-gray-500" />
                                                  <label className="text-sm text-gray-600 dark:text-gray-400">Tags</label>
                                                </div>
                                                <div className="flex items-center gap-2 flex-wrap p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800">
                                                  {tagsText.map((tag, index) => (
                                                    <span 
                                                      key={index}
                                                      className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 px-2 py-1 rounded text-xs flex items-center gap-1 cursor-pointer"
                                                      onClick={() => handleRemoveTag(index)}
                                                      title={t('notebooks.clickToRemove')}
                                                    >
                                                      #{tag}
                                                      <span className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200">×</span>
                                                    </span>
                                                  ))}
                                                  <Input
                                                    placeholder={t('notebooks.addTag')}
                                                    className="text-sm border-none bg-transparent p-0 h-6 flex-1 min-w-[150px]"
                                                    onKeyDown={(e) => {
                                                      if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                                        e.preventDefault();
                                                        handleAddTag(e.currentTarget.value.trim());
                                                        e.currentTarget.value = '';
                                                      }
                                                    }}
                                                  />
                                                </div>
                                              </div>
                                              
                                              <div className="flex justify-end gap-2">
                                                <Button
                                                  variant="outline"
                                                  size="sm"
                                                  onClick={() => {
                                                    setEditingNoteId(null);
                                                    setNoteText("");
                                                    setTagsText([]);
                                                  }}
                                                >
                                                  {t('common.cancel')}
                                                </Button>
                                                <Button
                                                  size="sm"
                                                  onClick={() => {
                                                    if (sentence.noteId) {
                                                      updateNoteMutation.mutate({
                                                        noteId: sentence.noteId,
                                                        content: noteText,
                                                        tags: tagsText
                                                      });
                                                    }
                                                  }}
                                                  disabled={updateNoteMutation.isPending || !sentence.noteId}
                                                >
                                                  {updateNoteMutation.isPending ? t('common.saving') : t('notebooks.saveNoteAndTags')}
                                                </Button>
                                              </div>
                                            </div>
                                          ) : sentence.noteContent ? (
                                            <div className="text-brand leading-relaxed">
                                              {sentence.noteContent}
                                            </div>
                                          ) : null}
                                            </div>
                                          )}

                                          {/* Tags - Display only - moved below note section */}
                                          {(() => {
                                            try {
                                              const tags = parseTags(sentence.tags);
                                              return Array.isArray(tags) && tags.length > 0 ? (
                                                <div className="flex items-center gap-2">
                                                  <Tag className="h-3 w-3 text-muted-foreground" />
                                                  {tags.slice(0, 3).map((tag: string) => (
                                                    <span key={tag} className="bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 px-2 py-1 rounded text-xs">
                                                      #{tag}
                                                    </span>
                                                  ))}
                                                  {tags.length > 3 && (
                                                    <span className="text-gray-400 text-xs">+{tags.length - 3}</span>
                                                  )}
                                                </div>
                                              ) : null;
                                            } catch (e) {
                                              return null;
                                            }
                                          })()}
                                        </div>
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center">
                      <div className="text-center">
                        <Search className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                        <h3 className="text-lg font-medium text-card-foreground mb-2">
                          No notes found
                        </h3>
                        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                          No notes match your search query "{searchQuery}". Try different keywords or check your spelling.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>)
            ) : (
              /* Empty state when no notebook is selected - show recent notes */
              (<div className="flex flex-col">
                {/* Recent Notes Section */}
                <div className={`px-1 mt-8 ${editingNoteId !== null ? 'pb-40' : 'pb-24'}`}>
                  {loadingRecentNotes ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-pulse text-muted-foreground">{t('common.loading')}</div>
                    </div>
                  ) : (() => {
                    const filteredRecentNotes = (recentNotes || []).filter((note: any) => {
                      // Apply note type filter
                      if (noteFilter !== "all") {
                        const noteContent = note.noteContent || note.content || note.note;
                        if (noteFilter === "highlights" && noteContent !== null) return false;
                        if (noteFilter === "notes" && noteContent === null) return false;
                      }
                      // Apply tag filter (includes system "Edited" tag)
                      if (selectedTags.length > 0) {
                        const noteTags = extractTags(note);
                        const hasEditedTag = selectedTags.includes('Edited') && isTranslationEdited(note);
                        const hasUserTag = selectedTags.some(tag => tag !== 'Edited' && noteTags.includes(tag));
                        if (!hasEditedTag && !hasUserTag) return false;
                      }
                      return true;
                    });
                    
                    return filteredRecentNotes.length > 0 ? (
                      <div className="space-y-4">
                        <h1 className="text-2xl font-bold text-card-foreground">
                          {t('notebooks.recentNotes')}
                        </h1>
                        <div className="space-y-3">
                          {filteredRecentNotes.map((note: any, index: number) => {
                            const noteContent = note.noteContent || note.content || note.note;
                            const isHighlight = noteContent === null && note.noteId;
                            
                            return (
                              <Card 
                                key={note.noteId || index} 
                                ref={editingNoteId === note.noteId ? editingCardRef : null}
                                className="cursor-pointer hover:shadow-md transition-shadow shadow-sm rounded-xl border-0"
                              >
                                <CardContent className="p-4">
                                  <div className="relative">
                                    {/* Edit button - top right */}
                                    {editingNoteId !== note.noteId && (
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="absolute top-0 right-0 h-8 w-8 p-0 text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300"
                                        onClick={() => {
                                          setEditingNoteId(note.noteId);
                                          setNoteText(noteContent || "");
                                          try {
                                            const existingTags = parseTags(note.tags);
                                            setTagsText(Array.isArray(existingTags) ? existingTags : []);
                                          } catch (e) {
                                            setTagsText([]);
                                          }
                                        }}
                                      >
                                        <Edit2 className="h-4 w-4" />
                                      </Button>
                                    )}
                                    <div className="flex-1 space-y-3">
                                      {/* Top: Original text - Dark gray, Bold */}
                                      <div className="text-gray-800 dark:text-gray-200 pr-8 font-semibold text-[18px]">
                                        {note.source}
                                      </div>

                                      {/* Middle: Translation and Notes */}
                                      <div className="space-y-2">
                                        {/* Translation - Regular gray, Regular - with inline editing */}
                                        {editingTranslationId === note.id ? (
                                          <div className="space-y-2">
                                            <Textarea
                                              value={translationEditText}
                                              onChange={(e) => setTranslationEditText(e.target.value)}
                                              placeholder={t('notebooks.enterTranslation') || 'Enter translation...'}
                                              className="min-h-[60px] resize-none text-gray-600 dark:text-gray-400"
                                            />
                                            <div className="flex justify-end gap-2">
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                  setEditingTranslationId(null);
                                                  setTranslationEditText("");
                                                }}
                                              >
                                                {t('common.cancel')}
                                              </Button>
                                              <Button
                                                size="sm"
                                                onClick={() => {
                                                  updateTranslationMutation.mutate({
                                                    sentenceId: note.id,
                                                    targetEdited: translationEditText,
                                                    documentId: note.documentId
                                                  });
                                                }}
                                                disabled={updateTranslationMutation.isPending}
                                              >
                                                {t('common.save')}
                                              </Button>
                                            </div>
                                          </div>
                                        ) : getDisplayTranslation(note) ? (
                                          <div className="text-gray-600 dark:text-gray-400 font-normal leading-relaxed flex items-start gap-2 group/translation">
                                            <span>{getDisplayTranslation(note)}</span>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 w-6 p-0 opacity-0 group-hover/translation:opacity-100 transition-opacity shrink-0"
                                              onClick={() => {
                                                setEditingTranslationId(note.id);
                                                setTranslationEditText(getDisplayTranslation(note) || "");
                                              }}
                                            >
                                              <Edit2 className="h-3 w-3" />
                                            </Button>
                                          </div>
                                        ) : null}

                                        {/* Note Content - only show for notes, not highlights */}
                                        {!isHighlight && noteContent && editingNoteId !== note.noteId && (
                                          <div className="mt-4 border-l-2 border-blue-100 pl-4 text-sm text-slate-600 dark:text-blue-200 leading-relaxed">
                                            {noteContent}
                                          </div>
                                        )}

                                        {/* Note Editing */}
                                        {editingNoteId === note.noteId && (
                                          <div className="space-y-3">
                                            <Textarea
                                              value={noteText}
                                              onChange={(e) => setNoteText(e.target.value)}
                                              placeholder={t('notebooks.addThoughts')}
                                              className="min-h-[80px] resize-none"
                                            />
                                            
                                            <div className="space-y-2">
                                              <div className="flex items-center gap-2">
                                                <Tag className="h-4 w-4 text-gray-500" />
                                                <label className="text-sm text-gray-600 dark:text-gray-400">Tags</label>
                                              </div>
                                              <div className="flex items-center gap-2 flex-wrap p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800">
                                                {tagsText.map((tag, tagIndex) => (
                                                  <span 
                                                    key={tagIndex}
                                                    className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300 px-2 py-1 rounded text-xs flex items-center gap-1 cursor-pointer"
                                                    onClick={() => handleRemoveTag(tagIndex)}
                                                    title={t('notebooks.clickToRemove')}
                                                  >
                                                    #{tag}
                                                    <span className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200">×</span>
                                                  </span>
                                                ))}
                                                <Input
                                                  placeholder={t('notebooks.addTag')}
                                                  className="text-sm border-none bg-transparent p-0 h-6 flex-1 min-w-[150px]"
                                                  onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                                                      e.preventDefault();
                                                      handleAddTag(e.currentTarget.value.trim());
                                                      e.currentTarget.value = '';
                                                    }
                                                  }}
                                                />
                                              </div>
                                            </div>
                                            
                                            <div className="flex justify-end gap-2">
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => {
                                                  setEditingNoteId(null);
                                                  setNoteText("");
                                                  setTagsText([]);
                                                }}
                                              >
                                                {t('common.cancel')}
                                              </Button>
                                              <Button
                                                size="sm"
                                                onClick={() => {
                                                  if (note.noteId) {
                                                    updateNoteMutation.mutate({
                                                      noteId: note.noteId,
                                                      content: noteText,
                                                      tags: tagsText,
                                                      documentId: note.documentId
                                                    });
                                                  }
                                                }}
                                                disabled={updateNoteMutation.isPending || !note.noteId}
                                              >
                                                {updateNoteMutation.isPending ? t('common.saving') : t('notebooks.saveNoteAndTags')}
                                              </Button>
                                            </div>
                                          </div>
                                        )}

                                      </div>

                                      {/* Bottom (Metadata): Flex row for Group, Source Badge, Tags, and Date */}
                                      {editingNoteId !== note.noteId && (
                                        <div className="flex items-center justify-between mt-4 flex-wrap gap-2">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            {/* Group Info (only in Recent Notes view) */}
                                            {note.notebookGroupLabel && (
                                              <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                                                <FolderOpen className="h-3.5 w-3.5" />
                                                <span>{note.notebookGroupLabel}</span>
                                              </div>
                                            )}
                                            
                                            {/* Source Document Badge */}
                                            {note.documentTitle && (
                                              <Badge variant="outline" className="text-[10px] h-5 px-1.5 font-normal">
                                                {note.documentTitle}
                                              </Badge>
                                            )}

                                            {/* Tags */}
                                            {(() => {
                                              try {
                                                const tags = parseTags(note.tags);
                                                const hasUserTags = Array.isArray(tags) && tags.length > 0;
                                                const hasEditedTag = isTranslationEdited(note);
                                                
                                                if (!hasUserTags && !hasEditedTag) return null;
                                                
                                                return (
                                                  <div className="flex items-center gap-1.5">
                                                    {/* System tag: Edited (displayed first, filterable like user tags) */}
                                                    {hasEditedTag && (
                                                      <span 
                                                        className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                                                          selectedTags.includes('Edited')
                                                            ? "bg-brand-subtle text-brand dark:bg-brand-soft dark:text-brand"
                                                            : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                                                        }`}
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          if (selectedTags.includes('Edited')) {
                                                            setSelectedTags(selectedTags.filter(t => t !== 'Edited'));
                                                          } else {
                                                            setSelectedTags([...selectedTags, 'Edited']);
                                                          }
                                                        }}
                                                        data-testid="tag-filter-recent-Edited"
                                                      >
                                                        #Edited
                                                      </span>
                                                    )}
                                                    {/* User tags */}
                                                    {hasUserTags && tags.slice(0, 5).map((tag: string) => (
                                                      <span 
                                                        key={tag} 
                                                        className={`px-1.5 py-0.5 rounded text-[10px] cursor-pointer transition-colors ${
                                                          selectedTags.includes(tag)
                                                            ? "bg-brand-subtle text-brand dark:bg-brand-soft dark:text-brand"
                                                            : "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                                                        }`}
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          if (selectedTags.includes(tag)) {
                                                            setSelectedTags(selectedTags.filter(t => t !== tag));
                                                          } else {
                                                            setSelectedTags([...selectedTags, tag]);
                                                          }
                                                        }}
                                                        data-testid={`tag-filter-recent-${tag}`}
                                                      >
                                                        #{tag}
                                                      </span>
                                                    ))}
                                                  </div>
                                                );
                                              } catch (e) {
                                                return null;
                                              }
                                            })()}
                                          </div>

                                          {/* Date - Right End */}
                                          {note.noteCreatedAt && (
                                            <div className="text-[10px] text-gray-400 dark:text-gray-500 font-light">
                                              {formatShortDate(note.noteUpdatedAt || note.noteCreatedAt, { timezone, language })}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-1 items-center justify-center pt-8">
                        <div className="text-center">
                          <NotebookPen className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                          <h3 className="text-lg font-medium text-card-foreground mb-2">
                            {t('notebooks.selectNotebookOrSearch')}
                          </h3>
                          <p className="text-muted-foreground max-w-md mx-auto">
                            {t('notebooks.selectNotebookDesc')}
                          </p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>)
            )}
          </section>
        </div>

        {/* Move Notes Modal */}
        <NotebookSelectionModal
          isOpen={showMoveModal}
          onClose={() => {
            setShowMoveModal(false);
            setOperationNoteIds([]);
          }}
          onSelect={handleMoveConfirm}
          title={`Move ${operationNoteIds.length} note${operationNoteIds.length > 1 ? 's' : ''}`}
          description={`Choose the notebook where you want to move ${operationNoteIds.length} selected note${operationNoteIds.length > 1 ? 's' : ''}.`}
          currentNotebookId={selectedNotebook?.id}
        />

        {/* Copy Notes Modal */}
        <NotebookSelectionModal
          isOpen={showCopyModal}
          onClose={() => {
            setShowCopyModal(false);
            setOperationNoteIds([]);
          }}
          onSelect={handleCopyConfirm}
          title={`Copy ${operationNoteIds.length} note${operationNoteIds.length > 1 ? 's' : ''}`}
          description={`Choose the notebook where you want to copy ${operationNoteIds.length} selected note${operationNoteIds.length > 1 ? 's' : ''}.`}
          currentNotebookId={selectedNotebook?.id}
        />

        {/* Create Notebook Dialog */}
        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('notebooks.createNewNotebook')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="title">{t('notebooks.notebookTitle')}</Label>
                <Input
                  id="title"
                  value={newNotebook.title}
                  onChange={(e) => setNewNotebook(prev => ({ ...prev, title: e.target.value }))}
                  placeholder={t('notebooks.titlePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">{t('notebooks.description')}</Label>
                <Textarea
                  id="description"
                  value={newNotebook.description}
                  onChange={(e) => setNewNotebook(prev => ({ ...prev, description: e.target.value }))}
                  placeholder={t('notebooks.descPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="group">{t('notebooks.group')}</Label>
                <div className="flex gap-2">
                  <Select
                    value={newNotebook.groupId?.toString() || "__none__"}
                    onValueChange={(value) => {
                      if (value === "__create_new__") {
                        setShowCreateGroupDialog(true);
                      } else if (value === "__none__") {
                        setNewNotebook(prev => ({ ...prev, groupId: null }));
                      } else {
                        setNewNotebook(prev => ({ ...prev, groupId: parseInt(value) }));
                      }
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={t('notebooks.groupPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('notebooks.noGroup')}</SelectItem>
                      {availableGroups?.groups.map((group) => (
                        <SelectItem key={group.id} value={group.id.toString()}>
                          <span className="flex items-center gap-2">
                            <span>{group.icon}</span>
                            <span>{group.name}</span>
                          </span>
                        </SelectItem>
                      ))}
                      <SelectItem value="__create_new__">
                        <span className="flex items-center gap-2">
                          <Plus className="h-4 w-4" />
                          <span>{t('notebooks.createNewGroup')}</span>
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsCreateDialogOpen(false);
                    setNewNotebook({ title: "", description: "", isPublic: false, colorLabel: "white", groupLabel: null, groupId: null });
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={handleCreateNotebook}
                  disabled={!newNotebook.title.trim() || createNotebookMutation.isPending}
                >
                  {createNotebookMutation.isPending ? t('notebooks.saving') : t('notebooks.createNotebook')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit Notebook Dialog */}
        <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('notebooks.editNotebook')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-title">{t('notebooks.notebookTitle')}</Label>
                <Input
                  id="edit-title"
                  value={editNotebook.title}
                  onChange={(e) => setEditNotebook(prev => ({ ...prev, title: e.target.value }))}
                  placeholder={t('notebooks.titlePlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">{t('notebooks.description')}</Label>
                <Textarea
                  id="edit-description"
                  value={editNotebook.description}
                  onChange={(e) => setEditNotebook(prev => ({ ...prev, description: e.target.value }))}
                  placeholder={t('notebooks.descPlaceholder')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-group">{t('notebooks.group')}</Label>
                <div className="flex gap-2">
                  <Select
                    value={editNotebook.groupId?.toString() || "__none__"}
                    onValueChange={(value) => {
                      if (value === "__create_new__") {
                        setShowCreateGroupDialog(true);
                      } else if (value === "__none__") {
                        setEditNotebook(prev => ({ ...prev, groupId: null }));
                      } else {
                        setEditNotebook(prev => ({ ...prev, groupId: parseInt(value) }));
                      }
                    }}
                  >
                    <SelectTrigger className="flex-1">
                      <SelectValue placeholder={t('notebooks.groupPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('notebooks.noGroup')}</SelectItem>
                      {availableGroups?.groups.map((group) => (
                        <SelectItem key={group.id} value={group.id.toString()}>
                          <span className="flex items-center gap-2">
                            <span>{group.icon}</span>
                            <span>{group.name}</span>
                          </span>
                        </SelectItem>
                      ))}
                      <SelectItem value="__create_new__">
                        <span className="flex items-center gap-2">
                          <Plus className="h-4 w-4" />
                          <span>{t('notebooks.createNewGroup')}</span>
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditDialogOpen(false);
                    setEditNotebook({ title: "", description: "", isPublic: false, colorLabel: null, groupId: null });
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={handleUpdateNotebook}
                  disabled={!editNotebook.title.trim() || editNotebookMutation.isPending}
                >
                  {editNotebookMutation.isPending ? t('notebooks.saving') : t('notebooks.save')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Create Group Dialog */}
        <Dialog open={showCreateGroupDialog} onOpenChange={setShowCreateGroupDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('notebooks.createNewGroup')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="group-name">{t('notebooks.groupName')}</Label>
                <Input
                  id="group-name"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  placeholder={t('notebooks.enterGroupName')}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCreateGroupDialog(false);
                    setNewGroupName('');
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                >
                  {t('notebooks.create')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Edit Group Dialog */}
        <Dialog open={showEditGroupDialog} onOpenChange={setShowEditGroupDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('notebooks.editGroup')}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-group-name">{t('notebooks.groupName')}</Label>
                <Input
                  id="edit-group-name"
                  value={groupToEdit}
                  onChange={(e) => setGroupToEdit(e.target.value)}
                  placeholder={t('notebooks.enterGroupName')}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowEditGroupDialog(false);
                    setGroupToEdit('');
                    setEditingGroup(null);
                  }}
                >
                  {t('common.cancel')}
                </Button>
                <Button
                  onClick={handleEditGroup}
                  disabled={!groupToEdit.trim()}
                >
                  {t('common.save')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Unified Notebook Management Modal */}
        <Dialog open={showNotebookManagementModal} onOpenChange={setShowNotebookManagementModal}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{t('notebooks.notebookManagement')}</DialogTitle>
            </DialogHeader>
            <Tabs value={managementTab} onValueChange={(val) => setManagementTab(val as 'create' | 'groups')}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="create" data-testid="tab-create-notebook">
                  <Plus className="h-4 w-4 mr-2" />
                  {t('notebooks.createTab')}
                </TabsTrigger>
                <TabsTrigger value="groups" data-testid="tab-groups">
                  <FolderOpen className="h-4 w-4 mr-2" />
                  {t('notebooks.groupsTab')}
                </TabsTrigger>
              </TabsList>
              
              {/* Create Notebook Tab */}
              <TabsContent value="create" className="space-y-4 mt-4">
                <div className="space-y-2">
                  <Label htmlFor="mgmt-title">{t('notebooks.notebookTitle')}</Label>
                  <Input
                    id="mgmt-title"
                    data-testid="input-notebook-title"
                    value={newNotebook.title}
                    onChange={(e) => setNewNotebook(prev => ({ ...prev, title: e.target.value }))}
                    placeholder={t('notebooks.titlePlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mgmt-description">{t('notebooks.description')}</Label>
                  <Textarea
                    id="mgmt-description"
                    data-testid="input-notebook-description"
                    value={newNotebook.description}
                    onChange={(e) => setNewNotebook(prev => ({ ...prev, description: e.target.value }))}
                    placeholder={t('notebooks.descPlaceholder')}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="mgmt-group">{t('notebooks.group')}</Label>
                  <Select
                    value={newNotebook.groupId?.toString() || "__none__"}
                    onValueChange={(value) => {
                      if (value === "__create_new__") {
                        setShowCreateGroupDialog(true);
                      } else if (value === "__none__") {
                        setNewNotebook(prev => ({ ...prev, groupId: null, groupLabel: null }));
                      } else {
                        const groupId = parseInt(value);
                        const group = availableGroups?.groups.find(g => g.id === groupId);
                        setNewNotebook(prev => ({ ...prev, groupId, groupLabel: group?.name || null }));
                      }
                    }}
                  >
                    <SelectTrigger data-testid="select-notebook-group">
                      <SelectValue placeholder={t('notebooks.groupPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t('notebooks.noGroup')}</SelectItem>
                      {availableGroups?.groups.map((group) => (
                        <SelectItem key={group.id} value={group.id.toString()}>
                          <span className="flex items-center gap-2">
                            <span>{group.icon}</span>
                            <span>{group.name}</span>
                          </span>
                        </SelectItem>
                      ))}
                      <SelectItem value="__create_new__">
                        <span className="flex items-center gap-2">
                          <Plus className="h-4 w-4" />
                          <span>{t('notebooks.createNewGroup')}</span>
                        </span>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowNotebookManagementModal(false);
                      setNewNotebook({ title: "", description: "", isPublic: false, colorLabel: "white", groupLabel: null, groupId: null });
                    }}
                  >
                    {t('common.cancel')}
                  </Button>
                  <Button
                    onClick={() => {
                      handleCreateNotebook();
                      setShowNotebookManagementModal(false);
                    }}
                    disabled={!newNotebook.title.trim() || createNotebookMutation.isPending}
                    data-testid="button-create-notebook-submit"
                  >
                    {createNotebookMutation.isPending ? t('notebooks.saving') : t('notebooks.createNotebook')}
                  </Button>
                </div>
              </TabsContent>
              
              {/* Groups Tab (Group management only) */}
              <TabsContent value="groups" className="space-y-4 mt-4">
                {/* Create New Group */}
                <div className="space-y-2">
                  <Label>{t('notebooks.createNewGroup')}</Label>
                  <div className="flex gap-2">
                    <Input
                      placeholder={t('notebooks.enterGroupName')}
                      value={newGroupName}
                      onChange={(e) => setNewGroupName(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleCreateGroup()}
                      data-testid="input-new-group-name"
                    />
                    <Button
                      onClick={handleCreateGroup}
                      disabled={!newGroupName.trim()}
                      size="sm"
                      data-testid="button-create-group"
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                
                {/* Groups List */}
                <div className="space-y-2">
                  <Label>{t('notebooks.manageGroups')}</Label>
                  <div className="space-y-2 max-h-64 overflow-y-auto border rounded-lg p-2">
                    {!availableGroups?.groups?.length ? (
                      <p className="text-gray-500 text-center py-4 text-sm">{t('notebooks.noGroupsYet')}</p>
                    ) : (
                      availableGroups.groups.map((group) => (
                        <div
                          key={group.id}
                          className="flex items-center justify-between p-2 hover:bg-gray-50 dark:hover:bg-gray-800 rounded"
                        >
                          <div className="flex items-center gap-2">
                            <span>{group.icon}</span>
                            <span className="font-medium text-sm">{group.name}</span>
                            <Badge variant="outline" className="text-xs">
                              {notebooks?.filter(n => n.groupId === group.id).length || 0}
                            </Badge>
                          </div>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0"
                              onClick={() => {
                                setEditingGroup(group);
                                setGroupToEdit(group.name);
                                setShowEditGroupDialog(true);
                              }}
                              data-testid={`button-edit-group-${group.id}`}
                            >
                              <Edit className="h-3 w-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 w-7 p-0 text-red-600 hover:text-red-700"
                              onClick={() => handleDeleteGroup(group)}
                              data-testid={`button-delete-group-${group.id}`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                
                <div className="flex justify-end pt-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowNotebookManagementModal(false);
                      setNewGroupName('');
                    }}
                  >
                    {t('common.close')}
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
      </PageBody>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}
        title={getConfirmDialogProps().title}
        description={getConfirmDialogProps().description}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={handleConfirmAction}
        variant="destructive"
      />
    </PageShell>
    </Layout>
  );
}
