/**
 * Anchor Attachment Utility V2
 * Part of unified document processing pipeline
 * 
 * Attaches DB ID-based anchors to structured content blocks
 * Uses committed paragraph/sentence IDs for stable anchor generation
 */

import { splitIntoSentences } from './textUtils.js';
import { normalizeTextForMatching, generateSentenceHash, preprocessTextForAnchor } from './hashUtils.js';
import type { StructuredBlock } from './structuredUtils.js';

// System constants for anchor schema versioning
export const CURRENT_ANCHOR_SCHEMA_VERSION = 2;

// Type definitions for anchor functionality
export interface Anchor {
  sentenceStartId: number;
  sentenceEndId: number;
  matchedSentenceCount: number;
  blockSentenceCount: number;
}

/**
 * PDF Anchor V2 - Position-based anchor for PDF restoration resilience
 * Stored within structuredContent JSON (no DB schema change required)
 * Used for Layout Track viewer restoration when sentence IDs shift
 */
export interface PdfAnchorV2 {
  page: number;
  lineYQuantized: number;  // Quantized Y position (Math.round(y / 10) * 10)
  charStart: number;       // Character start offset within the line
  charEnd: number;         // Character end offset within the line
  lineText?: string;       // Optional: first 50 chars of line for debugging
}

/**
 * Generate PDF Anchor V2 from line position data
 * @param page - 1-based page number
 * @param lineY - Y coordinate of the line
 * @param charStart - Character start position in line
 * @param charEnd - Character end position in line
 * @param lineText - Optional line text for debugging
 */
export function generatePdfAnchorV2(
  page: number,
  lineY: number,
  charStart: number,
  charEnd: number,
  lineText?: string
): PdfAnchorV2 {
  return {
    page,
    lineYQuantized: Math.round(lineY / 10) * 10,
    charStart,
    charEnd,
    lineText: lineText ? lineText.substring(0, 50) : undefined,
  };
}

/**
 * Compare two PDF Anchor V2 for approximate match
 * Used for restoration when exact positions may have shifted slightly
 */
export function matchPdfAnchorV2(
  anchor1: PdfAnchorV2,
  anchor2: PdfAnchorV2,
  toleranceY: number = 20
): boolean {
  if (anchor1.page !== anchor2.page) return false;
  if (Math.abs(anchor1.lineYQuantized - anchor2.lineYQuantized) > toleranceY) return false;
  
  // Character positions should be close
  const charOverlap = 
    anchor1.charStart <= anchor2.charEnd && 
    anchor2.charStart <= anchor1.charEnd;
  
  return charOverlap;
}

export interface StructuredBlockWithAnchor {
  type:
    | "heading"
    | "paragraph"
    | "abstract_body"     // STRUCTURAL FIX per instructions.md: translatable abstract content
    | "abstract_label"    // STRUCTURAL FIX: metadata block (non-translatable)
    | "doi"               // Metadata block (non-translatable)
    | "author"            // Metadata block (non-translatable)
    | "journal"           // Metadata block (non-translatable)
    | "affiliation"       // Metadata block (non-translatable)
    | "image"
    | "table"
    | "list"
    | "code"
    | "quote"
    | "figure";
  order: number;
  page?: number;
  caption?: string;
  origin?: { page: number; bbox: [number, number, number, number] };
  src?: string;
  html?: string;
  imageSnapshot?: boolean;
  level?: number;
  content?: string;
  sentences?: Array<{ id: string; text: string; order: number }>;  // STRUCTURAL FIX: sentences[] for anchor eligibility
  anchor?: Anchor;
}

export interface DocumentWithSentenceHashes {
  paragraphs: Array<{
    sentences: Array<{
      id: number;
      source: string;
      hash?: string;
    }>;
  }>;
}

/**
 * Calculate text similarity using Longest Common Subsequence
 */
function calculateTextSimilarity(text1: string, text2: string): number {
  const tokens1 = text1.split(/\s+/);
  const tokens2 = text2.split(/\s+/);

  // Find longest common subsequence length
  const lcsLength = longestCommonSubsequence(tokens1, tokens2);

  // Calculate similarity as LCS length / average length
  const avgLength = (tokens1.length + tokens2.length) / 2;
  return avgLength > 0 ? lcsLength / avgLength : 0;
}

