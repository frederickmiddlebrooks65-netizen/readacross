import React, { useState } from "react";
import { Download, Share2, Check, X, Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { ViewMode, DocumentWithParagraphs } from "@/lib/types.d";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface DocumentHeaderProps {
  title: string;
  sourceLanguage: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onTitleChange?: (newTitle: string) => void;
  onDownload?: () => void;
  onShare?: () => void;
  document?: DocumentWithParagraphs;
  isTranslating?: boolean;
  onTranslateDocument?: () => void;
  fontSize?: number;
  onFontSizeChange?: (size: number) => void;
  isPublic?: boolean;
  isExploreDocument?: boolean;
  isAlreadyInLibrary?: boolean;
  isAddingToLibrary?: boolean;
}

export default function DocumentHeader({
  title,
  sourceLanguage,
  viewMode,
  onViewModeChange,
  onTitleChange,
  onDownload,
  onShare,
  document,
  isTranslating,
  onTranslateDocument,
  fontSize = 16,
  onFontSizeChange,
  isPublic = false,
  isExploreDocument = false,
  isAlreadyInLibrary = false,
  isAddingToLibrary = false,
}: DocumentHeaderProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState(title);

  const viewModeLabels = {
    "original-only": "Original Only",
    "side-by-side": "Side-by-Side", 
    "translation-only": "Translation Only"
  };

  const handleTitleSave = () => {
    if (onTitleChange && editedTitle.trim()) {
      onTitleChange(editedTitle.trim());
    }
    setIsEditingTitle(false);
  };

  const handleTitleCancel = () => {
    setEditedTitle(title);
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSave();
    } else if (e.key === 'Escape') {
      handleTitleCancel();
    }
  };

  return (
    <header className="shrink-0 bg-background border-b border-border z-10">
      <div className="w-full px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          <div className="flex items-center gap-6 flex-1 min-w-0">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              {isEditingTitle ? (
                <div className="flex items-center gap-2 flex-1">
                  <Input
                    value={editedTitle}
                    onChange={(e) => setEditedTitle(e.target.value)}
                    onKeyDown={handleTitleKeyDown}
                    className="text-xl font-semibold"
                    autoFocus
                  />
                  <Button size="sm" variant="ghost" onClick={handleTitleSave}>
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="ghost" onClick={handleTitleCancel}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <h1 
                    className="text-xl font-semibold text-foreground truncate cursor-pointer hover:bg-muted/20 px-2 py-1 rounded transition-colors"
                    onDoubleClick={() => onTitleChange && setIsEditingTitle(true)}
                    title={onTitleChange ? "Double-click to edit title" : ""}
                  >
                    {title}
                  </h1>
                </div>
              )}
            </div>

            {onFontSizeChange && (
              <div className="flex items-center gap-2 min-w-[120px]">
                <span className="text-sm text-muted-foreground whitespace-nowrap">Font</span>
                <Slider
                  value={[fontSize]}
                  onValueChange={(value) => onFontSizeChange(value[0])}
                  min={12}
                  max={24}
                  step={1}
                  className="w-16"
                />
                <span className="text-xs text-muted-foreground w-6">{fontSize}</span>
              </div>
            )}

            {!isPublic && (
              <Select value={viewMode} onValueChange={onViewModeChange}>
                <SelectTrigger className="w-[180px] h-8">
                  <SelectValue placeholder="View mode" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="original-only">{viewModeLabels["original-only"]}</SelectItem>
                  <SelectItem value="side-by-side">{viewModeLabels["side-by-side"]}</SelectItem>
                  <SelectItem value="translation-only">{viewModeLabels["translation-only"]}</SelectItem>
                </SelectContent>
              </Select>
            )}

            {onTranslateDocument && !isPublic && (() => {
              // Calculate translation status once
              const allSentences = document?.paragraphs?.flatMap(p => p.sentences || []) || [];
              const translatedSentences = allSentences.filter(s => s.target && s.target.trim() !== '');
              const isFullyTranslated = allSentences.length > 0 && translatedSentences.length === allSentences.length;
              
              return (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button 
                        variant={isFullyTranslated ? "default" : "outline"}
                        size="sm"
                        className="flex items-center gap-2 h-8"
                        onClick={onTranslateDocument}
                        disabled={isTranslating || isFullyTranslated}
                      >
                        <Languages className="h-4 w-4" />
                        {isTranslating ? "Translating..." : 
                         isFullyTranslated ? "Translation completed" : 
                         "Translate all"}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        {isFullyTranslated 
                          ? "All sentences have been translated" 
                          : "Translate the entire document in the background"}
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              );
            })()}

            {isExploreDocument && !isAlreadyInLibrary && onShare && (
              <Button 
                size="sm"
                className="flex items-center gap-2 h-8"
                onClick={onShare}
                disabled={isAddingToLibrary}
              >
                {isAddingToLibrary ? (
                  <>
                    <div className="h-4 w-4 animate-spin rounded-full border border-current border-t-transparent" />
                    추가 중...
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4" />
                    Add to Library
                  </>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}