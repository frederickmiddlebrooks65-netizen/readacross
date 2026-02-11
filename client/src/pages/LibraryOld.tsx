import React, { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import DocumentCard from "@/components/DocumentCard";
import TextContentModal from "@/components/TextContentModal";
import {
  LibraryIcon, Upload, BookmarkPlus, Rss, Search, Plus, Settings,
  ArrowUpDown, Filter, Grid3X3, List, Rows, BookOpen, RefreshCw, Trash2, Eye
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type ViewMode = 'grid' | 'list';
type SortOption = 'recent' | 'uploaded' | 'name' | 'progress';
type StatusFilter = 'active' | 'archived' | 'all';
type FileTypeFilter = 'all' | 'PDF' | 'DOCX' | 'TXT' | 'RSS';

export default function Library() {
  // State Management
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [showRSSModal, setShowRSSModal] = useState(false);
  const [showExploreModal, setShowExploreModal] = useState(false);
  const [documentTypeFilter, setDocumentTypeFilter] = useState<string>("all");
  const [searchTerm, setSearchTerm] = useState("");

  // Explore Modal States
  const [exploreSearch, setExploreSearch] = useState("");
  const [exploreCategory, setExploreCategory] = useState<string>("all");
  const [exploreSortBy, setExploreSortBy] = useState<string>("latest");

  // View Mode and Filtering States
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem('library-view-mode') as ViewMode) || 'grid';
  });
  const [uploadSortBy, setUploadSortBy] = useState<SortOption>('recent');
  const [uploadStatusFilter, setUploadStatusFilter] = useState<StatusFilter>('active');
  const [uploadFileTypeFilter, setUploadFileTypeFilter] = useState<FileTypeFilter>('all');
  const [selectedRSSFeed, setSelectedRSSFeed] = useState<string>('all');

  // RSS Form Data
  const [rssFormData, setRSSFormData] = useState({
    feedUrl: '',
    alias: '',
    category: 'RSS Feed',
    language: 'en',
    syncInterval: 12
  });

  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Archive/Restore/Delete Handlers
  const handleArchiveDocument = async (documentId: number) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/archive`, {
        method: 'POST',
      });

      if (response.ok) {
        toast({
          title: "Document archived",
          description: "Change filter to 'Archived' or 'All' to see archived documents.",
        });
        // Invalidate queries to refetch documents
        queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      } else {
        throw new Error('Failed to archive document');
      }
    } catch (error) {
      toast({
        title: "Archive failed",
        description: "An error occurred while archiving the document.",
        variant: "destructive",
      });
    }
  };

  const handleRestoreDocument = async (documentId: number) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/restore`, {
        method: 'POST',
      });

      if (response.ok) {
        toast({
          title: "Document restored",
          description: "The document has been restored to active status.",
        });
        // Invalidate queries to refetch documents
        queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      } else {
        throw new Error('Failed to restore document');
      }
    } catch (error) {
      toast({
        title: "Restore failed",
        description: "An error occurred while restoring the document.",
        variant: "destructive",
      });
    }
  };

  const handleDeleteDocument = async (documentId: number) => {
    try {
      const response = await fetch(`/api/documents/${documentId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast({
          title: "Document deleted",
          description: "The document has been permanently deleted.",
        });
        // Invalidate queries to refetch documents
        queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete document');
      }
    } catch (error) {
      toast({
        title: "Delete failed",
        description: error instanceof Error ? error.message : "An error occurred while deleting the document.",
        variant: "destructive",
      });
    }
  };

  // Data Queries
  const { data: uploadDocuments, isLoading: loadingUploads } = useQuery({
    queryKey: ['/api/documents', 'uploads'],
    queryFn: () => fetch('/api/documents?type=uploads').then(res => res.json())
  });

  const { data: savedDocuments, isLoading: loadingSaved } = useQuery({
    queryKey: ['/api/documents', 'saved'],
    queryFn: () => fetch('/api/documents?type=saved').then(res => res.json())
  });

  const { data: rssDocuments, isLoading: loadingRSS } = useQuery({
    queryKey: ['/api/documents', 'rss'],
    queryFn: () => fetch('/api/documents?type=rss').then(res => res.json())
  });

  const { data: rssFeeds, isLoading: isLoadingFeeds } = useQuery({
    queryKey: ['/api/rss-feeds'],
    queryFn: () => fetch('/api/rss-feeds').then(res => res.json())
  });

  const { data: exploreDocuments, isLoading: loadingExplore } = useQuery({
    queryKey: ['/api/library/explore', exploreCategory, exploreSortBy],
    queryFn: () => {
      const params = new URLSearchParams();
      if (exploreCategory !== 'all') params.set('category', exploreCategory);
      params.set('sortBy', exploreSortBy);
      return fetch(`/api/library/explore?${params}`).then(res => res.json());
    },
    enabled: showExploreModal
  });

  // Computed Values
  const totalDocuments = (uploadDocuments?.length || 0) + (savedDocuments?.length || 0) + (rssDocuments?.length || 0);

  // Archive counts for upload documents
  const uploadArchivedCount = uploadDocuments?.filter(doc => doc.isArchived).length || 0;
  const uploadActiveCount = uploadDocuments?.filter(doc => !doc.isArchived).length || 0;

  // Archive counts for saved documents
  const savedArchivedCount = savedDocuments?.filter(doc => doc.isArchived).length || 0;
  const savedActiveCount = savedDocuments?.filter(doc => !doc.isArchived).length || 0;

  // Archive counts for RSS documents
  const rssArchivedCount = rssDocuments?.filter(doc => doc.isArchived).length || 0;
  const rssActiveCount = rssDocuments?.filter(doc => !doc.isArchived).length || 0;

  // Filtered explore documents
  const filteredExploreDocuments = useMemo(() => {
    if (!exploreDocuments) return [];

    return exploreDocuments.filter((doc: any) => {
      const matchesSearch = exploreSearch === "" ||
        doc.title.toLowerCase().includes(exploreSearch.toLowerCase()) ||
        doc.author?.toLowerCase().includes(exploreSearch.toLowerCase()) ||
        doc.content?.toLowerCase().includes(exploreSearch.toLowerCase());

      return matchesSearch;
    });
  }, [exploreDocuments, exploreSearch]);

  // Filtered and sorted upload documents
  const filteredUploadDocuments = useMemo(() => {
    if (!uploadDocuments) return [];

    let filtered = uploadDocuments.filter((doc: any) => {
      const matchesSearch = searchTerm === "" ||
        doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.content?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = uploadStatusFilter === 'all' ||
        (uploadStatusFilter === 'active' && !doc.isArchived) ||
        (uploadStatusFilter === 'archived' && doc.isArchived);
      const matchesFileType = uploadFileTypeFilter === 'all' || doc.fileType === uploadFileTypeFilter;

      return matchesSearch && matchesStatus && matchesFileType;
    });

    // Sort documents
    filtered.sort((a: any, b: any) => {
      switch (uploadSortBy) {
        case 'name':
          return a.title.localeCompare(b.title);
        case 'uploaded':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'progress':
          return (b.progress || 0) - (a.progress || 0);
        case 'recent':
        default:
          return new Date(b.lastViewedAt || b.createdAt).getTime() - new Date(a.lastViewedAt || a.createdAt).getTime();
      }
    });

    return filtered;
  }, [uploadDocuments, searchTerm, uploadSortBy, uploadStatusFilter, uploadFileTypeFilter]);

  // Filtered and sorted saved documents
  const filteredSavedDocuments = useMemo(() => {
    if (!savedDocuments) return [];

    let filtered = savedDocuments.filter((doc: any) => {
      const matchesSearch = searchTerm === "" ||
        doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.content?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.author?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = uploadStatusFilter === 'all' ||
        (uploadStatusFilter === 'active' && !doc.isArchived) ||
        (uploadStatusFilter === 'archived' && doc.isArchived);

      return matchesSearch && matchesStatus;
    });

    // Sort documents
    filtered.sort((a: any, b: any) => {
      switch (uploadSortBy) {
        case 'name':
          return a.title.localeCompare(b.title);
        case 'uploaded':
          return new Date(b.savedAt || b.createdAt).getTime() - new Date(a.savedAt || a.createdAt).getTime();
        case 'progress':
          return (b.progress || 0) - (a.progress || 0);
        case 'recent':
        default:
          return new Date(b.lastViewedAt || b.createdAt).getTime() - new Date(a.lastViewedAt || a.createdAt).getTime();
      }
    });

    return filtered;
  }, [savedDocuments, searchTerm, uploadSortBy, uploadStatusFilter]);

  // Filtered and sorted RSS documents
  const filteredRSSDocuments = useMemo(() => {
    if (!rssDocuments) return [];

    let filtered = rssDocuments.filter((doc: any) => {
      const matchesSearch = searchTerm === "" ||
        doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.content?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.author?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesFeed = selectedRSSFeed === 'all' ||
        (doc.feedId && doc.feedId.toString() === selectedRSSFeed);

      const matchesStatus = uploadStatusFilter === 'all' ||
        (uploadStatusFilter === 'active' && !doc.isArchived) ||
        (uploadStatusFilter === 'archived' && doc.isArchived);

      return matchesSearch && matchesFeed && matchesStatus;
    });

    // Sort documents
    filtered.sort((a: any, b: any) => {
      switch (uploadSortBy) {
        case 'name':
          return a.title.localeCompare(b.title);
        case 'uploaded':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'progress':
          return (b.progress || 0) - (a.progress || 0);
        case 'recent':
        default:
          return new Date(b.lastViewedAt || b.createdAt).getTime() - new Date(a.lastViewedAt || a.createdAt).getTime();
      }
    });

    return filtered;
  }, [rssDocuments, searchTerm, uploadSortBy, selectedRSSFeed, uploadStatusFilter]);

  // Event Handlers
  const handleViewModeChange = (value: ViewMode) => {
    setViewMode(value);
    localStorage.setItem('library-view-mode', value);
  };

  const handleAddDocument = async (title: string, content: string, sourceLanguage: string, targetLanguage: string) => {
    try {
      const response = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, sourceLanguage, targetLanguage, type: 'upload' })
      });

      if (response.ok) {
        toast({ title: "Document added successfully." });
        setIsModalOpen(false);
      } else {
        throw new Error('Failed to add document');
      }
    } catch (error) {
      toast({ title: "Error adding document.", variant: "destructive" });
    }
  };

  const handleAddToLibrary = async (documentId: number) => {
    try {
      const response = await fetch(`/api/documents/${documentId}/save`, {
        method: 'POST',
      });

      if (response.ok) {
        toast({ title: "Document saved to library." });
      }
    } catch (error) {
      toast({ title: "Error saving document.", variant: "destructive" });
    }
  };

  const handleSyncFeed = async (feedId: number) => {
    try {
      const response = await fetch(`/api/rss-feeds/${feedId}/sync`, {
        method: 'POST',
      });

      if (response.ok) {
        toast({ title: "RSS feed synced." });
      }
    } catch (error) {
      toast({ title: "Error syncing RSS feed.", variant: "destructive" });
    }
  };

  const handleDeleteFeed = async (feedId: number) => {
    try {
      const response = await fetch(`/api/rss-feeds/${feedId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast({ title: "RSS feed deleted." });
      }
    } catch (error) {
      toast({ title: "Error deleting RSS feed.", variant: "destructive" });
    }
  };

  // Component Helpers
  const handleCategoryChange = (value: string) => {
    setExploreCategory(value);
  };

  const SectionHeader = ({ title, icon: Icon, count, children }: any) => (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5" />
        <span>{title}</span>
        <Badge variant="outline">{count}</Badge>
      </div>
      {children && (
        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );

  const DocumentGrid = ({ documents, loading }: { documents: any[], loading: boolean }) => {
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
      return (
        <div className="text-center py-12">
          <div className="bg-muted/50 rounded-full p-6 w-fit mx-auto mb-6">
            <BookOpen className="h-12 w-12 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold text-foreground mb-4">
            No documents yet
          </h3>
          <p className="text-muted-foreground mb-6">
            Start building your library by uploading your first document.
          </p>
          <Button onClick={() => setIsModalOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Upload File
          </Button>
        </div>
      );
    }

    const gridClass = {
      grid: "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4",
      list: "space-y-2"
    }[viewMode];

    return (
      <div className={gridClass}>
        {documents.map((doc: any) => (
          <DocumentCard
            key={doc.id}
            document={doc}
            onAddToLibrary={handleAddToLibrary}
            onArchive={handleArchiveDocument}
            onRestore={handleRestoreDocument}
            onDelete={handleDeleteDocument}
            isPublic={false}
            userDocuments={[...(uploadDocuments || []), ...(savedDocuments || []), ...(rssDocuments || [])]}
            viewMode={viewMode}
          />
        ))}
      </div>
    );
  };

  // Placeholder for counts that are not explicitly defined but used in SelectContent
  const allActiveCount = (uploadDocuments?.filter(doc => !doc.isArchived).length || 0) + (savedDocuments?.filter(doc => !doc.isArchived).length || 0) + (rssDocuments?.filter(doc => !doc.isArchived).length || 0);
  const allArchivedCount = uploadArchivedCount + savedArchivedCount + rssArchivedCount;
  const allDocuments = [...(uploadDocuments || []), ...(savedDocuments || []), ...(rssDocuments || [])];
  const filteredAllDocuments = useMemo(() => {
    return allDocuments.filter((doc: any) => {
      const matchesSearch = searchTerm === "" ||
        doc.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        doc.content?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = uploadStatusFilter === 'all' ||
        (uploadStatusFilter === 'active' && !doc.isArchived) ||
        (uploadStatusFilter === 'archived' && doc.isArchived);

      return matchesSearch && matchesStatus;
    });
  }, [allDocuments, searchTerm, uploadStatusFilter]);


  return (
    <Layout>
      <div className="flex flex-col h-full">
        <div className="flex-1 overflow-y-auto bg-background">
          {/* Hero Section */}
          <div className="bg-gradient-to-br from-blue-50 via-white to-purple-50 dark:from-blue-950/20 dark:via-background dark:to-purple-950/20 border-b">
            <div className="max-w-7xl mx-auto px-6 py-12">
              <div className="text-center max-w-3xl mx-auto">
                <div className="flex justify-center mb-6">
                  <div className="bg-primary/10 rounded-full p-4">
                    <LibraryIcon className="h-12 w-12 text-primary" />
                  </div>
                </div>
                <h1 className="text-4xl font-bold text-foreground mb-4">
                  ReadAcross Library
                </h1>
                <p className="text-lg text-muted-foreground mb-8">
                  Manage your documents and explore curated reading content for language learning
                </p>
              </div>
            </div>
          </div>

          {/* Enhanced Library Interface - Tab Layout */}
          <div className="max-w-7xl mx-auto px-6 py-8">
            <Tabs defaultValue="uploads" className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="uploads">Uploaded ({uploadDocuments?.length || 0})</TabsTrigger>
                <TabsTrigger value="saved">Saved ({savedDocuments?.length || 0})</TabsTrigger>
                <TabsTrigger value="rss-feeds">RSS Feeds ({rssDocuments?.length || 0})</TabsTrigger>
              </TabsList>

              {/* Uploads Tab */}
              <TabsContent value="uploads" className="mt-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    {/* Document Type Filter */}
                    <Select value={documentTypeFilter} onValueChange={setDocumentTypeFilter}>
                      <SelectTrigger className="w-[140px]">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="All Documents" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Documents</SelectItem>
                        <SelectItem value="uploaded">Uploaded ({uploadDocuments?.length || 0})</SelectItem>
                        <SelectItem value="saved">Saved ({savedDocuments?.length || 0})</SelectItem>
                      </SelectContent>
                    </Select>

                    {/* View Mode Controls */}
                    <ToggleGroup type="single" value={viewMode} onValueChange={handleViewModeChange}>
                      <ToggleGroupItem value="grid" aria-label="Grid view">
                        <Grid3X3 className="h-4 w-4" />
                      </ToggleGroupItem>
                      <ToggleGroupItem value="list" aria-label="List view">
                        <List className="h-4 w-4" />
                      </ToggleGroupItem>
                    </ToggleGroup>

                    {/* Sorting and Filtering Controls */}
                    <Select value={uploadSortBy} onValueChange={(value) => setUploadSortBy(value as SortOption)}>
                      <SelectTrigger className="w-[140px]">
                        <ArrowUpDown className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Sort by" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="recent">Recent</SelectItem>
                        <SelectItem value="uploaded">Upload Date</SelectItem>
                        <SelectItem value="name">Name</SelectItem>
                        <SelectItem value="progress">Progress</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={uploadStatusFilter} onValueChange={(value) => setUploadStatusFilter(value as StatusFilter)}>
                      <SelectTrigger className="w-[140px]">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active ({uploadActiveCount})</SelectItem>
                        <SelectItem value="archived">Archived ({uploadArchivedCount})</SelectItem>
                        <SelectItem value="all">All ({uploadDocuments?.length || 0})</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={uploadFileTypeFilter} onValueChange={(value) => setUploadFileTypeFilter(value as FileTypeFilter)}>
                      <SelectTrigger className="w-[140px]">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="File Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value="PDF">PDF</SelectItem>
                        <SelectItem value="DOCX">DOCX</SelectItem>
                        <SelectItem value="TXT">TXT</SelectItem>
                        <SelectItem value="RSS">RSS</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button onClick={() => setIsModalOpen(true)} size="sm">
                    <Plus className="h-4 w-4 mr-2" />
                    Upload File
                  </Button>
                </div>

                {/* Section Search */}
                <div className="relative mb-6">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search uploaded documents..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>

                {/* Documents Grid */}
                <DocumentGrid documents={filteredUploadDocuments} loading={loadingUploads} />
              </TabsContent>

              {/* Saved Tab */}
              <TabsContent value="saved" className="mt-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    {/* View Mode Controls */}
                    <ToggleGroup type="single" value={viewMode} onValueChange={handleViewModeChange}>
                      <ToggleGroupItem value="grid" aria-label="Grid view">
                        <Grid3X3 className="h-4 w-4" />
                      </ToggleGroupItem>
                      <ToggleGroupItem value="list" aria-label="List view">
                        <List className="h-4 w-4" />
                      </ToggleGroupItem>
                    </ToggleGroup>

                    {/* Sorting Controls */}
                    <Select value={uploadSortBy} onValueChange={(value) => setUploadSortBy(value as SortOption)}>
                      <SelectTrigger className="w-[140px]">
                        <ArrowUpDown className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Sort by" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="recent">Recent</SelectItem>
                        <SelectItem value="uploaded">Save Date</SelectItem>
                        <SelectItem value="name">Name</SelectItem>
                        <SelectItem value="progress">Progress</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={uploadStatusFilter} onValueChange={(value) => setUploadStatusFilter(value as StatusFilter)}>
                      <SelectTrigger className="w-[120px]">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active ({savedActiveCount})</SelectItem>
                        <SelectItem value="archived">Archived ({savedArchivedCount})</SelectItem>
                        <SelectItem value="all">All ({savedDocuments?.length || 0})</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    onClick={() => setShowExploreModal(true)}
                    size="sm"
                    variant="outline"
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Explore to Save
                  </Button>
                </div>

                {/* Section Search */}
                <div className="relative mb-6">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search saved documents..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>

                <DocumentGrid documents={filteredSavedDocuments} loading={loadingSaved} />
              </TabsContent>

              {/* RSS Feeds Tab */}
              <TabsContent value="rss-feeds" className="mt-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-4">
                    {/* View Mode Controls */}
                    <ToggleGroup type="single" value={viewMode} onValueChange={handleViewModeChange}>
                      <ToggleGroupItem value="grid" aria-label="Grid view">
                        <Grid3X3 className="h-4 w-4" />
                      </ToggleGroupItem>
                      <ToggleGroupItem value="list" aria-label="List view">
                        <List className="h-4 w-4" />
                      </ToggleGroupItem>
                    </ToggleGroup>

                    {/* Sorting and RSS Feed Filter Controls */}
                    <Select value={uploadSortBy} onValueChange={(value) => setUploadSortBy(value as SortOption)}>
                      <SelectTrigger className="w-[140px]">
                        <ArrowUpDown className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Sort by" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="recent">Recent</SelectItem>
                        <SelectItem value="uploaded">Feed Date</SelectItem>
                        <SelectItem value="name">Name</SelectItem>
                        <SelectItem value="progress">Progress</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={selectedRSSFeed} onValueChange={setSelectedRSSFeed}>
                      <SelectTrigger className="w-[120px]">
                        <Rss className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="All Feeds" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Feeds</SelectItem>
                        {rssFeeds?.map((feed: any) => (
                          <SelectItem key={feed.id} value={feed.id.toString()}>
                            {feed.alias}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select value={uploadStatusFilter} onValueChange={(value) => setUploadStatusFilter(value as StatusFilter)}>
                      <SelectTrigger className="w-[120px]">
                        <Filter className="h-4 w-4 mr-2" />
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active ({rssActiveCount})</SelectItem>
                        <SelectItem value="archived">Archived ({rssArchivedCount})</SelectItem>
                        <SelectItem value="all">All ({rssDocuments?.length || 0})</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button onClick={() => setShowRSSModal(true)} size="sm" variant="outline">
                    <Settings className="h-4 w-4 mr-2" />
                    Manage RSS Feeds
                  </Button>
                </div>

                {/* Section Search */}
                <div className="relative mb-6">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search RSS feed documents..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9"
                  />
                </div>

                <DocumentGrid documents={filteredRSSDocuments} loading={loadingRSS} />
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>

      {/* Text Content Modal */}
      <TextContentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddDocument}
      />

      {/* Enhanced Explore Modal with Full Functionality */}
      <Dialog open={showExploreModal} onOpenChange={setShowExploreModal}>
        <DialogContent className="max-w-7xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BookOpen className="h-5 w-5" />
              Explore Documents to Save
            </DialogTitle>
            <DialogDescription>
              Discover curated content from public sources for reading practice
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            {/* Search Bar */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by title, author, or content..."
                value={exploreSearch}
                onChange={(e) => setExploreSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-4">
              <Select value={exploreCategory} onValueChange={handleCategoryChange}>
                <SelectTrigger className="w-[180px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  <SelectItem value="News">News</SelectItem>
                  <SelectItem value="Literature">Literature</SelectItem>
                  <SelectItem value="Academic">Academic</SelectItem>
                  <SelectItem value="Opinion">Opinion</SelectItem>
                  <SelectItem value="Other">Other</SelectItem>
                </SelectContent>
              </Select>

              <Select value={exploreSortBy} onValueChange={setExploreSortBy}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Sort by" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">Latest</SelectItem>
                  <SelectItem value="title">Title</SelectItem>
                  <SelectItem value="author">Author</SelectItem>
                </SelectContent>
              </Select>

              <div className="text-sm text-muted-foreground flex items-center">
                {filteredExploreDocuments.length} documents found
              </div>
            </div>

            {/* Documents Grid */}
            {loadingExplore ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
                {[...Array(12)].map((_, i) => (
                  <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
                ))}
              </div>
            ) : filteredExploreDocuments && filteredExploreDocuments.length > 0 ? (
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-3">
                {filteredExploreDocuments.map((doc: any) => (
                  <DocumentCard
                    key={doc.id}
                    document={doc}
                    onAddToLibrary={handleAddToLibrary}
                    isPublic={true}
                    viewMode="grid"
                    userDocuments={[
                      ...(uploadDocuments || []),
                      ...(savedDocuments || []),
                      ...(rssDocuments || [])
                    ]}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="bg-muted/50 rounded-full p-6 w-fit mx-auto mb-6">
                  <BookOpen className="h-12 w-12 text-muted-foreground" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-4">
                  {exploreSearch ? "No search results" : "No documents to explore"}
                </h3>
                <p className="text-muted-foreground">
                  {exploreSearch ? "Try a different search term." : "Please check back later."}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExploreModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* RSS Management Modal */}
      <Dialog open={showRSSModal} onOpenChange={setShowRSSModal}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rss className="h-5 w-5" />
              RSS Feed Management
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Add New RSS Feed Form */}
            <div className="border rounded-lg p-4">
              <h3 className="font-semibold mb-4">Add New RSS Feed</h3>
              <div className="grid gap-4">
                <div>
                  <Label htmlFor="feedUrl">RSS Feed URL</Label>
                  <Input
                    id="feedUrl"
                    value={rssFormData.feedUrl}
                    onChange={(e) => setRSSFormData(prev => ({ ...prev, feedUrl: e.target.value }))}
                    placeholder="https://example.com/rss.xml"
                  />
                </div>
                <div>
                  <Label htmlFor="alias">Alias</Label>
                  <Input
                    id="alias"
                    value={rssFormData.alias}
                    onChange={(e) => setRSSFormData(prev => ({ ...prev, alias: e.target.value }))}
                    placeholder="Feed Name"
                  />
                </div>
                <Button
                  onClick={() => {/* Add RSS feed logic */}}
                  disabled={!rssFormData.feedUrl || !rssFormData.alias}
                  className="w-full"
                >
                  Add RSS Feed
                </Button>
              </div>
            </div>

            {/* Existing RSS Feeds */}
            <div>
              <h3 className="font-semibold mb-4">Registered RSS Feeds ({rssFeeds?.length || 0})</h3>
              <div className="space-y-4">
                {isLoadingFeeds ? (
                  <div className="text-center py-4">
                    <p className="text-muted-foreground">Loading...</p>
                  </div>
                ) : rssFeeds && rssFeeds.length > 0 ? (
                  rssFeeds.map((feed: any) => (
                    <Card key={feed.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-medium">{feed.alias}</h4>
                            <Badge variant={feed.isActive ? "default" : "secondary"}>
                              {feed.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground mb-1">{feed.feedUrl}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSyncFeed(feed.id)}
                          >
                            <RefreshCw className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteFeed(feed.id)}
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
                    <p className="text-muted-foreground">No RSS feeds registered.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRSSModal(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}