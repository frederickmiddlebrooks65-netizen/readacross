import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Loader2, CheckCircle, RotateCcw, History, Lightbulb, ArrowLeftRight } from "lucide-react";
import { Sentence, TranslationAttempt } from "@/lib/types";
import { formatShortDate, formatDateTime } from "@/lib/dateUtils";
import { useTimezone } from "@/hooks/useTimezone";

interface TranslationPracticeProps {
  sentence: Sentence;
  onClose?: () => void;
  onPracticeComplete?: (score: number) => void;
}

interface EvaluationResult {
  score: number;
  grade: string;
  feedback: string;
  suggested_correction: string;
  attemptId: number;
}

interface BackTranslationResult {
  score: number;
  feedback: string;
  attemptId: number;
}

export default function TranslationPractice({ sentence, onClose, onPracticeComplete }: TranslationPracticeProps) {
  const [userTranslation, setUserTranslation] = useState("");
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [backTranslation, setBackTranslation] = useState<BackTranslationResult | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [showBackTranslation, setShowBackTranslation] = useState(false);
  const [userBackTranslation, setUserBackTranslation] = useState("");
  const { toast } = useToast();
  const { timezone, language } = useTimezone();

  // Get translation history for this sentence
  const { data: history, isLoading: historyLoading } = useQuery<TranslationAttempt[]>({
    queryKey: ["/api/sentences", sentence.id, "history"],
    enabled: showHistory,
  });

  // Evaluate translation mutation
  const evaluateMutation = useMutation({
    mutationFn: async (translation: string) => {
      return apiRequest<EvaluationResult>("/api/feedback/evaluate-translation", {
        method: "POST",
        json: {
          sentenceId: sentence.id,
          userTranslation: translation,
        }
      });
    },
    onSuccess: (result) => {
      setEvaluation(result);
      toast({
        title: "번역 평가 완료",
        description: `점수: ${result.score}/10 (${result.grade})`,
      });
      // Invalidate sentence queries to update status
      queryClient.invalidateQueries({ queryKey: ["/api/sentences/my"] });
      // Call completion callback if provided
      if (onPracticeComplete) {
        onPracticeComplete(result.score);
      }
    },
    onError: (error) => {
      toast({
        title: "평가 실패",
        description: "번역 평가 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  // Back translation mutation
  const backTranslateMutation = useMutation({
    mutationFn: async (backTranslationText: string) => {
      if (!sentence.target) {
        throw new Error("AI 번역 참고가 없습니다.");
      }
      return apiRequest<BackTranslationResult>("/api/feedback/back-translate", {
        method: "POST",
        json: {
          sentenceId: sentence.id,
          originalTranslation: sentence.target,
          userBackTranslation: backTranslationText,
        }
      });
    },
    onSuccess: (result) => {
      setBackTranslation(result);
      toast({
        title: "역번역 평가 완료",
        description: `의미 보존 점수: ${result.score}/10`,
      });
      // Invalidate sentence queries to update status
      queryClient.invalidateQueries({ queryKey: ["/api/sentences/my"] });
    },
    onError: (error: any) => {
      toast({
        title: "역번역 평가 실패",
        description: error.message || "역번역 평가 중 오류가 발생했습니다.",
        variant: "destructive",
      });
    },
  });

  const handleSubmit = () => {
    if (!userTranslation.trim()) {
      toast({
        title: "번역을 입력해주세요",
        description: "번역문을 입력한 후 평가를 받으세요.",
        variant: "destructive",
      });
      return;
    }
    evaluateMutation.mutate(userTranslation);
  };

  const handleBackTranslate = () => {
    console.log("역번역 버튼 클릭됨", { hasTarget: !!sentence.target, showBackTranslation });
    if (!sentence.target) {
      toast({
        title: "AI 번역 참고가 없습니다",
        description: "먼저 번역을 생성해주세요.",
        variant: "destructive",
      });
      return;
    }
    console.log("역번역 UI 표시 설정");
    setShowBackTranslation(true);
  };

  const handleBackTranslationSubmit = () => {
    if (!userBackTranslation.trim()) {
      toast({
        title: "역번역을 입력해주세요",
        description: "영어로 다시 번역한 문장을 입력해주세요.",
        variant: "destructive",
      });
      return;
    }
    backTranslateMutation.mutate(userBackTranslation);
  };

  const handleReset = () => {
    setUserTranslation("");
    setEvaluation(null);
    setBackTranslation(null);
    setShowBackTranslation(false);
    setUserBackTranslation("");
  };

  const getScoreColor = (score: number) => {
    if (score >= 9) return "bg-green-500";
    if (score >= 7) return "bg-blue-500";
    if (score >= 5) return "bg-yellow-500";
    return "bg-red-500";
  };

  const getGradeVariant = (grade: string) => {
    if (grade.startsWith("A")) return "default";
    if (grade.startsWith("B")) return "secondary";
    if (grade.startsWith("C")) return "outline";
    return "destructive";
  };

  return (
    <div className="space-y-6">
      {/* Original Sentence */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">원문</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-lg leading-relaxed">{sentence.source}</p>
          {sentence.target && (
            <div className="mt-4 p-3 bg-muted rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">AI 번역 참고:</p>
              <p className="text-sm">{sentence.target}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Translation Input */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">나의 번역</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Textarea
            placeholder="여기에 번역을 입력하세요..."
            value={userTranslation}
            onChange={(e) => setUserTranslation(e.target.value)}
            className="min-h-[100px]"
            disabled={evaluateMutation.isPending}
          />

          <div className="flex gap-2 flex-wrap">
            <Button
              variant="default"
              onClick={handleSubmit}
              disabled={evaluateMutation.isPending || !userTranslation.trim()}
            >
              {evaluateMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  평가 중...
                </>
              ) : (
                <>
                  <CheckCircle className="h-4 w-4 mr-2" />
                  번역 평가받기
                </>
              )}
            </Button>

            <Button
              variant="outline"
              onClick={handleBackTranslate}
              disabled={!sentence.target}
            >
              <ArrowLeftRight className="h-4 w-4 mr-2" />
              역번역 연습하기
            </Button>

            <Dialog open={showHistory} onOpenChange={setShowHistory}>
              <DialogTrigger asChild>
                <Button variant="outline">
                  <History className="h-4 w-4 mr-2" />
                  히스토리
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-2xl">
                <DialogHeader>
                  <DialogTitle>번역 히스토리</DialogTitle>
                  <DialogDescription>
                    이 문장에 대한 이전 번역 시도들을 확인할 수 있습니다.
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[400px]">
                  {historyLoading ? (
                    <div className="flex items-center justify-center p-4">
                      <Loader2 className="h-6 w-6 animate-spin" />
                    </div>
                  ) : history && history.length > 0 ? (
                    <div className="space-y-4">
                      {history.map((attempt, index) => (
                        <Card key={attempt.id}>
                          <CardContent className="pt-4">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-sm text-muted-foreground">
                                {formatShortDate(attempt.createdAt, { timezone, language })}
                              </span>
                              <div className="flex items-center gap-2">
                                <Badge variant={getGradeVariant(attempt.grade || "C")}>
                                  {attempt.grade}
                                </Badge>
                                <span className="text-sm font-medium">
                                  {attempt.score}/10
                                </span>
                              </div>
                            </div>
                            <p className="text-sm mb-2">{attempt.userTranslation}</p>
                            {attempt.feedback && (
                              <p className="text-xs text-muted-foreground">
                                {attempt.feedback}
                              </p>
                            )}
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  ) : (
                    <p className="text-center text-muted-foreground p-4">
                      아직 번역 기록이 없습니다.
                    </p>
                  )}
                </ScrollArea>
              </DialogContent>
            </Dialog>

            <Button variant="ghost" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-2" />
              다시하기
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Evaluation Results */}
      {evaluation && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lightbulb className="h-5 w-5" />
              평가 결과
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${getScoreColor(evaluation.score)}`} />
                <span className="font-semibold text-lg">{evaluation.score}/10</span>
              </div>
              <Badge variant={getGradeVariant(evaluation.grade)}>
                {evaluation.grade}
              </Badge>
            </div>

            <div className="space-y-3">
              <div>
                <h4 className="font-medium mb-2">피드백:</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {evaluation.feedback}
                </p>
              </div>

              {evaluation.suggested_correction !== userTranslation && (
                <div>
                  <h4 className="font-medium mb-2">개선 제안:</h4>
                  <div className="p-3 bg-muted rounded-lg">
                    <p className="text-sm">{evaluation.suggested_correction}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Back Translation Practice */}
      {showBackTranslation && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              역번역 연습 (능동적 학습)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3">
              <div>
                <h4 className="font-medium mb-2">AI 번역 참고 (역번역 기준):</h4>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm">{sentence.target}</p>
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-2">위의 한국어를 다시 영어로 번역해보세요:</h4>
                <Textarea
                  placeholder="AI 번역 참고를 영어로 다시 번역해보세요..."
                  value={userBackTranslation}
                  onChange={(e) => setUserBackTranslation(e.target.value)}
                  className="min-h-[100px]"
                />
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={handleBackTranslationSubmit}
                  disabled={backTranslateMutation.isPending || !userBackTranslation.trim()}
                >
                  {backTranslateMutation.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      평가 중...
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 mr-2" />
                      역번역 평가받기
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={() => setShowBackTranslation(false)}>
                  취소
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Back Translation Results */}
      {backTranslation && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ArrowLeftRight className="h-5 w-5" />
              역번역 평가 결과
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">의미 보존 점수:</span>
              <div className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded-full ${getScoreColor(backTranslation.score)}`} />
                <span className="font-semibold">{backTranslation.score}/10</span>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <h4 className="font-medium mb-2">내가 작성한 역번역:</h4>
                <div className="p-3 bg-muted rounded-lg">
                  <p className="text-sm">{userBackTranslation}</p>
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-2">원문:</h4>
                <div className="p-3 border rounded-lg">
                  <p className="text-sm">{sentence.source}</p>
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-2">의미 보존 분석:</h4>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {backTranslation.feedback}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Practice History */}
      {showHistory && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" />
              연습 히스토리
            </CardTitle>
          </CardHeader>
          <CardContent>
            {historyLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
                <span className="ml-2 text-sm text-muted-foreground">히스토리를 불러오는 중...</span>
              </div>
            ) : history && history.length > 0 ? (
              <div className="space-y-3">
                {history.map((attempt, index) => (
                  <div key={attempt.id} className="border rounded-lg p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">시도 #{history.length - index}</span>
                        <div className="flex items-center gap-1">
                          <div className={`w-2 h-2 rounded-full ${getScoreColor(attempt.score || 0)}`} />
                          <span className="text-sm">{attempt.score}/10</span>
                          <Badge variant="outline">{attempt.grade}</Badge>
                        </div>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {formatDateTime(attempt.createdAt, { timezone, language })}
                      </span>
                    </div>

                    <div className="text-sm">
                      <p className="font-medium mb-1">번역:</p>
                      <p className="text-muted-foreground">{attempt.userTranslation}</p>
                    </div>

                    {attempt.feedback && (
                      <div className="text-sm">
                        <p className="font-medium mb-1">피드백:</p>
                        <p className="text-muted-foreground">{attempt.feedback}</p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">
                아직 연습 히스토리가 없습니다.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}