
import React, { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import Layout from "@/components/Layout";
import PageShell from "@/components/layout/PageShell";
import PageHeader from "@/components/layout/PageHeader";
import PageBody from "@/components/layout/PageBody";
import HeaderBar from "@/components/layout/HeaderBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, Search, Edit2, Trash2, Filter, X, SortAsc, SortDesc, Download, AlertTriangle, Volume2, FileText, File } from "lucide-react";
import { Link } from "wouter";
import { Glossary } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/i18n";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const glossarySchema = z.object({
  term: z.string().min(1, "Term is required"),
  definition: z.string().min(1, "Definition is required"),
  translation: z.string().min(1, "Translation is required"),
  pronunciation: z.string().optional(),
  tags: z.string().optional(),
  sourceLanguage: z.string().min(1, "Source language is required"),
  targetLanguage: z.string().min(1, "Target language is required"),
  contextSentence: z.string().optional(),
});

type GlossaryFormData = z.infer<typeof glossarySchema>;

import Pagination from "@/components/common/Pagination";

export default function GlossaryPage() {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [selectedDocumentId, setSelectedDocumentId] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"alphabetical" | "recent">("recent");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingGlossary, setEditingGlossary] = useState<Glossary | null>(null);
  const [selectedTerms, setSelectedTerms] = useState<number[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    type: 'deleteSingle' | 'deleteMultiple';
    data: number | number[];
  }>({ open: false, type: 'deleteSingle', data: 0 });
  const { toast } = useToast();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [, setLocation] = useLocation();

  const form = useForm<GlossaryFormData>({
    resolver: zodResolver(glossarySchema),
    defaultValues: {
      term: "",
      definition: "",
      translation: "",
      pronunciation: "",
      tags: "",
      sourceLanguage: "English",
      targetLanguage: "Korean",
      contextSentence: "",
    },
  });

  // Get all glossary terms for current user
  const { data: glossaryTerms, isLoading } = useQuery<Glossary[]>({
    queryKey: ["/api/glossary"],
    enabled: true,
  });

  // Create glossary term mutation
  const createMutation = useMutation({
    mutationFn: (data: GlossaryFormData) => {
      const requestData = {
        ...data,
        difficulty: "beginner", // Default to beginner for backend compatibility
        tags: data.tags ? JSON.stringify(data.tags.split(",").map(t => t.trim())) : null,
      };
      return apiRequest("/api/glossary", {
        method: "POST",
        body: JSON.stringify(requestData),
        headers: { "Content-Type": "application/json" },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/glossary"] });
      toast({ title: t('glossary.success'), description: t('glossary.termCreated') });
      setIsDialogOpen(false);
      form.reset();
    },
    onError: () => {
      toast({ title: t('glossary.error'), description: t('glossary.failedToCreate'), variant: "destructive" });
    },
  });

  // Update glossary term mutation
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: GlossaryFormData }) => {
      const requestData = {
        ...data,
        difficulty: "beginner", // Default to beginner for backend compatibility
        tags: data.tags ? JSON.stringify(data.tags.split(",").map(t => t.trim())) : null,
      };
      return apiRequest(`/api/glossary/${id}`, {
        method: "PUT",
        body: JSON.stringify(requestData),
        headers: { "Content-Type": "application/json" },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/glossary"] });
      toast({ title: t('glossary.success'), description: t('glossary.termUpdated') });
      setIsDialogOpen(false);
      setEditingGlossary(null);
      form.reset();
    },
    onError: () => {
      toast({ title: t('glossary.error'), description: t('glossary.failedToUpdate'), variant: "destructive" });
    },
  });

  // Delete glossary term mutation
  const deleteMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest(`/api/glossary/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/glossary"] });
      toast({ title: t('glossary.success'), description: t('glossary.termDeleted') });
    },
    onError: () => {
      toast({ title: t('glossary.error'), description: t('glossary.failedToDelete'), variant: "destructive" });
    },
  });

  // Bulk delete glossary terms mutation
  const bulkDeleteMutation = useMutation({
    mutationFn: (termIds: number[]) =>
      Promise.all(termIds.map(id => apiRequest(`/api/glossary/${id}`, { method: "DELETE" }))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/glossary"] });
      setSelectedTerms([]);
      toast({ title: t('glossary.success'), description: t('glossary.termsDeleted') });
    },
    onError: () => {
      toast({ title: t('glossary.error'), description: t('glossary.failedToDeleteSelected'), variant: "destructive" });
    },
  });

  // Extract all unique tags
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    glossaryTerms?.forEach(term => {
      if (term.tags) {
        try {
          const tags = JSON.parse(term.tags);
          tags.forEach((tag: string) => tagSet.add(tag));
        } catch (e) {
          // Handle legacy string tags
          if (typeof term.tags === 'string') {
            term.tags.split(',').forEach(tag => tagSet.add(tag.trim()));
          }
        }
      }
    });
    return Array.from(tagSet).sort();
  }, [glossaryTerms]);

  // Extract all unique documents
  const allDocuments = useMemo(() => {
    const docMap = new Map<number, string>();
    glossaryTerms?.forEach(term => {
      if (term.documentId) {
        const title = (term as any).documentTitle || t('glossary.sourceDocument');
        docMap.set(term.documentId, title);
      }
    });
    return Array.from(docMap.entries()).map(([id, title]) => ({ id, title }));
  }, [glossaryTerms, t]);

  // Filter and sort terms
  const filteredAndSortedTerms = useMemo(() => {
    let filtered = glossaryTerms?.filter(term => {
      const matchesSearch = searchQuery === "" || 
        term.term.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (term.definition && term.definition.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (term.translation && term.translation.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesTags = selectedTags.length === 0 || 
        (term.tags && selectedTags.every(selectedTag => {
          try {
            const tags = JSON.parse(term.tags!);
            return tags.includes(selectedTag);
          } catch (e) {
            return term.tags!.includes(selectedTag);
          }
        }));

      const matchesDocument = selectedDocumentId === "all" || 
        (term.documentId && term.documentId.toString() === selectedDocumentId);
      
      return matchesSearch && matchesTags && matchesDocument;
    }) || [];

    // Sort terms
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sortBy) {
        case "alphabetical":
          comparison = a.term.localeCompare(b.term);
          break;
        case "recent":
          comparison = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
          break;
      }
      
      return sortOrder === "desc" ? -comparison : comparison;
    });

    return filtered;
  }, [glossaryTerms, searchQuery, selectedTags, selectedDocumentId, sortBy, sortOrder]);

  const handleSubmit = (data: GlossaryFormData) => {
    if (editingGlossary) {
      updateMutation.mutate({ id: editingGlossary.id, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const handleEdit = (term: Glossary) => {
    setEditingGlossary(term);
    form.reset({
      term: term.term,
      definition: term.definition || "",
      translation: term.translation || "",
      pronunciation: term.pronunciation || "",
      tags: term.tags ? JSON.parse(term.tags).join(", ") : "",
      sourceLanguage: term.sourceLanguage,
      targetLanguage: term.targetLanguage,
      contextSentence: term.contextSentence || "",
    });
    setIsDialogOpen(true);
  };

  const handleDelete = (id: number) => {
    setConfirmDialog({ open: true, type: 'deleteSingle', data: id });
  };

  const handleConfirmAction = () => {
    if (confirmDialog.type === 'deleteSingle') {
      deleteMutation.mutate(confirmDialog.data as number);
    } else if (confirmDialog.type === 'deleteMultiple') {
      bulkDeleteMutation.mutate(confirmDialog.data as number[]);
    }
    setConfirmDialog({ open: false, type: 'deleteSingle', data: 0 });
  };

  // Selection handlers
  const handleSelectTerm = (termId: number) => {
    setSelectedTerms(prev => 
      prev.includes(termId)
        ? prev.filter(id => id !== termId)
        : [...prev, termId]
    );
  };

  const handleSelectAll = () => {
    if (selectedTerms.length === filteredAndSortedTerms.length) {
      setSelectedTerms([]);
    } else {
      setSelectedTerms(filteredAndSortedTerms?.map(t => t.id) || []);
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags(prev => 
      prev.includes(tag) 
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const clearAllFilters = () => {
    setSearchQuery("");
    setSelectedTags([]);
    setSelectedDocumentId("all");
  };

  // Show login required message for non-authenticated users
  if (!authLoading && !isAuthenticated) {
    return (
      <Layout>
        <div className="min-h-[calc(100vh-64px)] flex items-center justify-center bg-muted/30 dark:bg-muted/10">
          <div className="max-w-md w-full px-6">
            <Alert className="mb-6">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>{t('auth.loginRequired')}</AlertTitle>
              <AlertDescription>
                {t('glossary.loginRequired')}
                <br />
                {t('glossary.loginDescription')}
              </AlertDescription>
            </Alert>
            <div className="text-center">
              <Button onClick={() => setLocation('/login')}>
                {t('auth.login')}
              </Button>
              <Button onClick={() => setLocation('/signup')} variant="outline" className="ml-2">
                {t('auth.signUp')}
              </Button>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <PageShell maxWidth="standard">
        <HeaderBar
          title={t('glossary.title')}
          subtitle={t('glossary.subtitle')}
          controlsLeft={
            <div className="flex flex-wrap items-center gap-3 flex-1 min-w-0">
              {/* Search Bar - better balanced width */}
              <div className="relative w-full sm:flex-1 sm:min-w-[200px] lg:max-w-[480px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  data-testid="input-search"
                  placeholder={t('glossary.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Sort Controls - compact */}
              <div className="flex-shrink-0">
                <Select value={sortBy} onValueChange={(value: any) => setSortBy(value)}>
                  <SelectTrigger data-testid="select-sort" className="w-[120px]">
                    <SelectValue placeholder={t('glossary.sortBy')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="recent">{t('glossary.recent')}</SelectItem>
                    <SelectItem value="alphabetical">{t('glossary.alphabetical')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Document Filter */}
              {allDocuments.length > 0 && (
                <div className="flex-shrink-0 w-full sm:w-auto">
                  <Select value={selectedDocumentId} onValueChange={setSelectedDocumentId}>
                    <SelectTrigger data-testid="select-document-filter" className="w-full sm:w-[180px]">
                      <File className="h-4 w-4 mr-2 flex-shrink-0" />
                      <SelectValue placeholder={t('glossary.allDocuments')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('glossary.allDocuments')}</SelectItem>
                      {allDocuments.map(doc => (
                        <SelectItem key={doc.id} value={doc.id.toString()}>
                          <span className="truncate max-w-[150px]">{doc.title}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          }
          controlsRight={
            <div className="flex items-center gap-2 flex-shrink-0">
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button 
                    variant="outline"
                    data-testid="button-add-term"
                    className="rounded-xl border-[#2F5D50]/20 text-[#2F5D50] hover:bg-[hsl(var(--brand-subtle))] hover:text-[#2F5D50]"
                    onClick={() => { setEditingGlossary(null); form.reset(); }}
                  >
                    <Plus className="h-4 w-4 mr-2" />
                    {t('glossary.addTerm')}
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl">
                  <DialogHeader>
                    <DialogTitle>
                      {editingGlossary ? t('glossary.editTerm') : t('glossary.addNewTerm')}
                    </DialogTitle>
                  </DialogHeader>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                      <FormField
                        control={form.control}
                        name="term"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('glossary.term')}</FormLabel>
                            <FormControl>
                              <Input placeholder={t('glossary.enterTerm')} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="translation"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('glossary.translation')}</FormLabel>
                            <FormControl>
                              <Input placeholder={t('glossary.enterTranslation')} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="definition"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('glossary.definition')}</FormLabel>
                            <FormControl>
                              <Textarea placeholder={t('glossary.enterDefinition')} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />


                      <FormField
                        control={form.control}
                        name="contextSentence"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('glossary.contextSentence')}</FormLabel>
                            <FormControl>
                              <Textarea 
                                placeholder={t('glossary.enterContextSentence')} 
                                {...field} 
                                rows={2}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="tags"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('glossary.tagsOptional')}</FormLabel>
                            <FormControl>
                              <Input placeholder={t('glossary.enterTags')} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      {editingGlossary?.documentId && (
                        <div className="p-3 bg-muted/50 rounded-lg">
                          <p className="text-sm font-medium text-muted-foreground mb-1">{t('glossary.sourceDocument')}</p>
                          <Link href={`/viewer/${editingGlossary.documentId}`} onClick={() => setIsDialogOpen(false)}>
                            <div className="flex items-center gap-2 text-primary hover:underline cursor-pointer">
                              <FileText className="h-4 w-4" />
                              <span className="text-sm">{(editingGlossary as any).documentTitle || `Document #${editingGlossary.documentId}`}</span>
                            </div>
                          </Link>
                        </div>
                      )}

                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setIsDialogOpen(false)}
                        >
                          {t('common.cancel')}
                        </Button>
                        <Button
                          type="submit"
                          disabled={createMutation.isPending || updateMutation.isPending}
                        >
                          {editingGlossary ? t('glossary.updateTerm') : t('glossary.addTerm')}
                        </Button>
                      </div>
                    </form>
                  </Form>
                </DialogContent>
              </Dialog>
              {(searchQuery || selectedTags.length > 0) && (
                <Button 
                  variant="outline" 
                  size="sm" 
                  data-testid="button-clear-filters"
                  onClick={clearAllFilters}
                >
                  <X className="h-4 w-4 mr-1" />
                  {t('glossary.clearFilters')}
                </Button>
              )}
            </div>
          }
        />

        <PageBody>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {/* Tag Filter Bar - Keep separate for now */}
            {allTags.length > 0 && (
              <div className="mt-4 mb-6">
                <div className="flex flex-wrap gap-2">
                  {allTags.map(tag => (
                    <Badge
                      key={tag}
                      variant={selectedTags.includes(tag) ? "default" : "outline"}
                      className="cursor-pointer hover:bg-primary/10"
                      data-testid={`tag-filter-${tag}`}
                      onClick={() => toggleTag(tag)}
                    >
                      #{tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Results Summary */}
            <div className="my-4 px-1">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    data-testid="checkbox-header-select-all"
                    checked={filteredAndSortedTerms.length > 0 && selectedTerms.length === filteredAndSortedTerms.length}
                    onChange={handleSelectAll}
                    disabled={!filteredAndSortedTerms || filteredAndSortedTerms.length === 0}
                    className="rounded border-gray-300 dark:border-gray-600"
                  />
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    {t('glossary.showingTerms', { count: filteredAndSortedTerms.length })}
                    {filteredAndSortedTerms.length !== (glossaryTerms?.length || 0) && 
                      ` ${t('glossary.ofTotal', { total: glossaryTerms?.length || 0 })}`}
                    {selectedTerms.length > 0 && (
                      <span className="ml-2 text-gray-500 dark:text-gray-500 font-medium">
                        {t('glossary.selected', { count: selectedTerms.length })}
                      </span>
                    )}
                  </div>
                </div>
                {selectedTerms.length > 0 && (
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="button-export-selected"
                      onClick={() => {
                        toast({ 
                          title: t('glossary.export'), 
                          description: t('glossary.exportingTerms', { count: selectedTerms.length })
                        });
                      }}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      {t('glossary.export')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-red-600 border-red-600 hover:bg-red-50 dark:text-red-400 dark:border-red-400 dark:hover:bg-red-950/20"
                      data-testid="button-delete-selected"
                      onClick={() => {
                        setConfirmDialog({ open: true, type: 'deleteMultiple', data: [...selectedTerms] });
                      }}
                      disabled={bulkDeleteMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      {t('glossary.delete')}
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* Glossary Terms List - 행 스타일 */}
            <div className="space-y-6 pb-24">
              <div className="space-y-2">
                {isLoading ? (
                  <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
                    <p className="text-muted-foreground mt-2">{t('glossary.loadingGlossary')}</p>
                  </div>
                ) : filteredAndSortedTerms.length === 0 ? (
                  <div className="text-center py-8">
                    <p className="text-muted-foreground">{t('glossary.noTerms')}</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {t('glossary.noTermsDesc')}
                    </p>
                  </div>
                ) : (
                  filteredAndSortedTerms.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((term) => (
                    <div
                      key={term.id}
                      className="flex items-start gap-3 p-4 bg-card shadow-sm rounded-xl hover:shadow-md transition-colors"
                    >
                    <input
                      type="checkbox"
                      checked={selectedTerms.includes(term.id)}
                      onChange={() => handleSelectTerm(term.id)}
                      className="mt-1 rounded border-gray-300"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="text-lg font-semibold text-foreground">{term.term}</h3>
                        {term.translation && (
                          <span className="text-gray-600 dark:text-gray-400 text-sm">{term.translation}</span>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-primary"
                          data-testid={`button-tts-${term.id}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if ('speechSynthesis' in window) {
                              window.speechSynthesis.cancel();
                              const utterance = new SpeechSynthesisUtterance(term.term);
                              utterance.lang = 'en-US';
                              utterance.rate = 0.9;
                              window.speechSynthesis.speak(utterance);
                            } else {
                              toast({
                                title: t('glossary.ttsNotSupported'),
                                description: t('glossary.ttsNotSupportedDesc'),
                                variant: 'destructive'
                              });
                            }
                          }}
                          title={t('glossary.listenPronunciation')}
                        >
                          <Volume2 className="h-4 w-4" />
                        </Button>
                      </div>
                      
                      <p className="text-foreground mb-1 line-clamp-2">{term.definition}</p>

                      {term.contextSentence && (
                        <div className="bg-muted/50 pl-3 py-2 mb-2 text-sm italic text-slate-500 rounded">
                          <strong>{t('glossary.context')}:</strong> "{term.contextSentence}"
                        </div>
                      )}
                      
                      <div className="flex items-center flex-wrap gap-2 text-sm text-muted-foreground">
                        {term.documentId && (
                          <Badge 
                            variant="outline" 
                            className="text-xs cursor-pointer flex items-center gap-1 max-w-[200px] border-[#6B8E7E]/40 hover:bg-[#6B8E7E]/10 hover:border-[#6B8E7E]"
                            style={{
                              backgroundColor: selectedDocumentId === term.documentId.toString() ? 'rgba(107, 142, 126, 0.15)' : undefined,
                              borderColor: selectedDocumentId === term.documentId.toString() ? '#6B8E7E' : undefined,
                              color: selectedDocumentId === term.documentId.toString() ? '#4A6B5D' : undefined,
                            }}
                            onClick={() => setSelectedDocumentId(selectedDocumentId === term.documentId!.toString() ? "all" : term.documentId!.toString())}
                          >
                            <File className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{(term as any).documentTitle || t('glossary.sourceDocument')}</span>
                          </Badge>
                        )}
                        {term.tags && JSON.parse(term.tags).map((tag: string) => (
                          <Badge 
                            key={tag} 
                            variant="outline" 
                            className="text-xs cursor-pointer hover:bg-primary/10"
                            onClick={() => toggleTag(tag)}
                          >
                            #{tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    
                    <div className="flex gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEdit(term)}
                        className="text-gray-400 hover:text-gray-600 h-6 w-6 p-0 flex-shrink-0"
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  ))
                )}
              </div>
              <Pagination
                currentPage={currentPage}
                totalPages={Math.ceil(filteredAndSortedTerms.length / itemsPerPage)}
                onPageChange={setCurrentPage}
              />
            </div>
          </div>
        </PageBody>
      </PageShell>

      <ConfirmDialog
        open={confirmDialog.open}
        onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}
        title={confirmDialog.type === 'deleteSingle'
          ? t('glossary.confirmDeleteTerm')
          : t('glossary.confirmDeleteTerms', { count: Array.isArray(confirmDialog.data) ? confirmDialog.data.length : 0 })}
        description={confirmDialog.type === 'deleteSingle'
          ? t('glossary.confirmDeleteTerm')
          : t('glossary.confirmDeleteTerms', { count: Array.isArray(confirmDialog.data) ? confirmDialog.data.length : 0 })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        onConfirm={handleConfirmAction}
        variant="destructive"
      />
    </Layout>
  );
}
