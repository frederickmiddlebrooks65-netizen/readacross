import type { TextLine } from "./pdfLayoutExtractor.js";

// Types that are NOT prose and should never participate in sentence continuation
export const NON_PROSE_TYPES = [
  "footnote",
  "doi",
  "journal",
  "author",
  "affiliation",
  "header",
  "footer",
  "abstract_label",
  "reference_block",
  "heading",
  "document_title",
];

// Minimal abbreviation protection for layout-stage sentence boundary decisions.
// Canonical sentence splitting still lives in textUtils.ts; this is just to prevent
// obvious false sentence terminators from breaking layout/paragraph logic.
export const COMMON_ABBREVIATIONS =
  /\b(i\.e\.|e\.g\.|etc\.|et\s+al\.|ibid\.|vs\.|vol\.|fig\.|dr\.|mr\.|ms\.|prof\.)\s*$/i;

// Extended sentence terminator: allows trailing quotes/brackets/paren and footnote markers.
// Examples: "...end."  "...end.)"  "...end.]"  "...end.""  "...end.1"
export const SENTENCE_TERMINATOR_EXTENDED =
  /[.!?]["'\u201D\u2019\]\)]*\s*(?:\d+|[\*\u2020\u2021\u00A7\u00B6])?\s*$/;

export function isSentenceContinuation(
  prev: TextLine,
  next: TextLine,
  prevType?: string,
  nextType?: string,
): boolean {
  if (!prev || !next) return false;

  // RULE 0: Non-prose types NEVER participate.
  if (prevType && NON_PROSE_TYPES.includes(prevType)) return false;
  if (nextType && NON_PROSE_TYPES.includes(nextType)) return false;

  const prevText = prev.text.trim();
  const nextText = next.text.trim();
  if (!prevText || !nextText) return false;

  // Strong continuation signal: hyphenated word break.
  if (/-\s*$/.test(prevText)) return true;

  // RULE 1: Sentence terminator = absolute end (unless it is a protected abbreviation).
  // Use extended terminator handling: quotes/brackets/paren/footnote markers.
  const looksTerminated = SENTENCE_TERMINATOR_EXTENDED.test(prevText);
  const isAbbrevEnd = COMMON_ABBREVIATIONS.test(prevText);
  if (looksTerminated && !isAbbrevEnd) return false;

  // If previous line ends with explicit non-terminal punctuation, it likely continues.
  if (/[,;:]\s*$/.test(prevText)) return true;

  // Hanging sentence check: do not continue if the previous line looks complete.
  const endsWithColonOrSemicolon = /[:;]\s*$/.test(prevText);
  const endsWithSentenceTerminator = looksTerminated && !isAbbrevEnd;
  const wordCount = prevText.split(/\s+/).filter((w) => w.length > 0).length;
  const hasUnclosedParen =
    (prevText.match(/\(/g)?.length || 0) >
      (prevText.match(/\)/g)?.length || 0) ||
    (prevText.match(/\[/g)?.length || 0) >
      (prevText.match(/\]/g)?.length || 0) ||
    (prevText.match(/\{/g)?.length || 0) >
      (prevText.match(/\}/g)?.length || 0);
  const doubleQuoteCount =
    (prevText.match(/["\u201C\u201D]/g)?.length || 0);
  const hasUnclosedQuote = doubleQuoteCount % 2 === 1;
  const isHangingSentence =
    !endsWithSentenceTerminator &&
    !endsWithColonOrSemicolon &&
    !hasUnclosedParen &&
    !hasUnclosedQuote &&
    wordCount >= 3;

  // Next line grammatical dependency signals.
  const startsLowercase = /^[a-z]/.test(nextText);
  const startsWithContinuationToken =
    /^(and|or|but|that|which|who|whom|whose|where|when|while|because|since|although|though|if|as|to|of|in|on|at|by|with|from|for|into|onto|upon|depending|including)\b/i.test(
      nextText,
    );
  const startsWithDigit = /^\d/.test(nextText);
  const startsWithInlineSymbol = /^[%$\(]/.test(nextText);
  const nextLooksLikeContinuation =
    startsLowercase ||
    startsWithContinuationToken ||
    startsWithDigit ||
    startsWithInlineSymbol;
  if (isHangingSentence && nextLooksLikeContinuation) return true;

  // Default policy: be conservative. If we don't have explicit evidence of continuation,
  // return false so layout/paragraph heuristics can decide.
  return false;
}
