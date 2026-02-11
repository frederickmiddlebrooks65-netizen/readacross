import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import Layout from "@/components/Layout";
import PageShell from "@/components/layout/PageShell";
import PageHeader from "@/components/layout/PageHeader";
import PageBody from "@/components/layout/PageBody";
import HeaderBar from "@/components/layout/HeaderBar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Brain, 
  TrendingUp, 
  RotateCcw, 
  Target, 
  Calendar, 
  BookOpen, 
  Zap,
  Award,
  Clock,
  ChevronRight,
  Star,
  BarChart3,
  CheckCircle,
  Play,
  Users,
  Trophy,
  RefreshCw,
  Flame,
  ArrowUp,
  ArrowDown,
  Minus
} from "lucide-react";
import { Link } from "wouter";
import TranslationPractice from "@/components/TranslationPractice";
import WordLearning from "@/components/WordLearning";
import ReviewCardMode from "@/components/ReviewCardMode";
import { SentenceSelectionModal } from "@/components/SentenceSelectionModal";
import { PracticeSessionModal } from "@/components/PracticeSessionModal";
import { SentenceList } from "@/components/SentenceList";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sentence } from "@/lib/types";
import { useTranslation } from "@/i18n";

interface PracticeStats {
  totalSentences: number;
  practicedSentences: number;
  averageScore: number;
  streakDays: number;
  weakSentences: any[];
  recentActivity: any[];
  accuracyTrend: number[];
  practicesByDay: { [key: string]: number };
  weeklyProgress: number;
  weeklyGoal: number;
  learningTrendDirection: 'up' | 'down' | 'stable';
  trendPercentage: number;
  reviewNeeded: number;
}

interface DailyRecommendation {
  id: number;
  source: string;
  reason: 'low_score' | 'not_practiced' | 'long_gap';
  lastScore?: number;
  daysSinceLastPractice?: number;
  priority: number;
}

interface DailyRecommendationsResponse {
  recommendations: DailyRecommendation[];
}

interface SentenceCardData extends Sentence {
  document?: {
    title: string;
  };
  isRecommended?: boolean;
  scoreHistory?: number | null;
  isCompleted?: boolean;
  lastPracticeScore?: number;
}

