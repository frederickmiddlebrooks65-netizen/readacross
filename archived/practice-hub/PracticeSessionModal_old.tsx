import React, { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatShortDate } from "@/lib/dateUtils";
import { useTimezone } from "@/hooks/useTimezone";
import { 
  ChevronLeft, 
  ChevronRight, 
  X, 
  SkipForward, 
  CheckCircle, 
  Trophy,
  Clock,
  BarChart3,
  RefreshCw
} from "lucide-react";
import TranslationPractice from "./TranslationPractice";
import { Sentence } from "@/lib/types";

interface SentenceCardData extends Sentence {
  document?: {
    title: string;
  };
  isRecommended?: boolean;
  scoreHistory?: number | null;
  isCompleted?: boolean;
  lastPracticeScore?: number;
}

interface PracticeSessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sentences: SentenceCardData[];
  onSessionComplete?: (stats: SessionStats) => void;
}

interface SessionStats {
  totalSentences: number;
  completedSentences: number;
  skippedSentences: number;
  averageScore: number;
  totalTimeSpent: number; // in seconds
}

interface SessionState {
  currentIndex: number;
  completedSentences: Set<number>;
  skippedSentences: Set<number>;
  scores: { [sentenceId: number]: number };
  startTime: number;
  sessionId?: number;
}

