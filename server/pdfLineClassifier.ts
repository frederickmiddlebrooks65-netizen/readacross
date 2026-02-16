import type { PDFStats, LineClassification, AcademicParsingStrictness, AcademicParsingProfile } from "./pdfTypes.js";
import type { TextLine } from "./pdfLayoutExtractor.js";
import { isReferencesHeading } from "./pdfTypes.js";

// ============================================================
// STATEFUL AUTHOR/AFFILIATION FIXUP
// ============================================================
// Runs AFTER classifyLineSimplified to fix author lines that were
// misclassified as heading/paragraph because the stateless classifier
// only recognizes the first few author lines by pattern.
//
// Logic: On page 1, once the first "author" classification is found,
// subsequent lines matching author/affiliation patterns are reclassified
// as "author" or "affiliation" until a body-start marker is encountered
// (Abstract, Introduction, CCS Concepts, etc.)
// ============================================================
export function fixupAuthorClassifications(
  lines: TextLine[],
  classifications: LineClassification[],
  parsingProfile: AcademicParsingProfile = "journal",
): LineClassification[] {
  if (parsingProfile !== "arxiv" && parsingProfile !== "journal") return classifications;

  const result = [...classifications];
  let inAuthorZone = false;
  let foundFirstAuthor = false;

  const bodyStartMarkers = /^(abstract|introduction|ccs concepts|acm reference|keywords?|1\.?\s+introduction|overview|background|summary|preamble)/i;
  const authorLikePattern = /^[A-Z][A-Za-zÀ-ÿ\-']+(\s+[A-Z][A-Za-zÀ-ÿ\-']+)+\s*[,*†‡§¶\d]*\s*(,|$)/;
  const nameWithAffiliation = /,\s*(University|Institute|Department|College|School|Center|Centre|Laboratory|Lab|Georgia|Princeton|Emory|Cornell|Johns Hopkins|Stanford|MIT|Harvard|Oxford|Cambridge|Berkeley)\b/i;
  const countryPattern = /\b(USA|UK|Germany|France|Japan|China|Canada|Australia|India|Brazil|Italy|Spain|Netherlands|Switzerland|Sweden|Norway|Denmark|Finland|Austria|Belgium|Israel|South Korea|Singapore|Taiwan|Hong Kong|New Zealand)\s*$/i;
  const emailPattern = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/;
  const orcidPattern = /orcid|0000-000[0-3]-\d{4}-\d{3}[\dX]/i;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.page !== 1) break;

    const text = line.text.trim();

    if (bodyStartMarkers.test(text)) {
      inAuthorZone = false;
      break;
    }

    if (result[i] === "author") {
      foundFirstAuthor = true;
      inAuthorZone = true;
      continue;
    }

    if (!foundFirstAuthor) continue;
    if (!inAuthorZone) continue;

    if (result[i] === "document_title" || result[i] === "doi" || result[i] === "abstract_label") continue;

    const isAuthorLike =
      authorLikePattern.test(text) ||
      nameWithAffiliation.test(text) ||
      countryPattern.test(text) ||
      emailPattern.test(text) ||
      orcidPattern.test(text);

    const isAffiliationLike =
      /\b(University|Institute|Department|College|School|Center|Centre|Laboratory|Lab)\b/i.test(text) ||
      /^[1-9*†‡§¶]\s*[A-Z]/.test(text) && /\b(University|Institute|Department)\b/i.test(text);

    if (isAffiliationLike) {
      result[i] = "affiliation";
    } else if (isAuthorLike) {
      result[i] = "author";
    } else if (text.length < 60 && !text.endsWith('.') && /^[A-Z]/.test(text) && /,/.test(text)) {
      result[i] = "author";
    }
  }

  return result;
}

