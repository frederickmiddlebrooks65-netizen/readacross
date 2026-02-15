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
  // 1) Sentence continuation check (early return false)
  if (
    nextLine &&
    isSentenceContinuation(
      currentLine,
      nextLine,
      currentClassification,
      nextClassification,
    )
  ) {
    // Debug: Log sentence continuation merging
    if (currentLine.page !== nextLine.page) {
      console.log(
        `[SENTENCE_CONTINUATION] MERGE across page ${currentLine.page}->${nextLine.page}: "${currentLine.text.trim().substring(currentLine.text.trim().length - 30)}" -> "${nextLine.text.trim().substring(0, 30)}..."`,
      );
    }
    return false;
  }

  // Debug: Log specific cases to trace page boundary issue
  const curTextLower = currentLine.text.trim().toLowerCase();
  const nextTextLower = nextLine?.text.trim().toLowerCase() || "";
  if (
    curTextLower.includes("nuance") ||
    nextTextLower.includes("are preserved")
  ) {
    console.log(
      `[DEBUG_SPECIFIC] curPage=${currentLine.page}, nextPage=${nextLine?.page}, curText="${currentLine.text.substring(0, 50)}...", nextText="${nextLine?.text.substring(0, 50) || ""}..."`,
    );
  }

  // 2) Page boundary check
  if (!nextLine) {
    const currentText = currentLine.text.trim();
    const endsWithSentenceEnd =
      SENTENCE_TERMINATOR_EXTENDED.test(currentText) &&
      !COMMON_ABBREVIATIONS.test(currentText);
    const endsWithColonOrSemicolon = /[:;]\s*$/.test(currentText);
    const wordCount = currentText
      .split(/\s+/)
      .filter((w) => w.length > 0).length;
    const hasUnclosedParen =
      (currentText.match(/\(/g)?.length || 0) >
        (currentText.match(/\)/g)?.length || 0) ||
      (currentText.match(/\[/g)?.length || 0) >
        (currentText.match(/\]/g)?.length || 0) ||
      (currentText.match(/\{/g)?.length || 0) >
        (currentText.match(/\}/g)?.length || 0);
    const doubleQuoteCount =
      (currentText.match(/["\u201C\u201D]/g)?.length || 0);
    const hasUnclosedQuote = doubleQuoteCount % 2 === 1;
    const isNonProseCurrent =
      NON_PROSE_TYPES.includes(currentClassification) ||
      currentClassification === "heading" ||
      currentClassification === "document_title";
    const isHangingSentence =
      !isNonProseCurrent &&
      !endsWithSentenceEnd &&
      !endsWithColonOrSemicolon &&
      !hasUnclosedParen &&
      !hasUnclosedQuote &&
      wordCount >= 3;

    // IMPORTANT:
    // Colon handling must NEVER merge already-finalized sentences.
    // Sentence splitting is strictly left-to-right and irreversible.
    // If we lack a next prose line but current line is hanging, merge conservatively.
    if (isHangingSentence) return false;
    return true;
  }
  if (currentLine.page !== nextLine.page) {
    const curText = currentLine.text.trim();
    const nxtText = nextLine.text.trim();

    if (/-\s*$/.test(curText)) {
      console.log(
        `[PAGE_BOUNDARY_HYPHEN] Hyphenated word at page ${currentLine.page}->${nextLine.page} -> CONTINUE`,
      );
      return false;
    }

    const currentType = currentClassification;
    const nextType = nextClassification;
    if (isSentenceContinuation(currentLine, nextLine, currentType, nextType)) {
      console.log(
        `[PAGE_BOUNDARY_SENTENCE_CONT] Sentence continues at page ${currentLine.page}->${nextLine.page}: "${curText.substring(Math.max(0, curText.length - 40))}" -> "${nxtText.substring(0, 40)}" -> CONTINUE`,
      );
      return false;
    }

    const pageBoundaryYGap = nextLine.y - currentLine.y;
    const pageBoundaryXDiff = Math.abs(nextLine.xStart - currentLine.xStart);
    if (pageBoundaryYGap >= stats.medianLineHeight * 2.0) {
      console.log(
        `[PAGE_BOUNDARY_LAYOUT_BREAK] yGap=${pageBoundaryYGap.toFixed(1)} at page ${currentLine.page}->${nextLine.page} -> BREAK`,
      );
      return true;
    }
    if (pageBoundaryXDiff >= stats.medianBodyFont * 1.5) {
      console.log(
        `[PAGE_BOUNDARY_LAYOUT_BREAK] xDiff=${pageBoundaryXDiff.toFixed(1)} at page ${currentLine.page}->${nextLine.page} -> BREAK`,
      );
      return true;
    }

    console.log(
      `[PAGE_BOUNDARY_NO_BREAK] No strong signal at page ${currentLine.page}->${nextLine.page} -> letting layout rules decide -> NO BREAK`,
    );
  }

  // 3) Structural/metadata break checks
  if (nextClassification === "document_title") return true;
  if (nextClassification === "abstract_label") return true;
  if (nextClassification === "footnote") return true;
  if (["doi", "author", "journal", "affiliation"].includes(nextClassification))
    return true;

  // 4) Sentence termination gate
  const currentText = currentLine.text.trim();
  const nextText = nextLine.text.trim();
  const endsWithSentenceEnd =
    SENTENCE_TERMINATOR_EXTENDED.test(currentText) &&
    !COMMON_ABBREVIATIONS.test(currentText);
  if (!endsWithSentenceEnd) return false;
  if (/:\s*$/.test(currentText)) return false;
  if (/^[a-z(]/.test(nextText)) return false;
  // List continuation protection
  if (/^[•\-\*]/.test(currentText) || /^[•\-\*]/.test(nextText)) return false;
  if (/[,;]\s*$/.test(currentText)) return false;
  if (/\band\s*$/.test(currentText.toLowerCase())) return false;

  // 5) Heading candidate detection (content-based, before layout checks)
  // Short noun phrases without terminal punctuation that start with uppercase
  // are likely section headings — force break even when yGap < threshold
  // Safety: requires yGap > 1.2x median to avoid false positives on normal body lines
  const nextWords = nextText.split(/\s+/);
  const preLayoutYGap = nextLine.y - currentLine.y;
  const mildGapPresent = preLayoutYGap > stats.medianLineHeight * 1.2;
  const looksLikeHeading =
    mildGapPresent &&
    nextText.length > 0 &&
    nextText.length < 60 &&
    nextWords.length <= 7 &&
    /^[A-Z]/.test(nextText) &&
    !/[.?!:;,]$/.test(nextText) &&
    !/^\d+\.?\s/.test(nextText) &&
    !/^(The|A|An|In|On|At|For|With|By|To|From|And|But|Or|If|As|It|This|That|These|Those|However|Therefore|Moreover|Furthermore|Nevertheless|Although|While|Since|Because|After|Before|During|Between|Through|Within|Without|Against|Among|Beyond|Despite|Regarding|Including|According)\s/i.test(nextText);

  if (looksLikeHeading) {
    console.log(
      `[HEADING_CANDIDATE_BREAK] next="${nextText}" (${nextText.length} chars, ${nextWords.length} words, yGap=${preLayoutYGap.toFixed(1)}) -> FORCED BREAK`,
    );
    return true;
  }

  // 6) Layout-only checks (yGap, xDiff)
  const xDiff = Math.abs(nextLine.xStart - currentLine.xStart);
  const yGap = nextLine.y - currentLine.y;
  const isStrict = parsingStrictness === "strict";
  const yGapThreshold = isStrict
    ? stats.medianLineHeight * 1.5
    : stats.medianLineHeight * 2.0;
  const xDiffThreshold = isStrict
    ? stats.medianBodyFont * 1.2
    : stats.medianBodyFont * 1.5;
  const debugInfo = `xDiff=${xDiff.toFixed(1)}, yGap=${yGap.toFixed(1)}, yThreshold=${yGapThreshold.toFixed(1)} (${parsingStrictness}), xThreshold=${xDiffThreshold.toFixed(1)} (${parsingStrictness})`;
  console.log(
    `[PARA_CHECK] cur="${currentText.substring(0, 35)}..." | next="${nextText.substring(0, 35)}..." | ${debugInfo}`,
  );

  // Enhanced y-gap standalone separation (strictness-controlled threshold)
  if (yGap >= yGapThreshold) {
    const nextIsShort = nextText.length < 60;
    const nextHasLargerFont =
      nextLine.fontHeight >= stats.medianBodyFont * 1.05;
    const hasXStartChange = xDiff > stats.medianBodyFont * 1.5;
    if (nextIsShort || nextHasLargerFont || hasXStartChange) {
      console.log(
        `[PARA_BREAK] yGap=${yGap.toFixed(1)} >= ${yGapThreshold.toFixed(1)} (${parsingStrictness}) with secondary signal -> BREAK`,
      );
      return true;
    }
  }
  if (yGap >= yGapThreshold) {
    console.log(
      `[PARA_BREAK] yGap=${yGap.toFixed(1)} >= ${yGapThreshold.toFixed(1)} (${parsingStrictness}) -> BREAK`,
    );
    return true;
  }
  if (xDiff >= xDiffThreshold) {
    console.log(
      `[PARA_BREAK] xDiff=${xDiff.toFixed(1)} >= ${xDiffThreshold.toFixed(1)} (${parsingStrictness}) -> BREAK`,
    );
    return true;
  }
  return false;
}
