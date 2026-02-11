import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export default function Pagination({
  currentPage,
  totalPages,
  onPageChange,
  className,
}: PaginationProps) {
  if (totalPages <= 1) return null;

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);

  const handlePageChange = (page: number) => {
    onPageChange(page);
    
    const contentGrid = document.querySelector('[data-pagination-scroll-target]') 
      || document.querySelector('.document-grid')
      || document.querySelector('[class*="grid"]');
    
    if (contentGrid) {
      const headerOffset = 100;
      const elementPosition = contentGrid.getBoundingClientRect().top + window.scrollY;
      window.scrollTo({ top: elementPosition - headerOffset, behavior: "smooth" });
    }
  };

  return (
    <div className={cn("flex items-center justify-center gap-1.5 mt-8", className)}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => handlePageChange(currentPage - 1)}
        disabled={currentPage === 1}
        className="w-7 h-7 p-0 text-muted-foreground hover:text-foreground"
        data-testid="pagination-prev"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>

      <div className="flex items-center gap-1">
        {pages.map((page) => (
          <Button
            key={page}
            variant="ghost"
            size="sm"
            onClick={() => handlePageChange(page)}
            className={cn(
              "w-7 h-7 p-0 text-xs text-muted-foreground hover:text-foreground",
              currentPage === page && "text-primary font-semibold"
            )}
            data-testid={`pagination-page-${page}`}
          >
            {page}
          </Button>
        ))}
      </div>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => handlePageChange(currentPage + 1)}
        disabled={currentPage === totalPages}
        className="w-7 h-7 p-0 text-muted-foreground hover:text-foreground"
        data-testid="pagination-next"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
