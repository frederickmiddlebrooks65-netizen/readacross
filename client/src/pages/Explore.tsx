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
import DocumentCard from "@/components/DocumentCard";
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
  BookmarkPlus,
  Rss,
  Pencil,
  Trash2,
  Clock,
  Sparkles,
  Check,
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

function FeaturedCarousel({ 
  documents, 
  onAddToLibrary, 
  isDocInLibrary,
  hoveredDoc,
  t 
}: { 
  documents: any[]; 
  onAddToLibrary: (doc: any) => void;
  isDocInLibrary: (doc: any) => boolean;
  hoveredDoc: any | null;
  t: any;
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [, setLocation] = useLocation();
  const [isAdding, setIsAdding] = useState(false);
  const [displayDoc, setDisplayDoc] = useState<any | null>(null);
  const [isFading, setIsFading] = useState(false);

  const goToSlide = useCallback((index: number) => {
    if (isTransitioning) return;
    setIsTransitioning(true);
    setCurrentIndex(index);
    setTimeout(() => setIsTransitioning(false), 800);
  }, [isTransitioning]);

  useEffect(() => {
    if (documents.length <= 1 || isPaused || hoveredDoc) return;
    
    const interval = setInterval(() => {
      goToSlide((currentIndex + 1) % documents.length);
    }, 6000);

    return () => clearInterval(interval);
  }, [currentIndex, documents.length, isPaused, goToSlide, hoveredDoc]);

  useEffect(() => {
    const targetDoc = hoveredDoc || documents[currentIndex];
    if (!targetDoc) return;
    
    // On initial load (displayDoc is null), set immediately without fade
    if (!displayDoc) {
      setDisplayDoc(targetDoc);
      return;
    }
    
    // Only fade when transitioning between different documents
    if (displayDoc.id !== targetDoc.id) {
      setIsFading(true);
      const timer = setTimeout(() => {
        setDisplayDoc(targetDoc);
        setIsFading(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [hoveredDoc, documents, currentIndex, displayDoc]);

  useEffect(() => {
    if (documents[0] && !displayDoc) {
      setDisplayDoc(documents[0]);
    }
  }, [documents, displayDoc]);

  const currentDoc = displayDoc || documents[currentIndex];
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [titleFontSize, setTitleFontSize] = useState<'normal' | 'small'>('normal');
  
  useEffect(() => {
    if (!currentDoc?.title) return;
    const titleLength = currentDoc.title.length;
    if (titleLength > 60) {
      setTitleFontSize('small');
    } else {
      setTitleFontSize('normal');
    }
  }, [currentDoc?.title, currentDoc?.id]);
  
  if (!currentDoc) return null;

  const snippet = extractRandomSnippet(currentDoc.snippetContent || currentDoc.content || currentDoc.rawContent, currentDoc.title, currentDoc.id);
  const truncatedSnippet = truncateSnippet(snippet, 280);

  const getSourceLabel = () => {
    if (currentDoc.source === "arXiv") return "arXiv";
    if (currentDoc.source === "Project Gutenberg") return "Project Gutenberg";
    if (currentDoc.source) return currentDoc.source;
    return t('source.explore');
  };

  const handleClick = () => {
    setLocation(`/viewer/${currentDoc.id}`);
  };

  const handleAddToLibrary = async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const alreadyInLibrary = isDocInLibrary(currentDoc);
    if (!alreadyInLibrary && !isAdding) {
      setIsAdding(true);
      try {
        await onAddToLibrary(currentDoc);
      } finally {
        setIsAdding(false);
      }
    }
  };

  const alreadyInLibrary = isDocInLibrary(currentDoc);

  const snippetPlaceholder = t('explore.exploringInsights') || 'Exploring the core insights of this document...';

  return (
    <div 
      className="relative cursor-pointer h-[280px] md:h-[300px]"
      onClick={handleClick}
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div 
        key={currentDoc.id}
        className={cn(
          "flex items-start gap-20 lg:gap-24 py-8 px-8 md:px-12 lg:px-16 xl:px-20 h-full",
          "transition-opacity duration-[250ms] ease-in-out",
          isFading ? "opacity-0" : "opacity-100"
        )}
      >
        <div className="flex-1 max-w-[50%] flex flex-col justify-center">
          <span className="text-[10px] tracking-[0.2em] text-forest/70 dark:text-slate-500 uppercase font-bold mb-2 block transition-opacity duration-[250ms]">
            {getCategoryLabel(currentDoc.category, t)}
          </span>
          
          <h2 
            ref={titleRef}
            className="font-sans font-semibold text-brand-ink dark:text-slate-100 mb-3 line-clamp-2 transition-all duration-[250ms]"
            style={{ fontSize: '48px', lineHeight: '1.3' }}
          >
            {currentDoc.title}
          </h2>
          
          <p className="text-sm text-muted-foreground/80 mb-6 transition-opacity duration-[250ms]">
            {getSourceLabel()}
          </p>

          <div className="flex items-center">
            {alreadyInLibrary ? (
              <span className="inline-flex items-center h-9 px-4 text-sm border border-[hsl(var(--sage-soft))] dark:border-slate-700 rounded-md bg-white/60 dark:bg-slate-800/30 text-muted-foreground cursor-default">
                <Check className="h-4 w-4 mr-2" />
                {t('library.inLibrary')}
              </span>
            ) : (
              <Button
                variant="outline"
                size="sm"
                className="h-9 px-4 text-sm border-[hsl(var(--sage-soft))] dark:border-slate-700 bg-white/60 hover:bg-white dark:bg-slate-800/50 dark:hover:bg-slate-800 text-forest dark:text-slate-300"
                onClick={handleAddToLibrary}
                disabled={isAdding}
              >
                {isAdding ? (
                  <div className="h-4 w-4 mr-2 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <Plus className="h-4 w-4 mr-2" />
                )}
                {t('library.addToLibrary')}
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1 max-w-[40%] flex items-start pt-6">
          <p className="hero-quote text-base md:text-lg lg:text-xl line-clamp-5 transition-opacity duration-[250ms]">
            {truncatedSnippet ? `"${truncatedSnippet}"` : (
              <span className="text-slate-400 dark:text-slate-500">{snippetPlaceholder}</span>
            )}
          </p>
        </div>
      </div>

      {documents.length > 1 && !hoveredDoc && (
        <div className="flex justify-center gap-2 mt-4">
          {documents.map((_, index) => (
            <button
              key={index}
              onClick={(e) => {
                e.stopPropagation();
                goToSlide(index);
              }}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300 ease-in-out",
                index === currentIndex 
                  ? "w-8 bg-forest dark:bg-slate-400" 
                  : "w-3 bg-slate-300 dark:bg-slate-700 hover:bg-slate-400 dark:hover:bg-slate-600"
              )}
              aria-label={`Go to slide ${index + 1}`}
            />
          ))}
        </div>
      )}
    </div>
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
    }, 150); // 150ms debounce for smooth UX
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
          "group cursor-pointer p-4 rounded-lg border border-transparent",
          "transition-all duration-300 ease-in-out",
          "hover:bg-slate-50 dark:hover:bg-slate-800/50 hover:border-slate-200 dark:hover:border-slate-700"
        )}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h3 className="card-title font-sans font-semibold text-brand-ink dark:text-slate-100 group-hover:text-forest dark:group-hover:text-slate-300 transition-colors duration-300 line-clamp-1" style={{ lineHeight: '1.5' }}>
              {document.title}
            </h3>
            <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
              <span>{getSourceLabel()}</span>
              <span>·</span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {getRelativeTime()}
              </span>
            </div>
            <p className={cn(
              "mt-2 text-sm text-slate-500 dark:text-slate-400 line-clamp-2",
              "transition-all duration-300 ease-in-out",
              isHovered ? "opacity-100 max-h-20" : "opacity-0 max-h-0 overflow-hidden"
            )}>
              {snippet}
            </p>
          </div>
          
          <div className={cn(
            "flex-shrink-0 transition-opacity duration-300",
            isHovered ? "opacity-100" : "opacity-0"
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
          <h3 className={cn(
            "card-title font-sans font-semibold text-lg text-brand-ink dark:text-slate-100 group-hover:text-forest dark:group-hover:text-slate-300 transition-colors duration-300",
            isHovered ? "" : "line-clamp-3"
          )} style={{ lineHeight: '1.5' }}>
            {document.title}
          </h3>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 truncate">
            {getSourceLabel()}
          </p>
        </div>
        
        <div className="flex items-center gap-1 mt-3 text-xs text-slate-400 dark:text-slate-500">
          <Clock className="h-3 w-3" />
          <span>{getRelativeTime()}</span>
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
  const [hoveredDoc, setHoveredDoc] = useState<any | null>(null);

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
    queryFn: () => {
      const token = localStorage.getItem('accessToken');
      const headers: HeadersInit = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      return fetch("/api/documents?type=uploads", { headers }).then((res) => res.json());
    },
  });

  const { data: userSavedDocuments } = useQuery({
    queryKey: ["/api/documents", "saved"],
    queryFn: () => {
      const token = localStorage.getItem('accessToken');
      const headers: HeadersInit = {};
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
      return fetch("/api/documents?type=saved", { headers }).then((res) => res.json());
    },
  });

  const allUserDocuments = useMemo(() => {
    return [...(userUploadDocuments || []), ...(userSavedDocuments || [])];
  }, [userUploadDocuments, userSavedDocuments]);

  const filteredExploreDocuments = useMemo(() => {
    if (!exploreDocuments) return [];

    return exploreDocuments.filter((doc: any) => {
      const matchesSearch =
        searchTerm === "" ||
        doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.author?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.content?.toLowerCase().includes(searchTerm.toLowerCase());

      const source = doc.source;
      if (source === "arXiv" && !systemSources.arxiv) return false;
      if (source === "Project Gutenberg" && !systemSources.gutenberg) return false;

      return matchesSearch;
    });
  }, [exploreDocuments, searchTerm, systemSources]);

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
            sourceId: document.sourceId?.toString(),
            url: document.url,
          },
        }),
      });

      if (response.ok) {
        toast({
          title: t('explore.savedToLibrary'),
          description: t('explore.savedToLibraryDesc'),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
        queryClient.invalidateQueries({ queryKey: ["/api/documents", "uploads"] });
        queryClient.invalidateQueries({ queryKey: ["/api/documents", "saved"] });
      } else {
        const error = await response.json();
        if (error.message?.includes("already exists")) {
          toast({
            title: t('explore.alreadySaved'),
            description: t('explore.alreadySavedDesc'),
            variant: "destructive",
          });
        } else {
          throw new Error(error.message || t('explore.failedToSave'));
        }
      }
    } catch (error) {
      toast({
        title: t('explore.saveFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('explore.saveFailedDesc'),
        variant: "destructive",
      });
    }
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
        <div className="py-8">
          <div className="mb-8">
            <h1 className="page-title mb-2 text-[30px]">
              {t('explore.heroTitle')}
            </h1>
            <p className="text-gray-500 dark:text-slate-400 text-[14px] mt-[2px] mb-[2px]">
              {t('explore.heroSubtitle')}
            </p>
          </div>
        </div>

        <div 
          className="-mx-6 lg:-mx-8 px-6 lg:px-8 pt-6 pb-10 bg-[hsl(var(--brand-subtle))]"
        >
          <div>
            {loadingRecommendations ? (
              <div className="h-[280px] md:h-[300px] animate-pulse" />
            ) : featuredDocuments.length > 0 ? (
              <div>
                <div className="flex items-center gap-2 mb-5">
                  <Sparkles className="h-4 w-4 text-forest dark:text-slate-400" />
                  <h2 className="text-sm font-medium tracking-[0.15em] text-forest dark:text-slate-400 uppercase">
                    For You
                  </h2>
                </div>
                
                <FeaturedCarousel
                  documents={featuredDocuments}
                  onAddToLibrary={handleSaveToLibrary}
                  isDocInLibrary={isDocInLibrary}
                  hoveredDoc={null}
                  t={t}
                />
              </div>
            ) : null}
          </div>
        </div>

        <div className="pt-8 pb-4 space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[200px] max-w-md">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder={t('explore.searchPlaceholder')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              />
            </div>

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
                    {Object.entries(systemSources).map(([source, enabled]) => (
                      <div
                        key={source}
                        className="flex items-center justify-between p-2 border rounded"
                      >
                        <span className="text-sm capitalize">{source}</span>
                        <Switch
                          checked={enabled as boolean}
                          onCheckedChange={() => handleSystemSourceToggle(source as keyof typeof systemSources)}
                        />
                      </div>
                    ))}
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
