
import React from "react";
import DocumentCard from "./DocumentCard";
import { LibraryDocument } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";

interface DocumentsListProps {
  title: string;
  documents: LibraryDocument[];
  isLoading?: boolean;
  emptyMessage?: string;
  layout?: 'grid' | 'list';
}

export default function DocumentsList({
  title,
  documents,
  isLoading = false,
  emptyMessage = "No documents found",
  layout = 'grid'
}: DocumentsListProps) {
  
  const LoadingBookCard = () => (
    <div className="animate-pulse">
      <div className="aspect-[3/4] bg-muted rounded-lg mb-3"></div>
      <div className="h-4 bg-muted rounded mb-2"></div>
      <div className="h-3 bg-muted rounded w-3/4"></div>
    </div>
  );

  if (layout === 'grid') {
    return (
      <div className="mb-8">
        <div className="mb-6">
          <h3 className="text-xl font-bold text-foreground mb-2">{title}</h3>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-6">
          {isLoading ? (
            <>
              <LoadingBookCard />
              <LoadingBookCard />
              <LoadingBookCard />
              <LoadingBookCard />
            </>
          ) : documents.length > 0 ? (
            documents.map((doc) => (
              <DocumentCard key={doc.id} document={doc} />
            ))
          ) : (
            <div className="col-span-full text-center py-8">
              <p className="text-muted-foreground">{emptyMessage}</p>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Original list layout (fallback)
  return (
    <div className="bg-card rounded-lg shadow mb-6">
      <div className="px-6 py-4 border-b border-border">
        <h3 className="text-lg font-medium text-foreground">{title}</h3>
      </div>

      <div className="p-6 space-y-4">
        {isLoading ? (
          <>
            <LoadingSkeleton />
            <LoadingSkeleton />
          </>
        ) : documents.length > 0 ? (
          documents.map((doc) => (
            <DocumentCard key={doc.id} document={doc} />
          ))
        ) : (
          <div className="text-center py-6">
            <p className="text-muted-foreground">{emptyMessage}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Loading skeleton component for list layout
function LoadingSkeleton() {
  return (
    <div className="p-4 border border-border rounded-lg bg-card">
      <div className="flex justify-between items-start">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-36" />
        </div>
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-2 w-full mt-3" />
    </div>
  );
}
