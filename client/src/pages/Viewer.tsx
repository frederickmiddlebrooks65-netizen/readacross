import React, {
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams, useLocation, useRoute } from "wouter";
import ImmersiveShell from "@/components/ImmersiveShell";
import SlimHeader from "@/components/SlimHeader";
import RightDrawer from "@/components/RightDrawer";
import SegmentViewer from "@/components/SegmentViewer";
// Legacy UI components removed for immersive mode
// import ViewModeSelector from "@/components/ViewModeSelector";
// import ViewerControls from "@/components/ViewerControls";
// import PracticePanel from "@/components/PracticePanel"; // Archived
import {
  ViewMode,
  DocumentWithParagraphs,
  SentenceWithUserData,
  Paragraph,
  ParagraphWithSentences,
} from "@/lib/types.d";
type Sentence = SentenceWithUserData;
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ChevronLeft, ChevronRight, Languages, PanelRight } from "lucide-react";
import { useTranslation } from "@/i18n";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import useImmersiveSettings from "@/hooks/useImmersiveSettings";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import AddNoteModal from "@/components/AddNoteModal";
import AISideDrawer from "@/components/AISideDrawer";
import useBlockPagination, { PaginatedBlock } from "@/hooks/useBlockPagination";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function Viewer() {
  const { t } = useTranslation();
  const [, params] = useRoute("/viewer/:id");
  const documentId = params?.id ? parseInt(params.id, 10) : 0;
  
  // Immersive settings integration
  const {
    settings,
    updateSetting,
    getEffectiveTheme,
    isLoading: settingsLoading
  } = useImmersiveSettings(documentId);
  
  // Extract settings for easier access
  const {
    viewMode,
    fontSize,
    lineHeight,
    useSerif,
    documentWidth,
    showRightDrawer,
    panelWidth,
  } = settings;
  
  // Debug log for initial state
  console.log('[DEBUG] Viewer initial state - showRightDrawer:', showRightDrawer);
  
  
  // UI control states
  const [showUIControls, setShowUIControls] = useState(true);
  const [headerHasOpenMenu, setHeaderHasOpenMenu] = useState(false); // 헤더 메뉴 상태 추가
  const [panelTab, setPanelTab] = useState<"document" | "notes" | "outline">("document");
  const [currentPage, setCurrentPage] = useState(1);
  const [paragraphsPerPage, setParagraphsPerPage] = useState(5);
  const hasRestoredPage = useRef(false);
  const progressSaveEnabled = useRef(false);
  const progressSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  
  // Page jump functionality
  const [showPageJump, setShowPageJump] = useState(false);
  const [inputPage, setInputPage] = useState("");
  const [displayedParagraphs, setDisplayedParagraphs] = useState<Paragraph[]>(
    [],
  );
  
  const [selectedSentence, setSelectedSentence] =
    useState<SentenceWithUserData | null>(null);
  const [isAddingToLibrary, setIsAddingToLibrary] = useState(false); // Added state for loading
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [selectedSentenceForNote, setSelectedSentenceForNote] =
    useState<SentenceWithUserData | null>(null);
  
  // AI Side-Drawer state
  const [isAIDrawerOpen, setIsAIDrawerOpen] = useState(false);
  const [aiDrawerSentence, setAIDrawerSentence] = useState<{
    id: number;
    source: string;
    target: string | null;
  } | null>(null);
  const [aiDrawerMode, setAIDrawerMode] = useState<"hover" | "edit">("hover");
  
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  const scrollRef = useRef<HTMLDivElement>(null);

  // Fetch document with paragraphs
  const { data: document, isLoading: isDocumentLoading } =
    useQuery<DocumentWithParagraphs>({
      queryKey: [`/api/documents/${documentId}`],
      enabled: !!documentId,
    });
  
  // Derive translation state from document.translationStatus (server-side state)
  // This ensures state persists across page navigation
  const isTranslating = document?.translationStatus === 'running';
  const isTranslationComplete = document?.translationStatus === 'completed';

  // Query user documents to check if this document is already in library
  const { data: userDocuments } = useQuery({
    queryKey: ["/api/documents"],
    queryFn: () => apiRequest("/api/documents"),
    enabled: isAuthenticated,
  });

  // Update sentence (for notes/scrapped)
  const updateSentenceMutation = useMutation({
    mutationFn: async ({
      id,
      changes,
    }: {
      id: number;
      changes: Partial<SentenceWithUserData>;
    }) => {
      console.log(
        "[DEBUG] Making PATCH request to /api/sentences/" + id,
        changes,
      );
      try {
        const result = await apiRequest(`/api/sentences/${id}`, {
          method: "PATCH",
          json: changes,
        });
        console.log("[DEBUG] PATCH request successful:", result);
        return result;
      } catch (error) {
        console.log("[DEBUG] PATCH request failed:", error);
        throw error;
      }
    },
    onSuccess: (response) => {
      // Invalidate and refetch document data
      queryClient.invalidateQueries({
        queryKey: [`/api/documents/${documentId}`],
      });

      // Also invalidate user sentences to update My Sentences page
      queryClient.invalidateQueries({ queryKey: ["/api/sentences/my"] });

      // Get specific message from API response or use generic one
      const message = response?.message || t('viewer.changesSaved');
      toast({
        title: t('viewer.updateComplete'),
        description: message,
        duration: 3000,
      });
    },
    onError: (error) => {
      console.error("Failed to update sentence:", error);
      console.error("Error details:", JSON.stringify(error, null, 2));
      const errorMessage =
        error instanceof Error
          ? error.message
          : t('viewer.unknownError');
      toast({
        title: t('viewer.updateFailed'),
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Handle sentence updates
  const handleUpdateSentence = useCallback(
    (id: number, changes: Partial<Sentence>) => {
      console.log("[DEBUG] handleUpdateSentence called:", { id, changes });
      updateSentenceMutation.mutate({ id, changes });
    },
    [updateSentenceMutation],
  );

  // Handle individual sentence translation
  const translateSentenceMutation = useMutation({
    mutationFn: async (sentenceId: number) => {
      return await apiRequest(`/api/sentences/${sentenceId}/translate`, {
        method: "POST",
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: [`/api/documents/${documentId}`],
      });
      toast({
        title: t('viewer.sentenceTranslated'),
        description: t('viewer.translationCompleted'),
        duration: 2000,
      });
    },
    onError: (error) => {
      toast({
        title: t('viewer.translationFailed'),
        description: `${t('viewer.failedToTranslate')}: ${error instanceof Error ? error.message : t('viewer.unknownError')}`,
        variant: "destructive",
      });
    },
  });

  // Handle document translation
  const translateDocumentMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest(`/api/documents/${documentId}/translate`, {
        method: "POST",
        json: { priority: 10 },
      });
    },
    onSuccess: () => {
      // Invalidate query to fetch updated translationStatus from server
      queryClient.invalidateQueries({
        queryKey: [`/api/documents/${documentId}`],
      });
      
      toast({
        title: t('viewer.translationStarted'),
        description: t('viewer.translationStartedInBackground'),
        duration: 3000,
      });
    },
    onError: (error) => {
      toast({
        title: t('viewer.translationFailed'),
        description: `${t('viewer.failedToTranslate')}: ${error instanceof Error ? error.message : t('viewer.unknownError')}`,
        variant: "destructive",
      });
    },
  });

  // Handle real-time translation updates via Server-Sent Events (SSE)
  useEffect(() => {
    if (document?.translationStatus !== 'running') return;
    if (!isAuthenticated) return;

    console.log('[SSE] Connecting to translation stream for document', documentId);
    
    const accessToken = localStorage.getItem('accessToken');
    if (!accessToken) return;
    
    const eventSource = new EventSource(`/api/documents/${documentId}/translation-stream?token=${encodeURIComponent(accessToken)}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log('[SSE] Received event:', data.type);

        if (data.type === 'paragraph_complete') {
          queryClient.setQueryData<DocumentWithParagraphs>(
            [`/api/documents/${documentId}`],
            (oldData) => {
              if (!oldData) return oldData;
              
              const updatedParagraphs = oldData.paragraphs.map((p: ParagraphWithSentences) => {
                if (p.id === data.paragraphId) {
                  const updatedSentences = p.sentences.map((s: Sentence) => {
                    const updated = data.sentences.find((us: { id: number; target: string }) => us.id === s.id);
                    return updated ? { ...s, target: updated.target } : s;
                  });
                  return { ...p, sentences: updatedSentences };
                }
                return p;
              });
              
              const updatedSentencesById = { ...(oldData as any).sentencesById };
              for (const translatedSentence of (data.sentences || [])) {
                if (updatedSentencesById[translatedSentence.id]) {
                  updatedSentencesById[translatedSentence.id] = {
                    ...updatedSentencesById[translatedSentence.id],
                    target: translatedSentence.target,
                  };
                } else {
                  updatedSentencesById[translatedSentence.id] = {
                    id: translatedSentence.id,
                    target: translatedSentence.target,
                    source: '',
                  };
                }
              }
              
              return {
                ...oldData,
                paragraphs: updatedParagraphs,
                sentencesById: updatedSentencesById,
                translatedCount: data.progress?.translated || (oldData as any).translatedCount,
              };
            }
          );
        } else if (data.type === 'complete') {
          // Refetch to get final state and update translationStatus
          queryClient.invalidateQueries({
            queryKey: [`/api/documents/${documentId}`],
          });
          eventSource.close();
        } else if (data.type === 'error') {
          console.error('[SSE] Translation error:', data.error);
          queryClient.invalidateQueries({
            queryKey: [`/api/documents/${documentId}`],
          });
          eventSource.close();
        }
      } catch (parseError) {
        console.error('[SSE] Failed to parse event:', parseError);
      }
    };

    eventSource.onerror = (error) => {
      console.error('[SSE] Connection error:', error);
      eventSource.close();
      // Fallback to polling on SSE failure
      const interval = setInterval(() => {
        queryClient.invalidateQueries({
          queryKey: [`/api/documents/${documentId}`],
        });
      }, 3000);
      return () => clearInterval(interval);
    };

    return () => {
      console.log('[SSE] Closing connection for document', documentId);
      eventSource.close();
    };
  }, [document?.translationStatus, documentId, queryClient, isAuthenticated]);

  // Show toast notifications when translation status changes
  const prevStatusRef = useRef<string | undefined>();
  useEffect(() => {
    if (!document) return;
    
    const prevStatus = prevStatusRef.current;
    const currentStatus = document.translationStatus;
    
    // Only show toast when status actually changes (not on initial load)
    if (prevStatus && prevStatus !== currentStatus) {
      if (currentStatus === 'completed') {
        toast({
          title: t('viewer.translationComplete'),
          description: t('viewer.allSentencesTranslated', { count: document.translatedCount || document.paragraphs?.reduce((sum: number, p: any) => sum + (p.sentences?.length || 0), 0) || 0 }),
          duration: 4000,
        });
      } else if (currentStatus === 'failed') {
        toast({
          title: t('viewer.translationFailed'),
          description: document.translationError || t('viewer.translationFailed'),
          variant: "destructive",
          duration: 5000,
        });
      }
    }
    
    prevStatusRef.current = currentStatus;
  }, [document?.translationStatus, document?.translationError, document?.totalCount, toast, t]);

  const handleTranslateSentence = useCallback(
    (sentenceId: number) => {
      if (!isAuthenticated) {
        setShowLoginDialog(true);
        return;
      }
      translateSentenceMutation.mutate(sentenceId);
    },
    [translateSentenceMutation, isAuthenticated],
  );

  const handleTranslateDocument = useCallback(() => {
    if (!isAuthenticated) {
      setShowLoginDialog(true);
      return;
    }
    // Prevent translation if already complete
    if (isTranslationComplete) {
      toast({
        title: t('viewer.translationAlreadyComplete'),
        description: t('viewer.translationAlreadyCompleteDesc'),
        duration: 3000,
      });
      return;
    }
    translateDocumentMutation.mutate();
  }, [translateDocumentMutation, isTranslationComplete, toast, t, isAuthenticated]);

  // Calculate pagination based on document paragraphs
  useEffect(() => {
    if (document?.paragraphs) {
      // Remove duplicates based on paragraph ID first
      const uniqueParagraphs = document.paragraphs.reduce((acc, paragraph) => {
        const existing = acc.find((p) => p.id === paragraph.id);
        if (!existing) {
          acc.push(paragraph);
        }
        return acc;
      }, [] as Paragraph[]);

      const startIdx = (currentPage - 1) * paragraphsPerPage;
      const endIdx = Math.min(
        startIdx + paragraphsPerPage,
        uniqueParagraphs.length,
      );

      // Set paragraphs for current page
      setDisplayedParagraphs(uniqueParagraphs.slice(startIdx, endIdx));
    }
  }, [document, currentPage, paragraphsPerPage]);

  // Helper function to safely parse structured content
  const getStructuredBlocks = useCallback((doc: any) => {
    if (!doc) return [];
    
    try {
      const structuredData = doc.structuredContent || doc.structured_content;
      
      let parsed = [];
      if (structuredData) {
        if (typeof structuredData === "string") {
          try {
            parsed = JSON.parse(structuredData);
          } catch (parseError) {
            console.warn("Failed to parse structured content string:", parseError);
            parsed = [];
          }
        } else if (Array.isArray(structuredData)) {
          parsed = structuredData;
        } else {
          console.warn("Unexpected structured content type:", typeof structuredData);
          parsed = [];
        }
      }
      
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.warn("Failed to get structured blocks:", e);
      return [];
    }
  }, []);

  // Convert document blocks to PaginatedBlock format for the pagination hook
  const paginatedBlocksData = useMemo((): PaginatedBlock[] => {
    if (!document) return [];

    const structuredBlocks = getStructuredBlocks(document);
    
    if (structuredBlocks.length > 0) {
      return structuredBlocks.map((block: any, index: number) => ({
        id: `structured-${block.order || index}`,
        type: block.type || 'paragraph',
        content: block,
        order: block.order || index,
      }));
    }

    // Fallback: convert paragraphs to blocks
    if (document.paragraphs) {
      const uniqueParagraphs = document.paragraphs.reduce((acc: Paragraph[], paragraph: Paragraph) => {
        const existing = acc.find((p) => p.id === paragraph.id);
        if (!existing) {
          acc.push(paragraph);
        }
        return acc;
      }, [] as Paragraph[]);

      return uniqueParagraphs.map((p: Paragraph, index: number) => ({
        id: p.id,
        type: 'paragraph',
        content: p,
        order: index,
      }));
    }

    return [];
  }, [document, getStructuredBlocks]);

  // Use block-based pagination hook - calculates pages ONCE at document load
  const {
    pages: paginatedPages,
    currentPageBlocks,
    currentPage: hookCurrentPage,
    totalPages,
    pageHeight,
    setCurrentPage: setHookCurrentPage,
    goToNextPage: hookGoToNextPage,
    goToPreviousPage: hookGoToPreviousPage,
    goToPage: hookGoToPage,
    isInitialized: paginationInitialized,
  } = useBlockPagination(paginatedBlocksData, {
    headerHeight: 0,
    footerHeight: 0,
    paginationControlsHeight: 96,
    blockGap: 16,
  });

  // Sync currentPage state with hook
  useEffect(() => {
    if (hookCurrentPage !== currentPage) {
      setCurrentPage(hookCurrentPage);
    }
  }, [hookCurrentPage]);

  // Initial mount focus for scroll container (run once when pagination is ready)
  useEffect(() => {
    if (paginationInitialized && scrollRef.current) {
      scrollRef.current.focus();
    }
  }, [paginationInitialized]);

  // Restore reading position from saved progress (once, after pagination is initialized)
  useEffect(() => {
    if (!paginationInitialized || hasRestoredPage.current || !document || totalPages <= 1) return;
    hasRestoredPage.current = true;
    const savedProgress = document.progress || 0;
    if (savedProgress > 0) {
      const restoredPage = Math.max(1, Math.min(Math.round((savedProgress / 100) * totalPages), totalPages));
      if (restoredPage > 1) {
        setCurrentPage(restoredPage);
        setHookCurrentPage(restoredPage);
      }
    }
    setTimeout(() => {
      progressSaveEnabled.current = true;
    }, 1500);
  }, [paginationInitialized, document, totalPages, setHookCurrentPage]);

  // Save reading progress to server (debounced)
  useEffect(() => {
    if (!isAuthenticated || !documentId || !paginationInitialized || totalPages <= 0) return;
    if (!progressSaveEnabled.current) return;

    if (progressSaveTimerRef.current) {
      clearTimeout(progressSaveTimerRef.current);
    }

    progressSaveTimerRef.current = setTimeout(() => {
      const token = localStorage.getItem('accessToken');
      if (!token) return;
      fetch(`/api/documents/${documentId}/progress`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPage, totalPages }),
      }).catch(() => {});
    }, 1000);

    return () => {
      if (progressSaveTimerRef.current) {
        clearTimeout(progressSaveTimerRef.current);
      }
    };
  }, [currentPage, totalPages, documentId, isAuthenticated, paginationInitialized]);

  // DEBUG: Window-level wheel event tracing to find where events go
  useEffect(() => {
    const handleWheelCapture = (e: WheelEvent) => {
      const target = e.target as HTMLElement;
      const scrollContainer = scrollRef.current;
      const isInsideScrollContainer = scrollContainer?.contains(target);
      console.log('[WHEEL TRACE] Window captured wheel event:', {
        targetTag: target?.tagName,
        targetClass: target?.className?.slice?.(0, 50),
        targetId: target?.id,
        isInsideScrollContainer,
        scrollContainerExists: !!scrollContainer,
        deltaY: e.deltaY,
        defaultPrevented: e.defaultPrevented,
      });
    };
    
    window.addEventListener('wheel', handleWheelCapture, { capture: true, passive: true });
    return () => window.removeEventListener('wheel', handleWheelCapture, { capture: true });
  }, []);

  // Wrap page change to sync with hook
  const handleSetCurrentPage = useCallback((page: number) => {
    setCurrentPage(page);
    setHookCurrentPage(page);
  }, [setHookCurrentPage]);

  // Keyboard shortcuts integration - using proper pagination functions with scroll
  const keyboardHandlers = {
    onTogglePanel: () => {
      console.log('[DEBUG] P key pressed, current showRightDrawer:', showRightDrawer);
      updateSetting('showRightDrawer', !showRightDrawer);
    },
    onShowHeader: () => setShowUIControls(true),
    onPrevPage: () => {
      if (currentPage > 1) {
        handleSetCurrentPage(currentPage - 1);
        scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
    onNextPage: () => {
      if (currentPage < totalPages) {
        handleSetCurrentPage(currentPage + 1);
        scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      }
    }
  };
  
  useKeyboardShortcuts(keyboardHandlers, { enabled: true });

  const goToPreviousPage = () => {
    if (currentPage > 1) {
      handleSetCurrentPage(currentPage - 1);
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => {
        setShowPagination(false);
      }, 2000);
    }
  };

  const goToNextPage = () => {
    if (currentPage < totalPages) {
      handleSetCurrentPage(currentPage + 1);
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => {
        setShowPagination(false);
      }, 2000);
    }
  };
  
  // Page jump functionality
  const handlePageJumpOpen = (open: boolean) => {
    setShowPageJump(open);
    if (open) {
      setInputPage(currentPage.toString());
    } else {
      setInputPage("");
    }
  };
  
  const handlePageJumpConfirm = () => {
    const targetPage = parseInt(inputPage, 10);
    if (targetPage >= 1 && targetPage <= totalPages) {
      handleSetCurrentPage(targetPage);
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      setTimeout(() => {
        setShowPagination(false);
      }, 2000);
    }
    setShowPageJump(false);
    setInputPage("");
  };
  
  const handlePageInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handlePageJumpConfirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setShowPageJump(false);
    }
  };

  const [noteDialogSentence, setNoteDialogSentence] = useState<Sentence | null>(
    null,
  );
  const [disableAutoOpen, setDisableAutoOpen] = useState(false);
  const [showPagination, setShowPagination] = useState(true); // 페이지네이션 항상 표시
  const [isResizing, setIsResizing] = useState(false);
  const [noteText, setNoteText] = useState("");

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;
    setIsResizing(true);

    const onMove = (e: MouseEvent) => {
      const delta = startX - e.clientX; // 왼쪽으로 드래그 = 패널 넓어짐
      const newWidth = Math.max(240, Math.min(700, startWidth + delta));
      updateSetting('panelWidth', newWidth);
    };

    const onUp = () => {
      setIsResizing(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [panelWidth, updateSetting]);

  const handleAddNote = (sentence: Sentence) => {
    setSelectedSentenceForNote(sentence);
    setShowAddNoteModal(true);
  };

  const handlePracticeSentence = (sentence: Sentence) => {
    setSelectedSentence(sentence);
  };

  const handleSaveSentence = (sentence: Sentence) => {
    handleUpdateSentence(sentence.id, { isScrapped: !sentence.isScrapped });
  };

  const [glossaryDialogSentence, setGlossaryDialogSentence] =
    useState<Sentence | null>(null);
  const [glossaryTerm, setGlossaryTerm] = useState("");
  const [glossaryDefinition, setGlossaryDefinition] = useState("");

  const handleAddToGlossary = (sentence: Sentence, selectedWord?: string) => {
    setGlossaryDialogSentence(sentence);
    setGlossaryTerm(selectedWord || "");
    setGlossaryDefinition("");
  };

  const glossaryMutation = useMutation({
    mutationFn: async (termData: any) => {
      return apiRequest("/api/glossary", { method: "POST", json: termData });
    },
    onSuccess: () => {
      toast({
        title: t('viewer.success'),
        description: t('viewer.termAdded'),
      });
      setGlossaryDialogSentence(null);
      setGlossaryTerm("");
      setGlossaryDefinition("");
    },
    onError: () => {
      toast({
        title: t('viewer.error'),
        description: t('viewer.failedToAddTerm'),
        variant: "destructive",
      });
    },
  });

  const handleSaveGlossary = () => {
    if (glossaryDialogSentence && glossaryTerm.trim()) {
      const termData = {
        term: glossaryTerm.trim(),
        definition: glossaryDefinition.trim() || undefined,
        contextSentence: glossaryDialogSentence.source,
        sourceLanguage: document?.sourceLanguage || "English",
        targetLanguage: "Korean",
        documentId: documentId,
        difficulty: "beginner",
      };
      glossaryMutation.mutate(termData);
    }
  };

  const handleCancelGlossary = () => {
    setGlossaryDialogSentence(null);
    setGlossaryTerm("");
    setGlossaryDefinition("");
  };

  const handleSaveNote = () => {
    if (noteDialogSentence) {
      handleUpdateSentence(noteDialogSentence.id, {
        note: noteText,
      });
      setNoteDialogSentence(null);
      setNoteText("");
    }
  };

  const handleCancelNote = () => {
    setNoteDialogSentence(null);
    setNoteText("");
  };

  const handleClosePractice = () => {
    setSelectedSentence(null);
  };

  const handleUpdatePracticedSentence = (changes: Partial<Sentence>) => {
    if (selectedSentence) {
      handleUpdateSentence(selectedSentence.id, changes);
      // Update the selected sentence with new data
      setSelectedSentence((prev) => (prev ? { ...prev, ...changes } : null));
    }
  };

  // Handle document download
  const handleDownload = async () => {
    try {
      const response = await fetch(`/api/documents/${documentId}/download`);

      if (!response.ok) {
        throw new Error(`Download failed: ${response.statusText}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      // Create temporary link element and trigger download
      const a = window.document.createElement("a");
      a.style.display = "none";
      a.href = url;
      a.download = `${document?.title || "document"}.txt`;

      // Safely check if document.body exists
      if (window.document.body) {
        window.document.body.appendChild(a);
        a.click();

        // Clean up
        window.URL.revokeObjectURL(url);
        window.document.body.removeChild(a);
      } else {
        console.error("document.body is not available for file download");
        window.URL.revokeObjectURL(url);
      }

      toast({
        title: "Success",
        description: "Document downloaded successfully",
      });
    } catch (error) {
      toast({
        title: "Download Failed",
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive",
      });
    }
  };

  // Handle document sharing (simplified)
  const handleShare = () => {
    const shareUrl = window.location.href;

    // Use Web Share API if available
    if (navigator.share) {
      navigator
        .share({
          title: document?.title || "Read Across Document",
          url: shareUrl,
        })
        .catch((error) => {
          console.error("Error sharing:", error);
        });
    } else {
      // Fallback to clipboard
      navigator.clipboard.writeText(shareUrl).then(() => {
        toast({
          title: "Link Copied",
          description: "Document link copied to clipboard",
        });
      });
    }
  };

  // Check if this is an explore document and if it's already in user's library
  const isExploreDocument =
    document?.sourceType === "explore" || document?.isPublic || false;
  
  const libraryDocumentId = useMemo(() => {
    if (!isExploreDocument || !userDocuments || !document) return null;
    const userDoc = userDocuments.find(
      (userDoc: any) =>
        userDoc.title === document.title && userDoc.author === document.author,
    );
    return userDoc?.id || null;
  }, [isExploreDocument, userDocuments, document]);
  
  const isAlreadyInLibrary = libraryDocumentId !== null;

  const handleAddToLibrary = async () => {
    if (!document || !isExploreDocument || isAlreadyInLibrary) return;

    // Check if user is authenticated
    if (!isAuthenticated) {
      setShowLoginDialog(true);
      return;
    }

    setIsAddingToLibrary(true);
    try {
      const result = await apiRequest<{
        success: boolean;
        document: any;
        redirectUrl: string;
        newDocumentId: number;
      }>("/api/library/save", {
        method: "POST",
        json: {
          documentId: document.id,
          title: document.title,
          author: document.author,
          sourceLanguage: document.sourceLanguage || "ko",
          
          sourceType: "explore",
          origin: {
            provider: document.source === "rss" ? "RSS" : document.sourceType,
            sourceId: document.sourceId?.toString(),
            url: document.url,
          },
        },
      });

      toast({
        title: "라이브러리에 저장되었습니다",
        description: "새 문서로 자동 이동합니다.",
      });
      
      // Invalidate all library-related queries to ensure fresh data
      await queryClient.invalidateQueries({ queryKey: ["/api/documents"] });

      // Navigate directly to the new library document
      if (result.newDocumentId) {
        console.log(
          `[REDIRECT] Moving to new library document: ${result.newDocumentId}`,
        );
        setLocation(`/viewer/${result.newDocumentId}`);
      } else {
        setLocation("/library");
      }
    } catch (error: any) {
      const errorMessage = error?.message || "";
      if (errorMessage.includes("already exists")) {
        toast({
          title: "이미 저장된 문서입니다",
          description: "Library에서 확인하세요.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "저장 실패",
          description:
            error instanceof Error
              ? error.message
              : "문서를 저장하는 중 오류가 발생했습니다.",
          variant: "destructive",
        });
      }
    } finally {
      setIsAddingToLibrary(false);
    }
  };

  // Placeholder for handleTitleChange, assuming it might be used elsewhere or for future implementation
  const handleTitleChange = (newTitle: string) => {
    console.log("Title change requested:", newTitle);
    // TODO: Implement API call to update document title
  };

  // Set the default view mode for explore documents, and auto-open side panel once document loads
  useEffect(() => {
    if (!document?.id) return;
    if (document?.sourceType === "explore" || document?.isPublic) {
      // Only set default view mode if it hasn't been explicitly changed by user
      if (viewMode === "side-by-side") {
        updateSetting('viewMode', "original-only");
      }
    }
    // Open side panel once document data is ready
    updateSetting('showRightDrawer', true);
  }, [document?.id]); // Only trigger when document ID changes (document loaded)


  return (
    <ImmersiveShell
      theme={getEffectiveTheme()}
      useSerif={useSerif}
      onShowUI={setShowUIControls}
      onShowRightDrawer={(show) => updateSetting('showRightDrawer', show)}
      rightDrawerOpen={showRightDrawer}
      disableAutoOpen={disableAutoOpen}
      headerHasOpenMenu={headerHasOpenMenu}
      isAIDrawerOpen={isAIDrawerOpen}
    >
      {/* Slim Header */}
      {document && (
        <SlimHeader
          isVisible={showUIControls}
          title={document.title}
          viewMode={viewMode}
          onViewModeChange={(mode) => {
            // Prevent view mode changes for public documents
            if (!(document?.isPublic || false)) {
              updateSetting('viewMode', mode);
            }
          }}
          fontSize={fontSize}
          onFontSizeChange={(size) => updateSetting('fontSize', size)}
          lineHeight={lineHeight}
          onLineHeightChange={(height) => updateSetting('lineHeight', height)}
          useSerif={useSerif}
          onUseSerifChange={(serif) => updateSetting('useSerif', serif)}
          theme={getEffectiveTheme()}
          onThemeChange={(theme) => updateSetting('theme', theme)}
          documentWidth={documentWidth}
          onDocumentWidthChange={(width) => updateSetting('documentWidth', width)}
          showHoverTooltip={settings.showHoverTooltip}
          onShowHoverTooltipChange={(show) => updateSetting('showHoverTooltip', show)}
          onMenuStateChange={setHeaderHasOpenMenu}
          // 액션 버튼 관련 props
          isExploreDocument={isExploreDocument}
          isTranslating={isTranslating}
          isTranslationComplete={isTranslationComplete}
          isAddingToLibrary={isAddingToLibrary}
          isAlreadyInLibrary={isAlreadyInLibrary}
          libraryDocumentId={libraryDocumentId}
          onTranslateDocument={handleTranslateDocument}
          onAddToLibrary={handleAddToLibrary}
          onToggleReaderPanel={() => updateSetting('showRightDrawer', !showRightDrawer)}
          isReaderPanelOpen={showRightDrawer}
          panelTab={panelTab}
          onPanelTabChange={setPanelTab}
        />
      )}

      {/* Main layout: content + side panel */}
      <div className="flex flex-1 min-h-0 pt-12">
        {/* Content area wrapper */}
        <div
          className={`
            flex-1 min-h-0 flex flex-col
            ${(showRightDrawer || isAIDrawerOpen) ? 'max-[900px]:hidden' : ''}
          `}
        >
          {/* Page scroll container - THIS is the actual scroll target */}
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 overflow-y-auto outline-none"
            data-scroll-container="true"
            tabIndex={0}
            onClick={() => scrollRef.current?.focus()}
            onWheel={(e) => {
              console.log('[WHEEL DEBUG] Page container received wheel event:', {
                deltaY: e.deltaY,
                target: (e.target as HTMLElement)?.tagName,
                currentTarget: (e.currentTarget as HTMLElement)?.tagName,
                scrollTop: scrollRef.current?.scrollTop,
                scrollHeight: scrollRef.current?.scrollHeight,
                clientHeight: scrollRef.current?.clientHeight,
              });
            }}
            style={{
              paddingTop: 'clamp(32px, 4vh, 72px)',
              paddingBottom: 'calc(96px + env(safe-area-inset-bottom))',
              paddingLeft: '1rem',
              paddingRight: '1rem',
            }}
          >
            {/* Content viewer */}
            {isDocumentLoading ? (
              <div className="flex justify-center items-center p-10">
                <div className="text-center">
                  <div className="spinner h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-gray-500">Loading document...</p>
                </div>
              </div>
            ) : document ? (
              <>
                {/* Content Container - no overflow hidden, let parent scroll */}
                <div 
                  className="w-full min-w-0 pb-24"
                >
                    <SegmentViewer
                      mode={viewMode}
                      paragraphs={(() => {
                        try {
                          const structuredData =
                            document.structuredContent ||
                            document.structured_content;
                          const parsed = structuredData
                            ? typeof structuredData === "string"
                              ? JSON.parse(structuredData)
                              : structuredData
                            : [];

                          // Always pass paragraph data for translation status and sentence matching
                          // The SegmentViewer will decide whether to render them based on structured blocks
                          console.log(
                            "[DEBUG] Passing paragraphs for sentence data:",
                            displayedParagraphs.length,
                            "structured blocks:",
                            parsed.length,
                          );
                          return displayedParagraphs as any[];
                        } catch (e) {
                          console.warn(
                            "Failed to parse structured content:",
                            e,
                          );
                          return displayedParagraphs as any[];
                        }
                      })()}
                      structuredBlocks={(() => {
                        // Use block-based pagination - pages are calculated ONCE at load
                        // This ensures stable page numbers regardless of font/zoom changes
                        if (paginationInitialized && currentPageBlocks.length > 0) {
                          // PaginatedBlock.content contains the full structured block
                          const blocksForViewer = currentPageBlocks.map(block => block.content);
                          
                          console.log("[PAGINATION] Block-based pagination:", {
                            currentPage,
                            totalPages,
                            pageHeight,
                            blocksOnPage: currentPageBlocks.length,
                            paginationInitialized,
                            firstBlockType: blocksForViewer[0]?.type,
                          });
                          
                          return blocksForViewer;
                        }
                        
                        // Fallback for legacy documents without structured content
                        console.log("[VIEWER] ⚠️ No paginated blocks - waiting for initialization");
                        return [];
                      })()}
                      sentencesById={
                        document.sentencesById
                          ? Object.fromEntries(
                              Object.entries(document.sentencesById).map(
                                ([id, sentence]) => [
                                  parseInt(id),
                                  {
                                    ...sentence,
                                    status: ((sentence as any).status ||
                                      "new") as
                                      | "new"
                                      | "practicing"
                                      | "completed"
                                      | "mastered",
                                    practiceCount:
                                      (sentence as any).practiceCount || 0,
                                    isScrapped:
                                      (sentence as any).isScrapped || false,
                                  },
                                ],
                              ),
                            )
                          : {}
                      }
                      onUpdateSentence={handleUpdateSentence}
                      onTranslateSentence={(sentence) =>
                        handleTranslateSentence(sentence.id)
                      }
                      onAddNote={(sentence) => handleAddNote(sentence as any)}
                      onPracticeSentence={(sentence) =>
                        handlePracticeSentence(sentence as any)
                      }
                      onSaveSentence={(sentence) =>
                        handleSaveSentence(sentence as any)
                      }
                      onAddToGlossary={(sentence) =>
                        handleAddToGlossary(sentence as any)
                      }
                      onOpenAIDrawer={(sentence, mode) => {
                        setAIDrawerSentence({
                          id: sentence.id,
                          source: sentence.source,
                          target: sentence.target,
                        });
                        setAIDrawerMode(mode);
                        setIsAIDrawerOpen(true);
                        // Note: hoveredSentence is managed inside SegmentViewer
                      }}
                      isAIDrawerOpen={isAIDrawerOpen}
                      fontSize={fontSize}
                      lineHeight={lineHeight}
                      useSerif={useSerif}
                      documentWidth={documentWidth}
                      isMobile={isMobile}
                      documentId={documentId}
                      showHoverTooltip={settings.showHoverTooltip}
                    />
                </div>
              </>
            ) : (
              <div className="flex justify-center items-center p-10">
                <div className="text-center">
                  <p className="text-gray-500">{t('viewer.documentNotFound')}</p>
                </div>
              </div>
            )}
          </div>
        </div>
        {/* Resize handle */}
        {showRightDrawer && !isAIDrawerOpen && (
          <div
            className="w-1 flex-shrink-0 cursor-col-resize hover:bg-primary/20 active:bg-primary/40 transition-colors max-[900px]:hidden"
            onMouseDown={handleResizeStart}
          />
        )}

        {/* Panel wrapper - flex child, width-animated */}
        <div
          className={`flex-shrink-0 overflow-hidden border-l border-border max-[900px]:hidden ${!isResizing ? 'transition-[width] duration-300 ease-out' : ''}`}
          style={{ width: showRightDrawer && !isAIDrawerOpen ? panelWidth : 0 }}
        >
          <div style={{ width: panelWidth }} className="h-full">
        <RightDrawer
        isOpen={showRightDrawer}
        onClose={() => {
          updateSetting('showRightDrawer', false);
          setDisableAutoOpen(true);
          setTimeout(() => setDisableAutoOpen(false), 3000);
        }}
        onRequestOpen={() => {
          updateSetting('showRightDrawer', true);
        }}
        activeTab={panelTab}
        onTabChange={setPanelTab}
        document={document || null}
        onUpdateSentence={handleUpdateSentence}
        onUpdateDocument={(changes) => {
          if (document && changes.documentNote !== undefined) {
            // Handle document note update if needed
          }
        }}
        viewMode={viewMode}
        onViewModeChange={(mode) => updateSetting('viewMode', mode)}
        fontSize={fontSize}
        onFontSizeChange={(size) => updateSetting('fontSize', size)}
        // Explore 모드 지원을 위한 prop 추가
        isExploreDocument={isExploreDocument}
        lineHeight={lineHeight}
        onLineHeightChange={(height) => updateSetting('lineHeight', height)}
        useSerif={useSerif}
        onUseSerifChange={(serif) => updateSetting('useSerif', serif)}
        paragraphsPerPage={paragraphsPerPage}
        onParagraphsPerPageChange={() => {/* paragraphsPerPage setting not implemented */}}
        documentWidth={documentWidth}
        onDocumentWidthChange={(width) => updateSetting('documentWidth', width)}
        currentPage={currentPage}
        onPageChange={handleSetCurrentPage}
        onDownload={() => {
          if (document) {
            // Create downloadable content from sentences
            const content = document.title + '\n\n' + 
              (document.paragraphs?.map(p => 
                p.sentences?.map(s => s.source || s.target || '').join(' ')
              ).join('\n\n') || '');
            const blob = new Blob([content], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = window.document.createElement('a');
            a.href = url;
            a.download = `${document.title || 'document'}.txt`;
            a.click();
            URL.revokeObjectURL(url);
          }
        }}
        onShare={async () => {
          try {
            if (document && navigator.share) {
              await navigator.share({
                title: document.title,
                text: document.title,
                url: window.location.href
              });
            } else {
              // Fallback: copy URL to clipboard
              await navigator.clipboard.writeText(window.location.href);
              toast({
                title: t('common.success'),
                description: t('viewer.urlCopied'),
              });
            }
          } catch (error: any) {
            // User cancelled share or clipboard failed
            if (error?.name !== 'AbortError') {
              // Try clipboard as fallback
              try {
                await navigator.clipboard.writeText(window.location.href);
                toast({
                  title: t('common.success'),
                  description: t('viewer.urlCopied'),
                });
              } catch {
                toast({
                  title: t('common.error'),
                  description: t('viewer.shareFailed'),
                  variant: 'destructive',
                });
              }
            }
          }
        }}
        />
          </div>
        </div>
      </div>

      {/* Fixed Viewport Pagination - Glass morphism with improved UX */}
      {document && totalPages > 1 && (
        <div 
          className={`
            fixed left-1/2 transform -translate-x-1/2 will-change-[opacity,transform]
            transition-all duration-300 ease-out z-40
            ${showPagination ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none'}
            bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-white/20 dark:border-gray-700/30
            rounded-2xl px-6 py-3 shadow-2xl shadow-black/10 h-11
          `}
          style={{
            bottom: 'calc(24px + env(safe-area-inset-bottom))',
            left: showRightDrawer && !isAIDrawerOpen
              ? `calc((100vw - ${panelWidth}px) / 2)`
              : isAIDrawerOpen
              ? 'calc(50% - 100px)'
              : '50%'
          }}
          data-testid="pagination-footer"
        >
          <div className="flex items-center gap-6 h-full">
            <Button
              variant="ghost"
              size="sm"
              onClick={goToPreviousPage}
              disabled={currentPage === 1}
              className="group flex items-center gap-2 h-8 px-3 hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all duration-200"
              aria-label={`Go to previous page (${navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'} + Left Arrow)`}
              data-testid="button-previous-page"
            >
              <ChevronLeft className="h-3 w-3" />
              {!isMobile && (
                <>
                  <span>{t('viewer.previous')}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200 ml-1">
                    {navigator.platform.includes('Mac') ? '⌘←' : 'Ctrl+←'}
                  </span>
                </>
              )}
            </Button>

            <div className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap min-w-[84px] text-center">
              <Popover open={showPageJump} onOpenChange={handlePageJumpOpen}>
                <PopoverTrigger asChild>
                  <button
                    className="hover:bg-gray-100 dark:hover:bg-gray-800 active:scale-95 rounded px-2 py-1 transition-all duration-200 cursor-pointer"
                    data-testid="button-page-jump"
                  >
                    {t('viewer.page')} {currentPage} {t('viewer.of')} {totalPages}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-32 p-3" align="center">
                  <div className="flex flex-col gap-2">
                    <div className="text-xs text-gray-500 dark:text-gray-400 text-center">
                      {t('viewer.goToPage')}
                    </div>
                    <div className="flex items-center gap-2">
                      <Input
                        type="number"
                        value={inputPage}
                        onChange={(e) => setInputPage(e.target.value)}
                        onKeyDown={handlePageInputKeyDown}
                        className="w-16 h-8 text-center"
                        min={1}
                        max={totalPages}
                        autoFocus
                        data-testid="input-page-jump"
                      />
                      <span className="text-xs text-gray-500">{t('viewer.of')} {totalPages}</span>
                    </div>
                    <Button
                      size="sm"
                      onClick={handlePageJumpConfirm}
                      className="h-7 text-xs active:scale-95 transition-transform duration-150"
                      data-testid="button-page-jump-confirm"
                    >
                      {t('viewer.go')}
                    </Button>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={goToNextPage}
              disabled={currentPage === totalPages}
              className="group flex items-center gap-2 h-8 px-3 hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all duration-200"
              aria-label={`Go to next page (${navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'} + Right Arrow)`}
              data-testid="button-next-page"
            >
              {!isMobile && (
                <>
                  <span className="text-xs text-gray-500 dark:text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity duration-200 mr-1">
                    {navigator.platform.includes('Mac') ? '⌘→' : 'Ctrl+→'}
                  </span>
                  <span>{t('viewer.next')}</span>
                </>
              )}
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        </div>
      )}

      {/* Practice Panel - Archived, to be replaced with new Practice Hub */}

      {/* Add Note Modal */}
      {selectedSentenceForNote && (
        <AddNoteModal
          isOpen={showAddNoteModal}
          onClose={() => {
            setShowAddNoteModal(false);
            setSelectedSentenceForNote(null);
          }}
          sentence={{
            id: selectedSentenceForNote.id,
            source: selectedSentenceForNote.source,
            target: selectedSentenceForNote.target,
            documentTitle: document?.title,
            paragraphId: selectedSentenceForNote.paragraphId,
            documentId: document?.id, // Add documentId for proper cache invalidation
          }}
        />
      )}

      {/* Note Dialog */}
      <Dialog
        open={!!noteDialogSentence}
        onOpenChange={() => setNoteDialogSentence(null)}
      >
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>{t('viewer.addNote')}</DialogTitle>
            <DialogDescription>{t('viewer.addNoteDesc')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                {t('viewer.originalSentence')}
              </label>
              <div className="p-3 bg-gray-50 rounded-md text-sm">
                {noteDialogSentence?.source}
              </div>
            </div>
            {noteDialogSentence?.target && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  {t('viewer.translation')}
                </label>
                <div className="p-3 bg-blue-50 rounded-md text-sm">
                  {noteDialogSentence.target}
                </div>
              </div>
            )}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                {t('viewer.yourNote')}
              </label>
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={t('viewer.enterNoteHere')}
                className="min-h-[100px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelNote}>
              {t('viewer.cancel')}
            </Button>
            <Button onClick={handleSaveNote}>{t('viewer.saveNote')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AI Side-Drawer */}
      <AISideDrawer
        isOpen={isAIDrawerOpen}
        onClose={() => setIsAIDrawerOpen(false)}
        selectedSentence={aiDrawerSentence}
        mode={aiDrawerMode}
        documentSummary={document?.summaryEn || document?.summaryKo || ""}
        userDraft={aiDrawerSentence?.target || ""}
      />

      {/* Login Dialog */}
      <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('viewer.loginRequired')}</DialogTitle>
            <DialogDescription>
              {t('viewer.loginRequiredDesc')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setShowLoginDialog(false)}
            >
              {t('viewer.cancel')}
            </Button>
            <Button
              onClick={() => {
                setShowLoginDialog(false);
                setLocation('/login');
              }}
            >
              {t('viewer.loginButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Glossary Dialog */}
      <Dialog
        open={!!glossaryDialogSentence}
        onOpenChange={() => setGlossaryDialogSentence(null)}
      >
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{t('viewer.addToGlossary')}</DialogTitle>
            <DialogDescription>
              {t('viewer.addToGlossaryDesc')}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">{t('viewer.sentence')}</label>
              <div className="p-3 bg-gray-50 rounded-md text-sm">
                {glossaryDialogSentence?.source}
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                {t('viewer.term')} *
              </label>
              <Input
                value={glossaryTerm}
                onChange={(e) => setGlossaryTerm(e.target.value)}
                placeholder={t('viewer.enterTerm')}
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">
                {t('viewer.definition')}
              </label>
              <Textarea
                value={glossaryDefinition}
                onChange={(e) => setGlossaryDefinition(e.target.value)}
                placeholder={t('viewer.enterDefinition')}
                className="w-full"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCancelGlossary}>
              {t('viewer.cancel')}
            </Button>
            <Button
              onClick={handleSaveGlossary}
              disabled={!glossaryTerm.trim() || glossaryMutation.isPending}
            >
              {glossaryMutation.isPending ? t('viewer.adding') : t('viewer.addToGlossaryButton')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ImmersiveShell>
  );
}