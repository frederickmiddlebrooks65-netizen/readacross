/**
 * Hash and text normalization utilities
 * Extracted from routes.ts as part of Step 1 refactoring
 */

import * as crypto from "crypto";
import { preprocessTextForSentenceProcessing } from './textUtils.js';

/**
 * Enhanced text normalization for consistent hash generation and anchor matching
 * Supports multilingual content including Korean text
 */
export function normalizeTextForMatching(text: string): string {
  return text
    .toLowerCase() // Convert to lowercase
    // Handle smart quotes and special punctuation
    .replace(/[""''`]/g, '"') // Normalize quote marks
    .replace(/[–—]/g, "-") // Normalize dashes
    .replace(/[…]/g, "...") // Normalize ellipsis
    // Replace various hyphens and dashes with spaces
    .replace(/[-‐−–—]/g, " ")
    // Replace line breaks and whitespace variants with spaces
    .replace(/[\r\n\f\v\t]+/g, " ")
    // Keep alphanumeric, spaces, and Korean characters (가-힣), remove other punctuation
    .replace(/[^\w\s가-힣]/g, " ")
    // Normalize multiple spaces to single space
    .replace(/\s+/g, " ")
    // Remove leading/trailing whitespace
    .trim();
}

/**
 * Generate SHA1 hash for sentence content
 * P1 개선: splitIntoSentences()와 동일한 전처리 로직 적용
 */
export function generateSentenceHash(sentenceText: string): string {
  // Step 1: splitIntoSentences()와 동일한 공통 전처리 적용
  const preprocessed = preprocessTextForSentenceProcessing(sentenceText);
  
  // Step 2: Apply standard normalization
  const normalizedText = normalizeTextForMatching(preprocessed);
  return crypto.createHash("sha1").update(normalizedText, "utf8").digest("hex");
}

/**
 * Enhanced sentence creation with hash generation
 */
export function createSentenceWithHash(
  text: string,
  order: number,
): {
  order: number;
  source: string;
  hash?: string;
} {
  return {
    order,
    source: text,
    hash: generateSentenceHash(text),
  };
}

/**
 * Advanced text preprocessing for better anchor matching
 * Handles edge cases and improves normalization consistency
 */
export function preprocessTextForAnchor(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }
  
  return text
    // Remove zero-width characters and invisible characters
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    // Normalize Unicode to NFC form for consistent character representation
    .normalize('NFC')
    // Replace HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    // Apply standard normalization
    .split('').map(char => {
      // Handle specific problematic characters
      const code = char.charCodeAt(0);
      // Replace various space-like characters with regular space
      if ((code >= 0x2000 && code <= 0x200A) || code === 0x2028 || code === 0x2029) {
        return ' ';
      }
      return char;
    }).join('')
    .trim();
}