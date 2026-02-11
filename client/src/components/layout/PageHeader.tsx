import React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  children?: React.ReactNode; // toolbar
  className?: string;
}

export default function PageHeader({
  title,
  subtitle,
  primaryAction,
  secondaryAction,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("py-8", className)}>
      <div className="flex items-center justify-between mb-8">
        <div className="flex-1 min-w-0">
          <h1 className="page-title mb-2 text-[30px] truncate">
            {title}
          </h1>
          {subtitle && (
            <p className="text-gray-500 dark:text-slate-400 text-[14px] mt-[2px] mb-[2px]">{subtitle}</p>
          )}
        </div>

        {(primaryAction || secondaryAction) && (
          <div className="flex items-center gap-2 ml-4">
            {secondaryAction}
            {primaryAction}
          </div>
        )}
      </div>

      {children}
    </header>
  );
}
