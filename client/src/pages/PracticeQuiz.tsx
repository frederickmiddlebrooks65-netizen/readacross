import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation } from "wouter";
import Header from "@/components/Header";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/i18n";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Brain,
  ChevronLeft,
  ChevronRight,
  Check,
  X,
  Lightbulb,
  RotateCcw,
  Trophy,
  BookOpen,
  PenTool,
} from "lucide-react";

interface QuizItem {
  id: number;
  original: string;
  meaning: string | null;
  coachingHint: string | null;
  mode: "comprehension" | "production";
}

interface QuizData {
  items: QuizItem[];
  notebook: { id: number; title: string };
  userLanguages: { baseLanguage: string; learningLanguage: string };
}

export default function PracticeQuiz() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const { t } = useTranslation();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();

  // Get mode from URL query params
  const urlParams = new URLSearchParams(window.location.search);
  const mode = (urlParams.get("mode") as "comprehension" | "production") || "comprehension";

  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswer, setUserAnswer] = useState("");
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [feedback, setFeedback] = useState<string>("");
  const [showHint, setShowHint] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [isComplete, setIsComplete] = useState(false);

  const { data, isLoading, error } = useQuery<QuizData>({
    queryKey: ["/api/quiz/generate", id, mode],
    queryFn: async () => {
      const response = await fetch(`/api/quiz/generate?notebookId=${id}&mode=${mode}`);
      if (!response.ok) throw new Error("Failed to load quiz");
      return response.json();
    },
    enabled: isAuthenticated && !!id,
  });

  const checkAnswerMutation = useMutation({
    mutationFn: async (data: { sentenceId: number; userAnswer: string; expectedAnswer: string; mode: string }) => {
      return await apiRequest("/api/quiz/check", { method: "POST", json: data });
    },
    onSuccess: (result) => {
      setIsCorrect(result.isCorrect);
      setFeedback(result.feedback);
      setShowResult(true);
      if (result.isCorrect) {
        setCorrectCount(prev => prev + 1);
      }
    },
    onError: () => {
      toast({
        title: t("practice.error"),
        description: t("practice.checkError"),
        variant: "destructive",
      });
    },
  });

  const submitResultMutation = useMutation({
    mutationFn: async (data: { sentenceId: number; userAnswer: string; isCorrect: boolean; mode: string }) => {
      return await apiRequest("/api/quiz/submit", { method: "POST", json: data });
    },
  });

  const items = data?.items || [];
  const currentItem = items[currentIndex];
  const progress = items.length > 0 ? ((currentIndex + (showResult ? 1 : 0)) / items.length) * 100 : 0;

  const handleSubmit = () => {
    if (!currentItem || !userAnswer.trim()) return;

    if (mode === "production") {
      checkAnswerMutation.mutate({
        sentenceId: currentItem.id,
        userAnswer: userAnswer.trim(),
        expectedAnswer: currentItem.original,
        mode,
      });
    } else {
      const normalizedUserAnswer = userAnswer.trim().toLowerCase();
      const normalizedMeaning = (currentItem.meaning || "").toLowerCase();
      const correct = normalizedUserAnswer === normalizedMeaning || 
        normalizedMeaning.includes(normalizedUserAnswer) ||
        normalizedUserAnswer.includes(normalizedMeaning);
      
      setIsCorrect(correct);
      setShowResult(true);
      if (correct) {
        setCorrectCount(prev => prev + 1);
      }

      submitResultMutation.mutate({
        sentenceId: currentItem.id,
        userAnswer: userAnswer.trim(),
        isCorrect: correct,
        mode,
      });
    }
  };

  const handleNext = () => {
    if (currentIndex < items.length - 1) {
      setCurrentIndex(prev => prev + 1);
      setUserAnswer("");
      setShowResult(false);
      setIsCorrect(null);
      setFeedback("");
      setShowHint(false);
    } else {
      setIsComplete(true);
      queryClient.invalidateQueries({ queryKey: ["/api/quiz/notebooks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/quiz/stats", id] });
    }
  };

  const handleSelfGrade = (correct: boolean) => {
    setIsCorrect(correct);
    if (correct) {
      setCorrectCount(prev => prev + 1);
    }
    submitResultMutation.mutate({
      sentenceId: currentItem.id,
      userAnswer: userAnswer.trim() || "(self-graded)",
      isCorrect: correct,
      mode,
    });
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setUserAnswer("");
    setShowResult(false);
    setIsCorrect(null);
    setFeedback("");
    setShowHint(false);
    setCorrectCount(0);
    setIsComplete(false);
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <div className="container mx-auto px-4 py-16 text-center">
          <Brain className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
          <h1 className="text-2xl font-bold mb-2">{t("practice.loginRequired")}</h1>
          <Button onClick={() => setLocation("/login")}>{t("common.login")}</Button>
        </div>
      </div>
    );
  }

  if (isComplete) {
    const score = items.length > 0 ? Math.round((correctCount / items.length) * 100) : 0;
    return (
      <div className="min-h-screen bg-background">
        <Header />
        <main className="container mx-auto px-4 py-16 max-w-2xl text-center">
          <Trophy className="h-20 w-20 mx-auto text-yellow-500 mb-6" />
          <h1 className="text-3xl font-bold mb-4">{t("practice.complete")}</h1>
          <p className="text-xl text-muted-foreground mb-8">
            {t("practice.scoreMessage", { correct: correctCount, total: items.length })}
          </p>
          <div className="text-6xl font-bold mb-8 text-primary">{score}%</div>
          <div className="flex gap-4 justify-center">
            <Button variant="outline" onClick={handleRestart} data-testid="button-restart">
              <RotateCcw className="h-4 w-4 mr-2" />
              {t("practice.restart")}
            </Button>
            <Button onClick={() => setLocation("/practice")} data-testid="button-back-to-hub">
              {t("practice.backToHub")}
            </Button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-6">
          <Button variant="ghost" size="sm" onClick={() => setLocation("/practice")} className="mb-4">
            <ChevronLeft className="h-4 w-4 mr-1" />
            {t("practice.backToHub")}
          </Button>
          
          <div className="flex items-center justify-between mb-2">
            <h1 className="text-2xl font-bold">{data?.notebook?.title || t("practice.quiz")}</h1>
            <Badge variant={mode === "comprehension" ? "default" : "secondary"}>
              {mode === "comprehension" ? (
                <><BookOpen className="h-3 w-3 mr-1" />{t("practice.comprehension")}</>
              ) : (
                <><PenTool className="h-3 w-3 mr-1" />{t("practice.production")}</>
              )}
            </Badge>
          </div>
          
          <div className="flex items-center gap-4">
            <Progress value={progress} className="flex-1 h-2" />
            <span className="text-sm text-muted-foreground">
              {currentIndex + 1} / {items.length}
            </span>
          </div>
        </div>

        {isLoading ? (
          <Card className="animate-pulse">
            <CardContent className="h-64 flex items-center justify-center">
              <div className="text-muted-foreground">{t("common.loading")}</div>
            </CardContent>
          </Card>
        ) : error || items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Brain className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium mb-2">{t("practice.noItems")}</h3>
              <p className="text-muted-foreground mb-4">{t("practice.noItemsDescription")}</p>
              <Button variant="outline" onClick={() => setLocation("/practice")}>
                {t("practice.backToHub")}
              </Button>
            </CardContent>
          </Card>
        ) : currentItem && (
          <Card>
            <CardHeader>
              <CardTitle className="text-lg text-muted-foreground">
                {mode === "comprehension" 
                  ? t("practice.translateToBase")
                  : t("practice.translateToLearning")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="p-6 bg-muted/50 rounded-lg">
                <p className="text-xl leading-relaxed">
                  {mode === "comprehension" ? currentItem.original : currentItem.meaning}
                </p>
              </div>

              {!showResult ? (
                <div className="space-y-4">
                  <Input
                    value={userAnswer}
                    onChange={(e) => setUserAnswer(e.target.value)}
                    placeholder={t("practice.typeAnswer")}
                    className="text-lg py-6"
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                    disabled={checkAnswerMutation.isPending}
                    data-testid="input-answer"
                  />
                  
                  <div className="flex gap-2">
                    <Button
                      onClick={handleSubmit}
                      disabled={!userAnswer.trim() || checkAnswerMutation.isPending}
                      className="flex-1"
                      data-testid="button-submit"
                    >
                      {checkAnswerMutation.isPending ? t("common.loading") : t("practice.submit")}
                    </Button>
                    
                    {currentItem.coachingHint && (
                      <Button
                        variant="outline"
                        onClick={() => setShowHint(!showHint)}
                        data-testid="button-hint"
                      >
                        <Lightbulb className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  {showHint && currentItem.coachingHint && (
                    <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800">
                      <p className="text-sm">{currentItem.coachingHint}</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className={`p-4 rounded-lg flex items-start gap-3 ${
                    isCorrect 
                      ? "bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800"
                      : "bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800"
                  }`}>
                    {isCorrect ? (
                      <Check className="h-5 w-5 text-green-600 mt-0.5" />
                    ) : (
                      <X className="h-5 w-5 text-red-600 mt-0.5" />
                    )}
                    <div>
                      <p className="font-medium">
                        {isCorrect ? t("practice.correct") : t("practice.incorrect")}
                      </p>
                      {feedback && <p className="text-sm mt-1">{feedback}</p>}
                    </div>
                  </div>

                  <div className="p-4 bg-muted rounded-lg">
                    <p className="text-sm text-muted-foreground mb-1">{t("practice.correctAnswer")}</p>
                    <p className="text-lg">
                      {mode === "comprehension" ? currentItem.meaning : currentItem.original}
                    </p>
                  </div>

                  {currentItem.coachingHint && (
                    <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                      <div className="flex items-center gap-2 mb-2">
                        <Lightbulb className="h-4 w-4 text-blue-600" />
                        <span className="font-medium text-sm">{t("practice.hint")}</span>
                      </div>
                      <p className="text-sm">{currentItem.coachingHint}</p>
                    </div>
                  )}

                  {mode === "comprehension" && isCorrect === null && (
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        onClick={() => handleSelfGrade(false)}
                        className="flex-1"
                      >
                        <X className="h-4 w-4 mr-1" />
                        {t("practice.markIncorrect")}
                      </Button>
                      <Button
                        onClick={() => handleSelfGrade(true)}
                        className="flex-1"
                      >
                        <Check className="h-4 w-4 mr-1" />
                        {t("practice.markCorrect")}
                      </Button>
                    </div>
                  )}

                  <Button onClick={handleNext} className="w-full" data-testid="button-next">
                    {currentIndex < items.length - 1 ? (
                      <>{t("practice.next")} <ChevronRight className="h-4 w-4 ml-1" /></>
                    ) : (
                      <>{t("practice.finish")} <Trophy className="h-4 w-4 ml-1" /></>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
