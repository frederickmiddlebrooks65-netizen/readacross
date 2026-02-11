
import React from 'react';
import { cn } from '@/lib/utils';

interface PageBodyProps {
  children: React.ReactNode;
  className?: string;
  scrollable?: boolean;
}

export default function PageBody({
  children,
  className,
  scrollable = false
}: PageBodyProps) {
  return (
    <main 
      className={cn(
        'flex-1',
        scrollable && 'min-h-0 overflow-y-auto overscroll-contain',
        className
      )}
      role="main"
    >
      {children}
    </main>
  );
}
