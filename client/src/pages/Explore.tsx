import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Layout from "@/components/Layout";
import PageShell from "@/components/layout/PageShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Card } from "@/components/ui/card";
import {
  BookOpen,
  Search,
  Plus,
  Settings,
  ArrowUpDown,
  Filter,
  Grid3X3,
  List,
  Compass,
  Pencil,
  Trash2,
  Clock,
  Sparkles,
  Check,
  Timer,
  BarChart3,
  Brain,
  Hash,
  ChevronRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/i18n";
import { extractMeaningfulSnippet, extractRandomSnippet, truncateSnippet } from "@/lib/snippetExtractor";
import { cn } from "@/lib/utils";

type ViewMode = "grid" | "list";
type SortOption = "recent" | "uploaded" | "name" | "popularity";

function getCategoryLabel(category: string | undefined, t: any): string {
  const categoryMap: { [key: string]: string } = {
    'News': 'category.news',
    'Literature': 'category.literature',
    'Academic': 'category.academic',
    'Opinion': 'category.opinion',
    'Other': 'category.other',
  };
  
  if (!category) return t('explore.general');
  return t(categoryMap[category] || 'explore.general');
}

import Pagination from "@/components/common/Pagination";

function estimateReadTime(doc: any): number {
  if (doc.wordCount) {
    return Math.max(1, Math.round(doc.wordCount / 200));
  }
  const content = doc.snippetContent || doc.content || doc.rawContent || '';
  const wordCount = content.split(/\s+/).length;
  return Math.max(1, Math.round(wordCount / 200));
}

function estimateDifficulty(doc: any): 'high' | 'mid' | 'low' {
  if (doc.difficulty) {
    if (doc.difficulty === 'advanced') return 'high';
    if (doc.difficulty === 'intermediate') return 'mid';
    if (doc.difficulty === 'beginner') return 'low';
  }
  if (doc.category === 'Academic' || doc.source === 'arXiv') return 'high';
  if (doc.category === 'Literature' || doc.source === 'Project Gutenberg') return 'mid';
  if (doc.category === 'Opinion' || doc.category === 'News') return 'low';
  return 'mid';
}

function estimateVocabLevel(doc: any): 'advanced' | 'intermediate' | 'beginner' {
  if (doc.difficulty && ['advanced', 'intermediate', 'beginner'].includes(doc.difficulty)) {
    return doc.difficulty;
  }
  const diff = estimateDifficulty(doc);
  if (diff === 'high') return 'advanced';
  if (diff === 'mid') return 'intermediate';
  return 'beginner';
}

function formatReadTime(minutes: number, t: any): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  }
  return t('explore.badgeReadTime').replace('{min}', String(minutes));
}

function LearningBadges({ document: doc, t, compact = false }: { document: any; t: any; compact?: boolean }) {
  const readTime = estimateReadTime(doc);
  const difficulty = estimateDifficulty(doc);
  const vocab = estimateVocabLevel(doc);

  const readTimeLabel = formatReadTime(readTime, t);

  const diffLabel = difficulty === 'high' ? t('explore.badgeDifficultyHigh') :
    difficulty === 'mid' ? t('explore.badgeDifficultyMid') : t('explore.badgeDifficultyLow');
  const diffColor = difficulty === 'high' ? 'text-rose-600 bg-rose-50 dark:text-rose-400 dark:bg-rose-950/30' :
    difficulty === 'mid' ? 'text-amber-600 bg-amber-50 dark:text-amber-400 dark:bg-amber-950/30' :
    'text-emerald-600 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/30';

  const vocabLabel = vocab === 'advanced' ? t('explore.badgeAdvancedVocab') :
    vocab === 'intermediate' ? t('explore.badgeIntermediateVocab') : t('explore.badgeBeginnerFriendly');
  const monoStyle = 'bg-muted text-muted-foreground border border-border';

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full", diffColor)}>
          <BarChart3 className="h-2.5 w-2.5" />
          {diffLabel}
        </span>
        <span className={cn("inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full", monoStyle)}>
          <Timer className="h-2.5 w-2.5" />
          {readTimeLabel}
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={cn("inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full", diffColor)}>
        <BarChart3 className="h-3 w-3" />
        {diffLabel}
      </span>
      <span className={cn("inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full", monoStyle)}>
        <Timer className="h-3 w-3" />
        {readTimeLabel}
      </span>
      <span className={cn("inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full", monoStyle)}>
        <Brain className="h-3 w-3" />
        {vocabLabel}
      </span>
    </div>
  );
}

