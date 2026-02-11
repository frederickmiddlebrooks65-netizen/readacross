import { describe, it, expect, beforeAll } from "vitest";

interface TextLine {
  text: string;
  page: number;
  y: number;
  xStart: number;
  xEnd: number;
  fontHeight: number;
}

interface PDFStats {
  medianBodyFont: number;
  medianLineHeight: number;
  headerFooterPatterns: Set<string>;
  pageHeights: Map<number, number>;
}

function createMockStats(overrides: Partial<PDFStats> = {}): PDFStats {
  return {
    medianBodyFont: 12,
    medianLineHeight: 14.4,
    headerFooterPatterns: new Set(),
    pageHeights: new Map([[1, 792]]),
    ...overrides,
  };
}

function createMockLine(overrides: Partial<TextLine> = {}): TextLine {
  return {
    text: "Sample text",
    page: 1,
    y: 400,
    xStart: 72,
    xEnd: 500,
    fontHeight: 12,
    ...overrides,
  };
}

const SAFE_HYPHEN_PREFIXES = /-(post|pre|non|anti|co|re|self|ex|sub|inter|intra|multi|semi|pseudo|quasi|meta|trans|cross|over|under|out|mid|neo|proto|para|hyper|ultra|super|micro|macro|bio|geo|eco|electro|neuro|cyber|techno|socio|psycho|physio)\s*$/i;

function isSafeHyphenJoin(left: string, right: string, isHeading: boolean = false): boolean {
  const trimmedLeft = left.trimEnd();
  const trimmedRight = right.trimStart();
  
  if (!trimmedLeft.endsWith("-")) return false;
  if (isHeading) return true;
  if (SAFE_HYPHEN_PREFIXES.test(trimmedLeft)) return true;
  
  const letterBeforeHyphen = /[A-Za-z]-$/.test(trimmedLeft);
  const rightStartsCapital = /^[A-Z]/.test(trimmedRight);
  const rightIsShort = trimmedRight.split(/\s+/).length <= 2;
  
  if (letterBeforeHyphen && (rightStartsCapital || rightIsShort)) return true;
  
  return false;
}

function classifyLineForTest(
  line: TextLine,
  stats: PDFStats,
  prevLine?: TextLine
): "heading" | "header" | "footer" | "footnote" | "paragraph" {
  const text = line.text.trim();
  const normalized = text.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ");

  const pageHeight = stats.pageHeights.get(line.page) || 792;
  const yRatio = line.y / pageHeight;
  const isSmallFont = line.fontHeight <= stats.medianBodyFont * 0.95;
  const isNotLargeFont = line.fontHeight <= stats.medianBodyFont * 1.05;

  const isHeaderZone = yRatio < 0.07;
  const isFooterZone = yRatio > 0.90;
  const isHFZone = isHeaderZone || isFooterZone;

  const looksLikeMeta =
    /\b(doi|issn|volume|vol\.|no\.|pp\.|journal|arxiv|copyright|©)\b/i.test(text) ||
    /https?:\/\/|doi\.org|www\./i.test(text) ||
    /\.(com|org|edu|uk|net|co\.uk)\b/i.test(text);

  const looksLikePageMark =
    /^\d+$/.test(text) || (/\b\d{1,4}\b/.test(text) && text.length < 40);

  const hasHFPattern =
    /^(https?:\/\/|doi:|issn:|arxiv:|page\s*\d|©|copyright)/i.test(text) ||
    /^[ivxlcdm]+$/i.test(text);

  const looksLikeJournalMeta = /\b\d{4}\b/.test(text) && text.length < 60 && /[a-zA-Z]/.test(text);
  const isShortHFText = text.length < 80;

  if (isHFZone) {
    let hfSignals = 0;
    if (isSmallFont) hfSignals++;
    if (isShortHFText) hfSignals++;
    if (looksLikeMeta) hfSignals++;
    if (looksLikePageMark) hfSignals++;
    if (hasHFPattern) hfSignals++;
    if (looksLikeJournalMeta) hfSignals++;

    if (stats.headerFooterPatterns.has(normalized)) {
      const isRunningHeaderException = 
        isHeaderZone && 
        text.length >= 35 && 
        text.length <= 120 && 
        !/\d+\s*$/.test(text) && 
        line.fontHeight >= stats.medianBodyFont * 0.95;
      
      if (!isRunningHeaderException) {
        return isHeaderZone ? "header" : "footer";
      }
    }

    if (hfSignals >= 2 && isNotLargeFont) {
      return isHeaderZone ? "header" : "footer";
    }

    if ((hasHFPattern || looksLikeMeta) && isNotLargeFont && isShortHFText) {
      return isHeaderZone ? "header" : "footer";
    }
  }

  const hasSectionKeyword =
    /^(abstract|introduction|conclusion|method|methodology|methods|results?|discussion|references?|bibliography|acknowledgments?|appendix|related work|background|overview|summary)$/i.test(text);

  if (hasSectionKeyword && text.length <= 40 && line.fontHeight >= stats.medianBodyFont) {
    return "heading";
  }

  const hasNumberedSection = /^(\d+\.|\d+\.\d+\.?)\s+[A-Z]/.test(text);
  const hasLargeFont = line.fontHeight > stats.medianBodyFont * 1.25;

  if (hasNumberedSection || hasLargeFont) {
    if (text.length < 100) return "heading";
  }

  return "paragraph";
}

