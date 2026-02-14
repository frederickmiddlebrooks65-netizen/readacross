import { useState, useMemo, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { 
  Check, 
  X, 
  Edit3, 
  Save, 
  Loader2,
  ArrowRight
} from "lucide-react";
import DiffMatchPatch from "diff-match-patch";

type QuizLevel = 1 | 2 | 3;

interface SentenceEngineProps {
  source: string;
  target: string | null;
  direction: string;
  masteryLevel: number;
  quizLevel: QuizLevel;
  onAnswer: (userAnswer: string, isCorrect: boolean) => void;
  onEditTranslation?: (newTranslation: string) => void;
  aiFeedback?: { feedback: string; suggestions: string[]; isCorrect: boolean } | null;
  isCheckingAnswer?: boolean;
}

const dmp = new DiffMatchPatch();

const LANG_NAMES: Record<string, string> = {
  ko: "한국어",
  en: "English",
  ja: "日本語",
  zh: "中文",
  es: "Español",
  fr: "Français",
  de: "Deutsch",
};

function getLangName(code: string): string {
  return LANG_NAMES[code] || code.toUpperCase();
}

export function SentenceEngine({
  source,
  target,
  direction,
  masteryLevel,
  quizLevel,
  onAnswer,
  onEditTranslation,
  aiFeedback,
  isCheckingAnswer = false,
}: SentenceEngineProps) {
  const [userAnswer, setUserAnswer] = useState("");
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const [showResult, setShowResult] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editedTranslation, setEditedTranslation] = useState("");

  const [fromLang, toLang] = useMemo(() => direction.split("-"), [direction]);

  const prompt = useMemo(() => {
    return source;
  }, [source]);

  const answer = useMemo(() => {
    return target || "";
  }, [target]);

  const shuffledWords = useMemo(() => {
    if (!answer) return [];
    const words = answer.split(/\s+/).filter(w => w.length > 0);
    return [...words].sort(() => Math.random() - 0.5);
  }, [answer]);

  const partialFillBlanks = useMemo(() => {
    if (!answer) return { display: "", blanks: [] };
    const words = answer.split(/\s+/);
    const blanks: number[] = [];
    const blankCount = Math.max(1, Math.floor(words.length * 0.3));
    
    while (blanks.length < blankCount && blanks.length < words.length) {
      const idx = Math.floor(Math.random() * words.length);
      if (!blanks.includes(idx) && words[idx].length > 2) {
        blanks.push(idx);
      }
    }
    
    return { words, blanks: blanks.sort((a, b) => a - b) };
  }, [answer]);

  const handleWordBankSelect = (word: string) => {
    setSelectedWords([...selectedWords, word]);
  };

  const handleRemoveWord = (index: number) => {
    setSelectedWords(selectedWords.filter((_, i) => i !== index));
  };

  const checkAnswer = useCallback(() => {
    let userInput = "";
    if (quizLevel === 1) {
      userInput = selectedWords.join(" ");
    } else {
      userInput = userAnswer.trim();
    }

    const normalized = (str: string) => str.toLowerCase().replace(/[^\w\s가-힣]/g, "").trim();
    const correct = normalized(userInput) === normalized(answer);
    
    setIsCorrect(correct);
    setShowResult(true);
    onAnswer(userInput, correct);
  }, [quizLevel, selectedWords, userAnswer, answer, onAnswer]);

  const handleEditSave = () => {
    if (editedTranslation.trim() && onEditTranslation) {
      onEditTranslation(editedTranslation.trim());
    }
    setIsEditMode(false);
  };

  const renderDiff = useMemo(() => {
    if (!showResult || !userAnswer) return null;
    
    const diffs = dmp.diff_main(answer, userAnswer);
    dmp.diff_cleanupSemantic(diffs);
    
    return (
      <div className="flex flex-wrap gap-1 p-4 bg-muted rounded-lg">
        {diffs.map((diff, i) => {
          const [op, text] = diff;
          if (op === 0) {
            return <span key={i} className="text-green-600">{text}</span>;
          } else if (op === -1) {
            return <span key={i} className="text-red-500 line-through">{text}</span>;
          } else {
            return <span key={i} className="text-amber-500 underline decoration-wavy">{text}</span>;
          }
        })}
      </div>
    );
  }, [showResult, userAnswer, answer]);

  const getMasteryColor = (level: number) => {
    if (level >= 4) return "bg-green-100 text-green-700";
    if (level >= 2) return "bg-amber-100 text-amber-700";
    return "bg-gray-100 text-gray-700";
  };

  return (
    <Card className="border-2 shadow-lg" style={{ borderRadius: "1.5rem" }}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg text-muted-foreground">
            {getLangName(fromLang)} → {getLangName(toLang)}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge className={getMasteryColor(masteryLevel)}>
              숙달도 {masteryLevel}/5
            </Badge>
            <Badge variant="outline">Level {quizLevel}</Badge>
            {onEditTranslation && !showResult && (
              <Button variant="ghost" size="sm" onClick={() => {
                setEditedTranslation(target || "");
                setIsEditMode(true);
              }}>
                <Edit3 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Prompt */}
        <div className="p-6 bg-[#2F5D50]/5 rounded-xl border border-[#2F5D50]/20">
          <p className="text-xl leading-relaxed text-[#2F5D50] dark:text-green-400">{prompt}</p>
        </div>

        {/* Edit Mode */}
        {isEditMode && (
          <div className="space-y-4 p-4 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-200">
            <Textarea
              value={editedTranslation}
              onChange={(e) => setEditedTranslation(e.target.value)}
              placeholder="번역 수정..."
              className="min-h-24"
            />
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setIsEditMode(false)}>취소</Button>
              <Button onClick={handleEditSave}>
                <Save className="h-4 w-4 mr-1" />
                임시 저장
              </Button>
            </div>
          </div>
        )}

        {/* Quiz Input - Level 1: Word Bank */}
        {!showResult && !isEditMode && quizLevel === 1 && (
          <div className="space-y-4">
            <div className="min-h-16 p-4 border-2 border-dashed border-[#2F5D50]/30 rounded-xl flex flex-wrap gap-2">
              {selectedWords.length === 0 ? (
                <span className="text-muted-foreground">단어를 클릭하여 문장을 완성하세요</span>
              ) : (
                selectedWords.map((word, i) => (
                  <motion.div
                    key={i}
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Badge
                      variant="default"
                      className="cursor-pointer text-base py-1.5 px-3 bg-[#2F5D50] hover:bg-[#2F5D50]/80"
                      onClick={() => handleRemoveWord(i)}
                    >
                      {word} ×
                    </Badge>
                  </motion.div>
                ))
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {shuffledWords.map((word, i) => {
                const usedCount = selectedWords.filter(w => w === word).length;
                const totalCount = shuffledWords.filter(w => w === word).length;
                const isAvailable = usedCount < totalCount;
                return (
                  <motion.div
                    key={i}
                    whileHover={{ scale: isAvailable ? 1.05 : 1 }}
                    whileTap={{ scale: isAvailable ? 0.95 : 1 }}
                  >
                    <Badge
                      variant={isAvailable ? "outline" : "secondary"}
                      className={`cursor-pointer text-base py-1.5 px-3 ${!isAvailable ? "opacity-40" : "hover:bg-[#2F5D50]/10"}`}
                      onClick={() => isAvailable && handleWordBankSelect(word)}
                    >
                      {word}
                    </Badge>
                  </motion.div>
                );
              })}
            </div>
          </div>
        )}

        {/* Quiz Input - Level 2 & 3 */}
        {!showResult && !isEditMode && (quizLevel === 2 || quizLevel === 3) && (
          <div className="space-y-4">
            {quizLevel === 2 ? (
              <Input
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                placeholder="빈칸에 들어갈 단어를 입력하세요"
                className="text-lg py-6"
                onKeyDown={(e) => e.key === "Enter" && checkAnswer()}
              />
            ) : (
              <Textarea
                value={userAnswer}
                onChange={(e) => setUserAnswer(e.target.value)}
                placeholder="전체 문장을 입력하세요"
                className="text-lg min-h-24"
              />
            )}
          </div>
        )}

        {/* Result Display */}
        <AnimatePresence>
          {showResult && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-4"
            >
              <div className={`p-4 rounded-xl flex items-start gap-3 ${
                isCorrect || aiFeedback?.isCorrect
                  ? "bg-green-50 dark:bg-green-900/20 border border-green-200"
                  : "bg-red-50 dark:bg-red-900/20 border border-red-200"
              }`}>
                {isCorrect || aiFeedback?.isCorrect ? (
                  <Check className="h-5 w-5 text-green-600 mt-0.5" />
                ) : (
                  <X className="h-5 w-5 text-red-600 mt-0.5" />
                )}
                <div>
                  <p className="font-medium">
                    {isCorrect || aiFeedback?.isCorrect ? "정답입니다!" : "다시 확인해보세요"}
                  </p>
                  {aiFeedback?.feedback && (
                    <p className="text-sm mt-1 text-muted-foreground">{aiFeedback.feedback}</p>
                  )}
                </div>
              </div>

              {/* Diff visualization for Level 3 */}
              {quizLevel === 3 && renderDiff}

              {/* Correct answer */}
              <div className="p-4 bg-muted rounded-xl">
                <p className="text-sm text-muted-foreground mb-1">정답</p>
                <p className="text-lg">{answer}</p>
              </div>

              {/* AI Suggestions */}
              {aiFeedback?.suggestions && aiFeedback.suggestions.length > 0 && (
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200">
                  <p className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">개선 제안</p>
                  <ul className="text-sm space-y-1">
                    {aiFeedback.suggestions.map((s, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <ArrowRight className="h-4 w-4 mt-0.5 text-blue-500" />
                        {s}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Submit Button */}
        {!showResult && !isEditMode && (
          <Button
            onClick={checkAnswer}
            disabled={
              isCheckingAnswer ||
              (quizLevel === 1 && selectedWords.length === 0) ||
              ((quizLevel === 2 || quizLevel === 3) && !userAnswer.trim())
            }
            className="w-full py-6 text-lg bg-[#2F5D50] hover:bg-[#2F5D50]/90"
            data-testid="button-check-answer"
          >
            {isCheckingAnswer ? (
              <><Loader2 className="h-5 w-5 mr-2 animate-spin" />확인 중...</>
            ) : (
              "정답 확인"
            )}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
