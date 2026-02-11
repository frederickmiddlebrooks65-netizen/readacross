import { forwardRef } from "react";
import { cn } from "@/lib/utils";

interface PaginatedPageContainerProps {
  pageHeight: number;
  className?: string;
  children: React.ReactNode;
}

const PaginatedPageContainer = forwardRef<HTMLDivElement, PaginatedPageContainerProps>(
  ({ pageHeight, className, children }, ref) => {
    return (
      <div
        ref={ref}
        className={cn(
          "paginated-page-container",
          "overflow-y-auto",
          "scroll-smooth",
          className
        )}
        style={{
          height: `${pageHeight}px`,
          minHeight: `${pageHeight}px`,
          maxHeight: `${pageHeight}px`,
        }}
      >
        <div className="paginated-page-content">
          {children}
        </div>
      </div>
    );
  }
);

PaginatedPageContainer.displayName = "PaginatedPageContainer";

export default PaginatedPageContainer;