describe("PDF Utils - Header/Footer Detection", () => {
  it("should classify DOI in footer zone as footer", () => {
    const stats = createMockStats();
    const line = createMockLine({
      text: "doi:10.1234/example.2024",
      y: 750, // yRatio > 0.90
      fontHeight: 10,
    });
    
    const result = classifyLineForTest(line, stats);
    expect(result).toBe("footer");
  });

  it("should classify page number in footer zone as footer", () => {
    const stats = createMockStats();
    const line = createMockLine({
      text: "1441",
      y: 760,
      fontHeight: 10,
    });
    
    const result = classifyLineForTest(line, stats);
    expect(result).toBe("footer");
  });

  it("should classify journal metadata in footer zone as footer", () => {
    const stats = createMockStats();
    const line = createMockLine({
      text: "Journal of Example Studies Vol. 12, pp. 100-120",
      y: 755,
      fontHeight: 10,
    });
    
    const result = classifyLineForTest(line, stats);
    expect(result).toBe("footer");
  });

  it("should classify URL in header zone as header", () => {
    const stats = createMockStats();
    const line = createMockLine({
      text: "https://example.com/paper",
      y: 40, // yRatio < 0.07
      fontHeight: 10,
    });
    
    const result = classifyLineForTest(line, stats);
    expect(result).toBe("header");
  });

  it("should NOT classify large font title in header zone as header", () => {
    const stats = createMockStats();
    const line = createMockLine({
      text: "The Impact of Technology on Society",
      y: 45,
      fontHeight: 18, // Large font
    });
    
    const result = classifyLineForTest(line, stats);
    expect(result).not.toBe("header");
  });
});

describe("PDF Utils - Heading Detection", () => {
  it("should classify 'Introduction' as heading", () => {
    const stats = createMockStats();
    const line = createMockLine({
      text: "Introduction",
      fontHeight: 12,
    });
    
    const result = classifyLineForTest(line, stats);
    expect(result).toBe("heading");
  });

  it("should classify 'Abstract' as heading", () => {
    const stats = createMockStats();
    const line = createMockLine({
      text: "Abstract",
      fontHeight: 12,
    });
    
    const result = classifyLineForTest(line, stats);
    expect(result).toBe("heading");
  });

  it("should classify numbered section as heading", () => {
    const stats = createMockStats();
    const line = createMockLine({
      text: "2.1. Methodology and Approach",
      fontHeight: 12,
    });
    
    const result = classifyLineForTest(line, stats);
    expect(result).toBe("heading");
  });

  it("should classify large font short text as heading", () => {
    const stats = createMockStats();
    const line = createMockLine({
      text: "Results and Discussion",
      fontHeight: 16, // > 12 * 1.25
    });
    
    const result = classifyLineForTest(line, stats);
    expect(result).toBe("heading");
  });
});

describe("PDF Utils - Hyphen Join Safety", () => {
  it("should allow hyphen join in heading context", () => {
    expect(isSafeHyphenJoin("Post-", "Humanism", true)).toBe(true);
    expect(isSafeHyphenJoin("Twenty-", "First Century", true)).toBe(true);
  });

  it("should allow safe prefix patterns", () => {
    expect(isSafeHyphenJoin("Post-", "Humanism", false)).toBe(true);
    expect(isSafeHyphenJoin("Pre-", "existing", false)).toBe(true);
    expect(isSafeHyphenJoin("Non-", "linear", false)).toBe(true);
    expect(isSafeHyphenJoin("Anti-", "viral", false)).toBe(true);
  });

  it("should allow title case continuation", () => {
    expect(isSafeHyphenJoin("Twenty-", "First", false)).toBe(true);
    expect(isSafeHyphenJoin("Cross-", "Cultural", false)).toBe(true);
  });

  it("should not join arbitrary hyphens in paragraph context", () => {
    expect(isSafeHyphenJoin("some-", "thing", false)).toBe(true); // short right side
    expect(isSafeHyphenJoin("exam-", "ple word continuation", false)).toBe(false);
  });

  it("should return false when no hyphen at end", () => {
    expect(isSafeHyphenJoin("word", "next", false)).toBe(false);
    expect(isSafeHyphenJoin("word", "next", true)).toBe(false);
  });
});

describe("PDF Utils - Block Separation", () => {
  it("heading should NOT be merged with following paragraph text", () => {
    const stats = createMockStats();
    
    const abstractLine = createMockLine({
      text: "Abstract",
      y: 100,
      fontHeight: 14,
    });
    
    const bodyLine = createMockLine({
      text: "This paper presents a novel approach to understanding...",
      y: 120,
      fontHeight: 12,
    });
    
    const abstractType = classifyLineForTest(abstractLine, stats);
    const bodyType = classifyLineForTest(bodyLine, stats, abstractLine);
    
    expect(abstractType).toBe("heading");
    expect(bodyType).toBe("paragraph");
  });
});
