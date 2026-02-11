import { cn } from "@/lib/utils";

interface NotebookBadgeProps {
  colorKey: string | null; // @deprecated - color labeling removed for monotone design
  name?: string;
  className?: string;
}

export function NotebookBadge({ colorKey, name, className }: NotebookBadgeProps) {
  // Monotone design: ignore colorKey and use neutral styling without color markers
  const displayText = name || 'Notebook';

  return (
    <span 
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300",
        className
      )}
      data-testid={`notebook-badge-${colorKey}`}
    >
      {displayText}
    </span>
  );
}