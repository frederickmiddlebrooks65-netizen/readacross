import { useState, useMemo, useCallback } from 'react';
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Layout from "@/components/Layout";
import PageShell from "@/components/layout/PageShell";
import PageHeader from "@/components/layout/PageHeader";
import PageBody from "@/components/layout/PageBody";
import PageToolbar from "@/components/layout/PageToolbar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import DocumentCard from "@/components/DocumentCard";
import TextContentModal from "@/components/TextContentModal";
import FilterDropdown from "@/components/FilterDropdown";
import FilterChips from "@/components/FilterChips";
import { cn } from "@/lib/utils";
import {
  LibraryIcon,
  Upload,
  Search,
  Plus,
  ArrowUpDown,
  Grid3X3,
  List,
  Rss,
  RefreshCw,
  Trash2,
  X,
  AlertTriangle,
  Sparkles,
  ChevronRight,
  BookOpen,
  Languages,
  BookmarkPlus,
  FileText,
  Clock,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLibraryFilters } from "@/hooks/useLibraryFilters";
import { classifyOrigin, toUISource, matchesSource, countBySource } from '@/lib/source/classifier';
import type { DocumentLite, UISource } from '@/lib/source/types';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/i18n";
import HeroSection from "@/components/HeroSection";


type ViewMode = "grid" | "list";

import Pagination from "@/components/common/Pagination";

