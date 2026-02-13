// Let me implement a simple working version with just CSS-based hover menus that work properly

import { useState, useEffect, useRef, useMemo } from "react";

// Type for tracking which lane (original/translation) a sentence interaction is from
type SentenceLane = 'original' | 'translation';
type PinnedState = { id: number; lane: SentenceLane } | null;
type HoveredState = { id: number; lane: SentenceLane } | null;
import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { StickyNote, Check, X, MessageSquare, Image as ImageIcon, Table, NotepadTextIcon, ChevronLeft, ChevronRight, Edit3, Highlighter, Sparkles, Loader2, ArrowRight, Crown, Bot } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import GlossaryTooltip from "./GlossaryTooltip";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";

export interface Sentence {
  id: number;
  source: string;
  target: string | null;
  targetAi: string | null;
  targetEdited: string | null;
  status: 'new' | 'practicing' | 'completed' | 'mastered';
  practiceCount: number;
  isScrapped: boolean;
  // Legacy note field removed - notes now handled via notes table
}

export interface StructuredBlock {
  type: "document_title" | "heading" | "paragraph" | "image" | "table" | "figure" | "caption" | "abstract" | "abstract_body" | "doi" | "journal" | "author" | "affiliation" | "abstract_label" | "reference_block";
  order: number;
  page?: number;
  caption?: string;
  captionFor?: string; // Track what this caption is for (figure/table)
  origin?: { page: number; bbox: [number, number, number, number] };
  src?: string; // For images
  html?: string; // For tables
  imageSnapshot?: boolean;
  level?: number; // For headings
  content?: string; // For text blocks
  preserveLineBreaks?: boolean; // Phase 2-3a: For reference_block
  anchor?: { sentenceStartId: number; sentenceEndId: number }; // Anchor metadata
  sentences?: Array<{ 
    id: string | number; 
    text: string; 
    order: number; 
    type?: "sentence" | "utterance";  // Phase 2-4: sentence = TM eligible, utterance = TM excluded
    target?: string | null; 
    targetAi?: string | null; 
    targetEdited?: string | null 
  }>; // Phase 2-2: Translatable semantic units, Phase 2-4: with type field
}

export interface ParagraphWithSentences {
  id: number;
  title?: string;
  sentences: Sentence[];
}

// Union type for merged content items
export type MergedContentItem =
  | {
      type: 'document_title' | 'heading' | 'image' | 'table' | 'figure' | 'paragraph' | 'caption' | 'abstract' | 'abstract_body' | 'doi' | 'journal' | 'author' | 'affiliation' | 'abstract_label' | 'reference_block';
      id: string;
      order: number;
      block: StructuredBlock;
    }
  | {
      type: 'paragraph';
      id: number;
      order: number;
      paragraph: ParagraphWithSentences;
    };

interface SegmentViewerProps {
  mode: "original-only" | "translation-only" | "side-by-side";
  paragraphs: ParagraphWithSentences[];
  structuredBlocks?: StructuredBlock[]; // Optional structured content blocks
  sentencesById?: Record<number, Sentence>; // Direct sentence lookup for anchor matching
  onUpdateSentence?: (sentenceId: number, updates: Partial<Sentence>) => void;
  onTranslateSentence?: (sentence: Sentence) => void;
  onAddNote?: (sentence: Sentence) => void;
  onPracticeSentence?: (sentence: Sentence) => void;
  onSaveSentence?: (sentence: Sentence) => void;
  onAddToGlossary?: (sentence: Sentence) => void;
  onOpenAIDrawer?: (sentence: Sentence, mode: "hover" | "edit") => void;
  isAIDrawerOpen?: boolean;
  fontSize?: number;
  lineHeight?: number;
  useSerif?: boolean;
  documentWidth?: number;
  isPublicDocument?: boolean;
  isMobile?: boolean;
  documentId?: number; // For notebook assignment
  showHoverTooltip?: boolean; // Show translation/original tooltip on hover
}

// Helper function to get note content for a sentence from sentencesById
function getSentenceNote(sentenceId: number, sentencesById?: Record<number, any>): string | undefined {
  return sentencesById?.[sentenceId]?.noteContent;
}

// Helper function to check if a sentence has a highlight (any note creates a visual highlight)
function getSentenceHighlight(sentenceId: number, sentencesById?: Record<number, any>): { hasHighlight: boolean; color?: string; noteId?: number } {
  const sentence = sentencesById?.[sentenceId];
  if (sentence?.noteId) {
    return { hasHighlight: true, color: sentence.noteColor || 'yellow', noteId: sentence.noteId };
  }
  return { hasHighlight: false };
}

// Helper function to check if sentence has any note (highlight or content)
function hasSentenceNote(sentenceId: number, sentencesById?: Record<number, any>): boolean {
  const sentence = sentencesById?.[sentenceId];
  return !!(sentence?.noteId);
}

// Helper function to get the display translation (prioritize targetEdited over target)
function getDisplayTranslation(sentence: Sentence | any): string | null {
  return sentence.targetEdited ?? sentence.target ?? null;
}

// Helper function to check if translation has been edited (for UI indicators)
function isTranslationEdited(sentence: Sentence | any): boolean {
  if (!sentence.targetAi || !sentence.targetEdited) return false;
  return sentence.targetAi !== sentence.targetEdited;
}

// Helper function to get the appropriate sentence content based on viewing mode
function getSentenceContentByMode(sentence: Sentence, mode: "original-only" | "translation-only" | "side-by-side"): string {
  switch (mode) {
    case "translation-only":
      return getDisplayTranslation(sentence) ?? sentence.source; // Translation with fallback to source
    case "original-only":
      return sentence.source; // Always source
    case "side-by-side":
      return sentence.source; // Side-by-side is handled elsewhere, show source here
    default:
      return sentence.source;
  }
}

// Group sentences by paragraphs for better document flow and remove duplicates
function groupSentencesByParagraphs(paragraphs: ParagraphWithSentences[]): ParagraphWithSentences[] {
  if (!paragraphs || paragraphs.length === 0) {
    return [];
  }

  // Remove duplicate paragraphs by ID first using Map for better performance
  const uniqueParagraphsMap = new Map<number, ParagraphWithSentences>();

  paragraphs.forEach(paragraph => {
    if (paragraph && paragraph.id && !uniqueParagraphsMap.has(paragraph.id)) {
      uniqueParagraphsMap.set(paragraph.id, paragraph);
    }
  });

  return Array.from(uniqueParagraphsMap.values()).map(paragraph => ({
    ...paragraph,
    sentences: paragraph.sentences || []
  }));
}

// Create merged content that includes both text paragraphs and structured blocks
function createMergedContent(paragraphs: ParagraphWithSentences[], structuredBlocks: StructuredBlock[]): MergedContentItem[] {
  // If we have structured blocks, use them as the primary source
  if (structuredBlocks && structuredBlocks.length > 0) {
    console.log('[createMergedContent] Using structured blocks as primary content:', structuredBlocks.length);
    console.log('[createMergedContent] Block types found:', structuredBlocks.map(b => b.type));
    console.log('[createMergedContent] First few blocks:', structuredBlocks.slice(0, 3));
    console.log('[createMergedContent] Returning ONLY structured blocks, NO paragraphs');

    // Convert structured blocks to content blocks, keeping original order
    const structuredContentBlocks = structuredBlocks.map(block => ({
      type: block.type as 'document_title' | 'heading' | 'paragraph' | 'image' | 'table' | 'figure' | 'caption' | 'abstract' | 'abstract_body' | 'doi' | 'journal' | 'author' | 'affiliation' | 'abstract_label',
      id: `structured-${block.order}`,
      order: block.order,
      block
    }));

    return structuredContentBlocks;
  }

  // Fallback to paragraph-based content for documents without structured blocks
  console.log('[createMergedContent] Using paragraph-based content:', paragraphs.length);
  console.log('[createMergedContent] NO structured blocks found, using legacy paragraphs');

  // Remove duplicates by ID first
  const seenIds = new Set();
  const uniqueParagraphs = paragraphs.filter(paragraph => {
    if (seenIds.has(paragraph.id)) {
      console.log('🚫 Removing duplicate paragraph ID:', paragraph.id);
      return false;
    }
    seenIds.add(paragraph.id);
    return true;
  });

  // Convert paragraphs to content blocks
  const paragraphBlocks = uniqueParagraphs.map((paragraph, index) => ({
    type: 'paragraph' as const,
    id: paragraph.id,
    order: index,
    paragraph
  }));

  return paragraphBlocks;
}

// Enhanced table HTML processing for better responsive styling
function enhanceTableHtml(html: string): string {
  // Add comprehensive responsive table classes and improved styling
  let enhancedHtml = html
    // Enhanced table classes with responsive behavior and improved dark mode
    .replace(/<table\b/gi, '<table class="min-w-full divide-y divide-border table-auto bg-card rounded-lg overflow-hidden"')
    // Enhanced header styling with better contrast and sticky behavior
    .replace(/<thead\b/gi, '<thead class="bg-muted sticky top-0 z-10"')
    .replace(/<th\b/gi, '<th scope="col" class="px-3 sm:px-6 py-3 text-left text-xs font-semibold text-foreground/70 uppercase tracking-wider border-b border-border backdrop-blur-sm"')
    // Enhanced body styling with improved zebra stripes and dark mode
    .replace(/<tbody\b/gi, '<tbody class="bg-card divide-y divide-border"')
    .replace(/<tr\b/gi, '<tr class="hover:bg-muted/50 transition-all duration-200 even:bg-muted/30 group"')
    // Enhanced cell styling with better responsive padding and dark mode
    .replace(/<td\b/gi, '<td class="px-3 sm:px-6 py-3 sm:py-4 text-sm text-foreground break-words min-w-0 group-hover:text-foreground/80 transition-colors"');

  return enhancedHtml;
}

