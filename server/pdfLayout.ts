import type { PDFStats } from "./pdfTypes.js";
import type { TextLine } from "./pdfLayoutExtractor.js";

// Safe hyphen merge patterns (3-5)
export const SAFE_HYPHEN_PREFIXES =
  /-(post|pre|non|anti|co|re|self|ex|sub|inter|intra|multi|semi|pseudo|quasi|meta|trans|cross|over|under|out|mid|neo|proto|para|hyper|ultra|super|micro|macro|bio|geo|eco|electro|neuro|cyber|techno|socio|psycho|physio)\s*$/i;

export function calculateStatsFromLines(
  lines: TextLine[],
  pageHeights: Record<number, number>,
): PDFStats {
  const fontSizes: number[] = [];
  const lineGaps: number[] = [];
  const lineWidths: number[] = [];
  const pageOccurrence = new Map<string, Set<number>>();
  const pageHeightsMap = new Map<number, number>(
    Object.entries(pageHeights).map(([k, v]) => [Number(k), v]),
  );

  for (const line of lines) {
    const pageHeight = pageHeightsMap.get(line.page) || 792;
    const yRatio = line.y / pageHeight;

    // Collect font stats from body area (middle 80%)
    if (yRatio > 0.1 && yRatio < 0.9) {
      fontSizes.push(line.fontHeight);
    }

    // Collect line widths with metadata for body-filtered ragged-right detection
    if (line.xEnd && line.xStart) {
      const width = line.xEnd - line.xStart;
      lineWidths.push(width);
    }

    // Normalize text for header/footer detection
    const normalized = line.text
      .trim()
      .toLowerCase()
      .replace(/\d+/g, "#")
      .replace(/\s+/g, " ");

    if (normalized.length > 5 && normalized.length < 80) {
      if (!pageOccurrence.has(normalized))
        pageOccurrence.set(normalized, new Set());
      pageOccurrence.get(normalized)!.add(line.page);
    }
  }

  // Calculate line gaps by page
  const linesByPage = new Map<number, TextLine[]>();
  for (const line of lines) {
    if (!linesByPage.has(line.page)) linesByPage.set(line.page, []);
    linesByPage.get(line.page)!.push(line);
  }

  Array.from(linesByPage.values()).forEach((pageLines: TextLine[]) => {
    pageLines.sort((a: TextLine, b: TextLine) => a.y - b.y);
    for (let i = 1; i < pageLines.length; i++) {
      const gap = pageLines[i].y - pageLines[i - 1].y;
      if (gap > 0 && gap < 50) {
        lineGaps.push(gap);
      }
    }
  });

  fontSizes.sort((a, b) => a - b);
  const medianBodyFont = fontSizes[Math.floor(fontSizes.length / 2)] || 12;

  lineGaps.sort((a, b) => a - b);
  let medianLineHeight = medianBodyFont * 1.2;
  if (lineGaps.length > 0) {
    medianLineHeight = lineGaps[Math.floor(lineGaps.length / 2)];
  }

  // Calculate maximum line width for ragged-right detection
  lineWidths.sort((a, b) => a - b);
  const maxLineWidth = lineWidths.length > 0 ? lineWidths[lineWidths.length - 1] : 500;

  // Calculate body-only median width for standalone paragraph detection
  // Exclude document_title (large font), header/footer (extreme yRatio) lines
  const bodyLineWidths: number[] = [];
  for (const line of lines) {
    if (!line.xEnd || !line.xStart) continue;
    const pageHeight = pageHeightsMap.get(line.page) || 792;
    const yRatio = line.y / pageHeight;
    if (yRatio <= 0.1 || yRatio >= 0.9) continue;
    if (line.fontHeight > medianBodyFont * 1.3) continue;
    const width = line.xEnd - line.xStart;
    if (width > 0) bodyLineWidths.push(width);
  }
  bodyLineWidths.sort((a, b) => a - b);
  const bodyMedianWidth = bodyLineWidths.length > 0
    ? bodyLineWidths[Math.floor(bodyLineWidths.length / 2)]
    : maxLineWidth;

  const headerFooterPatterns = new Set<string>();
  const totalPages = pageHeightsMap.size;
  Array.from(pageOccurrence.entries()).forEach(([text, pages]) => {
    if (pages.size >= Math.min(3, totalPages)) {
      headerFooterPatterns.add(text);
    }
  });

  // Phase 1: Calculate page 1 largest font for document_title detection
  // Title is typically: page 1, yRatio 0.07-0.35, largest font, not metadata
  let page1LargestFont = medianBodyFont;
  let page1TitleCandidateY = 0;
  const page1Height = pageHeightsMap.get(1) || 792;

  for (const line of lines) {
    if (line.page !== 1) continue;
    const yRatio = line.y / page1Height;

    // Title zone: after header (>0.07), before abstract area (<0.35)
    if (yRatio > 0.07 && yRatio < 0.35) {
      // Skip lines that look like metadata (DOI, journal, affiliation patterns)
      const text = line.text.trim();
      const looksLikeMetadata =
        /\b(doi|issn|volume|vol\.|arxiv|journal)\b/i.test(text) ||
        /^[1-9*†‡§¶]\s*[A-Z].*\b(university|institute|department)\b/i.test(
          text,
        );

      if (!looksLikeMetadata && line.fontHeight > page1LargestFont) {
        page1LargestFont = line.fontHeight;
        page1TitleCandidateY = line.y;
      }
    }
  }

  return {
    medianBodyFont,
    medianLineHeight,
    maxLineWidth,
    bodyMedianWidth,
    headerFooterPatterns,
    pageHeights: pageHeightsMap,
    page1LargestFont,
    page1TitleCandidateY,
  };
}

// Check if hyphen join is safe (3-5)
export function isSafeHyphenJoin(
  left: string,
  right: string,
  isHeading: boolean = false,
): boolean {
  const trimmedLeft = left.trimEnd();
  const trimmedRight = right.trimStart();

  if (!trimmedLeft.endsWith("-")) return false;

  // Always allow in heading merge context
  if (isHeading) return true;

  // Check for prefix-like patterns
  if (SAFE_HYPHEN_PREFIXES.test(trimmedLeft)) return true;

  // Check for letter before hyphen and right side starts with capital (title case word continuation)
  const letterBeforeHyphen = /[A-Za-z]-$/.test(trimmedLeft);
  const rightStartsCapital = /^[A-Z]/.test(trimmedRight);
  const rightIsShort = trimmedRight.split(/\s+/).length <= 2;

  if (letterBeforeHyphen && (rightStartsCapital || rightIsShort)) return true;

  return false;
}

// Common line text joiner - conditionally preserves hyphens at line breaks (3-5)
// "Post-" + "Humanism" → "Post-Humanism" (hyphen preserved for safe patterns)
export function mergeLineTexts(
  prev: string,
  next: string,
  isHeading: boolean = false,
): string {
  const left = prev.trimEnd();
  const right = next.trimStart();

  if (isSafeHyphenJoin(left, right, isHeading)) {
    return left + right; // Keep hyphen, remove line break only
  }
  return left + " " + right;
}

// Join multiple lines with safe hyphen preservation for paragraphs
export function joinLinesWithHyphenPreservation(lines: TextLine[]): string {
  if (lines.length === 0) return "";
  return lines
    .reduce((acc, line, i) => {
      if (i === 0) return line.text;
      return mergeLineTexts(acc, line.text, false); // Not heading context
    }, "")
    .trim();
}
