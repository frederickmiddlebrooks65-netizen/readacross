import React, { useState, useEffect, useMemo, useRef, useLayoutEffect, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  StickyNote,
  NotepadText,
  List,
  Search,
  FileText,
  Settings,
  Download,
  Share,
  X,
  ExternalLink,
  Copy,
  RefreshCw,
  Highlighter,
  Filter,
} from "lucide-react";
import {
  DocumentWithParagraphs,
  SentenceWithUserData,
  ViewMode,
} from "@/lib/types.d";
import type { NoteColor } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useTranslation } from "@/i18n";
import { formatShortDate } from "@/lib/dateUtils";
import { useTimezone } from "@/hooks/useTimezone";
import { useMutation } from "@tanstack/react-query";
import { determineCategory, getAllCategories, type Category } from "@/lib/colorUtils";

interface DocumentNote {
  id: number;
  sentenceId: number;
  content: string | null; // Nullable for highlight-only notes
  color: NoteColor; // Color for highlights - now properly typed
  tags: string[] | null;
  createdAt: string; // ISO timestamp string from server
  updatedAt: string; // ISO timestamp string from server
  source: string;
  target?: string;
  paragraphNumber: number;
  sentenceNumber: number;
}

type NoteFilterType = "all" | "highlights" | "notes";

interface RightDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onRequestOpen?: () => void;
  document: DocumentWithParagraphs | null;
  onUpdateSentence: (
    id: number,
    changes: Partial<SentenceWithUserData>,
  ) => void;
  onUpdateDocument?: (changes: { documentNote?: string }) => void;
  viewMode?: ViewMode;
  onViewModeChange?: (mode: ViewMode) => void;
  fontSize?: number;
  onFontSizeChange?: (size: number) => void;
  lineHeight?: number;
  onLineHeightChange?: (height: number) => void;
  useSerif?: boolean;
  onUseSerifChange?: (serif: boolean) => void;
  paragraphsPerPage?: number;
  onParagraphsPerPageChange?: (perPage: number) => void;
  documentWidth?: number;
  onDocumentWidthChange?: (width: number) => void;
  onDownload?: () => void;
  onShare?: () => void;
  // Explore 모드 지원을 위한 새로운 props
  isExploreDocument?: boolean;
  // Pagination support for outline navigation
  currentPage?: number;
  onPageChange?: (page: number) => void;
  blockPages?: Array<{ pageNumber: number; startBlockIndex: number; endBlockIndex: number; blocks: any[] }>;
  // Tab control (lifted to parent)
  activeTab?: "document" | "notes" | "outline";
  onTabChange?: (tab: "document" | "notes" | "outline") => void;
  // Scroll container ref for resetting position on page change
  scrollContainerRef?: React.RefObject<HTMLDivElement>;
}

/**
 * URL 스키마 검증 - http/https만 허용
 */
function isValidUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === "http:" || urlObj.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * RightDrawer - 몰입형 리더용 오른쪽 드로어
 *
 * 주요 기능:
 * - Doc/Outline/Notes 탭 제공
 * - 오버레이 드로어 방식
 * - 기본 숨김, P 키 또는 버튼으로 토글
 * - 동적 로딩 (첫 열림 시에만 로드)
 */
