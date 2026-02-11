import React, { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { 
  CheckCircle, 
  XCircle, 
  RotateCcw, 
  ArrowRight,
  Timer,
  Trophy,
  Target
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { type Glossary } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";

interface QuizModeProps {
  words: Glossary[];
}

interface QuizQuestion {
  id: number;
  word: string;
  correctAnswer: string;
  options: string[];
  questionType: 'meaning' | 'translation';
}

interface QuizResult {
  questionId: number;
  wordId: number;
  selectedAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  timeSpent: number;
}

export default function QuizMode({ words }: QuizModeProps) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState<string>("");
  const [showResult, setShowResult] = useState(false);
  const [quizResults, setQuizResults] = useState<QuizResult[]>([]);
  const [sessionStartTime, setSessionStartTime] = useState<number>(Date.now());
  const [questionStartTime, setQuestionStartTime] = useState<number>(Date.now());
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [isGeneratingQuestions, setIsGeneratingQuestions] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // 퀴즈 문제 생성
  const generateQuestions = async () => {
    if (words.length === 0) return;
    
    setIsGeneratingQuestions(true);
    // 상태 초기화
    setCurrentQuestionIndex(0);
    setSelectedAnswer("");
    setShowResult(false);
    setQuizResults([]);
    setSessionStartTime(Date.now());
    setQuestionStartTime(Date.now());
    
    try {
      const response = await apiRequest("/api/glossary/generate-quiz", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          wordIds: words.slice(0, 10).map(w => w.id) // 최대 10개 문제
        }),
      });
      setQuizQuestions(response.questions);
    } catch (error) {
      toast({
        title: "퀴즈 생성 실패",
        description: "문제를 생성하는 중 오류가 발생했습니다.",
        variant: "destructive"
      });
    } finally {
      setIsGeneratingQuestions(false);
    }
  };

  useEffect(() => {
    if (words.length > 0 && quizQuestions.length === 0) {
      generateQuestions();
    }
  }, [words]);

  useEffect(() => {
    setQuestionStartTime(Date.now());
  }, [currentQuestionIndex]);

  const recordPracticeMutation = useMutation({
    mutationFn: async (data: {
      wordId: number;
      isCorrect: boolean;
      timeSpent: number;
      selectedAnswer: string;
      correctAnswer: string;
    }) => {
      return apiRequest("/api/glossary/practice", {
        method: "POST",
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          wordId: data.wordId,
          sessionType: 'quiz',
          isCorrect: data.isCorrect,
          timeSpent: data.timeSpent,
          questionType: 'meaning',
          selectedAnswer: data.selectedAnswer,
          correctAnswer: data.correctAnswer,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/glossary/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/glossary/practice-words"] });
    },
  });

  const handleAnswerSelect = (answer: string) => {
    if (showResult) return;
    setSelectedAnswer(answer);
  };

  const handleSubmitAnswer = () => {
    if (!selectedAnswer || showResult) return;

    const currentQuestion = quizQuestions[currentQuestionIndex];
    const timeSpent = Math.floor((Date.now() - questionStartTime) / 1000);
    const isCorrect = selectedAnswer === currentQuestion.correctAnswer;

    const result: QuizResult = {
      questionId: currentQuestion.id,
      wordId: currentQuestion.id, // questionId와 wordId 매핑 필요
      selectedAnswer,
      correctAnswer: currentQuestion.correctAnswer,
      isCorrect,
      timeSpent,
    };

    setQuizResults(prev => [...prev, result]);
    setShowResult(true);

    // 백엔드에 결과 저장
    recordPracticeMutation.mutate({
      wordId: currentQuestion.id,
      isCorrect,
      timeSpent,
      selectedAnswer,
      correctAnswer: currentQuestion.correctAnswer,
    });
  };

  const handleNextQuestion = () => {
    if (currentQuestionIndex < quizQuestions.length - 1) {
      setCurrentQuestionIndex(prev => prev + 1);
      setSelectedAnswer("");
      setShowResult(false);
      setQuestionStartTime(Date.now());
    }
  };

  const resetQuiz = () => {
    setCurrentQuestionIndex(0);
    setSelectedAnswer("");
    setShowResult(false);
    setQuizResults([]);
    setSessionStartTime(Date.now());
    setQuestionStartTime(Date.now());
    generateQuestions();
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

  if (isGeneratingQuestions) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <div className="flex items-center justify-center space-x-2">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            <span>퀴즈 문제를 생성하고 있습니다...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (quizQuestions.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-4">
          <div className="text-gray-500">
            퀴즈 문제를 생성할 수 없습니다.
          </div>
          <Button onClick={generateQuestions}>
            다시 시도
          </Button>
        </CardContent>
      </Card>
    );
  }

  // 퀴즈 완료
  if (currentQuestionIndex >= quizQuestions.length) {
    const correctAnswers = quizResults.filter(r => r.isCorrect).length;
    const accuracy = Math.round((correctAnswers / quizResults.length) * 100);
    const totalTime = Math.floor((Date.now() - sessionStartTime) / 1000);
    
    return (
      <Card>
        <CardContent className="p-8 text-center space-y-6">
          <div className="text-4xl">🎯</div>
          <div>
            <h3 className="text-xl font-bold mb-4">퀴즈 완료!</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="text-center p-4 bg-brand-paper rounded-xl">
                <div className="text-2xl font-bold text-brand-ink">{quizResults.length}</div>
                <div className="text-sm text-gray-600">총 문제 수</div>
              </div>
              <div className="text-center p-4 bg-green-50 rounded-xl">
                <div className="text-2xl font-bold text-green-600">{correctAnswers}</div>
                <div className="text-sm text-gray-600">정답 수</div>
              </div>
              <div className="text-center p-4 bg-brand-amber/10 rounded-xl">
                <div className="text-2xl font-bold text-brand-amber">{accuracy}%</div>
                <div className="text-sm text-gray-600">정확도</div>
              </div>
            </div>
            <p className="text-gray-600">
              소요시간: {Math.floor(totalTime / 60)}분 {totalTime % 60}초
            </p>
          </div>
          <Button onClick={resetQuiz} className="flex items-center gap-2">
            <RotateCcw className="h-4 w-4" />
            다시 도전하기
          </Button>
        </CardContent>
      </Card>
    );
  }

  const currentQuestion = quizQuestions[currentQuestionIndex];
  const progress = ((currentQuestionIndex + 1) / quizQuestions.length) * 100;

  return (
    <div className="space-y-6">
      {/* 진행도 표시 */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span>문제 {currentQuestionIndex + 1} / {quizQuestions.length}</span>
          <span>{Math.round(progress)}% 완료</span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>

      {/* 퀴즈 문제 카드 */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              다음 단어의 의미는?
            </span>
            <Badge variant="outline">
              {currentQuestion.questionType === 'meaning' ? '의미 선택' : '번역 선택'}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 단어 표시 */}
          <div className="text-center p-6 bg-gray-50 rounded-lg">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">
              {currentQuestion.word}
            </h2>
          </div>

          {/* 선택지 */}
          <div className="space-y-3">
            {currentQuestion.options.map((option, index) => {
              const isSelected = selectedAnswer === option;
              const isCorrect = option === currentQuestion.correctAnswer;
              const showCorrectAnswer = showResult && isCorrect;
              const showWrongAnswer = showResult && isSelected && !isCorrect;
              
              return (
                <Button
                  key={index}
                  variant={
                    showCorrectAnswer ? "default" : 
                    showWrongAnswer ? "destructive" : 
                    isSelected ? "secondary" : "outline"
                  }
                  className={`w-full p-4 h-auto text-left justify-start ${
                    showCorrectAnswer ? "bg-green-600 hover:bg-green-700" :
                    showWrongAnswer ? "bg-red-600 hover:bg-red-700" : ""
                  }`}
                  onClick={() => handleAnswerSelect(option)}
                  disabled={showResult}
                >
                  <div className="flex items-center justify-between w-full">
                    <span>{option}</span>
                    {showResult && (
                      <span>
                        {isCorrect && <CheckCircle className="h-4 w-4 text-white" />}
                        {showWrongAnswer && <XCircle className="h-4 w-4 text-white" />}
                      </span>
                    )}
                  </div>
                </Button>
              );
            })}
          </div>

          {/* 결과 표시 */}
          {showResult && (
            <div className={`p-4 rounded-lg ${
              selectedAnswer === currentQuestion.correctAnswer 
                ? "bg-green-50 border border-green-200" 
                : "bg-red-50 border border-red-200"
            }`}>
              <div className="flex items-center gap-2 mb-2">
                {selectedAnswer === currentQuestion.correctAnswer ? (
                  <>
                    <CheckCircle className="h-5 w-5 text-green-600" />
                    <span className="font-medium text-green-800">정답입니다!</span>
                  </>
                ) : (
                  <>
                    <XCircle className="h-5 w-5 text-red-600" />
                    <span className="font-medium text-red-800">틀렸습니다</span>
                  </>
                )}
              </div>
              <p className="text-sm text-gray-600">
                정답: {currentQuestion.correctAnswer}
              </p>
            </div>
          )}

          {/* 답안 제출/다음 문제 버튼 */}
          <div className="flex justify-center">
            {!showResult ? (
              <Button 
                onClick={handleSubmitAnswer}
                disabled={!selectedAnswer}
                className="flex items-center gap-2 px-8"
              >
                답안 제출
                <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <Button 
                onClick={handleNextQuestion}
                className="flex items-center gap-2 px-8"
              >
                {currentQuestionIndex < quizQuestions.length - 1 ? '다음 문제' : '결과 보기'}
                <ArrowRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}