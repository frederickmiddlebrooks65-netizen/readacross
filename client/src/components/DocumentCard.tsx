import React, { useState, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDistanceToNowWithTimezone, formatShortDate } from "@/lib/dateUtils";
import { useTimezone } from "@/hooks/useTimezone";
import { useLocation } from "wouter";
import { Clock, FileText, BookOpen, X, Plus, GraduationCap, Timer, Archive, RotateCcw, Trash2, Check, BookmarkPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme } from "@/components/ThemeProvider";
import { getCardColors, determineCategory, isDarkMode, type Category } from "@/lib/colorUtils";
import { useTranslation, useLanguage } from "@/i18n";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

interface DocumentCardProps {
  document: any;
  onDelete?: (id: number) => void;
  onAddToLibrary?: (document: any) => void;
  onArchive?: (id: number) => void;
  onRestore?: (id: number) => void;
  isPublic?: boolean;
  userDocuments?: any[];
  viewMode?: 'grid' | 'list';
  isExploreMode?: boolean;
  docStats?: { glossaryCount: number; notesCount: number } | null;
}

// Color system now handled by colorUtils.ts for WCAG AA compliance



export default function DocumentCard({ document, onDelete, onAddToLibrary, onArchive, onRestore, isPublic = false, userDocuments = [], viewMode = 'grid', isExploreMode = false, docStats = null }: DocumentCardProps) {
  const [, setLocation] = useLocation();
  const [isHovered, setIsHovered] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    type: 'delete' | 'archive';
  }>({ open: false, type: 'delete' });
  const { theme } = useTheme();
  const { t } = useTranslation();
  const { language: uiLanguage } = useLanguage();
  const { timezone } = useTimezone();

  const isAlreadyInLibrary = (isPublic || isExploreMode) && userDocuments.some(userDoc => 
    userDoc.title === document.title && userDoc.author === document.author
  );

  const handleClick = () => {
    setLocation(`/viewer/${document.id}`);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onDelete && !isPublic && document.isArchived) {
      setConfirmDialog({ open: true, type: 'delete' });
    }
  };

  const handleArchive = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onArchive && !isPublic && !document.isArchived) {
      setConfirmDialog({ open: true, type: 'archive' });
    }
  };

  const handleConfirmAction = () => {
    if (confirmDialog.type === 'delete' && onDelete) {
      onDelete(document.id);
    } else if (confirmDialog.type === 'archive' && onArchive) {
      onArchive(document.id);
    }
    setConfirmDialog({ open: false, type: 'delete' });
  };

  const handleRestore = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onRestore && !isPublic && document.isArchived) {
      onRestore(document.id);
    }
  };

  const handleAddToLibrary = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (onAddToLibrary && (isPublic || isExploreMode) && !isAlreadyInLibrary && !isAdding) {
      setIsAdding(true);
      try {
        await onAddToLibrary(document);
      } finally {
        setIsAdding(false);
      }
    }
  };

  const lastReadText = formatDistanceToNowWithTimezone(new Date(document.createdAt), { timezone, language: uiLanguage, addSuffix: true });
  const translateProgress = document.progress || 0;

  // Check if this is an RSS feed document
  const isRSSDocument = 'feedId' in document && document.feedId;

  // Memoize color calculation for performance with WCAG AA compliant colors
  const cardColor = useMemo(() => {
    const category = determineCategory(document);
    const darkMode = isDarkMode(theme);
    return getCardColors(category, darkMode);
  }, [document, theme]);

  // Determine document category for display and styling
  const documentCategory = determineCategory(document);
  const isAcademicPaper = documentCategory === 'Academic';
  const isNewsArticle = documentCategory === 'News';
  const isEssayOpinion = documentCategory === 'Essays' || documentCategory === 'Opinion';
  const isLiterature = documentCategory === 'Literature';

  // Determine which progress to show (translation progress is what we have)
  const progressToShow = translateProgress;
  const progressLabel = translateProgress > 0 ? '번역' : null;

  // Get source label for meta display
  const getSourceLabel = () => {
    // RSS documents - prioritize feedAlias or source
    if (isRSSDocument) {
      // Check for various RSS feed name properties
      if ((document as any).feedAlias && (document as any).feedAlias !== 'RSS Feed') {
        return (document as any).feedAlias;
      }
      if ((document as any).feedTitle && (document as any).feedTitle !== 'RSS Feed') {
        return (document as any).feedTitle;
      }
      if ((document as any).rssTitle && (document as any).rssTitle !== 'RSS Feed') {
        return (document as any).rssTitle;
      }
      // Check if we have feed title or alias from feed relation
      if ((document as any).feed?.title && (document as any).feed.title !== 'RSS Feed') {
        return (document as any).feed.title;
      }
      if ((document as any).feed?.alias && (document as any).feed.alias !== 'RSS Feed') {
        return (document as any).feed.alias;
      }
      // Check if document.source contains the RSS feed title
      if (document.source && document.source !== 'RSS' && document.source !== 'RSS Feed') {
        return document.source;
      }
      // Fallback to RSS
      return t('source.rss');
    }

    // System sources - keep original names (proper nouns should not be translated)
    if (document.source === "arXiv") return "arXiv";
    if (document.source === "Project Gutenberg") return "Project Gutenberg";
    if (document.source === "The Guardian") return "The Guardian";
    if (document.source === "NPR") return "NPR";

    // If document has any other source, use it
    if (document.source) {
      return document.source;
    }

    // Check sourceType for explore vs uploaded documents
    if (document.sourceType === "explore") {
      return t('source.explore');
    }

    // For saved documents without specific source
    if ('savedAt' in document) {
      return t('source.saved');
    }

    return t('source.upload');
  };

  // Calculate remaining days for public documents
  const getRemainingDays = () => {
    if (!isPublic || !document.expiresAt) return null;

    const now = new Date();
    const expiryDate = new Date(document.expiresAt);
    const diffTime = expiryDate.getTime() - now.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    return diffDays > 0 ? diffDays : 0;
  };

  const remainingDays = getRemainingDays();

  // Get source badge info - now using monotone colors
  const getSourceBadge = (source: string) => {
    if (source === "arXiv") {
      return { label: "arXiv", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200" };
    }
    if (source === "Project Gutenberg") {
      return { label: "Gutenberg", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200" };
    }
    if (source === "The Guardian") {
      return { label: "Guardian", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200" };
    }
    if (source === "NPR") {
      return { label: "NPR", color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200" };
    }

    return null;
  };

  // Get publication date for news articles
  const getPublicationDate = () => {
    if (isNewsArticle && document.createdAt) {
      const date = new Date(document.createdAt);
      return date.toLocaleDateString('ko-KR', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      });
    }
    return null;
  };

  // Format date as MM/DD/YYYY
  const getFormattedDate = () => {
    const date = new Date(document.createdAt);
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${day}/${year}`;
  };

  // Get time display: relative time for <24h, date for older
  const getRelativeTime = () => {
    const now = new Date();
    const date = new Date(document.createdAt);
    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));

    // Within 24 hours: show relative time
    if (diffHours < 24) {
      if (diffHours > 0) {
        return t('common.hoursAgo', { count: diffHours });
      } else {
        return t('common.minutesAgo', { count: Math.max(1, diffMinutes) });
      }
    }
    
    // More than 24 hours: show date
    return formatShortDate(date, { timezone, language: uiLanguage });
  };

  // Open original article in new tab for news content
  const handleOpenOriginal = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (document.originalUrl) {
      window.open(document.originalUrl, '_blank');
    }
  };

  // List view layout
  if (viewMode === 'list') {
    return (
      <div 
        className={cn(
          "group cursor-pointer flex items-center justify-between py-3 px-4 rounded-lg transition-all duration-200 hover:bg-muted/50 border border-transparent hover:border-border",
          document.isArchived && "opacity-70 grayscale"
        )}
        onClick={handleClick}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="flex-1 min-w-0">
          <h3 className={cn(
            "card-title font-sans font-semibold text-[15px] leading-[1.4] text-brand-ink group-hover:text-brand-amber transition-colors truncate",
            document.isArchived && "opacity-60"
          )}>
            {document.title}
          </h3>
          <span className="truncate text-[12px] text-muted-foreground mt-0.5 block">
            {getSourceLabel()}
          </span>
        </div>

        <div className="flex-shrink-0 ml-4 flex items-center gap-4 justify-end">
          {!isPublic && !isExploreMode && docStats && docStats.notesCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400 flex-shrink-0">
              <BookmarkPlus className="h-2.5 w-2.5" />
              {t('library.notesCountBadge').replace('{count}', String(docStats.notesCount))}
            </span>
          )}

          {!isPublic && !isExploreMode && translateProgress > 0 && (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <div className="w-16 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full rounded-full bg-blue-500 dark:bg-blue-400 transition-all"
                  style={{ width: `${Math.max(translateProgress, 3)}%` }}
                />
              </div>
              <span className="text-[11px] text-muted-foreground tabular-nums w-8 text-right">
                {translateProgress}%
              </span>
            </div>
          )}

          <span className="flex items-center gap-1 flex-shrink-0 text-[10px] text-slate-400 font-light">
            <Clock className="h-2.5 w-2.5" />
            {getRelativeTime()}
          </span>

          <div className={cn(
            "flex items-center gap-1 transition-opacity duration-200",
            "opacity-0 group-hover:opacity-100"
          )}>
            {onAddToLibrary && (isPublic || isExploreMode) && (
              <>
                {isAlreadyInLibrary ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 gap-1 text-xs cursor-default"
                    disabled
                    title={t('library.inLibrary')}
                  >
                    <Check className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">{t('library.inLibrary')}</span>
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 gap-1 text-xs hover:bg-primary/10 hover:text-primary transition-colors"
                    disabled={isAdding}
                    onClick={handleAddToLibrary}
                    title={t('library.addToLibrary')}
                  >
                    {isAdding ? (
                      <>
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
                        <span className="hidden sm:inline">{t('common.saving')}</span>
                      </>
                    ) : (
                      <>
                        <Plus className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{t('library.addToLibrary')}</span>
                      </>
                    )}
                  </Button>
                )}
              </>
            )}

            {!isPublic && !isExploreMode && (
              <>
                {document.isArchived ? (
                  <>
                    {onRestore && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 p-0 rounded-md hover:scale-105 transition-all"
                        onClick={handleRestore}
                        title={t('library.restore')}
                        aria-label={t('library.restore')}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {onDelete && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 w-7 p-0 rounded-md text-destructive hover:bg-destructive hover:text-destructive-foreground hover:scale-105 transition-all"
                        onClick={handleDelete}
                        title={t('library.permanentDelete')}
                        aria-label={t('library.permanentDelete')}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </>
                ) : (
                  onArchive && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 w-7 p-0 rounded-md hover:scale-105 transition-all"
                      onClick={handleArchive}
                      title={t('library.archive')}
                      aria-label={t('library.archive')}
                    >
                      <Archive className="h-3.5 w-3.5" />
                    </Button>
                  )
                )}
              </>
            )}
          </div>
        </div>

        <ConfirmDialog
          open={confirmDialog.open}
          onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}
          title={confirmDialog.type === 'delete'
            ? t('library.permanentDelete')
            : t('library.archive')}
          description={confirmDialog.type === 'delete'
            ? t('library.confirmDelete', { title: document.title })
            : t('library.confirmArchive', { title: document.title })}
          confirmLabel={confirmDialog.type === 'delete'
            ? t('common.delete')
            : t('library.archive')}
          cancelLabel={t('common.cancel')}
          onConfirm={handleConfirmAction}
          variant={confirmDialog.type === 'delete' ? 'destructive' : 'default'}
        />
      </div>
    );
  }

  // Grid view layout (Typography-centered design only)
  return (
    <div 
      className="group cursor-pointer transform transition-all duration-300 ease-in-out hover:-translate-y-1 relative w-full"
      onClick={handleClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        willChange: isHovered ? 'transform' : 'auto'
      }}
    >
      {/* Card with Typography-centered Design */}
      <Card
        className={cn(
          "relative overflow-hidden border-0 rounded-xl shadow-[0_4px_20px_rgba(0,0,0,0.06)] group-hover:shadow-[0_12px_40px_rgba(0,0,0,0.12)] transition-all duration-300 ease-in-out",
          document.isArchived && "opacity-70 grayscale"
        )}
      >
        <div className="aspect-[3/4] relative flex flex-col bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-900">
          {/* Progress bar at top if available */}
          {progressToShow > 0 && (
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-black/20 z-10">
              <div
                className="h-full bg-current opacity-60 transition-all duration-300"
                style={{ width: `${progressToShow}%` }}
              />
            </div>
          )}

          {/* Grid Card Layout - New Design */}
          <article 
            className="p-4 flex flex-col h-full rounded-lg"
          >
            {/* TOP SECTION: Action Button - top-right (hover only) */}
            <div className={cn(
              "flex items-start justify-end mb-2 transition-opacity duration-300",
              isHovered ? "opacity-100" : "opacity-0"
            )}>
              {onAddToLibrary && (isPublic || isExploreMode) && (
                <div>
                  {isAlreadyInLibrary ? (
                    <Badge variant="secondary" className="text-[10px]">
                      {t('library.inLibrary')}
                    </Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 hover:bg-[hsl(var(--sage-subtle))] dark:hover:bg-slate-800/50"
                      onClick={handleAddToLibrary}
                      disabled={isAdding}
                      title={t('library.addToLibrary')}
                      aria-label={t('library.addToLibrary')}
                    >
                      {isAdding ? (
                        <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                      ) : (
                        <Plus className="h-3.5 w-3.5 text-forest dark:text-slate-400" />
                      )}
                    </Button>
                  )}
                </div>
              )}
              {!isPublic && !isExploreMode && (
                <div>
                  {document.isArchived ? (
                    <div className="flex gap-1">
                      {onRestore && (
                        <button
                          onClick={handleRestore}
                          className="size-6 grid place-items-center rounded-md border bg-background text-muted-foreground hover:text-foreground transition-colors"
                          title={t('library.restore')}
                          aria-label={t('library.restore')}
                        >
                          <RotateCcw className="size-[14px]" />
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={handleDelete}
                          className="size-6 grid place-items-center rounded-md border bg-background text-destructive hover:text-destructive-foreground hover:bg-destructive transition-colors"
                          title={t('library.permanentDelete')}
                          aria-label={t('library.permanentDelete')}
                        >
                          <Trash2 className="size-[14px]" />
                        </button>
                      )}
                    </div>
                  ) : (
                    onArchive && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 hover:bg-[hsl(var(--sage-subtle))] dark:hover:bg-slate-800/50"
                        onClick={handleArchive}
                        title={t('library.archive')}
                        aria-label={t('library.archive')}
                      >
                        <X className="h-3.5 w-3.5 text-forest dark:text-slate-400" />
                      </Button>
                    )
                  )
                }
                </div>
              )}
            </div>


            {/* MIDDLE SECTION: Title + Source (left aligned, grows to fill space) */}
            <div className="flex-1 flex flex-col justify-center text-left">
              <h3 
                className={cn(
                  "card-title font-sans font-semibold text-lg text-brand-ink dark:text-slate-100 group-hover:text-forest dark:group-hover:text-slate-300 transition-colors duration-300 line-clamp-3 leading-[1.4]",
                  document.isArchived && "opacity-60"
                )}
                dir="auto"
                title={document.title}
              >
                {document.title}
              </h3>
              
              {/* Source below title */}
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 truncate">
                {getSourceLabel()}
              </p>
            </div>

            {/* BOTTOM SECTION: Activity data right-aligned, 2 rows */}
            <div className="mt-2 space-y-1">
              {!isPublic && !isExploreMode && (translateProgress > 0 || (docStats && docStats.notesCount > 0)) && (
                <div className="flex items-center gap-2 justify-end">
                  {translateProgress > 0 && (
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                        <div
                          className="h-full rounded-full bg-blue-500 dark:bg-blue-400"
                          style={{ width: `${Math.max(translateProgress, 3)}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {translateProgress}%
                      </span>
                    </div>
                  )}
                  {docStats && docStats.notesCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <BookmarkPlus className="h-2.5 w-2.5" />
                      {t('library.notesCountBadge').replace('{count}', String(docStats.notesCount))}
                    </span>
                  )}
                </div>
              )}
              <div className="flex items-center justify-end">
                <span className="flex items-center gap-1 text-[10px] text-slate-400 dark:text-slate-500 font-light">
                  <Clock className="h-2.5 w-2.5" />
                  {getRelativeTime()}
                </span>
              </div>
            </div>
          </article>
        </div>
      </Card>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}
        title={confirmDialog.type === 'delete'
          ? t('library.permanentDelete')
          : t('library.archive')}
        description={confirmDialog.type === 'delete'
          ? t('library.confirmDelete', { title: document.title })
          : t('library.confirmArchive', { title: document.title })}
        confirmLabel={confirmDialog.type === 'delete'
          ? t('common.delete')
          : t('library.archive')}
        cancelLabel={t('common.cancel')}
        onConfirm={handleConfirmAction}
        variant={confirmDialog.type === 'delete' ? 'destructive' : 'default'}
      />
    </div>
  );
}