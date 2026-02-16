import type { PDFStats, LineClassification, AcademicParsingProfile, AcademicParsingStrictness } from "./pdfTypes.js";
import type { TextLine } from "./pdfLayoutExtractor.js";
import { isSentenceContinuation, COMMON_ABBREVIATIONS, SENTENCE_TERMINATOR_EXTENDED, NON_PROSE_TYPES } from "./pdfGrammar.js";

// Paragraph break detection with enhanced signals
// parsingProfile: "journal" always breaks at page boundaries
//                 "essay_academic" allows continuation across pages with strong signals
// parsingStrictness: Controls threshold sensitivity for layout-based paragraph breaks
//                    "strict" = aggressive breaks (lower thresholds)
//                    "relaxed" = conservative breaks (higher thresholds)
export function shouldEndParagraphSimplified(
  currentLine: TextLine,
  nextLine: TextLine | undefined,
  currentClassification: LineClassification,
  nextClassification: LineClassification,
  stats: PDFStats,
  parsingProfile: AcademicParsingProfile = "journal",
  parsingStrictness: AcademicParsingStrictness = "relaxed",
): boolean {

  if (!nextLine) return true;

  const currentText = currentLine.text.trim();
  const nextText = nextLine.text.trim();

  const isStructuralBreak =
    nextClassification === "document_title" ||
    nextClassification === "abstract_label" ||
    nextClassification === "footnote" ||
    ["doi", "author", "journal", "affiliation"].includes(nextClassification);

  const xDiff = Math.abs(nextLine.xStart - currentLine.xStart);
  const yGap = nextLine.y - currentLine.y;

  const isStrict = parsingStrictness === "strict";
  const yGapThreshold = isStrict
    ? stats.medianLineHeight * 1.5
    : stats.medianLineHeight * 2.0;
  const xDiffThreshold = isStrict
    ? stats.medianBodyFont * 1.2
    : stats.medianBodyFont * 1.5;

  const strongLayoutBreak =
    yGap >= yGapThreshold ||
    xDiff >= xDiffThreshold;

  const looksLikeHeading =
    nextText.length > 0 &&
    nextText.length < 60 &&
    /^[A-Z]/.test(nextText) &&
    !/[.?!:;,]$/.test(nextText);

  // -----------------------------
  // JOURNAL PROFILE (layout-first)
  // -----------------------------
  if (parsingProfile === "journal") {

    if (isStructuralBreak) return true;

    if (currentLine.page !== nextLine.page) return true;

    if (strongLayoutBreak) return true;

    if (
      isSentenceContinuation(
        currentLine,
        nextLine,
        currentClassification,
        nextClassification,
      )
    ) {
      return false;
    }

    return false;
  }

  // ------------------------------------
  // ARXIV PROFILE (hybrid: layout with page-boundary tolerance)
  // ------------------------------------
  if (parsingProfile === "arxiv") {

    if (isStructuralBreak) return true;

    if (
      isSentenceContinuation(
        currentLine,
        nextLine,
        currentClassification,
        nextClassification,
      )
    ) {
      return false;
    }

    if (strongLayoutBreak) return true;

    // Visual paragraph boundary: sentence terminator + layout signal
    const endsWithTerminator = /[.?!)\]"'\u201D\u2019]\s*$/.test(currentText);
    if (endsWithTerminator) {
      const currentLineWidth = currentLine.xEnd - currentLine.xStart;
      const shortLine = stats.bodyMedianWidth > 0 && currentLineWidth / stats.bodyMedianWidth < 0.78;
      const nextIndent = nextLine.xStart - currentLine.xStart;
      const hasIndent = nextIndent >= stats.medianBodyFont * 0.8;
      if (shortLine || hasIndent) {
        return true;
      }
    }

    return false;
  }

  // ------------------------------------
  // ESSAY_ACADEMIC PROFILE (grammar-first)
  // ------------------------------------
  if (parsingProfile === "essay_academic") {

    if (isStructuralBreak) return true;

    if (
      isSentenceContinuation(
        currentLine,
        nextLine,
        currentClassification,
        nextClassification,
      )
    ) {
      return false;
    }

    if (looksLikeHeading) return true;

    if (strongLayoutBreak) return true;

    return false;
  }

  return false;
}
