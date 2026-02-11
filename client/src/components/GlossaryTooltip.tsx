import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, BookOpen, Loader2 } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface GlossaryTooltipProps {
  selectedText: string;
  position: { x: number; y: number };
  onClose: () => void;
  contextSentence?: string;
  documentId?: number;
}

interface GlossaryFormData {
  term: string;
  definition: string;
  translation: string;
  pronunciation?: string;
  difficulty: "beginner" | "intermediate" | "advanced";
  sourceLanguage: string;
  targetLanguage: string;
  contextSentence?: string;
  documentId?: number;
}

export default function GlossaryTooltip({
  selectedText,
  position,
  onClose,
  contextSentence,
  documentId,
}: GlossaryTooltipProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedData, setGeneratedData] = useState<{
    definition: string;
    translation: string;
  } | null>(null);
  const [adjustedPosition, setAdjustedPosition] = useState(position);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Use ref to track the current term and prevent duplicate API calls
  const lastGeneratedTermRef = useRef<string>("");
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Generate definition and translation using GPT with debounce
  const generateGlossaryData = async (term: string) => {
    // Skip if already generated for this term
    if (lastGeneratedTermRef.current === term) return;
    
    setIsGenerating(true);
    try {
      const data = await apiRequest("/api/glossary/generate", {
        method: "POST",
        body: JSON.stringify({
          term,
          contextSentence,
          sourceLanguage: "English",
          targetLanguage: "Korean",
          documentId
        }),
        headers: {
          "Content-Type": "application/json"
        }
      });
      
      lastGeneratedTermRef.current = term;
      setGeneratedData(data);
    } catch (error) {
      console.error("Error generating glossary data:", error);
      // Don't show toast - error state will be shown in tooltip UI
    } finally {
      setIsGenerating(false);
    }
  };

  // Add to glossary mutation
  const addToGlossaryMutation = useMutation({
    mutationFn: async (data: GlossaryFormData) => {
      console.log("Sending glossary data:", data);
      return apiRequest("/api/glossary", {
        method: "POST",
        body: JSON.stringify(data),
        headers: {
          "Content-Type": "application/json"
        }
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/glossary"] });
      toast({
        title: "용어집에 추가됨",
        description: `"${selectedText}"(이)가 용어집에 추가되었습니다.`,
      });
      onClose();
    },
    onError: () => {
      toast({
        title: "추가 실패",
        description: "용어집에 추가할 수 없습니다.",
        variant: "destructive",
      });
    },
  });

  // Calculate and adjust tooltip position to keep it within bounds
  useEffect(() => {
    if (!tooltipRef.current) return;
    
    const adjustPosition = () => {
      const scrollContainer = document.querySelector('[data-scroll-container="true"]');
      const scrollRect = scrollContainer?.getBoundingClientRect();
      const tooltipWidth = 320; // w-80
      const tooltipHeight = 300; // estimated
      const padding = 16;
      
      let adjustedX = position.x;
      let adjustedY = position.y;
      
      if (scrollRect) {
        // Constrain within scroll container bounds
        const containerRight = scrollRect.right;
        const containerLeft = scrollRect.left;
        const containerTop = scrollRect.top;
        
        // Center tooltip on position.x
        let left = position.x - tooltipWidth / 2;
        
        // Adjust if too far right
        if (left + tooltipWidth > containerRight - padding) {
          left = containerRight - tooltipWidth - padding;
        }
        
        // Adjust if too far left
        if (left < containerLeft + padding) {
          left = containerLeft + padding;
        }
        
        adjustedX = left;
        adjustedY = Math.max(containerTop + padding, position.y);
      } else {
        // Fallback: constrain to window bounds
        let left = position.x - tooltipWidth / 2;
        left = Math.max(padding, Math.min(left, window.innerWidth - tooltipWidth - padding));
        adjustedX = left;
      }
      
      setAdjustedPosition({ x: adjustedX, y: adjustedY });
    };
    
    // Adjust position immediately and on window resize
    adjustPosition();
    window.addEventListener('resize', adjustPosition);
    
    return () => {
      window.removeEventListener('resize', adjustPosition);
    };
  }, [position]);

  // Auto-generate data when tooltip opens with debounce to prevent API spam
  useEffect(() => {
    // Clear any existing debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    
    const trimmedText = selectedText.trim();
    if (trimmedText && trimmedText !== lastGeneratedTermRef.current) {
      // Debounce API call by 500ms to wait for drag to complete
      debounceTimerRef.current = setTimeout(() => {
        generateGlossaryData(trimmedText);
      }, 500);
    }
    
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [selectedText]);

  const handleAddToGlossary = () => {
    if (!generatedData) return;

    const glossaryData: GlossaryFormData = {
      term: selectedText.trim(),
      definition: generatedData.definition,
      translation: generatedData.translation,
      difficulty: "beginner",
      sourceLanguage: "English",
      targetLanguage: "Korean",
      contextSentence: contextSentence,
      documentId: documentId,
    };

    addToGlossaryMutation.mutate(glossaryData);
  };

  // Position the tooltip to avoid going off-screen
  const tooltipStyle = {
    position: "fixed" as const,
    left: `${adjustedPosition.x}px`,
    top: `${adjustedPosition.y - 10}px`,
    zIndex: 50,
    transform: "translateY(-100%)",
  };

  return (
    <div ref={tooltipRef} style={tooltipStyle}>
      <Card className="w-80 shadow-lg border-2 border-primary/20 bg-background">
        <CardContent className="p-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <span className="font-semibold text-sm">용어집에 추가</span>
            </div>
            <button
              className="h-6 w-6 p-0 flex items-center justify-center hover:bg-gray-100 rounded"
              onClick={onClose}
            >
              ×
            </button>
          </div>

          {/* Selected term */}
          <div className="mb-3">
            <div className="font-medium text-lg text-foreground">
              "{selectedText}"
            </div>
          </div>

          {/* Generated content */}
          {isGenerating ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <span className="ml-2 text-sm text-muted-foreground">
                정의 생성 중...
              </span>
            </div>
          ) : generatedData ? (
            <div className="space-y-3">
              {/* Definition only - translation and context are saved but not displayed */}
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-1">
                  정의
                </div>
                <div className="text-sm text-foreground">
                  {generatedData.definition}
                </div>
              </div>

              {/* Add button */}
              <Button
                onClick={handleAddToGlossary}
                disabled={addToGlossaryMutation.isPending}
                className="w-full mt-4"
              >
                {addToGlossaryMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    추가 중...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    용어집에 추가
                  </>
                )}
              </Button>
            </div>
          ) : (
            <div className="text-center py-4">
              <div className="text-sm text-muted-foreground mb-2">
                이 단어의 정의를 찾을 수 없어요.
              </div>
              <div className="text-xs text-muted-foreground/70">
                다른 단어를 선택해 보세요.
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}