export default function RightDrawer({
  isOpen,
  onClose,
  onRequestOpen,
  document,
  onUpdateSentence,
  onUpdateDocument,
  viewMode = "side-by-side",
  onViewModeChange,
  fontSize = 16,
  onFontSizeChange,
  lineHeight = 1.6,
  onLineHeightChange,
  useSerif = false,
  onUseSerifChange,
  paragraphsPerPage = 5,
  onParagraphsPerPageChange,
  documentWidth = 1000,
  onDocumentWidthChange,
  onDownload,
  onShare,
  // Explore 모드 지원을 위한 새로운 props
  isExploreDocument = false,
  // Pagination support
  currentPage = 1,
  onPageChange,
  blockPages,
  // Tab control (lifted to parent)
  activeTab: activeTabProp = "document",
  onTabChange,
  scrollContainerRef,
}: RightDrawerProps) {
  const { t, language } = useTranslation();
  const { timezone } = useTimezone();
  const queryClient = useQueryClient();

  // Use prop-controlled tab; fall back to "document" for explore mode
  const activeTab = isExploreDocument ? "document" : activeTabProp;
  const handleTabChange = (tab: "document" | "notes" | "outline") => {
    if (!isExploreDocument) onTabChange?.(tab);
  };

  // ChatGPT의 스크롤바 겹침 해결 - ref들 추가
  const contentRef = useRef<HTMLDivElement>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [isEditingDocNote, setIsEditingDocNote] = useState(false);
  const [documentNote, setDocumentNote] = useState("");
  const [noteFilter, setNoteFilter] = useState<NoteFilterType>("all");
  
  // Navigate tab state
  const [navigateSearchTerm, setNavigateSearchTerm] = useState("");
  const navigateSearchRef = useRef<HTMLInputElement>(null);
  
  // Helper function to clear all search highlights (word highlights + sentence flashes)
  const clearAllSearchHighlights = useCallback(() => {
    // Clear word highlights
    const existingHighlights = window.document.querySelectorAll('.search-word-highlight, .search-word-highlight-fade');
    existingHighlights.forEach((el) => {
      const parent = el.parentNode;
      if (parent) {
        parent.replaceChild(window.document.createTextNode(el.textContent || ''), el);
        parent.normalize();
      }
    });
    // Clear sentence flashes
    const existingFlashes = window.document.querySelectorAll('.search-sentence-flash');
    existingFlashes.forEach((el) => {
      el.classList.remove('search-sentence-flash');
    });
  }, []);

  // Clear highlights when search term changes (any change triggers cleanup)
  useEffect(() => {
    // Always clear existing highlights when search term changes
    clearAllSearchHighlights();
  }, [navigateSearchTerm, clearAllSearchHighlights]);

  // Clear highlights when panel closes
  useEffect(() => {
    if (!isOpen) {
      clearAllSearchHighlights();
    }
  }, [isOpen, clearAllSearchHighlights]);
  
  // Focus management refs
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedElementRef = useRef<HTMLElement | null>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  // Command+F keyboard shortcut to open panel and focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Command+F (Mac) or Ctrl+F (Windows/Linux)
      if ((e.metaKey || e.ctrlKey) && e.key === 'f') {
        e.preventDefault();
        e.stopPropagation();
        
        // Switch to outline tab for search
        setActiveTab('outline');
        
        // If panel is closed, open it first
        if (!isOpen && onRequestOpen) {
          onRequestOpen();
          // Wait for panel to open and animation to complete before focusing
          requestAnimationFrame(() => {
            setTimeout(() => {
              if (navigateSearchRef.current) {
                navigateSearchRef.current.focus();
                navigateSearchRef.current.select();
              }
            }, 100);
          });
        } else {
          // Panel is already open, focus immediately
          if (navigateSearchRef.current) {
            navigateSearchRef.current.focus();
            navigateSearchRef.current.select();
          }
        }
      }
    };

    window.document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onRequestOpen]);

  // Fetch notes for the document
  const { 
    data: notes = [], 
    isLoading: notesLoading, 
    error: notesError 
  } = useQuery<DocumentNote[]>({
    queryKey: ["/api/notes/document", document?.id],
    queryFn: () => apiRequest(`/api/notes/document/${document?.id}`),
    enabled: !!document?.id && isOpen, // Only fetch when drawer is open
    staleTime: 0, // Always refetch to get fresh data
  });

  // Local state for category to enable immediate UI updates
  const [selectedCategory, setSelectedCategory] = useState<Category>(() => 
    determineCategory(document || {})
  );

  // Sync local state when document changes (e.g., navigating between documents)
  useEffect(() => {
    setSelectedCategory(determineCategory(document || {}));
  }, [document?.id, document?.category]);

  // Mutation for updating document category
  const updateCategoryMutation = useMutation({
    mutationFn: async (newCategory: Category) => {
      if (!document?.id) throw new Error("No document ID");
      return apiRequest(`/api/documents/${document.id}`, {
        method: "PATCH",
        body: JSON.stringify({ category: newCategory }),
        headers: { "Content-Type": "application/json" },
      });
    },
    onSuccess: () => {
      // Invalidate both list and specific document queries
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      if (document?.id) {
        queryClient.invalidateQueries({ queryKey: [`/api/documents/${document.id}`] });
      }
    },
  });

  // Fetch and generate AI summary
  const [summaryGenerating, setSummaryGenerating] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const { 
    data: summaryData, 
    isLoading: summaryLoading 
  } = useQuery<{ summaryEn: string; summaryKo: string; cached: boolean }>({
    queryKey: ["/api/documents", document?.id, "summary"],
    queryFn: async () => {
      if (!document?.id) throw new Error("No document ID");
      
      // Check if document already has summaries
      if (document.summaryEn && document.summaryKo) {
        return {
          summaryEn: document.summaryEn,
          summaryKo: document.summaryKo,
          cached: true,
        };
      }

      // Generate new summary
      setSummaryGenerating(true);
      setSummaryError(null);
      try {
        const result = await apiRequest(`/api/documents/${document.id}/generate-summary`, {
          method: "POST",
        });
        
        // Invalidate document queries to refetch with new summaries
        queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
        
        setSummaryGenerating(false);
        return result;
      } catch (error) {
        setSummaryGenerating(false);
        const errorMessage = error instanceof Error ? error.message : "Failed to generate summary";
        setSummaryError(errorMessage);
        throw error;
      }
    },
    enabled: !!document?.id && isOpen && activeTab === "document",
    staleTime: Infinity, // Never refetch - summaries are permanent
    retry: false, // Don't retry on error
  });

  // Filter sentences with notes/highlights for Notes tab
  const filteredSentences = useMemo(() => {
    if (!notes.length) return [];

    // First filter by type
    let filtered = notes;
    if (noteFilter === "highlights") {
      filtered = notes.filter(note => note.content === null);
    } else if (noteFilter === "notes") {
      filtered = notes.filter(note => note.content !== null);
    }
    // For "all", show everything

    // Then filter by search term
    if (searchTerm) {
      filtered = filtered.filter(
        (note) =>
          // Search in note content (if exists)
          (note.content && note.content.toLowerCase().includes(searchTerm.toLowerCase())) ||
          // Search in source text
          note.source.toLowerCase().includes(searchTerm.toLowerCase()) ||
          // Search in translation (if exists)
          (note.target && note.target.toLowerCase().includes(searchTerm.toLowerCase())),
      );
    }
    
    return filtered.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
  }, [notes, searchTerm, noteFilter]);

  // Calculate counts for different note types
  const noteCounts = useMemo(() => {
    const highlights = notes.filter(note => note.content === null).length;
    const contentNotes = notes.filter(note => note.content !== null).length;
    return {
      all: notes.length,
      highlights,
      notes: contentNotes
    };
  }, [notes]);

  // Helper function to parse structured content (same as Viewer.tsx)
  const getStructuredBlocks = (doc: any) => {
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
          parsed = [];
        }
      }
      
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  };

  // Create outline from document - prefer headings (TOC) over paragraphs
  const outline = useMemo(() => {
    if (!document) return { type: 'empty' as const, items: [] };

    try {
      const structuredBlocks = getStructuredBlocks(document);
      
      if (structuredBlocks.length > 0) {
        // First priority: Check for heading blocks (Table of Contents)
        const headingBlocks = structuredBlocks.filter(
          (block: any) => block.type === 'heading'
        );
        
        if (headingBlocks.length > 0) {
          const tocItems = headingBlocks.map((block: any, index: number) => ({
            id: block.order || index,
            title: block.content || `${t('viewer.section')} ${index + 1}`,
            level: block.level || 1,
            type: 'heading' as const,
          }));
          return { type: 'toc' as const, items: tocItems };
        }
        
        // Second priority: Paragraph blocks
        const paragraphBlocks = structuredBlocks.filter(
          (block: any) => block.type === 'paragraph'
        );
        
        if (paragraphBlocks.length > 0) {
          const paragraphItems = paragraphBlocks.map((block: any, index: number) => {
            let preview = "";
            if (typeof block.content === 'string') {
              preview = block.content.substring(0, 100) + "...";
            } else if (block.content?.source) {
              preview = block.content.source.substring(0, 100) + "...";
            }

            let sentenceCount = 1;
            if (block.anchor) {
              if (block.anchor.matchedSentenceCount) {
                sentenceCount = block.anchor.matchedSentenceCount;
              } else if (block.anchor.sentenceStartId && block.anchor.sentenceEndId) {
                sentenceCount = block.anchor.sentenceEndId - block.anchor.sentenceStartId + 1;
              }
            }

            return {
              id: block.order ?? index,
              index: index + 1,
              preview,
              sentenceCount,
              type: 'paragraph' as const,
            };
          });
          return { type: 'paragraphs' as const, items: paragraphItems };
        }
      }
    } catch (e) {
      console.warn("Failed to parse structured content:", e);
    }

    // Fallback: use document.paragraphs for legacy documents
    if (document.paragraphs && document.paragraphs.length > 0) {
      const paragraphItems = document.paragraphs
        .map((paragraph, index) => {
          const sentences = paragraph.sentences || [];
          const firstSentence = sentences[0];
          const preview = firstSentence
            ? (firstSentence.source || "").substring(0, 100) + "..."
            : "";

          return {
            id: paragraph.id,
            index: index + 1,
            preview,
            sentenceCount: sentences.length,
            type: 'paragraph' as const,
          };
        })
        .filter((section) => section.sentenceCount > 0);

      if (paragraphItems.length > 0) {
        return { type: 'paragraphs' as const, items: paragraphItems };
      }
    }

    return { type: 'empty' as const, items: [] };
  }, [document, t]);

  // Global document search - searches all text in paragraphs and structured content
  interface SearchResult {
    sentenceId: number;
    paragraphIndex: number;
    sentenceIndex: number;
    text: string;
    matchStart: number;
    matchEnd: number;
    snippet: string;
    isTranslation: boolean; // true if match is in target/translation text
  }

  const searchResults = useMemo((): SearchResult[] => {
    if (!navigateSearchTerm || navigateSearchTerm.length < 2 || !document) return [];
    
    const results: SearchResult[] = [];
    const searchLower = navigateSearchTerm.toLowerCase();
    
    // Search through paragraphs and their sentences
    if (document.paragraphs) {
      document.paragraphs.forEach((paragraph, pIndex) => {
        const sentences = paragraph.sentences || [];
        sentences.forEach((sentence: any, sIndex: number) => {
          const sourceText = sentence.source || '';
          const targetText = sentence.target || '';
          
          // Search in source text
          const sourceIndex = sourceText.toLowerCase().indexOf(searchLower);
          if (sourceIndex !== -1) {
            const snippetStart = Math.max(0, sourceIndex - 30);
            const snippetEnd = Math.min(sourceText.length, sourceIndex + navigateSearchTerm.length + 50);
            const snippet = (snippetStart > 0 ? '...' : '') + 
              sourceText.slice(snippetStart, snippetEnd) + 
              (snippetEnd < sourceText.length ? '...' : '');
            
            results.push({
              sentenceId: sentence.id,
              paragraphIndex: pIndex + 1,
              sentenceIndex: sIndex + 1,
              text: sourceText,
              matchStart: sourceIndex,
              matchEnd: sourceIndex + navigateSearchTerm.length,
              snippet,
              isTranslation: false,
            });
          }
          
          // Also search in target text if not already found in source
          if (sourceIndex === -1 && targetText) {
            const targetIndex = targetText.toLowerCase().indexOf(searchLower);
            if (targetIndex !== -1) {
              const snippetStart = Math.max(0, targetIndex - 30);
              const snippetEnd = Math.min(targetText.length, targetIndex + navigateSearchTerm.length + 50);
              const snippet = (snippetStart > 0 ? '...' : '') + 
                targetText.slice(snippetStart, snippetEnd) + 
                (snippetEnd < targetText.length ? '...' : '');
              
              results.push({
                sentenceId: sentence.id,
                paragraphIndex: pIndex + 1,
                sentenceIndex: sIndex + 1,
                text: targetText,
                matchStart: targetIndex,
                matchEnd: targetIndex + navigateSearchTerm.length,
                snippet,
                isTranslation: true,
              });
            }
          }
        });
      });
    }
    
    return results;
  }, [document, navigateSearchTerm]);

  // Scroll to search result with Modern Zen word-level highlight
  // Find the correct page number for a given sentence by searching blockPages directly
  const findPageForSentence = (sentenceId: number): number | null => {
    if (!blockPages || blockPages.length === 0) return null;

    // Primary: exact anchor range match
    for (const page of blockPages) {
      for (const paginatedBlock of page.blocks) {
        const block = paginatedBlock.content;
        if (
          block?.anchor &&
          block.anchor.sentenceStartId <= sentenceId &&
          sentenceId <= block.anchor.sentenceEndId
        ) {
          return page.pageNumber;
        }
      }
    }

    // Fallback: "nearest block below" — find the anchored block whose
    // sentenceStartId is closest to (but ≤) sentenceId. This handles gaps
    // between anchor ranges and blocks that failed to anchor.
    let bestPage: number | null = null;
    let bestStart = -1;
    for (const page of blockPages) {
      for (const paginatedBlock of page.blocks) {
        const block = paginatedBlock.content;
        if (block?.anchor && block.anchor.sentenceStartId <= sentenceId) {
          if (block.anchor.sentenceStartId > bestStart) {
            bestStart = block.anchor.sentenceStartId;
            bestPage = page.pageNumber;
          }
        }
      }
    }
    return bestPage;
  };

  // Find the correct page number for a block by its order, searching blockPages directly
  const findPageForBlock = (blockOrder: number | string): number | null => {
    if (!blockPages || blockPages.length === 0) return null;
    for (const page of blockPages) {
      for (const paginatedBlock of page.blocks) {
        const order = paginatedBlock.content?.order ?? paginatedBlock.order;
        if (
          order === blockOrder ||
          String(order) === String(blockOrder) ||
          // Legacy fallback: paginatedBlock.id equals paragraph DB id
          String(paginatedBlock.id) === String(blockOrder)
        ) {
          return page.pageNumber;
        }
      }
    }
    return null;
  };

  const scrollToSearchResult = (sentenceId: number, isTranslation: boolean = false) => {
    const doScroll = () => {
      // Use specific element IDs to target source or translation correctly
      // Try ALL patterns used across SegmentViewer.tsx rendering paths:
      //   - renderSentences (heading/document_title): sentence-${id}-${lane}
      //   - paragraph case (single-col): structured-sentence-${id}-${lane}
      //   - legacy side-by-side source: source-sentence-${id}
      //   - legacy side-by-side target: target-legacy-sentence-${id}
      const elementIdPatterns = isTranslation
        ? [
            `target-legacy-sentence-${sentenceId}`,
            `target-sentence-${sentenceId}`,
            `structured-sentence-${sentenceId}-translation`,
            `sentence-${sentenceId}-translation`,
          ]
        : [
            `source-sentence-${sentenceId}`,
            `structured-sentence-${sentenceId}-original`,
            `structured-sentence-${sentenceId}-source`,
            `sentence-${sentenceId}-original`,
          ];
      
      let element: Element | null = null;
      for (const id of elementIdPatterns) {
        element = window.document.getElementById(id);
        if (element) break;
      }
      
      // Fallback to data-sentence-id selector if specific ID not found
      if (!element) {
        element = window.document.querySelector(
          `[data-sentence-id="${sentenceId}"]`,
        );
      }
      
      if (element) {
        // Clear previous highlights first (ensures only one result is highlighted)
        clearAllSearchHighlights();
        
        // Apply temporary sentence flash (landing cue)
        element.classList.add('search-sentence-flash');
        setTimeout(() => {
          element?.classList.remove('search-sentence-flash');
        }, 1500);
        
        // Find and wrap the search term with highlight span
        if (navigateSearchTerm) {
          const searchLower = navigateSearchTerm.toLowerCase();
          const walker = window.document.createTreeWalker(
            element,
            NodeFilter.SHOW_TEXT,
            null
          );
          
          let node: Text | null;
          const nodesToProcess: { node: Text; index: number }[] = [];
          
          while ((node = walker.nextNode() as Text | null)) {
            const text = node.textContent || '';
            const index = text.toLowerCase().indexOf(searchLower);
            if (index !== -1) {
              nodesToProcess.push({ node, index });
            }
          }
          
          // Process found nodes (wrap matched text with highlight span)
          nodesToProcess.forEach(({ node, index }) => {
            const text = node.textContent || '';
            const matchLength = navigateSearchTerm.length;
            
            // Split: before + match + after
            const before = text.slice(0, index);
            const match = text.slice(index, index + matchLength);
            const after = text.slice(index + matchLength);
            
            const parent = node.parentNode;
            if (parent) {
              const fragment = window.document.createDocumentFragment();
              
              if (before) {
                fragment.appendChild(window.document.createTextNode(before));
              }
              
              const highlightSpan = window.document.createElement('span');
              highlightSpan.className = 'search-word-highlight';
              highlightSpan.textContent = match;
              fragment.appendChild(highlightSpan);
              
              if (after) {
                fragment.appendChild(window.document.createTextNode(after));
              }
              
              parent.replaceChild(fragment, node);
              
              // Scroll to center the highlighted word
              setTimeout(() => {
                highlightSpan.scrollIntoView({ behavior: "smooth", block: "center" });
              }, 50);
            }
          });
        }
        
        // Fallback scroll if no word highlight was created
        if (!navigateSearchTerm) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    };

    // Handle pagination: find the correct page using block-based page structure
    const targetPage = findPageForSentence(sentenceId);
    if (targetPage !== null && targetPage !== currentPage && onPageChange) {
      onPageChange(targetPage);
      scrollContainerRef?.current?.scrollTo({ top: 0, behavior: 'auto' });
      setTimeout(doScroll, 500);
      return;
    }

    doScroll();
  };

  const scrollToSentence = (sentenceId: number) => {
    const doScroll = () => {
      const element = window.document.querySelector(`[data-sentence-id="${sentenceId}"]`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };
    const targetPage = findPageForSentence(sentenceId);
    if (targetPage !== null && targetPage !== currentPage && onPageChange) {
      onPageChange(targetPage);
      scrollContainerRef?.current?.scrollTo({ top: 0, behavior: 'auto' });
      setTimeout(doScroll, 500);
    } else {
      doScroll();
    }
  };

  const scrollToParagraph = (paragraphOrder: number | string, paragraphIndex: number) => {
    const doScroll = () => {
      const element = window.document.querySelector(`[data-paragraph-id="${paragraphOrder}"]`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

    // Use block-based page structure to find the correct page
    const targetPage = findPageForBlock(paragraphOrder);
    if (targetPage !== null && targetPage !== currentPage && onPageChange) {
      onPageChange(targetPage);
      scrollContainerRef?.current?.scrollTo({ top: 0, behavior: 'auto' });
      setTimeout(doScroll, 500);
    } else {
      doScroll();
    }
  };

  const scrollToHeading = (headingIndexAmongHeadings: number) => {
    // Use blockPages to find which page has the n-th heading block
    if (blockPages && blockPages.length > 0) {
      let headingCount = 0;
      for (const page of blockPages) {
        for (const paginatedBlock of page.blocks) {
          if (paginatedBlock.type === 'heading') {
            if (headingCount === headingIndexAmongHeadings) {
              const blockOrder = paginatedBlock.content?.order ?? paginatedBlock.order;
              const doScroll = () => {
                const el = window.document.querySelector(`[data-paragraph-id="${blockOrder}"]`);
                if (el) {
                  el.scrollIntoView({ behavior: "smooth", block: "start" });
                }
              };
              if (page.pageNumber !== currentPage && onPageChange) {
                onPageChange(page.pageNumber);
                scrollContainerRef?.current?.scrollTo({ top: 0, behavior: 'auto' });
                setTimeout(doScroll, 500);
              } else {
                doScroll();
              }
              return;
            }
            headingCount++;
          }
        }
      }
    }
    // Fallback: search DOM directly (for non-paginated documents)
    const headings = window.document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    const headingArray = Array.from(headings);
    if (headingArray[headingIndexAmongHeadings]) {
      headingArray[headingIndexAmongHeadings].scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Cmd+F / Ctrl+F shortcut to focus Navigate search bar
  useEffect(() => {
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      // Check for Cmd+F (Mac) or Ctrl+F (Windows/Linux)
      if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
        event.preventDefault();
        // Switch to Navigate tab and focus search
        setActiveTab('outline');
        setTimeout(() => {
          navigateSearchRef.current?.focus();
        }, 100);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // ESC 키로 드로어 닫기 및 Focus trap (접근성)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      // Focus trap for Tab and Shift+Tab
      if (event.key === 'Tab' && drawerRef.current) {
        const focusableElements = drawerRef.current.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
        );
        
        const focusableArray = Array.from(focusableElements) as HTMLElement[];
        
        // Guard: if no focusable elements, prevent default and do nothing
        if (focusableArray.length === 0) {
          event.preventDefault();
          return;
        }
        
        const firstElement = focusableArray[0];
        const lastElement = focusableArray[focusableArray.length - 1];
        const currentElement = (typeof window !== 'undefined' && window.document?.activeElement) 
          ? window.document.activeElement as HTMLElement 
          : null;

        // Check if the current active element is within the drawer
        const isActiveElementInDrawer = currentElement && drawerRef.current.contains(currentElement);

        if (!isActiveElementInDrawer) {
          // If focus is outside drawer, move it to first element
          event.preventDefault();
          firstElement.focus();
          return;
        }

        if (event.shiftKey) {
          // Shift+Tab: if focused on first element, focus last
          if (currentElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
          }
        } else {
          // Tab: if focused on last element, focus first
          if (currentElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Focus management (접근성)
  useEffect(() => {
    if (isOpen) {
      // Store previously focused element
      previouslyFocusedElementRef.current = (typeof window !== 'undefined' && window.document?.activeElement) 
        ? window.document.activeElement as HTMLElement 
        : null;
      
      // Move focus to close button when drawer opens
      setTimeout(() => {
        closeButtonRef.current?.focus();
      }, 150); // Wait for transition to start
    } else {
      // Restore focus when drawer closes
      if (previouslyFocusedElementRef.current) {
        previouslyFocusedElementRef.current.focus();
      }
    }
  }, [isOpen]);

  // Lock body scroll when drawer is open to prevent overlay scrollbar issues
  useEffect(() => {
    if (!isOpen) return;
    
    // 안전 검사: 브라우저 환경이 아니거나 DOM이 준비되지 않은 경우 무시
    if (typeof window === 'undefined' || !window.document?.documentElement) {
      return;
    }
    
    const root = window.document.documentElement;
    const prevOverflow = root.style.overflow;

    root.style.overflow = "hidden";

    return () => {
      root.style.overflow = prevOverflow;
    };
  }, [isOpen]);

  // 동적 패딩 제거 - 고정 패딩(pr-6)만 유지하여 재계산 흔들림 방지
  // useLayoutEffect(() => {
  //   function syncGutter() {
  //     const el = contentRef.current;
  //     const header = tabsListRef.current;
  //     if (!el || !header) return;
  //     const sw = el.offsetWidth - el.clientWidth; // 실제 스크롤바 폭
  //     header.style.paddingRight = `${16 + sw}px`; // gap + 여유분
  //   }
  //   syncGutter();
  //   const ro = new ResizeObserver(syncGutter);
  //   if (contentRef.current) ro.observe(contentRef.current);
  //   window.addEventListener("resize", syncGutter);
  //   return () => {
  //     ro.disconnect();
  //     window.removeEventListener("resize", syncGutter);
  //   };
  // }, []);

  return (
    <div
      ref={drawerRef}
      className="bg-background h-full w-full flex flex-col min-w-0"
      role="dialog"
      data-testid="right-drawer"
    >
        <div className="h-full flex flex-col min-w-0">
          {/* Content */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0">
            <Tabs
              value={activeTab}
              onValueChange={(tab) => handleTabChange(tab as "document" | "notes" | "outline")}
              className="h-full flex flex-col min-w-0 min-h-0"
            >
              {/* Tab Content */}
              <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto [scrollbar-gutter:stable_both-edges]">
                {/* Doc Tab */}
                <TabsContent
                  value="document"
                  className="mt-4 w-full max-w-full min-w-0 overflow-x-hidden"
                >
                  <div className="px-4 pb-4 min-w-0">
                  <div className="space-y-4">
                    {/* AI Document Summary */}
                    <div>
                      <h3 className="font-medium mb-2 text-foreground">{t('viewer.aiSummary')}</h3>
                      <div className="p-3 bg-muted rounded-md text-sm text-foreground leading-relaxed">
                        {!document ? (
                          <span className="text-muted-foreground italic">{t('viewer.noDocumentSelected')}</span>
                        ) : summaryError ? (
                          <span className="text-destructive text-xs">
                            {language === 'ko'
                              ? '요약을 생성할 수 없습니다. 잠시 후 다시 시도해 주세요.'
                              : 'Unable to generate summary. Please try again later.'}
                          </span>
                        ) : summaryLoading || summaryGenerating ? (
                          <div className="space-y-2">
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-3/4" />
                          </div>
                        ) : summaryData ? (
                          language === 'ko' ? summaryData.summaryKo : summaryData.summaryEn
                        ) : (
                          <span className="text-muted-foreground italic">{t('viewer.generatingSummary')}</span>
                        )}
                      </div>
                    </div>

                    <Separator />

                    {/* Document Info */}
                    <div className="space-y-4">
                      <h4 className="font-semibold text-sm text-foreground/60 mb-2">
                        {t('viewer.documentInfo')}
                      </h4>

                      {/* Title */}
                      <div className="space-y-1">
                        <div className="text-xs font-medium text-foreground/60">
                          {t('viewer.title')}
                        </div>
                        <div className="text-sm font-medium leading-tight text-foreground">
                          {document?.title}
                        </div>
                      </div>

                      {/* Original Link */}
                      {(() => {
                        const url = document?.originalUrl || document?.url;
                        const isValid = isValidUrl(url);
                        return (url && (<div className="space-y-1">
                          <div className="text-xs font-medium text-foreground/60">
                            {t('viewer.originalLink')}
                          </div>
                          <div className="flex items-center gap-2 min-w-0 max-w-full">
                            {isValid ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-foreground hover:underline min-w-0 max-w-full flex-1 break-words [overflow-wrap:anywhere] truncate"
                                data-testid="link-original-source"
                              >
                                <span className="truncate">
                                  {url.replace(/^https?:\/\//, "")}
                                </span>
                                <ExternalLink className="h-3 w-3 flex-shrink-0" />
                              </a>
                            ) : (
                              <span className="text-xs text-muted-foreground min-w-0 flex-1 truncate">
                                {url} {t('viewer.invalidUrl')}
                              </span>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 w-6 p-0 hover:bg-muted"
                              onClick={() => {
                                if (isValid && navigator.clipboard) {
                                  navigator.clipboard.writeText(url);
                                }
                              }}
                              disabled={!isValid}
                              data-testid="button-copy-url"
                            >
                              <Copy className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>));
                      })()}

                      {/* Info Grid */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-2 min-w-0">
                        {/* Category - Editable dropdown */}
                        <div className="space-y-1">
                          <div className="text-xs font-medium" style={{ color: '#6B7280' }}>
                            {t('viewer.category')}
                          </div>
                          {isExploreDocument ? (
                            <div className="text-sm" style={{ color: '#1F2933' }}>
                              {selectedCategory}
                            </div>
                          ) : (
                            <Select
                              value={selectedCategory}
                              onValueChange={(value: string) => {
                                const newCategory = value as Category;
                                // Update local state immediately for responsive UI
                                setSelectedCategory(newCategory);
                                // Persist to database
                                updateCategoryMutation.mutate(newCategory);
                              }}
                              disabled={updateCategoryMutation.isPending}
                            >
                              <SelectTrigger 
                                className="h-7 text-sm border-0 bg-transparent p-0 hover:bg-muted/50 focus:ring-0 focus:ring-offset-0"
                                style={{ color: '#1F2933' }}
                                data-testid="select-category"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {getAllCategories().map((cat) => (
                                  <SelectItem key={cat} value={cat} data-testid={`category-option-${cat.toLowerCase()}`}>
                                    {cat}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                        </div>

                        {/* Created Date */}
                        {document?.createdAt && (
                          <div className="space-y-1">
                            <div className="text-xs font-medium" style={{ color: '#6B7280' }}>
                              {t('viewer.created')}
                            </div>
                            <div className="text-sm" style={{ color: '#1F2933' }}>
                              {formatShortDate(document.createdAt, { timezone, language })}
                            </div>
                          </div>
                        )}
                      </div>

                    </div>

                    <Separator />

                    {/* Actions - Explore 모드에서는 Download/Share 버튼 숨김 */}
                    {!isExploreDocument && (
                      <div className="flex justify-center gap-3 pt-2">
                        {onDownload && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={onDownload}
                            className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
                            data-testid="button-download"
                          >
                            <Download className="h-4 w-4" />
                            {t('viewer.download')}
                          </Button>
                        )}
                        {onShare && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={onShare}
                            className="flex items-center gap-2 px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
                            data-testid="button-share"
                          >
                            <Share className="h-4 w-4" />
                            {t('viewer.share')}
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* Notes Tab */}
              <TabsContent
                value="notes"
                className="mt-4 w-full max-w-full min-w-0 overflow-x-hidden"
              >
                <div className="px-4 pb-4 min-w-0">
                  {/* Document Notes - moved from Doc tab */}
                  <div className="shrink-0 mb-4">
                    <h3 className="font-medium mb-2 text-foreground">{t('viewer.myNotes')}</h3>
                    {isEditingDocNote ? (
                      <div className="space-y-2">
                        <Textarea
                          placeholder={t('viewer.writeThoughts')}
                          value={documentNote}
                          onChange={(e) => setDocumentNote(e.target.value)}
                          className="min-h-[100px] resize-none"
                          data-testid="textarea-document-note"
                          autoFocus
                          onBlur={() => {
                            // Save and close editing mode when clicking outside
                            if (documentNote.trim()) {
                              onUpdateDocument?.({ documentNote });
                            }
                            setIsEditingDocNote(false);
                          }}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => {
                              onUpdateDocument?.({ documentNote });
                              setIsEditingDocNote(false);
                            }}
                            data-testid="button-save-note"
                          >
                            {t('viewer.save')}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setIsEditingDocNote(false)}
                          >
                            {t('viewer.cancel')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div
                        className={`
                          p-3 rounded-md cursor-text min-h-[60px] border border-dashed border-border
                          hover:border-border/80 transition-colors
                          ${documentNote ? "bg-muted border-solid" : "bg-muted/50"}
                        `}
                        onClick={() => setIsEditingDocNote(true)}
                        data-testid="document-note-display"
                      >
                        {documentNote ? (
                          <div className="text-sm text-foreground whitespace-pre-wrap">
                            {documentNote}
                          </div>
                        ) : (
                          <div className="text-sm text-muted-foreground italic">
                            {t('viewer.clickToAddThoughts')}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <Separator className="shrink-0 mb-4" />

                  {/* Filter Controls */}
                  <div className="shrink-0 space-y-3 mb-4">
                    <h4 className="text-sm font-medium text-muted-foreground mb-3">{t('viewer.filterNotes')}</h4>
                    
                    {/* Filter Buttons */}
                    <div className="flex gap-2 w-full">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setNoteFilter("all")}
                        className={`flex-1 flex items-center justify-center gap-1 h-7 text-xs px-3 border ${
                          noteFilter === "all" 
                            ? "bg-muted text-[hsl(var(--brand-text))] border-[hsl(var(--brand-outline))]" 
                            : "bg-background text-foreground border-border hover:bg-muted"
                        }`}
                        data-testid="filter-all"
                      >
                        <span>{t('viewer.all')}</span>
                        <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0.5 h-auto">
                          {noteCounts.all}
                        </Badge>
                      </Button>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setNoteFilter("highlights")}
                        className={`flex-1 flex items-center justify-center gap-1 h-7 text-xs px-3 border ${
                          noteFilter === "highlights" 
                            ? "bg-muted text-[hsl(var(--brand-text))] border-[hsl(var(--brand-outline))]" 
                            : "bg-background text-foreground border-border hover:bg-muted"
                        }`}
                        data-testid="filter-highlights"
                      >
                        <Highlighter className="h-3 w-3" />
                        <span>{t('viewer.highlights')}</span>
                        <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0.5 h-auto">
                          {noteCounts.highlights}
                        </Badge>
                      </Button>
                      
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setNoteFilter("notes")}
                        className={`flex-1 flex items-center justify-center gap-1 h-7 text-xs px-3 border ${
                          noteFilter === "notes" 
                            ? "bg-muted text-[hsl(var(--brand-text))] border-[hsl(var(--brand-outline))]" 
                            : "bg-background text-foreground border-border hover:bg-muted"
                        }`}
                        data-testid="filter-notes"
                      >
                        <NotepadText className="h-3 w-3" />
                        <span>{t('viewer.notes')}</span>
                        <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0.5 h-auto">
                          {noteCounts.notes}
                        </Badge>
                      </Button>
                    </div>
                  </div>

                  {/* Search */}
                  <div className="shrink-0 flex items-center gap-2 mb-4">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder={t('viewer.searchNotes')}
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-9"
                        data-testid="input-search-notes"
                      />
                    </div>
                  </div>

                  {/* Notes List */}
                  <div className="pb-4">
                    <div className="space-y-3">
                      {notesLoading ? (
                        // Loading skeleton for notes
                        (<div className="space-y-3">
                          {[1, 2, 3].map((i) => (
                            <Card key={i} className="animate-pulse">
                              <CardContent className="p-4 space-y-3">
                                {/* Note location skeleton */}
                                <div className="flex items-center justify-between">
                                  <Skeleton className="h-5 w-16" />
                                  <Skeleton className="h-4 w-20" />
                                </div>
                                {/* Original sentence skeleton */}
                                <div className="space-y-2">
                                  <Skeleton className="h-3 w-16" />
                                  <Skeleton className="h-4 w-full" />
                                  <Skeleton className="h-4 w-3/4" />
                                </div>
                                {/* Note content skeleton */}
                                <div className="space-y-2">
                                  <Skeleton className="h-3 w-12" />
                                  <Skeleton className="h-4 w-5/6" />
                                </div>
                              </CardContent>
                            </Card>
                          ))}
                        </div>)
                      ) : notesError ? (
                        // Error state
                        (<div className="text-center py-8 text-destructive">
                          <StickyNote className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm font-medium">{t('common.error')}</p>
                          <p className="text-xs opacity-70 mt-1 mb-3">{t('viewer.loadingNotes')}</p>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              queryClient.invalidateQueries({ 
                                queryKey: ["/api/notes/document", document?.id] 
                              });
                            }}
                            className="text-xs flex items-center gap-2"
                            data-testid="button-retry-notes"
                          >
                            <RefreshCw className="h-3 w-3" />
                            {t('common.tryAgain')}
                          </Button>
                        </div>)
                      ) : filteredSentences.length === 0 ? (
                        // Empty state - different messages based on filter
                        (<div className="text-center py-8 text-muted-foreground">
                          <StickyNote className="h-8 w-8 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">{t('viewer.noNotesYet')}</p>
                          <p className="text-xs opacity-70 mt-1">{t('viewer.startHighlighting')}</p>
                        </div>)
                      ) : (
                        filteredSentences.map((note) => {
                          const isHighlight = note.content === null;
                          const highlightColor = note.color || 'yellow';
                          
                          return (
                            <Card
                              key={note.id}
                              className="cursor-pointer hover:bg-accent/50 transition-colors"
                              onClick={() => scrollToSentence(note.sentenceId)}
                              data-testid={`card-${isHighlight ? 'highlight' : 'note'}-${note.id}`}
                            >
                              <CardContent className="p-4">
                                <div className="space-y-3">
                                  {/* Location and date */}
                                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                                    <span className="bg-muted text-foreground px-2 py-1 rounded">
                                      P{note.paragraphNumber || '?'}
                                    </span>
                                    <span>
                                      {formatShortDate(note.createdAt, { timezone, language })}
                                    </span>
                                  </div>

                                  {/* Original text - Dark gray, Bold */}
                                  <div className="text-sm text-foreground leading-relaxed line-clamp-2 font-semibold">
                                    {note.source}
                                  </div>

                                  {/* Translation - Regular gray, Regular */}
                                  {note.target && (
                                    <div className="text-xs text-muted-foreground font-normal leading-relaxed line-clamp-2">
                                      {note.target}
                                    </div>
                                  )}

                                  {/* Divider and Note Content - only show for notes, not highlights */}
                                  {!isHighlight && note.content && (
                                    <>
                                      {/* Subtle divider before note */}
                                      <div className="border-t border-border my-2"></div>
                                      <div className="text-xs text-brand leading-relaxed line-clamp-2">
                                        {note.content}
                                      </div>
                                    </>
                                  )}
                                </div>
                              </CardContent>
                            </Card>
                          );
                        })
                      )}
                    </div>
                  </div>
                </div>
              </TabsContent>

              {/* Navigate Tab (formerly Outline) */}
              <TabsContent
                value="outline"
                className="mt-0 w-full max-w-full min-w-0 overflow-x-hidden"
              >
                <div className="px-4 pb-4 min-w-0">
                  {/* Permanent Search Bar */}
                  <div className="sticky top-0 bg-background pb-3 pt-4 z-10">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        ref={navigateSearchRef}
                        placeholder={t('viewer.searchDocument')}
                        value={navigateSearchTerm}
                        onChange={(e) => setNavigateSearchTerm(e.target.value)}
                        className="pl-9 pr-8"
                        data-testid="input-navigate-search"
                      />
                      {navigateSearchTerm && (
                        <button
                          onClick={() => setNavigateSearchTerm('')}
                          className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                    {navigateSearchTerm && searchResults.length > 0 && (
                      <div className="text-xs text-muted-foreground mt-2">
                        {t('viewer.matchesFound').replace('{count}', String(searchResults.length))}
                      </div>
                    )}
                  </div>

                  {/* Content: Search Results or Smart Index */}
                  <div className="space-y-2">
                    {navigateSearchTerm ? (
                      /* Search Results Mode */
                      (searchResults.length === 0 ? (<div className="text-center py-8 text-muted-foreground">
                        <Search className="h-8 w-8 mx-auto mb-2 opacity-50" />
                        <p className="text-sm">{t('viewer.noSearchResults')}</p>
                        <p className="text-xs opacity-70 mt-1">{t('viewer.tryDifferentSearchTerm')}</p>
                      </div>) : (<div className="space-y-2">
                        <div className="text-xs text-muted-foreground mb-3 flex items-center gap-2">
                          <Search className="h-3 w-3" />
                          {t('viewer.searchResults')}
                        </div>
                        {searchResults.map((result, index) => (
                          <Card
                            key={`${result.sentenceId}-${index}`}
                            className="cursor-pointer hover:bg-accent/50 transition-colors"
                            onClick={() => scrollToSearchResult(result.sentenceId, result.isTranslation)}
                            data-testid={`search-result-${index}`}
                          >
                            <CardContent className="p-3">
                              <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 px-2 py-1 rounded bg-muted text-xs font-medium text-foreground">
                                  P{result.paragraphIndex}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-foreground line-clamp-3 leading-relaxed">
                                    {result.snippet.split(new RegExp(`(${navigateSearchTerm})`, 'gi')).map((part, i) => 
                                      part.toLowerCase() === navigateSearchTerm.toLowerCase() ? (
                                        <mark key={i} className="bg-[hsla(154,20%,75%,0.7)] dark:bg-[hsla(154,25%,40%,0.6)] px-0.5 rounded">{part}</mark>
                                      ) : (
                                        <span key={i}>{part}</span>
                                      )
                                    )}
                                  </p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))}
                      </div>))
                    ) : (
                      /* Smart Index Mode (Empty Search State) */
                      (<>
                        {outline.type === 'empty' || outline.items.length === 0 ? (
                          /* Fallback: Page-based grouping for unstructured documents */
                          (document?.paragraphs && document.paragraphs.length > 0 ? (<div className="space-y-2">
                            <div className="text-xs text-muted-foreground mb-3 flex items-center gap-2">
                              <List className="h-3 w-3" />
                              {t('viewer.smartIndex')}
                            </div>
                            {/* Group paragraphs into page chunks (5 per group) */}
                            {Array.from({ length: Math.ceil(document.paragraphs.length / 5) }, (_, groupIndex) => {
                              const startPara = groupIndex * 5;
                              const endPara = Math.min((groupIndex + 1) * 5, document.paragraphs.length);
                              const firstParagraph = document.paragraphs[startPara];
                              const firstSentence = firstParagraph?.sentences?.[0];
                              const preview = firstSentence?.source?.substring(0, 80) + '...' || '';
                              
                              return (
                                <Card
                                  key={groupIndex}
                                  className="cursor-pointer hover:bg-accent/50 transition-colors"
                                  onClick={() => scrollToParagraph(firstParagraph?.id || startPara, startPara + 1)}
                                  data-testid={`page-group-${groupIndex}`}
                                >
                                  <CardContent className="p-3">
                                    <div className="flex items-start gap-3">
                                      <div className="flex-shrink-0 px-2 py-1 rounded bg-muted text-xs font-medium text-foreground">
                                        {t('viewer.paragraph')} {startPara + 1}-{endPara}
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm text-muted-foreground line-clamp-2">
                                          {preview}
                                        </p>
                                      </div>
                                    </div>
                                  </CardContent>
                                </Card>
                              );
                            })}
                          </div>) : (<div className="text-center py-8 text-muted-foreground">
                            <List className="h-8 w-8 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">{t('viewer.noOutlineAvailable')}</p>
                          </div>))
                        ) : outline.type === 'toc' ? (
                          /* Table of Contents - heading based (Native Metadata) */
                          (<div className="space-y-1">
                            <div className="text-xs text-muted-foreground mb-3 flex items-center gap-2">
                              <List className="h-3 w-3" />
                              {t('viewer.tableOfContents')}
                            </div>
                            {outline.items.map((item: any, index: number) => (
                              <div
                                key={item.id}
                                className="cursor-pointer hover:bg-accent/50 transition-colors rounded-md px-3 py-2"
                                style={{ paddingLeft: `${(item.level - 1) * 16 + 12}px` }}
                                onClick={() => scrollToHeading(index)}
                                data-testid={`toc-item-${item.id}`}
                              >
                                <span className={`text-sm ${item.level === 1 ? 'font-semibold' : item.level === 2 ? 'font-medium' : 'font-normal text-muted-foreground'}`}>
                                  {item.title}
                                </span>
                              </div>
                            ))}
                          </div>)
                        ) : (
                          /* Paragraph-based Smart Index */
                          (<div className="space-y-2">
                            <div className="text-xs text-muted-foreground mb-3 flex items-center gap-2">
                              <List className="h-3 w-3" />
                              {t('viewer.smartIndex')}
                            </div>
                            {outline.items.map((section: any) => (
                              <Card
                                key={section.id}
                                className="cursor-pointer hover:bg-accent/50 transition-colors"
                                onClick={() => scrollToParagraph(section.id, section.index)}
                                data-testid={`card-outline-${section.id}`}
                              >
                                <CardContent className="p-3">
                                  <div className="flex items-start gap-3">
                                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-muted flex items-center justify-center">
                                      <span className="text-xs font-medium text-foreground">
                                        {section.index}
                                      </span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm text-muted-foreground line-clamp-2">
                                        {section.preview}
                                      </p>
                                    </div>
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                          </div>)
                        )}
                      </>)
                    )}
                  </div>
                </div>
              </TabsContent>
              </div>
            </Tabs>
          </div>
        </div>
      </div>
  );
}