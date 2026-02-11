
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { X, MoreHorizontal } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/i18n';

interface FilterChip {
  key: string;
  type: 'status' | 'sources' | 'category';
  value: string | string[];
  onRemove: () => void;
}

interface FilterChipsProps {
  chips: FilterChip[];
  onClearAll: () => void;
  maxVisible?: number;
  className?: string;
}

export default function FilterChips({ 
  chips, 
  onClearAll, 
  maxVisible = 5, 
  className 
}: FilterChipsProps) {
  const { t } = useTranslation();
  
  if (chips.length === 0) return null;

  const getChipLabel = (chip: FilterChip): string => {
    if (chip.type === 'status') {
      const statusKey = {
        active: 'filter.statusActive',
        archived: 'filter.statusArchived',
        all: 'filter.statusAll'
      }[chip.value as string] || chip.value as string;
      return `${t('filter.status')}: ${t(statusKey)}`;
    }
    
    if (chip.type === 'sources') {
      const sources = chip.value as string[];
      const translatedSources = sources.map(source => {
        const sourceKey = {
          uploaded: 'filter.sourceUploaded',
          saved: 'filter.sourceSaved',
          rss: 'filter.sourceRss'
        }[source] || source;
        return t(sourceKey);
      });
      return `${t('filter.source')}: ${translatedSources.join(', ')}`;
    }
    
    if (chip.type === 'category') {
      const categoryKey = {
        Academic: 'category.academic',
        News: 'category.news',
        Literature: 'category.literature',
        Opinion: 'category.opinion',
        Essays: 'category.essays',
        Other: 'category.other'
      }[chip.value as string] || chip.value as string;
      return t(categoryKey);
    }
    
    return chip.value as string;
  };

  const visibleChips = chips.slice(0, maxVisible);
  const hiddenChips = chips.slice(maxVisible);
  const hasHiddenChips = hiddenChips.length > 0;

  return (
    <div className={cn(
      "flex items-center gap-2 py-2",
      className
    )}>
      {/* Mobile: Horizontal scroll container */}
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide min-w-0 flex-1 sm:flex-wrap sm:overflow-visible">
        {visibleChips.map((chip) => {
          const label = getChipLabel(chip);
          return (
            <Badge
              key={chip.key}
              variant="secondary"
              className="flex items-center gap-1 whitespace-nowrap shrink-0 max-w-[200px] sm:max-w-none"
            >
              <span className="truncate">{label}</span>
              <button
                onClick={chip.onRemove}
                className="ml-1 hover:bg-muted-foreground/20 rounded-full p-0.5 transition-colors"
                aria-label={t('filter.removeFilter')}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          );
        })}

        {hasHiddenChips && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge 
                  variant="outline" 
                  className="flex items-center gap-1 shrink-0 cursor-help"
                >
                  <MoreHorizontal className="h-3 w-3" />
                  +{hiddenChips.length}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground mb-2">
                    {t('filter.additionalFilters')}
                  </div>
                  {hiddenChips.map((chip) => {
                    const label = getChipLabel(chip);
                    return (
                      <div key={chip.key} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate">{label}</span>
                        <button
                          onClick={chip.onRemove}
                          className="hover:bg-muted-foreground/20 rounded-full p-0.5 transition-colors"
                          aria-label={t('filter.removeFilter')}
                        >
                          <X className="h-2.5 w-2.5" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      {/* Clear All button - Fixed to the right */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onClearAll}
        className="text-xs text-muted-foreground hover:text-foreground shrink-0 px-3"
      >
        {t('filter.clearAll')}
      </Button>
    </div>
  );
}
