import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RotateCcw, ThumbsDown, Minus, ThumbsUp, MessageSquare, Eye, EyeOff } from "lucide-react";

interface FlashCardProps {
  term: string;
  definition?: string | null;
  translation?: string | null;
  contextSentence?: string | null;
  masteryLevel: number;
  onRate: (rating: "again" | "hard" | "good") => void;
  isLoading?: boolean;
}

export function FlashCard({
  term,
  definition,
  translation,
  contextSentence,
  masteryLevel,
  onRate,
  isLoading = false,
}: FlashCardProps) {
  const [isFlipped, setIsFlipped] = useState(false);
  const [showContext, setShowContext] = useState(false);

  const handleFlip = useCallback(() => {
    if (!isFlipped) {
      setIsFlipped(true);
    }
  }, [isFlipped]);

  const handleRate = useCallback((rating: "again" | "hard" | "good") => {
    onRate(rating);
    setIsFlipped(false);
    setShowContext(false);
  }, [onRate]);

  const getMasteryColor = (level: number) => {
    if (level >= 4) return "text-green-600 bg-green-100";
    if (level >= 2) return "text-amber-600 bg-amber-100";
    return "text-gray-600 bg-gray-100";
  };

  return (
    <div className="perspective-1000 w-full max-w-xl mx-auto">
      <motion.div
        className="relative w-full"
        style={{ transformStyle: "preserve-3d" }}
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ duration: 0.6, ease: "easeInOut" }}
      >
        {/* Front of card */}
        <div
          className={`w-full ${isFlipped ? "pointer-events-none" : ""}`}
          style={{ backfaceVisibility: "hidden" }}
        >
          <Card
            className="min-h-[320px] cursor-pointer bg-white dark:bg-gray-900 border-2 hover:border-[#2F5D50] transition-colors shadow-lg"
            style={{ borderRadius: "1.5rem" }}
            onClick={handleFlip}
            data-testid="flashcard-front"
          >
            <CardContent className="flex flex-col items-center justify-center h-full p-8 min-h-[320px]">
              <Badge className={`mb-4 ${getMasteryColor(masteryLevel)}`}>
                숙달도 {masteryLevel}/5
              </Badge>
              <p className="text-3xl font-bold text-center text-[#2F5D50] dark:text-green-400 leading-relaxed">
                {term}
              </p>
              <p className="text-sm text-muted-foreground mt-8">
                탭하여 뒤집기
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Back of card */}
        <div
          className={`absolute top-0 left-0 w-full ${!isFlipped ? "pointer-events-none" : ""}`}
          style={{ 
            backfaceVisibility: "hidden",
            transform: "rotateY(180deg)"
          }}
        >
          <Card
            className="min-h-[320px] bg-[#2F5D50] text-white shadow-lg"
            style={{ borderRadius: "1.5rem" }}
            data-testid="flashcard-back"
          >
            <CardContent className="flex flex-col h-full p-6 min-h-[320px]">
              <div className="flex-1 flex flex-col items-center justify-center space-y-4">
                {translation && (
                  <div className="text-center">
                    <p className="text-sm text-green-200 mb-1">번역</p>
                    <p className="text-2xl font-semibold">{translation}</p>
                  </div>
                )}
                {definition && (
                  <div className="text-center mt-4">
                    <p className="text-sm text-green-200 mb-1">정의</p>
                    <p className="text-lg opacity-90">{definition}</p>
                  </div>
                )}
              </div>

              {/* Context Card - Slide up panel */}
              <AnimatePresence>
                {showContext && contextSentence && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3 }}
                    className="overflow-hidden"
                  >
                    <div className="bg-white/10 rounded-xl p-4 mt-4 backdrop-blur-sm">
                      <p className="text-sm text-green-200 mb-1 flex items-center gap-1">
                        <MessageSquare className="h-3 w-3" />
                        문맥
                      </p>
                      <p className="text-sm italic opacity-90">{contextSentence}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Context toggle button */}
              {contextSentence && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-center mt-2 text-green-200 hover:text-white hover:bg-white/10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowContext(!showContext);
                  }}
                >
                  {showContext ? (
                    <><EyeOff className="h-4 w-4 mr-1" /> 문맥 숨기기</>
                  ) : (
                    <><Eye className="h-4 w-4 mr-1" /> 문맥 보기</>
                  )}
                </Button>
              )}

              {/* Self-rating buttons */}
              <div className="flex gap-2 mt-6 pt-4 border-t border-white/20">
                <Button
                  variant="outline"
                  className="flex-1 bg-red-500/20 border-red-400/50 text-white hover:bg-red-500/40"
                  onClick={() => handleRate("again")}
                  disabled={isLoading}
                  data-testid="button-rate-again"
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Again
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 bg-amber-500/20 border-amber-400/50 text-white hover:bg-amber-500/40"
                  onClick={() => handleRate("hard")}
                  disabled={isLoading}
                  data-testid="button-rate-hard"
                >
                  <Minus className="h-4 w-4 mr-1" />
                  Hard
                </Button>
                <Button
                  variant="outline"
                  className="flex-1 bg-green-400/20 border-green-300/50 text-white hover:bg-green-400/40"
                  onClick={() => handleRate("good")}
                  disabled={isLoading}
                  data-testid="button-rate-good"
                >
                  <ThumbsUp className="h-4 w-4 mr-1" />
                  Good
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </motion.div>
    </div>
  );
}
