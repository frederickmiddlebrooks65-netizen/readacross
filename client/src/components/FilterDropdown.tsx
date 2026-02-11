import { useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuCheckboxItem,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Filter, RotateCcw, Eye, EyeOff } from 'lucide-react';
import type { LibraryFilters, StatusFilter, SourceFilter, CategoryFilter } from '@/hooks/useLibraryFilters';
import { UI_SOURCES_ARRAY } from "@/lib/source/classifier";
import type { UISource } from "@/lib/source/types";
import { useTranslation } from "@/i18n";

interface FilterDropdownProps {
  filters: LibraryFilters;
  onFiltersChange: (updates: Partial<LibraryFilters>) => void;
  onReset: () => void;
  badgeCount: number;
  sourceCounts: Record<UISource, number>;
  documentCounts?: {
    uploaded: number;
    saved: number;
    rss: number;
    categoryBreakdown: Record<CategoryFilter, number>;
  };
}

export default function FilterDropdown({
  filters,
  onFiltersChange,
  onReset,
  badgeCount,
  sourceCounts,
  documentCounts
}: FilterDropdownProps) {
  const { t } = useTranslation();
  const [showEmptyCategories, setShowEmptyCategories] = useState(false);

  const handleSourceChange = (source: SourceFilter, checked: boolean) => {
    const newSources = checked
      ? [...filters.sources, source]
      : filters.sources.filter(s => s !== source);
    onFiltersChange({ sources: newSources });
  };

  const handleCategoryChange = (category: CategoryFilter, checked: boolean) => {
    const newCategories = checked
      ? [...filters.categories, category]
      : filters.categories.filter(c => c !== category);
    onFiltersChange({ categories: newCategories });
  };

  const sourceLabels: Record<UISource, string> = {
    uploaded: t('filter.sourceUploaded'),
    saved: t('filter.sourceSaved'),
    rss: t('filter.sourceRss'),
  };

  const categoryLabels: Record<CategoryFilter, string> = {
    News: t('category.news'),
    Literature: t('category.literature'),
    Academic: t('category.academic'),
    Opinion: t('category.opinion'),
    Other: t('category.other'),
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className="flex items-center gap-2 h-10 border border-input bg-background hover:bg-accent hover:text-accent-foreground text-[#0c0a09]"
          data-testid="button-filters"
        >
          <Filter className="h-4 w-4" />
          {t('filter.filters')}
          {badgeCount > 0 && (
            <Badge variant="default" className="ml-1 h-5 w-5 flex items-center justify-center text-xs font-medium">
              {badgeCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-80" align="end">
        <div className="flex items-center justify-between px-2 py-1.5">
          <DropdownMenuLabel className="px-0">{t('filter.filters')}</DropdownMenuLabel>
          <Button
            variant="ghost"
            size="sm"
            onClick={onReset}
            className="h-auto px-2 py-1 text-xs"
            data-testid="button-reset-filters"
          >
            <RotateCcw className="h-3 w-3 mr-1" />
            {t('common.reset')}
          </Button>
        </div>

        <DropdownMenuSeparator />

        {/* Status Section */}
        <div className="px-2 py-2">
          <DropdownMenuLabel className="px-0 text-xs text-muted-foreground">
            {t('filter.status')}
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={filters.status}
            onValueChange={(value) => onFiltersChange({ status: value as StatusFilter })}
          >
            <DropdownMenuRadioItem value="active" data-testid="filter-status-active">
              {t('filter.statusActive')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="archived" data-testid="filter-status-archived">
              {t('filter.statusArchived')}
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="all" data-testid="filter-status-all">
              {t('filter.statusAll')}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </div>

        <DropdownMenuSeparator />

        {/* Source Section */}
        <div className="px-2 py-2">
          <DropdownMenuLabel className="px-0 text-xs text-muted-foreground">
            {t('filter.source')}
          </DropdownMenuLabel>
          {UI_SOURCES_ARRAY.map((source) => (
            <DropdownMenuCheckboxItem
              key={source}
              checked={filters.sources.includes(source)}
              onCheckedChange={(checked) => handleSourceChange(source, checked)}
              data-testid={`filter-source-${source}`}
            >
              <span>
                {sourceLabels[source]} ({sourceCounts[source]})
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </div>

        <DropdownMenuSeparator />

        {/* Category Section */}
        <div className="px-2 py-2">
          <div className="flex items-center justify-between mb-2">
            <DropdownMenuLabel className="px-0 text-xs text-muted-foreground">
              {t('filter.category')}
            </DropdownMenuLabel>
            {documentCounts?.categoryBreakdown && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowEmptyCategories(!showEmptyCategories)}
                className="h-auto px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
                data-testid="button-toggle-empty-categories"
              >
                {showEmptyCategories ? (
                  <>
                    <EyeOff className="h-3 w-3 mr-1" />
                    {t('filter.hideEmpty')}
                  </>
                ) : (
                  <>
                    <Eye className="h-3 w-3 mr-1" />
                    {t('filter.showEmpty')}
                  </>
                )}
              </Button>
            )}
          </div>
          {(['News', 'Literature', 'Academic', 'Opinion', 'Other'] as CategoryFilter[]).map((category) => {
            const count = documentCounts?.categoryBreakdown[category] ?? 0;
            const shouldShow = count > 0 || showEmptyCategories;

            if (!shouldShow) return null;

            return (
              <DropdownMenuCheckboxItem
                key={category}
                checked={filters.categories.includes(category)}
                onCheckedChange={(checked) => handleCategoryChange(category, checked)}
                disabled={count === 0}
                data-testid={`filter-category-${category.toLowerCase()}`}
              >
                {categoryLabels[category]} ({count})
              </DropdownMenuCheckboxItem>
            );
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}