export function PracticeSessionModal({ 
  open, 
  onOpenChange, 
  sentences, 
  onSessionComplete 
}: PracticeSessionModalProps) {
  const [sessionState, setSessionState] = useState<SessionState>({
    currentIndex: 0,
    completedSentences: new Set(),
    skippedSentences: new Set(),
    scores: {},
    startTime: Date.now()
  });
  
  const [showPracticeView, setShowPracticeView] = useState(false);
  const [isSessionCompleted, setIsSessionCompleted] = useState(false);
  const { toast } = useToast();
  const { timezone, language } = useTimezone();

  const currentSentence = sentences[sessionState.currentIndex];
  const progress = ((sessionState.completedSentences.size + sessionState.skippedSentences.size) / sentences.length) * 100;

  // Create session on first open
  const createSessionMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("/api/practice/sessions", {
        method: "POST",
        json: {
          title: `Practice Session - ${formatShortDate(new Date(), { timezone, language })}`,
          totalSentences: sentences.length,
          sessionData: JSON.stringify({
            sentenceIds: sentences.map(s => s.id),
            currentIndex: 0
          })
        }
      });
    },
    onSuccess: (session) => {
      setSessionState(prev => ({ ...prev, sessionId: session.id }));
    }
  });

  // Update session progress
  const updateSessionMutation = useMutation({
    mutationFn: async (data: any) => {
      if (!sessionState.sessionId) return;
      return apiRequest(`/api/practice/sessions/${sessionState.sessionId}`, {
        method: "PATCH",
        json: data
      });
    }
  });

  // Initialize session when modal opens and auto-start practice
  useEffect(() => {
    if (open && sentences.length > 0 && !sessionState.sessionId) {
      createSessionMutation.mutate();
      setSessionState(prev => ({ 
        ...prev, 
        startTime: Date.now(),
        currentIndex: 0,
        completedSentences: new Set(),
        skippedSentences: new Set(),
        scores: {}
      }));
      setShowPracticeView(true); // Auto-start practice view
      setIsSessionCompleted(false);
    }
  }, [open, sentences]);

  const handleNext = () => {
    if (sessionState.currentIndex < sentences.length - 1) {
      const newIndex = sessionState.currentIndex + 1;
      setSessionState(prev => ({ ...prev, currentIndex: newIndex }));
      setShowPracticeView(false);
      
      // Update session progress
      updateSessionMutation.mutate({
        sessionData: JSON.stringify({
          sentenceIds: sentences.map(s => s.id),
          currentIndex: newIndex
        })
      });
    } else {
      completeSession();
    }
  };

  const handlePrevious = () => {
    if (sessionState.currentIndex > 0) {
      const newIndex = sessionState.currentIndex - 1;
      setSessionState(prev => ({ ...prev, currentIndex: newIndex }));
      setShowPracticeView(false);
    }
  };

  const handleSkip = () => {
    const sentenceId = currentSentence.id;
    setSessionState(prev => ({
      ...prev,
      skippedSentences: new Set(Array.from(prev.skippedSentences).concat([sentenceId]))
    }));
    
    toast({
      title: "문장을 건너뛰었습니다",
      description: "다음 문장으로 이동합니다."
    });
    
    handleNext();
  };

  const handlePracticeComplete = (score: number) => {
    const sentenceId = currentSentence.id;
    setSessionState(prev => ({
      ...prev,
      completedSentences: new Set(Array.from(prev.completedSentences).concat([sentenceId])),
      scores: { ...prev.scores, [sentenceId]: score }
    }));
    
    // Don't auto-advance - let user click 다음 button manually
    toast({
      title: "번역 평가 완료!",
      description: "'다음' 버튼을 클릭하여 계속하세요."
    });
  };

  const completeSession = () => {
    const timeSpent = Math.floor((Date.now() - sessionState.startTime) / 1000);
    const scores = Object.values(sessionState.scores);
    const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    
    const stats: SessionStats = {
      totalSentences: sentences.length,
      completedSentences: sessionState.completedSentences.size,
      skippedSentences: sessionState.skippedSentences.size,
      averageScore: Math.round(averageScore * 10) / 10,
      totalTimeSpent: timeSpent
    };

    // Update final session data
    updateSessionMutation.mutate({
      status: "completed",
      completedSentences: stats.completedSentences,
      skippedSentences: stats.skippedSentences,
      averageScore: Math.round(averageScore),
      totalTimeSpent: timeSpent,
      completedAt: new Date().toISOString()
    });

    setIsSessionCompleted(true);
    onSessionComplete?.(stats);
    
    toast({
      title: "세션 완료!",
      description: `${stats.completedSentences}개 문장을 완료했습니다.`
    });
  };

  const handleSessionClose = () => {
    if (!isSessionCompleted && sessionState.completedSentences.size > 0) {
      // Save progress for later
      updateSessionMutation.mutate({
        status: "paused",
        sessionData: JSON.stringify({
          sentenceIds: sentences.map(s => s.id),
          currentIndex: sessionState.currentIndex,
          completedSentences: Array.from(sessionState.completedSentences),
          skippedSentences: Array.from(sessionState.skippedSentences),
          scores: sessionState.scores
        })
      });
    }
    onOpenChange(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Session completion view
  if (isSessionCompleted) {
    const timeSpent = Math.floor((Date.now() - sessionState.startTime) / 1000);
    const scores = Object.values(sessionState.scores);
    const averageScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-6 w-6 text-yellow-500" />
              세션 완료!
            </DialogTitle>
            <DialogDescription>
              연습 세션이 성공적으로 완료되었습니다. 결과를 확인해보세요.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto bg-green-100 rounded-full flex items-center justify-center mb-4">
                <CheckCircle className="h-10 w-10 text-green-600" />
              </div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">훌륭해요!</h3>
              <p className="text-gray-600">연습 세션을 성공적으로 완료했습니다.</p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <Card>
                <CardContent className="pt-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-blue-600">
                      {sessionState.completedSentences.size}
                    </div>
                    <div className="text-sm text-gray-600">완료한 문장</div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-green-600">
                      {averageScore.toFixed(1)}
                    </div>
                    <div className="text-sm text-gray-600">평균 점수</div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-purple-600">
                      {formatTime(timeSpent)}
                    </div>
                    <div className="text-sm text-gray-600">소요 시간</div>
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-4">
                  <div className="text-center">
                    <div className="text-2xl font-bold text-orange-600">
                      {Math.round((sessionState.completedSentences.size / sentences.length) * 100)}%
                    </div>
                    <div className="text-sm text-gray-600">완료율</div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setIsSessionCompleted(false);
                  setSessionState(prev => ({
                    ...prev,
                    currentIndex: 0,
                    startTime: Date.now()
                  }));
                  setShowPracticeView(false);
                }}
                className="flex-1"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                다시 연습하기
              </Button>
              <Button onClick={() => onOpenChange(false)} className="flex-1">
                완료
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!currentSentence) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={handleSessionClose}>
      <DialogContent className="max-w-5xl max-h-[95vh] overflow-y-auto p-0">
        <DialogHeader className="p-6 pb-0">
          <div className="flex items-center justify-between">
            <DialogTitle>연습 세션</DialogTitle>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleSessionClose}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Progress Header */}
        <div className="px-6 space-y-4">
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>
              {sessionState.currentIndex + 1} / {sentences.length}
            </span>
            <div className="flex items-center gap-4">
              <Badge variant="secondary">
                <CheckCircle className="h-3 w-3 mr-1" />
                완료: {sessionState.completedSentences.size}
              </Badge>
              <Badge variant="outline">
                <SkipForward className="h-3 w-3 mr-1" />
                건너뜀: {sessionState.skippedSentences.size}
              </Badge>
              <Badge variant="outline">
                <Clock className="h-3 w-3 mr-1" />
                {formatTime(Math.floor((Date.now() - sessionState.startTime) / 1000))}
              </Badge>
            </div>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Navigation */}
        <div className="px-6 pb-4">
          <div className="flex items-center justify-between">
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={sessionState.currentIndex === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              이전
            </Button>

            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={handleSkip}
              >
                <SkipForward className="h-4 w-4 mr-2" />
                건너뛰기
              </Button>


            </div>

            <Button
              variant="outline"
              onClick={handleNext}
              disabled={
                sessionState.currentIndex === sentences.length - 1 ||
                (!sessionState.completedSentences.has(currentSentence.id) && 
                 !sessionState.skippedSentences.has(currentSentence.id))
              }
            >
              다음
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>

        {/* Content Area - Always show practice */}
        <div className="px-6 pb-6">
          <TranslationPractice
            sentence={currentSentence}
            onClose={() => {}} // No close in session mode
            onPracticeComplete={handlePracticeComplete}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}