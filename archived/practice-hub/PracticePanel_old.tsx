import React, { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { X, Check, RotateCcw, Lightbulb, Star, TrendingUp, MessageCircle, Palette } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Sentence } from "@/lib/types.d";

interface PracticePanelProps {
  sentence: Sentence;
  onClose: () => void;
  onUpdate: (changes: Partial<Sentence>) => void;
}

interface DetailedFeedback {
  accuracy: string;
  naturalness: string;
  styleMatch: string;
  suggestions: string[];
  styleVariations: {
    academic: string;
    casual: string;
    business: string;
  };
}

export default function PracticePanel({ sentence, onClose, onUpdate }: PracticePanelProps) {
  const [userTranslation, setUserTranslation] = useState(sentence.userTranslation || "");
  const [selectedStyle, setSelectedStyle] = useState<string>("academic");
  const [showComparison, setShowComparison] = useState(false);
  const [gptTranslation, setGptTranslation] = useState(sentence.target || "");
  const [feedback, setFeedback] = useState("");
  const [detailedFeedback, setDetailedFeedback] = useState<DetailedFeedback | null>(null);
  const [activeTab, setActiveTab] = useState("practice");
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // Get GPT translation if not available
  const getTranslationMutation = useMutation({
    mutationFn: async () => {
      if (!sentence.target) {
        const response = await apiRequest("POST", `/api/sentences/${sentence.id}/translate`);
        return response.translation;
      }
      return sentence.target;
    },
    onSuccess: (translation) => {
      setGptTranslation(translation);
      setShowComparison(true);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to get translation",
        variant: "destructive",
      });
    },
  });

  // Get enhanced AI feedback for user translation
  const getFeedbackMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/sentences/${sentence.id}/feedback`, {
        userTranslation,
        style: selectedStyle,
      });
      return response;
    },
    onSuccess: (response) => {
      setFeedback(response.feedback);
      setGptTranslation(response.aiTranslation);
      setDetailedFeedback(response.detailedFeedback);
      setShowComparison(true);
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to get feedback",
        variant: "destructive",
      });
    },
  });

  // Get style variations for the sentence
  const getStyleVariationsMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/sentences/${sentence.id}/style-variations`, {
        styles: ["academic", "casual", "business"],
      });
      return response;
    },
    onSuccess: (response) => {
      setDetailedFeedback(prev => ({
        ...prev,
        styleVariations: response.variations,
      } as DetailedFeedback));
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to get style variations",
        variant: "destructive",
      });
    },
  });

  // Save practice session
  const savePracticeMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/sentences/${sentence.id}/practice`, {
        userTranslation,
        feedback,
      });
    },
    onSuccess: (updatedSentence) => {
      onUpdate(updatedSentence);
      toast({
        title: "Practice Saved",
        description: "Your translation practice has been saved",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to save practice session",
        variant: "destructive",
      });
    },
  });

  const handleSubmitTranslation = () => {
    if (!userTranslation.trim()) {
      toast({
        title: "Translation Required",
        description: "Please enter your translation before submitting",
        variant: "destructive",
      });
      return;
    }
    getFeedbackMutation.mutate();
  };

  const handleSavePractice = () => {
    savePracticeMutation.mutate();
  };

  const handleTryAgain = () => {
    setUserTranslation("");
    setShowComparison(false);
    setFeedback("");
  };

  const renderScoreIndicator = (score: number, label: string) => (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium">{label}</span>
      <Progress value={score} className="flex-1 h-2" />
      <span className="text-sm text-muted-foreground">{score}%</span>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-5xl max-h-[90vh] overflow-auto">
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="flex items-center gap-3">
            <MessageCircle className="h-5 w-5 text-blue-600" />
            <CardTitle>표현 연습 - AI 피드백</CardTitle>
            <Badge variant={sentence.status === 'mastered' ? 'default' : 'secondary'}>
              {sentence.status}
            </Badge>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {/* Original Text */}
          <div className="border rounded-lg p-4 bg-slate-50">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-sm font-medium text-slate-600">원문</span>
            </div>
            <p className="text-lg leading-relaxed">{sentence.source}</p>
          </div>

          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="practice">연습하기</TabsTrigger>
              <TabsTrigger value="styles">스타일 비교</TabsTrigger>
              <TabsTrigger value="feedback">AI 피드백</TabsTrigger>
            </TabsList>

            <TabsContent value="practice" className="space-y-4">
              {/* Style Selection */}
              <div className="flex items-center gap-4">
                <label className="text-sm font-medium">번역 스타일:</label>
                <Select value={selectedStyle} onValueChange={setSelectedStyle}>
                  <SelectTrigger className="w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="academic">학술적</SelectItem>
                    <SelectItem value="casual">일상적</SelectItem>
                    <SelectItem value="business">비즈니스</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Translation Input */}
              <div>
                <label className="text-sm font-medium mb-2 block">당신의 번역:</label>
                <Textarea
                  value={userTranslation}
                  onChange={(e) => setUserTranslation(e.target.value)}
                  placeholder="번역을 입력하세요..."
                  className="min-h-[120px]"
                  disabled={showComparison}
                />
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2">
                {!showComparison ? (
                  <Button 
                    onClick={handleSubmitTranslation}
                    disabled={!userTranslation.trim() || getFeedbackMutation.isPending}
                    className="flex-1"
                  >
                    {getFeedbackMutation.isPending ? "분석 중..." : "AI 피드백 받기"}
                    <TrendingUp className="h-4 w-4 ml-2" />
                  </Button>
                ) : (
                  <>
                    <Button 
                      variant="outline" 
                      onClick={handleTryAgain}
                      className="flex-1"
                    >
                      <RotateCcw className="h-4 w-4 mr-2" />
                      다시 시도
                    </Button>
                    <Button 
                      onClick={handleSavePractice}
                      disabled={savePracticeMutation.isPending}
                      className="flex-1"
                    >
                      {savePracticeMutation.isPending ? "저장 중..." : "연습 저장"}
                      <Check className="h-4 w-4 ml-2" />
                    </Button>
                  </>
                )}
              </div>

              {/* Quick comparison if feedback available */}
              {showComparison && gptTranslation && (
                <div className="border rounded-lg p-4 bg-blue-50">
                  <div className="flex items-center gap-2 mb-2">
                    <Star className="h-4 w-4 text-blue-600" />
                    <span className="text-sm font-medium text-blue-800">AI 권장 번역</span>
                  </div>
                  <p className="text-blue-900">{gptTranslation}</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="styles" className="space-y-4">
              <div className="text-center py-4">
                <Button 
                  onClick={() => getStyleVariationsMutation.mutate()}
                  disabled={getStyleVariationsMutation.isPending}
                  variant="outline"
                >
                  {getStyleVariationsMutation.isPending ? "생성 중..." : "스타일 변형 생성"}
                  <Palette className="h-4 w-4 ml-2" />
                </Button>
              </div>

              {detailedFeedback?.styleVariations && (
                <div className="grid gap-4">
                  {Object.entries(detailedFeedback.styleVariations).map(([style, translation]) => (
                    <div key={style} className="border rounded-lg p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <Badge variant="outline">{style === 'academic' ? '학술적' : style === 'casual' ? '일상적' : '비즈니스'}</Badge>
                      </div>
                      <p className="text-slate-800">{translation}</p>
                    </div>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="feedback" className="space-y-4">
              {detailedFeedback ? (
                <div className="space-y-4">
                  {/* Score Indicators */}
                  <div className="space-y-3">
                    {renderScoreIndicator(85, "정확성")}
                    {renderScoreIndicator(78, "자연스러움")}
                    {renderScoreIndicator(82, "스타일 일치")}
                  </div>

                  {/* General Feedback */}
                  {feedback && (
                    <div className="border rounded-lg p-4 bg-amber-50">
                      <div className="flex items-center gap-2 mb-2">
                        <Lightbulb className="h-4 w-4 text-amber-600" />
                        <span className="text-sm font-medium text-amber-800">종합 평가</span>
                      </div>
                      <p className="text-amber-900 whitespace-pre-wrap">{feedback}</p>
                    </div>
                  )}

                  {/* Suggestions */}
                  {detailedFeedback.suggestions && detailedFeedback.suggestions.length > 0 && (
                    <div className="border rounded-lg p-4 bg-green-50">
                      <div className="flex items-center gap-2 mb-2">
                        <Star className="h-4 w-4 text-green-600" />
                        <span className="text-sm font-medium text-green-800">개선 제안</span>
                      </div>
                      <ul className="text-green-900 space-y-1">
                        {detailedFeedback.suggestions.map((suggestion, index) => (
                          <li key={index} className="flex items-start gap-2">
                            <span className="text-green-600">•</span>
                            <span>{suggestion}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <MessageCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>먼저 번역을 작성하고 피드백을 받아보세요</p>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}