function ConversationalHero({
  searchTerm,
  onSearchChange,
  onSearchSubmit,
  onChipClick,
  featuredDocuments,
  onAddToLibrary,
  isDocInLibrary,
  loadingRecommendations,
  searchSentinelRef,
  t,
}: {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit: () => void;
  onChipClick: (query: string, category?: string, difficulty?: string) => void;
  featuredDocuments: any[];
  onAddToLibrary: (doc: any) => void;
  isDocInLibrary: (doc: any) => boolean;
  loadingRecommendations: boolean;
  searchSentinelRef: React.RefObject<HTMLDivElement>;
  t: any;
}) {
  const [, setLocation] = useLocation();
  const inputRef = useRef<HTMLInputElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSearchSubmit();
    }
  };

  const intentChips = [
    { label: t('explore.chipLatestAI'), query: 'AI', category: 'Academic' },
    { label: t('explore.chipBusinessEnglish'), query: 'business', category: 'News' },
    { label: t('explore.chipEasyEnglish'), query: '', category: 'News', difficulty: 'beginner' },
    { label: t('explore.chipBusinessArticle'), query: 'startup', category: 'Essays' },
    { label: t('explore.chipShortEssay'), query: 'essay', category: 'Opinion' },
    { label: t('explore.chipClassicLit'), query: '', category: 'Literature' },
    { label: t('explore.chipScienceTech'), query: '', category: 'Academic' },
    { label: t('explore.chipPhilosophy'), query: 'philosophy', category: 'Opinion' },
  ];

  return (
    <div className="relative py-12 md:py-16">
      <div className="max-w-2xl mx-auto text-center">
        <h1 className="text-3xl md:text-4xl font-bold text-brand-ink dark:text-slate-100 mb-3 tracking-tight">
          {t('explore.heroTitleNew')}
        </h1>
        <p className="text-base md:text-lg text-muted-foreground mb-8">
          {t('explore.heroSubtitleNew')}
        </p>

        <div ref={searchSentinelRef} className="relative max-w-xl mx-auto mb-6">
          <div className="relative group">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400 group-focus-within:text-forest dark:group-focus-within:text-slate-300 transition-colors" />
            <input
              ref={inputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('explore.searchPlaceholderNew')}
              className={cn(
                "w-full h-14 pl-12 pr-4 rounded-2xl text-base",
                "bg-white dark:bg-slate-800/80 border-2 border-slate-200 dark:border-slate-700",
                "focus:border-forest dark:focus:border-slate-500 focus:ring-4 focus:ring-forest/10 dark:focus:ring-slate-500/10",
                "outline-none transition-all duration-300",
                "placeholder:text-slate-400 dark:placeholder:text-slate-500",
                "shadow-sm hover:shadow-md focus:shadow-lg"
              )}
            />
          </div>
        </div>

        <div className="flex items-center justify-center gap-2 flex-wrap max-w-xl mx-auto">
          {intentChips.map((chip) => (
            <button
              key={chip.label}
              onClick={() => onChipClick(chip.query, chip.category, (chip as any).difficulty)}
              className={cn(
                "inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-sm",
                "border border-slate-200 dark:border-slate-700",
                "bg-white/80 dark:bg-slate-800/50",
                "text-slate-600 dark:text-slate-400",
                "hover:bg-forest/5 hover:border-forest/30 hover:text-forest",
                "dark:hover:bg-slate-700/50 dark:hover:text-slate-300",
                "transition-all duration-200 cursor-pointer"
              )}
            >
              <Hash className="h-3 w-3" />
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      {!loadingRecommendations && featuredDocuments.length > 0 && (
        <div className="mt-12 max-w-4xl mx-auto">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-4 w-4 text-forest dark:text-slate-400" />
            <h2 className="text-sm font-medium tracking-[0.1em] text-forest dark:text-slate-400 uppercase">
              {t('explore.forYou')}
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {featuredDocuments.map((doc: any) => (
              <FeaturedCard
                key={doc.id}
                document={doc}
                onAddToLibrary={onAddToLibrary}
                isInLibrary={isDocInLibrary(doc)}
                t={t}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FeaturedCard({
  document: doc,
  onAddToLibrary,
  isInLibrary,
  t,
}: {
  document: any;
  onAddToLibrary: (doc: any) => void;
  isInLibrary: boolean;
  t: any;
}) {
  const [, setLocation] = useLocation();
  const [isAdding, setIsAdding] = useState(false);

  const snippet = useMemo(() => {
    const raw = extractRandomSnippet(doc.snippetContent || doc.content || doc.rawContent, doc.title, doc.id);
    return truncateSnippet(raw, 120);
  }, [doc]);

  const handleClick = () => setLocation(`/viewer/${doc.id}`);

  const handleAdd = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!isInLibrary && !isAdding) {
      setIsAdding(true);
      try { await onAddToLibrary(doc); } finally { setIsAdding(false); }
    }
  };

  return (
    <Card
      className={cn(
        "group cursor-pointer p-5 border border-slate-200 dark:border-slate-700/80 rounded-xl",
        "bg-white/60 dark:bg-slate-800/40 backdrop-blur-sm",
        "hover:shadow-lg hover:border-forest/20 dark:hover:border-slate-600",
        "transition-all duration-300 hover:-translate-y-0.5"
      )}
      onClick={handleClick}
    >
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] tracking-[0.15em] text-forest/70 dark:text-slate-500 uppercase font-semibold">
          {getCategoryLabel(doc.category, t)}
        </span>
        {isInLibrary ? (
          <span className="inline-flex items-center text-[10px] text-muted-foreground gap-1">
            <Check className="h-3 w-3" />
          </span>
        ) : (
          <button
            onClick={handleAdd}
            disabled={isAdding}
            className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            {isAdding ? (
              <div className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent" />
            ) : (
              <Plus className="h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
            )}
          </button>
        )}
      </div>

      <h3 className="font-semibold text-brand-ink dark:text-slate-100 line-clamp-2 mb-2 group-hover:text-forest dark:group-hover:text-slate-300 transition-colors text-[15px]" style={{ lineHeight: '1.5' }}>
        {doc.title}
      </h3>

      {snippet && (
        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-2 mb-3">
          {snippet}
        </p>
      )}

      <LearningBadges document={doc} t={t} compact />
    </Card>
  );
}

function ExploreDocumentCard({ 
  document, 
  onAddToLibrary, 
  isAlreadyInLibrary,
  viewMode,
  onHover,
  t 
}: { 
  document: any; 
  onAddToLibrary: (doc: any) => void;
  isAlreadyInLibrary: boolean;
  viewMode: ViewMode;
  onHover?: (doc: any | null) => void;
  t: any;
}) {
  const [, setLocation] = useLocation();
  const [isAdding, setIsAdding] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const snippet = useMemo(() => {
    const raw = extractMeaningfulSnippet(document.snippetContent || document.content || document.rawContent, document.title);
    return truncateSnippet(raw, 120);
  }, [document.snippetContent, document.content, document.rawContent, document.title]);
  
  const handleMouseEnter = () => {
    setIsHovered(true);
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = setTimeout(() => {
      onHover?.(document);
    }, 150);
  };
  
  const handleMouseLeave = () => {
    setIsHovered(false);
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
    onHover?.(null);
  };
  
  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  const handleClick = () => {
    setLocation(`/viewer/${document.id}`);
  };

  const handleAddToLibrary = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!isAlreadyInLibrary && !isAdding) {
      setIsAdding(true);
      try {
        await onAddToLibrary(document);
      } finally {
        setIsAdding(false);
      }
    }
  };

  const getSourceLabel = () => {
    if (document.feedAlias && document.feedAlias !== 'RSS Feed') return document.feedAlias;
    if (document.source === "arXiv") return "arXiv";
    if (document.source === "Project Gutenberg") return "Project Gutenberg";
    if (document.source) return document.source;
    return t('source.explore');
  };

  const getRelativeTime = () => {
    const now = new Date();
    const date = new Date(document.createdAt);
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 24) {
      return diffHours > 0 ? t('common.hoursAgo', { count: diffHours }) : t('common.justNow');
    }
    if (diffDays < 7) {
      return t('common.daysAgo', { count: diffDays });
    }
    return date.toLocaleDateString();
  };

  if (viewMode === 'list') {
    return (
      <div
        className={cn(
          "group cursor-pointer flex items-center justify-between py-3 px-4 rounded-lg border border-transparent",
          "transition-colors duration-200",
          "hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-slate-200 dark:hover:border-slate-700"
        )}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3
              className="card-title font-sans font-semibold text-[15px] text-brand-ink dark:text-slate-100 group-hover:text-forest dark:group-hover:text-slate-300 transition-colors duration-200 line-clamp-2"
              style={{ lineHeight: '1.4' }}
              title={document.title}
            >
              {document.title}
            </h3>
            <LearningBadges document={document} t={t} compact />
          </div>

          <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
            <span>{getSourceLabel()}</span>
          </div>
        </div>
        
        <div className="flex-shrink-0 ml-4 flex items-center gap-3">
          <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
            <Clock className="h-3 w-3" />
            {getRelativeTime()}
          </span>
          <div className={cn(
            "transition-opacity duration-200 flex-shrink-0",
            "opacity-0 group-hover:opacity-100"
          )}>
            {isAlreadyInLibrary ? (
              <Badge variant="secondary" className="text-xs">
                {t('library.inLibrary')}
              </Badge>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={handleAddToLibrary}
                disabled={isAdding}
              >
                {isAdding ? (
                  <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <Card
      className={cn(
        "group cursor-pointer overflow-hidden border-0 rounded-xl transition-all duration-300 ease-in-out",
        "shadow-[0_4px_20px_rgba(0,0,0,0.06)] hover:shadow-[0_12px_40px_rgba(0,0,0,0.12)] hover:-translate-y-1"
      )}
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <div className="aspect-[3/4] flex flex-col p-4 bg-gradient-to-br from-slate-50 to-white dark:from-slate-800 dark:to-slate-900">
        <div className={cn(
          "flex justify-end mb-2 transition-opacity duration-300",
          isHovered ? "opacity-100" : "opacity-0"
        )}>
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
            >
              {isAdding ? (
                <div className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
              ) : (
                <Plus className="h-3.5 w-3.5 text-forest dark:text-slate-400" />
              )}
            </Button>
          )}
        </div>
        
        <div className="flex-1 flex flex-col justify-center">
          <h3
            className="card-title font-sans font-semibold text-lg text-brand-ink dark:text-slate-100 group-hover:text-forest dark:group-hover:text-slate-300 transition-colors duration-300 line-clamp-3"
            style={{ lineHeight: '1.5' }}
            title={document.title}
          >
            {document.title}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 truncate">
            {getSourceLabel()}
          </p>
        </div>
        
        <div className="mt-3 flex items-end justify-between">
          <LearningBadges document={document} t={t} compact />
          <span className="flex items-center gap-1 text-xs text-slate-400 dark:text-slate-500 flex-shrink-0">
            <Clock className="h-3 w-3" />
            {getRelativeTime()}
          </span>
        </div>
      </div>
    </Card>
  );
}

export default function Explore() {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;
  
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem("explore-view-mode") as ViewMode) || "grid";
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [category, setCategory] = useState<string>("all");
  const [difficultyFilter, setDifficultyFilter] = useState<string>("all");
  const [hoveredDoc, setHoveredDoc] = useState<any | null>(null);
  const [showStickySearch, setShowStickySearch] = useState(false);
  const searchSentinelRef = useRef<HTMLDivElement>(null);
  const stickyInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const sentinel = searchSentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        setShowStickySearch(!entry.isIntersecting);
      },
      { threshold: 0, rootMargin: '-64px 0px 0px 0px' }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  const handleCategoryChange = (newCategory: string) => {
    setCategory(newCategory);
  };
  
  const handleCardHover = useCallback((doc: any | null) => {
    setHoveredDoc(doc);
  }, []);
  
  const [sortBy, setSortBy] = useState<SortOption>("recent");
  const [showRSSModal, setShowRSSModal] = useState(false);
  const [newRSSUrl, setNewRSSUrl] = useState("");
  const [newRSSCategory, setNewRSSCategory] = useState("news");
  const [isAddingRSS, setIsAddingRSS] = useState(false);
  const [editingFeed, setEditingFeed] = useState<any>(null);
  const [editFeedData, setEditFeedData] = useState({ title: "", category: "" });
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [systemSources, setSystemSources] = useState(() => {
    const saved = localStorage.getItem("explore-system-sources");
    return saved
      ? JSON.parse(saved)
      : {
          arxiv: true,
          gutenberg: true,
          aeon: true,
          mittr: true,
          conversation: true,
          nautilus: true,
          voa: true,
          pgEssays: true,
          wired: true,
        };
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAuthenticated } = useAuth();
  const [, navigate] = useLocation();

  const { data: exploreDocuments, isLoading: loadingExplore } = useQuery({
    queryKey: ["/api/library/explore", category, sortBy],
    queryFn: () => {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      params.set("sortBy", sortBy);
      return fetch(`/api/library/explore?${params}`).then((res) => res.json());
    },
  });

  const { data: recommendationsData, isLoading: loadingRecommendations } = useQuery({
    queryKey: ["/api/library/recommendations"],
    queryFn: () => {
      const token = localStorage.getItem('accessToken');
      const headers: HeadersInit = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      return fetch("/api/library/recommendations", { headers }).then((res) => res.json());
    },
  });

  const { data: rssFeeds, isLoading: isLoadingFeeds } = useQuery({
    queryKey: ["/api/rss-feeds"],
    queryFn: () => fetch("/api/rss-feeds").then((res) => res.json()),
  });

  const { data: userUploadDocuments } = useQuery({
    queryKey: ["/api/documents", "uploads"],
    enabled: isAuthenticated,
    queryFn: () => {
      const token = localStorage.getItem('accessToken');
      const headers: HeadersInit = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      return fetch("/api/documents?type=uploads", { headers }).then((res) => {
        if (!res.ok) return [];
        return res.json();
      });
    },
  });

  const { data: userSavedDocuments } = useQuery({
    queryKey: ["/api/documents", "saved"],
    enabled: isAuthenticated,
    queryFn: () => {
      const token = localStorage.getItem('accessToken');
      const headers: HeadersInit = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      return fetch("/api/documents?type=saved", { headers }).then((res) => {
        if (!res.ok) return [];
        return res.json();
      });
    },
  });

  const allUserDocuments = useMemo(() => {
    return [...(userUploadDocuments || []), ...(userSavedDocuments || [])];
  }, [userUploadDocuments, userSavedDocuments]);

  const filteredExploreDocuments = useMemo(() => {
    if (!exploreDocuments) return [];

    return exploreDocuments.filter((doc: any) => {
      const matchesSearch = searchTerm === "" || (() => {
        const terms = searchTerm.toLowerCase().split(/\s+/).filter(Boolean);
        const title = doc.title?.toLowerCase() || '';
        const author = doc.author?.toLowerCase() || '';
        const content = doc.content?.toLowerCase() || '';
        return terms.some(term => title.includes(term) || author.includes(term) || content.includes(term));
      })();

      const source = doc.source;
      if (source === "arXiv" && !systemSources.arxiv) return false;
      if (source === "Project Gutenberg" && !systemSources.gutenberg) return false;

      const matchesCategory = category === "all" || doc.category === category;

      const matchesDifficulty = difficultyFilter === "all" || (() => {
        const diff = estimateDifficulty(doc);
        if (difficultyFilter === "beginner") return diff === "low";
        if (difficultyFilter === "intermediate") return diff === "mid";
        if (difficultyFilter === "advanced") return diff === "high";
        return true;
      })();

      return matchesSearch && matchesCategory && matchesDifficulty;
    });
  }, [exploreDocuments, searchTerm, systemSources, category, difficultyFilter]);

  const featuredDocuments = useMemo(() => {
    if (!recommendationsData?.recommendations) return [];
    const recommendations = recommendationsData.recommendations;
    const filtered = recommendations.filter((doc: any) => {
      const source = doc.source;
      if (source === "arXiv" && !systemSources.arxiv) return false;
      if (source === "Project Gutenberg" && !systemSources.gutenberg) return false;
      return true;
    });
    return filtered.slice(0, 3);
  }, [recommendationsData, systemSources]);

  const mainDocuments = useMemo(() => {
    return filteredExploreDocuments;
  }, [filteredExploreDocuments]);

  const isDocInLibrary = (doc: any) => {
    return allUserDocuments.some(userDoc => 
      userDoc.title === doc.title && userDoc.author === doc.author
    );
  };

  const handleSaveToLibrary = async (document: any) => {
    if (!isAuthenticated) {
      setShowLoginDialog(true);
      return;
    }

    try {
      const token = localStorage.getItem('accessToken');
      const headers: HeadersInit = { "Content-Type": "application/json" };
      
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      
      const response = await fetch("/api/library/save", {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          documentId: document.id,
          title: document.title,
          author: document.author,
          sourceLanguage: document.sourceLanguage || "ko",
          
          sourceType: "explore",
          origin: {
            provider:
              document.sourceType === "rss" ? "RSS" : document.sourceType,
            externalId: document.externalId,
          },
        }),
      });

      if (response.ok) {
        toast({
          title: t('explore.savedToLibrary'),
          description: t('explore.savedToLibraryDesc'),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      } else {
        const data = await response.json();
        if (data.message === "Document already saved") {
          toast({
            title: t('explore.alreadySaved'),
            description: t('explore.alreadySavedDesc'),
          });
        } else {
          throw new Error(data.message || t('explore.failedToSave'));
        }
      }
    } catch (error) {
      toast({
        title: t('explore.saveFailed'),
        description: t('explore.saveFailedDesc'),
        variant: "destructive",
      });
    }
  };

  const handleChipClick = (query: string, chipCategory?: string, difficulty?: string) => {
    if (query) setSearchTerm(query);
    if (chipCategory) setCategory(chipCategory);
    if (difficulty) setDifficultyFilter(difficulty); else setDifficultyFilter('all');
    setCurrentPage(1);
  };

  const handleSearchSubmit = () => {
    setCurrentPage(1);
  };

  const handleViewModeChange = (value: ViewMode) => {
    setViewMode(value);
    localStorage.setItem("explore-view-mode", value);
  };

  const handleAddRSSFeed = async () => {
    if (!newRSSUrl.trim()) {
      toast({
        title: t('explore.urlRequired'),
        description: t('explore.enterRSSUrl'),
        variant: "destructive",
      });
      return;
    }

    try {
      new URL(newRSSUrl);
    } catch {
      toast({
        title: t('explore.invalidUrl'),
        description: t('explore.enterValidUrl'),
        variant: "destructive",
      });
      return;
    }

    setIsAddingRSS(true);
    try {
      const requestData = {
        feedUrl: newRSSUrl.trim(),
        category: newRSSCategory || "News",
        alias: "",
        language: "en",
        syncInterval: 12,
        isActive: true
      };

      const response = await fetch("/api/rss-feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestData),
      });

      const responseData = await response.json();

      if (response.ok) {
        toast({
          title: t('explore.rssFeedAdded'),
          description: t('explore.rssFeedAddedSuccess'),
        });
        setNewRSSUrl("");
        setNewRSSCategory("News");
        queryClient.invalidateQueries({ queryKey: ["/api/rss-feeds"] });
        queryClient.invalidateQueries({ queryKey: ["/api/library/explore"] });
      } else {
        throw new Error(responseData.message || responseData.error || t('explore.failedToAddRSS'));
      }
    } catch (error) {
      toast({
        title: t('explore.addRSSFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('explore.rssFeedAddError'),
        variant: "destructive",
      });
    } finally {
      setIsAddingRSS(false);
    }
  };

  const handleRemoveRSSFeed = async (feedId: number) => {
    try {
      const response = await fetch(`/api/rss-feeds/${feedId}`, {
        method: "DELETE",
      });

      if (response.ok) {
        toast({
          title: t('explore.rssFeedRemoved'),
          description: t('explore.rssFeedRemovedSuccess'),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/rss-feeds"] });
        queryClient.invalidateQueries({ queryKey: ["/api/library/explore"] });
      } else {
        throw new Error(t('explore.failedToRemoveRSS'));
      }
    } catch (error) {
      toast({
        title: t('explore.removeRSSFailed'),
        description: t('explore.rssFeedRemoveError'),
        variant: "destructive",
      });
    }
  };

  const handleEditFeed = (feed: any) => {
    setEditingFeed(feed);
    setEditFeedData({
      title: feed.title || feed.feed?.title || "",
      category: feed.category || feed.feed?.category || "News"
    });
  };

  const handleSaveEditFeed = async () => {
    if (!editingFeed) return;

    try {
      const response = await fetch(`/api/admin/feeds/${editingFeed.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editFeedData.title,
          category: editFeedData.category
        }),
      });

      if (response.ok) {
        toast({
          title: t('explore.rssFeedUpdated'),
          description: t('explore.rssFeedUpdatedSuccess'),
        });
        setEditingFeed(null);
        queryClient.invalidateQueries({ queryKey: ["/api/rss-feeds"] });
        queryClient.invalidateQueries({ queryKey: ["/api/library/explore"] });
      } else {
        throw new Error(t('explore.failedToUpdateRSS'));
      }
    } catch (error) {
      toast({
        title: t('explore.updateRSSFailed'),
        description: t('explore.rssFeedUpdateError'),
        variant: "destructive",
      });
    }
  };

  const handleCancelEdit = () => {
    setEditingFeed(null);
    setEditFeedData({ title: "", category: "" });
  };

  const handleSystemSourceToggle = (source: keyof typeof systemSources) => {
    const newSources = {
      ...systemSources,
      [source]: !systemSources[source],
    };
    setSystemSources(newSources);
    localStorage.setItem("explore-system-sources", JSON.stringify(newSources));

    toast({
      title: `${String(source).toUpperCase()} ${systemSources[source] ? t('explore.sourceDeactivated') : t('explore.sourceActivated')}`,
      description: `${String(source).toUpperCase()} ${systemSources[source] ? t('explore.sourceWillNotAppear') : t('explore.sourceWillAppear')}`,
    });
  };

  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedDocuments = mainDocuments.slice(startIndex, startIndex + itemsPerPage);
  const totalPages = Math.ceil(mainDocuments.length / itemsPerPage);

  return (
    <Layout>
      <PageShell scrollMode="page" maxWidth="standard">
        <div className="-mx-6 lg:-mx-8 px-6 lg:px-8 bg-gradient-to-b from-[hsl(var(--brand-subtle))] to-background">
          <ConversationalHero
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
            onSearchSubmit={handleSearchSubmit}
            onChipClick={handleChipClick}
            featuredDocuments={featuredDocuments}
            onAddToLibrary={handleSaveToLibrary}
            isDocInLibrary={isDocInLibrary}
            loadingRecommendations={loadingRecommendations}
            searchSentinelRef={searchSentinelRef}
            t={t}
          />
        </div>

        <div
          className={cn(
            "fixed top-16 left-0 right-0 z-20 transition-all duration-300 ease-in-out",
            showStickySearch
              ? "opacity-100 translate-y-0 pointer-events-auto"
              : "opacity-0 -translate-y-2 pointer-events-none"
          )}
        >
          <div className="bg-background/95 backdrop-blur-md border-b border-border/50 shadow-sm">
            <div className="mx-auto w-full max-w-[var(--page-max-width)] px-6 lg:px-8 py-2.5">
              <div className="relative max-w-lg mx-auto">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input
                  ref={stickyInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearchSubmit(); }}
                  placeholder={t('explore.searchPlaceholderNew')}
                  className={cn(
                    "w-full h-9 pl-9 pr-3 rounded-lg text-sm",
                    "bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700",
                    "focus:border-forest dark:focus:border-slate-500 focus:ring-2 focus:ring-forest/10",
                    "outline-none transition-all duration-200",
                    "placeholder:text-slate-400 dark:placeholder:text-slate-500"
                  )}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="pt-8 pb-4 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={handleViewModeChange}
              className="border rounded-md"
            >
              <ToggleGroupItem value="grid" aria-label="Grid view" className="px-3">
                <Grid3X3 className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List view" className="px-3">
                <List className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>

            <Select
              value={sortBy}
              onValueChange={(value) => setSortBy(value as SortOption)}
            >
              <SelectTrigger className="w-[140px] bg-white dark:bg-slate-800">
                <ArrowUpDown className="h-4 w-4 mr-2 text-slate-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">{t('explore.latest')}</SelectItem>
                <SelectItem value="uploaded">{t('explore.published')}</SelectItem>
                <SelectItem value="name">{t('explore.titleSort')}</SelectItem>
                <SelectItem value="popularity">{t('explore.popular')}</SelectItem>
              </SelectContent>
            </Select>

            <Select value={category} onValueChange={handleCategoryChange}>
              <SelectTrigger className="w-[140px] bg-white dark:bg-slate-800">
                <Filter className="h-4 w-4 mr-2 text-slate-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('explore.allCategories')}</SelectItem>
                <SelectItem value="News">{t('category.news')}</SelectItem>
                <SelectItem value="Literature">{t('category.literature')}</SelectItem>
                <SelectItem value="Academic">{t('category.academic')}</SelectItem>
                <SelectItem value="Opinion">{t('category.opinion')}</SelectItem>
                <SelectItem value="Other">{t('category.other')}</SelectItem>
              </SelectContent>
            </Select>

            <Select value={difficultyFilter} onValueChange={setDifficultyFilter}>
              <SelectTrigger className="w-[140px] bg-white dark:bg-slate-800">
                <BarChart3 className="h-4 w-4 mr-2 text-slate-400" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('explore.allDifficulties')}</SelectItem>
                <SelectItem value="beginner">{t('explore.beginner')}</SelectItem>
                <SelectItem value="intermediate">{t('explore.intermediate')}</SelectItem>
                <SelectItem value="advanced">{t('explore.advanced')}</SelectItem>
              </SelectContent>
            </Select>

            {isAuthenticated && (
              <Button
                onClick={() => setShowRSSModal(true)}
                size="sm"
                variant="outline"
                className="ml-auto rounded-xl border-[#2F5D50]/20 text-[#2F5D50] hover:bg-[hsl(var(--brand-subtle))] hover:text-[#2F5D50]"
              >
                <Settings className="h-4 w-4 mr-2" />
                {t('explore.manageSources')}
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {["News", "Literature", "Academic", "Opinion"].map((cat) => (
              <Badge
                key={cat}
                variant={category === cat ? "default" : "outline"}
                className={cn(
                  "cursor-pointer transition-all duration-300",
                  category === cat 
                    ? "bg-forest hover:bg-forest-hover text-white" 
                    : "border-[hsl(var(--sage-soft))] text-muted-foreground hover:bg-[hsl(var(--sage-subtle))] dark:hover:bg-slate-800"
                )}
                onClick={() => setCategory(category === cat ? "all" : cat)}
              >
                {t(`category.${cat.toLowerCase()}`)}
              </Badge>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-8 pb-24" data-pagination-scroll-target>
          {loadingExplore ? (
            <div className={cn(
              viewMode === 'grid' 
                ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                : "space-y-2"
            )}>
              {[...Array(12)].map((_, i) => (
                <div 
                  key={i}
                  className={cn(
                    "bg-slate-100 dark:bg-slate-800 animate-pulse rounded-lg",
                    viewMode === 'grid' ? "aspect-[3/4]" : "h-20"
                  )} 
                />
              ))}
            </div>
          ) : paginatedDocuments.length > 0 ? (
            <>
              <div className={cn(
                viewMode === 'grid' 
                  ? "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4"
                  : "space-y-2"
              )}>
                {paginatedDocuments.map((doc: any) => (
                  <ExploreDocumentCard
                    key={doc.id}
                    document={doc}
                    onAddToLibrary={handleSaveToLibrary}
                    isAlreadyInLibrary={isDocInLibrary(doc)}
                    viewMode={viewMode}
                    onHover={handleCardHover}
                    t={t}
                  />
                ))}
              </div>
              
              <Pagination
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={setCurrentPage}
              />
            </>
          ) : (
            <div className="text-center py-16">
              <div className="bg-slate-100 dark:bg-slate-800 rounded-full p-6 w-fit mx-auto mb-6">
                <Compass className="h-12 w-12 text-slate-400" />
              </div>
              <h3 className="text-xl font-semibold text-slate-700 dark:text-slate-300 mb-4">
                {t('explore.noContent')}
              </h3>
              <p className="text-slate-500 dark:text-slate-400 mb-6">
                {t('explore.noContentDesc')}
              </p>
              {isAuthenticated && (
                <Button onClick={() => setShowRSSModal(true)} variant="outline">
                  <Plus className="h-4 w-4 mr-2" />
                  {t('explore.addRSSButton')}
                </Button>
              )}
            </div>
          )}
        </div>
      </PageShell>
      {showRSSModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-background border rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold">{t('explore.rssFeedsManagement')}</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowRSSModal(false)}
                  className="rounded-full"
                >
                  ×
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <h3 className="font-medium mb-2">{t('explore.activeRSSFeeds')}</h3>
                  {isLoadingFeeds ? (
                    <div className="space-y-2">
                      {[...Array(3)].map((_, i) => (
                        <div
                          key={i}
                          className="h-12 bg-muted animate-pulse rounded"
                        />
                      ))}
                    </div>
                  ) : rssFeeds && rssFeeds.length > 0 ? (
                    <div className="space-y-2">
                      {rssFeeds.map((feed: any) => (
                        <div
                          key={feed.id}
                          className="flex items-center justify-between p-3 border rounded-lg"
                        >
                          {editingFeed?.id === feed.id ? (
                            <div className="flex-1 space-y-2">
                              <Input
                                value={editFeedData.title}
                                onChange={(e) => setEditFeedData(prev => ({ ...prev, title: e.target.value }))}
                                placeholder={t('explore.rssFeedNamePlaceholder')}
                                className="font-medium"
                              />
                              <div className="flex gap-2">
                                <Select
                                  value={editFeedData.category}
                                  onValueChange={(value) => setEditFeedData(prev => ({ ...prev, category: value }))}
                                >
                                  <SelectTrigger className="w-[140px]">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="News">{t('category.news')}</SelectItem>
                                    <SelectItem value="Literature">{t('category.literature')}</SelectItem>
                                    <SelectItem value="Academic">{t('category.academic')}</SelectItem>
                                    <SelectItem value="Opinion">{t('category.opinion')}</SelectItem>
                                    <SelectItem value="Other">{t('category.other')}</SelectItem>
                                  </SelectContent>
                                </Select>
                                <Button size="sm" onClick={handleSaveEditFeed}>
                                  {t('common.save')}
                                </Button>
                                <Button size="sm" variant="outline" onClick={handleCancelEdit}>
                                  {t('common.cancel')}
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <>
                              <div className="flex-1">
                                <p className="font-medium">{feed.title || feed.feedUrl}</p>
                                <p className="text-sm text-muted-foreground">
                                  {feed.category} · {feed.itemCount || 0} {t('explore.items')}
                                </p>
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleEditFeed(feed)}
                                >
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => handleRemoveRSSFeed(feed.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm">
                      {t('explore.noRSSFeeds')}
                    </p>
                  )}
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-medium mb-2">{t('explore.addNewRSSFeed')}</h3>
                  <div className="flex gap-2">
                    <Input
                      placeholder={t('explore.rssUrlPlaceholder')}
                      value={newRSSUrl}
                      onChange={(e) => setNewRSSUrl(e.target.value)}
                      className="flex-1"
                    />
                    <Select
                      value={newRSSCategory}
                      onValueChange={setNewRSSCategory}
                    >
                      <SelectTrigger className="w-[140px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="News">{t('category.news')}</SelectItem>
                        <SelectItem value="Literature">{t('category.literature')}</SelectItem>
                        <SelectItem value="Academic">{t('category.academic')}</SelectItem>
                        <SelectItem value="Opinion">{t('category.opinion')}</SelectItem>
                        <SelectItem value="Other">{t('category.other')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={handleAddRSSFeed} disabled={isAddingRSS}>
                      {isAddingRSS ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      ) : (
                        <Plus className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h3 className="font-medium mb-2">{t('explore.systemSources')}</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(systemSources).map(([source, enabled]) => {
                      const sourceLabels: Record<string, { name: string; desc: string }> = {
                        arxiv: { name: t('explore.arxiv'), desc: t('explore.arxivDesc') },
                        gutenberg: { name: t('explore.projectGutenberg'), desc: t('explore.projectGutenbergDesc') },
                        aeon: { name: t('explore.aeonEssays'), desc: t('explore.aeonDesc') },
                        mittr: { name: t('explore.mitTechReview'), desc: t('explore.mitTechReviewDesc') },
                        conversation: { name: t('explore.theConversation'), desc: t('explore.theConversationDesc') },
                        nautilus: { name: t('explore.nautilus'), desc: t('explore.nautilusDesc') },
                        voa: { name: t('explore.voaLearningEnglish'), desc: t('explore.voaDesc') },
                        pgEssays: { name: t('explore.pgEssays'), desc: t('explore.pgEssaysDesc') },
                        wired: { name: t('explore.wired'), desc: t('explore.wiredDesc') },
                      };
                      const label = sourceLabels[source];
                      return (
                        <div
                          key={source}
                          className="flex items-center justify-between p-2 border rounded"
                        >
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">{label?.name || source}</span>
                            {label?.desc && <span className="text-xs text-muted-foreground">{label.desc}</span>}
                          </div>
                          <Switch
                            checked={enabled as boolean}
                            onCheckedChange={() => handleSystemSourceToggle(source as keyof typeof systemSources)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      <Dialog open={showLoginDialog} onOpenChange={setShowLoginDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('auth.loginRequired')}</DialogTitle>
            <DialogDescription>
              {t('auth.loginToSaveContent')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLoginDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={() => navigate('/login')}>
              {t('auth.login')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
