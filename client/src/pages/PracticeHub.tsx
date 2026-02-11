import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import Layout from "@/components/Layout";
import PageShell from "@/components/layout/PageShell";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Zap,
  BookOpen,
  Brain,
  BookMarked,
  Loader2,
  Sparkles,
  ChevronRight,
  ChevronDown,
  Check,
  X,
  FileText,
  Layers,
  MessageSquareText,
} from "lucide-react";
import { useTranslation } from "@/i18n";

interface NotebookWithStats {
  id: number;
  title: string;
  description: string | null;
  language: string | null;
  totalSentences: number;
  practiced: number;
  mastered: number;
  colorLabel: string | null;
  groupId: number | null;
  groupName: string | null;
  updatedAt: string;
}

interface NotebookGroup {
  id: number;
  name: string;
  color: string | null;
  icon?: string | null;
}

interface VocabularyStats {
  total: number;
  dueCount?: number;
}

const INITIAL_NOTEBOOKS_LIMIT = 6;

export default function PracticeHub() {
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const [showInsufficientDialog, setShowInsufficientDialog] = useState(false);
  const [showNoDueDialog, setShowNoDueDialog] = useState(false);
  const [dialogType, setDialogType] = useState<"smart" | "vocab" | "notebook">("smart");
  const [isCheckingAvailability, setIsCheckingAvailability] = useState(false);
  const [isCheckingVocab, setIsCheckingVocab] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedNotebookIds, setSelectedNotebookIds] = useState<number[]>([]);
  const [isStartingMultiQuiz, setIsStartingMultiQuiz] = useState(false);

  const { data: notebooksData, isLoading: isLoadingNotebooks } = useQuery<{ 
    notebooks: NotebookWithStats[]; 
  }>({
    queryKey: ["/api/quiz/notebooks"],
    enabled: isAuthenticated,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Fetch groups from the same endpoint as Notebooks page for consistency
  const { data: groupsData } = useQuery<{ groups: NotebookGroup[] }>({
    queryKey: ["/api/notebook-groups"],
    enabled: isAuthenticated,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const { data: vocabData } = useQuery<VocabularyStats>({
    queryKey: ["/api/quiz/vocabulary-stats"],
    enabled: isAuthenticated,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const handleSmartReviewClick = async () => {
    setIsCheckingAvailability(true);
    try {
      const result = await apiRequest("/api/quiz/smart-review") as {
        insufficientItems?: boolean;
        noDueItems?: boolean;
        items?: unknown[];
      };
      
      if (result.insufficientItems) {
        setDialogType("smart");
        setShowInsufficientDialog(true);
      } else if (result.noDueItems) {
        setDialogType("smart");
        setShowNoDueDialog(true);
      } else if (result.items && result.items.length > 0) {
        setLocation("/practice/smart?mode=smart-review");
      } else {
        setDialogType("smart");
        setShowNoDueDialog(true);
      }
    } catch (error) {
      console.error("Error checking smart review availability:", error);
    } finally {
      setIsCheckingAvailability(false);
    }
  };

  const handleVocabularyClick = async () => {
    setIsCheckingVocab(true);
    try {
      const result = await apiRequest("/api/quiz/vocabulary") as {
        insufficientItems?: boolean;
        noDueItems?: boolean;
        items?: unknown[];
      };
      
      if (result.insufficientItems) {
        setDialogType("vocab");
        setShowInsufficientDialog(true);
      } else if (result.noDueItems) {
        setDialogType("vocab");
        setShowNoDueDialog(true);
      } else if (result.items && result.items.length > 0) {
        setLocation("/practice/vocab?mode=vocabulary");
      } else {
        setDialogType("vocab");
        setShowNoDueDialog(true);
      }
    } catch (error) {
      console.error("Error checking vocabulary availability:", error);
    } finally {
      setIsCheckingVocab(false);
    }
  };

  const handleNotebookClick = (notebookId: number, sentenceCount: number) => {
    if (sentenceCount < 3) {
      setDialogType("notebook");
      setShowInsufficientDialog(true);
    } else {
      setLocation(`/practice/${notebookId}`);
    }
  };

  // Toggle notebook selection
  const toggleNotebookSelection = (notebookId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedNotebookIds(prev => 
      prev.includes(notebookId) 
        ? prev.filter(id => id !== notebookId)
        : [...prev, notebookId]
    );
  };

  // Handle multi-notebook quiz start
  const handleMultiNotebookQuizStart = async () => {
    if (selectedTotalSentences < 3) {
      setDialogType("notebook");
      setShowInsufficientDialog(true);
      return;
    }
    
    setIsStartingMultiQuiz(true);
    try {
      const notebookIdsParam = selectedNotebookIds.join(',');
      setLocation(`/practice/multi?notebookIds=${notebookIdsParam}`);
    } finally {
      setIsStartingMultiQuiz(false);
    }
  };

  // Clear selection
  const clearSelection = () => {
    setSelectedNotebookIds([]);
  };

  const notebooks = notebooksData?.notebooks || [];
  const allGroups = groupsData?.groups || [];
  const vocabularyCount = vocabData?.total || 0;

  // Filter groups to only show those that have notebooks assigned
  const groups = useMemo(() => {
    const notebookGroupIds = new Set(notebooks.map(n => n.groupId).filter(Boolean));
    return allGroups.filter(g => notebookGroupIds.has(g.id));
  }, [allGroups, notebooks]);

  const filteredNotebooks = useMemo(() => {
    if (selectedGroupId === null) return notebooks;
    return notebooks.filter(n => n.groupId === selectedGroupId);
  }, [notebooks, selectedGroupId]);

  const displayedNotebooks = useMemo(() => {
    if (isExpanded) return filteredNotebooks;
    return filteredNotebooks.slice(0, INITIAL_NOTEBOOKS_LIMIT);
  }, [filteredNotebooks, isExpanded]);

  const hasMoreNotebooks = filteredNotebooks.length > INITIAL_NOTEBOOKS_LIMIT;

  // Calculate total sentences from selected notebooks
  const selectedTotalSentences = useMemo(() => {
    return notebooks
      .filter(n => selectedNotebookIds.includes(n.id))
      .reduce((sum, n) => sum + n.totalSentences, 0);
  }, [notebooks, selectedNotebookIds]);

  if (!isAuthenticated) {
    return (
      <Layout>
        <PageShell scrollMode="page" maxWidth="standard">
          <div className="py-16 text-center">
            <Zap className="h-16 w-16 mx-auto text-[#6B8E7E] mb-4" />
            <h1 className="text-2xl font-bold mb-2 text-[#2F5D50]">{t('practiceHub.loginRequired')}</h1>
            <p className="text-muted-foreground mb-4">{t('practiceHub.loginDescription')}</p>
            <Link href="/login">
              <Button className="bg-[#2F5D50] hover:bg-[#2F5D50]/90">{t('practiceHub.login')}</Button>
            </Link>
          </div>
        </PageShell>
      </Layout>
    );
  }

  if (user?.role !== 'admin') {
    return (
      <Layout>
        <PageShell scrollMode="page" maxWidth="standard">
          <div className="py-16 text-center">
            <Zap className="h-16 w-16 mx-auto text-[#6B8E7E] mb-4" />
            <h1 className="text-2xl font-bold mb-2 text-[#2F5D50]">{t('practiceHub.comingSoon')}</h1>
            <p className="text-muted-foreground mb-4">{t('practiceHub.comingSoonDescription')}</p>
            <Link href="/library">
              <Button className="bg-[#2F5D50] hover:bg-[#2F5D50]/90">{t('practiceHub.backToLibrary')}</Button>
            </Link>
          </div>
        </PageShell>
      </Layout>
    );
  }

  return (
    <Layout>
      <PageShell scrollMode="page" maxWidth="standard">
        <div className="py-8">
        {/* Page Title */}
        <div className="mb-8">
          <h1 className="page-title mb-2 text-[30px]">
            {t('practiceHub.title')}
          </h1>
          <p className="text-muted-foreground text-[14px] mt-[2px] mb-[2px]">
            {t('practiceHub.subtitle')}
          </p>
        </div>

        {/* TIER 1: Hero Banner - Smart Review */}
        <div 
          className="mb-8 p-8 cursor-pointer transition-all duration-300 hover:shadow-2xl bg-[hsl(var(--brand-subtle))]"
          style={{ 
            borderRadius: "2.5rem",
            boxShadow: "0 25px 50px -12px rgba(156, 163, 175, 0.15)"
          }}
          onClick={handleSmartReviewClick}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-6">
              <div className="w-16 h-16 rounded-2xl bg-[#2F5D50]/10 flex items-center justify-center">
                <Sparkles className="h-8 w-8 text-[#2F5D50]" />
              </div>
              <div>
                <h2 className="font-medium text-foreground text-xl mb-1">{t('practiceHub.todaysSmartReview')}</h2>
                <p className="text-muted-foreground">
                  {t('practiceHub.smartReviewDescription')}
                </p>
              </div>
            </div>
            <Button 
              className="bg-[#2F5D50] hover:bg-[#2F5D50]/90 rounded-xl px-8 py-6 text-base"
              disabled={isCheckingAvailability}
              onClick={(e) => {
                e.stopPropagation();
                handleSmartReviewClick();
              }}
            >
              {isCheckingAvailability ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <Zap className="h-5 w-5 mr-2" />
                  {t('practiceHub.startPractice')}
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Learning Collection - Unified Grid */}
        <div className="mt-12">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-medium text-foreground">{t('practiceHub.learningCollection')}</h2>
          </div>

          {/* Group Filter Chips */}
          {groups.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-6">
              <button
                onClick={() => setSelectedGroupId(null)}
                className={`px-4 py-1.5 rounded-full text-sm transition-all ${
                  selectedGroupId === null
                    ? "bg-[#2F5D50] text-white"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                }`}
              >
                {t('practiceHub.all')}
              </button>
              {groups.map((group) => (
                <button
                  key={group.id}
                  onClick={() => setSelectedGroupId(group.id)}
                  className={`px-4 py-1.5 rounded-full text-sm transition-all ${
                    selectedGroupId === group.id
                      ? "bg-[#2F5D50] text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {group.name}
                </button>
              ))}
            </div>
          )}
          
          {isLoadingNotebooks ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div 
                  key={i} 
                  className="bg-card p-6"
                  style={{ 
                    borderRadius: "1.5rem",
                    boxShadow: "0 25px 50px -12px rgba(156, 163, 175, 0.1)"
                  }}
                >
                  <Skeleton className="h-5 w-3/4 mb-3" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ))}
            </div>
          ) : notebooks.length === 0 ? (
            <div 
              className="bg-card text-center py-16 px-8"
              style={{ 
                borderRadius: "1.5rem",
                boxShadow: "0 25px 50px -12px rgba(156, 163, 175, 0.1)"
              }}
            >
              <BookOpen className="h-12 w-12 mx-auto text-muted-foreground/50 mb-4" />
              <h3 className="text-foreground font-medium mb-2">{t('practiceHub.noNotebooks')}</h3>
              <p className="text-muted-foreground text-sm mb-6">
                {t('practiceHub.noNotebooksDescription')}
              </p>
              <Link href="/library">
                <Button variant="outline" className="rounded-xl">{t('practiceHub.startReading')}</Button>
              </Link>
            </div>
          ) : filteredNotebooks.length === 0 ? (
            <div 
              className="bg-card text-center py-12 px-8"
              style={{ 
                borderRadius: "1.5rem",
                boxShadow: "0 25px 50px -12px rgba(156, 163, 175, 0.1)"
              }}
            >
              <BookOpen className="h-10 w-10 mx-auto text-muted-foreground/50 mb-3" />
              <p className="text-muted-foreground text-sm">
                {t('practiceHub.noNotebooksInGroup')}
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 justify-items-start">
                {displayedNotebooks.map((notebook, index) => {
                  const isNewlyExpanded = isExpanded && index >= INITIAL_NOTEBOOKS_LIMIT;
                  const isSelected = selectedNotebookIds.includes(notebook.id);
                  const isCollectionNotebook = notebook.groupId !== null;
                  
                  return (
                    <div 
                      key={notebook.id} 
                      className={`relative p-5 cursor-pointer transition-all duration-300 group w-full ${
                        isSelected 
                          ? "bg-[hsl(var(--brand-subtle))] ring-2 ring-[hsl(var(--brand))]/20" 
                          : "bg-card hover:shadow-2xl"
                      } ${isNewlyExpanded ? "animate-in fade-in slide-in-from-top-2" : ""}`}
                      style={{ 
                        borderRadius: "1.25rem",
                        boxShadow: isSelected 
                          ? "0 25px 50px -12px rgba(156, 163, 175, 0.15)"
                          : "0 25px 50px -12px rgba(156, 163, 175, 0.1)",
                        animationDelay: isNewlyExpanded ? `${(index - INITIAL_NOTEBOOKS_LIMIT) * 50}ms` : undefined,
                        animationFillMode: 'backwards'
                      }}
                      onClick={(e) => toggleNotebookSelection(notebook.id, e)}
                    >
                      {/* Selection Checkbox (Visual only, click handled by parent) */}
                      <div 
                        className={`absolute top-4 right-4 z-10 transition-all duration-200 ${
                          isSelected ? "opacity-100 scale-100" : "opacity-30 group-hover:opacity-70 group-hover:scale-100"
                        }`}
                      >
                        <div 
                          className={`w-5 h-5 rounded-full flex items-center justify-center transition-all hover:scale-110 ${
                            isSelected 
                              ? "bg-[#2F5D50] text-white" 
                              : "border-2 border-muted-foreground/30 bg-card hover:border-[#2F5D50]"
                          }`}
                        >
                          {isSelected && <Check className="h-3 w-3" />}
                        </div>
                      </div>

                      <div className="flex items-start gap-4">
                        {/* Notebook Type Icon */}
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                          isSelected ? "bg-white/50 dark:bg-white/10" : "bg-muted"
                        }`}>
                          {isCollectionNotebook ? (
                            <Layers className={`h-5 w-5 ${isSelected ? "text-emerald-700" : "text-slate-400"}`} />
                          ) : (
                            <FileText className={`h-5 w-5 ${isSelected ? "text-emerald-700" : "text-slate-400"}`} />
                          )}
                        </div>
                        
                        <div className="flex-1 min-w-0 pr-6 h-10 flex flex-col justify-center">
                          <h3 className="font-medium text-foreground truncate text-sm leading-tight mb-0.5">
                            {notebook.title}
                          </h3>
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground text-[11px] font-medium uppercase tracking-wider">
                              {notebook.totalSentences} {t('practiceHub.sentences')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Expand/Collapse Button */}
              {hasMoreNotebooks && (
                <div className="flex justify-center mt-8">
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="flex items-center gap-2 px-6 py-2.5 text-muted-foreground hover:text-[#2F5D50] dark:hover:text-emerald-400 transition-colors rounded-full hover:bg-emerald-50/50 dark:hover:bg-emerald-900/20"
                  >
                    <span className="text-sm font-medium">
                      {isExpanded 
                        ? t('practiceHub.collapse') 
                        : t('practiceHub.showMore', { count: filteredNotebooks.length - INITIAL_NOTEBOOKS_LIMIT })
                      }
                    </span>
                    <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`} />
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        </div>
      </PageShell>
      {/* Floating Action Bar - Modern Zen Design */}
      <div 
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ease-out ${
          selectedNotebookIds.length > 0 
            ? "translate-y-0 opacity-100" 
            : "translate-y-8 opacity-0 pointer-events-none"
        }`}
      >
        <div 
          className="bg-card/95 dark:bg-card/90 backdrop-blur-xl px-3 py-3 flex items-center gap-3 border border-border/50"
          style={{
            borderRadius: "9999px",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.03)"
          }}
        >
          {/* Close Button */}
          <button 
            onClick={clearSelection}
            className="p-2 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            title={t('practiceHub.clearSelection')}
          >
            <X className="h-5 w-5" />
          </button>

          {/* Selection Info */}
          <div className="px-3 border-r border-border">
            <p className="text-foreground font-medium text-sm whitespace-nowrap">
              {t('practiceHub.selectedCount', { count: selectedNotebookIds.length })}
            </p>
            <p className="text-muted-foreground text-xs whitespace-nowrap">
              {selectedTotalSentences} {t('practiceHub.sentences')}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            {/* Sentence Practice Button */}
            <Button
              onClick={handleMultiNotebookQuizStart}
              disabled={isStartingMultiQuiz || selectedTotalSentences < 3}
              variant="outline"
              className="rounded-xl px-5 py-2.5 text-sm font-medium h-auto border-[#2F5D50]/20 text-[#2F5D50] hover:bg-[hsl(var(--brand-subtle))] hover:text-[#2F5D50]"
            >
              {isStartingMultiQuiz ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <MessageSquareText className="h-4 w-4 mr-2" />
                  {t('practiceHub.sentencePractice')}
                </>
              )}
            </Button>

            {/* Term Master Button */}
            <Button
              onClick={handleVocabularyClick}
              disabled={isCheckingVocab}
              variant="outline"
              className="rounded-xl px-5 py-2.5 text-sm font-medium h-auto border-[#2F5D50]/20 text-[#2F5D50] hover:bg-[hsl(var(--brand-subtle))] hover:text-[#2F5D50]"
            >
              {isCheckingVocab ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <BookMarked className="h-4 w-4 mr-2" />
                  {t('practiceHub.termMaster')}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
      {/* Insufficient Items Dialog */}
      <Dialog open={showInsufficientDialog} onOpenChange={setShowInsufficientDialog}>
        <DialogContent 
          className="max-w-sm mx-4 p-8"
          style={{ borderRadius: "1.5rem", border: "none" }}
        >
          <div className="text-center">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-5">
              <BookOpen className="h-7 w-7 text-muted-foreground" />
            </div>
            <DialogTitle className="text-lg font-medium text-foreground mb-2">
              {dialogType === "vocab" 
                ? t('practiceHub.collectMoreTerms')
                : t('practiceHub.collectMoreSentences')
              }
            </DialogTitle>
            <p className="text-muted-foreground text-sm leading-relaxed mb-6">
              {dialogType === "vocab"
                ? t('practiceHub.minTermsRequired')
                : t('practiceHub.minSentencesRequired')
              }
            </p>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => setShowInsufficientDialog(false)}
                className="flex-1 rounded-xl"
              >
                {t('practiceHub.confirm')}
              </Button>
              <Link href="/library" className="flex-1">
                <Button className="w-full rounded-xl bg-[#2F5D50] hover:bg-[#2F5D50]/90">
                  {t('practiceHub.goToReader')}
                </Button>
              </Link>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {/* No Due Items Dialog */}
      <Dialog open={showNoDueDialog} onOpenChange={setShowNoDueDialog}>
        <DialogContent 
          className="max-w-sm mx-4 p-8"
          style={{ borderRadius: "1.5rem", border: "none" }}
        >
          <div className="text-center">
            <div className="w-14 h-14 rounded-full flex items-center justify-center mx-auto mb-5 bg-[#2F5D50]/10">
              <Sparkles className="h-7 w-7 text-[#2F5D50]" />
            </div>
            <DialogTitle className="text-lg font-medium text-foreground mb-2">
              {t('practiceHub.noDueItemsToday')}
            </DialogTitle>
            <p className="text-muted-foreground text-sm leading-relaxed mb-6">
              {t('practiceHub.allCaughtUp')}
            </p>
            <div className="flex flex-col gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowNoDueDialog(false);
                  setLocation("/practice/session?mode=vocabulary&freeReview=true");
                }}
                className="w-full rounded-xl border-[#2F5D50]/20 text-[#2F5D50] hover:bg-[hsl(var(--brand-subtle))] hover:text-[#2F5D50]"
              >
                {t('practiceHub.reviewAgain')}
              </Button>
              <Button
                onClick={() => setShowNoDueDialog(false)}
                className="w-full rounded-xl bg-[#2F5D50] hover:bg-[#2F5D50]/90"
              >
                {t('practiceHub.confirm')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Layout>
  );
}
