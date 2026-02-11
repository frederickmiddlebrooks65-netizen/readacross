import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Brain, CheckCircle, RotateCcw, Zap, Star } from "lucide-react";
import { SentenceWithUserData } from "@/lib/types.d";

interface SentenceCardData extends SentenceWithUserData {
  document?: {
    title: string;
  };
  isRecommended?: boolean;
  scoreHistory?: number | null;
  isCompleted?: boolean;
  lastPracticeScore?: number;
}

interface SentenceCardProps {
  sentence: SentenceCardData;
  onClick: () => void;
}

export function SentenceCard({ sentence, onClick }: SentenceCardProps) {
  // 상태별 뱃지 시스템
  const getStatusBadges = () => {
    const badges = [];

    // 1. GPT 추천 (최우선)
    if (sentence.isRecommended) {
      badges.push({
        icon: Brain,
        text: "GPT 추천",
        color: "bg-brand-subtle text-brand border-brand dark:bg-brand-subtle dark:text-brand dark:border-brand"
      });
    }

    // 2. 낮은 점수 (6점 미만)
    if (sentence.lastPracticeScore && sentence.lastPracticeScore < 6) {
      badges.push({
        icon: Zap,
        text: "복습 필요",
        color: "bg-brand-subtle text-brand border-brand dark:bg-brand-subtle dark:text-brand dark:border-brand"
      });
    }

    // 3. 연습 완료
    if (sentence.status === "completed" || sentence.status === "mastered") {
      badges.push({
        icon: CheckCircle,
        text: "완료",
        color: "bg-brand-subtle text-brand border-brand dark:bg-brand-subtle dark:text-brand dark:border-brand"
      });
    }

    // 4. 연습 중
    if (sentence.status === "practicing") {
      badges.push({
        icon: RotateCcw,
        text: "연습 중",
        color: "bg-brand-subtle text-brand border-brand dark:bg-brand-subtle dark:text-brand dark:border-brand"
      });
    }

    // 5. 즐겨찾기
    if (sentence.isFavorite) {
      badges.push({
        icon: Star,
        text: "즐겨찾기",
        color: "bg-brand-subtle text-brand border-brand dark:bg-brand-subtle dark:text-brand dark:border-brand"
      });
    }

    // 최대 2개까지만 표시
    return badges.slice(0, 2);
  };

  const badges = getStatusBadges();

  return (
    <Card
      className="cursor-pointer hover:shadow-md transition-all duration-200 hover:scale-[1.02] border-l-4 border-l-brand"
      onClick={onClick}
    >
      <CardContent className="p-4">
        {/* 상태 뱃지 */}
        <div className="flex items-center gap-2 mb-3 min-h-[20px]">
          {badges.map((badge, index) => {
            const Icon = badge.icon;
            return (
              <Badge
                key={index}
                variant="outline"
                className={`text-xs font-medium border ${badge.color}`}
              >
                <Icon className="h-3 w-3 mr-1" />
                {badge.text}
              </Badge>
            );
          })}
        </div>

        {/* 문장 내용 */}
        <div className="mb-3">
          <p className="text-sm font-medium line-clamp-2 text-card-foreground leading-relaxed">
            {sentence.source}
          </p>
          {sentence.document && (
            <p className="text-xs text-muted-foreground mt-2">
              출처: {sentence.document.title}
            </p>
          )}
        </div>

        {/* 하단 정보 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {sentence.lastPracticeScore && (
              <span className="flex items-center gap-1">
                <RotateCcw className="h-3 w-3" />
                최근 점수: {sentence.lastPracticeScore}/10
              </span>
            )}
            {sentence.practiceCount && sentence.practiceCount > 0 && (
              <span>• {sentence.practiceCount}회 연습</span>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-gray-400" />
        </div>
      </CardContent>
    </Card>
  );
}