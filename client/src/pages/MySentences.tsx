import React, { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import PageShell from "@/components/layout/PageShell";
import PageHeader from "@/components/layout/PageHeader";
import PageBody from "@/components/layout/PageBody";
import HeaderBar from "@/components/layout/HeaderBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

import { useToast } from "@/hooks/use-toast";
import { 
  Search, 
  Filter, 
  Download, 
  Trash2, 
  BookOpen, 
  Circle, 
  BookmarkPlus, 
  Archive,
  MoreHorizontal,
  FileText,
  NotebookPen,
  Check,
  ChevronsUpDown
} from "lucide-react";
import { Document, Sentence } from "@/lib/types";
import { Link } from "wouter";
import { useTranslation } from "@/i18n";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import AddNoteModal from "@/components/AddNoteModal";

type SentenceSort = "recent" | "alphabetical";

// Extended interface for MySentences page with new schema fields
interface SentenceWithDocument extends Sentence {
  documentId: number;
  documentTitle: string;
  documentSourceLanguage?: string;
  documentTargetLanguage?: string;
  averageScore?: number;
  document?: {
    id: number;
    title: string;
    sourceLanguage: string;
    targetLanguage: string;
  };
  
  // User state fields from new schema
  isBookmarked?: boolean;
  learningStatus?: "new" | "learning" | "review" | "mastered";
  lastPracticedAt?: Date | null;
  
  // Note data
  noteId?: number;
  noteContent?: string;
  noteTags?: string[] | null;
  
  // Legacy fields for backward compatibility
  isScrapped?: boolean; // maps to isBookmarked
  isFavorite?: boolean; // maps to isBookmarked
  status?: "new" | "practicing" | "completed" | "mastered"; // maps to learningStatus
  note?: string | null; // maps to noteContent
}


export default function MySentences() {
  const { t } = useTranslation();
  const [sortBy, setSortBy] = useState<SentenceSort>("recent");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>("all");
  const [selectedSentences, setSelectedSentences] = useState<number[]>([]);
  const [showAddNoteModal, setShowAddNoteModal] = useState(false);
  const [selectedSentenceForNote, setSelectedSentenceForNote] = useState<SentenceWithDocument | null>(null);
  const [documentSelectorOpen, setDocumentSelectorOpen] = useState(false);

  const { toast } = useToast();
  const { isAuthenticated, requireAuth } = useAuth();

  // Redirect to login if not authenticated
  React.useEffect(() => {
    if (!isAuthenticated) {
      requireAuth();
    }
  }, [isAuthenticated, requireAuth]);

  // Get all documents for the document filter dropdown
  const { data: documents } = useQuery<Document[]>({
    queryKey: ["/api/documents"],
  });

  // Get all notebooks for the dropdown
  const { data: notebooks } = useQuery({
    queryKey: ["/api/notebooks"],
  });

  // Build query parameters for the enhanced API
  const queryParams = new URLSearchParams();
  if (selectedDocumentId !== "all") queryParams.set("document", selectedDocumentId);
  if (searchQuery) queryParams.set("search", searchQuery);
  queryParams.set("sortBy", sortBy);

  // Get user sentences with enhanced filtering
  const { data: sentences, isLoading, error } = useQuery<SentenceWithDocument[]>({
    queryKey: ["/api/sentences/my", queryParams.toString()],
    queryFn: () => apiRequest(`/api/sentences/my?${queryParams.toString()}`),
    retry: false,
    enabled: isAuthenticated, // Only run if user is authenticated
  });

  // Bookmark toggle mutation (updated for new schema)
  const toggleBookmarkMutation = useMutation({
    mutationFn: (sentenceId: number) => 
      apiRequest(`/api/sentences/${sentenceId}/bookmark`, { method: 'PATCH' }),
    onSuccess: (data) => {
      // Invalidate related queries for better synchronization
      queryClient.invalidateQueries({ queryKey: ['/api/sentences/my'] });
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      // Invalidate all document detail queries to refresh viewer
      queryClient.invalidateQueries({ queryKey: ['/api/documents/1017'] });
      queryClient.invalidateQueries({ queryKey: ['/api/documents/1018'] });
      toast({ 
        title: "성공", 
        description: data.message || "북마크 상태가 업데이트되었습니다"
      });
    },
    onError: () => {
      toast({ 
        title: "오류", 
        description: "북마크 상태 업데이트에 실패했습니다", 
        variant: "destructive" 
      });
    }
  });

  // Bulk unbookmark mutation (북마크 해제)
  const bulkUnbookmarkMutation = useMutation({
    mutationFn: async (sentenceIds: number[]) => {
      // 각 문장에 대해 명시적으로 북마크 해제 (isBookmarked: false)
      const promises = sentenceIds.map(id => 
        apiRequest(`/api/sentences/${id}/bookmark`, { 
          method: 'PUT',
          body: JSON.stringify({ isBookmarked: false }),
          headers: { 'Content-Type': 'application/json' }
        })
      );
      await Promise.all(promises);
      return { message: `${sentenceIds.length}개 문장이 북마크에서 제거되었습니다` };
    },
    onSuccess: (data) => {
      // Invalidate related queries for better synchronization
      queryClient.invalidateQueries({ queryKey: ['/api/sentences/my'] });
      queryClient.invalidateQueries({ queryKey: ['/api/documents'] });
      // Invalidate all document detail queries to refresh viewer
      queryClient.invalidateQueries({ queryKey: ['/api/documents/1017'] });
      queryClient.invalidateQueries({ queryKey: ['/api/documents/1018'] });
      setSelectedSentences([]);
      toast({ 
        title: "성공", 
        description: data.message
      });
    },
    onError: (error) => {
      console.error('Bulk unbookmark error:', error);
      toast({ 
        title: "오류", 
        description: "북마크 해제에 실패했습니다", 
        variant: "destructive" 
      });
    }
  });

  



  const handleSelectSentence = (sentenceId: number) => {
    setSelectedSentences(prev => 
      prev.includes(sentenceId) 
        ? prev.filter(id => id !== sentenceId)
        : [...prev, sentenceId]
    );
  };

  const handleSelectAll = () => {
    if (selectedSentences.length === (sentences?.length || 0)) {
      setSelectedSentences([]);
    } else {
      setSelectedSentences(sentences?.map(s => s.id) || []);
    }
  };


  const handleAddNote = (sentence: SentenceWithDocument, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedSentenceForNote(sentence);
    setShowAddNoteModal(true);
  };




  const documentOptions = [
    { id: "all", title: t('mySentences.allDocuments'), count: sentences?.length || 0 },
    ...(documents?.map(doc => ({
      id: doc.id.toString(),
      title: doc.title,
      count: (sentences && Array.isArray(sentences)) ? sentences.filter(s => s.documentTitle === doc.title).length : 0
    })).filter(doc => doc.count > 0) || [])
  ];

  // Selection mode when any sentences are selected
  const selectionMode = selectedSentences.length > 0;
  const allSelected = sentences && selectedSentences.length === sentences.length;


  return (
    <Layout>
      <PageShell maxWidth="standard">
        <HeaderBar
          title={t('mySentences.title')}
          subtitle={t('mySentences.subtitle')}
          controlsLeft={
            <div className="flex items-center gap-2 flex-wrap">
              {/* Search - expanded width for better usability */}
              <div className="relative min-w-[280px] flex-1 lg:max-w-[400px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  data-testid="input-search"
                  placeholder={t('mySentences.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              
              {/* Document Filter Dropdown */}
              <Popover open={documentSelectorOpen} onOpenChange={setDocumentSelectorOpen}>
                <PopoverTrigger asChild>
                  <div
                    role="combobox"
                    aria-expanded={documentSelectorOpen}
                    className="flex h-10 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 w-[180px] cursor-pointer hover:bg-muted/50 transition-colors"
                    data-testid="select-document"
                  >
                    <div className="flex items-center overflow-hidden">
                      <FileText className="w-4 h-4 mr-2 shrink-0 text-muted-foreground" />
                      <span className="truncate">
                        {selectedDocumentId === "all" 
                          ? t('mySentences.allDocuments')
                          : documentOptions.find((doc) => doc.id === selectedDocumentId)?.title || t('mySentences.selectDocument')
                        }
                      </span>
                    </div>
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </div>
                </PopoverTrigger>
                <PopoverContent className="w-[200px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t('mySentences.searchDocuments')} />
                    <CommandList>
                      <CommandEmpty>{t('mySentences.noResults')}</CommandEmpty>
                      <CommandGroup>
                        {documentOptions.map(option => (
                          <CommandItem
                            key={option.id}
                            value={option.title}
                            onSelect={() => {
                              setSelectedDocumentId(option.id);
                              setDocumentSelectorOpen(false);
                            }}
                          >
                            <Check
                              className={`mr-2 h-4 w-4 ${
                                selectedDocumentId === option.id ? "opacity-100" : "opacity-0"
                              }`}
                            />
                            <span className="truncate">{option.title}</span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>

              {/* Sort Dropdown */}
              <Select value={sortBy} onValueChange={(value) => setSortBy(value as SentenceSort)}>
                <SelectTrigger data-testid="select-sort" className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="recent">{t('mySentences.recentOrder')}</SelectItem>
                  <SelectItem value="alphabetical">{t('mySentences.alphabeticalOrder')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          }
        />
        <PageBody>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* Sentence List */}
            <div className="space-y-4">
              {!isAuthenticated ? (
                <div className="text-center py-8">
                  <p className="text-gray-600">{t('mySentences.pleaseLogin')}</p>
                </div>
              ) : error ? (
                <div className="text-center py-8">
                  <p className="text-red-600">{t('mySentences.loadFailed')}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {error.message === 'Authentication required' ? t('mySentences.loginAgain') : t('mySentences.checkConnection')}
                  </p>
                </div>
              ) : isLoading ? (
                <div className="text-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                  <p className="text-gray-600 mt-2">{t('mySentences.loading')}</p>
                </div>
              ) : !sentences || !Array.isArray(sentences) || sentences.length === 0 ? (
                <div className="text-center py-8">
                  <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <p className="text-gray-600">{t('mySentences.noSentencesFound')}</p>
                  <p className="text-sm text-gray-500 mt-1">
                    {t('mySentences.startReading')}
                  </p>
                </div>
              ) : (
                <>
                  <div className="my-4 px-1">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          data-testid="checkbox-header-select-all"
                          checked={sentences && sentences.length > 0 && selectedSentences.length === sentences.length}
                          onChange={handleSelectAll}
                          disabled={!sentences || sentences.length === 0}
                          className="rounded border-gray-300 dark:border-gray-600"
                        />
                        <div className="text-sm text-gray-600 dark:text-gray-400">
                          {t('mySentences.showing', { count: sentences.length })}
                          {selectedSentences.length > 0 && (
                            <span className="ml-2 text-gray-500 dark:text-gray-500 font-medium">
                              {t('mySentences.selected', { count: selectedSentences.length })}
                            </span>
                          )}
                        </div>
                      </div>
                      {selectedSentences.length > 0 && (
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            data-testid="button-export-selected"
                            onClick={() => {
                              toast({ 
                                title: t('mySentences.export'), 
                                description: t('mySentences.exporting', { count: selectedSentences.length })
                              });
                            }}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            {t('mySentences.export')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-red-600 border-red-600 hover:bg-red-50 dark:text-red-400 dark:border-red-400 dark:hover:bg-red-950/20"
                            data-testid="button-unbookmark-selected"
                            onClick={() => bulkUnbookmarkMutation.mutate(selectedSentences)}
                            disabled={bulkUnbookmarkMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            {t('mySentences.delete')}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>

                  {sentences.map((sentence) => (
                    <Card key={sentence.id} className="cursor-pointer hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <input
                            type="checkbox"
                            checked={selectedSentences.includes(sentence.id)}
                            onChange={() => handleSelectSentence(sentence.id)}
                            className="mt-1 rounded border-gray-300"
                          />
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2 mb-2">
                              {sentence.documentTitle && (
                                <Badge variant="outline" className="text-xs">
                                  {sentence.documentTitle}
                                </Badge>
                              )}
                            </div>

                            <div className="text-gray-900 font-medium leading-relaxed">
                              <strong>Original:</strong> {sentence.source}
                            </div>
                            {sentence.target && (
                              <div className="text-gray-800 dark:text-gray-200 leading-relaxed font-semibold">
                                <strong>Translation:</strong> {sentence.target}
                              </div>
                            )}
                          </div>
                          
                          {/* Action Buttons */}
                          <div className="flex items-center gap-2">
                            {/* Add Note Button */}
                            <Button
                              variant="ghost"
                              size="sm"
                              className={`h-6 w-6 p-0 flex-shrink-0 ${
                                sentence.noteId || sentence.noteContent
                                  ? "text-[hsl(var(--brand))] hover:text-[hsl(var(--brand))]/80"
                                  : "text-gray-400 hover:text-gray-600"
                              }`}
                              onClick={(e) => handleAddNote(sentence, e)}
                            >
                              <NotebookPen className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </>
              )}
            </div>

            {/* Add Note Modal */}
            {selectedSentenceForNote && (
              <AddNoteModal
                isOpen={showAddNoteModal}
                onClose={() => {
                  setShowAddNoteModal(false);
                  setSelectedSentenceForNote(null);
                }}
                sentence={selectedSentenceForNote}
              />
            )}
          </div>
        </PageBody>
      </PageShell>
    </Layout>
  );
}