import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  Brain, 
  Trophy, 
  RotateCcw, 
  Play,
  BookOpen,
  Target,
  Clock,
  Star,
  TrendingUp
} from "lucide-react";
import FlashcardMode from "@/components/FlashcardMode";
import QuizMode from "@/components/QuizMode";
import { Glossary } from "@/lib/types";

interface WordStats {
  totalWords: number;
  masteredWords: number;
  studyingWords: number;
  weeklyProgress: number;
  averageAccuracy: number;
}

export default function WordLearning() {
  const [selectedMode, setSelectedMode] = useState<'flashcard' | 'quiz'>('flashcard');

  // Get word statistics
  const { data: wordStats, isLoading: statsLoading } = useQuery<WordStats>({
    queryKey: ["/api/glossary/stats"],
  });

  // Get practice words
  const { data: practiceWords, isLoading: wordsLoading } = useQuery<Glossary[]>({
    queryKey: ["/api/glossary/practice-words"],
  });

  if (statsLoading || wordsLoading) {
    return (
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center justify-center h-48">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const progressPercentage = wordStats ? 
    Math.round((wordStats.masteredWords / wordStats.totalWords) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* 단어 학습 통계 카드 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-blue-600" />
            단어 학습 진도
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {wordStats?.totalWords || 0}
              </div>
              <div className="text-sm text-gray-600">전체 단어</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {wordStats?.masteredWords || 0}
              </div>
              <div className="text-sm text-gray-600">마스터 완료</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-600">
                {wordStats?.studyingWords || 0}
              </div>
              <div className="text-sm text-gray-600">학습 중</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-purple-600">
                {wordStats?.averageAccuracy || 0}%
              </div>
              <div className="text-sm text-gray-600">평균 정확도</div>
            </div>
          </div>
          
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>학습 진도</span>
              <span>{progressPercentage}%</span>
            </div>
            <Progress value={progressPercentage} className="h-2" />
          </div>
        </CardContent>
      </Card>

      {/* 단어 학습 모드 선택 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-green-600" />
            단어 학습 모드
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Tabs value={selectedMode} onValueChange={(value) => setSelectedMode(value as 'flashcard' | 'quiz')}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="flashcard" className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4" />
                복습 모드
              </TabsTrigger>
              <TabsTrigger value="quiz" className="flex items-center gap-2">
                <Trophy className="h-4 w-4" />
                테스트 모드
              </TabsTrigger>
            </TabsList>

            <TabsContent value="flashcard" className="mt-6">
              <div className="text-center space-y-4 mb-6">
                <div className="flex items-center justify-center gap-2 text-blue-600">
                  <BookOpen className="h-5 w-5" />
                  <span className="font-medium">플래시카드로 단어 복습하기</span>
                </div>
                <p className="text-gray-600">
                  단어 → 의미 → 예문 순서로 학습합니다
                </p>
              </div>
              <FlashcardMode words={practiceWords || []} />
            </TabsContent>

            <TabsContent value="quiz" className="mt-6">
              <div className="text-center space-y-4 mb-6">
                <div className="flex items-center justify-center gap-2 text-green-600">
                  <Star className="h-5 w-5" />
                  <span className="font-medium">퀴즈로 실력 확인하기</span>
                </div>
                <p className="text-gray-600">
                  객관식 문제로 단어 실력을 테스트합니다
                </p>
              </div>
              <QuizMode words={practiceWords || []} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}