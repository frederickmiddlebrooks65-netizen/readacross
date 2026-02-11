import React, { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Brain,
  Clock,
  Target,
  Award,
  CheckCircle,
  RefreshCw,
  BookOpen,
  AlertCircle
} from "lucide-react";

interface ReviewCardModeProps {
  recommendations: DailyRecommendation[];
  onClose: () => void;
}

interface DailyRecommendation {
  id: number;
  source: string;
  translation?: string;
  aiTranslation?: string;
  reason: 'low_score' | 'not_practiced' | 'long_gap';
  lastScore?: number;
  daysSinceLastPractice?: number;
  priority: number;
}

interface FeedbackResult {
  score: number;
  aiTranslation: string;
}

export default function ReviewCardMode({ recommendations, onClose }: ReviewCardModeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userTranslation, setUserTranslation] = useState("");
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState<FeedbackResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completedCards, setCompletedCards] = useState<Set<number>>(new Set());
  const [restudyCards, setRestudyCards] = useState<Set<number>>(new Set());
  const [sessionStartTime] = useState(Date.now());

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const currentCard = recommendations[currentIndex];
  const totalCards = recommendations.length;
  const progress = ((currentIndex + 1) / totalCards) * 100;

  // 번역 제출 처리 (간단한 점수 계산)
  const submitTranslation = () => {
    if (!userTranslation.trim()) {
      toast({
        title: "번역을 입력해주세요",
        description: "번역을 입력한 후 제출하세요.",
        variant: "destructive"
      });
      return;
    }

    // 간단한 점수 계산 (예시)
    const userLength = userTranslation.trim().length;
    const sourceLength = currentCard.source.length;
    const lengthRatio = Math.min(userLength / sourceLength, 2); // 최대 2배까지
    const baseScore = Math.max(1, Math.min(10, Math.round(5 + lengthRatio * 2)));
    
    const result: FeedbackResult = {
      score: baseScore,
      aiTranslation: currentCard.translation || currentCard.aiTranslation || "번역을 찾을 수 없습니다."
    };
    
    setFeedback(result);
    setShowFeedback(true);
    setIsSubmitting(false);
  };

  // 복습 결과 저장 mutation
  const saveResultMutation = useMutation({
    mutationFn: async (data: { 
      sentenceId: number; 
      score: number; 
      userTranslation: string; 
      needsReview: boolean 
    }) => {
      return apiRequest(`/api/review/${data.sentenceId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          score: data.score,
          userTranslation: data.userTranslation,
          needsReview: data.needsReview,
          sessionTime: Date.now() - sessionStartTime
        })
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recommendations/daily-review"] });
      queryClient.invalidateQueries({ queryKey: ["/api/practice/stats"] });
    }
  });

  const handleSubmitTranslation = useCallback(() => {
    setIsSubmitting(true);
    submitTranslation();
  }, [userTranslation, currentCard]);

  const handleNextCard = useCallback(() => {
    if (feedback) {
      // 결과 저장
      saveResultMutation.mutate({
        sentenceId: currentCard.id,
        score: feedback.score,
        userTranslation: userTranslation,
        needsReview: restudyCards.has(currentCard.id)
      });
    }

    // 다음 카드로 이동 또는 완료
    if (currentIndex < totalCards - 1) {
      setCurrentIndex(prev => prev + 1);
      setUserTranslation("");
      setShowFeedback(false);
      setFeedback(null);
      setIsSubmitting(false);
    } else {
      // 세션 완료
      const completedCount = completedCards.size + 1;
      const restudyCount = Array.from(restudyCards).length;
      
      toast({
        title: "복습 완료!",
        description: `${completedCount}개 문장 완료, ${restudyCount}개 다시 연습 예정`,
      });
      
      onClose();
    }
  }, [currentIndex, totalCards, feedback, currentCard, userTranslation, completedCards, restudyCards, saveResultMutation, onClose]);

  const handleRestudyCard = useCallback(() => {
    // 현재 상태를 초기화하여 다시 연습할 수 있도록 함
    setUserTranslation("");
    setShowFeedback(false);
    setFeedback(null);
    setIsSubmitting(false);
    
    // 복습 목록에 추가
    setRestudyCards(prev => new Set([...Array.from(prev), currentCard.id]));
    
    toast({
      title: "다시 연습하기",
      description: "번역을 다시 시도해보세요.",
    });
  }, [currentCard]);

  // Previous card function removed

  // 키보드 단축키 지원
  useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && e.ctrlKey && !showFeedback) {
        handleSubmitTranslation();
      } else if (e.key === 'ArrowRight' && showFeedback) {
        handleNextCard();
      }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
  }, [handleSubmitTranslation, handleNextCard, showFeedback]);

  // Remove unused effect

  const getReasonBadge = (reason: string, card: DailyRecommendation) => {
    switch (reason) {
      case 'low_score':
        return (
          <Badge variant="destructive" className="text-xs">
            <Brain className="h-3 w-3 mr-1" />
            낮은 점수 ({card.lastScore}/10)
          </Badge>
        );
      case 'not_practiced':
        return (
          <Badge variant="secondary" className="text-xs">
            <AlertCircle className="h-3 w-3 mr-1" />
            미연습
          </Badge>
        );
      case 'long_gap':
        return (
          <Badge variant="outline" className="text-xs">
            <Clock className="h-3 w-3 mr-1" />
            {card.daysSinceLastPractice}일 전
          </Badge>
        );
      default:
        return null;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 8) return "text-green-600";
    if (score >= 6) return "text-yellow-600";
    return "text-red-600";
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* 헤더 및 진행률 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <RotateCcw className="h-6 w-6 text-orange-600" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">
                🔁 오늘의 추천 복습 ({currentIndex + 1}/{totalCards})
              </h2>
              <p className="text-sm text-gray-600">개인화된 추천 알고리즘 기반으로 선별된 문장들</p>
            </div>
          </div>
          <Button variant="outline" onClick={onClose}>
            닫기
          </Button>
        </div>
        
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span>진행률</span>
            <span>{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      </div>

      {/* 메인 카드 */}
      <Card className="border-l-4 border-l-orange-500">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {getReasonBadge(currentCard.reason, currentCard)}
            </div>
            <div className="text-sm text-muted-foreground">
              카드 {currentIndex + 1} / {totalCards}
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* 원문 문장 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-blue-600" />
              <span className="font-medium text-gray-700">원문 문장</span>
            </div>
            <div className="p-4 bg-gray-50 rounded-lg border-l-2 border-l-blue-300">
              <p className="text-lg leading-relaxed">{currentCard.source}</p>
            </div>
          </div>

          {/* 번역 입력란 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-green-600" />
              <span className="font-medium text-gray-700">내 번역 입력</span>
            </div>
            <Textarea
              value={userTranslation}
              onChange={(e) => setUserTranslation(e.target.value)}
              placeholder="여기에 번역을 입력하세요..."
              className="min-h-20 text-base"
              disabled={showFeedback}
            />
            <p className="text-xs text-muted-foreground">
              💡 Ctrl + Enter로 빠른 제출 가능
            </p>
          </div>

          {/* 결과 표시 */}
          {showFeedback && feedback && (
            <div className="space-y-4 p-4 bg-blue-50 rounded-lg border">
              <div className="flex items-center gap-2">
                <Award className="h-5 w-5 text-blue-600" />
                <span className="font-medium">권장 번역</span>
                <Badge className={`ml-auto ${getScoreColor(feedback.score)}`}>
                  점수: {feedback.score}/10
                </Badge>
              </div>
              
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium text-green-700">{feedback.aiTranslation}</p>
                </div>
              </div>
            </div>
          )}

          {/* 액션 버튼들 */}
          <div className="flex items-center justify-end pt-4">
            <div className="flex items-center gap-3">
              {!showFeedback ? (
                <Button
                  variant="default"
                  onClick={handleSubmitTranslation}
                  disabled={!userTranslation.trim() || isSubmitting}
                >
                  {isSubmitting ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <CheckCircle className="h-4 w-4 mr-2" />
                  )}
                  번역 제출
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    onClick={handleRestudyCard}
                    className="text-orange-600 border-orange-600 hover:bg-orange-50"
                  >
                    <RotateCcw className="h-4 w-4 mr-2" />
                    다시 연습할래요
                  </Button>
                  <Button
                    variant="default"
                    onClick={handleNextCard}
                  >
                    {currentIndex === totalCards - 1 ? (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        복습 완료
                      </>
                    ) : (
                      <>
                        <ChevronRight className="h-4 w-4 mr-2" />
                        다음 문장
                      </>
                    )}
                  </Button>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}