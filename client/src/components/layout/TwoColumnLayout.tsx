
import React from 'react';
import { cn } from '@/lib/utils';

interface TwoColumnLayoutProps {
  rightWidth?: number; // default 400
  leftWidth?: number;  // if specified, left column gets fixed width instead
  gap?: number;        // default 24
  collapseAt?: 'lg' | 'xl'; // 지정 시 해당 폭 이하에서 우측 패널을 오버레이로 전환
  children: [React.ReactNode, React.ReactNode];
  className?: string;
}

export default function TwoColumnLayout({
  rightWidth = 400,
  leftWidth,
  gap = 24,
  collapseAt,
  children,
  className
}: TwoColumnLayoutProps) {
  const [leftChild, rightChild] = children;
  
  // Determine grid template based on which width is specified
  const getGridTemplate = () => {
    if (collapseAt) return undefined;
    if (leftWidth) return `${leftWidth}px 1fr`;
    return `1fr ${rightWidth}px`;
  };
  
  return (
    <div 
      className={cn(
        'grid h-full',
        collapseAt ? `grid-cols-1 ${collapseAt}:grid-cols-2` : 'grid-cols-2',
        className
      )}
      style={{ 
        gap: `${gap}px`,
        gridTemplateColumns: getGridTemplate()
      }}
    >
      <div 
        className="min-h-0 overflow-hidden"
        style={{ width: collapseAt ? undefined : (leftWidth ? `${leftWidth}px` : undefined) }}
      >
        {leftChild}
      </div>
      
      <aside 
        className={cn(
          'min-h-0 overflow-hidden',
          collapseAt && `hidden ${collapseAt}:block`
        )}
        role="complementary"
        style={{ width: collapseAt ? undefined : (leftWidth ? undefined : `${rightWidth}px`) }}
      >
        {rightChild}
      </aside>
    </div>
  );
}
