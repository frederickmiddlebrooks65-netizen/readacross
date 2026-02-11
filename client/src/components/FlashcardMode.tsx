import React, { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  ChevronLeft, 
  ChevronRight, 
  RotateCcw, 
  CheckCircle, 
  XCircle,
  VolumeX,
  Volume2,
  ArrowRight
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { type Glossary } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

interface FlashcardModeProps {
  words: Glossary[];
}

type CardSide = 'front' | 'meaning' | 'example';

export default function FlashcardMode({ words }: FlashcardModeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [currentSide, setCurrentSide] = useState<CardSide>('front');
  const [isFlipping, setIsFlipping] = useState(false);
  const [studiedWords, setStudiedWords] = useState<Set<number>>(new Set());
  const [correctWords, setCorrectWords] = useState<Set<number>>(new Set());
  const [sessionStartTime, setSessionStartTime] = useState<number>(Date.now());
  const [cardStartTime, setCardStartTime] = useState<number>(Date.now());
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const currentWord = words[currentIndex];
  const progress = words.length > 0 ? (studiedWords.size / words.length) * 100 : 0;

  useEffect(() => {
    setCardStartTime(Date.now());
  }, [currentIndex]);

  // Early return if currentWord is not available
  if (!currentWord) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="text-gray-500">
            단어 데이터를 불러오는 중...
          </div>
        </CardContent>
      </Card>
    );
  }

  const recordPracticeMutation = useMutation({
    mutationFn: async (data: {
      wordId: number;
      isCorrect: boolean;
      timeSpent: number;
    }) => {
      return apiRequest("/api/glossary/practice", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wordId: data.wordId,
          sessionType: 'flashcard',
          isCorrect: data.isCorrect,
          timeSpent: data.timeSpent,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/glossary/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/glossary/practice-words"] });
    },
  });

  const handleCardFlip = () => {
    if (isFlipping) return;
    
    setIsFlipping(true);
    setTimeout(() => {
      if (currentSide === 'front') {
        setCurrentSide('meaning');
      } else if (currentSide === 'meaning') {
        setCurrentSide('example');
      } else {
        setCurrentSide('front');
      }
      setIsFlipping(false);
    }, 150);
  };

  const handleAnswer = (isCorrect: boolean) => {
    if (!currentWord) return;

    const timeSpent = Math.floor((Date.now() - cardStartTime) / 1000);
    
    recordPracticeMutation.mutate({
      wordId: currentWord.id,
      isCorrect,
      timeSpent,
    });

    setStudiedWords(prev => new Set([...Array.from(prev), currentWord.id]));
    if (isCorrect) {
      setCorrectWords(prev => new Set([...Array.from(prev), currentWord.id]));
    }

    // 다음 카드로 이동 또는 세션 완료
    if (currentIndex < words.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setCurrentSide('front');
    } else {
      // 세션 완료 메시지
      const totalTime = Math.floor((Date.now() - sessionStartTime) / 1000);
      const accuracy = studiedWords.size > 0 ? Math.round((correctWords.size / studiedWords.size) * 100) : 0;
      
      toast({
        title: "플래시카드 세션 완료!",
        description: `${studiedWords.size}개 단어 학습, 정확도 ${accuracy}%, 소요시간 ${totalTime}초`,
      });
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1);
      setCurrentSide('front');
    }
  };

  const handleNext = () => {
    if (currentIndex < words.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setCurrentSide('front');
    }
  };

  const resetSession = () => {
    setCurrentIndex(0);
    setCurrentSide('front');
    setStudiedWords(new Set());
    setCorrectWords(new Set());
    setSessionStartTime(Date.now());
    setCardStartTime(Date.now());
  };

  if (!words || words.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="text-gray-500">
            학습할 단어가 없습니다. 먼저 용어집에 단어를 추가해주세요.
          </div>
        </CardContent>
      </Card>
    );
  }

  if (studiedWords.size === words.length) {
    const accuracy = studiedWords.size > 0 ? Math.round((correctWords.size / studiedWords.size) * 100) : 0;
    const totalTime = Math.floor((Date.now() - sessionStartTime) / 1000);
    
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-6">
          <div className="text-4xl">🎉</div>
          <div>
            <h3 className="text-xl font-bold mb-2">플래시카드 세션 완료!</h3>
            <div className="space-y-2 text-gray-600">
              <p>학습한 단어: {studiedWords.size}개</p>
              <p>정확도: {accuracy}%</p>
              <p>소요시간: {Math.floor(totalTime / 60)}분 {totalTime % 60}초</p>
            </div>
          </div>
          <Button onClick={resetSession} className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            다시 학습하기
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* 진행도 표시 */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>진행도: {currentIndex + 1} / {words.length}</span>
          <span>{Math.round(progress)}% 완료</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* 플래시카드 */}
      <div className="flex justify-center">
        <div 
          className={`relative w-full max-w-md h-80 cursor-pointer transition-transform duration-150 ${
            isFlipping ? 'scale-95' : 'scale-100'
          }`}
          onClick={handleCardFlip}
        >
          <Card className="w-full h-full shadow-lg hover:shadow-xl transition-shadow">
            <CardContent className="p-8 h-full flex flex-col justify-center items-center text-center space-y-4">
              <div className="flex items-center justify-between w-full mb-4">
                <Badge variant="outline">
                  {currentSide === 'front' ? '단어' : 
                   currentSide === 'meaning' ? '의미' : '예문'}
                </Badge>
                <Badge variant="secondary">
                  {currentWord.difficulty}
                </Badge>
              </div>

              <div className="flex-1 flex items-center justify-center">
                {currentSide === 'front' && (
                  <div className="space-y-4">
                    <h2 className="text-3xl font-bold text-gray-900">
                      {currentWord.term}
                    </h2>
                    {currentWord.pronunciation && (
                      <p className="text-gray-600 text-lg">
                        [{currentWord.pronunciation}]
                      </p>
                    )}
                    <div className="text-sm text-gray-500 mt-6 flex items-center gap-2">
                      <ArrowRight className="h-4 w-4" />
                      카드를 클릭해서 의미 보기
                    </div>
                  </div>
                )}

                {currentSide === 'meaning' && (
                  <div className="space-y-4">
                    <h3 className="text-xl font-semibold text-gray-700 mb-2">
                      {currentWord.term}
                    </h3>
                    <p className="text-lg text-gray-900">
                      {currentWord.translation || currentWord.definition}
                    </p>
                    <div className="text-sm text-gray-500 mt-6 flex items-center gap-2">
                      <ArrowRight className="h-4 w-4" />
                      클릭해서 예문 보기
                    </div>
                  </div>
                )}

                {currentSide === 'example' && (
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-gray-700 mb-2">
                      {currentWord.term}
                    </h3>
                    {currentWord.contextSentence ? (
                      <p className="text-base text-gray-800 italic">
                        "{currentWord.contextSentence}"
                      </p>
                    ) : (
                      <p className="text-base text-gray-500">
                        예문이 없습니다
                      </p>
                    )}
                    <div className="text-sm text-gray-500 mt-6">
                      이 단어를 얼마나 잘 알고 있나요?
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 컨트롤 버튼 */}
      <div className="flex justify-center space-x-4">
        <Button
          variant="outline"
          onClick={handlePrevious}
          disabled={currentIndex === 0}
          className="flex items-center gap-2 text-brand border-brand hover:bg-brand-subtle"
        >
          <ChevronLeft className="h-4 w-4" />
          이전
        </Button>

        {currentSide === 'example' && (
          <>
            <Button
              variant="outline"
              onClick={() => handleAnswer(false)}
              className="flex items-center gap-2 text-brand border-brand hover:bg-brand-subtle"
            >
              <XCircle className="h-4 w-4" />
              모름
            </Button>
            <Button
              onClick={() => handleAnswer(true)}
              className="flex items-center gap-2 bg-brand hover:bg-brand-hover"
            >
              <CheckCircle className="h-4 w-4" />
              알았음
            </Button>
          </>
        )}

        <Button
          variant="outline"
          onClick={handleNext}
          disabled={currentIndex === words.length - 1}
          className="flex items-center gap-2 text-brand border-brand hover:bg-brand-subtle"
        >
          다음
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* 키보드 단축키 안내 */}
      <div className="text-center text-sm text-gray-500">
        키보드: 스페이스(카드 뒤집기) • 왼쪽/오른쪽 화살표(이동)
      </div>
    </div>
  );
}