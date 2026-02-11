
import React from 'react';
import { cn } from '@/lib/utils';

interface PageShellProps {
  layout?: 'one' | 'two';
  scrollMode?: 'page' | 'app'; // default: 'page'
  maxWidth?: 'compact' | 'standard' | 'wide' | 'full'; // default: 'standard'
  className?: string;
  children: React.ReactNode;
}

export default function PageShell({
  layout = 'one',
  scrollMode = 'page',
  maxWidth = 'standard',
  className,
  children
}: PageShellProps) {
  const isAppMode = scrollMode === 'app';
  
  return (
    <div className={cn(
      'flex flex-col',
      isAppMode ? 'h-screen overflow-hidden' : 'min-h-screen',
      `page-width-${maxWidth}`,
      className
    )}>
      <div className={cn(
        'mx-auto w-full',
        'max-w-[var(--page-max-width)]',
        'px-6 lg:px-8',
        isAppMode ? 'flex flex-col h-full' : ''
      )}>
        {children}
      </div>
    </div>
  );
}