/**
 * Longest Common Subsequence algorithm for token sequences
 */
function longestCommonSubsequence(arr1: string[], arr2: string[]): number {
  const dp: number[][] = Array(arr1.length + 1)
    .fill(null)
    .map(() => Array(arr2.length + 1).fill(0));

  for (let i = 1; i <= arr1.length; i++) {
    for (let j = 1; j <= arr2.length; j++) {
      if (arr1[i - 1] === arr2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  return dp[arr1.length][arr2.length];
}

/**
 * UNIFIED normalization function for consistent anchor matching
 * This MUST be used by all anchor matching functions to ensure consistency
 * Note: Uses the same function name as hashUtils for consistency
 */
function normalizeTextForAnchorMatching(text: string): string {
  // First apply advanced preprocessing
  const preprocessed = preprocessTextForAnchor(text);
  
  // Then apply the standard normalization from hashUtils
  return normalizeTextForMatching(preprocessed);
}

/**
 * Calculate dynamic similarity threshold based on sentence characteristics
 * Enhanced version targeting ≥90% minimum anchor matching rate
 * P1 개선: 짧은 문장 <20자 → 더 관대한 임계값 적용
 */
function getDynamicSimilarityThreshold(sentenceText: string): number {
  const length = sentenceText.length;
  const wordCount = sentenceText.split(/\s+/).length;
  const SHORT_SENTENCE_LEN = 20; // instructions.md 기준: 20자 미만 문장
  
  // Calculate complexity-based adjustments
  const hasNumbers = /\d/.test(sentenceText);
  const hasSpecialChars = /[^\w\s가-힣]/.test(sentenceText);
  const hasKorean = /[가-힣]/.test(sentenceText);
  
  let baseThreshold: number;
  
  // P1 개선: 20자 미만 문장에 더 관대한 임계값
  if (length < 10) {
    // 극단적으로 짧은 문장 - 매우 관대한 임계값
    baseThreshold = 0.35;
  } else if (length < SHORT_SENTENCE_LEN) {
    // 짧은 문장 (<20자) - 관대한 임계값
    baseThreshold = 0.40;
  } else if (length < 40) {
    // 중간 길이 문장 - 보통 임계값
    baseThreshold = 0.50;
  } else if (length < 80) {
    // Medium-short sentences
    baseThreshold = 0.55;
  } else if (length < 150) {
    // Medium sentences
    baseThreshold = 0.60;
  } else if (length < 300) {
    // Long sentences  
    baseThreshold = 0.65;
  } else {
    // Very long sentences - higher threshold for accuracy
    baseThreshold = 0.70;
  }
  
  // Apply complexity adjustments
  if (hasNumbers) baseThreshold -= 0.05; // Numbers can vary
  if (hasSpecialChars) baseThreshold -= 0.03; // Special chars may differ
  if (hasKorean) baseThreshold -= 0.02; // Korean text processing variations
  if (wordCount < 3) baseThreshold -= 0.10; // Very short text needs lower threshold
  
  // Ensure threshold stays within reasonable bounds
  return Math.max(0.35, Math.min(0.85, baseThreshold));
}

/**
 * Enhanced text similarity calculation with multiple algorithms
 * Combines token-based, character-level, and fuzzy matching for optimal results
 */
function calculateAdvancedSimilarity(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  if (text1 === text2) return 1;
  
  // Primary: Token-based LCS similarity
  const tokenSimilarity = calculateTextSimilarity(text1, text2);
  
  // Secondary: Character-level similarity (especially useful for short texts)
  const charSimilarity = calculateCharacterSimilarity(text1, text2);
  
  // Tertiary: Jaccard similarity for token overlap
  const jaccardSimilarity = calculateJaccardSimilarity(text1, text2);
  
  // Quaternary: Fuzzy sequence matching
  const fuzzyScore = calculateFuzzySequenceMatch(text1, text2);
  
  // Weighted combination based on text characteristics
  const length1 = text1.length;
  const length2 = text2.length;
  const avgLength = (length1 + length2) / 2;
  
  if (avgLength < 20) {
    // Very short texts: prioritize character-level and fuzzy matching
    return Math.max(
      charSimilarity * 0.4 + tokenSimilarity * 0.3 + jaccardSimilarity * 0.2 + fuzzyScore * 0.1,
      Math.max(charSimilarity, tokenSimilarity)
    );
  } else if (avgLength < 60) {
    // Short texts: balanced approach
    return Math.max(
      tokenSimilarity * 0.4 + charSimilarity * 0.3 + jaccardSimilarity * 0.2 + fuzzyScore * 0.1,
      Math.max(tokenSimilarity, charSimilarity)
    );
  } else {
    // Longer texts: prioritize token-based methods
    return Math.max(
      tokenSimilarity * 0.5 + jaccardSimilarity * 0.3 + charSimilarity * 0.1 + fuzzyScore * 0.1,
      tokenSimilarity
    );
  }
}

/**
 * Character-level similarity calculation for short sentence matching
 */
function calculateCharacterSimilarity(text1: string, text2: string): number {
  const maxLength = Math.max(text1.length, text2.length);
  if (maxLength === 0) return 1;
  
  const distance = levenshteinDistance(text1, text2);
  return 1 - (distance / maxLength);
}

/**
 * Levenshtein distance calculation
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
  
  for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
  for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
  
  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1,        // deletion
        matrix[j - 1][i] + 1,        // insertion
        matrix[j - 1][i - 1] + indicator // substitution
      );
    }
  }
  
  return matrix[str2.length][str1.length];
}

/**
 * Jaccard similarity calculation for token overlap
 */
function calculateJaccardSimilarity(text1: string, text2: string): number {
  const tokens1 = new Set(text1.split(/\s+/).filter(t => t.length > 0));
  const tokens2 = new Set(text2.split(/\s+/).filter(t => t.length > 0));
  
  if (tokens1.size === 0 && tokens2.size === 0) return 1;
  if (tokens1.size === 0 || tokens2.size === 0) return 0;
  
  const intersection = new Set(Array.from(tokens1).filter(x => tokens2.has(x)));
  const union = new Set(Array.from(tokens1).concat(Array.from(tokens2)));
  
  return intersection.size / union.size;
}

/**
 * Fuzzy sequence matching for handling text variations
 */
function calculateFuzzySequenceMatch(text1: string, text2: string): number {
  if (!text1 || !text2) return 0;
  if (text1 === text2) return 1;
  
  const tokens1 = text1.split(/\s+/);
  const tokens2 = text2.split(/\s+/);
  
  let matches = 0;
  const used = new Set<number>();
  
  // Find fuzzy matches between tokens
  for (const token1 of tokens1) {
    let bestMatch = -1;
    let bestScore = 0;
    
    for (let i = 0; i < tokens2.length; i++) {
      if (used.has(i)) continue;
      
      const token2 = tokens2[i];
      let score = 0;
      
      // Exact match
      if (token1 === token2) {
        score = 1;
      } else if (token1.length > 2 && token2.length > 2) {
        // Fuzzy match for longer tokens
        const maxLen = Math.max(token1.length, token2.length);
        const editDistance = levenshteinDistance(token1, token2);
        score = 1 - (editDistance / maxLen);
        
        // Only consider as match if similarity is reasonably high
        if (score < 0.7) score = 0;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = i;
      }
    }
    
    if (bestMatch !== -1 && bestScore > 0.7) {
      matches += bestScore;
      used.add(bestMatch);
    }
  }
  
  const maxPossibleMatches = Math.max(tokens1.length, tokens2.length);
  return maxPossibleMatches > 0 ? matches / maxPossibleMatches : 0;
}

/**
 * LEGACY anchor attachment function - will be replaced by V2
 */
function attachAnchorsToStructuredContentLegacy(
  structuredBlocks: Array<any>,
  documentWithSentences: any,
): Array<any> {
  console.log(
    "[ANCHOR_GENERATION] Attaching anchors to",
    structuredBlocks.length,
    "structured blocks",
  );

  if (!documentWithSentences?.paragraphs) {
    console.warn(
      "[ANCHOR_GENERATION] No paragraphs found in document, skipping anchor generation",
    );
    return structuredBlocks;
  }

  // **CRITICAL FIX**: Extract sentences from the SAME structured blocks used for anchor generation
  // This ensures "Single Source of Truth" - same text extraction for both storage and anchoring
  console.log(
    '[ANCHOR_GENERATION] Using "Single Source of Truth" approach - extracting sentences from structured blocks',
  );

  const allSentences: Array<{ id: number; content: string; hash: string }> = [];
  let sentenceIndex = 0;

  // Get sentence IDs from stored paragraphs in order
  const storedSentenceIds: number[] = [];
  documentWithSentences.paragraphs.forEach((paragraph: any) => {
    if (paragraph.sentences) {
      paragraph.sentences.forEach((sentence: any) => {
        if (sentence.id) {
          storedSentenceIds.push(sentence.id);
        }
      });
    }
  });

  // Extract sentences from the same structured blocks being used for rendering
  // STRUCTURAL FIX: Eligibility determined by sentences[] presence, not block type
  structuredBlocks.forEach((block: any) => {
    // Use block.sentences[] directly if available, otherwise fall back to splitIntoSentences
    const blockSentences = block.sentences && block.sentences.length > 0
      ? block.sentences.map((s: any) => s.text)
      : (block.content ? splitIntoSentences(block.content) : []);
    
    if (blockSentences.length > 0) {
      blockSentences.forEach((sentence: string) => {
        if (sentenceIndex < storedSentenceIds.length) {
          const sentenceId = storedSentenceIds[sentenceIndex];
          const normalizedText = normalizeTextForAnchorMatching(sentence);
          const hash = generateSentenceHash(sentence);
          allSentences.push({
            id: sentenceId,
            content: normalizedText,
            hash: hash,
          });
          sentenceIndex++;
        }
      });
    }
  });

  console.log(
    `[ANCHOR_GENERATION] Found ${allSentences.length} sentences with IDs for matching`,
  );

  // Debug: Show sentence ID range we're working with for anchor generation
  if (allSentences.length > 0) {
    const sentenceIds = allSentences.map((s) => s.id).sort((a, b) => a - b);
    console.log(
      `[ANCHOR_GENERATION] Working with sentence ID range ${sentenceIds[0]}-${sentenceIds[sentenceIds.length - 1]} (${allSentences.length} sentences)`,
    );

    console.log("[ANCHOR_GENERATION] Sample sentence hashes:");
    allSentences.slice(0, 3).forEach((s) => {
      console.log(
        `  ID ${s.id}: "${s.content.substring(0, 40)}..." → ${s.hash.substring(0, 8)}...`,
      );
    });
  }

  // Process each structured block
  // STRUCTURAL FIX: Anchor eligibility determined by sentences[] presence only
  const blocksWithAnchors = structuredBlocks.map((block, index) => {
    const blockWithAnchor = { ...block };

    // Use block.sentences[] directly if available, otherwise fall back to splitIntoSentences
    const blockSentences = block.sentences && block.sentences.length > 0
      ? block.sentences.map((s: any) => s.text)
      : (block.content ? splitIntoSentences(block.content) : []);

    if (blockSentences.length > 0) {
      // Hash-based sentence matching for all translatable blocks
      const matchedSentenceIds: number[] = [];

      blockSentences.forEach((blockSentence: string) => {
        const blockSentenceHash = generateSentenceHash(blockSentence);

        // Find exact hash match
        const matchingSentence = allSentences.find(
          (s) => s.hash === blockSentenceHash,
        );
        if (matchingSentence) {
          matchedSentenceIds.push(matchingSentence.id);
          console.log(
            `[ANCHOR_GENERATION] ✅ Hash match found: "${blockSentence.substring(0, 40)}..." → sentence ID ${matchingSentence.id}`,
          );
        } else {
          console.log(
            `[ANCHOR_GENERATION] ❌ No hash match for: "${blockSentence.substring(0, 40)}..." (hash: ${blockSentenceHash.substring(0, 8)}...)`,
          );
        }
      });

      if (matchedSentenceIds.length > 0) {
        // Sort sentence IDs to ensure correct range
        matchedSentenceIds.sort((a, b) => a - b);

        blockWithAnchor.anchor = {
          sentenceStartId: matchedSentenceIds[0],
          sentenceEndId: matchedSentenceIds[matchedSentenceIds.length - 1],
          matchedSentenceCount: matchedSentenceIds.length,
          blockSentenceCount: blockSentences.length,
        };

        console.log(
          `[ANCHOR_GENERATION] Block ${index} (${block.type}) anchored to sentences ${matchedSentenceIds[0]}-${matchedSentenceIds[matchedSentenceIds.length - 1]} (${matchedSentenceIds.length}/${blockSentences.length} matched)`,
        );
      } else {
        console.warn(
          `[ANCHOR_GENERATION] Block ${index} (${block.type}) - no sentence matches found for content: "${(block.content || '').substring(0, 60)}..."`,
        );
      }
    } else {
      console.log(
        `[ANCHOR_GENERATION] Block ${index} (${block.type}) - skipping block without sentences`,
      );
    }

    return blockWithAnchor;
  });

  const anchoredCount = blocksWithAnchors.filter((b: any) => b.anchor).length;
  console.log(
    `[ANCHOR_GENERATION] ✅ Anchor generation complete. ${anchoredCount}/${structuredBlocks.length} blocks anchored`,
  );

  return blocksWithAnchors;
}

/**
 * Attach anchors to structured content blocks using committed DB IDs
 * This is the new unified function for the V2 architecture
 */
export async function attachAnchorsToStructuredContent(
  structuredBlocks: StructuredBlock[],
  documentData: {
    paragraphs: Array<{
      id: number;
      order: number;
      sentences: Array<{
        id: number;
        order: number;
        source: string;
      }>;
    }>;
  }
): Promise<StructuredBlockWithAnchor[]> {
  // STEP 1 FIX: Input validation to ensure stable processing
  const safeBlocks = Array.isArray(structuredBlocks) ? structuredBlocks : [];
  const safeDocument = documentData && Array.isArray(documentData.paragraphs) ? documentData : { paragraphs: [] };
  
  console.log(`[AnchorUtils] Attaching anchors to ${safeBlocks.length} blocks using DB IDs`);
  
  // CRITICAL FIX: Always return array even on early exit
  if (safeBlocks.length === 0) {
    console.warn('[AnchorUtils] No blocks provided, returning empty array');
    return [];
  }
  
  if (safeDocument.paragraphs.length === 0) {
    console.warn('[AnchorUtils] No paragraphs provided, returning blocks without anchors');
    return safeBlocks.map(block => ({ ...block }));
  }
  
  const startTime = Date.now();
  let attachedCount = 0;
  
  try {
    // Create flat sentence list with DB IDs for mapping
    const allSentences = safeDocument.paragraphs
      .flatMap(p => p.sentences.map(s => ({
        id: s.id,
        paragraphId: p.id,
        order: s.order,
        source: s.source,
        // STEP 2 FIX: Use stored hash if available, fallback to generating it
        hash: (s as any).sourceHash || generateSentenceHash(s.source)
      })))
      .sort((a, b) => a.id - b.id); // Sort by DB ID for stable mapping
    
    console.log(`[AnchorUtils] Available sentences for matching: ${allSentences.length} (ID range: ${allSentences[0]?.id}-${allSentences[allSentences.length-1]?.id})`);
    
    const blocksWithAnchors: StructuredBlockWithAnchor[] = [];
    const usedSentenceIds = new Set<number>(); // Track used IDs to prevent overlaps
    
    for (const block of safeBlocks) {
      const blockWithAnchor: StructuredBlockWithAnchor = { ...block };
      
      // STRUCTURAL FIX: Anchor eligibility determined by sentences[] presence only, not by block type
      // Check for sentences[] first, then fall back to content-based check
      const hasSentences = block.sentences && block.sentences.length > 0;
      const hasContent = block.content && block.content.length > 20;
      
      if (hasSentences || hasContent) {
        try {
          const anchor = await generateAnchorForBlock(block, allSentences, usedSentenceIds);
          if (anchor) {
            blockWithAnchor.anchor = anchor;
            attachedCount++;
            
            // Mark sentences as used to prevent overlaps
            for (let id = anchor.sentenceStartId; id <= anchor.sentenceEndId; id++) {
              usedSentenceIds.add(id);
            }
            
            console.log(`[AnchorUtils] Block ${block.order} (${block.type}) anchored to sentences ${anchor.sentenceStartId}-${anchor.sentenceEndId}`);
          } else {
            console.warn(`[AnchorUtils] Block ${block.order} (${block.type}) could not be anchored - no matching sentences found`);
          }
        } catch (error) {
          console.warn(`[AnchorUtils] Failed to generate anchor for block ${block.order}:`, error);
        }
      }
      
      blocksWithAnchors.push(blockWithAnchor);
    }
    
    const duration = Date.now() - startTime;
    const successRate = safeBlocks.length > 0 ? (attachedCount / safeBlocks.length * 100).toFixed(1) : "0";
    const anchorsAttachedRate = parseFloat(successRate) / 100;
    
    // Enhanced logging with KPI metrics following instructions.md format  
    console.log(`[AnchorUtils] Enhanced V2.2 - anchors attached ${attachedCount}/${safeBlocks.length} | rate: ${successRate}% | duration: ${duration}ms`);
    
    // KPI Target Validation (from instructions.md)
    const KPI_TARGET_AVERAGE = 95; // 95% target from instructions
    const KPI_TARGET_MINIMUM = 90; // 90% minimum from instructions
    
    if (anchorsAttachedRate * 100 >= KPI_TARGET_AVERAGE) {
      console.log(`[AnchorUtils] ✅ KPI SUCCESS: Above ${KPI_TARGET_AVERAGE}% target (${successRate}%)`);
    } else if (anchorsAttachedRate * 100 >= KPI_TARGET_MINIMUM) {
      console.log(`[AnchorUtils] ⚠️ KPI WARNING: Below ${KPI_TARGET_AVERAGE}% target but above ${KPI_TARGET_MINIMUM}% minimum (${successRate}%)`);
    } else {
      console.log(`[AnchorUtils] ❌ KPI FAILURE: Below ${KPI_TARGET_MINIMUM}% minimum threshold (${successRate}%)`);
    }
    
    // Performance guard check
    if (duration > 500) {
      console.warn(`[AnchorUtils] Performance warning: Anchor attachment took ${duration}ms (>500ms threshold)`);
    }
    
    // CRITICAL FIX: Always return the processed blocks array
    return blocksWithAnchors;
    
  } catch (error) {
    console.error('[AnchorUtils] Error attaching anchors to structured content:', error);
    // STEP 1 FIX: Always return array, even on internal errors
    // Return original blocks without anchors as safe fallback
    return safeBlocks.map(block => ({ ...block }));
  }
}

/**
 * Generate anchor for a single block using DB-committed sentence IDs with V2 improvements
 * Implements dynamic thresholds and unified normalization from instructions.md
 */
async function generateAnchorForBlock(
  block: StructuredBlock,
  allSentences: Array<{
    id: number;
    paragraphId: number;
    order: number;
    source: string;
    hash: string;
  }>,
  usedSentenceIds: Set<number>
): Promise<Anchor | null> {
  // STRUCTURAL FIX: Use block.sentences[] directly when available, otherwise fall back to content
  const blockSentences = block.sentences && block.sentences.length > 0
    ? block.sentences.map((s: any) => s.text)
    : (block.content ? splitIntoSentences(block.content) : []);
  
  console.log(`[AnchorUtils] Block ${block.order}: ${blockSentences.length} sentences extracted from content`);
  if (blockSentences.length === 0) {
    console.warn(`[AnchorUtils] No sentences found in block ${block.order}`);
    return null;
  }
  
  const matches: number[] = [];
  
  // Find matching sentences using hash-based and enhanced similarity matching
  for (const blockSentence of blockSentences) {
    const blockSentenceHash = generateSentenceHash(blockSentence);
    const dynamicThreshold = getDynamicSimilarityThreshold(blockSentence);
    
    console.log(`[AnchorUtils] Matching sentence: "${blockSentence.substring(0, 60)}..." (threshold: ${(dynamicThreshold * 100).toFixed(0)}%)`);
    
    // Try exact hash match first (excluding already used sentences)
    let bestMatch = allSentences.find(s => s.hash === blockSentenceHash && !usedSentenceIds.has(s.id));
    
    // Fallback to similarity matching if no exact match
    if (!bestMatch) {
      const normalizedBlockSentence = normalizeTextForAnchorMatching(blockSentence);
      let bestSimilarity = 0;
      
      for (const sentence of allSentences) {
        // Skip already used sentences
        if (usedSentenceIds.has(sentence.id)) {
          continue;
        }
        
        const normalizedSentence = normalizeTextForAnchorMatching(sentence.source);
        const similarity = calculateAdvancedSimilarity(normalizedBlockSentence, normalizedSentence);
        
        // Use dynamic threshold based on sentence characteristics
        if (similarity > bestSimilarity && similarity >= dynamicThreshold) {
          bestSimilarity = similarity;
          bestMatch = sentence;
        }
      }
      
      if (bestMatch) {
        console.log(`[AnchorUtils] ✅ Similarity match found: ${(bestSimilarity * 100).toFixed(1)}% (req: ${(dynamicThreshold * 100).toFixed(0)}%) - sentence ID ${bestMatch.id}`);
      } else {
        console.log(`[AnchorUtils] ❌ No match found for sentence (below ${(dynamicThreshold * 100).toFixed(0)}% threshold or already used)`);
      }
    } else {
      console.log(`[AnchorUtils] ✅ Hash match found - sentence ID ${bestMatch.id}`);
    }
    
    if (bestMatch) {
      matches.push(bestMatch.id);
    }
  }
  
  if (matches.length === 0) {
    console.warn(`[AnchorUtils] No matches found for block ${block.order} - all ${blockSentences.length} sentences failed to match`);
    
    // 🔧 P0 CRITICAL FIX: 매칭 실패 시 더 관대한 방법으로 재시도
    console.log(`[AnchorUtils] Attempting fallback matching with relaxed thresholds for block ${block.order}`);
    
    for (const blockSentence of blockSentences) {
      const normalizedBlockSentence = normalizeTextForAnchorMatching(blockSentence);
      let bestSimilarity = 0;
      let bestMatch = null;
      
      for (const sentence of allSentences) {
        if (usedSentenceIds.has(sentence.id)) {
          continue;
        }
        
        const normalizedSentence = normalizeTextForAnchorMatching(sentence.source);
        const similarity = calculateAdvancedSimilarity(normalizedBlockSentence, normalizedSentence);
        
        // 🔧 매우 관대한 임계값 적용 (30% 이상)
        if (similarity > bestSimilarity && similarity >= 0.30) {
          bestSimilarity = similarity;
          bestMatch = sentence;
        }
      }
      
      if (bestMatch && bestSimilarity >= 0.30) {
        console.log(`[AnchorUtils] ✅ Fallback match found: ${(bestSimilarity * 100).toFixed(1)}% - sentence ID ${bestMatch.id}`);
        matches.push(bestMatch.id);
      }
    }
    
    // 여전히 매칭이 안되면 null 리턴
    if (matches.length === 0) {
      console.warn(`[AnchorUtils] Even fallback matching failed for block ${block.order}`);
      return null;
    }
  }
  
  // Ensure matches are consecutive for cleaner anchor ranges
  matches.sort((a, b) => a - b);
  const minId = Math.min(...matches);
  const maxId = Math.max(...matches);
  
  // Validate that we're not creating overlapping anchors
  for (let id = minId; id <= maxId; id++) {
    if (usedSentenceIds.has(id)) {
      console.warn(`[AnchorUtils] Overlap detected: sentence ${id} already used, skipping block ${block.order}`);
      return null;
    }
  }
  
  return {
    sentenceStartId: minId,
    sentenceEndId: maxId,
    matchedSentenceCount: matches.length,
    blockSentenceCount: blockSentences.length
  };
}