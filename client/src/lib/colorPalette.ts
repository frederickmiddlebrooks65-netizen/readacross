// Notebook color keys for monotone design system with dot markers
export const NOTEBOOK_COLOR_KEYS = ['white', 'blue', 'green', 'purple', 'orange', 'red', 'pink', 'indigo', 'teal'] as const;

export type NotebookColorKey = typeof NOTEBOOK_COLOR_KEYS[number];

// Get next available color (simple cycling for now, could be enhanced with usage tracking)
export const getNextAvailableColor = (existingColors: (string | null)[]): NotebookColorKey => {
  const usedColors = existingColors.filter(Boolean);
  console.log('getNextAvailableColor - existingColors:', existingColors);
  console.log('getNextAvailableColor - usedColors:', usedColors);
  
  // Find first unused color
  for (const color of NOTEBOOK_COLOR_KEYS) {
    if (!usedColors.includes(color)) {
      console.log('getNextAvailableColor - returning first unused color:', color);
      return color;
    }
  }
  
  // If all colors are used, cycle through them
  const cycledColor = NOTEBOOK_COLOR_KEYS[usedColors.length % NOTEBOOK_COLOR_KEYS.length];
  console.log('getNextAvailableColor - all colors used, cycling to:', cycledColor);
  return cycledColor;
};