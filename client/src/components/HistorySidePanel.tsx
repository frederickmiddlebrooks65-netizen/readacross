import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, X, Bot, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { SentenceTranslationHistory } from "@shared/schema";

interface HistorySidePanelProps {
  isOpen: boolean;
  onClose: () => void;
  sentenceId: number | null;
  onRestore: (translation: string) => void;
}

interface HistoryResponse {
  sentenceId: number;
  source: string;
  currentTranslation: string;
  history: SentenceTranslationHistory[];
}

function formatTime(value: string | Date): string {
  try {
    const d = typeof value === "string" ? new Date(value) : value;
    return d.toLocaleString(undefined, {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return String(value);
  }
}

export default function HistorySidePanel({
  isOpen,
  onClose,
  sentenceId,
  onRestore,
}: HistorySidePanelProps) {
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<HistoryResponse>({
    queryKey: ["/api/sentences", sentenceId, "history"],
    queryFn: () => apiRequest(`/api/sentences/${sentenceId}/history`),
    enabled: isOpen && sentenceId != null,
  });

  // Refetch whenever the panel re-opens for a different sentence
  useEffect(() => {
    if (isOpen && sentenceId != null) {
      refetch();
    }
  }, [isOpen, sentenceId, refetch]);

  const handleRestore = async (entry: SentenceTranslationHistory) => {
    if (sentenceId == null) return;
    try {
      const res = await apiRequest(
        `/api/sentences/${sentenceId}/history/restore`,
        {
          method: "POST",
          json: { historyId: entry.id },
        },
      );
      // Invalidate so future opens reflect any newly auto-saved current state
      queryClient.invalidateQueries({
        queryKey: ["/api/sentences", sentenceId, "history"],
      });
      onRestore(res.translation as string);
      onClose();
    } catch (err) {
      console.error("Failed to restore translation:", err);
      toast({
        title: "복원 실패",
        description:
          err instanceof Error ? err.message : "히스토리를 복원하지 못했습니다",
        variant: "destructive",
      });
    }
  };

  if (!isOpen) return null;

  const history = data?.history ?? [];
  const currentText = (data?.currentTranslation ?? "").trim();
  const latestEntryId = history.length > 0 ? history[0].id : null;

  return (
    <div
      className={cn(
        "fixed top-12 right-0 bottom-0 z-50",
        "w-[440px] min-w-[420px] max-w-[460px]",
        "bg-background/95 backdrop-blur-md border-l border-border shadow-2xl",
        "flex flex-col",
      )}
      data-testid="history-side-panel"
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-muted/50">
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8"
            data-testid="button-history-back"
            title="원래 패널로 돌아가기"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="font-sans font-semibold text-foreground">히스토리</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
          data-testid="button-history-close"
          title="닫기"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Source preview */}
      {data?.source && (
        <div className="p-3 bg-muted/40 border-b border-border">
          <div className="text-xs text-muted-foreground mb-1">원문</div>
          <div className="text-sm text-foreground line-clamp-3">
            {data.source}
          </div>
        </div>
      )}

      {/* History list */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-2">
          {isLoading ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              불러오는 중...
            </div>
          ) : history.length === 0 ? (
            <div className="text-sm text-muted-foreground py-6 text-center">
              저장된 히스토리가 없습니다
            </div>
          ) : (
            history.map((entry) => {
              const isCurrent =
                entry.id === latestEntryId &&
                entry.translation.trim() === currentText;
              const preview =
                entry.translation.length > 50
                  ? entry.translation.slice(0, 50) + "…"
                  : entry.translation;

              return (
                <div
                  key={entry.id}
                  className={cn(
                    "rounded-md border border-border p-3 bg-card transition-colors",
                    isCurrent && "border-primary/60 bg-primary/5",
                  )}
                  data-testid={`history-entry-${entry.id}`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-semibold text-foreground">
                        v{entry.version}
                      </span>
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        {entry.type === "ai" ? (
                          <>
                            <Bot className="h-3 w-3" />
                            AI
                          </>
                        ) : (
                          <>
                            <UserIcon className="h-3 w-3" />
                            내가 편집
                          </>
                        )}
                      </span>
                      {isCurrent && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                          현재
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {formatTime(entry.createdAt as any)}
                    </span>
                  </div>

                  <div className="text-sm text-foreground mb-2 break-words">
                    {preview}
                  </div>

                  {!isCurrent && (
                    <div className="flex justify-end">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 px-3 text-xs"
                        onClick={() => handleRestore(entry)}
                        data-testid={`button-restore-${entry.id}`}
                      >
                        복원
                      </Button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
