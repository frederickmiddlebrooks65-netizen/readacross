import { useState, useEffect, useRef } from "react";
import { X, Send, Sparkles, Loader2, Crown, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/hooks/useAuth";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n";

export interface AISideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  selectedSentence: {
    id: number;
    source: string;
    target: string | null;
  } | null;
  documentSummary?: string;
  contextWindow?: {
    previous: string[];
    next: string[];
  };
  userDraft?: string;
  mode: "hover" | "edit" | "chat";
  onSentenceChange?: (sentenceId: number) => void;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MAX_SESSION_QUESTIONS = 15;

function formatMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^• (.+)$/gm, '<li>$1</li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>')
    .replace(/<\/ul>\n?<ul>/g, '')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br/>')
    .replace(/^(.+)$/gm, (match) => {
      if (match.startsWith('<')) return match;
      return match;
    });
}

export default function AISideDrawer({
  isOpen,
  onClose,
  selectedSentence,
  documentSummary = "",
  contextWindow = { previous: [], next: [] },
  userDraft = "",
  mode,
  onSentenceChange,
}: AISideDrawerProps) {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [questionCount, setQuestionCount] = useState(0);
  const [sessionLimitReached, setSessionLimitReached] = useState(false);
  const [dailyLimitReached, setDailyLimitReached] = useState(false);
  const [remainingCalls, setRemainingCalls] = useState<number | null>(null);
  const [isFallback, setIsFallback] = useState(false);
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [showComingSoonModal, setShowComingSoonModal] = useState(false);
  const [lastSentenceId, setLastSentenceId] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  
  const { user, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  
  const userPlan = user?.plan as string | undefined;
  const isStarter = !userPlan || userPlan === "starter" || userPlan === "free";
  const isPro = userPlan === "pro" || userPlan === "admin" || userPlan === "beta_pro";

  const aiAssistMutation = useMutation({
    mutationFn: async (payload: {
      document_summary: string;
      selected_sentence: string;
      context_window: { previous: string[]; next: string[] };
      user_draft: string;
      chat_history: ChatMessage[];
      mode: "hover" | "edit" | "chat";
      user_message?: string;
      questionCount: number;
    }) => {
      const response = await apiRequest("/api/ai/assist", {
        method: "POST",
        json: payload,
      });
      return response;
    },
    onSuccess: (data) => {
      // Always update remaining calls and fallback status if provided
      if (data.remaining !== undefined && data.remaining !== -1) {
        setRemainingCalls(data.remaining);
      }
      if (data.isFallback !== undefined) {
        setIsFallback(data.isFallback);
      }
      
      if (data.limitReached) {
        setDailyLimitReached(true);
        setShowLimitModal(true);
        setRemainingCalls(0);
        return;
      }
      
      if (data.sessionEnded) {
        setSessionLimitReached(true);
        if (data.response) {
          setChatHistory(prev => [
            ...prev,
            { role: "assistant", content: data.sessionEndMessage || data.response }
          ]);
        }
        return;
      }
      
      if (data.response) {
        setChatHistory(prev => [
          ...prev,
          { role: "assistant", content: data.response }
        ]);
        setQuestionCount(prev => prev + 1);
      }
      
      if (questionCount + 1 >= MAX_SESSION_QUESTIONS) {
        setSessionLimitReached(true);
      }
    },
    onError: (error: any) => {
      console.error("[AI Assist Error]", error);
      setChatHistory(prev => [
        ...prev,
        { role: "assistant", content: t('aiDrawer.errorOccurred') || "An error occurred. Please try again." }
      ]);
    },
  });

  // Fetch current usage status when drawer opens for Starter users
  const fetchUsageStatus = async () => {
    try {
      const response = await apiRequest("/api/ai/usage-status");
      if (response.remaining !== undefined && response.remaining !== -1) {
        setRemainingCalls(response.remaining);
      }
      if (response.limitReached) {
        setDailyLimitReached(true);
      }
      if (response.isFallback !== undefined) {
        setIsFallback(response.isFallback);
      }
    } catch (error) {
      console.error("[Usage Status Error]", error);
    }
  };

  useEffect(() => {
    if (isOpen && selectedSentence && selectedSentence.id !== lastSentenceId) {
      setChatHistory([]);
      setQuestionCount(0);
      setSessionLimitReached(false);
      setIsFallback(false);
      setLastSentenceId(selectedSentence.id);
      
      // Fetch current usage status
      if (isAuthenticated) {
        fetchUsageStatus();
      }
    }
  }, [isOpen, selectedSentence?.id, mode, isAuthenticated]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatHistory]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);


  const handleSendMessage = () => {
    if (!inputValue.trim() || !selectedSentence || sessionLimitReached || dailyLimitReached) return;
    
    const userMessage = inputValue.trim();
    setInputValue("");
    
    setChatHistory(prev => [...prev, { role: "user", content: userMessage }]);
    
    const recentHistory = chatHistory.slice(-5);
    
    aiAssistMutation.mutate({
      document_summary: documentSummary,
      selected_sentence: selectedSentence.source,
      context_window: contextWindow,
      user_draft: userDraft || selectedSentence.target || "",
      chat_history: recentHistory,
      mode: "chat",
      user_message: userMessage,
      questionCount: questionCount,
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleQuickChip = (chipType: "simple" | "grammar" | "nuance" | "review" | "alternatives" | "improve") => {
    if (!selectedSentence || sessionLimitReached || dailyLimitReached) return;
    
    const hoverChipLabels = {
      simple: "이 문장을 더 쉬운 표현으로 바꿔 설명해주세요.",
      grammar: "이 문장의 문법 구조를 자세히 분석해주세요.",
      nuance: "이 문장의 전체적인 분위기와 뉘앙스를 분석해주세요.",
    };
    
    const editChipLabels = {
      review: "제 번역을 검토하고 개선점을 알려주세요.",
      alternatives: "다양한 스타일의 번역 대안을 제시해주세요.",
      improve: "번역의 뉘앙스를 더 자연스럽게 다듬어주세요.",
    };

    const hoverChipPrompts = {
      simple: `[쉬운 설명] 친근하고 지적인 멘토처럼, 이 문장의 핵심을 쉽게 풀어서 설명해주세요.

응답 구조 (총 10-12줄):
**핵심 의미**
이 문장이 전달하려는 핵심 개념을 명확하게 설명해주세요. 추상적인 아이디어를 논리적인 구조로 풀어서 직관적으로 이해할 수 있게 해주세요.

**왜 이렇게 표현했을까요?**
저자가 이런 표현을 선택한 이유와 논리적 전개 방식을 설명해주세요.

형식 규칙: 섹션 제목만 **굵게** 표시하세요. 본문에는 굵은 글씨를 사용하지 마세요. 부드럽고 자연스러운 한국어 문장(~입니다/합니다)으로 작성하세요. 250-300 토큰 이내로 완결된 생각을 전달하세요.`,
      grammar: `[구문 해설] 친근하고 지적인 멘토처럼, 이 문장의 구조를 해체하여 분석해주세요.

응답 구조 (총 10-12줄):
**문장 구조 분석**
문장의 뼈대(주어+동사+보어/목적어 등)를 제시하고, 각 구성요소의 역할을 설명해주세요. 동격어구, 관계절, 전치사구 등 복잡한 구조가 있다면 짚어주세요.

**핵심 문법 포인트**
이해를 어렵게 만드는 문법적 포인트를 설명해주세요. 왜 이런 구조가 사용되었는지, 어떻게 해석해야 하는지 알려주세요.

형식 규칙: 섹션 제목만 **굵게** 표시하세요. 본문에는 굵은 글씨를 사용하지 마세요. 부드럽고 자연스러운 한국어 문장(~입니다/합니다)으로 작성하세요. 250-300 토큰 이내로 완결된 생각을 전달하세요.`,
      nuance: `[문장 뉘앙스] 친근하고 지적인 멘토처럼, 이 문장 전체의 톤과 분위기를 분석해주세요.

응답 구조 (총 10-12줄):
**저자의 태도와 의도**
저자가 이 문장을 통해 어떤 태도(확신/조심스러움/비판/중립 등)를 보이는지, 그리고 왜 이런 표현 방식을 선택했는지 설명해주세요.

**문체와 뉘앙스**
이 문장의 격식 수준과 어조의 특징, 그리고 다른 표현 대신 이 표현을 선택한 이유를 설명해주세요.

형식 규칙: 섹션 제목만 **굵게** 표시하세요. 본문에는 굵은 글씨를 사용하지 마세요. 부드럽고 자연스러운 한국어 문장(~입니다/합니다)으로 작성하세요. 250-300 토큰 이내로 완결된 생각을 전달하세요.`,
    };
    
    const editChipPrompts = {
      review: `[번역 검토] 친근하고 지적인 멘토처럼, 제 번역을 분석해주세요.

응답 구조 (총 10-12줄):
**정확성 분석**
원문의 의미가 정확히 전달되었는지 평가해주세요. 누락되거나 왜곡된 부분이 있다면 짚어주세요.

**개선 제안**
더 자연스럽거나 정확한 표현이 있다면 구체적인 대안과 함께 알려주세요.

형식 규칙: 섹션 제목만 **굵게** 표시하세요. 본문에는 굵은 글씨를 사용하지 마세요. 부드럽고 자연스러운 한국어 문장(~입니다/합니다)으로 작성하세요. 250-300 토큰 이내로 완결된 생각을 전달하세요.`,
      alternatives: `[대안 제시] 친근하고 지적인 멘토처럼, 다양한 스타일의 번역을 제시해주세요.

응답 구조 (총 10-12줄):
**직역체**
원문의 어순과 구조를 최대한 유지한 버전입니다.

**의역체**
한국어 표현으로 자연스럽게 재구성한 버전입니다.

**간결체**
핵심만 남기고 간결하게 정리한 버전입니다.

형식 규칙: 섹션 제목만 **굵게** 표시하세요. 본문에는 굵은 글씨를 사용하지 마세요. 부드럽고 자연스러운 한국어 문장(~입니다/합니다)으로 작성하세요. 250-300 토큰 이내로 완결된 생각을 전달하세요.`,
      improve: `[뉘앙스 개선] 친근하고 지적인 멘토처럼, 번역의 분위기를 다듬어주세요.

응답 구조 (총 10-12줄):
**현재 번역의 느낌**
현재 번역이 주는 어조와 분위기를 간단히 분석해주세요.

**개선된 버전**
어미, 조사, 단어의 어감을 미세 조정하여 더 자연스럽게 다듬은 버전을 제시해주세요. 무엇을 왜 바꾸었는지도 간단히 설명해주세요.

형식 규칙: 섹션 제목만 **굵게** 표시하세요. 본문에는 굵은 글씨를 사용하지 마세요. 부드럽고 자연스러운 한국어 문장(~입니다/합니다)으로 작성하세요. 250-300 토큰 이내로 완결된 생각을 전달하세요.`,
    };
    
    const allLabels = { ...hoverChipLabels, ...editChipLabels };
    const allPrompts = { ...hoverChipPrompts, ...editChipPrompts };
    
    const displayLabel = allLabels[chipType as keyof typeof allLabels];
    const apiPrompt = allPrompts[chipType as keyof typeof allPrompts];
    
    if (!displayLabel || !apiPrompt) return;
    
    setChatHistory(prev => [...prev, { role: "user", content: displayLabel }]);
    
    const recentHistory = chatHistory.slice(-5);
    
    aiAssistMutation.mutate({
      document_summary: documentSummary,
      selected_sentence: selectedSentence.source,
      context_window: contextWindow,
      user_draft: userDraft || selectedSentence.target || "",
      chat_history: recentHistory,
      mode: mode === "edit" ? "edit" : "chat",
      user_message: apiPrompt,
      questionCount: questionCount,
    });
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Limit Exceeded Modal for Starter Users */}
      <Dialog open={showLimitModal && isStarter} onOpenChange={setShowLimitModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Crown className="h-5 w-5 text-forest dark:text-slate-400" />
              서비스 점검 안내
            </DialogTitle>
            <DialogDescription>
              현재 ReadAcross는 서비스 고도화 및 시스템 점검 기간입니다. 점검 완료 후 더 멋진 기능으로 찾아뵙겠습니다. (2026년 2월 중 정식 오픈 예정)
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setShowLimitModal(false)}>
              확인
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      
      {/* Main Drawer */}
      
    <div 
      className={`
        bg-background/95 backdrop-blur-md transform-gpu transition-[transform,opacity] duration-300 ease-out
        w-[440px] min-w-[420px] max-w-[460px]
        ${isOpen ? "translate-x-0 pointer-events-auto opacity-100" : "translate-x-full pointer-events-none opacity-0"}
        fixed top-0 right-0 bottom-0 z-50 border-l border-border
        shadow-2xl will-change-transform flex flex-col
      `}
      data-testid="ai-side-drawer"
    >
      <div className="flex items-center justify-between p-4 border-b border-border bg-muted/50">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-forest dark:text-emerald-400" />
          <h2 className="font-sans font-semibold text-foreground" style={{ lineHeight: '1.5' }}>{t('aiDrawer.title') || 'AI Assistant'}</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
          data-testid="button-close-drawer"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {selectedSentence && (
        <div className="p-3 bg-muted/50 border-b border-border">
          <div className="text-xs text-muted-foreground mb-1">{t('aiDrawer.selectedSentence') || 'Selected Sentence'}</div>
          <div className="text-sm font-medium text-foreground line-clamp-3">
            {selectedSentence.source}
          </div>
          {selectedSentence.target && (
            <div className="text-sm text-muted-foreground mt-1 line-clamp-2">
              → {selectedSentence.target}
            </div>
          )}
        </div>
      )}

      <ScrollArea className="flex-1 p-4" ref={scrollRef}>
        <div className="space-y-4">
          {chatHistory.length === 0 && !aiAssistMutation.isPending && (
            <div className="p-4 bg-muted/50 rounded-xl border border-border">
              <p className="text-sm text-muted-foreground text-center">
                {mode === "edit" 
                  ? (t('aiDrawer.initialGuidanceEdit') || "How can I help with your translation? I can review your draft or suggest better alternatives.")
                  : (t('aiDrawer.initialGuidance') || "What would you like to know about this sentence? Please select an option below or type your question.")
                }
              </p>
              
              {/* Quick Chips - Different chips based on mode */}
              <div className="flex flex-wrap justify-center gap-2 mt-3">
                {mode === "edit" ? (
                  <>
                    <button
                      onClick={() => handleQuickChip("review")}
                      disabled={sessionLimitReached || dailyLimitReached || aiAssistMutation.isPending}
                      className="px-3 py-1.5 text-xs rounded-full bg-muted text-muted-foreground hover:bg-brand/20 hover:text-brand dark:hover:bg-brand/30 dark:hover:text-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid="chip-review"
                    >
                      {t('aiDrawer.chipReviewLabel') || 'Review Translation'}
                    </button>
                    <button
                      onClick={() => handleQuickChip("alternatives")}
                      disabled={sessionLimitReached || dailyLimitReached || aiAssistMutation.isPending}
                      className="px-3 py-1.5 text-xs rounded-full bg-muted text-muted-foreground hover:bg-brand/20 hover:text-brand dark:hover:bg-brand/30 dark:hover:text-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid="chip-alternatives"
                    >
                      {t('aiDrawer.chipAlternativesLabel') || 'Suggest Alternatives'}
                    </button>
                    <button
                      onClick={() => handleQuickChip("improve")}
                      disabled={sessionLimitReached || dailyLimitReached || aiAssistMutation.isPending}
                      className="px-3 py-1.5 text-xs rounded-full bg-muted text-muted-foreground hover:bg-brand/20 hover:text-brand dark:hover:bg-brand/30 dark:hover:text-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid="chip-improve"
                    >
                      {t('aiDrawer.chipImproveLabel') || 'Improve Nuance'}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => handleQuickChip("simple")}
                      disabled={sessionLimitReached || dailyLimitReached || aiAssistMutation.isPending}
                      className="px-3 py-1.5 text-xs rounded-full bg-muted text-muted-foreground hover:bg-brand/20 hover:text-brand dark:hover:bg-brand/30 dark:hover:text-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid="chip-simple"
                    >
                      {t('aiDrawer.chipSimpleLabel') || 'Simple Explanation'}
                    </button>
                    <button
                      onClick={() => handleQuickChip("grammar")}
                      disabled={sessionLimitReached || dailyLimitReached || aiAssistMutation.isPending}
                      className="px-3 py-1.5 text-xs rounded-full bg-muted text-muted-foreground hover:bg-brand/20 hover:text-brand dark:hover:bg-brand/30 dark:hover:text-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid="chip-grammar"
                    >
                      {t('aiDrawer.chipGrammarLabel') || 'Grammar Breakdown'}
                    </button>
                    <button
                      onClick={() => handleQuickChip("nuance")}
                      disabled={sessionLimitReached || dailyLimitReached || aiAssistMutation.isPending}
                      className="px-3 py-1.5 text-xs rounded-full bg-muted text-muted-foreground hover:bg-brand/20 hover:text-brand dark:hover:bg-brand/30 dark:hover:text-brand transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      data-testid="chip-nuance"
                    >
                      {t('aiDrawer.chipNuanceLabel') || '문장 뉘앙스'}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          
          {chatHistory.map((message, index) => (
            <div
              key={index}
              className={cn(
                "p-3 rounded-lg text-sm",
                message.role === "user"
                  ? "bg-muted/70 ml-8 text-foreground"
                  : "bg-card border border-border mr-8 text-foreground"
              )}
              data-testid={`chat-message-${message.role}`}
            >
              {message.role === "assistant" ? (
                <div 
                  className="whitespace-pre-wrap [&>p]:mb-2 [&>ul]:ml-4 [&>ul]:list-disc [&>ol]:ml-4 [&>ol]:list-decimal [&_strong]:text-foreground [&_strong]:font-semibold"
                  dangerouslySetInnerHTML={{ __html: formatMarkdown(message.content) }}
                />
              ) : (
                <div className="whitespace-pre-wrap">{message.content}</div>
              )}
            </div>
          ))}
          
          {aiAssistMutation.isPending && (
            <div className="flex items-center gap-2 text-muted-foreground p-3">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">{t('aiDrawer.thinking') || 'Thinking...'}</span>
            </div>
          )}

          {sessionLimitReached && (
            <div className="p-3 bg-muted border border-border rounded-lg text-sm text-muted-foreground">
              <p className="font-medium mb-1 text-foreground">대화 세션이 종료되었습니다</p>
              <p className="text-xs">다른 문맥에서 새로운 통찰을 찾아보시는 건 어떨까요?</p>
            </div>
          )}

          {dailyLimitReached && isStarter && (
            <div className="p-4 bg-[hsl(var(--brand-subtle))] dark:bg-slate-800/40 border border-[hsl(var(--sage-soft))] dark:border-slate-700 rounded-lg">
              <div className="flex items-start gap-2">
                <Crown className="h-5 w-5 text-forest dark:text-slate-400 flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-forest dark:text-slate-300">
                    이번 달 토큰 사용량을 초과했습니다
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Starter 플랜의 월간 토큰 한도에 도달했습니다. 
                    Pro로 업그레이드하여 더 많은 AI 코칭을 받아보세요.
                  </p>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => setShowComingSoonModal(true)}
                    className="mt-2 h-7 text-xs bg-forest hover:bg-forest-hover"
                  >
                    Pro로 업그레이드
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="p-4 border-t border-border bg-background">
        {/* Zen Indicator for Pro users in fallback mode */}
        {isPro && isFallback && (
          <div className="flex items-center gap-1.5 mb-2 text-xs text-muted-foreground">
            <Zap className="h-3 w-3" />
            <span>표준 모드로 응답 중</span>
          </div>
        )}
        
        <div className="flex gap-2">
          <Textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              sessionLimitReached 
                ? "다른 문맥에서 새로운 통찰을 찾아보시는 건 어떨까요?"
                : dailyLimitReached && isStarter
                  ? "오늘의 대화 횟수를 모두 사용했습니다"
                  : t('aiDrawer.askPlaceholder') || "Ask a question about this sentence..."
            }
            disabled={sessionLimitReached || (dailyLimitReached && isStarter) || aiAssistMutation.isPending}
            className="flex-1 min-h-[60px] max-h-[120px] resize-none"
            data-testid="input-ai-message"
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || sessionLimitReached || (dailyLimitReached && isStarter) || aiAssistMutation.isPending}
            className="self-end bg-forest hover:bg-forest-hover text-white"
            data-testid="button-send-message"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex justify-between items-center mt-2 text-xs text-muted-foreground">
          {isPro && (
            <span className="text-forest dark:text-slate-400 font-medium">
              {t('aiDrawer.turnsLabel') || '세션'}: {MAX_SESSION_QUESTIONS - questionCount}/{MAX_SESSION_QUESTIONS}
            </span>
          )}
          {isStarter && remainingCalls !== null && (
            <span className="flex items-center gap-1 text-forest dark:text-slate-400 font-medium">
              남은 토큰: {remainingCalls !== null ? remainingCalls.toLocaleString() : '...'}
            </span>
          )}
        </div>
      </div>
    </div>

    {/* Coming Soon Modal for Pro upgrade */}
    <Dialog open={showComingSoonModal} onOpenChange={setShowComingSoonModal}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-forest" />
            준비 중입니다
          </DialogTitle>
          <DialogDescription className="text-base pt-2">
            결제 기능은 현재 개발 중입니다. 조금만 기다려 주세요! 곧 더 나은 서비스로 찾아뵙겠습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => setShowComingSoonModal(false)} className="bg-forest hover:bg-forest-hover">
            확인
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
