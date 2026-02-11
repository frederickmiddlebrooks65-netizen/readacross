import React from "react";
import { ViewMode } from "@/lib/types.d";
import { cn } from "@/lib/utils";

interface ViewModeSelectorProps {
  currentMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}

export default function ViewModeSelector({ currentMode, onChange }: ViewModeSelectorProps) {
  const viewModes = [
    { mode: "original-only" as ViewMode, label: "Original Only", icon: "" },
    { mode: "side-by-side" as ViewMode, label: "Side-by-Side", icon: "⚖️" },
    { mode: "translation-only" as ViewMode, label: "Translation Only", icon: "🌍" },
  ];

  return (
    <div className="bg-white shadow-sm border-t border-gray-200">
      <div className="max-w-reader mx-auto px-4 sm:px-6 lg:px-8">
        <div className="py-3">
          <div className="flex justify-center">
            <div className="inline-flex rounded-md shadow-sm" role="group">
              {viewModes.map((option, index) => {
                // Determine if this button is first or last for rounded corners
                const isFirst = index === 0;
                const isLast = index === viewModes.length - 1;
                
                // Button classes based on selection and position
                const buttonClasses = cn(
                  "px-4 py-2 text-sm font-medium",
                  currentMode === option.mode
                    ? "text-white dark:text-white bg-white dark:bg-gray-800 border-b-2 border-blue-400"
                    : "text-gray-400 bg-white dark:bg-gray-800 border-t border-b border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700",
                  isFirst && "rounded-l-lg border-l",
                  isLast && "rounded-r-lg border-r",
                  !isFirst && !isLast && "border-r",
                );

                return (
                  <button
                    key={option.mode}
                    type="button"
                    className={buttonClasses}
                    onClick={() => onChange(option.mode)}
                  >
                    <span className="mr-2">{option.icon}</span>
                    {option.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
