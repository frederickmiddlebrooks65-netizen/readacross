import { cn } from "@/lib/utils";
import { type Category } from "@/lib/colorUtils";
import { useTranslation } from "@/i18n";

interface CategoryBadgeProps {
  category: Category;
  className?: string;
}

export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  const { t } = useTranslation();
  
  const labelKey = {
    Academic: 'category.academic',
    News: 'category.news', 
    Literature: 'category.literature',
    Opinion: 'category.opinion',
    Essays: 'category.essays',
    Other: 'category.other',
    Upload: 'category.upload',
  }[category] || 'category.other';
  
  const label = t(labelKey);

  // Unified brand blue dot marker for all categories
  const markerStyle = { backgroundColor: 'hsl(var(--dot-marker))' };

  return (
    <span 
      className={cn(
        "relative inline-flex items-center rounded-md border border-border bg-muted pl-2 pr-2 py-0.5 text-xs text-muted-foreground",
        className
      )}
      data-testid={`category-badge-${category.toLowerCase()}`}
    >
      <i 
        className="absolute inset-y-0 left-0 w-0.5 rounded-l-sm" 
        style={markerStyle}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}