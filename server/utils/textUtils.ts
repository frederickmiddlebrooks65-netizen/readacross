/**
 * Text processing utilities for document handling
 * Extracted from routes.ts as part of Step 1 refactoring
 */

import { smartNormalizeForSentenceProcessing, legacyPreprocessText } from './textNormalize';

// Phase 2-4: Sentence type for TM eligibility
export type SentenceType = "sentence" | "utterance";

// Phase 2-4: Sentence unit with explicit type
export interface SentenceUnit {
  text: string;
  type: SentenceType;
}

/**
 * Split text into paragraphs by double line breaks
 */
export function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Extract title from paragraph if it matches title patterns
 */
export function extractTitleFromParagraph(paragraph: string): {
  title: string | null;
  content: string;
} {
  const titleMatch =
    paragraph.match(/^(#+\s+)(.+?)(\n|$)/) ||
    paragraph.match(/^(.{1,60}):(\n|$)/);

  if (titleMatch) {
    const title = titleMatch[2].trim();
    const remainingContent = paragraph.substring(titleMatch[0].length).trim();
    return {
      title,
      content: remainingContent || paragraph,
    };
  }

  return {
    title: null,
    content: paragraph,
  };
}

/**
 * P1 개선: 일관된 전처리 로직을 위한 공통 함수
 * splitIntoSentences()와 generateSentenceHash()에서 동일하게 사용
 * 
 * 🚀 V2.3: Smart line-break normalization for PDF and structured documents
 */
export function preprocessTextForSentenceProcessing(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  // 점진적 배포 플래그: 환경변수로 제어
  const useSmartNormalize = process.env.USE_SMART_NORMALIZE !== 'false'; // 기본값: true
  
  if (useSmartNormalize) {
    console.log('[TextUtils] Using smart normalization for text processing');
    
    // HTML 태그와 엔티티 제거를 먼저 수행
    const htmlCleaned = text
      .replace(/<[^>]*>/g, '') // Remove all HTML tags
      .replace(/&[a-zA-Z0-9#]+;/g, ' ') // Remove HTML entities
      .replace(/&nbsp;/g, ' ') // Specific handling for non-breaking spaces
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
      .normalize('NFC'); // Normalize Unicode
    
    // 스마트 정규화 적용
    return smartNormalizeForSentenceProcessing(htmlCleaned);
  } else {
    console.log('[TextUtils] Using legacy normalization for text processing');
    return legacyPreprocessText(text);
  }
}

/**
 * Enhanced sentence splitting that handles academic text better
 * This is the unified, improved version targeting ≥90% anchor matching
 * STEP 3 FIX: Version tracking for consistent sentence splitting
 * 
 * Phase 2-2: Archetype-aware sentence splitting
 * - academic: Stricter rules, protect citations, formulas, abbreviations
 * - literary/essay/generic: Default behavior (unchanged)
 */
export const SENTENCE_TOKENIZER_VERSION = "v2.4";

export type DocumentArchetype = "academic" | "literary" | "essay" | "generic";

export interface SplitIntoSentencesOptions {
  archetype?: DocumentArchetype;
}

/**
 * Academic-specific abbreviations that MUST NOT trigger sentence splits
 * Phase 2-2: Extended list per instructions.md
 */
const ACADEMIC_ABBREVIATIONS = [
  // Standard academic
  'et al', 'Fig', 'Figs', 'Eq', 'Eqs', 'No', 'Nos', 'Vol', 'Vols',
  'pp', 'p', 'ch', 'Ch', 'sec', 'Sec', 'ref', 'Ref', 'refs', 'Refs',
  'Tab', 'Tabs', 'App', 'Suppl', 'vs', 'cf', 'viz', 'ca', 'approx',
  // Titles and degrees
  'Dr', 'Mr', 'Mrs', 'Ms', 'Prof', 'Sr', 'Jr',
  'Ph\\.D', 'M\\.D', 'B\\.A', 'M\\.A', 'B\\.S', 'M\\.S', 'Ed\\.D',
  // Organizations
  'Inc', 'Ltd', 'Corp', 'Co', 'LLC', 'Assoc', 'Dept', 'Univ',
  // Common
  'etc', 'e\\.g', 'i\\.e', 'ibid', 'op\\. cit', 'loc\\. cit',
  // Units and measurements
  'min', 'max', 'avg', 'std', 'approx', 'est',
  // Countries
  'U\\.S', 'U\\.K', 'U\\.S\\.A',
  // Tech terms
  'CEO', 'CFO', 'CTO', 'AI', 'API', 'URL', 'HTML', 'CSS', 'JS', 'PDF', 'FAQ'
];

/**
 * Phase 2-6: Colon-based sentence boundary detection
 * 
 * Detects when colon introduces a full sentence (not a list)
 * Example: "require cultural mediation: Some scholars..."
 * vs      "components: accuracy, fluency, consistency"
 */
function isColonFollowedByFullSentence(textAfter: string): boolean {
  const trimmed = textAfter.trim();

  // Condition A: Starts with capital letter or opening quote
  if (!/^(["'\u201C\u201D\u2018\u2019]?\s*[A-Z])/.test(trimmed)) {
    return false;
  }

  // Condition B: Minimum length (noise prevention)
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount < 5) {
    return false;
  }

  // Condition C: Verb existence (complete sentence heuristic)
  if (!/\b(is|are|was|were|has|have|had|do|does|did|can|could|should|will|would|may|might|be|been|being|make|makes|made|take|takes|took|give|gives|gave|find|finds|found|see|sees|saw|come|comes|came|go|goes|went|get|gets|got|think|thinks|thought|know|knows|knew|become|becomes|became|seem|seems|seemed|appear|appears|appeared|use|uses|used|consider|considers|considered)\b/i.test(trimmed)) {
    return false;
  }

  // Condition D: Sentence terminator exists
  if (!/[.!?]["'\u2019\u201D)\]]*$/.test(trimmed)) {
    return false;
  }

  return true;
}

/**
 * Phase 2-5: CRITICAL FIX - Sentence-local quotation/parenthesis scope
 * 
 * PROBLEM: Previous implementation maintained quote/paren state across entire paragraph
 * causing one unclosed quote to merge multiple sentences together.
 * 
 * SOLUTION: Check only within current sentence (sentenceStart to punctPosition)
 * + Proper matching of opening/closing quotes and brackets (not just toggle)
 * + Full support for smart quotes: " " ' '
 * + Support for all bracket types: () [] {}
 * + Apostrophe/contraction detection to avoid false quote detection
 * 
 * PRINCIPLE: [.!?] + whitespace + [A-Z] is an ABSOLUTE sentence break signal
 * unless the period itself is inside quotes/parens that START and END within this sentence.
 */
function isInsideParensOrQuotesInSentence(text: string, sentenceStart: number, punctPosition: number): boolean {
  const sentenceText = text.substring(sentenceStart, punctPosition);
  
  // Track nesting levels for different bracket types
  let parenDepth = 0;      // () 
  let squareDepth = 0;     // []
  let curlyDepth = 0;      // {}
  
  // Track quote states - use stacks to handle nesting
  const singleQuoteStack: number[] = [];    // Positions where single quote opened
  const doubleQuoteStack: number[] = [];    // Positions where double quote opened
  let inSingleQuote = false;
  let inDoubleQuote = false;
  
  for (let i = 0; i < sentenceText.length; i++) {
    const char = sentenceText[i];
    const prevChar = i > 0 ? sentenceText[i - 1] : ' ';
    const nextChar = i < sentenceText.length - 1 ? sentenceText[i + 1] : ' ';
    
    // Handle parentheses
    if (char === '(') {
      parenDepth++;
    } else if (char === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
    } 
    // Handle square brackets
    else if (char === '[') {
      squareDepth++;
    } else if (char === ']') {
      squareDepth = Math.max(0, squareDepth - 1);
    }
    // Handle curly braces
    else if (char === '{') {
      curlyDepth++;
    } else if (char === '}') {
      curlyDepth = Math.max(0, curlyDepth - 1);
    }
    // Handle straight double quotes
    else if (char === '"') {
      inDoubleQuote = !inDoubleQuote;
      if (inDoubleQuote) {
        doubleQuoteStack.push(i);
      } else {
        doubleQuoteStack.pop();
      }
    }
    // Handle smart double quotes: " (U+201C) and " (U+201D)
    else if (char === '\u201C') {  // Opening smart quote "
      inDoubleQuote = true;
      doubleQuoteStack.push(i);
    } else if (char === '\u201D') {  // Closing smart quote "
      if (doubleQuoteStack.length > 0) {
        doubleQuoteStack.pop();
        inDoubleQuote = doubleQuoteStack.length > 0;
      }
    }
    // Handle single quotes and apostrophes
    else if (char === "'" || char === '\u2018' || char === '\u2019') {
      // CRITICAL FIX (Phase 2-5):
      // Smart quotes (U+2018 / U+2019) MUST be handled by stack state, not possessive detection
      // Otherwise: U+2019 incorrectly treated as possessive → stack never pops → entire paragraph locked
      
      // First, handle smart quotes based on stack state
      if (char === '\u2018') {  // Opening smart quote '
        inSingleQuote = true;
        singleQuoteStack.push(i);
      } else if (char === '\u2019') {  // Closing smart quote '
        // CRITICAL: If opening quote exists, this MUST be closing quote (priority over possessive)
        if (singleQuoteStack.length > 0) {
          singleQuoteStack.pop();
          inSingleQuote = singleQuoteStack.length > 0;
        } else {
          // Only when no smart opening quote is pending, consider possessive
          const isWithinWord = /[a-zA-Z]/.test(prevChar) && /[a-zA-Z]/.test(nextChar);
          const isTrailingPossessive = /[a-zA-Z]/.test(prevChar) && !/[a-zA-Z]/.test(nextChar);
          
          if (isWithinWord || isTrailingPossessive) {
            // Possessive apostrophe - skip it
            continue;
          } else {
            // Lone U+2019 without opening quote - treat as opening quote
            inSingleQuote = true;
            singleQuoteStack.push(i);
          }
        }
      } 
      // Handle straight apostrophes
      else if (char === "'") {  // Straight apostrophe
        // For straight apostrophe, we need to distinguish quote vs possessive
        const isWithinWord = /[a-zA-Z]/.test(prevChar) && /[a-zA-Z]/.test(nextChar);
        const isTrailingPossessive = /[a-zA-Z]/.test(prevChar) && !/[a-zA-Z]/.test(nextChar);
        
        if (isWithinWord || isTrailingPossessive) {
          // Possessive/contraction - skip it
          continue;
        } else {
          // Toggle for straight apostrophe used as quote
          inSingleQuote = !inSingleQuote;
          if (inSingleQuote) {
            singleQuoteStack.push(i);
          } else if (singleQuoteStack.length > 0) {
            singleQuoteStack.pop();
          }
        }
      }
    }
  }
  
  // Return true if we're inside ANY unclosed scope at punctuation position
  const insideBrackets = parenDepth > 0 || squareDepth > 0 || curlyDepth > 0;
  const insideQuotes = inSingleQuote || inDoubleQuote;
  
  return insideBrackets || insideQuotes;
}

/**
 * Check if the text before a period is an academic abbreviation
 */
function endsWithAcademicAbbreviation(textBefore: string): boolean {
  const trimmed = textBefore.trim();
  
  // Check for math/table placeholders: [MATH_1], [TABLE_2], etc.
  if (/\[(MATH|TABLE|FIGURE|EQ|FIG)_\d+\]$/i.test(trimmed)) {
    return true;
  }
  
  // Check for citation patterns: (Author, 2023), (Smith et al., 2021)
  if (/\([A-Z][a-zA-Z]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-zA-Z]+))?,?\s*\d{4}[a-z]?\)$/.test(trimmed)) {
    return true;
  }
  
  // Check for numbered references: [1], [2,3], [1-5]
  if (/\[\d+(?:[-,]\d+)*\]$/.test(trimmed)) {
    return true;
  }
  
  // Build regex pattern for abbreviations
  const abbrevPattern = new RegExp(
    `\\b(?:${ACADEMIC_ABBREVIATIONS.join('|')})$`,
    'i'
  );
  
  return abbrevPattern.test(trimmed);
}

/**
 * Academic-specific sentence splitting
 * Phase 2-2: Stricter rules per instructions.md
 * Phase 2-4: Returns SentenceUnit[] with type (academic = all sentence)
 */
function splitIntoSentencesAcademic(cleanText: string): SentenceUnit[] {
  const sentences: SentenceUnit[] = [];
  
  // Step 1: Protect abbreviations and special patterns
  const protectionMap = new Map<string, string>();
  let protectionCounter = 0;
  
  // Build comprehensive abbreviation pattern
  const abbrevPattern = new RegExp(
    `\\b(${ACADEMIC_ABBREVIATIONS.join('|')})\\.`,
    'gi'
  );
  
  let protectedText = cleanText.replace(abbrevPattern, (match) => {
    const placeholder = `__PROT_${protectionCounter++}__`;
    protectionMap.set(placeholder, match);
    return placeholder;
  });
  
  // Protect math/table placeholders
  protectedText = protectedText.replace(/\[(MATH|TABLE|FIGURE|EQ|FIG)_\d+\]/gi, (match) => {
    const placeholder = `__PROT_${protectionCounter++}__`;
    protectionMap.set(placeholder, match);
    return placeholder;
  });
  
  // Protect citation patterns: (Author, 2023), (Smith et al., 2021)
  protectedText = protectedText.replace(
    /\([A-Z][a-zA-Z]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-zA-Z]+))?,?\s*\d{4}[a-z]?\)/g,
    (match) => {
      const placeholder = `__PROT_${protectionCounter++}__`;
      protectionMap.set(placeholder, match);
      return placeholder;
    }
  );
  
  // Protect numeric references: [1], [2,3], [1-5]
  protectedText = protectedText.replace(/\[\d+(?:[-,]\d+)*\]/g, (match) => {
    const placeholder = `__PROT_${protectionCounter++}__`;
    protectionMap.set(placeholder, match);
    return placeholder;
  });
  
  // Colon handling must not merge or override already-finalized sentences.
  // PHASE 2-6: Pre-pass colon detection (before period loop)
  // Colon is treated as independent discourse boundary, not subordinate to periods
  let cursor = 0;
  for (let i = 0; i < protectedText.length; i++) {
    if (protectedText[i] !== ':') continue;
    const beforeColon = protectedText.substring(cursor, i).trim();
    const afterColon = protectedText.substring(i + 1).trim();
    // Exclude list-introducing patterns
    const isListIntro = /(the following|as follows|including|such as|for example|namely)$/i.test(beforeColon);
    if (isListIntro) continue;
    // Check if colon is followed by a complete sentence
    if (isColonFollowedByFullSentence(afterColon)) {
      // Split any sentences ending with .!? in [cursor, i)
      const periodPattern = /([.!?])\s+(?=(?:["'\u201C\u201D\u2018\u2019\(\[\{]*\s*)?[A-Z0-9])/g;
      let lastEnd = cursor;
      let match;
      periodPattern.lastIndex = cursor;
      while ((match = periodPattern.exec(protectedText.substring(cursor, i))) !== null) {
        const punctPosition = match.index;
        const textBefore = protectedText.substring(cursor + lastEnd - cursor, cursor + punctPosition - cursor);
        if (endsWithAcademicAbbreviation(textBefore)) continue;
        if (isInsideParensOrQuotesInSentence(protectedText, cursor + lastEnd - cursor, cursor + punctPosition - cursor)) continue;
        const sentenceEnd = cursor + punctPosition + 1;
        let sentence = protectedText.substring(lastEnd, sentenceEnd).trim();
        protectionMap.forEach((original, placeholder) => {
          sentence = sentence.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
        });
        const remainingText = protectedText.substring(sentenceEnd, i).trim();
        if (remainingText.length < 5 && remainingText.length > 0) continue;
        if (sentence.length >= 2) {
          sentences.push({ text: sentence, type: "sentence" });
        }
        lastEnd = sentenceEnd;
        while (lastEnd < i && /\s/.test(protectedText[lastEnd])) lastEnd++;
        periodPattern.lastIndex = lastEnd - cursor;
      }
      // Now push only the remaining fragment + ':' as the colon sentence
      let colonSentence = protectedText.substring(lastEnd, i + 1).trim();
      protectionMap.forEach((original, placeholder) => {
        colonSentence = colonSentence.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
      });
      if (colonSentence.length >= 2) {
        sentences.push({ text: colonSentence, type: "sentence" });
      }
      cursor = i + 1;
      break; // Exit pre-pass, continue with period loop from cursor
    }
  }
  
  // Step 2: Find valid sentence boundaries
  // Academic rule: terminal punctuation followed by whitespace and a plausible new-sentence start.
  // Allow leading quotes/brackets/paren before the first token, and allow digits (e.g., numbered lists).
  const periodPattern = /([.!?])\s+(?=(?:["'\u201C\u201D\u2018\u2019\(\[\{]*\s*)?[A-Z0-9])/g;
  
  let lastEnd = cursor;
  let match;
  
  // Reset regex state
  periodPattern.lastIndex = 0;
  
  while ((match = periodPattern.exec(protectedText)) !== null) {
    const punctPosition = match.index;
    const punct = match[1];
    
    // Skip if this punctuation is before cursor (already handled by colon pre-pass)
    if (punctPosition < cursor) continue;
    
    const textBefore = protectedText.substring(lastEnd, punctPosition);
    
    // DESIGN PRINCIPLE (Phase 2-5):
    // Sentence splitting is based on sentence-local structure only.
    // Discourse-level constructs (multi-sentence quotations) are handled at higher layers.
    // Do NOT allow quote/paren state to leak across sentence boundaries.
    
    // Check if previous token is an abbreviation (already protected, but double-check)
    if (endsWithAcademicAbbreviation(textBefore)) {
      continue;
    }
    
    // SENTENCE-LOCAL scope check (Phase 2-5):
    // Split suppression only if quotes/parens are UNCLOSED WITHIN this sentence.
    // If they open and close within this sentence, do NOT suppress split.
    // If they're unclosed, suppress split to avoid mid-sentence breaks.
    if (isInsideParensOrQuotesInSentence(protectedText, lastEnd, punctPosition)) {
      continue;
    }
    
    // Extract sentence
    const sentenceEnd = punctPosition + 1; // Include the punctuation
    let sentence = protectedText.substring(lastEnd, sentenceEnd).trim();
    
    // Restore protected patterns
    protectionMap.forEach((original, placeholder) => {
      sentence = sentence.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
    });
    
    // Minimum length check (Phase 2-2: ≥5 characters for next sentence)
    const remainingText = protectedText.substring(sentenceEnd).trim();
    if (remainingText.length < 5 && remainingText.length > 0) {
      // Don't split if remainder is too short - merge with current
      continue;
    }
    
    if (sentence.length >= 2) {
      // Phase 2-4: Academic - all units are type "sentence"
      sentences.push({ text: sentence, type: "sentence" });
    }
    
    lastEnd = sentenceEnd;
    // Move past the space
    while (lastEnd < protectedText.length && /\s/.test(protectedText[lastEnd])) {
      lastEnd++;
    }
    
    // Adjust regex to continue from the capital letter
    periodPattern.lastIndex = lastEnd;
  }
  
  // Add remaining text as final sentence
  if (lastEnd < protectedText.length) {
    let remaining = protectedText.substring(lastEnd).trim();
    
    // Restore protected patterns
    protectionMap.forEach((original, placeholder) => {
      remaining = remaining.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
    });
    
    if (remaining.length >= 2) {
      // CRITICAL FIX: Do NOT add artificial periods
      // This was causing page-boundary fragments to get periods inserted mid-sentence
      // e.g., "Of course, the results obtained when resorting to MT vary widely." 
      //       when it should continue with "depending on..."
      // Instead, preserve text as-is - let the block-level logic handle paragraph continuity
      sentences.push({ text: remaining, type: "sentence" });
    }
  }
  
  // If no splits were made, return the whole text as one sentence
  if (sentences.length === 0 && cleanText.length >= 2) {
    // CRITICAL FIX: Do NOT add artificial periods to unsplit text
    // This preserves paragraph fragments that span page boundaries
    return [{ text: cleanText, type: "sentence" }];
  }
  
  return sentences;
}

/**
 * Phase 2-3: Literary sentence splitting
 * Relaxed rules for fragments, dialogue, rhetorical lines
 * Phase 2-4: Returns SentenceUnit[] with type
 * Phase 2-5: Now uses sentence-local quote/paren detection (shared with academic)
 */
function splitIntoSentencesLiterary(cleanText: string): SentenceUnit[] {
  let sentences: SentenceUnit[] = [];
  
  // Minimal abbreviations - don't over-protect for literary text
  const abbreviations = /\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr)\./gi;
  
  // Replace abbreviations temporarily
  const abbreviationMap = new Map<string, string>();
  let protectionCounter = 0;
  const tempText = cleanText.replace(abbreviations, (match) => {
    const placeholder = `__PROT_${protectionCounter++}__`;
    abbreviationMap.set(placeholder, match);
    return placeholder;
  });
  
  // Colon handling must not merge or override already-finalized sentences.
  // PHASE 2-6: Pre-pass colon detection (before period loop)
  // Colon is treated as independent discourse boundary, not subordinate to periods
  let cursor = 0;
  for (let i = 0; i < tempText.length; i++) {
    if (tempText[i] !== ':') continue;
    const beforeColon = tempText.substring(cursor, i).trim();
    const afterColon = tempText.substring(i + 1).trim();
    // Exclude list-introducing patterns
    const isListIntro = /(the following|as follows|including|such as|for example|namely)$/i.test(beforeColon);
    if (isListIntro) continue;
    // Check if colon is followed by a complete sentence
    if (isColonFollowedByFullSentence(afterColon)) {
      // Split any sentences ending with .!? in [cursor, i)
      const periodPattern = /([.!?])\s+(?=(?:["'\u201C\u201D\u2018\u2019\(\[\{]*\s*)?[A-Z0-9])/g;
      let lastEnd = cursor;
      let match;
      periodPattern.lastIndex = cursor;
      while ((match = periodPattern.exec(tempText.substring(cursor, i))) !== null) {
        const punctPosition = match.index;
        const textBefore = tempText.substring(cursor + lastEnd - cursor, cursor + punctPosition - cursor);
        if (endsWithAcademicAbbreviation(textBefore)) continue;
        if (isInsideParensOrQuotesInSentence(tempText, cursor + lastEnd - cursor, cursor + punctPosition - cursor)) continue;
        const sentenceEnd = cursor + punctPosition + 1;
        let sentence = tempText.substring(lastEnd, sentenceEnd).trim();
        abbreviationMap.forEach((original, placeholder) => {
          sentence = sentence.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
        });
        const remainingText = tempText.substring(sentenceEnd, i).trim();
        if (remainingText.length < 5 && remainingText.length > 0) continue;
        if (sentence.length >= 1) {
          const wordCount = sentence.split(/\s+/).filter(w => w.length > 0).length;
          const isFragment = wordCount <= 2;
          const isDialogueFragment = /^["'\u201C\u201D]/.test(sentence) && !sentence.match(/[.!?]$/);
          const type: SentenceType = (isFragment || isDialogueFragment) ? "utterance" : "sentence";
          sentences.push({ text: sentence, type });
        }
        lastEnd = sentenceEnd;
        while (lastEnd < i && /\s/.test(tempText[lastEnd])) lastEnd++;
        periodPattern.lastIndex = lastEnd - cursor;
      }
      // Now push only the remaining fragment + ':' as the colon sentence
      let colonSentence = tempText.substring(lastEnd, i + 1).trim();
      abbreviationMap.forEach((original, placeholder) => {
        colonSentence = colonSentence.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
      });
      const wordCount = colonSentence.split(/\s+/).filter(w => w.length > 0).length;
      const type: SentenceType = wordCount <= 2 ? "utterance" : "sentence";
      sentences.push({ text: colonSentence, type });
      cursor = i + 1;
      break; // Exit pre-pass, continue with period loop from cursor
    }
  }
  
  // Step 2: Find valid sentence boundaries (same as academic)
  // Terminal punctuation followed by whitespace and a capital letter or digit
  const periodPattern = /([.!?])\s+(?=(?:["'\u201C\u201D\u2018\u2019\(\[\{]*\s*)?[A-Z0-9])/g;
  
  let lastEnd = cursor;
  let match;
  periodPattern.lastIndex = 0;
  
  while ((match = periodPattern.exec(tempText)) !== null) {
    const punctPosition = match.index;
    
    // Skip if this punctuation is before cursor (already handled by colon pre-pass)
    if (punctPosition < cursor) continue;
    
    // Check if previous token is an abbreviation
    const textBefore = tempText.substring(lastEnd, punctPosition);
    if (endsWithAcademicAbbreviation(textBefore)) {
      continue;
    }
    
    // Phase 2-5: SENTENCE-LOCAL scope check
    // Only suppress split if quotes/parens are unclosed WITHIN this sentence
    if (isInsideParensOrQuotesInSentence(tempText, lastEnd, punctPosition)) {
      continue;
    }
    
    // Extract sentence
    const sentenceEnd = punctPosition + 1; // Include the punctuation
    let sentence = tempText.substring(lastEnd, sentenceEnd).trim();
    
    // Restore protected patterns
    abbreviationMap.forEach((original, placeholder) => {
      sentence = sentence.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
    });
    
    // Minimum length check
    const remainingText = tempText.substring(sentenceEnd).trim();
    if (remainingText.length < 5 && remainingText.length > 0) {
      continue;
    }
    
    if (sentence.length >= 1) {
      // Phase 2-4: Literary type determination
      // Short fragments (1-2 words), dialogue fragments → utterance
      const wordCount = sentence.split(/\s+/).filter(w => w.length > 0).length;
      const isFragment = wordCount <= 2;
      const isDialogueFragment = /^["'\u201C\u201D]/.test(sentence) && !sentence.match(/[.!?]$/);
      
      const type: SentenceType = (isFragment || isDialogueFragment) ? "utterance" : "sentence";
      sentences.push({ text: sentence, type });
    }
    
    lastEnd = sentenceEnd;
    while (lastEnd < tempText.length && /\s/.test(tempText[lastEnd])) {
      lastEnd++;
    }
    periodPattern.lastIndex = lastEnd;
  }
  
  // Add remaining text as final sentence
  if (lastEnd < tempText.length) {
    let remaining = tempText.substring(lastEnd).trim();
    
    abbreviationMap.forEach((original, placeholder) => {
      remaining = remaining.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
    });
    
    if (remaining.length >= 1) {
      const wordCount = remaining.split(/\s+/).filter(w => w.length > 0).length;
      const isFragment = wordCount <= 2;
      const type: SentenceType = isFragment ? "utterance" : "sentence";
      sentences.push({ text: remaining, type });
    }
  }
  
  if (sentences.length === 0 && cleanText.length >= 1) {
    return [{ text: cleanText, type: "sentence" }];
  }
  
  return sentences;
}

/**
 * Phase 2-3: Essay sentence splitting
 * Allow noun phrases, colons, dashes as semantic units
 * Phase 2-4: Returns SentenceUnit[] with type
 * Phase 2-5: Now uses sentence-local quote/paren detection (shared with academic)
 */
function splitIntoSentencesEssay(cleanText: string): SentenceUnit[] {
  let sentences: SentenceUnit[] = [];
  
  // Moderate abbreviations for essays
  const abbreviations = /\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|Inc|Ltd|Corp|Co|etc|vs|e\.g|i\.e)\./gi;
  
  // Replace abbreviations temporarily
  const abbreviationMap = new Map<string, string>();
  let protectionCounter = 0;
  const tempText = cleanText.replace(abbreviations, (match) => {
    const placeholder = `__PROT_${protectionCounter++}__`;
    abbreviationMap.set(placeholder, match);
    return placeholder;
  });
  
  // Colon handling must not merge or override already-finalized sentences.
  // PHASE 2-6: Pre-pass colon detection (before period loop)
  // Colon is treated as independent discourse boundary, not subordinate to periods
  let cursor = 0;
  for (let i = 0; i < tempText.length; i++) {
    if (tempText[i] !== ':') continue;
    const beforeColon = tempText.substring(cursor, i).trim();
    const afterColon = tempText.substring(i + 1).trim();
    // Exclude list-introducing patterns
    const isListIntro = /(the following|as follows|including|such as|for example|namely)$/i.test(beforeColon);
    if (isListIntro) continue;
    // Check if colon is followed by a complete sentence
    if (isColonFollowedByFullSentence(afterColon)) {
      // Split any sentences ending with .!? in [cursor, i)
      const periodPattern = /([.!?])\s+(?=(?:["'\u201C\u201D\u2018\u2019\(\[\{]*\s*)?[A-Z0-9])/g;
      let lastEnd = cursor;
      let match;
      periodPattern.lastIndex = cursor;
      while ((match = periodPattern.exec(tempText.substring(cursor, i))) !== null) {
        const punctPosition = match.index;
        const textBefore = tempText.substring(cursor + lastEnd - cursor, cursor + punctPosition - cursor);
        if (endsWithAcademicAbbreviation(textBefore)) continue;
        if (isInsideParensOrQuotesInSentence(tempText, cursor + lastEnd - cursor, cursor + punctPosition - cursor)) continue;
        const sentenceEnd = cursor + punctPosition + 1;
        let sentence = tempText.substring(lastEnd, sentenceEnd).trim();
        abbreviationMap.forEach((original, placeholder) => {
          sentence = sentence.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
        });
        const remainingText = tempText.substring(sentenceEnd, i).trim();
        if (remainingText.length < 5 && remainingText.length > 0) continue;
        if (sentence.length >= 2) {
          const isColonPhrase = sentence.endsWith(':');
          const wordCount = sentence.split(/\s+/).filter(w => w.length > 0).length;
          const isShortNounPhrase = wordCount <= 3 && !sentence.match(/[.!?]$/);
          const type: SentenceType = (isColonPhrase || isShortNounPhrase) ? "utterance" : "sentence";
          sentences.push({ text: sentence, type });
        }
        lastEnd = sentenceEnd;
        while (lastEnd < i && /\s/.test(tempText[lastEnd])) lastEnd++;
        periodPattern.lastIndex = lastEnd - cursor;
      }
      // Now push only the remaining fragment + ':' as the colon sentence
      let colonSentence = tempText.substring(lastEnd, i + 1).trim();
      abbreviationMap.forEach((original, placeholder) => {
        colonSentence = colonSentence.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
      });
      const wordCount = colonSentence.split(/\s+/).filter(w => w.length > 0).length;
      const type: SentenceType = wordCount <= 3 ? "utterance" : "sentence";
      sentences.push({ text: colonSentence, type });
      cursor = i + 1;
      break; // Exit pre-pass, continue with period loop from cursor
    }
  }
  
  // Step 2: Find valid sentence boundaries (same as academic)
  // Terminal punctuation followed by whitespace and a capital letter or digit
  const periodPattern = /([.!?])\s+(?=(?:["'\u201C\u201D\u2018\u2019\(\[\{]*\s*)?[A-Z0-9])/g;
  
  let lastEnd = cursor;
  let match;
  periodPattern.lastIndex = 0;
  
  while ((match = periodPattern.exec(tempText)) !== null) {
    const punctPosition = match.index;
    
    // Skip if this punctuation is before cursor (already handled by colon pre-pass)
    if (punctPosition < cursor) continue;
    
    // Check if previous token is an abbreviation
    const textBefore = tempText.substring(lastEnd, punctPosition);
    if (endsWithAcademicAbbreviation(textBefore)) {
      continue;
    }
    
    // Phase 2-5: SENTENCE-LOCAL scope check
    // Only suppress split if quotes/parens are unclosed WITHIN this sentence
    if (isInsideParensOrQuotesInSentence(tempText, lastEnd, punctPosition)) {
      continue;
    }
    
    // Extract sentence
    const sentenceEnd = punctPosition + 1; // Include the punctuation
    let sentence = tempText.substring(lastEnd, sentenceEnd).trim();
    
    // Restore protected patterns
    abbreviationMap.forEach((original, placeholder) => {
      sentence = sentence.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
    });
    
    // Minimum length check
    const remainingText = tempText.substring(sentenceEnd).trim();
    if (remainingText.length < 5 && remainingText.length > 0) {
      continue;
    }
    
    if (sentence.length >= 2) {
      // Phase 2-4: Essay type determination
      // Colon phrases, short noun phrases → utterance
      const isColonPhrase = sentence.endsWith(':');
      const wordCount = sentence.split(/\s+/).filter(w => w.length > 0).length;
      const isShortNounPhrase = wordCount <= 3 && !sentence.match(/[.!?]$/);
      
      const type: SentenceType = (isColonPhrase || isShortNounPhrase) ? "utterance" : "sentence";
      sentences.push({ text: sentence, type });
    }
    
    lastEnd = sentenceEnd;
    while (lastEnd < tempText.length && /\s/.test(tempText[lastEnd])) {
      lastEnd++;
    }
    periodPattern.lastIndex = lastEnd;
  }
  
  // Add remaining text as final sentence
  if (lastEnd < tempText.length) {
    let remaining = tempText.substring(lastEnd).trim();
    
    abbreviationMap.forEach((original, placeholder) => {
      remaining = remaining.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
    });
    
    if (remaining.length >= 2) {
      const isColonPhrase = remaining.endsWith(':');
      const wordCount = remaining.split(/\s+/).filter(w => w.length > 0).length;
      const isShortNounPhrase = wordCount <= 3 && !remaining.match(/[.!?]$/);
      
      const type: SentenceType = (isColonPhrase || isShortNounPhrase) ? "utterance" : "sentence";
      sentences.push({ text: remaining, type });
    }
  }
  
  if (sentences.length === 0 && cleanText.length >= 2) {
    return [{ text: cleanText, type: "sentence" }];
  }
  
  return sentences;
}

/**
 * Default/Generic sentence splitting
 * Used when archetype is unknown or generic
 * Phase 2-4: Returns SentenceUnit[] with type
 * Phase 2-5: Now uses sentence-local quote/paren detection (shared with academic)
 */
function splitIntoSentencesDefault(cleanText: string): SentenceUnit[] {
  let sentences: SentenceUnit[] = [];
  
  // Common abbreviations that should not end sentences
  const abbreviations = /\b(?:Dr|Mr|Mrs|Ms|Prof|Sr|Jr|Inc|Ltd|Corp|Co|etc|vs|e\.g|i\.e|U\.S|U\.K|Ph\.D|M\.D|B\.A|M\.A|CEO|CFO|CTO|AI|API|URL|HTML|CSS|JS|PDF|FAQ|Q&A)\./gi;
  
  // Replace abbreviations temporarily
  const abbreviationMap = new Map<string, string>();
  let protectionCounter = 0;
  const tempText = cleanText.replace(abbreviations, (match) => {
    const placeholder = `__PROT_${protectionCounter++}__`;
    abbreviationMap.set(placeholder, match);
    return placeholder;
  });
  
  // Colon handling must not merge or override already-finalized sentences.
  // PHASE 2-6: Pre-pass colon detection (before period loop)
  // Colon is treated as independent discourse boundary, not subordinate to periods
  let cursor = 0;
  for (let i = 0; i < tempText.length; i++) {
    if (tempText[i] !== ':') continue;
    const beforeColon = tempText.substring(cursor, i).trim();
    const afterColon = tempText.substring(i + 1).trim();
    // Exclude list-introducing patterns
    const isListIntro = /(the following|as follows|including|such as|for example|namely)$/i.test(beforeColon);
    if (isListIntro) continue;
    // Check if colon is followed by a complete sentence
    if (isColonFollowedByFullSentence(afterColon)) {
      // Split any sentences ending with .!? in [cursor, i)
      const periodPattern = /([.!?])\s+(?=(?:["'\u201C\u201D\u2018\u2019\(\[\{]*\s*)?[A-Z0-9])/g;
      let lastEnd = cursor;
      let match;
      periodPattern.lastIndex = cursor;
      while ((match = periodPattern.exec(tempText.substring(cursor, i))) !== null) {
        const punctPosition = match.index;
        const textBefore = tempText.substring(cursor + lastEnd - cursor, cursor + punctPosition - cursor);
        if (endsWithAcademicAbbreviation(textBefore)) continue;
        if (isInsideParensOrQuotesInSentence(tempText, cursor + lastEnd - cursor, cursor + punctPosition - cursor)) continue;
        const sentenceEnd = cursor + punctPosition + 1;
        let sentence = tempText.substring(lastEnd, sentenceEnd).trim();
        abbreviationMap.forEach((original, placeholder) => {
          sentence = sentence.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
        });
        const remainingText = tempText.substring(sentenceEnd, i).trim();
        if (remainingText.length < 5 && remainingText.length > 0) continue;
        if (sentence.length >= 3) {
          const type: SentenceType = "sentence";
          sentences.push({ text: sentence, type });
        }
        lastEnd = sentenceEnd;
        while (lastEnd < i && /\s/.test(tempText[lastEnd])) lastEnd++;
        periodPattern.lastIndex = lastEnd - cursor;
      }
      // Now push only the remaining fragment + ':' as the colon sentence
      let colonSentence = tempText.substring(lastEnd, i + 1).trim();
      abbreviationMap.forEach((original, placeholder) => {
        colonSentence = colonSentence.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
      });
      const wordCount = colonSentence.split(/\s+/).filter(w => w.length > 0).length;
      const type: SentenceType = "sentence";
      sentences.push({ text: colonSentence, type });
      cursor = i + 1;
      break; // Exit pre-pass, continue with period loop from cursor
    }
  }
  
  // Step 2: Find valid sentence boundaries (same as academic)
  // Terminal punctuation followed by whitespace and a capital letter or digit
  const periodPattern = /([.!?])\s+(?=(?:["'\u201C\u201D\u2018\u2019\(\[\{]*\s*)?[A-Z0-9])/g;
  
  let lastEnd = cursor;
  let match;
  periodPattern.lastIndex = 0;
  
  while ((match = periodPattern.exec(tempText)) !== null) {
    const punctPosition = match.index;
    
    // Skip if this punctuation is before cursor (already handled by colon pre-pass)
    if (punctPosition < cursor) continue;
    
    // Check if previous token is an abbreviation
    const textBefore = tempText.substring(lastEnd, punctPosition);
    if (endsWithAcademicAbbreviation(textBefore)) {
      continue;
    }
    
    // Phase 2-5: SENTENCE-LOCAL scope check
    // Only suppress split if quotes/parens are unclosed WITHIN this sentence
    if (isInsideParensOrQuotesInSentence(tempText, lastEnd, punctPosition)) {
      continue;
    }
    
    // Extract sentence
    const sentenceEnd = punctPosition + 1; // Include the punctuation
    let sentence = tempText.substring(lastEnd, sentenceEnd).trim();
    
    // Restore protected patterns
    abbreviationMap.forEach((original, placeholder) => {
      sentence = sentence.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
    });
    
    // Minimum length check
    const remainingText = tempText.substring(sentenceEnd).trim();
    if (remainingText.length < 5 && remainingText.length > 0) {
      continue;
    }
    
    if (sentence.length >= 3) {
      // Phase 2-4: Generic type determination
      // All properly formed sentences are "sentence" type
      const type: SentenceType = "sentence";
      sentences.push({ text: sentence, type });
    }
    
    lastEnd = sentenceEnd;
    while (lastEnd < tempText.length && /\s/.test(tempText[lastEnd])) {
      lastEnd++;
    }
    periodPattern.lastIndex = lastEnd;
  }
  
  // Add remaining text as final sentence
  if (lastEnd < tempText.length) {
    let remaining = tempText.substring(lastEnd).trim();
    
    abbreviationMap.forEach((original, placeholder) => {
      remaining = remaining.replace(new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), original);
    });
    
    if (remaining.length >= 3) {
      const type: SentenceType = "sentence";
      sentences.push({ text: remaining, type });
    }
  }
  
  if (sentences.length === 0 && cleanText.length >= 3) {
    return [{ text: cleanText, type: "sentence" }];
  }
  
  return sentences;
}

/**
 * Phase 2-4: Returns SentenceUnit[] with explicit type field
 * Use this for new code that needs sentence type information
 */
export function splitIntoSentencesWithType(text: string, options?: SplitIntoSentencesOptions): SentenceUnit[] {
  if (!text || typeof text !== 'string') {
    return [];
  }

  // P1 개선: 공통 전처리 함수 사용
  const cleanText = preprocessTextForSentenceProcessing(text);

  if (cleanText.length === 0) {
    return [];
  }

  // Default archetype should be conservative. If callers omit archetype, use generic rules.
  // Upstream code should pass the detected archetype whenever available.
  const archetype = options?.archetype ?? 'generic';
  
  // Phase 2-4: Archetype-aware branching with SentenceUnit return
  let sentences: SentenceUnit[];
  
  switch (archetype) {
    case 'academic':
      console.log('[SplitIntoSentences] Using academic mode');
      sentences = splitIntoSentencesAcademic(cleanText);
      break;
    case 'literary':
      console.log('[SplitIntoSentences] Using literary mode (relaxed)');
      sentences = splitIntoSentencesLiterary(cleanText);
      break;
    case 'essay':
      console.log('[SplitIntoSentences] Using essay mode');
      sentences = splitIntoSentencesEssay(cleanText);
      break;
    case 'generic':
    default:
      console.log('[SplitIntoSentences] Using generic/default mode');
      sentences = splitIntoSentencesDefault(cleanText);
      break;
  }

  // Final filtering and validation (common to all archetypes)
  // Phase 2-3: Minimum length varies by archetype
  const minLength = archetype === 'literary' ? 1 : 2;
  
  return sentences
    .map(s => ({
      text: s.text
        .replace(/[\r\n\u000B\u000C\u0085\u2028\u2029]+/g, ' ')  // Remove all line break characters
        .replace(/[ \t]+/g, ' ')  // Normalize multiple spaces/tabs
        .trim(),
      type: s.type
    }))
    .filter(s => s.text.length >= minLength && !/^[.!?…—\-:;]+$/.test(s.text)); // Reject punctuation-only
}

/**
 * Legacy: Returns string[] for backward compatibility
 * Use splitIntoSentencesWithType for new code that needs sentence type
 */
export function splitIntoSentences(text: string, options?: SplitIntoSentencesOptions): string[] {
  const units = splitIntoSentencesWithType(text, options);
  return units.map(u => u.text);
}