// Table export functionality
function exportTableData(html: string, format: 'csv' | 'json', caption?: string) {
  try {
    // Parse HTML table to extract data
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const table = doc.querySelector('table');

    if (!table) {
      console.error('No table found in HTML');
      return;
    }

    const rows = Array.from(table.querySelectorAll('tr'));
    const data: string[][] = [];

    rows.forEach(row => {
      const cells = Array.from(row.querySelectorAll('th, td'));
      const rowData = cells.map(cell => cell.textContent?.trim() || '');
      if (rowData.length > 0) {
        data.push(rowData);
      }
    });

    if (data.length === 0) {
      console.error('No data found in table');
      return;
    }

    let content: string;
    let mimeType: string;
    let extension: string;

    if (format === 'csv') {
      // Convert to CSV
      content = data.map(row =>
        row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      mimeType = 'text/csv';
      extension = 'csv';
    } else {
      // Convert to JSON
      const [headers, ...bodyRows] = data;
      const jsonData = bodyRows.map(row => {
        const obj: Record<string, string> = {};
        headers.forEach((header, index) => {
          obj[header || `Column ${index + 1}`] = row[index] || '';
        });
        return obj;
      });
      content = JSON.stringify(jsonData, null, 2);
      mimeType = 'application/json';
      extension = 'json';
    }

    // Download file
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `table-${caption ? caption.replace(/[^a-zA-Z0-9]/g, '-') : 'export'}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error('Table export failed:', error);
  }
}

// Component for rendering structured blocks
function StructuredBlockRenderer({
  block,
  paragraphId,
  sentencesById,
  paragraphs,
  onUpdateSentence,
  onAddNote,
  handleSentenceClick,
  handleSentenceDoubleClick,
  mode,
  editingSentenceId,
  hoveredSentence,
  setHoveredSentence,
  pinnedSentence,
  setPinnedSentence,
  queryClient,
  toast,
  documentId,
  textareaRef,
  editedValue,
  setEditedValue,
  handleKeyDown,
  handleSaveEdit,
  handleCancelEdit,
  showCorrespondingTooltip = false,
  handleAICoaching,
  aiCoachingMutation,
  showUpgradePrompt,
  setLocation,
  showAiCoaching,
  aiCoachingResult,
  handleApplyCoachingTranslation,
  setShowAiCoaching,
  editPopupPosition,
  onOpenAIDrawer
}: {
  block: StructuredBlock;
  paragraphId?: number | string;
  sentencesById?: Record<number, Sentence>;
  paragraphs?: ParagraphWithSentences[];
  onUpdateSentence?: (sentenceId: number, updates: Partial<Sentence>) => void;
  onAddNote?: (sentence: Sentence) => void;
  handleSentenceClick?: (sentence: Sentence, event?: React.MouseEvent, lane?: SentenceLane) => void;
  handleSentenceDoubleClick?: (sentence: Sentence) => void;
  mode: "original-only" | "translation-only" | "side-by-side";
  editingSentenceId?: number | null;
  hoveredSentence?: HoveredState;
  setHoveredSentence?: (state: HoveredState) => void;
  pinnedSentence?: PinnedState;
  setPinnedSentence?: (state: PinnedState) => void;
  queryClient: any;
  toast: any;
  documentId?: number;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
  editedValue?: string;
  setEditedValue?: (value: string) => void;
  handleKeyDown?: (e: React.KeyboardEvent) => void;
  handleSaveEdit?: () => void;
  handleCancelEdit?: () => void;
  showCorrespondingTooltip?: boolean;
  handleAICoaching?: (sentenceId: number) => void;
  aiCoachingMutation?: any;
  showUpgradePrompt?: boolean;
  setLocation?: (path: string) => void;
  showAiCoaching?: boolean;
  aiCoachingResult?: { polishedTranslation: string; grammarInsight: string; nuanceTips: string; cached?: boolean } | null;
  handleApplyCoachingTranslation?: () => void;
  setShowAiCoaching?: (show: boolean) => void;
  editPopupPosition?: { alignment: 'left' | 'right'; maxWidth: string };
  onOpenAIDrawer?: (sentence: Sentence, mode: "hover" | "edit") => void;
}) {
  const { t } = useTranslation();
  // Determine the current lane based on mode
  const currentLane: SentenceLane = mode === "translation-only" ? 'translation' : 'original';
  console.log('[StructuredBlockRenderer] Rendering block:', block.type, 'content:', block.content?.substring(0, 100) + '...');

  // STRUCTURAL FIX: Single rendering path for all translatable text
  // Helper to collect sentences from anchor (shared by heading, abstract, paragraph)
  const collectSentencesFromAnchor = (): Sentence[] => {
    const sentences: Sentence[] = [];
    if (!block.anchor) return sentences;
    
    if (sentencesById && Object.keys(sentencesById).length > 0) {
      for (let id = block.anchor.sentenceStartId; id <= block.anchor.sentenceEndId; id++) {
        if (sentencesById[id]) {
          sentences.push(sentencesById[id]);
        }
      }
    } else {
      const allParagraphSentences = paragraphs?.flatMap((p: ParagraphWithSentences) => p.sentences || []) || [];
      for (let id = block.anchor.sentenceStartId; id <= block.anchor.sentenceEndId; id++) {
        const sentence = allParagraphSentences.find((s: Sentence) => s.id === id);
        if (sentence) {
          sentences.push(sentence);
        }
      }
    }
    return sentences;
  };

  // STRUCTURAL FIX: Unified sentence renderer for all translatable blocks
  // Visual hierarchy is controlled by wrapperClassName, NOT by separate rendering logic
  const renderSentences = (sentences: Sentence[], wrapperClassName: string, wrapperTag: 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' = 'p') => {
    const WrapperTag = wrapperTag;
    
    if (sentences.length === 0) {
      // Fallback: No sentences found, render block.content as static text
      // This should NOT happen for properly anchored blocks
      console.warn(`[StructuredBlockRenderer] No sentences for block type=${block.type}, falling back to content`);
      return <WrapperTag className={wrapperClassName}>{block.content}</WrapperTag>;
    }

    return (
      <WrapperTag className={wrapperClassName} data-paragraph-id={paragraphId}>
        {sentences.map((sentence: Sentence, index: number) => {
          const textToDisplay = mode === "translation-only"
            ? (getDisplayTranslation(sentence) || sentence.source)
            : sentence.source;
          const normalizedText = textToDisplay
            .replace(/[\r\n\u000B\u000C\u0085\u2028\u2029]+/g, ' ')
            .replace(/[ \t]+/g, ' ')
            .trim();

          return (
            <span key={`sentence-${sentence.id}`} className="sentence-segment relative inline whitespace-normal">
              {editingSentenceId === sentence.id && mode !== "original-only" ? (
                <>
                  <span className="invisible inline">{normalizedText}</span>
                  <span 
                    className="absolute top-0 z-50"
                    style={{
                      [editPopupPosition?.alignment || 'right']: '0',
                      width: '350px',
                      maxWidth: editPopupPosition?.maxWidth || '350px',
                    }}
                  >
                    <span className="relative shadow-lg rounded-md bg-card border border-border block">
                      <Textarea
                        ref={textareaRef}
                        value={editedValue}
                        onChange={(e) => setEditedValue?.(e.target.value)}
                        onKeyDown={handleKeyDown}
                        className="w-full p-2 pb-12 resize-none border-0 shadow-none bg-transparent font-sans text-base min-h-[80px] focus-visible:ring-0 focus-visible:ring-offset-0"
                        placeholder={t('viewer.enterTranslation')}
                      />
                      <span className="absolute bottom-2 left-2 right-2 flex justify-between items-center">
                        <button
                          aria-label="AI 도우미"
                          className="p-1.5 hover:bg-[hsl(var(--sage-subtle))] dark:hover:bg-slate-800/50 rounded text-xs flex items-center justify-center w-8 h-8 transition-all"
                          onClick={() => onOpenAIDrawer?.({ id: sentence.id, source: sentence.source, target: editedValue || null } as any, "edit")}
                          title="AI 도우미"
                        >
                          <Bot className="h-4 w-4 text-forest dark:text-slate-400" />
                        </button>
                        <span className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={handleSaveEdit} className="h-7 w-7" title={t('viewer.save')}>
                            <Check className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" onClick={handleCancelEdit} className="h-7 w-7" title={t('common.cancel')}>
                            <X className="h-4 w-4" />
                          </Button>
                        </span>
                      </span>
                    </span>
                  </span>
                </>
              ) : (
                <TooltipProvider delayDuration={200}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span
                        tabIndex={0}
                        role="button"
                        className={cn(
                          "inline align-baseline cursor-pointer rounded px-0.5 -mx-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                          "selection:bg-muted/50",
                          mode === "translation-only" && !getDisplayTranslation(sentence) && "text-muted-foreground/50 italic",
                          getSentenceHighlight(sentence.id, sentencesById).hasHighlight && "bg-yellow-200/60 hover:bg-yellow-300/60",
                          !getSentenceHighlight(sentence.id, sentencesById).hasHighlight && "hover:bg-muted/80",
                          getSentenceNote(sentence.id, sentencesById) && "border-b border-solid border-blue-500",
                          editingSentenceId === sentence.id && "bg-muted/70",
                          pinnedSentence?.id === sentence.id && "font-semibold"
                        )}
                        onClick={(e) => handleSentenceClick?.(sentence, e, currentLane)}
                        onMouseEnter={() => setHoveredSentence?.({ id: sentence.id, lane: currentLane })}
                        onMouseLeave={() => setHoveredSentence?.(null)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            handleSentenceClick?.(sentence, undefined, currentLane);
                          }
                        }}
                        onDoubleClick={() => handleSentenceDoubleClick?.(sentence)}
                        data-sentence-id={sentence.id}
                        id={`sentence-${sentence.id}-${currentLane}`}
                      >
                        {normalizedText}
                      </span>
                    </TooltipTrigger>
                    {showCorrespondingTooltip && (
                      <TooltipContent side="bottom" className="max-w-md p-3 text-sm leading-relaxed">
                        <div className="space-y-1">
                          <div className="text-xs font-medium text-muted-foreground mb-1">
                            {mode === "original-only" ? t('viewer.translation') : t('viewer.original')}
                          </div>
                          <div className="text-foreground">
                            {mode === "original-only" 
                              ? (getDisplayTranslation(sentence) || t('viewer.noTranslationYet'))
                              : sentence.source
                            }
                          </div>
                        </div>
                      </TooltipContent>
                    )}
                  </Tooltip>
                </TooltipProvider>
              )}

              {/* Hover menu for sentence interactivity */}
              <span
                role="toolbar"
                className={cn(
                  "hover-menu absolute top-full mt-1 right-0 flex gap-1 bg-background border rounded-lg shadow-lg p-2 z-50 min-w-max transition-all duration-300 ease-in-out",
                  pinnedSentence?.id === sentence.id && pinnedSentence?.lane === currentLane
                    ? "opacity-100 pointer-events-auto"
                    : "opacity-0 pointer-events-none"
                )}
              >
                <button
                  className={cn(
                    "p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded text-xs flex items-center justify-center w-8 h-8 transition-colors",
                    getSentenceNote(sentence.id, sentencesById) && "bg-blue-50 dark:bg-blue-900/30"
                  )}
                  onClick={(e) => { e.stopPropagation(); onAddNote?.(sentence); }}
                  title={getSentenceNote(sentence.id, sentencesById) ? "노트 편집" : "노트 추가"}
                >
                  <NotepadTextIcon className={cn("h-4 w-4 transition-colors", getSentenceNote(sentence.id, sentencesById) ? "text-slate-600 dark:text-blue-300" : "text-gray-500")} />
                </button>
                <button
                  className={cn(
                    "p-1.5 hover:bg-yellow-50 dark:hover:bg-yellow-900/30 rounded text-xs flex items-center justify-center w-8 h-8 transition-colors",
                    getSentenceHighlight(sentence.id, sentencesById).hasHighlight && "bg-yellow-100 dark:bg-yellow-900/30"
                  )}
                  onClick={async (e) => {
                    e.stopPropagation();
                    const currentHighlight = getSentenceHighlight(sentence.id, sentencesById);
                    const noteContent = getSentenceNote(sentence.id, sentencesById);
                    if (noteContent && noteContent.trim().length > 0) {
                      toast?.({ title: '노트가 있는 문장입니다', description: '노트 내용이 있는 문장은 빠른 토글을 사용할 수 없습니다', duration: 2000 });
                      return;
                    }
                    try {
                      if (currentHighlight.hasHighlight && currentHighlight.noteId) {
                        await apiRequest(`/api/notes/${currentHighlight.noteId}`, { method: 'DELETE' });
                        toast?.({ title: '하이라이트 제거됨', duration: 2000 });
                      } else {
                        await apiRequest('/api/notes', { method: 'POST', json: { sentenceId: sentence.id, content: null, tags: [], notebookId: null, color: 'yellow' } });
                        toast?.({ title: '하이라이트 추가됨', duration: 2000 });
                      }
                      queryClient?.invalidateQueries({ queryKey: ['/api/quiz/notebooks'] });
                      if (documentId) queryClient?.invalidateQueries({ queryKey: ['/api/documents', documentId] });
                    } catch (error) {
                      console.error('Highlight toggle error:', error);
                    }
                  }}
                  title={getSentenceHighlight(sentence.id, sentencesById).hasHighlight ? "하이라이트 제거" : "하이라이트 추가"}
                >
                  <Highlighter className={cn("h-4 w-4 transition-colors", getSentenceHighlight(sentence.id, sentencesById).hasHighlight ? "text-yellow-600 dark:text-yellow-400" : "text-gray-500")} />
                </button>
              </span>
              {index < sentences.length - 1 && ' '}
            </span>
          );
        })}
      </WrapperTag>
    );
  };

  // Phase 2-2 FIX: Helper to get sentences directly from block.sentences[]
  // This avoids anchor-based lookup which can contain stale/punctuated data
  // STRUCTURAL FIX: Use DB IDs when available, generate unique fallback IDs using block.order
  const getBlockSentences = (): Sentence[] => {
    if (block.sentences && block.sentences.length > 0) {
      const anchorStartId = block.anchor?.sentenceStartId;
      const anchorSentences = collectSentencesFromAnchor();
      
      return block.sentences.map((s: any, index: number) => {
        let sentenceId: number;
        if (typeof s.id === 'number') {
          sentenceId = s.id;
        } else if (anchorStartId != null) {
          sentenceId = anchorStartId + index;
        } else {
          sentenceId = (block.order || 0) * 10000 + index;
        }
        const dbSentence = sentencesById?.[sentenceId] || anchorSentences.find(a => a.id === sentenceId);
        
        return {
          id: sentenceId,
          source: s.text || s.source || '',
          target: dbSentence?.target ?? s.target ?? null,
          targetAi: dbSentence?.targetAi ?? s.targetAi ?? null,
          targetEdited: dbSentence?.targetEdited ?? s.targetEdited ?? null,
          status: (dbSentence as any)?.status || s.status || 'new' as const,
          practiceCount: (dbSentence as any)?.practiceCount || s.practiceCount || 0,
          isScrapped: (dbSentence as any)?.isScrapped || s.isScrapped || false,
        };
      });
    }
    return collectSentencesFromAnchor();
  };

  switch (block.type) {
    // Phase 2-2 FIX: Document title is a translatable semantic unit
    // Use block.sentences[] directly (contains clean text, no punctuation)
    case "document_title": {
      const titleSentences = getBlockSentences();
      const titleClassName = cn(
        "font-bold text-foreground mt-4 mb-6 first:mt-0 leading-tight text-3xl md:text-4xl"
      );
      
      console.log(`[StructuredBlockRenderer] Rendering document_title with ${titleSentences.length} sentences (translatable)`);
      return renderSentences(titleSentences, titleClassName, 'h1');
    }

    case "heading":
    case "abstract":
    case "abstract_label": {
      // Phase 2-2 FIX: Heading is a translatable semantic unit
      // Use block.sentences[] directly (contains clean text, no punctuation)
      const headingSentences = getBlockSentences();
      const headingLevel = Math.min(block.level || 2, 6);
      const HeadingTag = `h${headingLevel}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      const headingClassName = cn(
        "font-bold text-foreground mt-6 mb-4 first:mt-0 leading-relaxed",
        block.type === "abstract" && "font-normal italic",
        block.type === "abstract_label" && "text-sm font-semibold uppercase tracking-wide",
        headingLevel === 1 && "text-3xl",
        headingLevel === 2 && "text-2xl",
        headingLevel === 3 && "text-xl",
        headingLevel === 4 && "text-lg",
        headingLevel >= 5 && "text-base"
      );
      
      console.log(`[StructuredBlockRenderer] Rendering ${block.type} with ${headingSentences.length} sentences (translatable)`);
      
      // Fallback: if no sentences, display content directly (e.g., for abstract_label without DB sentences)
      if (headingSentences.length === 0 && block.content) {
        return (
          <HeadingTag className={headingClassName}>
            {block.content}
          </HeadingTag>
        );
      }
      
      return renderSentences(headingSentences, headingClassName, HeadingTag);
    }
    
    // Phase 1: Abstract body - translatable block for abstract content
    // STRUCTURAL FIX: Use block.sentences[] directly (Layout Track), not anchor-based lookup
    case "abstract_body": {
      const abstractSentences = getBlockSentences();
      const abstractClassName = cn(
        "text-muted-foreground text-base leading-relaxed mb-6 italic"
      );
      
      console.log(`[StructuredBlockRenderer] Rendering abstract_body with ${abstractSentences.length} sentences (translatable)`);
      return renderSentences(abstractSentences, abstractClassName, 'p');
    }

    case "reference_block": {
      const refContent = block.content || "";
      return (
        <div className="my-2 text-sm text-muted-foreground leading-relaxed whitespace-pre-line break-all">
          {refContent}
        </div>
      );
    }

    case "image":
    case "figure":
      return (
        <div className="my-8 flex flex-col items-center">
          {block.src ? (
            <LazyImage
              src={block.src}
              alt={block.caption || "Document image"}
              className="max-w-full h-auto rounded-lg shadow-sm border border-border"
              style={{ maxHeight: '400px', objectFit: 'contain' }}
            />
          ) : (
            <div className="w-full max-w-lg h-40 bg-muted rounded-lg flex items-center justify-center border-2 border-dashed border-border">
              <div className="text-center text-muted-foreground">
                <ImageIcon className="w-10 h-10 mx-auto mb-2" />
                <p className="text-sm font-medium">Figure/Image</p>
                {block.origin && (
                  <p className="text-xs">{t('viewer.figurePage')} {block.origin.page}</p>
                )}
              </div>
            </div>
          )}
          {block.caption && (
            <p className="text-sm text-muted-foreground mt-2 text-center italic">
              {block.caption}
            </p>
          )}
        </div>
      );

    case "paragraph":
      // STRUCTURAL FIX: Use block.sentences[] directly (Layout Track), not anchor-based lookup
      // This ensures paragraphs are translatable based on Layout Track data, not DB state
      const blockSentences = getBlockSentences();
      console.log(`[StructuredBlockRenderer] Rendering paragraph with ${blockSentences.length} sentences (translatable)`);

      return (
        <div className="my-4" data-paragraph-id={paragraphId}>
          {blockSentences.length > 0 ? (
            <p className="text-foreground leading-relaxed whitespace-normal break-words">
              {blockSentences.map((sentence: Sentence, index: number) => {
                // Use mode-appropriate text selection (prioritize targetEdited for translations)
                const textToDisplay = mode === "translation-only"
                  ? (getDisplayTranslation(sentence) || sentence.source)
                  : sentence.source;
                // Remove ALL types of line breaks and normalize whitespace
                const normalizedText = textToDisplay
                  .replace(/[\r\n\u000B\u000C\u0085\u2028\u2029]+/g, ' ')  // All line break characters
                  .replace(/[ \t]+/g, ' ')  // Multiple spaces/tabs to single space
                  .trim();

                return (
                  <span key={`structured-sentence-${sentence.id}`} className="sentence-segment relative inline whitespace-normal">
                    {editingSentenceId === sentence.id && mode !== "original-only" ? (
                      <>
                        <span className="invisible inline">{normalizedText}</span>
                        <span 
                          className="absolute top-0 z-50"
                          style={{
                            [editPopupPosition?.alignment || 'right']: '0',
                            width: '350px',
                            maxWidth: editPopupPosition?.maxWidth || '350px',
                          }}
                        >
                          <span className="relative shadow-lg rounded-md bg-card border border-border block">
                            <Textarea
                              ref={textareaRef}
                              value={editedValue}
                              onChange={(e) => setEditedValue?.(e.target.value)}
                              onKeyDown={handleKeyDown}
                              className="w-full p-2 pb-12 resize-none border-0 shadow-none bg-transparent font-sans text-base min-h-[80px] focus-visible:ring-0 focus-visible:ring-offset-0"
                              placeholder={t('viewer.enterTranslation')}
                            />
                            <span className="absolute bottom-2 left-2 right-2 flex justify-between items-center">
                              <button
                                aria-label="AI 도우미"
                                data-testid="button-ai-review"
                                className="p-1.5 hover:bg-[hsl(var(--sage-subtle))] dark:hover:bg-slate-800/50 rounded text-xs flex items-center justify-center w-8 h-8 transition-all"
                                onClick={() => {
                                  onOpenAIDrawer?.({ id: sentence.id, source: sentence.source, target: editedValue || null } as any, "edit");
                                }}
                                title="AI 도우미"
                              >
                                <Bot
                                  aria-hidden="true"
                                  className="h-4 w-4 text-forest dark:text-slate-400" />
                              </button>
                              <span className="flex gap-1">
                                <Button size="icon" variant="ghost" onClick={handleSaveEdit} className="h-7 w-7" title={t('viewer.save')}>
                                  <Check className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" onClick={handleCancelEdit} className="h-7 w-7" title={t('common.cancel')}>
                                  <X className="h-4 w-4" />
                                </Button>
                              </span>
                            </span>
                            
                            {/* Upgrade Prompt for Free Users */}
                            {showUpgradePrompt && (
                              <div className="mt-2 p-3 bg-gradient-to-r from-brand-subtle to-brand-soft dark:from-brand/10 dark:to-brand/5 border border-brand-outline dark:border-brand/30 rounded-md">
                                <div className="flex items-start gap-2">
                                  <Crown className="h-5 w-5 text-brand flex-shrink-0 mt-0.5" />
                                  <div className="flex-1">
                                    <p className="text-sm font-medium text-brand dark:text-brand">
                                      {t('viewer.proFeature') || 'Pro Feature'}
                                    </p>
                                    <p className="text-xs text-brand/80 dark:text-brand/70 mt-1">
                                      {t('viewer.upgradePromptDesc') || 'Detailed grammar & nuance coaching is a Pro feature. Upgrade now to get your own AI language tutor!'}
                                    </p>
                                    <Button
                                      size="sm"
                                      variant="default"
                                      onClick={() => setLocation?.('/pricing')}
                                      className="mt-2 h-7 text-xs bg-brand hover:bg-brand-hover"
                                    >
                                      {t('viewer.upgradeToPro') || 'Upgrade to Pro'}
                                      <ArrowRight className="ml-1 h-3 w-3" />
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )}
                            
                            {/* AI Coaching Results */}
                            {showAiCoaching && aiCoachingResult && (
                              <div className="mt-2 p-3 bg-gradient-to-r from-brand-paper to-brand-surface dark:from-brand-ink/20 dark:to-brand-surface/10 border border-brand-ink/20 dark:border-brand-ink/30 rounded-xl space-y-3">
                                <div className="flex items-center gap-2 text-sm font-medium text-brand-ink dark:text-brand-ink">
                                  <Sparkles className="h-4 w-4 text-brand-amber" />
                                  {t('viewer.coachAdvice') || "Coach's Advice"}
                                  {aiCoachingResult.cached && (
                                    <span className="text-xs text-muted-foreground">(cached)</span>
                                  )}
                                </div>
                                
                                {/* Polished Translation */}
                                <div className="space-y-1">
                                  <div className="text-xs font-medium text-brand-amber dark:text-brand-amber">
                                    {t('viewer.polishedTranslation') || 'Polished Translation'}
                                  </div>
                                  <div className="p-2 bg-white/60 dark:bg-black/20 rounded text-sm text-foreground">
                                    {aiCoachingResult.polishedTranslation}
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={handleApplyCoachingTranslation}
                                    className="mt-1 h-6 text-xs border-brand-ink/30 hover:bg-brand-ink/10 dark:hover:bg-brand-ink/20"
                                  >
                                    <ArrowRight className="mr-1 h-3 w-3" />
                                    {t('viewer.applyToTranslation') || 'Apply to My Translation'}
                                  </Button>
                                </div>
                                
                                {/* Grammar Insight */}
                                <div className="space-y-1">
                                  <div className="text-xs font-medium text-brand-ink dark:text-brand-ink/80">
                                    {t('viewer.grammarInsight') || 'Grammar Insight'}
                                  </div>
                                  <div className="p-2 bg-white/60 dark:bg-black/20 rounded text-xs text-muted-foreground">
                                    {aiCoachingResult.grammarInsight}
                                  </div>
                                </div>
                                
                                {/* Nuance Tips */}
                                <div className="space-y-1">
                                  <div className="text-xs font-medium text-brand-ink/70 dark:text-brand-ink/60">
                                    {t('viewer.nuanceTips') || 'Nuance & Tips'}
                                  </div>
                                  <div className="p-2 bg-white/60 dark:bg-black/20 rounded text-xs text-muted-foreground">
                                    {aiCoachingResult.nuanceTips}
                                  </div>
                                </div>
                                
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setShowAiCoaching?.(false)}
                                  className="h-6 text-xs text-muted-foreground"
                                >
                                  <X className="mr-1 h-3 w-3" />
                                  {t('viewer.closeCoaching') || 'Close'}
                                </Button>
                              </div>
                            )}
                          </span>
                        </span>
                      </>
                    ) : (
                      // Wrap in Tooltip for single-column modes to show corresponding text
                      <Tooltip delayDuration={300}>
                        <TooltipTrigger asChild>
                          <span
                            tabIndex={0}
                            role="button"
                            aria-label={`문장: ${normalizedText.slice(0, 50)}... - 북마크하거나 노트를 추가하려면 Enter 키를 누르세요`}
                            aria-haspopup="true"
                            aria-expanded={pinnedSentence?.id === sentence.id && pinnedSentence?.lane === currentLane}
                            aria-controls={`sentence-toolbar-${sentence.id}-${currentLane}`}
                            data-testid="sentence-trigger"
                            className={cn(
                              "inline align-baseline cursor-pointer rounded px-0.5 -mx-0.5 transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                              "selection:bg-muted/50",
                              // Show untranslated text in muted color when in translation-only mode
                              mode === "translation-only" && !getDisplayTranslation(sentence) && "text-muted-foreground/50 italic",
                              // Highlight colors take priority over other states
                              getSentenceHighlight(sentence.id, sentencesById).hasHighlight && "bg-yellow-200/60 hover:bg-yellow-300/60",
                              // Default states when no highlight
                              !getSentenceHighlight(sentence.id, sentencesById).hasHighlight && "hover:bg-muted/80",
                              getSentenceNote(sentence.id, sentencesById) && "border-b border-solid border-blue-500",
                              editingSentenceId === sentence.id && "bg-muted/70",
                              // Semibold corresponding sentence when pinned (clicked) - applies to both lanes
                              pinnedSentence?.id === sentence.id && "font-semibold"
                            )}
                            onClick={(e) => handleSentenceClick?.(sentence, e, currentLane)}
                            onMouseEnter={() => setHoveredSentence?.({ id: sentence.id, lane: currentLane })}
                            onMouseLeave={() => setHoveredSentence?.(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                handleSentenceClick?.(sentence, undefined, currentLane);
                              }
                            }}
                            onDoubleClick={() => handleSentenceDoubleClick?.(sentence)}
                            data-sentence-id={sentence.id}
                            id={`structured-sentence-${sentence.id}-${currentLane}`}
                          >
                            {normalizedText}
                          </span>
                        </TooltipTrigger>
                        {/* Show tooltip only when explicitly enabled (single-column viewer modes, not side-by-side) */}
                        {showCorrespondingTooltip && (
                          <TooltipContent 
                            side="bottom" 
                            className="max-w-md p-3 text-sm leading-relaxed"
                            data-testid="tooltip-corresponding-text"
                          >
                            <div className="space-y-1">
                              <div className="text-xs font-medium text-muted-foreground mb-1">
                                {mode === "original-only" ? t('viewer.translation') : t('viewer.original')}
                              </div>
                              <div className="text-foreground">
                                {mode === "original-only" 
                                  ? (getDisplayTranslation(sentence) || t('viewer.noTranslationYet'))
                                  : sentence.source
                                }
                              </div>
                            </div>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    )}

                    {/* Hover menu for structured sentences - only show on the lane that was clicked */}
                    <span
                      id={`sentence-toolbar-${sentence.id}-${currentLane}`}
                      role="toolbar"
                      aria-label="문장 작업"
                      className={cn(
                        "hover-menu absolute top-full mt-1 right-0 flex gap-1 bg-background border rounded-lg shadow-lg p-2 z-50 min-w-max transition-all duration-300 ease-in-out",
                        pinnedSentence?.id === sentence.id && pinnedSentence?.lane === currentLane
                          ? "opacity-100 pointer-events-auto"
                          : "opacity-0 pointer-events-none"
                      )}
                    >
                      {/* Note button */}
                      <button
                        aria-label={getSentenceNote(sentence.id, sentencesById) ? "노트 편집" : "노트 추가"}
                        data-testid="button-note"
                        className={cn(
                          "p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded text-xs flex items-center justify-center w-8 h-8 transition-colors",
                          getSentenceNote(sentence.id, sentencesById) && "bg-blue-50 dark:bg-blue-900/30"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddNote?.(sentence);
                        }}
                        title={getSentenceNote(sentence.id, sentencesById) ? "노트 편집" : "노트 추가"}
                      >
                        <NotepadTextIcon
                          aria-hidden="true"
                          focusable={false}
                          className={cn(
                            "h-4 w-4 transition-colors",
                            getSentenceNote(sentence.id, sentencesById)
                              ? "text-slate-600 dark:text-blue-300"
                              : "text-gray-500 hover:text-slate-600 dark:hover:text-blue-300"
                          )} />
                      </button>

                      {/* Highlight button */}
                      <button
                        aria-label={getSentenceHighlight(sentence.id, sentencesById).hasHighlight ? "하이라이트 제거" : "하이라이트 추가"}
                        data-testid="button-highlight"
                        className={cn(
                          "p-1.5 hover:bg-yellow-50 dark:hover:bg-yellow-900/30 rounded text-xs flex items-center justify-center w-8 h-8 transition-colors",
                          getSentenceHighlight(sentence.id, sentencesById).hasHighlight && "bg-yellow-100 dark:bg-yellow-900/30"
                        )}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const currentHighlight = getSentenceHighlight(sentence.id, sentencesById);
                          const noteContent = getSentenceNote(sentence.id, sentencesById);
                          
                          if (noteContent && noteContent.trim().length > 0) {
                            toast?.({
                              title: '노트가 있는 문장입니다',
                              description: '노트 내용이 있는 문장은 빠른 토글을 사용할 수 없습니다',
                              duration: 2000
                            });
                            return;
                          }

                          try {
                            if (currentHighlight.hasHighlight && currentHighlight.noteId) {
                              await apiRequest(`/api/notes/${currentHighlight.noteId}`, {
                                method: 'DELETE'
                              });
                              toast?.({
                                title: '하이라이트 제거됨',
                                description: '모든 노트북에서 하이라이트가 삭제되었습니다',
                                duration: 2000
                              });
                            } else {
                              await apiRequest('/api/notes', {
                                method: 'POST',
                                json: {
                                  sentenceId: sentence.id,
                                  content: null,
                                  tags: [],
                                  notebookId: null,
                                  color: 'yellow'
                                }
                              });
                              toast?.({
                                title: '하이라이트 추가됨',
                                description: '문장이 성공적으로 하이라이트되었습니다',
                                duration: 2000
                              });
                            }
                            
                            // Invalidate specific document and Practice Hub notebooks
                            queryClient?.invalidateQueries({ queryKey: ['/api/quiz/notebooks'] });
                            if (documentId) {
                              queryClient?.invalidateQueries({ queryKey: ['/api/notes/document', documentId] });
                              queryClient?.invalidateQueries({ queryKey: [`/api/documents/${documentId}`] });
                            }
                          } catch (error) {
                            console.error('Failed to toggle highlight:', error);
                            toast?.({
                              title: '오류',
                              description: '하이라이트 토글에 실패했습니다',
                              variant: 'destructive'
                            });
                          }
                        }}
                        title={getSentenceHighlight(sentence.id, sentencesById).hasHighlight ? "하이라이트 제거" : "하이라이트 추가"}
                      >
                        <Highlighter
                          aria-hidden="true"
                          focusable={false}
                          className={cn(
                            "h-4 w-4 transition-colors",
                            getSentenceHighlight(sentence.id, sentencesById).hasHighlight
                              ? "text-yellow-600 dark:text-yellow-400"
                              : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                          )} />
                      </button>

                      {/* Edit button for translation - only show when not in original-only mode */}
                      {mode !== "original-only" && (
                        <button
                          aria-label="번역 편집"
                          data-testid="button-edit-structured"
                          className="p-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 rounded text-xs flex items-center justify-center w-8 h-8 transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSentenceDoubleClick?.(sentence);
                          }}
                          title={isTranslationEdited(sentence) ? "번역 편집 (수정됨)" : "번역 편집"}
                        >
                          <Edit3
                            aria-hidden="true"
                            focusable={false}
                            className={cn(
                              "h-4 w-4 transition-colors",
                              isTranslationEdited(sentence)
                                ? "text-gray-900 dark:text-gray-100 stroke-[2.5]"
                                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                            )} />
                        </button>
                      )}

                      {/* AI button - opens AI drawer for explanation */}
                      <button
                        aria-label="AI 도우미"
                        data-testid="button-ai-hover"
                        className="p-1.5 hover:bg-[hsl(var(--sage-subtle))] dark:hover:bg-slate-800/50 rounded text-xs flex items-center justify-center w-8 h-8 transition-all"
                        onClick={(e) => {
                          e.stopPropagation();
                          setHoveredSentence?.(null);
                          setPinnedSentence?.(null);
                          onOpenAIDrawer?.(sentence, "hover");
                        }}
                        title="AI 도우미"
                      >
                        <Bot
                          aria-hidden="true"
                          focusable={false}
                          className="h-4 w-4 text-forest dark:text-slate-400" />
                      </button>
                    </span>

                    {index < blockSentences.length - 1 && " "}
                  </span>
                );
              })}
            </p>
          ) : (
            <div className="text-foreground leading-relaxed">
              {block.content}
            </div>
          )}
        </div>
      );

    case "table":
      return (
        <div className="my-6 w-full">
          {block.html ? (
            <div className="relative">
              {/* Mobile scroll indicator */}
              <div className="block sm:hidden mb-2">
                <div className="flex items-center text-xs text-muted-foreground">
                  <span className="mr-1">↔</span>
                  <span>스크롤하여 전체 테이블 보기</span>
                </div>
              </div>

              {/* Enhanced responsive table container */}
              <div className="
                overflow-x-auto
                border border-border
                rounded-lg
                shadow-sm
                bg-card
                max-w-full
                scrollbar-thin scrollbar-thumb-muted-foreground/30 scrollbar-track-muted/50
              ">
                <div
                  className="prose prose-slate max-w-none min-w-full"
                  dangerouslySetInnerHTML={{
                    __html: enhanceTableHtml(block.html)
                  }}
                />
              </div>

              {/* Table export actions */}
              <div className="mt-2 flex justify-end space-x-2">
                <button
                  onClick={() => exportTableData(block.html || '', 'csv', block.caption)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  CSV로 내보내기
                </button>
                <button
                  onClick={() => exportTableData(block.html || '', 'json', block.caption)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  JSON으로 내보내기
                </button>
              </div>
            </div>
          ) : (
            <div className="w-full h-32 bg-muted rounded-lg flex items-center justify-center border border-border shadow-sm">
              <div className="text-center text-muted-foreground">
                <Table className="w-8 h-8 mx-auto mb-2" />
                <p className="font-medium">Table placeholder</p>
                {block.origin && (
                  <p className="text-xs mt-1">{t('viewer.page')} {block.origin.page}</p>
                )}
              </div>
            </div>
          )}
          {block.caption && (
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-3 text-center italic font-medium px-4">
              {block.caption}
            </p>
          )}
        </div>
      );

    case "caption":
      return (
        <div className="my-4 text-center">
          <p className={cn(
            "text-sm text-gray-600 dark:text-gray-400 italic font-medium",
            block.captionFor === 'figure' && "text-gray-600 dark:text-gray-400",
            block.captionFor === 'table' && "text-gray-600 dark:text-gray-400"
          )}>
            {block.captionFor && (
              <span className="inline-block mr-2 px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 dark:bg-gray-700">
                {block.captionFor === 'figure' ? 'Figure' : 'Table'}
              </span>
            )}
            {block.content || block.caption}
          </p>
          {block.origin && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              {t('viewer.page')} {block.origin.page}
            </p>
          )}
        </div>
      );

    // Metadata block types - non-translatable, display content directly
    case "doi":
    case "journal":
    case "author":
    case "affiliation":
      return (
        <div className={cn(
          "my-2 text-muted-foreground",
          block.type === "doi" && "text-sm font-mono",
          block.type === "journal" && "text-sm italic",
          block.type === "author" && "text-base font-medium",
          block.type === "affiliation" && "text-sm"
        )}>
          {block.content}
        </div>
      );

    default:
      // Log unhandled block types for debugging
      console.warn(`[StructuredBlockRenderer] Unhandled block type: ${block.type}`);
      return block.content ? (
        <div className="my-2 text-foreground">{block.content}</div>
      ) : null;
  }
}