export default function PracticeHub() {
  const { t } = useTranslation();
  const [selectedSentenceForPractice, setSelectedSentenceForPractice] = useState<Sentence | null>(null);
  const [showPracticeSelector, setShowPracticeSelector] = useState(false);
  const [showWordLearning, setShowWordLearning] = useState(false);
  const [showReviewCardMode, setShowReviewCardMode] = useState(false);
  const [showPracticeSession, setShowPracticeSession] = useState(false);
  const [selectedSessionSentences, setSelectedSessionSentences] = useState<SentenceCardData[]>([]);
  const [selectedSentences, setSelectedSentences] = useState<Set<number>>(new Set());
  const [showSentenceList, setShowSentenceList] = useState(false);

  // Get all sentences for practice
  const { data: allSentences } = useQuery<Sentence[]>({
    queryKey: ["/api/sentences/my"],
  });

  // Check for direct practice mode from My Sentences
  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const sentenceId = urlParams.get('sentence');
    const isDirect = urlParams.get('direct') === 'true';
    
    if (sentenceId && allSentences) {
      const sentence = allSentences.find(s => s.id === parseInt(sentenceId));
      if (sentence) {
        setSelectedSentenceForPractice(sentence);
        // Clean up URL
        window.history.replaceState({}, '', '/practice-hub');
      }
    } else if (isDirect) {
      const storedSentence = localStorage.getItem('practice-sentence');
      if (storedSentence) {
        try {
          const sentence = JSON.parse(storedSentence);
          setSelectedSentenceForPractice(sentence);
          // Clean up URL
          window.history.replaceState({}, '', '/practice-hub');
        } catch (error) {
          console.error('Failed to parse stored sentence:', error);
        }
      }
    }
  }, [allSentences]);

  // Get practice statistics
  const { data: stats, isLoading } = useQuery<PracticeStats>({
    queryKey: ["/api/practice/stats"],
  });

  // Get user's sentences for practice recommendations
  const { data: sentences } = useQuery({
    queryKey: ["/api/sentences/my"],
  });

  // Get daily review recommendations
  const { data: dailyRecommendations } = useQuery<DailyRecommendationsResponse>({
    queryKey: ["/api/recommendations/daily-review", { limit: 3 }],
  });

  // Get quick practice sentences
  const { data: quickSentences } = useQuery({
    queryKey: ["/api/practice/quick-sentences", { count: 3 }],
    enabled: false, // Only fetch when needed
  });

  // Enhanced sentences with additional metadata for card display
  const enhancedSentences = React.useMemo(() => {
    if (!Array.isArray(sentences)) return [];
    
    return sentences.map((sentence: any) => ({
      ...sentence,
      // Add metadata for card display
      isRecommended: dailyRecommendations?.recommendations?.some(rec => rec.id === sentence.id) || false,
      lastPracticeScore: sentence.practiceHistory ? 
        (() => {
          try {
            const history = JSON.parse(sentence.practiceHistory);
            return Array.isArray(history) && history.length > 0 ? history[history.length - 1].score : null;
          } catch {
            return null;
          }
        })() : null,
      isCompleted: sentence.status === "completed" || sentence.status === "mastered"
    }));
  }, [sentences, dailyRecommendations]);

  const getScoreColor = (score: number) => {
    if (score >= 9) return "text-brand bg-brand-subtle";
    if (score >= 7) return "text-brand bg-brand-subtle";
    if (score >= 5) return "text-brand bg-brand-subtle";
    return "text-brand bg-brand-subtle";
  };

  const getAccuracyColor = (accuracy: number) => {
    if (accuracy >= 80) return "bg-brand";
    if (accuracy >= 60) return "bg-brand";
    if (accuracy >= 40) return "bg-brand";
    return "bg-brand";
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="mx-auto w-full max-w-[var(--page-max-width)] px-4 py-6">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <span className="ml-2">학습 데이터를 불러오는 중...</span>
          </div>
        </div>
      </Layout>
    );
  }

  const practiceAccuracy = stats ? (stats.practicedSentences > 0 ? Math.round(stats.averageScore * 10) : 0) : 0;
  const completionRate = stats ? Math.round((stats.practicedSentences / stats.totalSentences) * 100) : 0;
  const weeklyProgress = stats?.weeklyProgress || stats?.recentActivity?.length || 0;
  const weeklyGoal = stats?.weeklyGoal || 7;
  const reviewNeeded = stats?.reviewNeeded || stats?.weakSentences?.length || 0;
  const learningTrend = stats?.learningTrendDirection || 'stable';
  const trendPercentage = stats?.trendPercentage || 0;

  const getTrendIcon = (direction: string) => {
    switch (direction) {
      case 'up': return <ArrowUp className="h-4 w-4 text-brand" />;
      case 'down': return <ArrowDown className="h-4 w-4 text-brand" />;
      default: return <Minus className="h-4 w-4 text-gray-600" />;
    }
  };

  const getTrendColor = (direction: string) => {
    switch (direction) {
      case 'up': return "text-brand";
      case 'down': return "text-brand";
      default: return "text-gray-600";
    }
  };

  return (
    <Layout>
      <PageShell maxWidth="standard">
        <HeaderBar
          title={t('practiceHub.title')}
          subtitle={t('practiceHub.subtitle')}
        />
        <PageBody>

        {/* 1단: 학습 현황 요약 영역 (상단 고정) */}
        <div className="mb-8 space-y-6">
          <div className="bg-gradient-to-r from-brand-subtle to-brand-subtle rounded-xl p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4 flex items-center gap-2">
              <BarChart3 className="h-6 w-6 text-brand" />
              학습 현황 요약
            </h2>
            
            {/* 핵심 지표 카드들 */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
              <Card className="text-center">
                <CardContent className="p-4">
                  <div className="flex flex-col items-center gap-2">
                    <BookOpen className="h-6 w-6 text-brand" />
                    <p className="text-xs text-muted-foreground">총 학습 문장</p>
                    <p className="text-xl font-bold">{stats?.totalSentences || 0}</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="text-center">
                <CardContent className="p-4">
                  <div className="flex flex-col items-center gap-2">
                    <Target className="h-6 w-6 text-brand" />
                    <p className="text-xs text-muted-foreground">연습 완료</p>
                    <p className="text-xl font-bold">{stats?.practicedSentences || 0}</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="text-center">
                <CardContent className="p-4">
                  <div className="flex flex-col items-center gap-2">
                    <Award className="h-6 w-6 text-brand" />
                    <p className="text-xs text-muted-foreground">정확도 평균</p>
                    <p className="text-xl font-bold">{practiceAccuracy}%</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="text-center">
                <CardContent className="p-4">
                  <div className="flex flex-col items-center gap-2">
                    <RotateCcw className="h-6 w-6 text-brand" />
                    <p className="text-xs text-muted-foreground">복습 필요</p>
                    <p className="text-xl font-bold">{reviewNeeded}</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="text-center">
                <CardContent className="p-4">
                  <div className="flex flex-col items-center gap-2">
                    <Flame className="h-6 w-6 text-brand" />
                    <p className="text-xs text-muted-foreground">연속 학습</p>
                    <p className="text-xl font-bold">{stats?.streakDays || 0}일</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="text-center">
                <CardContent className="p-4">
                  <div className="flex flex-col items-center gap-2">
                    <Calendar className="h-6 w-6 text-brand" />
                    <p className="text-xs text-muted-foreground">주간 진도</p>
                    <p className="text-xl font-bold">{weeklyProgress}/{weeklyGoal}</p>
                  </div>
                </CardContent>
              </Card>
              
              <Card className="text-center">
                <CardContent className="p-4">
                  <div className="flex flex-col items-center gap-2">
                    {getTrendIcon(learningTrend)}
                    <p className="text-xs text-muted-foreground">학습 트렌드</p>
                    <p className={`text-xl font-bold ${getTrendColor(learningTrend)}`}>
                      {trendPercentage > 0 && learningTrend !== 'stable' ? 
                        `${trendPercentage}%` : 
                        learningTrend === 'stable' ? '유지' : '0%'
                      }
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 진도 바 시각화 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>전체 완료율</span>
                  <span>{completionRate}%</span>
                </div>
                <Progress value={completionRate} className="h-3" />
              </div>
              
              <div>
                <div className="flex justify-between text-sm mb-2">
                  <span>주간 목표 달성률</span>
                  <span>{Math.round((weeklyProgress / weeklyGoal) * 100)}%</span>
                </div>
                <Progress value={Math.min((weeklyProgress / weeklyGoal) * 100, 100)} className="h-3" />
                <p className="text-xs text-muted-foreground mt-1">
                  목표까지 {Math.max(weeklyGoal - weeklyProgress, 0)}개 더 연습
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 2단: 학습 흐름에 따른 연습 카드 */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-6">
            <Play className="h-6 w-6 text-brand" />
            <h2 className="text-xl font-bold text-gray-900">학습 흐름별 연습</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* 1. 오늘의 추천 복습 */}
            <Card className="border-l-4 border-l-brand hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="text-center space-y-4">
                  <div className="flex justify-center">
                    <div className="p-3 bg-brand-subtle rounded-lg">
                      <RotateCcw className="h-8 w-8 text-brand" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">🔁 오늘의 추천 복습</h3>
                    <p className="text-sm text-gray-600">개인화된 추천 알고리즘 기반으로 선별된 문장들</p>
                  </div>
                  <Button 
                    className="w-full bg-brand hover:bg-brand-hover"
                    disabled={!dailyRecommendations?.recommendations || dailyRecommendations.recommendations.length === 0}
                    onClick={() => {
                      if (dailyRecommendations?.recommendations && dailyRecommendations.recommendations.length > 0) {
                        setShowReviewCardMode(true);
                      }
                    }}
                  >
                    {dailyRecommendations?.recommendations && dailyRecommendations.recommendations.length > 0 ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2" />
                        복습 시작하기
                      </>
                    ) : (
                      <>
                        <CheckCircle className="h-4 w-4 mr-2" />
                        완료됨
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 2. 문장 번역 연습 */}
            <Card className="border-l-4 border-l-brand hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="text-center space-y-4">
                  <div className="flex justify-center">
                    <div className="p-3 bg-brand-subtle rounded-lg">
                      <BookOpen className="h-8 w-8 text-brand" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">💬 문장 번역 연습</h3>
                    <p className="text-sm text-gray-600">GPT 피드백 기반의 정확한 문장 번역 훈련</p>
                  </div>
                  <Button 
                    className="w-full bg-brand hover:bg-brand-hover"
                    onClick={() => setShowPracticeSelector(true)}
                    disabled={!Array.isArray(sentences) || sentences.length === 0}
                  >
                    <Play className="h-4 w-4 mr-2" />
                    번역 연습 시작하기
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* 3. 단어 학습 */}
            <Card className="border-l-4 border-l-brand hover:shadow-lg transition-shadow">
              <CardContent className="p-6">
                <div className="text-center space-y-4">
                  <div className="flex justify-center">
                    <div className="p-3 bg-brand-subtle rounded-lg">
                      <Brain className="h-8 w-8 text-brand" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">🧠 단어 학습</h3>
                    <p className="text-sm text-gray-600">플래시카드와 퀴즈를 통한 단어 마스터</p>
                  </div>
                  <Button 
                    className="w-full bg-brand hover:bg-brand-hover"
                    onClick={() => setShowWordLearning(true)}
                  >
                    <Brain className="h-4 w-4 mr-2" />
                    단어 학습 시작
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        

        {/* Practice Dialog */}
        <Dialog open={!!selectedSentenceForPractice} onOpenChange={() => setSelectedSentenceForPractice(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>문장 번역 연습</DialogTitle>
              <DialogDescription>
                아래 문장을 번역하고 AI 피드백을 받아보세요.
              </DialogDescription>
            </DialogHeader>
            {selectedSentenceForPractice && (
              <TranslationPractice
                sentence={selectedSentenceForPractice}
                onClose={() => setSelectedSentenceForPractice(null)}
              />
            )}
          </DialogContent>
        </Dialog>

        {/* New Sentence Selection Modal */}
        <SentenceSelectionModal
          open={showPracticeSelector}
          onOpenChange={setShowPracticeSelector}
          sentences={enhancedSentences}
          onSentenceSelect={setSelectedSentenceForPractice}
          onSessionStart={(sentences) => {
            setSelectedSessionSentences(sentences);
            setShowPracticeSession(true);
          }}
        />

        {/* Review Card Mode modal */}
        {showReviewCardMode && dailyRecommendations?.recommendations && (
          <Dialog open={showReviewCardMode} onOpenChange={() => setShowReviewCardMode(false)}>
            <DialogContent className="max-w-6xl max-h-[95vh] overflow-y-auto p-0">
              <DialogHeader className="sr-only">
                <DialogTitle>카드형 복습 모드</DialogTitle>
                <DialogDescription>
                  개인화된 추천 알고리즘 기반 카드형 복습 인터페이스
                </DialogDescription>
              </DialogHeader>
              <ReviewCardMode 
                recommendations={dailyRecommendations.recommendations}
                onClose={() => setShowReviewCardMode(false)}
              />
            </DialogContent>
          </Dialog>
        )}

        {/* Word Learning modal */}
        {showWordLearning && (
          <Dialog open={showWordLearning} onOpenChange={() => setShowWordLearning(false)}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>단어 학습</DialogTitle>
                <DialogDescription>
                  플래시카드와 퀴즈로 단어를 학습하세요.
                </DialogDescription>
              </DialogHeader>
              <WordLearning />
            </DialogContent>
          </Dialog>
        )}

        {/* Sentence List Modal */}
        {showSentenceList && (
          <Dialog open={showSentenceList} onOpenChange={setShowSentenceList}>
            <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>문장 선택 및 연습</DialogTitle>
                <DialogDescription>
                  문장을 선택해서 개별 또는 세션 연습을 시작하세요.
                </DialogDescription>
              </DialogHeader>
              
              {allSentences && (
                <SentenceList
                  sentences={allSentences.map((sentence: Sentence) => ({
                    ...sentence,
                    document: { title: "기본 문서" }
                  }))}
                  selectedSentences={selectedSentences}
                  onSelectionChange={setSelectedSentences}
                  onStartPractice={(sentences) => {
                    setSelectedSessionSentences(sentences as SentenceCardData[]);
                    setShowSentenceList(false);
                    setShowPracticeSession(true);
                  }}
                />
              )}
            </DialogContent>
          </Dialog>
        )}

        {/* Practice Session Modal */}
        <PracticeSessionModal
          open={showPracticeSession}
          onOpenChange={setShowPracticeSession}
          sentences={selectedSessionSentences}
          onSessionComplete={(stats) => {
            console.log("Session completed with stats:", stats);
            // Invalidate queries to refresh data
            queryClient.invalidateQueries({ queryKey: ["/api/practice/stats"] });
            queryClient.invalidateQueries({ queryKey: ["/api/sentences/my"] });
            setSelectedSentences(new Set()); // Reset selection
          }}
        />
        </PageBody>
      </PageShell>
    </Layout>
  );
}