// ============================================================
// DEFINITE HEADING DETECTION
// ============================================================
// Runs BEFORE paragraph merge to identify standalone headings.
// These headings are "definite" - they cannot be absorbed into paragraphs
// regardless of sentence continuation status.
// Two categories:
// 1. ALL CAPS headings: "CONCLUSIONS", "REFERENCES", "ABSTRACT"
// 2. References section headings: "Works Cited", "Bibliography", "Reference List"
// ============================================================
export function isDefiniteHeading(line: TextLine, prevLine?: TextLine): boolean {
  const text = line.text.trim();
  const words = text.split(/\s+/);

  // Skip if too long or too short
  if (words.length < 1 || words.length > 6) return false;
  if (text.length > 60) return false;

  // No sentence-ending punctuation (but allow colon)
  if (/[.!?]\s*$/.test(text)) return false;

  // Skip pure numbers or single letters
  if (/^\d+$/.test(text)) return false;
  if (words.length === 1 && text.length <= 3) return false;

  // Skip if previous line ends with comma/incomplete (sentence continuation)
  if (prevLine) {
    const prevText = prevLine.text.trim();
    if (/[,;]\s*$/.test(prevText)) return false;
    const noTerminator = !/[.!?:]["'\u201D\u2019]?\s*$/.test(prevText);
    if (noTerminator && /^[a-z]/.test(text.toLowerCase().charAt(0)))
      return false;
  }

  // Category 1: ALL CAPS headings (CONCLUSIONS, REFERENCES, ABSTRACT, etc.)
  const isAllCaps = text === text.toUpperCase() && /[A-Z]/.test(text);
  if (isAllCaps && words.length >= 1) {
    return true;
  }

  // Category 2: References section headings (Title Case)
  // These MUST be detected as headings to trigger inReferencesSection
  if (isReferencesHeading(text)) {
    return true;
  }

  return false;
}


// Enhanced heading detection with metadata block separation per instructions.md
// Critical: DOI, author, journal, affiliation are detected BEFORE semantic unit creation
// parsingProfile: "journal" applies STEM assumptions, "essay_academic" disables them
// NOTE: Strictness does NOT affect line classification (only profile does)
export function classifyLineSimplified(
  line: TextLine,
  stats: PDFStats,
  prevLine?: TextLine,
  parsingStrictness: AcademicParsingStrictness = "relaxed",
  parsingProfile: AcademicParsingProfile = "journal",
): LineClassification {
  // Note: parsingStrictness is accepted for API compatibility but only parsingProfile is used for classification
  const isEssayAcademic = parsingProfile === "essay_academic";
  const text = line.text.trim();
  const normalized = text
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ");

  const pageHeight = stats.pageHeights.get(line.page) || 792;
  const yRatio = line.y / pageHeight;
  const isSmallFont = line.fontHeight <= stats.medianBodyFont * 0.95;
  const isNotLargeFont = line.fontHeight <= stats.medianBodyFont * 1.05;

  // === METADATA BLOCK DETECTION (per instructions.md section 4.3) ===
  // These MUST be detected and isolated BEFORE semantic unit creation

  // DOI detection - high priority, very specific pattern
  const isDOI =
    /\b(doi|DOI)\s*[:.]?\s*10\.\d{4,}/i.test(text) ||
    /^10\.\d{4,}\//.test(text) ||
    /https?:\/\/doi\.org/i.test(text) ||
    /^DOI\s*[:.]?\s*/i.test(text);

  if (isDOI) {
    return "doi";
  }

  // ⭐️ ISSN / URL gray-zone handling for essay_academic profile
  // When parsingProfile is 'essay_academic', treat lines containing ISSN or URLs
  // as regular paragraph content to avoid them being misclassified as header/footer/journal metadata.
  if (
    parsingProfile === "essay_academic" &&
    /\bISSN\b|www\.|https?:\/\//i.test(text)
  ) {
    return "paragraph";
  }

  // === DOCUMENT TITLE DETECTION (Phase 1) ===
  // Criteria: page 1, title zone (yRatio 0.07-0.35), largest font on page 1
  // Must come AFTER journal/doi metadata zone, BEFORE author/affiliation
  // Exception: header/footer rules don't apply to title (font is larger)
  const isTitleZone = line.page === 1 && yRatio > 0.07 && yRatio < 0.35;
  const isLargestFont = line.fontHeight >= stats.page1LargestFont * 0.95; // Within 5% of largest
  const isSignificantlyLarger = line.fontHeight >= stats.medianBodyFont * 1.3;
  // Relaxed font conditions: within 15% of largest OR >= 1.2x median
  const isLargeFontRelaxed =
    line.fontHeight >= stats.page1LargestFont * 0.85 ||
    line.fontHeight >= stats.medianBodyFont * 1.2;

  // Debug logging for document_title detection
  if (line.page === 1 && yRatio > 0.05 && yRatio < 0.4) {
    console.log(
      `[TITLE_DEBUG] Line: "${text.substring(0, 50)}..." | font: ${line.fontHeight.toFixed(1)} | largest: ${stats.page1LargestFont.toFixed(1)} | median: ${stats.medianBodyFont.toFixed(1)} | yRatio: ${yRatio.toFixed(3)} | isTitleZone: ${isTitleZone} | isLargestFont: ${isLargestFont} | isSignificantlyLarger: ${isSignificantlyLarger}`,
    );
  }

  // Exclude lines that look like metadata
  const looksLikeMetadataTitle =
    /\b(doi|issn|volume|vol\.|arxiv|journal|proceedings)\b/i.test(text) ||
    /^[1-9*†‡§¶]\s*[A-Z]/.test(text);

  // Primary detection: strict font criteria
  if (
    isTitleZone &&
    isLargestFont &&
    isSignificantlyLarger &&
    text.length >= 10 &&
    !looksLikeMetadataTitle
  ) {
    console.log(
      `[TITLE_DEBUG] ✅ Classified as document_title (primary): "${text.substring(0, 60)}"`,
    );
    return "document_title";
  }

  // Fallback detection: Title Case pattern with relaxed font + long text + no metadata
  // This catches titles that don't have the largest font but are clearly titles by content pattern
  const looksLikeTitleByPattern =
    isTitleZone &&
    isLargeFontRelaxed &&
    text.length >= 20 &&
    !looksLikeMetadataTitle &&
    // Title Case: most words start with uppercase
    text.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).length /
      text.split(/\s+/).length >
      0.6 &&
    // Has prepositions/articles common in academic titles
    /\b(of|in|the|for|and|with|to|on)\b/i.test(text) &&
    // Not ending with common sentence punctuation (titles often don't end with period)
    !text.endsWith(".");

  if (looksLikeTitleByPattern) {
    console.log(
      `[TITLE_DEBUG] ✅ Classified as document_title (fallback pattern): "${text.substring(0, 60)}"`,
    );
    return "document_title";
  }

  // Journal/Volume/Issue metadata - typically in first page header zone
  // NOTE: "issue" and "no" require adjacent numbers to avoid false positives
  // on body text like "social issue" or "no evidence"
  const isJournalMeta =
    (/\b(volume|vol\.?|pp\.?|pages)\b/i.test(text) &&
      text.length < 100) ||
    (/\bissue\s*#?\s*\d/i.test(text) && text.length < 100) ||
    (/\bno\.\s*\d/i.test(text) && text.length < 100) ||
    (/\b(journal|proceedings|transactions|letters|review)\b/i.test(text) &&
      /\b\d{4}\b/.test(text) &&
      text.length < 120) ||
    /\bISSN\b/i.test(text) ||
    /\barXiv:\d+\.\d+/i.test(text);

  if (isJournalMeta && (yRatio < 0.15 || isSmallFont)) {
    return "journal";
  }

  // === Academic Mode: Enhanced Metadata Detection (Profile-based only) ===
  // Keywords line - treat as journal metadata (non-translatable)
  // Pattern: "Keywords:" or "Key words:" followed by terms
  const isKeywordsLine =
    /^keywords?\s*[:.]?\s*/i.test(text) && text.length < 300;
  if (isKeywordsLine && yRatio < 0.4) {
    return "journal"; // Reuse journal type for keywords
  }

  // Received/Accepted/Published date patterns - journal metadata
  // Pattern: "Received: 1 Jan 2024" or "Accepted 5 February 2024"
  const isDateMeta =
    /\b(received|accepted|published|revised|submitted)\s*[:.]?\s*\d{1,2}/i.test(
      text,
    ) && text.length < 150;
  if (isDateMeta && (yRatio < 0.2 || yRatio > 0.85)) {
    return "journal";
  }

  // Copyright/License notices - journal metadata
  const isCopyrightMeta =
    /\b(copyright|©|creative commons|open access|license)\b/i.test(text) &&
    text.length < 200;
  if (isCopyrightMeta && (yRatio < 0.15 || yRatio > 0.8)) {
    return "journal";
  }

  // Affiliation detection - institutional affiliations with specific patterns
  // Typically: "Department of X, University of Y" or "1 Institute of Z"
  const isAffiliation =
    (/^[1-9*†‡§¶]\s*[A-Z]/.test(text) &&
      /\b(university|institute|department|college|school|center|centre|laboratory|lab)\b/i.test(
        text,
      )) ||
    (/^\d\s+[A-Z]/.test(text) &&
      text.length < 150 &&
      /\b(university|institute|department)\b/i.test(text));

  if (isAffiliation && yRatio < 0.25) {
    return "affiliation";
  }

  // Author detection - names in specific patterns (first page, before abstract)
  // Common patterns: "First Last, First Last" or "First Last1, First Last2" with superscripts
  // IMPORTANT: Exclude lines that look like document titles (long sentences with prepositions)
  const looksLikeTitleNotAuthor =
    /\b(of|in|the|for|and|with|from|to|on|at|by)\b/i.test(text) && // Has prepositions common in titles
    text.split(/\s+/).length > 6 && // More than 6 words (titles are usually longer than author lists)
    !text.includes(","); // No commas (author lists typically have commas)

  const isAuthorLine =
    !looksLikeTitleNotAuthor &&
    ((/^[A-Z][a-z]+\s+[A-Z][a-z]+(\s*[,\s]+\s*[A-Z][a-z]+\s+[A-Z][a-z]+)+/i.test(
      text,
    ) &&
      text.length < 200 &&
      yRatio < 0.2) ||
      (/\b(and|&)\b/.test(text) &&
        /^[A-Z][a-z]+/.test(text) &&
        !/\b(the|that|this|which|where|when|with|from|into|onto|upon|about)\b/i.test(
          text,
        ) &&
        text.length < 150 &&
        yRatio < 0.2));

  if (isAuthorLine && line.page === 1) {
    return "author";
  }

  // === Enhanced Header/Footer Detection (3-1) ===
  // essay_academic profile: HARD KILL strategy - aggressive pattern-based removal
  // Priority: Remove headers/footers FIRST, then be conservative about headings
  // journal profile: original aggressive removal

  if (isEssayAcademic) {
    // Essay-academic: HARD KILL - aggressive H/F removal at LINE level
    // "Remove headers/footers first, be conservative about headings later"
    const isHeaderZone = yRatio < 0.1; // Top 10%
    const isFooterZone = yRatio > 0.9; // Bottom 10%
    const isHFZone = isHeaderZone || isFooterZone;

    if (isHFZone) {
      // Hard Kill patterns - ANY of these = immediate removal
      const isPurePageNumber = /^\d+$/.test(text); // "93"
      const isShortText = text.length < 40;
      const isAuthorNamePattern =
        /^[A-Z][a-zа-я]*\s+[A-ZĂÎȘȚÂ][A-ZĂÎȘȚÂ]+$/i.test(text) || // "Corina DOBROTĂ"
        /^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(text); // "John Smith"
      const isJournalMetaPattern =
        /\b(vol\.?|issue|special\s*issue|journal|linguaculture|\d{4})\b/i.test(
          text,
        );
      const isUrlOrRef = /https?:\/\/|doi\.|www\.|\.org|\.com/i.test(text);
      const isRunningTitle =
        text.length >= 20 &&
        text.length <= 80 &&
        /^[A-Z]/.test(text) &&
        !/[.!?]\s*$/.test(text) &&
        !text.includes(","); // Likely document title repeated as header

      // HEADING CANDIDATE PROTECTION:
      // Short noun phrases starting with uppercase, no sentence terminator = potential heading
      // These MUST survive to block-level for heading detection
      // e.g., "Ethical considerations", "Changing Translator Roles"
      const looksLikeHeadingCandidate =
        text.length <= 70 &&
        text.split(/\s+/).length <= 6 &&
        /^[A-Z]/.test(text) &&
        !/[.!?]\s*$/.test(text) &&
        !isPurePageNumber &&
        !isAuthorNamePattern &&
        !isJournalMetaPattern &&
        !isUrlOrRef;

      if (looksLikeHeadingCandidate) {
        return "paragraph"; // Survive to block stage for heading detection
      }

      // Immediate removal conditions
      if (isPurePageNumber) {
        return isFooterZone ? "footer" : "header";
      }

      // Modified logic: Only classify as header/footer if NOT url/ref, and is author or journal-meta pattern
      if (
        isShortText &&
        (isAuthorNamePattern || isJournalMetaPattern) &&
        !isUrlOrRef
      ) {
        return isHeaderZone ? "header" : "footer";
      }

      // NOTE: URL / ISSN / mixed journal lines in footer zone are ambiguous
      // Treat them as paragraph so layout-based paragraph logic can decide
      if (isUrlOrRef) {
        return "paragraph";
      }

      // Running title pattern (e.g., "The Role of the Translator in the Digital Age")
      if (isRunningTitle && isHeaderZone) {
        return "header";
      }

      // Very short text in H/F zone - likely metadata
      if (text.length < 60 && isSmallFont) {
        return isHeaderZone ? "header" : "footer";
      }
    }

    // Everything else passes through for essay_academic (no aggressive removal)
  } else {
    // Journal profile: Original aggressive header/footer detection
    // Note: Profile-based detection - strictness does not affect H/F classification
    const isHeaderZone = yRatio < 0.07;
    const isFooterZone = yRatio > 0.9;
    const isHFZone = isHeaderZone || isFooterZone;

    // Journal metadata patterns (DOI, ISSN, Volume, etc.)
    const looksLikeMeta =
      /\b(doi|issn|volume|vol\.|no\.|pp\.|journal|arxiv|copyright|©)\b/i.test(
        text,
      ) ||
      /https?:\/\/|doi\.org|www\./i.test(text) ||
      /\.(com|org|edu|uk|net|co\.uk)\b/i.test(text);

    // Page mark patterns (e.g., "1441", "Author... 1441", standalone numbers)
    const looksLikePageMark =
      /^\d+$/.test(text) || (/\b\d{1,4}\b/.test(text) && text.length < 40);

    // Pattern-based header/footer (URL, DOI, ISSN, page numbers, etc.)
    const hasHFPattern =
      /^(https?:\/\/|doi:|issn:|arxiv:|page\s*\d|©|copyright)/i.test(text) ||
      /^[ivxlcdm]+$/i.test(text); // Roman numerals

    // "Journal name + number" pattern (e.g., "Nature 2024" or text with high letter ratio ending in numbers)
    const looksLikeJournalMeta =
      /\b\d{4}\b/.test(text) && text.length < 60 && /[a-zA-Z]/.test(text);

    // Footer zone uses fixed short text threshold
    const isShortHFText = isFooterZone ? text.length < 50 : text.length < 80;

    // Extended header zone for short repeated text (e.g., "Klein et al.")
    // Short text (<35 chars) repeated on 3+ pages in top 12% is almost certainly a running header
    const isExtendedHeaderZone = yRatio < 0.12;
    if (
      isExtendedHeaderZone &&
      stats.headerFooterPatterns.has(normalized) &&
      text.length < 35 &&
      isNotLargeFont
    ) {
      return "header";
    }

    if (isHFZone) {
      // Count HF signals (need 2+ for forced removal without repetition)
      let hfSignals = 0;
      if (isSmallFont) hfSignals++;
      if (isShortHFText) hfSignals++;
      if (looksLikeMeta) hfSignals++;
      if (looksLikePageMark) hfSignals++;
      if (hasHFPattern) hfSignals++;
      if (looksLikeJournalMeta) hfSignals++;

      // Repetition-based detection
      if (stats.headerFooterPatterns.has(normalized)) {
        // Running header exception: only for header zone, length 35-120, not ending in numbers, font not small
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

      // Forced removal: 2+ signals in HF zone
      if (hfSignals >= 2 && isNotLargeFont) {
        return isHeaderZone ? "header" : "footer";
      }

      // Strong pattern match alone is enough
      if ((hasHFPattern || looksLikeMeta) && isNotLargeFont && isShortHFText) {
        return isHeaderZone ? "header" : "footer";
      }
    }
  }

  // === Footnote Detection ===
  // yRatio > 0.80 + small font + footnote marker pattern
  // essay_academic: DISABLE footnote splitting - keep as paragraph to preserve block continuity
  // Font style/size differences should not cause block splits in essay-style documents
  const isFootnoteZone = yRatio > 0.8;
  const hasFootnoteMarker = /^(\d+|[*†‡§¶]|\[\d+\])/.test(text);

  if (!isEssayAcademic && isFootnoteZone && isSmallFont && hasFootnoteMarker) {
    return "footnote";
  }
  // essay_academic footnotes will flow through as paragraphs

  // Calculate gap from previous line
  const gapFromPrev =
    prevLine && prevLine.page === line.page ? Math.abs(line.y - prevLine.y) : 0;

  // === Heading detection ===
  // Rule 1: Numbered section patterns (e.g., "1. Introduction", "2.1. Methods")
  const hasNumberedSection = /^(\d+\.|\d+\.\d+\.?)\s+[A-Z]/.test(text);

  // Rule 2: Academic section keywords (standalone) - force heading if standalone & short
  // STRUCTURAL FIX: Separate "abstract" as its own block type per instructions.md
  const isAbstractKeyword = /^abstract$/i.test(text);
  const hasSectionKeyword =
    /^(introduction|conclusion|method|methodology|methods|results?|discussion|references?|bibliography|acknowledgments?|appendix|related work|background|overview|summary)$/i.test(
      text,
    );

  // Rule 3: Significantly larger font (25%+ larger than median)
  const hasLargeFont = line.fontHeight > stats.medianBodyFont * 1.25;

  // === Visual-based Subheading Detection (3-2) ===
  const isShortLine = text.length <= 80;
  const endsWithPeriod = /[.!?]["']?\s*$/.test(text);
  const slightlyLarger = line.fontHeight >= stats.medianBodyFont * 1.05;

  // CRITICAL FIX: Page boundary lines should NOT use large gap as heading signal
  // When previous line is on different page, the gap is artificial (page break, not content gap)
  const isPageBoundary = prevLine && line.page !== prevLine.page;
  const rawHasLargeGap = gapFromPrev >= stats.medianLineHeight * 1.3;
  const hasLargeGap = rawHasLargeGap && !isPageBoundary; // Invalidate gap signal at page boundaries

  // Calculate title-case ratio (first letter of each word capitalized)
  const words = text.split(/\s+/);
  const titleCaseWords = words.filter((w) => /^[A-Z]/.test(w)).length;
  const titleCaseRatio = words.length > 0 ? titleCaseWords / words.length : 0;
  const hasTitleCase = titleCaseRatio >= 0.6;

  // CRITICAL FIX: Body text pattern detection
  // Lines with high lowercase ratio are body text, NOT headings
  // "It goes without saying that..." has high lowercase ratio
  const lowercaseChars = text.match(/[a-z]/g)?.length || 0;
  const uppercaseChars = text.match(/[A-Z]/g)?.length || 0;
  const totalLetters = lowercaseChars + uppercaseChars;
  const lowercaseRatio = totalLetters > 0 ? lowercaseChars / totalLetters : 0;
  const isBodyTextPattern = lowercaseRatio >= 0.7 && words.length >= 5; // 70%+ lowercase, 5+ words

  // Check xStart difference from previous line (alignment change)
  const xStartDiff = prevLine ? Math.abs(line.xStart - prevLine.xStart) : 0;
  const hasAlignmentChange = xStartDiff >= stats.medianBodyFont * 1.5;

  // Check if line is standalone short compared to neighbors
  const prevIsLong = prevLine ? prevLine.text.trim().length > 100 : false;

  // STRUCTURAL FIX per instructions.md: Abstract is a section (label + body)
  // "abstract_label" is metadata (non-translatable), body is captured separately
  if (
    isAbstractKeyword &&
    text.length <= 40 &&
    line.fontHeight >= stats.medianBodyFont
  ) {
    return "abstract_label";
  }

  // Section keywords: force heading if standalone and short (3-2-B)
  // DISABLED for essay_academic - humanities papers don't follow STEM section conventions
  if (
    !isEssayAcademic &&
    hasSectionKeyword &&
    text.length <= 40 &&
    line.fontHeight >= stats.medianBodyFont
  ) {
    return "heading";
  }

  // === ALL CAPS Heading Detection (Profile-based only) ===
  // Criteria: ALL CAPS, 2+ words, no sentence-ending punctuation
  // Excludes short abbreviations like "AI", "NLP" (single words)
  // For essay_academic: MORE RESTRICTIVE (<=60 chars, >=2 words)
  // For journal: Less restrictive (<=120 chars, >=2 words)
  // NOTE: Strictness does NOT affect heading classification (profile only)
  const maxAllCapsLength = isEssayAcademic ? 60 : 120;
  if (text.length <= maxAllCapsLength && words.length >= 2) {
    const isAllCaps = text === text.toUpperCase() && /[A-Z]/.test(text);
    const noSentenceEnd = !/[.!?]\s*$/.test(text);
    if (isAllCaps && noSentenceEnd) {
      return "heading";
    }
  }

  // === Heading Detection: Profile-Specific Rules ===

  // For arxiv profile, check standalone section numbers BEFORE page number filter
  // because PyMuPDF may split "4 Provocations..." into separate lines where "4" alone
  // would otherwise be caught by the isPurePageNumber rule.
  // Safety: require font size >= median body font to distinguish from page numbers
  // (page numbers typically use smaller font, e.g., 8pt vs 10pt body)
  if (parsingProfile === "arxiv") {
    // Standalone section numbers: "4", "4.1", "A.2" but NOT long DOI fragments like "3372832"
    // Real section numbers are short (≤3 chars for pure digits, or dotted like "4.1")
    const isStandaloneSectionNumber = /^\d+(\.\d+)*$/.test(text) && (text.includes('.') || text.length <= 2);
    if (isStandaloneSectionNumber && line.fontHeight >= stats.medianBodyFont * 0.95) {
      return "heading";
    }
  }

  // CRITICAL: Pure page numbers (1-3 digit standalone) should NEVER be headings
  // These slip through H/F zone detection when yRatio is between 0.10 and 0.90
  const isPurePageNumber = /^\d{1,3}$/.test(text);
  if (isPurePageNumber) {
    return "footer"; // Treat as footer regardless of position
  }

  // CRITICAL: Text starting with lowercase letter is NEVER a heading
  // This catches page-boundary paragraph continuations (e.g., "and platforms...")
  const startsWithLowercase = /^[a-z]/.test(text);
  if (startsWithLowercase) {
    return "paragraph";
  }

  // CRITICAL: Lines starting with numbers followed by body text are paragraphs, not headings
  // e.g., "130 languages, including many that are considered low-resource..."
  // Exception: numbered section patterns like "1. Introduction" are handled separately
  const startsWithNumberThenBody =
    /^\d+\s+[a-z]/i.test(text) && !/^\d+\.\s+[A-Z]/.test(text);
  if (startsWithNumberThenBody && text.length > 40) {
    return "paragraph";
  }

  if (parsingProfile === "arxiv") {
    // arXiv heading detection: numbering-based priority
    const hasNumberedSection = /^(\d+(\.\d+)*)\s+[A-Z]/.test(text);
    const isShortLine = text.length <= 120;
    const endsWithPeriod = /[.!?]["']?\s*$/.test(text);

    if (hasNumberedSection && isShortLine && !endsWithPeriod) {
      return "heading";
    }

    return "paragraph";
  } else if (isEssayAcademic) {
    // ============================================================
    // BLOCK HEADING DETECTION FOR ESSAY-ACADEMIC PROFILE
    // ============================================================
    // Per user principle: Block headings must be detected by their OWN characteristics:
    // - Single-line, non-sentence (noun phrase)
    // - No sentence terminator
    // - Followed by prose paragraph (checked by layout gap)
    //
    // "Ethical considerations", "Changing Translator Roles", "CONCLUSIONS"
    // are ALL block headings regardless of capitalization style.
    // ============================================================

    // ============================================================
    // NOUN PHRASE HEADING: Deferred to block-level post-processing
    // ============================================================
    // Per user principle: "Heading은 line의 속성이 아니라 block의 역할"
    // Line-level cannot determine heading status for noun phrases like
    // "Ethical considerations" without seeing the following prose context.
    //
    // These patterns are detected in postProcessBlocksForEssayAcademic
    // where we can see: short paragraph block + followed by long prose → heading
    // ============================================================

    // 2+ STRUCTURAL signals (strong visual indicators only)
    if (isShortLine && !endsWithPeriod && !isBodyTextPattern) {
      let structuralSignals = 0;
      if (hasLargeGap) structuralSignals++;
      const hasFontSizeIncrease = line.fontHeight >= stats.medianBodyFont * 1.1;
      if (hasFontSizeIncrease) structuralSignals++;
      if (hasAlignmentChange) structuralSignals++;

      if (structuralSignals >= 2) {
        return "heading";
      }
    }

    // Numbered sections
    if (hasNumberedSection && text.length < 100) {
      return "heading";
    }

    // Large font (+25%) with gap
    if (
      hasLargeFont &&
      hasLargeGap &&
      isShortLine &&
      !endsWithPeriod &&
      !isBodyTextPattern
    ) {
      return "heading";
    }

    // Everything else is paragraph
    return "paragraph";
  } else {
    // Journal profile: Original subheading detection (2+ visual signals)
    // CRITICAL: Body text pattern lines are NEVER headings, regardless of visual signals
    if (isShortLine && !endsWithPeriod && !isBodyTextPattern) {
      let visualSignals = 0;
      if (hasLargeGap) visualSignals++;
      if (slightlyLarger) visualSignals++;
      if (hasAlignmentChange) visualSignals++;
      if (hasTitleCase) visualSignals++;
      if (prevIsLong) visualSignals++; // Standalone short after long paragraph

      if (visualSignals >= 2) {
        return "heading";
      }
    }

    // Strong heading signals
    const isMandatoryHeadingSignal = hasNumberedSection || hasLargeFont;

    if (!isMandatoryHeadingSignal) {
      return "paragraph";
    }

    // Helper signals for confirmation
    let helperSignals = 0;
    if (text.length < 100) helperSignals++;
    if (gapFromPrev > stats.medianLineHeight * 2.0) helperSignals++;

    // Mandatory signal + at least 1 helper signal = heading
    return helperSignals >= 1 ? "heading" : "paragraph";
  }
}
