import React from "react";
import { cn } from "@/lib/utils";
import PageHeader from "./PageHeader";

interface HeaderBarProps {
  title: string;
  subtitle?: string;
  actionsRight?: React.ReactNode;
  controlsLeft?: React.ReactNode;
  controlsRight?: React.ReactNode;
  className?: string;
}

export default function HeaderBar({
  title,
  subtitle,
  actionsRight,
  controlsLeft,
  controlsRight,
  className
}: HeaderBarProps) {
  return (
    <div className={cn("space-y-4", className)}>
      {/* Line 1: Visual Header - Title + Primary Actions */}
      <PageHeader
        title={title}
        subtitle={subtitle}
        primaryAction={actionsRight}
        className="py-8 [&>div:first-child]:mb-8"
      />
      
      {/* Line 2: Practical Controls - Search/Filters + Secondary Actions */}
      {(controlsLeft || controlsRight) && (
        <div className="flex items-center justify-between gap-4 flex-wrap">
          {/* Left Controls: Search, Filters, Sorting, View modes */}
          <div className="flex items-center gap-3 flex-wrap min-w-0 flex-1">
            {controlsLeft}
          </div>
          
          {/* Right Controls: Secondary Actions, Bulk Operations */}
          {controlsRight && (
            <div className="flex items-center gap-2 flex-shrink-0">
              {controlsRight}
            </div>
          )}
        </div>
      )}
    </div>
  );
}