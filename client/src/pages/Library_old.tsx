import React, { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Layout from "@/components/Layout";
import DocumentCard from "@/components/DocumentCard";
import TextContentModal from "@/components/TextContentModal";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Library as LibraryIcon, BookOpen, Upload, Heart, Rss, Search, Settings, RefreshCw, Trash2, Edit, Download, Grid, List, SlidersHorizontal, Calendar, Clock, FileText, Filter, ArrowUpDown, Eye, Maximize2, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { LibraryDocument, PublicLibraryDocument } from "@/lib/types";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type ViewMode = 'grid' | 'list';
type SortOption = 'recent' | 'uploaded' | 'name' | 'progress';
type StatusFilter = 'all' | 'completed' | 'processing' | 'error';
type FileTypeFilter = 'all' | 'PDF' | 'DOCX' | 'TXT' | 'RSS';

// Enhanced Library UI/UX with accordion sections, mini navigation, and advanced controls
export default function Library() {
  const [, setLocation] = useLocation();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("latest");
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [showRSSModal, setShowRSSModal] = useState(false);
  const [editingFeed, setEditingFeed] = useState<any>(null);
  const [selectedFeedId, setSelectedFeedId] = useState<number | undefined>(undefined);
  const [rssFormData, setRSSFormData] = useState({
    feedUrl: '',
    alias: '',
    category: 'RSS Feed',
    language: 'en',
    syncInterval: 12
  });

  // New UI state management
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    return (localStorage.getItem('library-view-mode') as ViewMode) || 'grid';
  });
  const [compactMode, setCompactMode] = useState(() => {
    return localStorage.getItem('library-compact-mode') === 'true';
  });
  const [uploadSortBy, setUploadSortBy] = useState<SortOption>(() => {
    return (localStorage.getItem('library-upload-sort') as SortOption) || 'recent';
  });
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [fileTypeFilter, setFileTypeFilter] = useState<FileTypeFilter>('all');
  const [showExploreModal, setShowExploreModal] = useState(false);
  const [activeAccordion, setActiveAccordion] = useState<string[]>(['my-uploads']);

  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Save preferences to localStorage
  useEffect(() => {
    localStorage.setItem('library-view-mode', viewMode);
  }, [viewMode]);

  useEffect(() => {
    localStorage.setItem('library-compact-mode', compactMode.toString());
  }, [compactMode]);

  useEffect(() => {
    localStorage.setItem('library-upload-sort', uploadSortBy);
  }, [uploadSortBy]);

  // Utility function to sort and filter documents
  const sortDocuments = (docs: LibraryDocument[], sortBy: SortOption): LibraryDocument[] => {
    if (!docs) return [];
    
    return [...docs].sort((a, b) => {
      switch (sortBy) {
        case 'recent':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'uploaded':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'name':
          return a.title.localeCompare(b.title);
        case 'progress':
          return (b.progress || 0) - (a.progress || 0);
        default:
          return 0;
      }
    });
  };

  const filterDocuments = (docs: LibraryDocument[], statusFilter: StatusFilter, fileTypeFilter: FileTypeFilter): LibraryDocument[] => {
    if (!docs) return [];
    
    let filtered = docs;
    
    if (statusFilter !== 'all') {
      filtered = filtered.filter(doc => {
        const progress = doc.progress || 0;
        switch (statusFilter) {
          case 'completed':
            return progress >= 100;
          case 'processing':
            return progress > 0 && progress < 100;
          case 'error':
            return progress === 0; // Assuming 0 progress means error or not started
          default:
            return true;
        }
      });
    }
    
    if (fileTypeFilter !== 'all') {
      filtered = filtered.filter(doc => {
        const fileType = doc.fileType?.toUpperCase();
        return fileType === fileTypeFilter;
      });
    }
    
    return filtered;
  };

  // Separate queries for each document type
  const { data: rawUploadDocuments, isLoading: isLoadingUploads } = useQuery<LibraryDocument[]>({
    queryKey: ["/api/documents", "uploads", searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("type", "uploads");
      if (searchTerm.trim()) params.append("search", searchTerm);
      params.append("sortBy", "activity");

      const response = await fetch(`/api/documents?${params}`);
      if (!response.ok) throw new Error("Failed to fetch upload documents");
      return response.json();
    },
  });

  // Process upload documents with sorting and filtering
  const uploadDocuments = React.useMemo(() => {
    if (!rawUploadDocuments) return [];
    const filtered = filterDocuments(rawUploadDocuments, statusFilter, fileTypeFilter);
    return sortDocuments(filtered, uploadSortBy);
  }, [rawUploadDocuments, statusFilter, fileTypeFilter, uploadSortBy]);

  const { data: savedDocuments, isLoading: isLoadingSaved } = useQuery<LibraryDocument[]>({
    queryKey: ["/api/documents", "saved", searchTerm],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("type", "saved");
      if (searchTerm.trim()) params.append("search", searchTerm);
      params.append("sortBy", "activity");

      const response = await fetch(`/api/documents?${params}`);
      if (!response.ok) throw new Error("Failed to fetch saved documents");
      return response.json();
    },
  });

  const { data: rssDocuments, isLoading: isLoadingRSS } = useQuery<LibraryDocument[]>({
    queryKey: ["/api/documents", "rss", searchTerm, selectedFeedId],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.append("type", "rss");
      if (searchTerm.trim()) params.append("search", searchTerm);
      if (selectedFeedId) params.append("feedId", selectedFeedId.toString());
      params.append("sortBy", "activity");

      const response = await fetch(`/api/documents?${params}`);
      if (!response.ok) throw new Error("Failed to fetch RSS documents");
      return response.json();
    },
  });

  const { data: publicDocuments, isLoading: isLoadingPublic } = useQuery<PublicLibraryDocument[]>({
    queryKey: ["/api/library/explore", selectedCategory, sortBy],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedCategory && selectedCategory !== "all") params.append("category", selectedCategory);
      if (sortBy) params.append("sortBy", sortBy);

      const response = await fetch(`/api/library/explore?${params}`);
      if (!response.ok) throw new Error("Failed to fetch public documents");
      return response.json();
    },
  });

  // RSS feeds query
  const { data: rssFeeds, isLoading: isLoadingFeeds } = useQuery({
    queryKey: ["/api/rss-feeds"],
    queryFn: async () => {
      const response = await fetch("/api/rss-feeds");
      if (!response.ok) throw new Error("Failed to fetch RSS feeds");
      return response.json();
    },
  });

  const createDocumentMutation = useMutation({
    mutationFn: async ({ title, content, sourceLanguage }: {
      title: string;
      content: string;
      sourceLanguage: string;
    }) => {
      const response = await apiRequest("/api/documents/create-from-text", "POST", {
        title,
        content,
        sourceLanguage,
      });
      return response;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({
        title: "문서 생성 완료",
        description: `"${data.title}" 문서가 성공적으로 생성되었습니다.`,
      });
      setLocation(`/viewer/${data.id}`);
    },
    onError: (error) => {
      toast({
        title: "문서 생성 실패",
        description: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다",
        variant: "destructive",
      });
    },
  });

  const deleteDocumentMutation = useMutation({
    mutationFn: async (documentId: number) => {
      const response = await apiRequest(`/api/documents/${documentId}`, "DELETE");
      return response;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({
        title: "문서 삭제 완료",
        description: "문서가 성공적으로 삭제되었습니다.",
      });
    },
    onError: (error) => {
      toast({
        title: "문서 삭제 실패",
        description: error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다",
        variant: "destructive",
      });
    },
  });

  const addToLibraryMutation = useMutation({
    mutationFn: async (documentId: number) => {
      const response = await fetch(`/api/documents/${documentId}/add-to-library`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
      });

      const data = await response.json();

      if (!response.ok) {
        // Handle 409 conflict (document already exists)
        if (response.status === 409) {
          throw new Error(`DUPLICATE:${data.message}:${data.existingId}`);
        }
        throw new Error(data.message || "Failed to add document to library");
      }

      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      queryClient.invalidateQueries({ queryKey: ["/api/library/explore"] });
      toast({
        title: "라이브러리에 추가 완료",
        description: `"${data.title}" 문서가 나의 라이브러리에 추가되었습니다.`,
      });
    },
    onError: (error: any) => {
      let title = "라이브러리 추가 실패";
      let message = "알 수 없는 오류가 발생했습니다";
      let variant: "default" | "destructive" = "destructive";

      if (error instanceof Error) {
        if (error.message.startsWith("DUPLICATE:")) {
          const [, duplicateMessage, existingId] = error.message.split(":");
          title = "이미 추가된 문서";
          message = "이 문서는 이미 나의 라이브러리에 있습니다.";
          variant = "default";

          // Optionally navigate to the existing document
          if (existingId) {
            setTimeout(() => {
              setLocation(`/viewer/${existingId}`);
            }, 1500);
            message += " 잠시 후 해당 문서로 이동합니다.";
          }
        } else {
          message = error.message || "문서 추가 중 오류가 발생했습니다.";
        }
      }

      toast({
        title,
        description: message,
        variant,
      });
    },
  });

  // RSS feed mutations
  const createRSSFeedMutation = useMutation({
    mutationFn: async (feedData: typeof rssFormData) => {
      return await apiRequest("/api/rss-feeds", "POST", feedData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rss-feeds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      setShowRSSModal(false);
      resetRSSForm();
      toast({
        title: "RSS 피드 추가 완료",
        description: "RSS 피드가 성공적으로 추가되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "RSS 피드 추가 실패",
        description: error.message || "RSS 피드 추가 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const deleteRSSFeedMutation = useMutation({
    mutationFn: async (feedId: number) => {
      return await apiRequest(`/api/rss-feeds/${feedId}`, "DELETE");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rss-feeds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({
        title: "RSS 피드 삭제 완료",
        description: "RSS 피드가 성공적으로 삭제되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "RSS 피드 삭제 실패",
        description: error.message || "RSS 피드 삭제 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const syncRSSFeedMutation = useMutation({
    mutationFn: async (feedId: number) => {
      return await apiRequest(`/api/rss-feeds/${feedId}/sync`, "POST");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/rss-feeds"] });
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({
        title: "동기화 완료",
        description: "RSS 피드가 성공적으로 동기화되었습니다.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "동기화 실패",
        description: error.message || "RSS 피드 동기화 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleAddDocument = async (title: string, content: string, sourceLanguage: string) => {
    await createDocumentMutation.mutateAsync({ title, content, sourceLanguage });
  };

  const handleDeleteDocument = async (documentId: number) => {
    await deleteDocumentMutation.mutateAsync(documentId);
  };

  const handleAddToLibrary = async (documentId: number) => {
    await addToLibraryMutation.mutateAsync(documentId);
  };

  const resetRSSForm = () => {
    setRSSFormData({
      feedUrl: '',
      alias: '',
      category: 'RSS Feed',
      language: 'en',
      syncInterval: 12
    });
    setEditingFeed(null);
  };

  const handleDeleteFeed = async (feedId: number) => {
    if (window.confirm('정말로 이 RSS 피드를 삭제하시겠습니까?')) {
      await deleteRSSFeedMutation.mutateAsync(feedId);
    }
  };

  const handleSyncFeed = async (feedId: number) => {
    await syncRSSFeedMutation.mutateAsync(feedId);
  };

  const LoadingBookCard = () => (
    <div className="animate-pulse">
      <div className="aspect-[3/4] bg-gray-200 rounded-lg mb-3"></div>
      <div className="h-4 bg-gray-200 rounded mb-2"></div>
      <div className="h-3 bg-gray-200 rounded w-3/4"></div>
    </div>
  );

  const AddNewBookCard = () => (
    <div
      className="group cursor-pointer transform transition-all duration-200 hover:scale-105"
      onClick={() => setIsModalOpen(true)}
    >
      <Card className="border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 transition-colors duration-200">
        <div className="aspect-[3/4] flex flex-col items-center justify-center text-muted-foreground group-hover:text-primary transition-colors">
          <div className="bg-muted/50 rounded-full p-4 mb-3 group-hover:bg-primary/10 transition-colors">
            <Plus className="h-8 w-8" />
          </div>
          <span className="text-sm font-medium">Add New Document</span>
        </div>
      </Card>
      <div className="mt-3 px-1">
        <h4 className="font-medium text-sm text-muted-foreground group-hover:text-primary transition-colors">
          새 문서 추가
        </h4>
        <p className="text-xs text-muted-foreground mt-1">
          텍스트 붙여넣기 또는 파일 업로드
        </p>
      </div>
    </div>
  );

  const DocumentSection = ({
    title,
    icon: Icon,
    documents,
    isLoading,
    emptyMessage,
    showAddNew = false,
    count,
    filterComponent
  }: {
    title: string;
    icon: any;
    documents: LibraryDocument[] | undefined;
    isLoading: boolean;
    emptyMessage: string;
    showAddNew?: boolean;
    count?: number;
    filterComponent?: React.ReactNode;
  }) => (
    <Card className="mb-6">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Icon className="h-5 w-5" />
            {title}
            {count !== undefined && (
              <Badge variant="secondary" className="ml-2">
                {count}
              </Badge>
            )}
          </CardTitle>
          {filterComponent && (
            <div className="flex items-center gap-2">
              {filterComponent}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
          {showAddNew && <AddNewBookCard />}

          {isLoading ? (
            <>
              <LoadingBookCard />
              <LoadingBookCard />
              <LoadingBookCard />
            </>
          ) : documents && documents.length > 0 ? (
            documents.map((doc) => (
              <DocumentCard key={doc.id} document={doc} onDelete={handleDeleteDocument} />
            ))
          ) : null}
        </div>

        {!isLoading && (!documents || documents.length === 0) && !showAddNew && (
          <div className="text-center py-8">
            <div className="bg-muted/50 rounded-full p-4 w-fit mx-auto mb-4">
              <Icon className="h-8 w-8 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground">{emptyMessage}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );

  // Scroll to section utility
  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ 
        behavior: 'smooth',
        block: 'start',
        inline: 'nearest'
      });
    }
  };

  // Mini Navigation Component
  const MiniNavigation = () => (
    <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b mb-6">
      <div className="max-w-7xl mx-auto px-6 py-3">
        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center justify-center gap-6">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => scrollToSection('my-uploads')}
            className="flex items-center gap-2"
          >
            <Upload className="h-4 w-4" />
            내 업로드
            <Badge variant="secondary" className="ml-1">
              {uploadDocuments?.length || 0}
            </Badge>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => scrollToSection('saved')}
            className="flex items-center gap-2"
          >
            <Heart className="h-4 w-4" />
            저장됨
            <Badge variant="secondary" className="ml-1">
              {savedDocuments?.length || 0}
            </Badge>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => scrollToSection('rss-feeds')}
            className="flex items-center gap-2"
          >
            <Rss className="h-4 w-4" />
            RSS 피드
            <Badge variant="secondary" className="ml-1">
              {rssDocuments?.length || 0}
            </Badge>
          </Button>
        </div>
        
        {/* Mobile Segment Control */}
        <div className="md:hidden">
          <ToggleGroup 
            type="single" 
            value="my-uploads" 
            className="justify-center w-full"
            onValueChange={(value) => {
              if (value) scrollToSection(value);
            }}
          >
            <ToggleGroupItem value="my-uploads" className="flex-1">
              <Upload className="h-4 w-4 mr-1" />
              업로드 ({uploadDocuments?.length || 0})
            </ToggleGroupItem>
            <ToggleGroupItem value="saved" className="flex-1">
              <Heart className="h-4 w-4 mr-1" />
              저장 ({savedDocuments?.length || 0})
            </ToggleGroupItem>
            <ToggleGroupItem value="rss-feeds" className="flex-1">
              <Rss className="h-4 w-4 mr-1" />
              RSS ({rssDocuments?.length || 0})
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </div>
  );

  // Enhanced Section Header Component
  const SectionHeader = ({ 
    title, 
    icon: Icon, 
    count, 
    children 
  }: { 
    title: string;
    icon: any;
    count?: number;
    children?: React.ReactNode;
  }) => (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5" />
        <h3 className="text-xl font-semibold">{title}</h3>
        {count !== undefined && (
          <Badge variant="secondary" className="ml-2">
            {count}
          </Badge>
        )}
      </div>
      {children && (
        <div className="flex items-center gap-2">
          {children}
        </div>
      )}
    </div>
  );

  // View Mode Controls Component
  const ViewModeControls = () => (
    <div className="flex items-center gap-2">
      <ToggleGroup 
        type="single" 
        value={viewMode} 
        onValueChange={(value) => value && setViewMode(value as ViewMode)}
      >
        <ToggleGroupItem value="grid" size="sm">
          <Grid className="h-4 w-4" />
        </ToggleGroupItem>
        <ToggleGroupItem value="list" size="sm">
          <List className="h-4 w-4" />
        </ToggleGroupItem>
      </ToggleGroup>
      <Button
        variant={compactMode ? "default" : "outline"}
        size="sm"
        onClick={() => setCompactMode(!compactMode)}
        className="px-2"
      >
        <Maximize2 className="h-4 w-4" />
      </Button>
    </div>
  );



  // Enhanced Document Grid/List Component
  const DocumentDisplay = ({ 
    documents, 
    isLoading, 
    emptyMessage, 
    showAddNew = false,
    onDelete 
  }: {
    documents: LibraryDocument[];
    isLoading: boolean;
    emptyMessage: string;
    showAddNew?: boolean;
    onDelete?: (id: number) => void;
  }) => {
    const LoadingBookCard = () => (
      <div className="animate-pulse">
        <div className={cn(
          "bg-muted rounded-lg mb-3",
          viewMode === 'grid' ? "aspect-[3/4]" : "h-16",
          compactMode && viewMode === 'grid' ? "aspect-[4/3]" : ""
        )}></div>
        <div className="h-4 bg-muted rounded mb-2"></div>
        <div className="h-3 bg-muted rounded w-3/4"></div>
      </div>
    );

    if (viewMode === 'list') {
      return (
        <div className="space-y-2">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-muted/30 rounded-lg text-sm font-medium text-muted-foreground">
            <div className="col-span-5">제목</div>
            <div className="col-span-2">출처</div>
            <div className="col-span-2">상태</div>
            <div className="col-span-2">최근 수정</div>
            <div className="col-span-1">작업</div>
          </div>
          
          {isLoading ? (
            <>
              <div className="animate-pulse grid grid-cols-12 gap-4 px-4 py-3 border rounded-lg">
                <div className="col-span-5"><div className="h-4 bg-muted rounded"></div></div>
                <div className="col-span-2"><div className="h-4 bg-muted rounded"></div></div>
                <div className="col-span-2"><div className="h-4 bg-muted rounded"></div></div>
                <div className="col-span-2"><div className="h-4 bg-muted rounded"></div></div>
                <div className="col-span-1"><div className="h-4 bg-muted rounded"></div></div>
              </div>
            </>
          ) : documents.length > 0 ? (
            documents.map((doc) => (
              <div 
                key={doc.id} 
                className={cn(
                  "grid grid-cols-12 gap-4 px-4 border rounded-lg hover:bg-muted/30 transition-colors cursor-pointer",
                  compactMode ? "py-2" : "py-3"
                )}
                onClick={() => setLocation(`/viewer/${doc.id}`)}
              >
                <div className="col-span-5 flex items-center gap-2">
                  <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="font-medium truncate">{doc.title}</span>
                </div>
                <div className="col-span-2 flex items-center">
                  <span className="text-sm text-muted-foreground truncate">
                    {doc.author || doc.source || 'Unknown'}
                  </span>
                </div>
                <div className="col-span-2 flex items-center">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span className="text-sm">
                      {(doc.progress || 0) >= 100 ? '완료' : doc.progress > 0 ? '처리중' : '대기'}
                    </span>
                  </div>
                </div>
                <div className="col-span-2 flex items-center">
                  <span className="text-sm text-muted-foreground">
                    {new Date(doc.createdAt).toLocaleDateString('ko-KR')}
                  </span>
                </div>
                <div className="col-span-1 flex items-center">
                  {onDelete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(doc.id);
                      }}
                      className="h-8 w-8 p-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            ))
          ) : null}
        </div>
      );
    }

    // Grid view
    return (
      <div className={cn(
        "grid gap-6",
        compactMode 
          ? "grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8" 
          : "grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6"
      )}>
        {showAddNew && <AddNewBookCard />}

        {isLoading ? (
          <>
            <LoadingBookCard />
            <LoadingBookCard />
            <LoadingBookCard />
          </>
        ) : documents.length > 0 ? (
          documents.map((doc) => (
            <DocumentCard key={doc.id} document={doc} onDelete={onDelete} />
          ))
        ) : null}
      </div>
    );
  };

  // Explore Modal Component
  const ExploreModal = () => (
    <Dialog open={showExploreModal} onOpenChange={setShowExploreModal}>
      <DialogContent className="max-w-6xl max-h-[80vh] overflow-hidden">
        <DialogHeader className="border-b pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              <DialogTitle>Explore Library</DialogTitle>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="검색..."
                  className="pl-9 w-64"
                />
              </div>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">모든 카테고리</SelectItem>
                  <SelectItem value="문학">문학</SelectItem>
                  <SelectItem value="논문">논문</SelectItem>
                  <SelectItem value="뉴스">뉴스</SelectItem>
                  <SelectItem value="교육">교육</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortBy} onValueChange={setSortBy}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">최신순</SelectItem>
                  <SelectItem value="title">제목순</SelectItem>
                  <SelectItem value="author">작가순</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {isLoadingPublic ? (
              Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="aspect-[3/4] bg-muted rounded-lg mb-2"></div>
                  <div className="h-3 bg-muted rounded mb-1"></div>
                  <div className="h-3 bg-muted rounded w-3/4"></div>
                </div>
              ))
            ) : publicDocuments && publicDocuments.length > 0 ? (
              publicDocuments.map((doc) => (
                <DocumentCard
                  key={doc.id}
                  document={doc}
                  onAddToLibrary={async (id) => {
                    await handleAddToLibrary(id);
                    toast({
                      title: "저장됨!",
                      description: "Saved에서 확인하세요",
                      action: (
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => {
                            setShowExploreModal(false);
                            setTimeout(() => scrollToSection('saved'), 100);
                          }}
                        >
                          Saved 보기
                        </Button>
                      ),
                    });
                  }}
                  isPublic={true}
                  userDocuments={[
                    ...(uploadDocuments || []),
                    ...(savedDocuments || []),
                    ...(rssDocuments || [])
                  ]}
                />
              ))
            ) : (
              <div className="col-span-full text-center py-12">
                <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">콘텐츠를 찾을 수 없습니다</h3>
                <p className="text-muted-foreground">필터를 조정해보세요.</p>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );

  const totalDocuments = (uploadDocuments?.length || 0) + (savedDocuments?.length || 0) + (rssDocuments?.length || 0);

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
                  CrossRead Library
                </h1>
                <p className="text-lg text-muted-foreground mb-8">
                  Manage your documents and explore curated reading content for language learning
                </p>
              </div>
            </div>
          </div>

          {/* Enhanced Library Interface - Pure Accordion Layout */}
          <div className="max-w-7xl mx-auto px-6 py-8">
            {/* DEBUG: NEW UI ACTIVE */}
            <div className="bg-green-100 border border-green-300 text-green-800 px-4 py-2 rounded mb-6 text-sm">
              🚀 Enhanced Library UI Active - Pure accordion layout without tabs
            </div>

            {/* Mini Navigation */}
            <MiniNavigation />

                {/* Accordion Sections */}
                <Accordion type="multiple" value={activeAccordion} onValueChange={setActiveAccordion}>
                  {/* My Uploads Section */}
                  <AccordionItem value="my-uploads" id="my-uploads">
                    <AccordionTrigger className="text-lg font-semibold hover:no-underline">
                      <SectionHeader title="My Uploads" icon={Upload} count={uploadDocuments?.length}>
                        {/* Sorting and Filtering Controls */}
                        <div className="flex items-center gap-2">
                          <Select value={uploadSortBy} onValueChange={(value) => setUploadSortBy(value as SortOption)}>
                            <SelectTrigger className="w-[140px]">
                              <ArrowUpDown className="h-4 w-4 mr-2" />
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="recent">최근 열람순</SelectItem>
                              <SelectItem value="uploaded">최근 업로드순</SelectItem>
                              <SelectItem value="name">이름순</SelectItem>
                              <SelectItem value="progress">진행상황순</SelectItem>
                            </SelectContent>
                          </Select>

                          <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                            <SelectTrigger className="w-[120px]">
                              <Filter className="h-4 w-4 mr-2" />
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">모든 상태</SelectItem>
                              <SelectItem value="completed">완료</SelectItem>
                              <SelectItem value="processing">처리중</SelectItem>
                              <SelectItem value="error">오류</SelectItem>
                            </SelectContent>
                          </Select>

                          <Select value={fileTypeFilter} onValueChange={(value) => setFileTypeFilter(value as FileTypeFilter)}>
                            <SelectTrigger className="w-[120px]">
                              <SelectValue placeholder="파일 유형" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">모든 유형</SelectItem>
                              <SelectItem value="PDF">PDF</SelectItem>
                              <SelectItem value="DOCX">DOCX</SelectItem>
                              <SelectItem value="TXT">TXT</SelectItem>
                            </SelectContent>
                          </Select>

                          <ViewModeControls />
                        </div>
                      </SectionHeader>
                    </AccordionTrigger>
                    <AccordionContent>
                      <DocumentDisplay
                        documents={uploadDocuments}
                        isLoading={isLoadingUploads}
                        emptyMessage="업로드한 문서가 없습니다."
                        showAddNew={true}
                        onDelete={handleDeleteDocument}
                      />
                    </AccordionContent>
                  </AccordionItem>

                  {/* Saved Section */}
                  <AccordionItem value="saved" id="saved">
                    <AccordionTrigger className="text-lg font-semibold hover:no-underline">
                      <SectionHeader title="Saved" icon={Heart} count={savedDocuments?.length}>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowExploreModal(true);
                            }}
                          >
                            <Eye className="h-4 w-4 mr-2" />
                            Explore에서 추가
                          </Button>
                          <ViewModeControls />
                        </div>
                      </SectionHeader>
                    </AccordionTrigger>
                    <AccordionContent>
                      <DocumentDisplay
                        documents={savedDocuments || []}
                        isLoading={isLoadingSaved}
                        emptyMessage="Explore에서 저장한 문서가 없습니다."
                        onDelete={handleDeleteDocument}
                      />
                      {(!savedDocuments || savedDocuments.length === 0) && !isLoadingSaved && (
                        <div className="text-center py-12">
                          <div className="bg-muted/50 rounded-full p-6 w-fit mx-auto mb-6">
                            <Heart className="h-12 w-12 text-muted-foreground" />
                          </div>
                          <h3 className="text-xl font-semibold text-foreground mb-4">
                            저장된 문서가 없습니다
                          </h3>
                          <p className="text-muted-foreground mb-6">
                            Explore에서 흥미로운 콘텐츠를 발견하고 저장해보세요.
                          </p>
                          <Button onClick={() => setShowExploreModal(true)}>
                            <Eye className="h-4 w-4 mr-2" />
                            Explore에서 추가
                          </Button>
                        </div>
                      )}
                    </AccordionContent>
                  </AccordionItem>

                  {/* RSS Feeds Section */}
                  <AccordionItem value="rss-feeds" id="rss-feeds">
                    <AccordionTrigger className="text-lg font-semibold hover:no-underline">
                      <SectionHeader title="RSS Feeds" icon={Rss} count={rssDocuments?.length}>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              setShowRSSModal(true);
                            }}
                          >
                            <Settings className="h-4 w-4 mr-2" />
                            RSS 관리
                          </Button>
                          {rssFeeds && rssFeeds.length > 0 && (
                            <Select value={selectedFeedId?.toString() || "all"} onValueChange={(value) => setSelectedFeedId(value === "all" ? undefined : parseInt(value))}>
                              <SelectTrigger className="w-[140px]">
                                <SelectValue placeholder="모든 피드" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="all">모든 피드</SelectItem>
                                {rssFeeds.map((feed: any) => (
                                  <SelectItem key={feed.id} value={feed.id.toString()}>
                                    {feed.alias}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          <ViewModeControls />
                        </div>
                      </SectionHeader>
                    </AccordionTrigger>
                    <AccordionContent>
                      <DocumentDisplay
                        documents={rssDocuments || []}
                        isLoading={isLoadingRSS}
                        emptyMessage="RSS 피드에서 가져온 문서가 없습니다."
                        onDelete={handleDeleteDocument}
                      />
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </TabsContent>

              <TabsContent value="explore" className="mt-8">
                <div className="mb-6">
                  <div className="mb-4">
                    <h2 className="text-2xl font-bold text-foreground">Explore Library</h2>
                  </div>
                  <p className="text-muted-foreground mb-6">
                    Discover curated content from public sources for reading practice
                  </p>

                  {/* Filters */}
                  <div className="flex flex-wrap gap-4 mb-6">
                    <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Category" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Categories</SelectItem>
                        <SelectItem value="문학">문학</SelectItem>
                        <SelectItem value="논문">논문</SelectItem>
                        <SelectItem value="뉴스">뉴스</SelectItem>
                        <SelectItem value="교육">교육</SelectItem>
                        <SelectItem value="칼럼·에세이">칼럼·에세이</SelectItem>
                      </SelectContent>
                    </Select>

                    <Select value={sortBy} onValueChange={setSortBy}>
                      <SelectTrigger className="w-[180px]">
                        <SelectValue placeholder="Sort by" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="latest">Latest</SelectItem>
                        <SelectItem value="title">Title</SelectItem>
                        <SelectItem value="author">Author</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Public Documents Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
                  {isLoadingPublic ? (
                    <>
                      <LoadingBookCard />
                      <LoadingBookCard />
                      <LoadingBookCard />
                      <LoadingBookCard />
                      <LoadingBookCard />
                      <LoadingBookCard />
                    </>
                  ) : publicDocuments && publicDocuments.length > 0 ? (
                    publicDocuments.map((doc) => (
                      <DocumentCard
                        key={doc.id}
                        document={doc}
                        onAddToLibrary={handleAddToLibrary}
                        isPublic={true}
                        userDocuments={[
                          ...(uploadDocuments || []),
                          ...(savedDocuments || []),
                          ...(rssDocuments || [])
                        ]}
                      />
                    ))
                  ) : (
                    <div className="col-span-full text-center py-12">
                      <div className="max-w-md mx-auto">
                        <div className="bg-muted/50 rounded-full p-6 w-fit mx-auto mb-6">
                          <BookOpen className="h-12 w-12 text-muted-foreground" />
                        </div>
                        <h3 className="text-xl font-semibold text-foreground mb-4">
                          No documents found
                        </h3>
                        <p className="text-muted-foreground">
                          Try adjusting your filters or check back later for new content.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
          </div>
        </div>
      </div>

      {/* Explore Modal */}
      <ExploreModal />

      {/* Text Content Modal */}
      <TextContentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleAddDocument}
      />

      {/* RSS Management Modal */}
      <Dialog open={showRSSModal} onOpenChange={setShowRSSModal}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Rss className="h-5 w-5" />
              RSS 피드 관리
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6">
            {/* Add New RSS Feed Form */}
            <div className="border rounded-lg p-4">
              <h3 className="font-semibold mb-4">새 RSS 피드 추가</h3>
              <div className="grid gap-4">
                <div>
                  <Label htmlFor="feedUrl">RSS 피드 URL</Label>
                  <Input
                    id="feedUrl"
                    value={rssFormData.feedUrl}
                    onChange={(e) => setRSSFormData(prev => ({ ...prev, feedUrl: e.target.value }))}
                    placeholder="https://example.com/rss.xml"
                  />
                </div>
                <div>
                  <Label htmlFor="alias">별칭</Label>
                  <Input
                    id="alias"
                    value={rssFormData.alias}
                    onChange={(e) => setRSSFormData(prev => ({ ...prev, alias: e.target.value }))}
                    placeholder="피드 이름"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="category">카테고리</Label>
                    <Select value={rssFormData.category} onValueChange={(value) => setRSSFormData(prev => ({ ...prev, category: value }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="RSS Feed">RSS Feed</SelectItem>
                        <SelectItem value="뉴스">뉴스</SelectItem>
                        <SelectItem value="기술">기술</SelectItem>
                        <SelectItem value="교육">교육</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="language">언어</Label>
                    <Select value={rssFormData.language} onValueChange={(value) => setRSSFormData(prev => ({ ...prev, language: value }))}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="en">English</SelectItem>
                        <SelectItem value="ko">한국어</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label htmlFor="syncInterval">동기화 간격 (시간)</Label>
                  <Input
                    id="syncInterval"
                    type="number"
                    value={rssFormData.syncInterval}
                    onChange={(e) => setRSSFormData(prev => ({ ...prev, syncInterval: parseInt(e.target.value) || 12 }))}
                    min="1"
                    max="168"
                  />
                </div>
                <Button
                  onClick={() => createRSSFeedMutation.mutate(rssFormData)}
                  disabled={createRSSFeedMutation.isPending || !rssFormData.feedUrl || !rssFormData.alias}
                  className="w-full"
                >
                  {createRSSFeedMutation.isPending ? "추가 중..." : "RSS 피드 추가"}
                </Button>
              </div>
            </div>

            {/* Existing RSS Feeds */}
            <div>
              <h3 className="font-semibold mb-4">등록된 RSS 피드 ({rssFeeds?.length || 0}개)</h3>
              <div className="space-y-4">
                {isLoadingFeeds ? (
                  <div className="text-center py-4">
                    <p className="text-muted-foreground">로딩 중...</p>
                  </div>
                ) : rssFeeds && rssFeeds.length > 0 ? (
                  rssFeeds.map((feed: any) => (
                    <Card key={feed.id} className="p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-medium">{feed.alias}</h4>
                            <Badge variant={feed.isActive ? "default" : "secondary"}>
                              {feed.isActive ? "활성" : "비활성"}
                            </Badge>
                            {feed.errorCount > 0 && (
                              <Badge variant="destructive">
                                오류 {feed.errorCount}회
                              </Badge>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mb-1">{feed.feedUrl}</p>
                          <p className="text-xs text-muted-foreground">
                            카테고리: {feed.category} | 언어: {feed.language} | 동기화: {feed.syncInterval}시간 간격
                          </p>
                          {feed.lastSuccessAt && (
                            <p className="text-xs text-muted-foreground">
                              마지막 동기화: {new Date(feed.lastSuccessAt).toLocaleString()}
                            </p>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleSyncFeed(feed.id)}
                            disabled={syncRSSFeedMutation.isPending}
                          >
                            <RefreshCw className={`h-4 w-4 ${syncRSSFeedMutation.isPending ? 'animate-spin' : ''}`} />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDeleteFeed(feed.id)}
                            disabled={deleteRSSFeedMutation.isPending}
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
                    <p className="text-muted-foreground">등록된 RSS 피드가 없습니다.</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowRSSModal(false)}>
              닫기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}