// Utility function to create proxy URL for external images
function getProxiedImageUrl(originalUrl: string, options?: { width?: number; height?: number; quality?: number }): string {
  // Only proxy external URLs (not relative or local URLs)
  if (!originalUrl.startsWith('http://') && !originalUrl.startsWith('https://')) {
    return originalUrl;
  }

  // Check if it's a local/Replit URL that doesn't need proxying
  if (originalUrl.includes('replit.app') || originalUrl.includes('replit.com') || originalUrl.includes('localhost')) {
    return originalUrl;
  }

  const proxyUrl = new URL('/api/image-proxy', window.location.origin);
  proxyUrl.searchParams.set('url', originalUrl);

  if (options?.width) {
    proxyUrl.searchParams.set('width', options.width.toString());
  }
  if (options?.height) {
    proxyUrl.searchParams.set('height', options.height.toString());
  }
  if (options?.quality) {
    proxyUrl.searchParams.set('quality', options.quality.toString());
  }

  // Set device pixel ratio for retina displays
  if (window.devicePixelRatio > 1) {
    proxyUrl.searchParams.set('dpr', window.devicePixelRatio.toString());
  }

  return proxyUrl.toString();
}

// LazyImage component with loading states and error handling
function LazyImage({ src, alt, className, style }: { src: string; alt: string; className?: string; style?: React.CSSProperties }) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isInView, setIsInView] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Intersection Observer for lazy loading
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 }
    );

    if (imgRef.current) {
      observer.observe(imgRef.current);
    }

    return () => observer.disconnect();
  }, []);

  const handleLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  const handleError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  return (
    <div ref={imgRef} className={cn("relative", className)} style={style}>
      {/* Loading skeleton */}
      {isLoading && isInView && (
        <div className="absolute inset-0 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse flex items-center justify-center">
          <ImageIcon className="w-8 h-8 text-gray-400" />
        </div>
      )}

      {/* Enhanced error placeholder with retry */}
      {hasError && (
        <div className="bg-muted rounded-lg flex items-center justify-center border-2 border-dashed border-border min-h-[200px] p-4">
          <div className="text-center text-muted-foreground max-w-sm">
            <ImageIcon className="w-10 h-10 mx-auto mb-3" />
            <p className="text-sm font-medium mb-2">이미지를 불러올 수 없습니다</p>
            <p className="text-xs mb-3 text-muted-foreground/80 break-words">{alt}</p>
            <div className="space-y-2">
              <button
                onClick={() => {
                  setHasError(false);
                  setIsLoading(true);
                }}
                className="px-3 py-1 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded transition-colors"
              >
                다시 시도
              </button>
              <button
                onClick={() => window.open(src, '_blank')}
                className="ml-2 px-3 py-1 text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 border border-gray-300 dark:border-gray-600 rounded transition-colors"
              >
                원본 보기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Actual image */}
      {isInView && !hasError && (
        <img
          src={getProxiedImageUrl(src, { width: 800, quality: 85 })}
          alt={alt}
          className={cn(
            "transition-opacity duration-300",
            isLoading ? "opacity-0" : "opacity-100",
            className
          )}
          style={style}
          onLoad={handleLoad}
          onError={handleError}
          loading="lazy"
        />
      )}
    </div>
  );
}

