import React from 'react';
import { NOTEBOOK_COLOR_KEYS } from '@/lib/colorPalette';
import { NotebookBadge } from '@/components/ui/NotebookBadge';
import { Check } from 'lucide-react';

interface ColorPickerProps {
  selectedColor?: string | null;
  onColorSelect: (color: string | null) => void;
  showClear?: boolean;
}

export default function ColorPicker({
  selectedColor,
  onColorSelect,
  showClear = true
}: ColorPickerProps) {

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Color options - now using monotone badges */}
      {NOTEBOOK_COLOR_KEYS.map((colorKey) => {
        const isSelected = selectedColor === colorKey;
        
        return (
          <button
            key={colorKey}
            type="button"
            onClick={() => {
              onColorSelect(colorKey as string);
            }}
            className={`transition-all duration-200 hover:scale-105 relative cursor-pointer rounded-md ${
              isSelected ? 'ring-2 ring-brand ring-offset-2' : ''
            }`}
          >
            <NotebookBadge 
              colorKey={colorKey} 
              className={isSelected ? 'bg-brand-subtle' : ''}
            />
            {isSelected && (
              <Check 
                className="w-3 h-3 absolute -top-1 -right-1 text-brand bg-white rounded-full p-0.5" 
              />
            )}
          </button>
        );
      })}
    </div>
  );
}