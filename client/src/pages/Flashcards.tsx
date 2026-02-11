import React, { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, RotateCcw, CheckCircle, X, ThumbsUp, ThumbsDown, Eye, EyeOff } from "lucide-react";
import { Sentence } from "@/lib/types.d";

export default function Flashcards() {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [userTranslation, setUserTranslation] = useState("");
  const [isAnswered, setIsAnswered] = useState(false);
  const [sessionStats, setSessionStats] = useState({
    correct: 0,
    incorrect: 0,
    skipped: 0
  });
  const { toast } = useToast();

  // Get selected sentence IDs from localStorage
  const selectedSentenceIds = JSON.parse(localStorage.getItem('flashcard-sentences') || '[]');

  // Fetch sentences for flashcard practice
  const { data: sentences, isLoading } = useQuery<Sentence[]>({
    queryKey: ["/api/sentences/my"],
    select: (data) => data?.filter(sentence => selectedSentenceIds.includes(sentence.id)) || []
  });

  // Update sentence practice status
  const practiceUpdateMutation = useMutation({
    mutationFn: (data: { sentenceId: number, correct: boolean }) => 
      apiRequest(`/api/sentences/${data.sentenceId}/practice`, {
        method: 'POST',
        body: JSON.stringify({ 
          userTranslation,
          correct: data.correct,
          practiceType: 'flashcard'
        }),
        headers: { 'Content-Type': 'application/json' }
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/sentences/my'] });
    }
  });

  const currentSentence = sentences?.[currentIndex];
  const progress = sentences ? ((currentIndex + 1) / sentences.length) * 100 : 0;

  const handleShowTranslation = () => {
    setShowTranslation(true);
    setIsAnswered(true);
  };

  const handleAnswer = (correct: boolean) => {
    if (!currentSentence) return;

    practiceUpdateMutation.mutate({ sentenceId: currentSentence.id, correct });
    
    setSessionStats(prev => ({
      ...prev,
      [correct ? 'correct' : 'incorrect']: prev[correct ? 'correct' : 'incorrect'] + 1
    }));

    // Move to next sentence after a short delay
    setTimeout(() => {
      handleNext();
    }, 1000);
  };

  const handleSkip = () => {
    setSessionStats(prev => ({ ...prev, skipped: prev.skipped + 1 }));
    handleNext();
  };

  const handleNext = () => {
    if (!sentences || currentIndex >= sentences.length - 1) {
      // Session complete
      toast({ 
        title: "Practice Complete!", 
        description: `Correct: ${sessionStats.correct}, Incorrect: ${sessionStats.incorrect}, Skipped: ${sessionStats.skipped}` 
      });
      window.location.href = '/my-sentences';
      return;
    }

    setCurrentIndex(prev => prev + 1);
    setShowTranslation(false);
    setUserTranslation("");
    setIsAnswered(false);
  };

  const handleRestart = () => {
    setCurrentIndex(0);
    setShowTranslation(false);
    setUserTranslation("");
    setIsAnswered(false);
    setSessionStats({ correct: 0, incorrect: 0, skipped: 0 });
  };

  const handleGoBack = () => {
    localStorage.removeItem('flashcard-sentences');
    window.location.href = '/my-sentences';
  };

  if (isLoading) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-6">
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
            <p className="text-gray-600 mt-2">Loading flashcards...</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (!sentences || sentences.length === 0) {
    return (
      <Layout>
        <div className="container mx-auto px-4 py-6">
          <div className="text-center py-8">
            <p className="text-gray-600">No sentences selected for practice.</p>
            <Button onClick={handleGoBack} className="mt-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to My Sentences
            </Button>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={handleGoBack}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
            <h1 className="text-2xl font-bold">Flashcard Practice</h1>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="outline" onClick={handleRestart}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Restart
            </Button>
          </div>
        </div>

        {/* Progress */}
        <div className="mb-6">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm text-gray-600">
              {currentIndex + 1} of {sentences.length}
            </span>
            <div className="flex gap-4 text-sm">
              <span className="text-green-600">✓ {sessionStats.correct}</span>
              <span className="text-red-600">✗ {sessionStats.incorrect}</span>
              <span className="text-gray-600">⊝ {sessionStats.skipped}</span>
            </div>
          </div>
          <Progress value={progress} className="h-2" />
        </div>

        {/* Flashcard */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-center text-lg">
              Translate this sentence
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Original Sentence */}
            <div className="text-center p-6 bg-gray-50 rounded-lg">
              <p className="text-xl font-medium text-gray-900">
                {currentSentence?.source}
              </p>
              {currentSentence?.tags && (
                <div className="flex justify-center gap-2 mt-3">
                  {JSON.parse(currentSentence.tags).map((tag: string) => (
                    <Badge key={tag} variant="outline" className="text-xs">
                      #{tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* User Translation Input */}
            {!isAnswered && (
              <div className="space-y-3">
                <Textarea
                  placeholder="Type your translation here..."
                  value={userTranslation}
                  onChange={(e) => setUserTranslation(e.target.value)}
                  className="min-h-20"
                />
                <div className="flex justify-center gap-3">
                  <Button 
                    onClick={handleShowTranslation}
                    disabled={!userTranslation.trim()}
                  >
                    <Eye className="h-4 w-4 mr-2" />
                    Check Answer
                  </Button>
                  <Button variant="outline" onClick={handleSkip}>
                    Skip
                  </Button>
                </div>
              </div>
            )}

            {/* Show Translation and Feedback */}
            {showTranslation && currentSentence?.target && (
              <div className="space-y-4">
                <div className="p-4 bg-brand-paper rounded-xl border border-brand-ink/10">
                  <p className="font-medium text-brand-ink mb-2">Correct Answer:</p>
                  <p className="text-brand-ink/80">{currentSentence.target}</p>
                </div>

                {userTranslation.trim() && (
                  <div className="p-4 bg-gray-50 rounded-lg border">
                    <p className="font-medium text-gray-900 mb-2">Your Answer:</p>
                    <p className="text-gray-800">{userTranslation}</p>
                  </div>
                )}

                <div className="flex justify-center gap-3">
                  <Button 
                    onClick={() => handleAnswer(true)}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    <ThumbsUp className="h-4 w-4 mr-2" />
                    Correct
                  </Button>
                  <Button 
                    onClick={() => handleAnswer(false)}
                    variant="destructive"
                  >
                    <ThumbsDown className="h-4 w-4 mr-2" />
                    Incorrect
                  </Button>
                  <Button variant="outline" onClick={handleNext}>
                    Next →
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Practice Tips */}
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-gray-600 text-center">
              💡 Tip: Try to translate before checking the answer. Use the feedback to improve your next attempt.
            </p>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}