
import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, RotateCcw, Check, X } from "lucide-react";
import { Sentence } from "@/lib/types.d";

interface FlashcardPracticeProps {
  sentences: Sentence[];
  onComplete: (results: { correct: number; total: number }) => void;
  onClose: () => void;
}

export default function FlashcardPractice({
  sentences,
  onComplete,
  onClose,
}: FlashcardPracticeProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showTranslation, setShowTranslation] = useState(false);
  const [results, setResults] = useState<boolean[]>([]);
  const [isComplete, setIsComplete] = useState(false);

  const currentSentence = sentences[currentIndex];
  const progress = ((currentIndex + 1) / sentences.length) * 100;

  const handleAnswer = (isCorrect: boolean) => {
    const newResults = [...results];
    newResults[currentIndex] = isCorrect;
    setResults(newResults);

    if (currentIndex < sentences.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setShowTranslation(false);
    } else {
      setIsComplete(true);
      const correctCount = newResults.filter(r => r).length;
      onComplete({ correct: correctCount, total: sentences.length });
    }
  };

  const handleNext = () => {
    if (currentIndex < sentences.length - 1) {
      setCurrentIndex(currentIndex + 1);
      setShowTranslation(false);
    }
  };

  const handlePrevious = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      setShowTranslation(false);
    }
  };

  if (isComplete) {
    const correctCount = results.filter(r => r).length;
    const accuracy = Math.round((correctCount / sentences.length) * 100);

    return (
      <Card className="w-full max-w-2xl mx-auto">
        <CardHeader>
          <CardTitle className="text-center">Practice Complete!</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <div className="text-6xl font-bold text-green-500">{accuracy}%</div>
          <p className="text-lg">
            You got {correctCount} out of {sentences.length} correct
          </p>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => window.location.reload()}>
              <RotateCcw className="h-4 w-4 mr-2" />
              Practice Again
            </Button>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <Badge variant="outline">
          {currentIndex + 1} / {sentences.length}
        </Badge>
        <Button variant="ghost" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <Progress value={progress} />

      <Card>
        <CardContent className="p-8">
          <div className="space-y-6">
            <div className="text-center">
              <h3 className="text-lg font-medium mb-4">Translate this sentence:</h3>
              <p className="text-xl leading-relaxed bg-gray-50 p-4 rounded">
                {currentSentence.source}
              </p>
            </div>

            {showTranslation ? (
              <div className="text-center space-y-4">
                <div className="bg-blue-50 p-4 rounded">
                  <p className="text-lg text-blue-900">
                    {currentSentence.target || "No translation available"}
                  </p>
                </div>
                
                {currentSentence.userTranslation && (
                  <div className="bg-green-50 p-4 rounded">
                    <p className="text-sm text-green-700 mb-1">Your previous translation:</p>
                    <p className="text-lg text-green-900">
                      {currentSentence.userTranslation}
                    </p>
                  </div>
                )}

                <div className="flex gap-2 justify-center">
                  <Button onClick={() => handleAnswer(true)} className="bg-green-500 hover:bg-green-600">
                    <Check className="h-4 w-4 mr-2" />
                    I got it right
                  </Button>
                  <Button onClick={() => handleAnswer(false)} variant="destructive">
                    <X className="h-4 w-4 mr-2" />
                    I need more practice
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <Button onClick={() => setShowTranslation(true)} size="lg">
                  Show Translation
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-between">
        <Button 
          variant="outline" 
          onClick={handlePrevious}
          disabled={currentIndex === 0}
        >
          <ChevronLeft className="h-4 w-4 mr-2" />
          Previous
        </Button>
        
        <Button 
          variant="outline" 
          onClick={handleNext}
          disabled={currentIndex === sentences.length - 1}
        >
          Next
          <ChevronRight className="h-4 w-4 ml-2" />
        </Button>
      </div>
    </div>
  );
}
