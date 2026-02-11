import { cn } from '@/lib/utils';
import { LibraryIcon } from 'lucide-react';
import { useTranslation } from '@/i18n';

interface StickyLibraryHeaderProps {
  isVisible: boolean;
  documentCount?: number;
}

export default function StickyLibraryHeader({ isVisible, documentCount }: StickyLibraryHeaderProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "fixed top-16 left-0 right-0 z-20 bg-background/95 backdrop-blur-sm border-b border-border/50",
        "transition-all duration-300 ease-out",
        isVisible ? "translate-y-0 opacity-100 pointer-events-auto" : "-translate-y-full opacity-0 pointer-events-none"
      )}
    >
      <div className="container mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <LibraryIcon className="h-5 w-5 text-brand-amber" />
          <h2 className="text-lg font-semibold text-foreground">
            {t('library.title')}
          </h2>
          {documentCount !== undefined && (
            <span className="text-sm text-muted-foreground">
              ({documentCount})
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
