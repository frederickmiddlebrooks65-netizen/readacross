
import React from 'react';
import { cn } from '@/lib/utils';

interface PageToolbarProps {
  children: React.ReactNode;
  className?: string;
  sticky?: boolean;
}

export default function PageToolbar({
  children,
  className,
  sticky = true
}: PageToolbarProps) {
  return (
    <div className={cn(
      'bg-background/90 backdrop-blur border-b',
      sticky && 'sticky top-0 z-10',
      'py-3',
      className
    )}>
      {children}
    </div>
  );
}
