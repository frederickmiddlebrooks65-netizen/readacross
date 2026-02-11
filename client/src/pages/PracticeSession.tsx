import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  ChevronLeft,
  Check,
  RotateCcw,
  Loader2,
  BookOpen,
} from "lucide-react";
import { useTranslation } from "@/i18n";

interface SmartReviewItem {
  id: number;
  type: "sentence" | "glossary";
  quizType: 1 | 2 | 3;
  quizFormat?: "flashcard" | "fill-in-blank";
  masteryLevel: number;
  hint: string;
  hintLanguage: string;
  expectedAnswer: string;
  answerLanguage: string;
  source?: string | null;
  target?: string | null;
  term?: string;
  definition?: string | null;
  translation?: string | null;
  contextSentence?: string | null;
}

interface SessionResult {
  itemId: number;
  type: "sentence" | "glossary";
  isCorrect: boolean;
  userAnswer?: string;
}

type SessionMode = "notebook" | "smart-review" | "glossary-only" | "vocabulary" | "multi-notebook";

export default function PracticeSession() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { isAuthenticated, user } = useAuth();
  const { t } = useTranslation();
  const { toast } = useToast();

  const urlParams = new URLSearchParams(window.location.search);
  const modeParam = urlParams.get("mode");
  const notebookIdsParam = urlParams.get("notebookIds");
  const freeReviewParam = urlParams.get("freeReview") === "true";
  const sessionMode: SessionMode = modeParam as SessionMode || (notebookIdsParam ? "multi-notebook" : "notebook");
  const isFreeReviewMode = freeReviewParam;

  const [currentIndex, setCurrentIndex] = useState(0);
  const [sessionResults, setSessionResults] = useState<SessionResult[]>([]);
  const [isComplete, setIsComplete] = useState(false);
  const [userInput, setUserInput] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [showFeedback, setShowFeedback] = useState(false);
  const [sessionItems, setSessionItems] = useState<SmartReviewItem[]>([]);

  const { data, isLoading } = useQuery<{
    items?: SmartReviewItem[];
    sentences?: SmartReviewItem[];
    notebooks?: { id: number; title: string }[];
    totalNotebooks?: number;
    totalSentences?: number;
    total?: number;
    sessionSize?: number;
    userLanguages?: { base: string; learning: string };
    insufficientItems?: boolean;
    noDueItems?: boolean;
    minRequired?: number;
  }>({
    queryKey: sessionMode === "smart-review" 
      ? ["/api/quiz/smart-review"]
      : sessionMode === "vocabulary"
      ? ["/api/quiz/vocabulary", isFreeReviewMode]
      : sessionMode === "glossary-only"
      ? ["/api/quiz/glossary-items"]
      : sessionMode === "multi-notebook"
      ? ["/api/quiz/multi-notebook", notebookIdsParam]
      : ["/api/quiz/sentences", id],
    queryFn: async () => {
      if (sessionMode === "smart-review") {
        return await apiRequest(`/api/quiz/smart-review`);
      }
      if (sessionMode === "vocabulary") {
        const freeReviewQuery = isFreeReviewMode ? "?freeReview=true" : "";
        return await apiRequest(`/api/quiz/vocabulary${freeReviewQuery}`);
      }
      if (sessionMode === "glossary-only") {
        return await apiRequest(`/api/quiz/glossary-items?limit=7`);
      }
      if (sessionMode === "multi-notebook" && notebookIdsParam) {
        return await apiRequest(`/api/quiz/multi-notebook?notebookIds=${notebookIdsParam}&direction=en-ko`);
      }
      return await apiRequest(`/api/quiz/sentences/${id}?direction=en-ko`);
    },
    enabled: isAuthenticated && (sessionMode === "smart-review" || sessionMode === "vocabulary" || sessionMode === "glossary-only" || sessionMode === "multi-notebook" || !!id),
  });

  const initialItems: SmartReviewItem[] = useMemo(() => {
    if (data?.items) return data.items;
    if (data?.sentences) {
      return data.sentences.map(s => ({
        ...s,
        type: s.type || "sentence" as const,
        quizType: (Math.floor(Math.random() * 3) + 1) as 1 | 2 | 3,
        hint: s.target || s.hint || "",
        hintLanguage: "ko",
        expectedAnswer: s.source || s.expectedAnswer || "",
        answerLanguage: "en",
      }));
    }
    return [];
  }, [data]);

  // Initialize session items when data loads
  useEffect(() => {
    if (initialItems.length > 0 && sessionItems.length === 0) {
      setSessionItems(initialItems);
    }
  }, [initialItems, sessionItems.length]);

  // Use session items (which can be modified dynamically) for the active session
  const items = sessionItems.length > 0 ? sessionItems : initialItems;
  const currentItem = items[currentIndex];
  const progress = items.length > 0 ? ((currentIndex) / items.length) * 100 : 0;

  const submitMutation = useMutation({
    mutationFn: async (data: { sentenceId?: number; glossaryId?: number; userAnswer: string; isCorrect: boolean; mode: string; rating?: "again" | "hard" | "good"; skipSrs?: boolean }) => {
      // In Free Review mode, skip SRS updates entirely
      if (data.skipSrs || isFreeReviewMode) {
        return { success: true, skipped: true };
      }
      if (data.glossaryId && data.rating) {
        return await apiRequest("/api/quiz/submit-glossary", { 
          method: "POST", 
          json: { glossaryId: data.glossaryId, rating: data.rating } 
        });
      }
      return await apiRequest("/api/quiz/submit", { method: "POST", json: data });
    },
  });

  // Re-queue item for "Again" rating - adds to end of session
  const reQueueCurrentItem = useCallback(() => {
    if (currentItem) {
      // Create a fresh copy with new quiz format to vary the experience
      const requeuedItem: SmartReviewItem = {
        ...currentItem,
        // Randomize quiz format for variety
        quizFormat: Math.random() < 0.5 ? "flashcard" : "fill-in-blank",
      };
      setSessionItems(prev => [...prev, requeuedItem]);
      toast({
        description: t('practiceSession.reQueuedToast'),
        duration: 2000,
      });
    }
  }, [currentItem, toast, t]);

  const checkAnswer = useCallback(() => {
    if (!currentItem || !userInput.trim()) return;

    const expected = currentItem.expectedAnswer.toLowerCase().trim();
    const user = userInput.toLowerCase().trim();
    
    const similarity = calculateSimilarity(user, expected);
    const correct = similarity >= 0.85;

    setIsCorrect(correct);
    setShowAnswer(true);
    setShowFeedback(true);

    submitMutation.mutate({
      sentenceId: currentItem.type === "sentence" ? currentItem.id : undefined,
      glossaryId: currentItem.type === "glossary" ? currentItem.id : undefined,
      userAnswer: userInput,
      isCorrect: correct,
      mode: "production",
    });

    setSessionResults(prev => [...prev, {
      itemId: currentItem.id,
      type: currentItem.type,
      isCorrect: correct,
      userAnswer: userInput,
    }]);
  }, [currentItem, userInput]);

  const handleNext = useCallback(() => {
    if (currentIndex < items.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setUserInput("");
      setShowAnswer(false);
      setIsCorrect(null);
      setShowFeedback(false);
    } else {
      setIsComplete(true);
    }
  }, [currentIndex, items.length]);

  const handleRestart = () => {
    setCurrentIndex(0);
    setSessionResults([]);
    setIsComplete(false);
    setUserInput("");
    setShowAnswer(false);
    setIsCorrect(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (showAnswer) {
        handleNext();
      } else if (userInput.trim()) {
        checkAnswer();
      }
    }
  };

  useEffect(() => {
    if (data?.insufficientItems || data?.noDueItems) {
      setLocation("/practice");
    }
  }, [data?.insufficientItems, data?.noDueItems, setLocation]);

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center px-8">
          <BookOpen className="h-12 w-12 mx-auto text-[#6B8E7E] mb-6" />
          <h1 className="text-xl font-medium text-[#2F5D50] mb-4">{t('practiceSession.loginRequired')}</h1>
          <Button 
            onClick={() => setLocation("/login")}
            className="bg-[#2F5D50] hover:bg-[#2F5D50]/90 rounded-full px-8"
          >
            {t('practiceSession.login')}
          </Button>
        </div>
      </div>
    );
  }

  if (user?.role !== 'admin') {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center px-8">
          <BookOpen className="h-12 w-12 mx-auto text-[#6B8E7E] mb-6" />
          <h1 className="text-xl font-medium text-[#2F5D50] mb-4">{t('practiceSession.inDevelopment')}</h1>
          <Button 
            onClick={() => setLocation("/library")}
            className="bg-[#2F5D50] hover:bg-[#2F5D50]/90 rounded-full px-8"
          >
            {t('practiceSession.backToLibrary')}
          </Button>
        </div>
      </div>
    );
  }

  if (data?.insufficientItems || data?.noDueItems) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#6B8E7E]" />
      </div>
    );
  }

  if (isComplete) {
    const correctCount = sessionResults.filter(r => r.isCorrect).length;
    const totalCount = sessionResults.length;

    return (
      <div className="min-h-screen bg-white">
        <div className="h-[2px] bg-[#A7DCC5] w-full" />
        
        <div className="max-w-lg mx-auto px-6 py-16">
          <div className="text-center mb-12">
            <div className="w-20 h-20 rounded-full bg-[#A7DCC5]/30 flex items-center justify-center mx-auto mb-6">
              <Check className="h-10 w-10 text-[#2F5D50]" />
            </div>
            <h1 className="font-sans font-semibold text-2xl text-[#2F5D50] mb-2" style={{ lineHeight: '1.5' }}>{t('practiceSession.greatJob')}</h1>
            <p className="text-[#6B8E7E] text-sm">{t('practiceSession.completedReview')}</p>
          </div>

          <div className="bg-[#F8FAF9] rounded-2xl p-8 mb-8">
            <div className="flex justify-between items-center">
              <div className="text-center flex-1">
                <div className="text-3xl font-light text-[#2F5D50]">{totalCount}</div>
                <div className="text-xs text-[#6B8E7E] mt-1">{t('practiceSession.questions')}</div>
              </div>
              <div className="w-px h-12 bg-[#E5E7EB]" />
              <div className="text-center flex-1">
                <div className="text-3xl font-light text-[#2F5D50]">{correctCount}</div>
                <div className="text-xs text-[#6B8E7E] mt-1">{t('practiceSession.correct')}</div>
              </div>
              <div className="w-px h-12 bg-[#E5E7EB]" />
              <div className="text-center flex-1">
                <div className="text-3xl font-light text-[#2F5D50]">
                  {totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0}%
                </div>
                <div className="text-xs text-[#6B8E7E] mt-1">{t('practiceSession.accuracy')}</div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <Button
              onClick={handleRestart}
              variant="outline"
              className="w-full py-6 rounded-xl border-[#2F5D50]/20 text-[#2F5D50] hover:bg-[hsl(var(--brand-subtle))] hover:text-[#2F5D50]"
            >
              <RotateCcw className="h-4 w-4 mr-2" />
              {t('practiceSession.practiceAgain')}
            </Button>
            <Button
              onClick={() => setLocation("/practice")}
              className="w-full py-6 rounded-xl bg-[#2F5D50] hover:bg-[#2F5D50]/90"
            >
              {t('practiceSession.backToHub')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      <div 
        className="h-[2px] bg-[#2F5D50] transition-all duration-500 ease-out"
        style={{ width: `${progress}%` }}
      />

      <header className="px-6 py-4 flex items-center justify-between">
        <Button 
          variant="ghost" 
          size="sm" 
          onClick={() => setLocation("/practice")}
          className="text-[#6B8E7E] hover:text-[#2F5D50] -ml-2"
        >
          <ChevronLeft className="h-4 w-4 mr-1" />
          {t('practiceSession.exit')}
        </Button>
        <span className="text-sm text-[#6B8E7E]">
          {currentIndex + 1} / {items.length}
        </span>
      </header>

      <main className="flex-1 flex flex-col px-6 pb-8 max-w-2xl mx-auto w-full">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#6B8E7E]" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center">
            <BookOpen className="h-12 w-12 text-[#6B8E7E] mb-6" />
            <h2 className="text-lg font-medium text-[#2F5D50] mb-2">{t('practiceSession.noItemsToPractice')}</h2>
            <p className="text-sm text-[#6B8E7E] mb-6">{t('practiceSession.noItemsDescription')}</p>
            <Button 
              onClick={() => setLocation("/practice")}
              className="rounded-full bg-[#2F5D50] hover:bg-[#2F5D50]/90 px-8"
            >
              {t('practiceSession.goToHub')}
            </Button>
          </div>
        ) : currentItem ? (
          currentItem.type === "glossary" ? (
            <GlossaryCard
              key={currentIndex}
              item={currentItem}
              showAnswer={showAnswer}
              userInput={userInput}
              isCorrect={isCorrect}
              onInputChange={setUserInput}
              onKeyDown={handleKeyDown}
              t={t}
              onCheckAnswer={() => {
                if (!userInput.trim()) return;
                const expected = currentItem.expectedAnswer.toLowerCase().trim();
                const user = userInput.toLowerCase().trim();
                const similarity = calculateSimilarity(user, expected);
                const correct = similarity >= 0.85;
                setIsCorrect(correct);
                setShowAnswer(true);
                setShowFeedback(true);
                
                submitMutation.mutate({
                  glossaryId: currentItem.id,
                  userAnswer: userInput,
                  isCorrect: correct,
                  mode: "glossary",
                  rating: correct ? "good" : "again",
                });
                setSessionResults(prev => [...prev, {
                  itemId: currentItem.id,
                  type: "glossary",
                  isCorrect: correct,
                  userAnswer: userInput,
                }]);
              }}
              onReveal={() => setShowAnswer(true)}
              onRate={(rating) => {
                const correct = rating !== "again";
                
                // Re-queue item if "Again" is selected (immediate reinforcement)
                if (rating === "again") {
                  reQueueCurrentItem();
                }
                
                submitMutation.mutate({
                  glossaryId: currentItem.id,
                  userAnswer: "",
                  isCorrect: correct,
                  mode: "glossary",
                  rating: rating,
                  skipSrs: isFreeReviewMode,
                });
                setSessionResults(prev => [...prev, {
                  itemId: currentItem.id,
                  type: "glossary",
                  isCorrect: correct,
                }]);
                
                setShowAnswer(false);
                setIsCorrect(null);
                setUserInput("");
                setShowFeedback(false);
                handleNext();
              }}
              onNext={() => {
                setShowAnswer(false);
                setIsCorrect(null);
                setUserInput("");
                setShowFeedback(false);
                handleNext();
              }}
              isLoading={submitMutation.isPending}
            />
          ) : (
            <div className="flex-1 flex flex-col justify-center">
              <div className="mb-12">
                <p className="font-sans text-[#6B8E7E] text-lg leading-relaxed mb-2" style={{ fontWeight: 400, lineHeight: '1.5' }}>
                  {t('practiceSession.writeIn', { language: currentItem.answerLanguage === 'en' ? t('practiceSession.english') : t('practiceSession.korean') })}
                </p>
                <p className="font-sans text-xl text-[#374151] leading-relaxed" style={{ fontWeight: 400, lineHeight: '1.5' }}>
                  {currentItem.hint}
                </p>
              </div>

              <div className="space-y-6">
                {currentItem.quizType === 1 ? (
                  <WordBankInput
                    key={currentIndex}
                    expectedAnswer={currentItem.expectedAnswer}
                    onComplete={(answer) => {
                      setUserInput(answer);
                    }}
                    disabled={showAnswer}
                    t={t}
                  />
                ) : currentItem.quizType === 2 ? (
                  <PartialFillInput
                    key={currentIndex}
                    expectedAnswer={currentItem.expectedAnswer}
                    userInput={userInput}
                    onChange={setUserInput}
                    onKeyDown={handleKeyDown}
                    disabled={showAnswer}
                  />
                ) : (
                  <Input
                    value={userInput}
                    onChange={(e) => setUserInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('practiceSession.enterAnswer')}
                    disabled={showAnswer}
                    className="w-full py-6 px-4 text-lg border-0 border-b-2 border-[#E5E7EB] focus:border-[#2F5D50] rounded-none bg-transparent transition-colors focus-visible:ring-0"
                    autoFocus
                  />
                )}

                <div className={`transition-all duration-300 ease-out overflow-hidden ${
                  showFeedback ? 'opacity-100 max-h-40' : 'opacity-0 max-h-0'
                }`}>
                  <div className={`p-6 rounded-2xl ${
                    isCorrect ? 'bg-emerald-50/50' : 'bg-rose-50/50'
                  }`}>
                    <p className={`text-xs uppercase tracking-widest font-medium mb-3 ${
                      isCorrect ? 'text-emerald-600' : 'text-rose-500'
                    }`}>
                      {isCorrect ? 'CORRECT' : 'CHECK'}
                    </p>
                    {!isCorrect && (
                      <p className="text-lg text-[#374151] leading-relaxed font-medium">
                        {currentItem.expectedAnswer}
                      </p>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-auto pt-8">
                {!showAnswer ? (
                  <Button
                    onClick={checkAnswer}
                    disabled={!userInput.trim() || submitMutation.isPending}
                    className={`w-full py-6 rounded-xl text-base transition-all duration-300 ${
                      userInput.trim() 
                        ? 'bg-[#2F5D50] hover:bg-[#2F5D50]/90 text-white' 
                        : 'bg-[#E5E7EB] text-[#9CA3AF] cursor-not-allowed'
                    }`}
                  >
                    {submitMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      t('practiceSession.checkAnswer')
                    )}
                  </Button>
                ) : (
                  <Button
                    onClick={handleNext}
                    className="w-full py-6 rounded-xl text-base bg-[#2F5D50] hover:bg-[#2F5D50]/90"
                  >
                    {currentIndex < items.length - 1 ? t('practiceSession.next') : t('practiceSession.complete')}
                  </Button>
                )}
              </div>
            </div>
          )
        ) : null}
      </main>
    </div>
  );
}

function calculateSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, '').trim();
  const aNorm = normalize(a);
  const bNorm = normalize(b);
  
  if (aNorm === bNorm) return 1;
  
  const aWords = aNorm.split(/\s+/).filter(Boolean);
  const bWords = bNorm.split(/\s+/).filter(Boolean);
  
  if (aWords.length === 0 || bWords.length === 0) return 0;
  
  let matches = 0;
  const usedIndices = new Set<number>();
  
  for (const aWord of aWords) {
    for (let i = 0; i < bWords.length; i++) {
      if (!usedIndices.has(i) && aWord === bWords[i]) {
        matches++;
        usedIndices.add(i);
        break;
      }
    }
  }
  
  const wordOrderScore = aWords.join(' ') === bWords.join(' ') ? 0.1 : 0;
  return (matches / Math.max(aWords.length, bWords.length)) + wordOrderScore;
}

function GlossaryCard({
  item,
  showAnswer,
  userInput,
  isCorrect,
  onInputChange,
  onKeyDown,
  onCheckAnswer,
  onReveal,
  onRate,
  onNext,
  isLoading,
  t,
}: {
  item: SmartReviewItem;
  showAnswer: boolean;
  userInput: string;
  isCorrect: boolean | null;
  onInputChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  onCheckAnswer: () => void;
  onReveal: () => void;
  onRate: (rating: "again" | "hard" | "good") => void;
  onNext: () => void;
  isLoading: boolean;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const [showContextHint, setShowContextHint] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const hasContextHint = item.contextSentence && item.contextSentence.trim().length > 0;
  const isFillInBlank = item.quizFormat === "fill-in-blank";

  const handleReveal = () => {
    setIsFlipped(true);
    setTimeout(() => onReveal(), 150);
  };
  
  if (isFillInBlank) {
    return (
      <div className="flex-1 flex flex-col justify-center">
        <div className="mb-8">
          <p className="font-sans text-[#6B8E7E] text-sm mb-2" style={{ fontWeight: 400, lineHeight: '1.5' }}>
            {t('practiceSession.typeOrAssemble')}
          </p>
          <p className="text-2xl font-medium text-[#374151] mb-6">
            {item.hint}
          </p>
          
          {!showAnswer && hasContextHint && (
            <div className="mb-6">
              {showContextHint ? (
                <div className="p-4 bg-[#F8FAF9] rounded-xl text-left">
                  <p className="text-xs text-[#6B8E7E] mb-2">{t('practiceSession.contextHint')}</p>
                  <p className="text-sm text-[#374151] italic leading-relaxed">
                    "{item.contextSentence}"
                  </p>
                </div>
              ) : (
                <button
                  onClick={() => setShowContextHint(true)}
                  className="text-sm text-[#6B8E7E] underline underline-offset-4 hover:text-[#2F5D50] transition-colors"
                >
                  {t('practiceSession.showContextHint')}
                </button>
              )}
            </div>
          )}

          {!showAnswer && (
            <div className="mt-6 mb-4">
              <input
                type="text"
                value={userInput}
                onChange={(e) => onInputChange(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={t('practiceSession.enterMeaningPlaceholder')}
                className="w-full py-4 px-4 text-lg text-center border-0 border-b-2 border-[#E5E7EB] focus:border-[#2F5D50] rounded-none bg-transparent transition-colors focus:outline-none"
                autoFocus
              />
            </div>
          )}
          
          <div className={`transition-all duration-300 ease-out overflow-hidden ${
            showAnswer ? 'opacity-100 max-h-60 mt-6' : 'opacity-0 max-h-0'
          }`}>
            <div className={`p-6 rounded-2xl ${
              isCorrect ? 'bg-emerald-50/50' : 'bg-rose-50/50'
            }`}>
              <p className={`text-xs uppercase tracking-widest font-medium mb-3 ${
                isCorrect ? 'text-emerald-600' : 'text-rose-500'
              }`}>
                {isCorrect ? 'CORRECT' : 'CHECK'}
              </p>
              <p className="text-xl text-[#2F5D50] font-medium leading-relaxed">{item.expectedAnswer}</p>
              {item.definition && (
                <p className="text-sm text-[#6B8E7E] mt-3 leading-relaxed">{item.definition}</p>
              )}
            </div>
          </div>
        </div>

        <div className="mt-auto pt-6">
          {!showAnswer ? (
            <Button
              onClick={onCheckAnswer}
              disabled={!userInput.trim() || isLoading}
              className={`w-full py-6 rounded-xl text-base transition-all duration-300 ${
                userInput.trim() 
                  ? 'bg-[#2F5D50] hover:bg-[#2F5D50]/90 text-white' 
                  : 'bg-[#E5E7EB] text-[#9CA3AF] cursor-not-allowed'
              }`}
            >
              {t('practiceSession.confirm')}
            </Button>
          ) : (
            <Button
              onClick={onNext}
              className="w-full py-6 rounded-xl text-base bg-[#2F5D50] hover:bg-[#2F5D50]/90"
            >
              {t('practiceSession.next')}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col justify-center items-center">
      <p className="font-sans text-[#6B8E7E] text-sm mb-6" style={{ fontWeight: 400, lineHeight: '1.5' }}>
        {t('practiceSession.recallMeaning')}
      </p>
      
      <div 
        className={`w-full max-w-md perspective-1000 transition-transform duration-300 ${
          isFlipped ? 'scale-[0.98]' : ''
        }`}
        style={{ perspective: '1000px' }}
      >
        <div 
          className={`relative w-full transition-all duration-500 ease-out ${
            showAnswer ? 'animate-in fade-in-0 zoom-in-95' : ''
          }`}
          style={{ 
            transformStyle: 'preserve-3d',
            transform: isFlipped && !showAnswer ? 'rotateY(90deg)' : 'rotateY(0deg)'
          }}
        >
          <div className="bg-white rounded-2xl shadow-lg border border-stone-100 overflow-hidden">
            <div className="p-8 text-center">
              <p className="text-3xl font-medium text-[#374151] mb-4">
                {item.hint}
              </p>
              
              {!showAnswer && hasContextHint && (
                <div className="mt-4">
                  {showContextHint ? (
                    <div className="p-4 bg-muted/50 rounded-xl text-left">
                      <p className="text-xs text-[#6B8E7E] mb-2">{t('practiceSession.contextHint')}</p>
                      <p className="text-sm text-[#6B8E7E] italic leading-relaxed">
                        "{item.contextSentence}"
                      </p>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowContextHint(true)}
                      className="text-sm text-[#6B8E7E] underline underline-offset-4 hover:text-[#2F5D50] transition-colors"
                    >
                      {t('practiceSession.showContextHint')}
                    </button>
                  )}
                </div>
              )}
              
              {!showAnswer && !hasContextHint && (
                <p className="text-xs text-[#9CA3AF] mt-4">
                  {t('practiceSession.noContextInfo')}
                </p>
              )}
            </div>
            
            <div className={`transition-all duration-500 ease-out overflow-hidden ${
              showAnswer ? 'max-h-96 opacity-100' : 'max-h-0 opacity-0'
            }`}>
              <div className="border-t border-stone-100" />
              <div className="p-6 bg-muted/50">
                <p className="text-xs uppercase tracking-widest font-medium text-stone-500 mb-3">
                  {t('practiceSession.answer')}
                </p>
                <p className="text-xl text-[#2F5D50] font-medium leading-relaxed mb-3">
                  {item.expectedAnswer}
                </p>
                {item.definition && (
                  <p className="text-sm text-[#6B8E7E] leading-relaxed mb-3">{item.definition}</p>
                )}
                {hasContextHint && (
                  <div className="mt-4 pt-4 border-t border-stone-200">
                    <p className="text-xs text-stone-500 mb-2">{t('practiceSession.contextHint')}</p>
                    <p className="text-sm text-[#6B8E7E] italic leading-relaxed">
                      "{item.contextSentence}"
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full max-w-md mt-8">
        {!showAnswer ? (
          <Button
            onClick={handleReveal}
            className="w-full py-6 rounded-xl text-base bg-[#2F5D50] hover:bg-[#2F5D50]/90"
          >
            {t('practiceSession.showAnswer')}
          </Button>
        ) : (
          <div className="space-y-4">
            <p className="text-center text-sm text-[#6B8E7E]">{t('practiceSession.howWellDoYouKnow')}</p>
            <div className="flex gap-3">
              <Button
                onClick={() => onRate("again")}
                disabled={isLoading}
                variant="outline"
                className="flex-1 py-5 rounded-xl border-rose-200 bg-rose-50/50 text-rose-600 hover:bg-rose-100/50 hover:border-rose-300"
              >
                {t('practiceSession.again')}
              </Button>
              <Button
                onClick={() => onRate("hard")}
                disabled={isLoading}
                variant="outline"
                className="flex-1 py-5 rounded-xl border-amber-200 bg-amber-50/50 text-amber-600 hover:bg-amber-100/50 hover:border-amber-300"
              >
                {t('practiceSession.hard')}
              </Button>
              <Button
                onClick={() => onRate("good")}
                disabled={isLoading}
                className="flex-1 py-5 rounded-xl bg-[#A7DCC5] text-[#2F5D50] hover:bg-[#8FD4B5] border border-[#6B8E7E]/20"
              >
                {t('practiceSession.gotIt')}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function WordBankInput({ 
  expectedAnswer, 
  onComplete, 
  disabled,
  t,
}: { 
  expectedAnswer: string; 
  onComplete: (answer: string) => void;
  disabled: boolean;
  t: (key: string, params?: Record<string, string>) => string;
}) {
  const words = expectedAnswer.split(/\s+/).filter(Boolean);
  const [shuffledWords] = useState(() => [...words].sort(() => Math.random() - 0.5));
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const [availableWords, setAvailableWords] = useState(shuffledWords);

  const handleWordClick = (word: string, index: number) => {
    if (disabled) return;
    const newSelected = [...selectedWords, word];
    setSelectedWords(newSelected);
    setAvailableWords(prev => prev.filter((_, i) => i !== index));
    onComplete(newSelected.join(" "));
  };

  const handleRemoveWord = (index: number) => {
    if (disabled) return;
    const word = selectedWords[index];
    const newSelected = selectedWords.filter((_, i) => i !== index);
    setSelectedWords(newSelected);
    setAvailableWords(prev => [...prev, word]);
    onComplete(newSelected.join(" "));
  };

  return (
    <div className="space-y-6">
      <div className="min-h-[60px] p-4 border-b-2 border-[#E5E7EB] flex flex-wrap gap-2">
        {selectedWords.length === 0 ? (
          <span className="text-[#9CA3AF]">{t('practiceSession.selectWords')}</span>
        ) : (
          selectedWords.map((word, i) => (
            <button
              key={i}
              onClick={() => handleRemoveWord(i)}
              disabled={disabled}
              className="px-3 py-1.5 bg-[#2F5D50] text-white rounded-lg text-sm hover:bg-[#2F5D50]/80 transition-colors disabled:opacity-50"
            >
              {word}
            </button>
          ))
        )}
      </div>
      
      <div className="flex flex-wrap gap-2">
        {availableWords.map((word, i) => (
          <button
            key={i}
            onClick={() => handleWordClick(word, i)}
            disabled={disabled}
            className="px-4 py-2 bg-[#F3F4F6] text-[#374151] rounded-lg hover:bg-[#E5E7EB] transition-colors disabled:opacity-50"
          >
            {word}
          </button>
        ))}
      </div>
    </div>
  );
}

function PartialFillInput({
  expectedAnswer,
  userInput,
  onChange,
  onKeyDown,
  disabled,
}: {
  expectedAnswer: string;
  userInput: string;
  onChange: (value: string) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
  disabled: boolean;
}) {
  const words = expectedAnswer.split(/\s+/).filter(Boolean);
  const blankedIndices = useMemo(() => {
    const indices: number[] = [];
    const blankCount = Math.max(1, Math.floor(words.length * 0.4));
    while (indices.length < blankCount && indices.length < words.length) {
      const idx = Math.floor(Math.random() * words.length);
      if (!indices.includes(idx)) indices.push(idx);
    }
    return indices.sort((a, b) => a - b);
  }, [words.length]);

  const [inputs, setInputs] = useState<string[]>(blankedIndices.map(() => ""));

  const handleInputChange = (index: number, value: string) => {
    const newInputs = [...inputs];
    newInputs[index] = value;
    setInputs(newInputs);
    
    const fullAnswer = words.map((w, i) => 
      blankedIndices.includes(i) ? newInputs[blankedIndices.indexOf(i)] : w
    ).join(" ");
    onChange(fullAnswer);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-lg leading-relaxed">
      {words.map((word, i) => {
        const blankIndex = blankedIndices.indexOf(i);
        if (blankIndex !== -1) {
          return (
            <input
              key={i}
              type="text"
              value={inputs[blankIndex]}
              onChange={(e) => handleInputChange(blankIndex, e.target.value)}
              onKeyDown={onKeyDown}
              disabled={disabled}
              className="w-24 px-2 py-1 border-b-2 border-[#E5E7EB] focus:border-[#2F5D50] bg-transparent text-center outline-none transition-colors disabled:opacity-50"
              placeholder="___"
            />
          );
        }
        return <span key={i} className="text-[#374151]">{word}</span>;
      })}
    </div>
  );
}