export default function SegmentViewer({
  mode,
  paragraphs,
  structuredBlocks = [],
  sentencesById = {},
  onUpdateSentence,
  onTranslateSentence,
  onAddNote,
  onPracticeSentence,
  onSaveSentence,
  onAddToGlossary,
  onOpenAIDrawer,
  isAIDrawerOpen = false,
  fontSize = 16,
  lineHeight = 1.6,
  useSerif = false,
  documentWidth = 720,
  isPublicDocument = false,
  isMobile = false,
  documentId,
  showHoverTooltip = true,
}: SegmentViewerProps) {
  const [editingSentenceId, setEditingSentenceId] = useState<number | null>(null);
  const [editedValue, setEditedValue] = useState("");
  const [highlightedSentenceId, setHighlightedSentenceId] = useState<number | null>(null);
  const [hoveredSentence, setHoveredSentence] = useState<HoveredState>(null);
  const [pinnedSentence, setPinnedSentence] = useState<PinnedState>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editPopupPosition, setEditPopupPosition] = useState<{ alignment: 'left' | 'right'; maxWidth: string }>({ alignment: 'right', maxWidth: '350px' });

  // AI Coaching state
  const [aiCoachingResult, setAiCoachingResult] = useState<{
    polishedTranslation: string;
    grammarInsight: string;
    nuanceTips: string;
    cached?: boolean;
  } | null>(null);
  const [showAiCoaching, setShowAiCoaching] = useState(false);
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);

  // Text selection and glossary tooltip state
  const [selectedText, setSelectedText] = useState("");
  const [selectionPosition, setSelectionPosition] = useState<{ x: number; y: number } | null>(null);
  const [contextSentence, setContextSentence] = useState<string>("");
  const [documentIdState, setDocumentIdState] = useState<number | undefined>(documentId);
  
  // Track mouse drag to distinguish from double-click word selection
  const mouseDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);

  // Toast functionality for user feedback
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { isAuthenticated, user } = useAuth();
  const [, setLocation] = useLocation();

  // AI Coaching mutation
  const aiCoachingMutation = useMutation({
    mutationFn: async (sentenceId: number) => {
      return await apiRequest(`/api/sentences/${sentenceId}/coach`, {
        method: "POST",
      });
    },
    onSuccess: (data) => {
      setAiCoachingResult(data);
      setShowAiCoaching(true);
      setShowUpgradePrompt(false);
    },
    onError: (error: any) => {
      console.log('[AI Coaching Error]', error, error?.status, error?.response?.status);
      if (error?.status === 403 || error?.response?.status === 403 || error?.message?.includes("Pro feature")) {
        setShowUpgradePrompt(true);
        setShowAiCoaching(false);
      } else {
        toast({
          title: t('viewer.error') || "Error",
          description: t('viewer.aiCoachingFailed') || "Failed to get AI coaching",
          variant: "destructive",
        });
      }
    },
  });

  const handleAICoaching = (sentenceId: number) => {
    if (!isAuthenticated) {
      toast({
        title: t('viewer.loginRequired') || "Login Required",
        description: t('viewer.loginRequiredDesc') || "Please log in to use AI coaching",
      });
      setLocation('/login');
      return;
    }
    // Check if user is on starter plan (will be handled by API, but show prompt UI)
    setAiCoachingResult(null);
    setShowUpgradePrompt(false);
    aiCoachingMutation.mutate(sentenceId);
  };

  const handleApplyCoachingTranslation = () => {
    if (aiCoachingResult?.polishedTranslation) {
      setEditedValue(aiCoachingResult.polishedTranslation);
      toast({
        title: t('viewer.translationApplied') || "Translation Applied",
        description: t('viewer.translationAppliedDesc') || "AI translation has been applied. You can now refine it.",
      });
    }
  };

  const viewModeClass = {
    "original-only": "",
    "translation-only": "",
    "side-by-side": "",
  };

  const groupedParagraphs = useMemo(() => groupSentencesByParagraphs(paragraphs), [paragraphs]);
  const mergedContent = useMemo(() => createMergedContent(groupedParagraphs, structuredBlocks), [groupedParagraphs, structuredBlocks]);

  // Auto-focus textarea when editing begins
  useEffect(() => {
    if (editingSentenceId && textareaRef.current) {
      textareaRef.current.focus();
      const length = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(length, length);
    }
  }, [editingSentenceId]);

  // Auto-resize textarea - use setTimeout to ensure DOM is fully ready
  useEffect(() => {
    if (editingSentenceId && textareaRef.current) {
      const textarea = textareaRef.current;
      
      const resizeTextarea = () => {
        if (textarea) {
          textarea.style.height = "auto";
          textarea.style.height = `${textarea.scrollHeight}px`;
        }
      };
      
      // Initial resize with small delay to ensure font/styles are loaded
      const timeoutId = setTimeout(resizeTextarea, 50);
      
      // Also resize immediately for subsequent changes
      if (editedValue !== undefined) {
        resizeTextarea();
      }
      
      return () => clearTimeout(timeoutId);
    }
  }, [editedValue, editingSentenceId]);

  // Dynamic popup position calculation
  useEffect(() => {
    if (!editingSentenceId) return;
    
    const sentenceElement = document.querySelector(`[data-sentence-id="${editingSentenceId}"]`);
    if (!sentenceElement) return;

    // Find the translation column container (in side-by-side mode)
    let columnContainer = sentenceElement.closest('.prose-neutral');
    if (!columnContainer) {
      columnContainer = sentenceElement.closest('[class*="font-sans"]');
    }

    const sentenceRect = sentenceElement.getBoundingClientRect();
    const popupWidth = 350;
    const minSpace = 16;
    
    if (columnContainer) {
      // We have a column container - constrain popup to it
      const columnRect = columnContainer.getBoundingClientRect();
      const rightSpace = columnRect.right - sentenceRect.right; // Space from sentence end to column right edge
      const leftSpace = sentenceRect.left - columnRect.left;     // Space from column left edge to sentence start
      
      // Try right-align first: check if popup fits to the right of sentence
      if (rightSpace >= popupWidth + minSpace) {
        setEditPopupPosition({ alignment: 'right', maxWidth: '350px' });
      } else if (rightSpace >= minSpace) {
        // Right-align but with constrained width
        const constrainedWidth = Math.max(rightSpace - minSpace, 200);
        setEditPopupPosition({ alignment: 'right', maxWidth: `${constrainedWidth}px` });
      } else {
        // Not enough space on right, try left-align
        if (leftSpace >= popupWidth + minSpace) {
          setEditPopupPosition({ alignment: 'left', maxWidth: '350px' });
        } else {
          // Constrain to available left space
          const constrainedWidth = Math.max(leftSpace - minSpace, 200);
          setEditPopupPosition({ alignment: 'left', maxWidth: `${constrainedWidth}px` });
        }
      }
    } else {
      // Fallback for single-column modes
      const viewportWidth = window.innerWidth;
      const rightSpace = viewportWidth - sentenceRect.right;
      if (rightSpace >= popupWidth + minSpace) {
        setEditPopupPosition({ alignment: 'right', maxWidth: '350px' });
      } else {
        setEditPopupPosition({ alignment: 'left', maxWidth: `${Math.max(viewportWidth - minSpace * 2, 200)}px` });
      }
    }
  }, [editingSentenceId]);

  // Handle outside click to unpin menus and keyboard shortcuts
  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Element;
      // Don't unpin if clicking on a sentence or hover menu
      if (!target.closest('.sentence-segment') && !target.closest('.hover-menu')) {
        setPinnedSentence(null);
      }
    };

    if (pinnedSentence) {
      document.addEventListener('mousedown', handleOutsideClick);
    }

    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [pinnedSentence]);


  // Quick highlight toggle function for Option+Click
  const handleQuickHighlightToggle = async (sentenceId?: number) => {
    const targetSentenceId = sentenceId || highlightedSentenceId;
    if (!targetSentenceId) {
      console.log('[DEBUG] No sentence specified for quick highlight toggle');
      return;
    }

    // Check current highlight state and note content
    const highlightInfo = getSentenceHighlight(targetSentenceId, sentencesById);
    const noteContent = getSentenceNote(targetSentenceId, sentencesById);

    console.log('[DEBUG] Quick highlight toggle for sentence:', targetSentenceId, {
      hasHighlight: highlightInfo.hasHighlight,
      noteId: highlightInfo.noteId,
      hasNoteContent: !!noteContent && noteContent.trim().length > 0
    });

    // If there's note content, ignore Option+Click
    if (noteContent && noteContent.trim().length > 0) {
      console.log('[DEBUG] Ignoring Option+Click - sentence has note content');
      toast({
        title: '노트가 있는 문장입니다',
        description: '노트 내용이 있는 문장은 빠른 토글을 사용할 수 없습니다',
        duration: 2000
      });
      return;
    }

    try {
      if (highlightInfo.hasHighlight && highlightInfo.noteId) {
        // Delete existing highlight (only if no content)
        console.log('[DEBUG] Deleting existing highlight:', highlightInfo.noteId);
        await apiRequest(`/api/notes/${highlightInfo.noteId}`, {
          method: 'DELETE'
        });

        toast({
          title: '하이라이트 제거됨',
          description: '모든 노트북에서 하이라이트가 삭제되었습니다',
          duration: 2000
        });
      } else {
        // Create new highlight
        console.log('[DEBUG] Creating new highlight for sentence:', targetSentenceId);
        await apiRequest('/api/notes', {
          method: 'POST',
          json: {
            sentenceId: targetSentenceId,
            content: null, // highlight-only note
            tags: [],
            notebookId: null, // will auto-assign to document notebook
            color: 'yellow' // default highlight color
          }
        });

        toast({
          title: '빠른 하이라이트 추가됨',
          description: '문장이 성공적으로 하이라이트되었습니다',
          duration: 2000
        });
      }

      // Invalidate relevant queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      queryClient.invalidateQueries({ queryKey: ['/api/quiz/notebooks'] });
      if (documentId) {
        queryClient.invalidateQueries({ queryKey: ['/api/notes/document', documentId] });
        queryClient.invalidateQueries({ queryKey: [`/api/documents/${documentId}`] });
      }

    } catch (error) {
      console.error('Failed to toggle quick highlight:', error);
      toast({
        title: '오류',
        description: '하이라이트 토글에 실패했습니다',
        variant: 'destructive'
      });
    }
  };

  const handleSentenceClick = (sentence: Sentence, event?: React.MouseEvent, lane: SentenceLane = 'original') => {
    // Disable interactions while Edit Modal or AI Drawer is open
    if (editingSentenceId !== null || isAIDrawerOpen) {
      return;
    }
    
    setHighlightedSentenceId(sentence.id);

    // Check for Option/Alt+Click for quick highlight toggle
    if (event && (event.altKey || event.metaKey)) {
      console.log('[DEBUG] Option+Click detected for quick highlight toggle, sentence:', sentence.id);
      event.preventDefault();
      handleQuickHighlightToggle(sentence.id);
      return;
    }

    // Toggle pinned state: if already pinned on same lane, unpin; otherwise pin this sentence
    if (pinnedSentence?.id === sentence.id && pinnedSentence?.lane === lane) {
      setPinnedSentence(null);
    } else {
      setPinnedSentence({ id: sentence.id, lane });
    }
  };

  const handleSentenceDoubleClick = (sentence: Sentence) => {
    // Disable double-click while Edit Modal or AI Drawer is open
    if (editingSentenceId !== null || isAIDrawerOpen) {
      return;
    }
    setEditingSentenceId(sentence.id);
    setEditedValue(getDisplayTranslation(sentence) || "");
    setHighlightedSentenceId(sentence.id);
    // Hide hover menu when editing starts
    setPinnedSentence(null);
    setHoveredSentence(null);
  };

  const handleSaveEdit = () => {
    if (editingSentenceId && onUpdateSentence) {
      // Phase 3: Add anchor-based translation consistency validation
      const sentenceToUpdate = paragraphs
        .flatMap(p => p.sentences)
        .find(s => s.id === editingSentenceId);

      if (sentenceToUpdate && structuredBlocks && structuredBlocks.length > 0) {
        // Find the structured block that should contain this sentence
        const containingBlock = structuredBlocks.find(block =>
          block.anchor &&
          sentenceToUpdate.id >= block.anchor.sentenceStartId &&
          sentenceToUpdate.id <= block.anchor.sentenceEndId
        );

        if (containingBlock && containingBlock.anchor) {
          console.log('[ANCHOR_CONSISTENCY] Translation update validated:', {
            sentenceId: editingSentenceId,
            blockId: `structured-${containingBlock.order}`,
            anchorRange: [containingBlock.anchor.sentenceStartId, containingBlock.anchor.sentenceEndId],
            translationText: editedValue.substring(0, 50) + '...'
          });
        } else {
          console.warn('[ANCHOR_CONSISTENCY] Translation update for sentence outside anchor range:', {
            sentenceId: editingSentenceId,
            availableAnchors: structuredBlocks
              .filter(b => b.anchor)
              .map(b => ({ order: b.order, range: b.anchor ? [b.anchor.sentenceStartId, b.anchor.sentenceEndId] : [] }))
          });
        }
      }

      onUpdateSentence(editingSentenceId, { targetEdited: editedValue });

      // Phase 3: Update anchor metadata after successful translation update
      if (sentenceToUpdate && structuredBlocks && structuredBlocks.length > 0) {
        const containingBlock = structuredBlocks.find(block =>
          block.anchor &&
          sentenceToUpdate.id >= block.anchor.sentenceStartId &&
          sentenceToUpdate.id <= block.anchor.sentenceEndId
        );

        if (containingBlock && containingBlock.anchor) {
          // Mark the structured block as having translated content
          console.log('[ANCHOR_CONSISTENCY] Marking block as having translated content:', {
            blockId: `structured-${containingBlock.order}`,
            updatedSentenceId: editingSentenceId,
            anchorRange: [containingBlock.anchor.sentenceStartId, containingBlock.anchor.sentenceEndId]
          });
        }
      }
    }
    setEditingSentenceId(null);
    setEditedValue("");
    setHighlightedSentenceId(null);
  };

  const handleCancelEdit = () => {
    setEditingSentenceId(null);
    setEditedValue("");
    setHighlightedSentenceId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      handleSaveEdit();
    }
    if (e.key === "Escape") {
      e.preventDefault();
      handleCancelEdit();
    }
  };

  // Handle text selection for glossary with Selection Guard
  const handleTextSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    // Word Snapping: Expand selection to full word boundaries
    try {
      // Expand backward to word start
      selection.modify('extend', 'backward', 'word');
      // Expand forward to word end
      selection.modify('extend', 'forward', 'word');
    } catch (e) {
      // Some browsers may not support modify(), continue with original selection
    }

    let selectedText = selection.toString().trim();
    
    // Content Validation: Minimum length check
    if (!selectedText || selectedText.length < 2) {
      setSelectedText("");
      setSelectionPosition(null);
      return;
    }

    // Content Validation: Check for punctuation/numbers/whitespace only
    const invalidContentPattern = /^[\s\d.,!?;:'"()\-–—\[\]{}\/\\@#$%^&*+=<>~`]+$/;
    if (invalidContentPattern.test(selectedText)) {
      selection.removeAllRanges();
      setSelectedText("");
      setSelectionPosition(null);
      return;
    }

    // Word count and character limit validation
    const wordCount = selectedText.split(/\s+/).filter(w => w.length > 0).length;
    const MAX_WORDS = 3;
    const MAX_CHARS = 30;

    if (wordCount > MAX_WORDS || selectedText.length > MAX_CHARS) {
      selection.removeAllRanges();
      setSelectedText("");
      setSelectionPosition(null);
      return;
    }

    // Get the range and position
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Find the sentence element that contains the selection
    let sentenceElement: Node | null = range.commonAncestorContainer;
    while (sentenceElement && sentenceElement.nodeType !== Node.ELEMENT_NODE) {
      sentenceElement = sentenceElement.parentNode;
    }

    // Look for sentence data
    let contextSentence = "";
    let currentElement = sentenceElement as HTMLElement;
    while (currentElement && !currentElement.dataset?.sentenceId) {
      currentElement = currentElement.parentElement!;
    }

    if (currentElement && currentElement.dataset) {
      const sentenceId = parseInt(currentElement.dataset.sentenceId!);
      // Find the sentence text from paragraphs
      const sentence = paragraphs
        .flatMap(p => p.sentences)
        .find(s => s.id === sentenceId);
      if (sentence) {
        contextSentence = sentence.source;
      }
    }

    setSelectedText(selectedText);
    setContextSentence(contextSentence);
    setSelectionPosition({
      x: rect.left + rect.width / 2,
      y: rect.top
    });

    // Get document ID from URL or props - you might need to pass this as a prop
    const urlParts = window.location.pathname.split('/');
    const docId = urlParts[urlParts.length - 1];
    if (docId && !isNaN(parseInt(docId))) {
      setDocumentIdState(parseInt(docId));
    }
  };

  const handleCloseGlossaryTooltip = () => {
    setSelectedText("");
    setSelectionPosition(null);
    setContextSentence("");
    window.getSelection()?.removeAllRanges();
  };

  // Add event listener for text selection - only trigger on actual drag selection
  // to avoid opening glossary tooltip on double-click
  useEffect(() => {
    const DRAG_THRESHOLD = 5; // Minimum pixels moved to count as a drag
    
    const handleMouseDown = (e: MouseEvent) => {
      mouseDownPosRef.current = { x: e.clientX, y: e.clientY };
      isDraggingRef.current = false;
    };
    
    const handleMouseMove = (e: MouseEvent) => {
      if (mouseDownPosRef.current) {
        const dx = Math.abs(e.clientX - mouseDownPosRef.current.x);
        const dy = Math.abs(e.clientY - mouseDownPosRef.current.y);
        if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
          isDraggingRef.current = true;
        }
      }
    };
    
    const handleMouseUp = () => {
      // Only process selection if user actually dragged (not double-click)
      // Also disable when AI drawer is open
      if (isDraggingRef.current && !isAIDrawerOpen) {
        // Small delay to ensure selection is finalized
        setTimeout(handleTextSelection, 50);
      }
      mouseDownPosRef.current = null;
      isDraggingRef.current = false;
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [paragraphs, isAIDrawerOpen]);
  
  // Close glossary tooltip when AI drawer opens
  useEffect(() => {
    if (isAIDrawerOpen && selectedText) {
      handleCloseGlossaryTooltip();
    }
  }, [isAIDrawerOpen]);

  // Only show "No content available" if we have neither paragraphs nor structured blocks
  if ((!paragraphs || paragraphs.length === 0) && (!structuredBlocks || structuredBlocks.length === 0)) {
    return (
      <div className="reader-container py-8">
        <div className={`mx-auto px-4 sm:px-6 lg:px-8 ${viewModeClass[mode]}`}>
          <div className="text-center py-10">
            <p className="text-gray-500">No content available</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="reader-container flex flex-col h-full">
        <div
          className={cn(
            `mx-auto px-2 sm:px-4 lg:px-6 reader-content flex-1 min-h-0 ${viewModeClass[mode]}`,
            useSerif && "serif"
          )}
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: useSerif ? 1.8 : lineHeight,
            maxWidth: `${documentWidth}px`,
            width: '100%',
            '--font-size': `${fontSize}px`,
            '--line-height': useSerif ? 1.8 : lineHeight
          } as React.CSSProperties}
        >
          {mode === "side-by-side" ? (
            // Side-by-side view with aligned source and target paragraphs using paragraph-pair grid pattern
            <div className="space-y-0">
              {mergedContent.map((item, itemIndex) => (
                <section key={`pair-${item.id}-${itemIndex}`} className="grid grid-cols-1 md:grid-cols-2 gap-6 items-baseline">
                  {/* Source Column for this item */}
                  <div className="prose prose-neutral whitespace-normal">
                    <div className="max-w-none font-sans">
                      {/* Handle structured blocks */}
                      {('block' in item && item.block) && (
                        <StructuredBlockRenderer
                          block={item.block}
                          paragraphId={item.order}
                          sentencesById={sentencesById}
                          paragraphs={paragraphs}
                          onUpdateSentence={onUpdateSentence}
                          onAddNote={onAddNote}
                          handleSentenceClick={handleSentenceClick}
                          handleSentenceDoubleClick={handleSentenceDoubleClick}
                          mode="original-only"
                          editingSentenceId={editingSentenceId}
                          hoveredSentence={hoveredSentence}
                          setHoveredSentence={setHoveredSentence}
                          pinnedSentence={pinnedSentence}
                          setPinnedSentence={setPinnedSentence}
                          queryClient={queryClient}
                          toast={toast}
                          documentId={documentId}
                          textareaRef={textareaRef}
                          editedValue={editedValue}
                          setEditedValue={setEditedValue}
                          handleKeyDown={handleKeyDown}
                          handleSaveEdit={handleSaveEdit}
                          handleCancelEdit={handleCancelEdit}
                          handleAICoaching={handleAICoaching}
                          aiCoachingMutation={aiCoachingMutation}
                          showUpgradePrompt={showUpgradePrompt}
                          setLocation={setLocation}
                          showAiCoaching={showAiCoaching}
                          aiCoachingResult={aiCoachingResult}
                          handleApplyCoachingTranslation={handleApplyCoachingTranslation}
                          setShowAiCoaching={setShowAiCoaching}
                          editPopupPosition={editPopupPosition}
                          onOpenAIDrawer={onOpenAIDrawer}
                        />
                      )}

                      {/* Handle legacy paragraphs only when no structured blocks exist */}
                      {(item.type === 'paragraph' && 'paragraph' in item && item.paragraph &&
                        (!structuredBlocks || structuredBlocks.length === 0)) && (
                        <div className="paragraph-block mb-6">
                          {item.paragraph.title && (
                            <h3 className="text-xl font-semibold mb-3 text-foreground">{item.paragraph.title}</h3>
                          )}
                          <div className="text-foreground leading-relaxed">
                            {item.paragraph.sentences.map((sentence: Sentence, index: number) => {
                              const normalizedText = sentence.source.replace(/[\r\n]+/g, ' ').trim(); // Normalize text
                              return (
                                <span key={`source-${sentence.id}`} className="sentence-segment relative inline">
                                  <span
                                    tabIndex={0}
                                    role="button"
                                    aria-label={`원문: ${sentence.source?.slice(0, 50)}... - 클릭하여 상호작용하려면 Enter 키를 누르세요`}
                                    data-testid="source-sentence-trigger"
                                    className={cn(
                                      "cursor-pointer rounded px-1 -mx-1 transition-colors focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:outline-none",
                                      "selection:bg-gray-200 dark:selection:bg-gray-700",
                                      getSentenceHighlight(sentence.id, sentencesById).hasHighlight ? "bg-yellow-200/60 hover:bg-yellow-300/60 dark:bg-[#a68b00]/40 dark:hover:bg-[#a68b00]/60" : "hover:bg-gray-200/80 dark:hover:bg-gray-700/80",
                                      getSentenceNote(sentence.id, sentencesById) && "border-b border-solid border-blue-500 dark:border-blue-400",
                                      editingSentenceId === sentence.id && "bg-gray-200/70 dark:bg-gray-700/70",
                                      // Semibold corresponding sentence when pinned (clicked) - applies to both lanes
                                      pinnedSentence?.id === sentence.id && "font-semibold"
                                    )}
                                    onClick={(e) => handleSentenceClick(sentence, e, 'original')}
                                    onMouseEnter={() => setHoveredSentence({ id: sentence.id, lane: 'original' })}
                                    onMouseLeave={() => setHoveredSentence(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        handleSentenceClick(sentence, undefined, 'original');
                                      }
                                    }}
                                    data-sentence-id={sentence.id}
                                    id={`source-sentence-${sentence.id}`}
                                  >
                                    {normalizedText}
                                  </span>

                                  {/* Hover menu for source sentences */}
                                  <div
                                    id={`source-toolbar-${sentence.id}`}
                                    role="toolbar"
                                    aria-label="원문 문장 작업"
                                    className={cn(
                                      "hover-menu absolute top-full mt-1 right-0 flex gap-1 bg-background border rounded-lg shadow-lg p-2 z-50 min-w-max transition-all duration-300 ease-in-out",
                                      pinnedSentence?.id === sentence.id && pinnedSentence?.lane === 'original'
                                        ? "opacity-100 pointer-events-auto"
                                        : "opacity-0 pointer-events-none"
                                    )}
                                  >
                                    {/* Note button */}
                                    <button
                                      aria-label={getSentenceNote(sentence.id, sentencesById) ? "노트 편집" : "노트 추가"}
                                      data-testid="button-note-source"
                                      className={cn(
                                        "p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded text-xs flex items-center justify-center w-8 h-8 transition-colors",
                                        getSentenceNote(sentence.id, sentencesById) && "bg-blue-50 dark:bg-blue-900/30"
                                      )}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onAddNote?.(sentence);
                                      }}
                                      title={getSentenceNote(sentence.id, sentencesById) ? "노트 편집" : "노트 추가"}
                                    >
                                      <NotepadTextIcon
                                        aria-hidden="true"
                                        focusable={false}
                                        className={cn(
                                          "h-4 w-4 transition-colors",
                                          getSentenceNote(sentence.id, sentencesById)
                                            ? "text-slate-600 dark:text-blue-300"
                                            : "text-gray-500 hover:text-slate-600 dark:hover:text-blue-300"
                                        )} />
                                    </button>
                                  </div>

                                  {index < item.paragraph.sentences.length - 1 && " "}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Target Column for this item */}
                  <div className="prose prose-neutral whitespace-normal">
                    <div className="max-w-none font-sans"></div>
                    {/* Handle structured blocks with translation content */}
                    {('block' in item && item.block) && (
                      <>
                        {/* STRUCTURAL FIX: Headings/abstracts/document_title/abstract_body/abstract_label use unified sentence-level rendering via StructuredBlockRenderer */}
                        {(item.block.type === 'document_title' || item.block.type === 'heading' || item.block.type === 'abstract' || item.block.type === 'abstract_body' || item.block.type === 'abstract_label') && (
                          <StructuredBlockRenderer
                            block={item.block}
                            paragraphId={item.order}
                            sentencesById={sentencesById}
                            paragraphs={paragraphs}
                            onUpdateSentence={onUpdateSentence}
                            onAddNote={onAddNote}
                            handleSentenceClick={handleSentenceClick}
                            handleSentenceDoubleClick={handleSentenceDoubleClick}
                            mode="translation-only"
                            editingSentenceId={editingSentenceId}
                            hoveredSentence={hoveredSentence}
                            setHoveredSentence={setHoveredSentence}
                            pinnedSentence={pinnedSentence}
                            setPinnedSentence={setPinnedSentence}
                            queryClient={queryClient}
                            toast={toast}
                            documentId={documentId}
                            textareaRef={textareaRef}
                            editedValue={editedValue}
                            setEditedValue={setEditedValue}
                            handleKeyDown={handleKeyDown}
                            handleSaveEdit={handleSaveEdit}
                            handleCancelEdit={handleCancelEdit}
                            handleAICoaching={handleAICoaching}
                            aiCoachingMutation={aiCoachingMutation}
                            showUpgradePrompt={showUpgradePrompt}
                            setLocation={setLocation}
                            showAiCoaching={showAiCoaching}
                            aiCoachingResult={aiCoachingResult}
                            handleApplyCoachingTranslation={handleApplyCoachingTranslation}
                            setShowAiCoaching={setShowAiCoaching}
                            editPopupPosition={editPopupPosition}
                            onOpenAIDrawer={onOpenAIDrawer}
                          />
                        )}

                        {/* Figures and Tables - same content for translation side */}
                        {(item.block.type === 'figure' || item.block.type === 'table' || item.block.type === 'image') && (
                          <StructuredBlockRenderer
                            block={item.block}
                            paragraphId={item.order}
                            sentencesById={sentencesById}
                            paragraphs={paragraphs}
                            onUpdateSentence={onUpdateSentence}
                            onAddNote={onAddNote}
                            handleSentenceClick={handleSentenceClick}
                            handleSentenceDoubleClick={handleSentenceDoubleClick}
                            mode="translation-only"
                            editingSentenceId={editingSentenceId}
                            hoveredSentence={hoveredSentence}
                            setHoveredSentence={setHoveredSentence}
                            pinnedSentence={pinnedSentence}
                            setPinnedSentence={setPinnedSentence}
                            queryClient={queryClient}
                            toast={toast}
                            documentId={documentId}
                            textareaRef={textareaRef}
                            editedValue={editedValue}
                            setEditedValue={setEditedValue}
                            handleKeyDown={handleKeyDown}
                            handleSaveEdit={handleSaveEdit}
                            handleCancelEdit={handleCancelEdit}
                            handleAICoaching={handleAICoaching}
                            aiCoachingMutation={aiCoachingMutation}
                            showUpgradePrompt={showUpgradePrompt}
                            setLocation={setLocation}
                            showAiCoaching={showAiCoaching}
                            aiCoachingResult={aiCoachingResult}
                            handleApplyCoachingTranslation={handleApplyCoachingTranslation}
                            setShowAiCoaching={setShowAiCoaching}
                            editPopupPosition={editPopupPosition}
                            onOpenAIDrawer={onOpenAIDrawer}
                          />
                        )}

                        {/* Paragraphs - use StructuredBlockRenderer for translation-only mode */}
                        {item.block.type === 'paragraph' && (
                          <StructuredBlockRenderer
                            block={item.block}
                            paragraphId={item.order}
                            sentencesById={sentencesById}
                            paragraphs={paragraphs}
                            onUpdateSentence={onUpdateSentence}
                            onAddNote={onAddNote}
                            handleSentenceClick={handleSentenceClick}
                            handleSentenceDoubleClick={handleSentenceDoubleClick}
                            mode="translation-only"
                            editingSentenceId={editingSentenceId}
                            hoveredSentence={hoveredSentence}
                            setHoveredSentence={setHoveredSentence}
                            pinnedSentence={pinnedSentence}
                            setPinnedSentence={setPinnedSentence}
                            queryClient={queryClient}
                            toast={toast}
                            documentId={documentId}
                            textareaRef={textareaRef}
                            editedValue={editedValue}
                            setEditedValue={setEditedValue}
                            handleKeyDown={handleKeyDown}
                            handleSaveEdit={handleSaveEdit}
                            handleCancelEdit={handleCancelEdit}
                            handleAICoaching={handleAICoaching}
                            aiCoachingMutation={aiCoachingMutation}
                            showUpgradePrompt={showUpgradePrompt}
                            setLocation={setLocation}
                            showAiCoaching={showAiCoaching}
                            aiCoachingResult={aiCoachingResult}
                            handleApplyCoachingTranslation={handleApplyCoachingTranslation}
                            setShowAiCoaching={setShowAiCoaching}
                            editPopupPosition={editPopupPosition}
                            onOpenAIDrawer={onOpenAIDrawer}
                          />
                        )}

                        {/* Metadata blocks - non-translatable, display only */}
                        {(item.block.type === 'doi' || item.block.type === 'journal' || item.block.type === 'author' || item.block.type === 'affiliation' || item.block.type === 'reference_block') && (
                          <StructuredBlockRenderer
                            block={item.block}
                            paragraphId={item.order}
                            sentencesById={sentencesById}
                            paragraphs={paragraphs}
                            mode="translation-only"
                            queryClient={queryClient}
                            toast={toast}
                            documentId={documentId}
                          />
                        )}
                      </>
                    )}

                    {/* Handle legacy paragraphs only when no structured blocks exist */}
                    {(item.type === 'paragraph' && 'paragraph' in item && item.paragraph &&
                      (!structuredBlocks || structuredBlocks.length === 0)) && (
                      <div className="paragraph-block mb-6">
                        {item.paragraph.title && (
                          <h3 className="text-xl font-semibold mb-3 text-gray-900">{item.paragraph.title}</h3>
                        )}
                        <div className="text-foreground leading-relaxed whitespace-normal">
                          {item.paragraph.sentences.map((sentence: Sentence, index: number) => {
                            const normalizedText = (getDisplayTranslation(sentence) || sentence.source || '')
                              .replace(/[\u000B\u000C\r\n]+/g, ' ')
                              .replace(/[ \t]{2,}/g, ' ')
                              .trim();
                            return (
                              <span key={`target-legacy-${sentence.id}`} className="sentence-segment relative inline">
                                {editingSentenceId === sentence.id ? (
                                  <span className="relative inline">
                                    <span 
                                      className="inline-block"
                                      style={{
                                        width: 'min(350px, calc(100vw - 450px))',
                                        maxWidth: 'calc(100vw - 450px)',
                                      }}
                                    >
                                      <span className="relative shadow-sm rounded-md bg-accent/20 block">
                                        <Textarea
                                          ref={textareaRef}
                                          value={editedValue}
                                          onChange={(e) => setEditedValue(e.target.value)}
                                          onKeyDown={handleKeyDown}
                                          className="w-full p-2 pb-10 resize-none border-0 shadow-none bg-transparent font-sans text-base min-h-[80px]"
                                          placeholder={t('viewer.enterTranslation')}
                                        />
                                        <span className="absolute bottom-2 right-2 flex gap-1">
                                          <Button size="icon" variant="ghost" onClick={handleSaveEdit} className="h-7 w-7" title={t('viewer.save')}>
                                            <Check className="h-4 w-4" />
                                          </Button>
                                          <Button size="icon" variant="ghost" onClick={handleCancelEdit} className="h-7 w-7" title={t('common.cancel')}>
                                            <X className="h-4 w-4" />
                                          </Button>
                                        </span>
                                      </span>
                                    </span>
                                  </span>
                                ) : (
                                  <span
                                    tabIndex={0}
                                    role="button"
                                    aria-label={`번역: ${getDisplayTranslation(sentence)?.slice(0, 50) || sentence.source?.slice(0, 50) || '원문 없음'}... - 북마크하거나 노트를 추가하려면 Enter 키를 누르세요`}
                                    data-testid="target-legacy-sentence-trigger"
                                    className={cn(
                                      "inline align-baseline cursor-pointer rounded px-1 -mx-1 transition-colors focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:outline-none",
                                      "selection:bg-gray-200 dark:selection:bg-gray-700",
                                      !getDisplayTranslation(sentence) && "text-muted-foreground/50 italic",
                                      // Use highlight system instead of isScrapped
                                      getSentenceHighlight(sentence.id, sentencesById).hasHighlight ? "bg-yellow-200/60 hover:bg-yellow-300/60 dark:bg-[#a68b00]/40 dark:hover:bg-[#a68b00]/60" : "hover:bg-gray-200/80 dark:hover:bg-gray-700/80",
                                      getSentenceNote(sentence.id, sentencesById) && "border-b border-solid border-blue-500 dark:border-blue-400",
                                      editingSentenceId === sentence.id && "bg-gray-200/70 dark:bg-gray-700/70",
                                      // Semibold corresponding sentence when pinned (clicked) - applies to both lanes
                                      pinnedSentence?.id === sentence.id && "font-semibold"
                                    )}
                                    onClick={(e) => handleSentenceClick(sentence, e, 'translation')}
                                    onMouseEnter={() => setHoveredSentence({ id: sentence.id, lane: 'translation' })}
                                    onMouseLeave={() => setHoveredSentence(null)}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        handleSentenceClick(sentence, undefined, 'translation');
                                      }
                                    }}
                                    data-sentence-id={sentence.id}
                                    id={`target-legacy-sentence-${sentence.id}`}
                                  >
                                    {normalizedText}
                                  </span>
                                )}

                                {/* Hover menu for legacy target sentences */}
                                <span
                                  id={`target-legacy-toolbar-${sentence.id}`}
                                  role="toolbar"
                                  aria-label="번역 문장 작업"
                                  className={cn(
                                    "hover-menu absolute top-full mt-1 right-0 flex gap-1 bg-background border rounded-lg shadow-lg p-2 z-50 min-w-max transition-all duration-300 ease-in-out",
                                    pinnedSentence?.id === sentence.id && pinnedSentence?.lane === 'translation'
                                      ? "opacity-100 pointer-events-auto"
                                      : "opacity-0 pointer-events-none"
                                  )}
                                >
                                  {/* Note button */}
                                  <button
                                    aria-label={getSentenceNote(sentence.id, sentencesById) ? "노트 편집" : "노트 추가"}
                                    data-testid="button-note-legacy"
                                    className={cn(
                                      "p-1.5 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded text-xs flex items-center justify-center w-8 h-8 transition-colors",
                                      getSentenceNote(sentence.id, sentencesById) && "bg-blue-50 dark:bg-blue-900/30"
                                    )}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onAddNote?.(sentence);
                                    }}
                                    title={getSentenceNote(sentence.id, sentencesById) ? "노트 편집" : "노트 추가"}
                                  >
                                    <NotepadTextIcon
                                      aria-hidden="true"
                                      focusable={false}
                                      className={cn(
                                        "h-4 w-4 transition-colors",
                                        getSentenceNote(sentence.id, sentencesById)
                                          ? "text-slate-600 dark:text-blue-300"
                                          : "text-gray-500 hover:text-slate-600 dark:hover:text-blue-300"
                                      )} />
                                  </button>

                                  {/* Edit button for translation - only show when not in original-only mode */}
                                  {(mode === "side-by-side" || mode === "translation-only") && (
                                    <button
                                      aria-label="번역 편집"
                                      data-testid="button-edit-legacy"
                                      className="p-1.5 hover:bg-gray-50 dark:hover:bg-gray-800 rounded text-xs flex items-center justify-center w-8 h-8 transition-colors"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleSentenceDoubleClick(sentence);
                                      }}
                                      title={isTranslationEdited(sentence) ? "번역 편집 (수정됨)" : "번역 편집"}
                                    >
                                      <Edit3
                                        aria-hidden="true"
                                        focusable={false}
                                        className={cn(
                                          "h-4 w-4 transition-colors",
                                          isTranslationEdited(sentence)
                                            ? "text-gray-900 dark:text-gray-100 stroke-[2.5]"
                                            : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                                        )} />
                                    </button>
                                  )}

                                  {/* AI button - opens AI drawer for explanation */}
                                  <button
                                    aria-label="AI 도우미"
                                    data-testid="button-ai-hover-legacy"
                                    className="p-1.5 hover:bg-brand-amber/10 dark:hover:bg-brand-amber/20 rounded text-xs flex items-center justify-center w-8 h-8 transition-colors"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setHoveredSentence(null);
                                      setPinnedSentence(null);
                                      onOpenAIDrawer?.(sentence, "hover");
                                    }}
                                    title="AI 도우미"
                                  >
                                    <Bot
                                      aria-hidden="true"
                                      focusable={false}
                                      className="h-4 w-4 text-brand-amber hover:text-brand-amber/80 dark:hover:text-brand-amber" />
                                  </button>
                                </span>

                                {index < item.paragraph.sentences.length - 1 && " "}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </section>
              ))
              }
            </div>
          ) : (
            // Single column view for original-only and translation-only modes
            <div
              className="prose-like document-content whitespace-normal"
              style={{
                lineHeight: lineHeight
              }}
            >
              {mergedContent.map((item, itemIndex) => {
                console.log('[SingleColumn Render] Item:', item.type, 'id:', item.id, 'has block:', 'block' in item, 'has paragraph:', 'paragraph' in item);
                console.log('[SingleColumn Render] Mode:', mode, 'StructuredBlocks length:', structuredBlocks?.length || 0);
                console.log('[SingleColumn Render] Item details:', item);

                // Handle structured blocks (headings, figures, tables, paragraphs)
                if ('block' in item && item.block) {
                  // STRUCTURAL FIX: Headings/abstracts/document_title/abstract_body use unified sentence-level rendering via StructuredBlockRenderer
                  if (item.block.type === 'document_title' || item.block.type === 'heading' || item.block.type === 'abstract' || item.block.type === 'abstract_body' || item.block.type === 'abstract_label') {
                    return (
                      <StructuredBlockRenderer
                        key={`single-heading-${item.id}`}
                        block={item.block}
                        paragraphId={item.order}
                        sentencesById={sentencesById}
                        paragraphs={paragraphs}
                        onUpdateSentence={onUpdateSentence}
                        onAddNote={onAddNote}
                        handleSentenceClick={handleSentenceClick}
                        handleSentenceDoubleClick={handleSentenceDoubleClick}
                        mode={mode}
                        editingSentenceId={editingSentenceId}
                        hoveredSentence={hoveredSentence}
                        setHoveredSentence={setHoveredSentence}
                        pinnedSentence={pinnedSentence}
                        setPinnedSentence={setPinnedSentence}
                        queryClient={queryClient}
                        toast={toast}
                        documentId={documentId}
                        textareaRef={textareaRef}
                        editedValue={editedValue}
                        setEditedValue={setEditedValue}
                        handleKeyDown={handleKeyDown}
                        handleSaveEdit={handleSaveEdit}
                        handleCancelEdit={handleCancelEdit}
                        showCorrespondingTooltip={showHoverTooltip}
                        handleAICoaching={handleAICoaching}
                        aiCoachingMutation={aiCoachingMutation}
                        showUpgradePrompt={showUpgradePrompt}
                        setLocation={setLocation}
                        showAiCoaching={showAiCoaching}
                        aiCoachingResult={aiCoachingResult}
                        handleApplyCoachingTranslation={handleApplyCoachingTranslation}
                        setShowAiCoaching={setShowAiCoaching}
                        editPopupPosition={editPopupPosition}
                        onOpenAIDrawer={onOpenAIDrawer}
                      />
                    );
                  }

                  // Figures and Tables - same for all modes
                  if (item.block.type === 'figure' || item.block.type === 'table') {
                    return (
                      <StructuredBlockRenderer
                        key={`single-block-${item.id}`}
                        block={item.block}
                        paragraphId={item.order}
                        sentencesById={sentencesById}
                        paragraphs={paragraphs}
                        onUpdateSentence={onUpdateSentence}
                        onAddNote={onAddNote}
                        handleSentenceClick={handleSentenceClick}
                        handleSentenceDoubleClick={handleSentenceDoubleClick}
                        mode={mode}
                        editingSentenceId={editingSentenceId}
                        hoveredSentence={hoveredSentence}
                        setHoveredSentence={setHoveredSentence}
                        pinnedSentence={pinnedSentence}
                        setPinnedSentence={setPinnedSentence}
                        queryClient={queryClient}
                        toast={toast}
                        documentId={documentId}
                        textareaRef={textareaRef}
                        editedValue={editedValue}
                        setEditedValue={setEditedValue}
                        handleKeyDown={handleKeyDown}
                        handleSaveEdit={handleSaveEdit}
                        handleCancelEdit={handleCancelEdit}
                        showCorrespondingTooltip={showHoverTooltip}
                        handleAICoaching={handleAICoaching}
                        aiCoachingMutation={aiCoachingMutation}
                        showUpgradePrompt={showUpgradePrompt}
                        setLocation={setLocation}
                        showAiCoaching={showAiCoaching}
                        aiCoachingResult={aiCoachingResult}
                        handleApplyCoachingTranslation={handleApplyCoachingTranslation}
                        setShowAiCoaching={setShowAiCoaching}
                        editPopupPosition={editPopupPosition}
                        onOpenAIDrawer={onOpenAIDrawer}
                      />
                    );
                  }

                  // Paragraphs - use StructuredBlockRenderer for all modes (consistent with side-by-side)
                  if (item.block.type === 'paragraph') {
                    return (
                      <StructuredBlockRenderer
                        key={`single-paragraph-${item.id}`}
                        block={item.block}
                        paragraphId={item.order}
                        sentencesById={sentencesById}
                        paragraphs={paragraphs}
                        onUpdateSentence={onUpdateSentence}
                        onAddNote={onAddNote}
                        handleSentenceClick={handleSentenceClick}
                        handleSentenceDoubleClick={handleSentenceDoubleClick}
                        mode={mode}
                        editingSentenceId={editingSentenceId}
                        hoveredSentence={hoveredSentence}
                        setHoveredSentence={setHoveredSentence}
                        pinnedSentence={pinnedSentence}
                        setPinnedSentence={setPinnedSentence}
                        queryClient={queryClient}
                        toast={toast}
                        documentId={documentId}
                        textareaRef={textareaRef}
                        editedValue={editedValue}
                        setEditedValue={setEditedValue}
                        handleKeyDown={handleKeyDown}
                        handleSaveEdit={handleSaveEdit}
                        handleCancelEdit={handleCancelEdit}
                        showCorrespondingTooltip={showHoverTooltip}
                        handleAICoaching={handleAICoaching}
                        aiCoachingMutation={aiCoachingMutation}
                        showUpgradePrompt={showUpgradePrompt}
                        setLocation={setLocation}
                        showAiCoaching={showAiCoaching}
                        aiCoachingResult={aiCoachingResult}
                        handleApplyCoachingTranslation={handleApplyCoachingTranslation}
                        setShowAiCoaching={setShowAiCoaching}
                        editPopupPosition={editPopupPosition}
                        onOpenAIDrawer={onOpenAIDrawer}
                      />
                    );
                  }

                  // Metadata blocks - non-translatable, display only
                  if (item.block.type === 'doi' || item.block.type === 'journal' || item.block.type === 'author' || item.block.type === 'affiliation' || item.block.type === 'reference_block') {
                    return (
                      <StructuredBlockRenderer
                        key={`single-metadata-${item.id}`}
                        block={item.block}
                        paragraphId={item.order}
                        sentencesById={sentencesById}
                        paragraphs={paragraphs}
                        mode={mode}
                        queryClient={queryClient}
                        toast={toast}
                        documentId={documentId}
                      />
                    );
                  }
                }

                return null;
              })}
            </div>
          )}
        </div>

      </div>

      {/* Glossary Tooltip for text selection - only show in original-only or side-by-side mode */}
      {selectedText && selectionPosition && mode !== "translation-only" && (
        <GlossaryTooltip
          selectedText={selectedText}
          position={selectionPosition}
          onClose={handleCloseGlossaryTooltip}
          contextSentence={contextSentence}
          documentId={documentId}
        />
      )}
    </TooltipProvider>
  );
}