export default function Library() {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;
  
  // State Management
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isRSSModalOpen, setIsRSSModalOpen] = useState(false);

  // Filter state management
  const {
    filters,
    updateFilters,
    resetFilters,
    clearAllFilters,
    badgeCount,
    filterChips,
    isInitialized
  } = useLibraryFilters();

  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem("library-view-mode") as ViewMode) || "list";
  });

  // RSS Feed State
  const [rssFormData, setRSSFormData] = useState({
    feedUrl: "",
    alias: "",
    category: "News",
    language: "en",
    syncInterval: 12,
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAuthenticated, isLoading: authLoading, user } = useAuth();
  const [, setLocation] = useLocation();
  
  const isAuthReady = !authLoading && isAuthenticated;

  const { data: reviewDueCount } = useQuery<{ total: number }>({
    queryKey: ["/api/practice/due-count"],
    enabled: isAuthReady,
    queryFn: async () => {
      const token = localStorage.getItem('accessToken');
      const res = await fetch("/api/practice/due-count", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return { total: 0 };
      return res.json().catch(() => ({ total: 0 }));
    },
    staleTime: 1000 * 60 * 5,
    retry: false,
  });

  const { data: docStats } = useQuery<Record<number, { glossaryCount: number; notesCount: number }>>({
    queryKey: ["/api/documents/stats/counts"],
    enabled: isAuthReady,
    queryFn: async () => {
      const token = localStorage.getItem('accessToken');
      const res = await fetch("/api/documents/stats/counts", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) return {};
      return res.json().catch(() => ({}));
    },
    staleTime: 1000 * 60 * 2,
  });

  // Archive/Restore/Delete Handlers
  const handleArchiveDocument = async (documentId: number) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/archive`, {
        method: "POST",
      });

      if (response.ok) {
        toast({
          title: t('library.documentArchived'),
          description: t('library.documentArchivedDesc'),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      } else {
        throw new Error(t('library.archiveFailed'));
      }
    } catch (error) {
      toast({
        title: t('library.archiveFailed'),
        description: t('library.archiveFailedDesc'),
        variant: "destructive",
      });
    }
  };

  const handleRestoreDocument = async (documentId: number) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/restore`, {
        method: "POST",
      });

      if (response.ok) {
        toast({
          title: t('library.documentRestored'),
          description: t('library.documentRestoredDesc'),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      } else {
        throw new Error(t('library.restoreFailed'));
      }
    } catch (error) {
      toast({
        title: t('library.restoreFailed'),
        description: t('library.restoreFailedDesc'),
        variant: "destructive",
      });
    }
  };

  const handleDeleteDocument = async (documentId: number) => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(`/api/documents/${documentId}`, {
        method: "DELETE",
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
      });

      if (response.ok) {
        toast({
          title: t('library.documentDeleted'),
          description: t('library.documentDeletedDesc'),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      } else {
        const error = await response.json();
        throw new Error(error.error || t('library.deleteFailed'));
      }
    } catch (error) {
      toast({
        title: t('library.deleteFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('library.deleteFailedDesc'),
        variant: "destructive",
      });
    }
  };

  // Data Queries - Single query for all documents with status filter
  const { data: allDocuments, isLoading: loadingDocuments, error: documentsError } = useQuery<any[]>({
    queryKey: ["/api/documents", { status: filters.status }],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) {
        params.set('status', filters.status);
      }
      const url = `/api/documents${params.toString() ? `?${params.toString()}` : ''}`;
      
      // Use apiRequest to handle authentication
      const { apiRequest } = await import('@/lib/queryClient');
      return apiRequest(url);
    },
    enabled: isAuthReady && isInitialized,
    refetchOnWindowFocus: false,
    refetchInterval: 30000,
  });

  const { data: rssFeeds, isLoading: loadingFeeds } = useQuery<any[]>({
    queryKey: ["/api/rss-feeds"],
    enabled: isAuthReady,
    refetchOnWindowFocus: false,
  });

  // Separate documents by type using SSOT classifier
  const documentsByType = useMemo(() => {
    if (!allDocuments || !Array.isArray(allDocuments)) {
      return { uploaded: [], saved: [], rss: [] };
    }

    const result = { uploaded: [] as any[], saved: [] as any[], rss: [] as any[] };

    allDocuments.forEach((doc: any) => {
      const origin = classifyOrigin(doc);
      const uiSource = toUISource(origin);

      // Debug logging for ALL documents to see classification
      console.log(`[SSOT Debug] Document "${doc.title}":`, {
        id: doc.id,
        source: doc.source,
        sourceProvider: doc.sourceProvider,
        sourceType: doc.sourceType,
        feedId: doc.feedId,
        fileId: doc.fileId,
        uploadId: doc.uploadId,
        origin: origin,
        uiSource: uiSource
      });

      result[uiSource].push(doc);
    });

    console.log(`[SSOT Debug] Final document counts:`, {
      uploaded: result.uploaded.length,
      saved: result.saved.length,
      rss: result.rss.length
    });

    return result;
  }, [allDocuments]);

  const uploadDocuments = documentsByType.uploaded;
  const savedDocuments = documentsByType.saved;
  const rssDocuments = documentsByType.rss;

  // Calculate category breakdown for all documents
  const categoryBreakdown = useMemo(() => {
    if (!allDocuments || !Array.isArray(allDocuments)) {
      return { News: 0, Literature: 0, Academic: 0, Opinion: 0, Other: 0 };
    }

    const breakdown = { News: 0, Literature: 0, Academic: 0, Opinion: 0, Other: 0 };

    allDocuments.forEach(doc => {
      const docCategory = doc.category?.toLowerCase() || "";

      if (docCategory === "news" || docCategory === "뉴스") {
        breakdown.News++;
      } else if (docCategory === "literature" || docCategory === "문학" || docCategory === "classic") {
        breakdown.Literature++;
      } else if (docCategory === "academic" || docCategory === "논문" || docCategory === "science" || docCategory === "학술논문") {
        breakdown.Academic++;
      } else if (docCategory === "opinion" || docCategory === "에세이/오피니언" || docCategory === "칼럼·에세이" || docCategory === "non-fiction") {
        breakdown.Opinion++;
      } else {
        breakdown.Other++;
      }
    });

    return breakdown;
  }, [allDocuments]);

  const resumeDoc = useMemo(() => {
    if (!allDocuments || !Array.isArray(allDocuments)) return null;
    const candidates = allDocuments
      .filter((doc: any) => !doc.isArchived)
      .sort((a: any, b: any) => {
        const aTime = new Date(a.lastActivityAt || a.createdAt).getTime();
        const bTime = new Date(b.lastActivityAt || b.createdAt).getTime();
        return bTime - aTime;
      });
    return candidates.length > 0 ? candidates[0] : null;
  }, [allDocuments]);

  const filteredDocuments = useMemo(() => {
    if (!allDocuments || !Array.isArray(allDocuments) || !isInitialized) return [];

    let filtered = allDocuments.filter((doc: any) => {
      // Search filter
      const matchesSearch =
        filters.search === "" ||
        doc.title?.toLowerCase().includes(filters.search.toLowerCase()) ||
        doc.content?.toLowerCase().includes(filters.search.toLowerCase()) ||
        doc.author?.toLowerCase().includes(filters.search.toLowerCase());

      // Status filter (active/archived)
      const matchesStatus =
        filters.status === "all" ||
        (filters.status === "active" && !doc.isArchived) ||
        (filters.status === "archived" && doc.isArchived);

      // Source filter using SSOT - 필터가 비어있으면 모두 통과
      const matchesSourceFilter = filters.sources.length === 0 || (() => {
        const origin = classifyOrigin(doc);
        const uiSource = toUISource(origin);
        return filters.sources.includes(uiSource);
      })();

      // Category filter
      const matchesCategory = (() => {
        if (filters.categories.length === 0) return true;

        const docCategory = doc.category?.toLowerCase() || "";

        return filters.categories.some(filterCategory => {
          const filterCategoryLower = filterCategory.toLowerCase();

          // Direct match
          if (docCategory === filterCategoryLower) return true;

          // Handle legacy Korean categories
          switch (filterCategory) {
            case "News":
              return docCategory === "뉴스" || docCategory === "news";
            case "Literature":
              return docCategory === "문학" || docCategory === "literature" || docCategory === "classic";
            case "Academic":
              return docCategory === "논문" || docCategory === "academic" || docCategory === "science" || docCategory === "학술논문";
            case "Opinion":
              return docCategory === "에세이/오피니언" || docCategory === "칼럼·에세이" ||
                     docCategory === "opinion" || docCategory === "non-fiction";
            case "Other":
              return docCategory === "기타" || docCategory === "other" || !doc.category;
            default:
              return false;
          }
        });
      })();

      return matchesSearch && matchesStatus && matchesSourceFilter && matchesCategory;
    });

    // Sort documents
    filtered.sort((a: any, b: any) => {
      switch (filters.sort) {
        case "name":
          return (a.title || "").localeCompare(b.title || "");
        case "uploaded":
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case "progress":
          return (b.progress || 0) - (a.progress || 0);
        case "recent":
        default:
          const aTime = new Date(a.lastViewedAt || a.lastActivityAt || a.createdAt).getTime();
          const bTime = new Date(b.lastViewedAt || b.lastActivityAt || b.createdAt).getTime();
          return bTime - aTime;
      }
    });

    return filtered;
  }, [allDocuments, filters, isInitialized]);

  const handleViewModeChange = useCallback((value: ViewMode) => {
    setViewMode(value);
    localStorage.setItem("library-view-mode", value);
  }, []);

  const handleAddDocument = useCallback(async (
    title: string,
    content: string,
    sourceLanguage: string,
  ) => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch("/api/documents/create-from-text", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        body: JSON.stringify({
          title,
          content,
          sourceLanguage,
        }),
      });

      if (response.ok) {
        toast({ title: t('library.documentAdded') });
        setIsModalOpen(false);
        queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      } else {
        const errorData = await response.json();
        if (errorData.errorCode === "UPLOAD_LIMIT_REACHED") {
          const err = new Error(errorData.error);
          (err as any).errorCode = "UPLOAD_LIMIT_REACHED";
          throw err;
        }
        throw new Error(errorData.error || t('library.addDocumentFailed'));
      }
    } catch (error) {
      if ((error as any)?.errorCode === "UPLOAD_LIMIT_REACHED") {
        throw error;
      }
      toast({
        title: t('library.addDocumentError'),
        description: error instanceof Error ? error.message : t('library.pleaseRetry'),
        variant: "destructive",
      });
    }
  }, [toast, queryClient]); // Added dependencies

  // RSS Feed Handlers
  const handleAddRSSFeed = useCallback(async () => {
    if (!rssFormData.feedUrl.trim()) {
      toast({
        title: t('library.urlRequired'),
        description: t('library.enterRSSUrl'),
        variant: "destructive",
      });
      return;
    }

    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch("/api/rss-feeds", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token && { 'Authorization': `Bearer ${token}` }),
        },
        body: JSON.stringify(rssFormData),
      });

      if (response.ok) {
        toast({
          title: t('library.rssFeedAdded'),
          description: t('library.rssFeedAddedSuccess'),
        });
        setRSSFormData({
          feedUrl: "",
          alias: "",
          category: "News",
          language: "en",
          syncInterval: 12,
        });
        queryClient.invalidateQueries({ queryKey: ["/api/rss-feeds"] });
        queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      } else {
        const error = await response.json();
        throw new Error(error.error || t('library.addRSSFailed'));
      }
    } catch (error) {
      toast({
        title: t('library.addRSSFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('library.rssFeedAddError'),
        variant: "destructive",
      });
    }
  }, [rssFormData, toast, queryClient, t]); // Added dependencies

  const handleDeleteRSSFeed = useCallback(async (feedId: number) => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(`/api/rss-feeds/${feedId}`, {
        method: "DELETE",
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` }),
          'Content-Type': 'application/json',
        }
      });

      if (response.ok) {
        toast({
          title: t('library.rssFeedDeleted'),
          description: t('library.rssFeedDeletedSuccess'),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/rss-feeds"] });
        queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      } else {
        const error = await response.json();
        throw new Error(error.error || t('library.deleteRSSFailed'));
      }
    } catch (error) {
      toast({
        title: t('library.deleteRSSFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('library.rssFeedDeleteError'),
        variant: "destructive",
      });
    }
  }, [toast, queryClient, t]); // Added dependencies

  const handleSyncRSSFeed = useCallback(async (feedId: number) => {
    try {
      const token = localStorage.getItem('accessToken');
      const response = await fetch(`/api/rss-feeds/${feedId}/sync`, {
        method: "POST",
        headers: {
          ...(token && { 'Authorization': `Bearer ${token}` }),
          'Content-Type': 'application/json',
        }
      });

      if (response.ok) {
        toast({
          title: t('library.rssSyncStarted'),
          description: t('library.rssSyncStartedDesc'),
        });
        queryClient.invalidateQueries({ queryKey: ["/api/rss-feeds"] });
        queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      } else {
        const error = await response.json();
        throw new Error(error.error || t('library.syncRSSFailed'));
      }
    } catch (error) {
      toast({
        title: t('library.syncRSSFailed'),
        description:
          error instanceof Error
            ? error.message
            : t('library.rssSyncError'),
        variant: "destructive",
      });
    }
  }, [toast, queryClient, t]); // Added dependencies

  const DocumentGrid = useCallback(({
    documents,
    loading,
  }: {
    documents: any[];
    loading: boolean;
  }) => {
    if (loading) {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      );
    }

    if (!documents || documents.length === 0) {
      const hasActiveFilters = badgeCount > 0 || filters.search.length > 0;
      const hasSearchQuery = filters.search.length > 0;

      return (
        <div className="text-center py-16">
          <div className="bg-muted/50 rounded-full p-6 w-fit mx-auto mb-6">
            <LibraryIcon className="h-12 w-12 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold text-foreground mb-4">
            {hasSearchQuery
              ? t('library.noResults', { query: filters.search })
              : hasActiveFilters
                ? t('library.noMatches')
                : t('library.emptyLibrary')
            }
          </h3>
          <p className="text-muted-foreground mb-8 max-w-md mx-auto">
            {hasSearchQuery
              ? t('library.noResultsDesc')
              : hasActiveFilters
                ? t('library.noMatchesDesc')
                : t('library.emptyLibraryDesc')
            }
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            {hasActiveFilters && (
              <Button variant="outline" onClick={clearAllFilters}>
                <X className="h-4 w-4 mr-2" />
                {t('library.resetFilters')}
              </Button>
            )}
            <Button onClick={() => setIsModalOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t('library.uploadDocument')}
            </Button>
            {!hasActiveFilters && (
              <Button variant="outline" onClick={() => window.location.href = '/explore'}>
                <Search className="h-4 w-4 mr-2" />
                {t('library.browseExplore')}
              </Button>
            )}
          </div>

          {/* Show current filter summary when filters are active */}
          {hasActiveFilters && (
            <div className="mt-8 p-4 bg-muted/30 rounded-lg max-w-md mx-auto">
              <div className="text-sm text-muted-foreground mb-2">{t('library.currentFilters')}</div>
              <div className="flex flex-wrap gap-1 justify-center">
                {badgeCount > 0 && (
                  <Badge variant="secondary" className="text-xs">
                    {badgeCount} {badgeCount > 1 ? t('library.filtersActive') : t('library.filterActive')}
                  </Badge>
                )}
                {filters.search && (
                  <Badge variant="secondary" className="text-xs">
                    {t('library.searchLabel')} "{filters.search}"
                  </Badge>
                )}
              </div>
            </div>
          )}
        </div>
      );
    }

    const gridClass = {
      grid: "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4",
      list: "space-y-2",
    }[viewMode];

    // Pagination
    const startIndex = (currentPage - 1) * itemsPerPage;
    const paginatedDocuments = documents.slice(startIndex, startIndex + itemsPerPage);
    const totalPages = Math.ceil(documents.length / itemsPerPage);

    return (
      <div className="space-y-8 pb-24" data-pagination-scroll-target>
        <div className={gridClass}>
          {paginatedDocuments.map((doc: any) => (
            <DocumentCard
              key={doc.id}
              document={doc}
              onAddToLibrary={() => {}}
              onArchive={handleArchiveDocument}
              onRestore={handleRestoreDocument}
              onDelete={handleDeleteDocument}
              isPublic={false}
              isExploreMode={false}
              userDocuments={allDocuments}
              viewMode={viewMode}
              docStats={docStats?.[doc.id] || null}
            />
          ))}
        </div>
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
        />
      </div>
    );
  }, [viewMode, filters, badgeCount, clearAllFilters, handleArchiveDocument, handleRestoreDocument, handleDeleteDocument, allDocuments, setIsModalOpen, docStats]);

  // Show login required message for non-authenticated users
  if (!authLoading && !isAuthenticated) {
    return (
      <Layout>
        <div className="min-h-[calc(100vh-64px)] flex items-center justify-center bg-muted/30 dark:bg-muted/10">
          <div className="max-w-md w-full px-6">
            <Alert className="mb-6">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t('library.loginRequired')}</AlertTitle>
              <AlertDescription>
                {t('library.loginRequiredDesc')}
                <br />
                {t('library.loginRequiredExplore')}
              </AlertDescription>
            </Alert>
            <div className="text-center">
              <Button onClick={() => setLocation('/explore')}>
                {t('library.goToExplore')}
              </Button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  // Show error state
  if (documentsError) {
    const errorMessage = documentsError?.message || t('library.unknownError');

    return (
      <Layout>
        <div className="min-h-screen bg-muted/30 dark:bg-muted/10">
          <PageHeader title={t('library.title')} />
          <div className="container mx-auto px-6 py-8">
            <Alert variant="destructive" className="mb-6">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t('library.loadError')}</AlertTitle>
              <AlertDescription>
                {t('library.loadErrorDesc')} {errorMessage}
                <br />
                {t('library.loadErrorHelp')}
              </AlertDescription>
            </Alert>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <PageShell scrollMode="page" maxWidth="standard">
        {/* Page Header */}
        <div className="py-8">
          <div className="mb-4">
            <h1 className="page-title mb-2 text-[30px]">
              {t('library.pageTitle') || 'Personal Library'}
            </h1>
            <p className="text-gray-500 dark:text-slate-400 text-[14px] mt-[2px] mb-[2px]">
              {t('library.pageSubtitle') || 'Manage and read your saved documents and insights.'}
            </p>
          </div>
        </div>

        {/* Hero Section - Today's Sentence (Slim Banner) */}
        <div className="-mx-6 lg:-mx-8 mb-6">
          <HeroSection />
        </div>

        {/* Resume Banner */}
        {resumeDoc && (
          <div
            className="mb-6 flex items-center justify-between px-4 py-3 border border-border shadow-sm rounded-xl cursor-pointer transition-all duration-200 hover:border-[hsl(var(--brand))]/40 hover:shadow-md hover:-translate-y-0.5 group"
            onClick={() => setLocation(`/viewer/${resumeDoc.id}`)}
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <BookOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              <span className="text-sm text-muted-foreground flex-shrink-0">{t('library.continueReading')}</span>
              <span className="text-sm font-medium text-foreground truncate">{resumeDoc.title}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0 ml-3">
              {(resumeDoc.progress || 0) > 0 && (
                <span className="text-[11px] text-muted-foreground tabular-nums">📖 {resumeDoc.progress}%</span>
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            </div>
          </div>
        )}

        {/* Controls - Single row layout like Explore page */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6 mt-8">
          <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
            {/* Search */}
            <div className="relative w-full sm:w-auto">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder={t('library.searchDocuments')}
                value={filters.search}
                onChange={(e) => updateFilters({ search: e.target.value })}
                className="pl-9 w-full sm:w-64"
              />
            </div>

            {/* View Mode Controls */}
            <ToggleGroup
              type="single"
              value={viewMode}
              onValueChange={handleViewModeChange}
            >
              <ToggleGroupItem value="grid" aria-label={t('library.gridView')}>
                <Grid3X3 className="h-4 w-4" />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label={t('library.listView')}>
                <List className="h-4 w-4" />
              </ToggleGroupItem>
            </ToggleGroup>

            {/* Sort Control */}
            <Select
              value={filters.sort}
              onValueChange={(value) => updateFilters({ sort: value as any })}
            >
              <SelectTrigger className="w-[120px] sm:w-[140px]">
                <ArrowUpDown className="h-4 w-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">{t('library.sortBy.recent')}</SelectItem>
                <SelectItem value="uploaded">{t('library.sortBy.uploaded')}</SelectItem>
                <SelectItem value="name">{t('library.sortBy.name')}</SelectItem>
                <SelectItem value="progress">{t('library.sortBy.progress')}</SelectItem>
              </SelectContent>
            </Select>

            {/* Filters Dropdown */}
            <FilterDropdown
              filters={filters}
              onFiltersChange={updateFilters}
              onReset={resetFilters}
              badgeCount={badgeCount}
              sourceCounts={countBySource(allDocuments || [])}
              documentCounts={{
                uploaded: uploadDocuments.length,
                saved: savedDocuments.length,
                rss: rssDocuments.length,
                categoryBreakdown
              }}
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button onClick={() => setIsModalOpen(true)} size="sm" data-testid="button-add-document" className="bg-[#2F5D50] hover:bg-[#2F5D50]/90 rounded-xl">
              <Plus className="h-4 w-4 mr-2" />
              {t('library.create')}
            </Button>
          </div>
        </div>

        <PageBody>
          {/* Filter Chips and Results Count */}
          <div className="space-y-3 mb-6">
            {filterChips.length > 0 && (
              <FilterChips
                chips={filterChips}
                onClearAll={clearAllFilters}
              />
            )}
          </div>

          {/* Documents Grid */}
          <DocumentGrid
            documents={filteredDocuments}
            loading={loadingDocuments}
          />
        </PageBody>
      </PageShell>

      {/* Text Content Modal */}
      <TextContentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddDocument}
      />

      {/* RSS Management Modal */}
      <Dialog open={isRSSModalOpen} onOpenChange={setIsRSSModalOpen}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rss className="h-5 w-5" />
              {t('library.rssManagement')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Add New RSS Feed Form */}
            <div className="border rounded-lg p-4">
              <h3 className="font-semibold mb-4">{t('library.addRSSFeed')}</h3>
              <div className="grid gap-4">
                <div>
                  <Label htmlFor="feedUrl">{t('library.rssFeedUrl')}</Label>
                  <Input
                    id="feedUrl"
                    value={rssFormData.feedUrl}
                    onChange={(e) => setRSSFormData(prev => ({ ...prev, feedUrl: e.target.value }))}
                    placeholder={t('library.rssUrlPlaceholder')}
                  />
                </div>
                <div>
                  <Label htmlFor="alias">{t('library.alias')}</Label>
                  <Input
                    id="alias"
                    value={rssFormData.alias}
                    onChange={(e) => setRSSFormData(prev => ({ ...prev, alias: e.target.value }))}
                    placeholder={t('library.aliasPlaceholder')}
                  />
                </div>
                <div>
                  <Label htmlFor="category">{t('library.category')}</Label>
                  <Select
                    value={rssFormData.category}
                    onValueChange={(value) => setRSSFormData(prev => ({ ...prev, category: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('library.selectCategory')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="News">{t('library.categories.news')}</SelectItem>
                      <SelectItem value="Literature">{t('library.categories.literature')}</SelectItem>
                      <SelectItem value="Academic">{t('library.categories.academic')}</SelectItem>
                      <SelectItem value="Opinion">{t('library.categories.opinion')}</SelectItem>
                      <SelectItem value="Other">{t('library.categories.other')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleAddRSSFeed}
                  disabled={!rssFormData.feedUrl}
                  className="w-full"
                >
                  {t('library.addRSSFeed')}
                </Button>
              </div>
            </div>

            {/* Existing RSS Feeds */}
            <div>
              <h3 className="font-semibold mb-4">{t('library.registeredFeedsCount', { count: (rssFeeds as any[])?.length || 0 })}</h3>
              <div className="space-y-4">
                {loadingFeeds ? (
                  <div className="text-center py-4">
                    <p className="text-muted-foreground">{t('library.loading')}</p>
                  </div>
                ) : rssFeeds && (rssFeeds as any[]).length > 0 ? (
                  (rssFeeds as any[]).map((feed: any) => (
                    <Card key={`rss-feed-${feed.id}`} className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-medium">{feed.alias || feed.feedUrl}</h4>
                            <Badge variant={feed.isActive ? "default" : "secondary"}>
                              {feed.isActive ? t('library.active') : t('library.inactive')}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-1">{feed.feedUrl}</p>
                          <div className="text-xs text-muted-foreground">
                            {t('library.categoryLabel')} {feed.category} | {t('library.languageLabel')} {feed.language} |
                            {t('library.syncLabel')} {feed.syncInterval}h
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSyncRSSFeed(feed.id)}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteRSSFeed(feed.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    </Card>
                  ))
                ) : (
                  <div className="text-center py-8">
                    <div className="bg-muted/50 rounded-full p-4 w-fit mx-auto mb-4">
                      <Rss className="h-8 w-8 text-muted-foreground" />
                    </div>
                    <p className="text-muted-foreground">{t('library.noRSSFeedsRegistered')}</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRSSModalOpen(false)}>
              {t('library.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}