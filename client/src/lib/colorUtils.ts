// Color utilities for WCAG AA compliant document cards
// Based on instructions.md specifications

export type Category = 'Academic' | 'Literature' | 'News' | 'Essays' | 'Opinion' | 'Other' | 'Upload';

// Brand blue unified color system - all categories use brand blue variants
// Deprecated: Legacy LIGHT_COLORS and DARK_COLORS removed per brand blue policy
// All category distinctions are now handled through typography and dot markers only

/**
 * Convert hex color to RGB values
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  };
}

/**
 * Calculate relative luminance of a color
 * Based on WCAG 2.1 specification
 */
function getRelativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

/**
 * Calculate contrast ratio between two colors
 * Returns a value between 1 and 21 (higher is better contrast)
 */
function contrastRatio(color1: string, color2: string): number {
  const rgb1 = hexToRgb(color1);
  const rgb2 = hexToRgb(color2);
  
  const lum1 = getRelativeLuminance(rgb1.r, rgb1.g, rgb1.b);
  const lum2 = getRelativeLuminance(rgb2.r, rgb2.g, rgb2.b);
  
  const lighter = Math.max(lum1, lum2);
  const darker = Math.min(lum1, lum2);
  
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Get optimal text color for WCAG AA compliance (≥4.5:1 contrast ratio)
 */
function getOptimalTextColor(bgColor: string): string {
  const contrast1 = contrastRatio(bgColor, '#111111');
  const contrast2 = contrastRatio(bgColor, '#FFFFFF');
  return contrast1 >= 4.5 ? '#111111' : '#FFFFFF';
}

/**
 * Get monotone card colors - all cards use neutral gray backgrounds
 * Category distinction removed for cleaner UI per Modern Zen aesthetic
 */
export function getCardColors(category: Category, isDark: boolean = false): { bg: string; text: string } {
  // Return monotone colors using CSS tokens
  return {
    bg: isDark ? "hsl(var(--base-muted))" : "hsl(var(--base-muted))",
    text: isDark ? "hsl(var(--base-fg))" : "hsl(var(--base-fg))"
  };
}

// Valid categories for the 4-category system
const VALID_CATEGORIES = ['Academic', 'Literature', 'News', 'Essays'] as const;

/**
 * Check if a value is a valid category
 */
function isValidCategory(value: any): value is Category {
  return VALID_CATEGORIES.includes(value);
}

/**
 * Determine category from document properties
 * Priority: Database category > Source-based detection > Default fallback
 * 
 * IMPORTANT: If a document has a valid category saved in the database,
 * it takes priority over source-based auto-detection. This ensures
 * manual user edits are preserved.
 */
export function determineCategory(document: any): Category {
  // Priority 1: Use saved database category if valid (manual override)
  if (document.category && isValidCategory(document.category)) {
    return document.category;
  }
  
  // Priority 2: Source-based auto-detection for new documents
  const source = document.source || document.sourceProvider || '';
  
  // Academic: 학술 논문, 학회 발표 자료, 리서치 리포트
  if (source === "arXiv" || source === "Nature" || source === "ScienceDirect") {
    return 'Academic';
  }
  
  // Literature: 문학 작품, 에세이, 비평, 서사적 글쓰기
  if (source === "Project Gutenberg") {
    return 'Literature';
  }
  
  // News: 뉴스 기사, 저널리즘 기반 콘텐츠
  if (source === "Reuters" || source === "BBC" || source === "WIRED" || source === "VOA Learning English") {
    return 'News';
  }
  
  // Essays: 블로그 글, 칼럼, 개인 저널, 오피니언 피스
  if (source === "Joe's Journal" || source === "Medium" || source === "Substack" || 
      document.sourceType === 'uploaded') {
    return 'Essays';
  }
  
  // Priority 3: Default fallback for OCR, uploads, and unknown sources
  return 'Essays';
}

/**
 * Check if current theme is dark mode
 */
export function isDarkMode(theme: string): boolean {
  if (theme === 'dark') return true;
  if (theme === 'system') {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

/**
 * Get all available categories (new 4-category system)
 */
export function getAllCategories(): Category[] {
  return ['Academic', 'Literature', 'News', 'Essays'];
}