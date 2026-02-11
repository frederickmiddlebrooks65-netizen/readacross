import React, { useState } from "react";
import { ViewMode, SentenceWithUserData } from "@/lib/types.d";
import { cn } from "@/lib/utils";
import { Bookmark, BookmarkCheck, MessageSquare, Languages, Edit3 } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { BookOpen, Heart } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { NotepadTextIcon } from "lucide-react";

interface SegmentRowProps {
  sentence: SentenceWithUserData;
  mode: ViewMode;
  onUpdateSentence: (id: number, changes: Partial<SentenceWithUserData>) => void;
  onTranslateSentence: (id: number) => void;
  onAddNote: (sentence: SentenceWithUserData) => void;
  onPracticeSentence: (sentence: SentenceWithUserData) => void;
  onSaveSentence: (sentence: SentenceWithUserData) => void;
  onAddToGlossary: (sentence: SentenceWithUserData) => void;
  fontSize?: number;
  lineHeight?: number;
  isPublicDocument?: boolean;
}

export default function SegmentRow({
  sentence,
  mode,
  onUpdateSentence,
  onTranslateSentence,
  onAddNote,
  onPracticeSentence,
  onSaveSentence,
  onAddToGlossary,
  fontSize = 16,
  lineHeight = 1.6,
  isPublicDocument = false,
}: SegmentRowProps) {
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [noteText, setNoteText] = useState(sentence.noteContent || "");
  const [hovering, setHovering] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const quickSaveMutation = useMutation({
    mutationFn: async (sentenceData: any) => {
      return apiRequest('/api/sentences/quick-save', { method: 'POST', json: sentenceData });
    },
    onSuccess: () => {
      toast({
        title: "Saved!",
        description: "Sentence saved to My Sentences",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/sentences/my"] });
    },
  });

  const handleQuickSave = (sentence: SentenceWithUserData) => {
    quickSaveMutation.mutate({
      id: sentence.id,
      isScrapped: true,
      tags: JSON.stringify(['quick-save']),
    });
  };

  const handleToggleScrapped = () => {
    console.log('[DEBUG] handleToggleScrapped called for sentence:', sentence.id, 'current isScrapped:', sentence.isScrapped);
    if (onUpdateSentence) {
      console.log('[DEBUG] Calling onUpdateSentence with:', { id: sentence.id, isScrapped: !sentence.isScrapped });
      onUpdateSentence(sentence.id, { isScrapped: !sentence.isScrapped });
    } else {
      console.log('[DEBUG] onUpdateSentence is not available');
    }
  };

  const handlePractice = () => {
    if (onPracticeSentence) {
      onPracticeSentence(sentence);
    }
  };

  const handleTranslate = () => {
    if (onTranslateSentence) {
      onTranslateSentence(sentence.id);
    }
  };

  // Determine what text to show based on view mode and position
  const getDisplayText = () => {
    switch (mode) {
      case "original-only":
        return sentence.source;
      case "translation-only":
        return sentence.target || "No translation available";
      case "side-by-side":
        return sentence.target || "No translation available";
      default:
        return sentence.source;
    }
  };

  // Get tooltip text for hover (opposite language)
  const getTooltipText = () => {
    switch (mode) {
      case "original-only":
        return sentence.target || "No translation available";
      case "translation-only":
        return sentence.source;
      default:
        return "";
    }
  };

  const displayText = getDisplayText();
  const tooltipText = getTooltipText();

  return (
    <div
      className={cn(
        "sentence group transition-colors cursor-pointer relative",
        "py-3 px-4 rounded-lg border",
        sentence.isScrapped && "bg-blue-50 border-blue-200",
        sentence.noteContent && "border-l-4 border-l-brand",
        mode === "original-only" && "hover:bg-blue-50 border-gray-200",
        mode === "translation-only" && "hover:bg-green-50 border-gray-200",
        mode === "side-by-side" && "hover:bg-gray-50 border-gray-200",
        !sentence.isScrapped && !sentence.noteContent && "border-gray-100",
      )}
      data-sentence-id={sentence.id}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      onClick={isPublicDocument ? undefined : handlePractice}
      title="Click to practice translation"
    >
      {/* Quick Action Buttons */}
      <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 flex space-x-2 bg-background shadow rounded-md p-1 transition-opacity">
        <button
          className={cn(
            "p-1",
            sentence.isScrapped
              ? "text-primary"
              : "text-muted-foreground hover:text-primary",
          )}
          onClick={(e) => {
            e.stopPropagation();
            handleToggleScrapped();
          }}
          disabled={isPublicDocument}
        >
          {sentence.isScrapped ? (
            <BookmarkCheck className="h-4 w-4" />
          ) : (
            <Bookmark className="h-4 w-4" />
          )}
        </button>
        <button
          className={cn(
            "p-1.5 hover:bg-brand-subtle rounded text-xs flex items-center justify-center w-8 h-8 transition-colors",
            sentence.noteContent && "bg-brand-subtle"
          )}
          onClick={() => onAddNote?.(sentence)}
          disabled={isPublicDocument}
        >
          <NotepadTextIcon className={cn(
            "h-4 w-4 transition-colors",
            sentence.noteContent ? "text-brand" : "text-gray-500 hover:text-brand"
          )} />
        </button>
        {!sentence.target && onTranslateSentence && (
          <button
            className="p-1 text-muted-foreground hover:text-primary"
            onClick={(e) => {
              e.stopPropagation();
              handleTranslate();
            }}
            title="Translate this sentence"
            disabled={isPublicDocument}
          >
            <Languages className="h-4 w-4" />
          </button>
        )}
        <button
          className="p-1 text-muted-foreground hover:text-primary"
          onClick={(e) => {
            e.stopPropagation();
            handlePractice();
          }}
          title="Practice translation"
          disabled={isPublicDocument}
        >
          <Edit3 className="h-4 w-4" />
        </button>
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            handleQuickSave(sentence)
          }}
          className="h-6 w-6 p-0 bg-white shadow-sm"
          title="Save to My Sentences"
          disabled={isPublicDocument}
        >
          <BookOpen className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex items-start">
        <div className="flex-1">
          <span className={cn(
            "text-foreground leading-relaxed relative",
            mode === "translation-only" && !sentence.target && "text-gray-400 italic"
          )}>
            {displayText}
          </span>
          {/* Show tooltip on hover for original-only and translation-only modes */}
          {hovering && tooltipText && (mode === "original-only" || mode === "translation-only") && (
            <div className="absolute z-10 bottom-full left-0 mb-2 p-3 bg-gray-800 text-white text-sm rounded-md shadow-lg max-w-sm whitespace-normal">
              <p>{tooltipText}</p>
              <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
            </div>
          )}
        </div>
        <div className="flex items-center ml-3 space-x-1">
          {sentence.practiced && (
            <div className="w-2 h-2 bg-green-500 rounded-full" title="Practiced" />
          )}
          {sentence.noteContent && (
            <MessageSquare className="text-brand h-4 w-4" />
          )}
          {sentence.isScrapped && (
            <BookmarkCheck className="text-blue-500 h-4 w-4" />
          )}
        </div>
      </div>


      {/* Note editor */}
      {showNoteEditor && (
        <div className="mt-2 p-3 bg-primary/10 rounded-md">
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Add your note here..."
            className="min-h-[80px] bg-background"
            disabled={isPublicDocument}
          />
          <div className="flex justify-end mt-2 space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setNoteText(sentence.noteContent || "");
                setShowNoteEditor(false);
              }}
              disabled={isPublicDocument}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={() => {
              if (onUpdateSentence) {
                onUpdateSentence(sentence.id, { note: noteText });
                setShowNoteEditor(false);
              }
            }} disabled={isPublicDocument}>
              Save Note
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}