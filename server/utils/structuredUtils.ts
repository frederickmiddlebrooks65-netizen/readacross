/**
 * Structured Content Generation Utility V2
 * Refactored for unified document processing pipeline
 *
 * Generates anchor-free structured blocks from raw content
 * Anchors are attached separately by anchorUtils.ts
 * 
 * STRUCTURAL FIX per instructions.md:
 * - All translatable blocks (heading, paragraph, abstract) own sentences[]
 * - Downstream consumes sentences[] only, regardless of block type
 */

import { splitIntoParagraphs, splitIntoSentences } from './textUtils.js';
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import { URL } from "url";

// Parser Mode System - instructions.md implementation
export enum ParserMode {
  HTML = "html",
  TEXT = "text",
  PDF = "pdf",
  AUTO = "auto",
  STRUCTURE_ONLY = "structure-only"  // 🔧 NEW: Assembly-only mode for pre-cleaned content (no parsing/normalization)
}

// Parser options interface
export interface ParserOptions {
  mode?: ParserMode;
  whitelistTags?: string[];
  minBlockLength?: number;
  enableCaching?: boolean;
}

/**
 * 🔧 NEW: Enhanced heading classification for academic content
 * Implements the improved logic from the development plan 
 */
function shouldClassifyAsHeading(text: string, options: { isArxivContent?: boolean } = {}): boolean {
  if (!text || text.length > 200) return false;

  // 🔧 CRITICAL: Abstract/Introduction 섹션 헤딩 최소화
  // 실제 헤딩 신호가 있을 때만 헤딩으로 분류
  const HEADING_STOPWORDS = /^(abstract|introduction)$/i;

  if (HEADING_STOPWORDS.test(text.trim())) {
    // arXiv 컨텐츠의 경우 더 보수적으로 접근
    if (options.isArxivContent) {
      console.log(`[HeadingClassification] 🎯 arXiv content: Treating "${text}" as paragraph (not heading)`);
      return false;
    }

    // 일반 컨텐츠에서도 기본적으로는 본문으로 처리
    console.log(`[HeadingClassification] Treating "${text}" as paragraph (reduced synthetic headings)`);
    return false;
  }

  // 다른 학술 섹션들은 조건부로 헤딩 처리
  const ACADEMIC_SECTIONS = /^(conclusion|discussion|method|methodology|results|related work|references|bibliography|acknowledgments|future work|limitations)$/i;

  if (ACADEMIC_SECTIONS.test(text.trim())) {
    // 짧고 독립적인 라인인 경우에만 헤딩으로 처리
    if (text.length < 50 && !text.includes('.')) {
      return true;
    }
    return false;
  }

  // 기존의 다른 헤딩 패턴들은 유지
  if (text.length < 80 && text.match(/^[A-Z][A-Za-z\s\d\-]{2,}[^.!?]$/)) {
    return true;
  }

  return false;
}

/**
 * 🔧 NEW: Get appropriate heading level based on content
 */
function getHeadingLevel(text: string): number {
  const trimmed = text.trim().toLowerCase();

  // Major sections get level 2
  if (/^(conclusion|discussion|methodology|results|references|bibliography)$/i.test(trimmed)) {
    return 2;
  }

  // Sub-sections get level 3
  if (/^(related work|future work|limitations|acknowledgments)$/i.test(trimmed)) {
    return 3;
  }

  // Default to level 3 for other headings
  return 3;
}

/**
 * Check if a URL/domain is from arXiv
 * Enhanced detection for arXiv domains and URLs
 */
export function isArxivDomain(source?: string): boolean {
  if (!source || typeof source !== 'string') {
    return false;
  }

  const sourceStr = source.toLowerCase();

  // Direct domain check
  if (sourceStr.includes('arxiv.org')) {
    return true;
  }

  // Check if it's an arXiv-style ID pattern (e.g., "2301.13688")
  if (/\d{4}\.\d{4,5}/.test(sourceStr)) {
    return true;
  }

  try {
    const url = new URL(sourceStr);
    const hostname = url.hostname.toLowerCase();
    return hostname === 'arxiv.org' || hostname.endsWith('.arxiv.org');
  } catch {
    return false;
  }
}

/**
 * Check if source domain should force HTML parsing mode
 * These domains have rich structure that should always be parsed as HTML
 * 🔧 ENHANCED: Stronger arXiv detection for HTML mode forcing
 */
function shouldForceHtmlMode(source?: string, content?: string, originalUrl?: string): boolean {
  if (!source && !content && !originalUrl) return false;

  // 🔧 CRITICAL: arXiv 도메인은 항상 HTML 모드로 강제
  if (isArxivDomain(source) || isArxivDomain(originalUrl)) {
    console.log(`[ParserMode] 🎯 FORCING HTML mode for arXiv domain: ${source || originalUrl}`);
    return true;
  }

  // Check source domain for other structured content providers
  const structuredDomains = [
    'pubmed.ncbi.nlm.nih.gov', 
    'scholar.google.com',
    'researchgate.net',
    'ieee.org',
    'acm.org',
    'springerlink.com',
    'nature.com',
    'science.org',
    'semanticscholar.org',
    'acl-arc.comp.nus.edu.sg'
  ];

  const sourceStr = source?.toLowerCase() || '';
  const urlStr = originalUrl?.toLowerCase() || '';
  const forcedByDomain = structuredDomains.some(domain => 
    sourceStr.includes(domain) || urlStr.includes(domain)
  );

  // Check content for academic/structured indicators
  let forcedByContent = false;
  if (content) {
    const academicIndicators = [
      'arxiv:',
      'doi:',
      'abstract',
      'introduction',
      'methodology',
      'results',
      'conclusion',
      'references',
      'figure',
      'table',
      'equation',
      'citation',
      'bibliography'
    ];
    const contentLower = content.toLowerCase();
    const indicatorCount = academicIndicators.filter(indicator => 
      contentLower.includes(indicator)
    ).length;

    // If 3+ academic indicators, likely structured content
    forcedByContent = indicatorCount >= 3;
  }

  const shouldForce = forcedByDomain || forcedByContent;
  if (shouldForce) {
    console.log(`[ParserMode] 🎯 FORCING HTML mode for structured domain/content: ${sourceStr || urlStr}`);
  }

  return shouldForce;
}

/**
 * Enhanced content quality detection for AUTO mode
 * Returns appropriate parser mode based on comprehensive content analysis
 * Addresses instructions.md requirements for better mode selection
 */
export function detectContentQuality(raw: string, source?: string, originalUrl?: string): ParserMode {
  const hasTags = /<\w+[\s\S]*?>/.test(raw);
  if (!hasTags) return ParserMode.TEXT;

  // 🔧 HOTFIX 1: Force HTML mode for structured domains  
  if (shouldForceHtmlMode(source, raw, originalUrl)) {
    return ParserMode.HTML;
  }

  const contentLength = raw.length;

  // For short content (< 3000 chars), prefer TEXT mode to avoid over-splitting
  if (contentLength < 3000) {
    console.log(`[ParserMode] Short content (${contentLength} chars) - using TEXT mode`);
    return ParserMode.TEXT;
  }

  // Calculate quality score based on structural tag density and quality
  const score = calculateHtmlQualityScore(raw);

  // Enhanced threshold - be more conservative about HTML mode
  // Lower threshold from 0.5 to 0.6 to prefer TEXT mode more often
  const useHtml = score > 0.6;

  console.log(`[ParserMode] Content quality score: ${score.toFixed(2)} - ${useHtml ? 'HTML' : 'TEXT'} mode selected (length: ${contentLength})`);

  return useHtml ? ParserMode.HTML : ParserMode.TEXT;
}

/**
 * Enhanced RSS content analysis - determines if TEXT mode would be more effective
 * Addresses excessive block splitting problem identified in instructions.md
 */
async function shouldUseTextModeForRSS(rawContent: string): Promise<boolean> {
  const contentLength = rawContent.length;

  // For shorter RSS content (< 5000 chars), prefer TEXT mode to prevent over-splitting
  if (contentLength < 5000) {
    console.log(`[RSS Analysis] Short content (${contentLength} chars) - recommending TEXT mode`);
    return true;
  }

  // Apply Readability preprocessing for better structure analysis
  let analyzableContent = rawContent;
  try {
    if (rawContent.includes("<html") || rawContent.includes("<body") || rawContent.includes("<head")) {
      console.log(`[RSS Analysis] Applying Readability for structure analysis`);
      const dom = new JSDOM(rawContent, { url: "https://example.com" });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (article && article.content) {
        analyzableContent = article.content;
        console.log(`[RSS Analysis] Using Readability-cleaned content for analysis (${analyzableContent.length} chars)`);
      }
    }
  } catch (error) {
    console.warn(`[RSS Analysis] Readability preprocessing failed:`, error);
  }

  // Calculate HTML structure density on cleaned content
  const htmlQuality = calculateHtmlQualityScore(analyzableContent);

  // If HTML structure is poor (< 0.4), use TEXT mode
  if (htmlQuality < 0.4) {
    console.log(`[RSS Analysis] Poor HTML quality (${htmlQuality.toFixed(2)}) - recommending TEXT mode`);
    return true;
  }

  // Check for excessive small elements that would cause over-splitting
  try {
    const dom = new JSDOM(analyzableContent);
    const paragraphs = Array.from(dom.window.document.querySelectorAll('p'));
    const divs = Array.from(dom.window.document.querySelectorAll('div'));

    const totalElements = paragraphs.length + divs.length;
    const avgElementLength = totalElements > 0 ? 
      [...paragraphs, ...divs].reduce((sum, el) => sum + ((el as Element).textContent?.length || 0), 0) / totalElements : 0;

    // If average element length is too small, it will cause over-splitting
    if (avgElementLength < 100 && totalElements > 20) {
      console.log(`[RSS Analysis] Over-splitting risk detected (${totalElements} elements, avg ${avgElementLength.toFixed(0)} chars) - recommending TEXT mode`);
      return true;
    }
  } catch (error) {
    console.warn(`[RSS Analysis] Error analyzing HTML structure:`, error);
    return true; // Default to TEXT mode on error
  }

  console.log(`[RSS Analysis] Good HTML structure detected - using HTML mode`);
  return false;
}

/**
 * Calculate HTML quality score (0-1 scale)
 * Higher score indicates better structured HTML content
 */
function calculateHtmlQualityScore(content: string): number {
  let score = 0;
  const totalLength = content.length;

  if (totalLength === 0) return 0;

  // Check structural tag density (p, br, li, h1-h6)
  const structuralTags = content.match(/<(p|br|li|h[1-6])[^>]*>/gi) || [];
  const structuralDensity = structuralTags.length / (totalLength / 100); // tags per 100 chars
  score += Math.min(structuralDensity * 0.1, 0.4); // Max 0.4 for structural density

  // Check for proper tag closure (well-formed HTML indicator)
  const openTags = content.match(/<(\w+)[^>]*>/g) || [];
  const closeTags = content.match(/<\/(\w+)>/g) || [];
  const closureRatio = closeTags.length / Math.max(openTags.length, 1);
  score += Math.min(closureRatio * 0.3, 0.3); // Max 0.3 for tag closure

  // Check average block length (better content has reasonable paragraph sizes)
  const paragraphs = content.split(/<\/?p[^>]*>/i).filter(p => p.trim().length > 20);
  if (paragraphs.length > 0) {
    const avgBlockLength = paragraphs.reduce((sum, p) => sum + p.length, 0) / paragraphs.length;
    const lengthScore = avgBlockLength > 50 && avgBlockLength < 1000 ? 0.2 : 0;
    score += lengthScore; // Max 0.2 for reasonable block length
  }

  // Penalty for broken/malformed tags
  const brokenTags = content.match(/<[^>]*(?!>)/g) || [];
  const brokenPenalty = brokenTags.length / Math.max(openTags.length, 1) * 0.3;
  score -= brokenPenalty;

  return Math.max(0, Math.min(1, score));
}

// Sentence interface for translation pipeline (imported from pdfUtils for consistency)
export interface Sentence {
  id: string;
  text: string;
  order: number;
}

// STRUCTURAL FIX: Helper to generate sentences from content
// All translatable blocks MUST own sentences[] - downstream consumes sentences[] only
function generateSentencesFromContent(content: string, blockOrder: number): Sentence[] {
  if (!content || content.trim().length === 0) return [];
  const sentenceTexts = splitIntoSentences(content.trim());
  return sentenceTexts.map((text, index) => ({
    id: `block-${blockOrder}-sent-${index + 1}`,
    text: text.trim(),
    order: index + 1,
  }));
}

// Helper to create a translatable block with sentences[]
function createTranslatableBlock(
  type: "heading" | "paragraph" | "abstract_body",
  content: string,
  order: number,
  page?: number,
  level?: number
): StructuredBlock {
  const sentences = generateSentencesFromContent(content, order);
  return {
    type,
    content,
    sentences,
    order,
    page,
    level,
  };
}

// Helper to create a metadata block (no sentences[])
function createMetadataBlockForStructured(
  type: "abstract_label" | "doi" | "author" | "journal" | "affiliation",
  content: string,
  order: number,
  page?: number
): StructuredBlock {
  return {
    type,
    content,
    order,
    page,
    // No sentences[] - metadata blocks are non-translatable
  };
}

// Type definitions for structured content blocks (anchor-free)
// STRUCTURAL FIX per instructions.md: includes metadata types and sentences[] for translatable blocks only
export interface StructuredBlock {
  type:
    | "heading"
    | "paragraph"
    | "abstract_body"     // Translatable abstract content (has sentences[])
    | "abstract_label"    // Metadata block - non-translatable
    | "doi"               // Metadata block - non-translatable
    | "author"            // Metadata block - non-translatable
    | "journal"           // Metadata block - non-translatable
    | "affiliation"       // Metadata block - non-translatable
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
  sentences?: Sentence[];  // STRUCTURAL FIX: Translatable blocks own sentences[], metadata blocks do NOT
  // Note: anchor field is NOT included here - added later by anchorUtils
}

/**
 * Generate structured blocks from raw content (anchor-free)
 * This is the new unified entry point for all document types with AUTO mode support
 * 
 * 🔧 ARCHITECTURE FIX: PDF content now uses STRUCTURE_ONLY mode
 * - PDF content from parsePDF() is already cleaned (headers removed, ligatures normalized)
 * - STRUCTURE_ONLY mode performs assembly only: split by double-newlines, assign order
 * - NO re-parsing, NO header detection, NO normalization (trusted input)
 */
export async function generateStructuredBlocks(
  rawContent: string,
  contentType: "html" | "text" | "pdf" | "rss_html" | "auto",
  sourceName?: string,
  options?: ParserOptions,
  originalUrl?: string
): Promise<StructuredBlock[]> {
  console.log(`[StructuredUtils] Generating blocks for ${contentType} content from ${sourceName || 'Unknown'}`);

  try {
    // Determine actual parser mode
    let actualMode: ParserMode;

    if (contentType === "auto") {
      actualMode = detectContentQuality(rawContent, sourceName, originalUrl);
      console.log(`[StructuredUtils] AUTO mode detected: ${actualMode}`);
    } else {
      // Map legacy content types to parser modes with enhanced RSS handling
      if (contentType === "rss_html") {
        const useTextMode = await shouldUseTextModeForRSS(rawContent);
        actualMode = useTextMode ? ParserMode.TEXT : ParserMode.HTML;
      } else if (contentType === "pdf") {
        // 🔧 CRITICAL FIX: PDF content uses STRUCTURE_ONLY mode
        // parsePDF() has already cleaned the content - we only assemble structure
        actualMode = ParserMode.STRUCTURE_ONLY;
        console.log(`[StructuredUtils] 🔧 PDF content: Using STRUCTURE_ONLY mode (pre-cleaned by parsePDF)`);
      } else {
        const modeMap: Record<string, ParserMode> = {
          "html": ParserMode.HTML,
          "text": ParserMode.TEXT
        };
        actualMode = modeMap[contentType] || ParserMode.TEXT;
      }
    }

    console.log(`[StructuredUtils] Content length: ${rawContent.length} chars, using mode: ${actualMode}`);
    console.log(`[StructuredUtils] Content preview: ${rawContent.substring(0, 200)}...`);

    // Use new parser with mode-specific processing
    const blocks = await generateStructuredContentV2(
      rawContent,
      actualMode,
      sourceName,
      options,
      originalUrl
    );

    console.log(`[StructuredUtils] Generated ${blocks.length} anchor-free blocks for ${contentType} content`);
    if (blocks.length === 0) {
      console.warn(`[StructuredUtils] No blocks generated from content!`);
    }

    return blocks;

  } catch (error) {
    console.error(`[StructuredUtils] Error generating structured blocks:`, error);
    // Return basic paragraph structure as fallback
    return [{
      type: "paragraph",
      order: 1,
      content: rawContent.substring(0, 1000) + (rawContent.length > 1000 ? "..." : "")
    }];
  }
}

/**
 * V2 Structured Content Parser with mode-specific processing and whitelist filtering
 * Implements instructions.md specifications for improved anchor matching
 */
export async function generateStructuredContentV2(
  input: string,
  mode: ParserMode,
  source?: string,
  options?: ParserOptions,
  originalUrl?: string
): Promise<StructuredBlock[]> {
  const blocks: StructuredBlock[] = [];
  const startTime = Date.now();

  // 🔧 HOTFIX 1: Enhanced default options with comprehensive structure tag whitelist
  const defaultOptions: ParserOptions = {
    whitelistTags: [
      'p', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div',
      // 🔧 CRITICAL: Add structural tags that must NOT be filtered
      'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'img', 'svg', 'caption', 'section', 'article', 'main',
      // 🔧 NEW: arXiv/학술 HTML 지원 확장 - 수식과 학술 컨텐츠 태그들
      'math', 'annotation', 'semantics', 'mrow', 'mi', 'mo', 'mn', 'msup', 'msub',
      'mfrac', 'msqrt', 'mtext', 'mspace', 'maligngroup', 'malignmark',
      // 추가 HTML5 semantic tags for academic content
      'aside', 'nav', 'header', 'footer', 'details', 'summary'
    ],
    minBlockLength: 50, // Increased from 30 to prevent over-splitting
    enableCaching: true
  };
  const opts = { ...defaultOptions, ...options };

  console.log(`[StructuredContentV2] Starting ${mode} parsing with options:`, opts);

  try {
    switch (mode) {
      case ParserMode.HTML:
        return await parseHtmlContent(input, source, opts, originalUrl);
      case ParserMode.TEXT:
        return await parseTextContent(input, source, opts, originalUrl);
      case ParserMode.PDF:
        return await parsePdfContent(input, source, opts, originalUrl);
      case ParserMode.STRUCTURE_ONLY:
        // 🔧 NEW: Assembly-only mode for pre-cleaned content (e.g., PDF from parsePDF)
        return assembleStructureOnly(input, source);
      default:
        console.warn(`[StructuredContentV2] Unknown mode ${mode}, falling back to TEXT`);
        return await parseTextContent(input, source, opts, originalUrl);
    }
  } catch (error) {
    console.error(`[StructuredContentV2] Error in ${mode} parsing:`, error);
    // Fallback to basic paragraph structure
    return [{
      type: "paragraph",
      order: 1,
      content: input.substring(0, 1000) + (input.length > 1000 ? "..." : "")
    }];
  } finally {
    const duration = Date.now() - startTime;
    console.log(`[StructuredContentV2] ${mode} parsing completed in ${duration}ms`);
  }
}

/**
 * HTML Content Parser with enhanced Readability support and proper tag removal
 * Implements instructions.md requirements for enhanced RSS HTML processing
 */
async function parseHtmlContent(
  input: string,
  source?: string,
  options?: ParserOptions,
  originalUrl?: string
): Promise<StructuredBlock[]> {
  console.log(`[parseHtmlContent] Starting enhanced HTML parsing for source: ${source || 'Unknown'}`);

  // Step 1: Apply Readability for RSS and web content extraction
  let cleanedHtml = input;
  let shouldUseReadability = false;

  // Use Readability for RSS content or when HTML appears to be a full web page
  if (source?.includes("RSS") || source?.includes("NPR") || source?.includes("Guardian") || source?.includes("WIRED") ||
      input.includes("<html") || input.includes("<body") || input.includes("<head") || 
      input.includes('id="readability-page-')) {
    shouldUseReadability = true;
  }

  if (shouldUseReadability) {
    try {
      console.log(`[parseHtmlContent] Applying Readability preprocessing for ${source}`);
      const dom = new JSDOM(input, { url: "https://example.com" });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();

      if (article && article.content) {
        cleanedHtml = article.content;
        console.log(`[parseHtmlContent] ✅ Readability extracted ${cleanedHtml.length} chars of clean content`);
      } else {
        console.log(`[parseHtmlContent] ⚠️ Readability failed, using original HTML`);
      }
    } catch (error) {
      console.warn(`[parseHtmlContent] Readability error, falling back to original HTML:`, error);
    }
  }

  // Step 2: Parse the cleaned HTML content with enhanced element traversal
  const dom = new JSDOM(cleanedHtml);
  const document = dom.window.document;

  const blocks: StructuredBlock[] = [];
  let blockOrder = 0;
  const seenContent = new Set<string>();

  // Step 3: Find content root - prioritize Readability wrappers
  const readabilityPage = document.querySelector('#readability-page-1');
  const clientContent = document.querySelector('[data-journey-hook="client-content"]');
  const bodyWrapper = document.querySelector('[data-testid="BodyWrapper"]');

  // Use the most specific wrapper available
  const contentRoot = readabilityPage || clientContent || bodyWrapper || document.body || document.documentElement;

  console.log(`[parseHtmlContent] Using content root: ${
    readabilityPage ? '#readability-page-1' : 
    clientContent ? '[data-journey-hook="client-content"]' : 
    bodyWrapper ? '[data-testid="BodyWrapper"]' : 'Document body'
  }`);

  // Step 4: Enhanced traversal with improved paragraph detection for long content
  const traverseChildren = (parentElement: Element, depth: number = 0): void => {
    console.log(`[parseHtmlContent] Traversing at depth ${depth}, element: ${parentElement.tagName}, children: ${parentElement.children.length}`);

    for (const child of Array.from(parentElement.children)) {
      const tagName = child.tagName.toLowerCase();

      // 🔧 CRITICAL FIX: Better handling of containers vs content elements
      const isContainer = ['div', 'section', 'article', 'main', 'span'].includes(tagName);
      const isContentElement = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote'].includes(tagName);

      // For containers, traverse children if they exist, but also check for direct text content
      if (isContainer && child.children.length > 0) {
        // First traverse children
        traverseChildren(child, depth + 1);
        
        // Also check if this container has direct text content that wasn't in child elements
        const directText = Array.from(child.childNodes)
          .filter(node => node.nodeType === 3) // Text nodes
          .map(node => node.textContent?.trim())
          .filter(text => text && text.length > 50)
          .join(' ');
        
        if (directText) {
          blockOrder++;
          blocks.push({
            type: "paragraph",
            order: blockOrder,
            content: directText
          });
        }
        continue;
      }

      // 🔧 CRITICAL FIX: Extract and properly chunk long text content
      let textContent = '';
      if (child.textContent) {
        textContent = child.textContent
          .replace(/\s+/g, ' ')
          .trim();

        textContent = textContent
          .replace(/<[^>]*>/g, '')
          .replace(/&[a-zA-Z0-9#]+;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
      }

      console.log(`[parseHtmlContent] Processing ${tagName}: "${textContent.substring(0, 80)}..." (${textContent.length} chars)`);

      // Skip empty or very short content
      if (textContent.length < (options?.minBlockLength || 30)) {
        console.log(`[parseHtmlContent] Skipping short content: ${textContent.length} chars`);
        continue;
      }

      // Skip navigation, metadata, and ads
      if (textContent.match(/^(Posted by|Filed under|Tags:|Share:|Follow:|Subscribe:|Copyright|©|Read more|Continue reading|Advertisement|Sponsored)/i)) {
        continue;
      }

      // 🔧 NEW: For very long content, split into multiple paragraphs
      if (textContent.length > 2000) {
        console.log(`[parseHtmlContent] 🔧 Long content detected (${textContent.length} chars), splitting into paragraphs`);
        
        // Split by sentence boundaries while preserving meaning
        const sentences = textContent.split(/(?<=[.!?])\s+(?=[A-Z])/);
        let currentParagraph = '';
        let paragraphCount = 0;
        
        for (const sentence of sentences) {
          if (currentParagraph.length + sentence.length > 800 && currentParagraph.length > 0) {
            // Create a paragraph block
            blockOrder++;
            paragraphCount++;
            blocks.push({
              type: "paragraph",
              order: blockOrder,
              content: currentParagraph.trim()
            });
            currentParagraph = sentence;
          } else {
            currentParagraph += (currentParagraph ? ' ' : '') + sentence;
          }
        }
        
        // Add the final paragraph if it has content
        if (currentParagraph.trim()) {
          blockOrder++;
          paragraphCount++;
          blocks.push({
            type: "paragraph",
            order: blockOrder,
            content: currentParagraph.trim()
          });
        }
        
        console.log(`[parseHtmlContent] 🔧 Split long content into ${paragraphCount} paragraphs`);
        continue;
      }

      blockOrder++;

      // Create blocks based on tag type with meta information
      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
        const contentKey = `heading:${textContent.toLowerCase()}`;
        if (!seenContent.has(contentKey)) {
          seenContent.add(contentKey);
          blocks.push({
            type: "heading",
            level: parseInt(tagName.charAt(1)),
            order: blockOrder,
            content: textContent,
          });
        }
      } else if (tagName === 'p') {
        const normalizedText = textContent.toLowerCase().replace(/\s+/g, " ").trim();
        const contentKey = `paragraph:${normalizedText}`;

        if (!seenContent.has(contentKey)) {
          seenContent.add(contentKey);
          blocks.push({
            type: "paragraph",
            order: blockOrder,
            content: textContent,
          });
        }
      } else if (tagName === 'li') {
        blocks.push({
          type: "list",
          order: blockOrder,
          content: textContent,
        });
      } else if (tagName === 'blockquote') {
        blocks.push({
          type: "quote",
          order: blockOrder,
          content: textContent,
        });
      } else if (['img', 'figure'].includes(tagName)) {
        const alt = child.getAttribute('alt') || child.getAttribute('title') || 'Image';
        const src = child.getAttribute('src') || child.querySelector('img')?.getAttribute('src');

        blocks.push({
          type: tagName === 'figure' ? "figure" : "image",
          order: blockOrder,
          content: `[${tagName === 'figure' ? 'Figure' : 'Image'}: ${alt}]`,
          src: src || undefined,
          caption: alt
        });

        if (tagName === 'figure') {
          const figcaption = child.querySelector('figcaption');
          if (figcaption?.textContent?.trim()) {
            blockOrder++;
            blocks.push({
              type: "paragraph",
              order: blockOrder,
              content: figcaption.textContent.trim()
            });
          }
        }
      } else if (tagName === 'table') {
        const tableHtml = child.outerHTML;
        const caption = child.querySelector('caption')?.textContent?.trim() || 
                       child.getAttribute('title') || 'Table';

        blocks.push({
          type: "table",
          order: blockOrder,
          html: tableHtml,
          content: `[Table: ${caption}]`,
          caption: caption
        });
      } else {
        // For unrecognized elements with content, treat as paragraph
        if (textContent.length > 30) {
          blocks.push({
            type: "paragraph",
            order: blockOrder,
            content: textContent,
          });
        }
      }
    }
  };

  // Start traversal from content root with enhanced logging
  console.log(`[parseHtmlContent] Starting traversal from: ${contentRoot.tagName}`);
  console.log(`[parseHtmlContent] Content root has ${contentRoot.children.length} direct children`);

  traverseChildren(contentRoot);

  console.log(`[parseHtmlContent] Found ${blocks.length} elements through direct traversal`);

  // Step 5: Enhanced fallback with better paragraph detection
  if (blocks.length === 0) {
    console.log(`[parseHtmlContent] No structured content found, trying fallback text extraction`);
    const allText = contentRoot.textContent?.trim() || "";
    if (allText.length > 100) {
      console.log(`[parseHtmlContent] Fallback processing ${allText.length} chars of text`);
      
      // Try multiple splitting strategies
      let textParagraphs: string[] = [];
      
      // Strategy 1: Split by double newlines
      textParagraphs = allText.split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim());
      
      // Strategy 2: If that doesn't work well, split by sentence groups
      if (textParagraphs.length < 3 && allText.length > 1000) {
        console.log(`[parseHtmlContent] Using sentence-based splitting for long text`);
        const sentences = allText.split(/(?<=[.!?])\s+(?=[A-Z])/);
        textParagraphs = [];
        let currentParagraph = '';
        
        for (const sentence of sentences) {
          if (currentParagraph.length + sentence.length > 800 && currentParagraph.length > 0) {
            textParagraphs.push(currentParagraph.trim());
            currentParagraph = sentence;
          } else {
            currentParagraph += (currentParagraph ? ' ' : '') + sentence;
          }
        }
        
        if (currentParagraph.trim()) {
          textParagraphs.push(currentParagraph.trim());
        }
      }
      
      // Filter and create blocks
      textParagraphs = textParagraphs.filter(p => p.length > 50);

      textParagraphs.forEach((paragraph, index) => {
        blocks.push({
          type: "paragraph",
          order: index + 1,
          content: paragraph,
        });
      });

      console.log(`[parseHtmlContent] Fallback extraction created ${blocks.length} blocks from ${allText.length} chars`);
    }
  }
  
  // Step 6: Final check for single massive block that should be split
  if (blocks.length === 1 && blocks[0].content && blocks[0].content.length > 1500) {
    console.log(`[parseHtmlContent] 🔧 Single large block detected (${blocks[0].content.length} chars), attempting to split`);
    const largeBlock = blocks[0];
    const blockContent = largeBlock.content || '';
    const sentences = blockContent.split(/(?<=[.!?])\s+(?=[A-Z])/);
    
    if (sentences.length > 10) {
      console.log(`[parseHtmlContent] 🔧 Splitting large block into ${Math.ceil(sentences.length / 8)} smaller blocks`);
      blocks.splice(0, 1); // Remove the large block
      
      let currentParagraph = '';
      let blockIndex = 1;
      
      for (const sentence of sentences) {
        if (currentParagraph.length + sentence.length > 800 && currentParagraph.length > 0) {
          blocks.push({
            type: "paragraph",
            order: blockIndex++,
            content: currentParagraph.trim()
          });
          currentParagraph = sentence;
        } else {
          currentParagraph += (currentParagraph ? ' ' : '') + sentence;
        }
      }
      
      if (currentParagraph.trim()) {
        blocks.push({
          type: "paragraph",
          order: blockIndex,
          content: currentParagraph.trim()
        });
      }
      
      console.log(`[parseHtmlContent] 🔧 Successfully split into ${blocks.length} blocks`);
    }
  }

  console.log(`[parseHtmlContent] Generated ${blocks.length} blocks with pure text content`);

  // Log first block content to verify text extraction
  if (blocks.length > 0) {
    console.log(`[parseHtmlContent] Sample block content: "${blocks[0].content?.substring(0, 100)}..."`);
  }

  return mergeShortBlocks(blocks, options?.minBlockLength || 50);
}

/**
 * Enhanced HTML content parsing with much better paragraph detection for RSS/web articles
 */
function parseHtmlContentWithBetterParagraphs(html: string, source?: string): StructuredBlock[] {
  const blocks: StructuredBlock[] = [];
  let order = 1;

  // More aggressive paragraph detection for web articles
  // Split by multiple paragraph indicators
  const paragraphSeparators = [
    /<\/p>\s*<p[^>]*>/gi,
    /<\/div>\s*<div[^>]*>/gi,
    /<\/section>\s*<section[^>]*>/gi,
    /<br\s*\/?>\s*<br\s*\/?>/gi,
    /\n\s*\n/g
  ];

  let content = html;

  // First, mark paragraph boundaries with a special marker
  const PARA_MARKER = '___PARAGRAPH_BREAK___';

  paragraphSeparators.forEach(separator => {
    content = content.replace(separator, `${PARA_MARKER}$&`);
  });

  // Split by the marker and process each segment
  const segments = content.split(PARA_MARKER);

  for (const segment of segments) {
    if (!segment.trim()) continue;

    // Extract text content while preserving structure indicators
    const textContent = segment
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&[a-zA-Z0-9#]+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (textContent.length < 20) continue; // Skip very short segments

    // Check if this looks like a heading
    if (textContent.length < 100 && /^[A-Z][^.!?]*[^.!?]$/.test(textContent)) {
      blocks.push({
        type: 'heading',
        order: order++,
        content: textContent,
      });
    } else {
      blocks.push({
        type: 'paragraph',
        order: order++,
        content: textContent,
      });
    }
  }

  console.log(`[parseHtmlContentWithBetterParagraphs] Generated ${blocks.length} blocks from HTML`);
  return blocks;
}



/**
 * Text Content Parser for plain text and fallback processing
 */
async function parseTextContent(
  input: string,
  source?: string,
  options?: ParserOptions,
  originalUrl?: string
): Promise<StructuredBlock[]> {
  const paragraphs = splitIntoParagraphs(input);
  const blocks: StructuredBlock[] = [];
  let blockOrder = 0;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (trimmed.length < 3) {
      continue;
    }

    blockOrder++;

    // Enhanced heading detection
    if (trimmed.match(/^#{1,6}\s+/)) {
      const level = trimmed.match(/^(#{1,6})/)?.[1].length || 1;
      const content = trimmed.replace(/^#{1,6}\s+/, "").trim();
      blocks.push({
        type: "heading",
        order: blockOrder,
        level,
        content,
      });
    } else if (shouldClassifyAsHeading(trimmed, { isArxivContent: isArxivDomain(source || originalUrl) })) {
      const level = getHeadingLevel(trimmed);
      blocks.push({
        type: "heading",
        order: blockOrder,
        level,
        content: trimmed,
      });
    } else if (trimmed.length < 100 && trimmed.match(/^[A-Z].*[^.!?]$/)) {
      blocks.push({
        type: "heading",
        order: blockOrder,
        level: 3,
        content: trimmed,
      });
    } else if (trimmed.match(/^\s*[-*+]\s+|\d+\.\s+/m)) {
      blocks.push({
        type: "list",
        order: blockOrder,
        content: trimmed,
      });
    } else {
      blocks.push({
        type: "paragraph",
        order: blockOrder,
        content: trimmed,
      });
    }
  }

  return mergeShortBlocks(blocks, options?.minBlockLength || 50);
}

/**
 * 🔧 NEW: Structure-Only Assembly Mode
 * 
 * This function is the ONLY authorized handler for pre-cleaned PDF content.
 * It performs structure ASSEMBLY only - NO parsing, NO normalization, NO header detection.
 * 
 * AUTHORIZED ACTIONS:
 * - Split by double newlines (paragraph boundaries)
 * - Assign block order numbers
 * - Classify as paragraph or heading based on markdown markers only (## prefix)
 * 
 * PROHIBITED ACTIONS (Non-negotiable):
 * - NO header/footer detection (already removed by pdfUtils)
 * - NO ligature normalization (already done by pdfUtils)
 * - NO text cleanup or re-interpretation
 * - NO layout heuristics
 */
function assembleStructureOnly(
  cleanedText: string,
  source?: string
): StructuredBlock[] {
  console.log(`[assembleStructureOnly] 🔧 STRUCTURE_ONLY mode: Assembling pre-cleaned content from ${source || 'Unknown'}`);
  console.log(`[assembleStructureOnly] Input length: ${cleanedText.length} chars`);
  
  const blocks: StructuredBlock[] = [];
  let blockOrder = 0;
  let headingCount = 0;
  let paragraphCount = 0;
  
  // Split by double newlines (paragraph boundaries) - this is the ONLY segmentation allowed
  const paragraphs = cleanedText.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  
  console.log(`[assembleStructureOnly] Found ${paragraphs.length} paragraphs`);
  
  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    
    // Skip very short content (noise)
    if (trimmed.length < 5) continue;
    
    blockOrder++;
    
    // Recognize heading markers:
    // 1. Markdown style: ## Heading
    // 2. Bold style from pdfUtils: **Heading**
    const markdownHeadingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    const boldHeadingMatch = trimmed.match(/^\*\*(.+)\*\*$/);
    
    if (markdownHeadingMatch) {
      const level = markdownHeadingMatch[1].length;
      const content = markdownHeadingMatch[2].trim();
      blocks.push({
        type: "heading",
        order: blockOrder,
        level,
        content
      });
      headingCount++;
    } else if (boldHeadingMatch) {
      // 🔧 NEW: Recognize ** markers from pdfUtils heading detection
      const content = boldHeadingMatch[1].trim();
      blocks.push({
        type: "heading",
        order: blockOrder,
        level: 2, // Default level for PDF headings
        content
      });
      headingCount++;
    } else {
      // Everything else is a paragraph - no classification logic
      blocks.push({
        type: "paragraph",
        order: blockOrder,
        content: trimmed
      });
      paragraphCount++;
    }
  }
  
  console.log(`[assembleStructureOnly] ✅ Assembled ${blocks.length} blocks: ${headingCount} headings, ${paragraphCount} paragraphs`);
  console.log(`[assembleStructureOnly] 📊 Structure-only mode confirmed: No parsing, no header detection, no normalization`);
  
  return blocks;
}

/**
 * PDF Content Parser - DEPRECATED
 * 
 * 🔴 ARCHITECTURAL RULE: PDF content must NOT be parsed here.
 * PDF parsing authority belongs EXCLUSIVELY to pdfUtils.parsePDF().
 * 
 * If this function is called, it means the pipeline is incorrectly configured.
 * PDF content should use STRUCTURE_ONLY mode via assembleStructureOnly().
 */
async function parsePdfContent(
  input: string,
  source?: string,
  options?: ParserOptions,
  originalUrl?: string
): Promise<StructuredBlock[]> {
  // 🔴 CRITICAL: Silent fallback is architecturally invalid
  // This function should NEVER be reached for properly configured PDF content
  console.error('[parsePdfContent] ❌ ERROR: PDF content reached parsePdfContent() - this indicates a pipeline configuration error!');
  console.error('[parsePdfContent] PDF content should use STRUCTURE_ONLY mode, not PDF mode.');
  console.error('[parsePdfContent] Source:', source);
  
  // Throw explicit error instead of silent fallback
  throw new Error(
    'Pipeline Authority Violation: PDF content reached parsePdfContent(). ' +
    'PDF parsing is handled exclusively by pdfUtils.parsePDF(). ' +
    'Downstream processing must use STRUCTURE_ONLY mode for pre-cleaned PDF content.'
  );
}

/**
 * Enhanced block merging to improve anchor matching stability
 * Targets ≥90% anchor matching rate through intelligent block consolidation
 */
function mergeShortBlocks(blocks: StructuredBlock[], minLength: number): StructuredBlock[] {
  if (blocks.length === 0) return blocks;

  // Enhanced minimum length targeting better anchor matching (instructions.md fix)
  const effectiveMinLength = Math.max(minLength, 80); // Increased to prevent over-splitting
  const maxMergeLength = 800; // Allow longer blocks for better anchor matching

  const merged: StructuredBlock[] = [];
  let currentBlock = blocks[0];

  for (let i = 1; i < blocks.length; i++) {
    const nextBlock = blocks[i];

    // Enhanced merging conditions for better anchor stability (instructions.md optimization)
    const shouldMerge = 
      currentBlock.type === "paragraph" &&
      nextBlock.type === "paragraph" &&
      currentBlock.content &&
      nextBlock.content &&
      (
        // Current block is too short
        currentBlock.content.length < effectiveMinLength ||
        // Both blocks are short and would benefit from merging  
        (currentBlock.content.length < 150 && nextBlock.content.length < 150) ||
        // Current block has very few sentences (likely fragment)
        (currentBlock.content.split(/[.!?]+/).length <= 3 && 
         currentBlock.content.length < 200) ||
        // Next block is very short
        nextBlock.content.length < 60
      ) &&
      // Don't create overly long blocks
      (currentBlock.content.length + nextBlock.content.length) < maxMergeLength;

    if (shouldMerge) {
      // Smart merging with proper spacing
      const currentContent = currentBlock.content || '';
      const separator = currentContent.endsWith('.') || 
                       currentContent.endsWith('!') || 
                       currentContent.endsWith('?') ? ' ' : '. ';

      currentBlock = {
        ...currentBlock,
        content: currentBlock.content + separator + nextBlock.content,
      };
    } else {
      merged.push(currentBlock);
      currentBlock = nextBlock;
    }
  }

  merged.push(currentBlock);

  // Post-processing: Final validation and cleanup
  const finalBlocks = merged
    .filter(block => {
      // Remove extremely short blocks that are likely noise
      if (!block.content || block.content.length < 10) return false;

      // Keep non-paragraph blocks regardless of length
      if (block.type !== "paragraph") return true;

      // For paragraphs, ensure minimum meaningful content
      const sentenceCount = block.content.split(/[.!?]+/).filter(s => s.trim().length > 3).length;
      return sentenceCount >= 1;
    })
    .map((block, index) => ({
      ...block,
      order: index + 1
    }));

  console.log(`[StructuredUtils] Block merging: ${blocks.length} → ${finalBlocks.length} blocks (targeting ≥90% anchor matching)`);

  return finalBlocks;
}

/**
 * Legacy Unified Structured Content Pipeline - DEPRECATED, use generateStructuredContentV2
 * This is maintained for backward compatibility only
 */
export async function generateStructuredContent(
  input: string,
  sourceType: "html" | "text" | "pdf" = "text",
  source?: string,
  withAnchors: boolean = false,
): Promise<StructuredBlock[]> {
  const blocks: StructuredBlock[] = [];
  let blockOrder = 0;
  const seenContent = new Set<string>(); // Prevent duplicates

  // HTML Processing (for RSS, Guardian, etc.)
  if (sourceType === "html" && (input.includes("<") || input.includes(">"))) {
    try {
      const jsdom = await import("jsdom");
      const { JSDOM } = jsdom;
      const dom = new JSDOM(input);
      const document = dom.window.document;

      // 우선 중요 콘텐츠 요소들을 선택 (<p> 태그 우선)
      const paragraphElements = Array.from(document.querySelectorAll("p"));
      const otherElements = Array.from(
        document.querySelectorAll(
          "h1, h2, h3, h4, h5, h6, img, figure, figcaption, table, thead, tbody, tr, th, td, ul, ol, blockquote, pre, code",
        ),
      );

      // <p> 태그가 있으면 우선 사용, 없으면 div도 포함
      let contentElements: Element[] = [];

      if (paragraphElements.length > 2) {
        // <p> 태그가 충분히 있으면 <p> 태그만 사용
        console.log(
          "[generateStructuredContent] ✅ Using <p> elements for content:",
          paragraphElements.length,
        );
        contentElements = [...paragraphElements, ...otherElements];
      } else {
        // <p> 태그가 부족하면 div도 포함하되, 중첩 방지
        const divElements = Array.from(document.querySelectorAll("div")).filter(
          (div) => {
            const text = div.textContent?.trim() || "";
            return text.length > 100; // 충분한 길이의 div만 포함
          },
        );

        console.log(
          "[generateStructuredContent] ✅ Using mixed elements - p:",
          paragraphElements.length,
          "div:",
          divElements.length,
        );
        contentElements = [
          ...paragraphElements,
          ...divElements,
          ...otherElements,
        ];
      }

      // 문서 순서대로 정렬
      const topLevelElements = contentElements.sort((a, b) => {
        const posA = Array.from(document.querySelectorAll("*")).indexOf(a);
        const posB = Array.from(document.querySelectorAll("*")).indexOf(b);
        return posA - posB;
      });

      topLevelElements.forEach((element: any, index: number) => {
        const tagName = element.tagName.toLowerCase();
        blockOrder++;

        // Headings
        if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tagName)) {
          const text = element.textContent?.trim();
          if (text && text.length > 2) {
            const contentKey = `heading:${text.toLowerCase()}`;
            if (!seenContent.has(contentKey)) {
              seenContent.add(contentKey);
              blocks.push({
                type: "heading",
                level: parseInt(tagName.charAt(1)),
                order: blockOrder,
                content: text,
              });
            }
          }
        }

        // Images - enhanced extraction with absolute URL conversion
        else if (tagName === "img") {
          const src = element.getAttribute("src");
          const alt = element.getAttribute("alt") || "";
          const title = element.getAttribute("title") || "";

          if (src && !src.startsWith("data:")) {
            const contentKey = `image:${src}`;
            if (!seenContent.has(contentKey)) {
              seenContent.add(contentKey);
              const caption = alt || title || "Image from article";

              // For legacy function, just use the original src for now
              // TODO: Remove this when legacy function is deprecated
              const absoluteUrl = src.startsWith("http") ? src : src;

              blocks.push({
                type: "image",
                order: blockOrder,
                src: absoluteUrl,
                caption: caption,
              });
            }
          }
        }

        // Tables
        else if (tagName === "table") {
          const html = element.outerHTML;
          const caption =
            element.querySelector("caption")?.textContent?.trim() ||
            "Table from article";
          const rows = element.querySelectorAll("tr");

          if (rows.length > 1) {
            blocks.push({
              type: "table",
              order: blockOrder,
              html: html,
              caption: caption,
            });
          }
        }

        // Lists
        else if (["ul", "ol"].includes(tagName)) {
          const text = element.textContent?.trim();
          if (text && text.length > 10) {
            blocks.push({
              type: "list",
              order: blockOrder,
              content: text,
            });
          }
        }

        // Quotes
        else if (tagName === "blockquote") {
          const text = element.textContent?.trim();
          if (text && text.length > 10) {
            blocks.push({
              type: "quote",
              order: blockOrder,
              content: text,
            });
          }
        }

        // Code blocks
        else if (["pre", "code"].includes(tagName)) {
          const text = element.textContent?.trim();
          if (text && text.length > 5) {
            blocks.push({
              type: "code",
              order: blockOrder,
              content: text,
            });
          }
        }

        // Paragraphs and divs - enhanced duplicate prevention
        else if (["p", "div"].includes(tagName)) {
          const text = element.textContent?.trim();
          if (text && text.length > 20) {
            // 강화된 중복 검사 - 전체 텍스트로 정확한 중복 감지
            const normalizedFullText = text
              .toLowerCase()
              .replace(/\s+/g, " ")
              .trim();

            // 1. 정확히 같은 내용인지 확인
            const isExactDuplicate = blocks.some((block) => {
              if (block.content) {
                const existingNormalized = block.content
                  .toLowerCase()
                  .replace(/\s+/g, " ")
                  .trim();
                return normalizedFullText === existingNormalized;
              }
              return false;
            });

            // 2. 포함 관계 중복 검사 - 더 엄격한 기준 적용
            const isSubstringDuplicate = blocks.some((block) => {
              if (block.content && block.content.length > 100) {
                const existingNormalized = block.content
                  .toLowerCase()
                  .replace(/\s+/g, " ")
                  .trim();
                // 80% 이상 겹치는 경우 중복으로 간주
                const overlapRatio =
                  Math.min(
                    normalizedFullText.length,
                    existingNormalized.length,
                  ) /
                  Math.max(
                    normalizedFullText.length,
                    existingNormalized.length,
                  );
                if (overlapRatio > 0.8) {
                  // 실제 문자열 포함 관계 확인
                  return (
                    existingNormalized.includes(normalizedFullText) ||
                    normalizedFullText.includes(existingNormalized)
                  );
                }
              }
              return false;
            });

            // 3. 중복이 아닌 경우에만 블록 추가
            if (!isExactDuplicate && !isSubstringDuplicate) {
              // Check if this is actually a heading (short text in div/p)
              if (text.length < 100 && text.match(/^[A-Z].*[^.!?]$/)) {
                blocks.push({
                  type: "heading",
                  order: blockOrder,
                  level: 3,
                  content: text,
                });
              } else {
                blocks.push({
                  type: "paragraph",
                  order: blockOrder,
                  content: text,
                });
              }
            } else {
              console.log(
                "[generateStructuredContent] 🚫 Skipping duplicate content:",
                text.substring(0, 100) + "...",
              );
            }
          }
        }
      });

      // Apply source-specific filtering rules
      if (source === "The Guardian" || source === "guardian") {
        // Remove Guardian-specific noise: related articles, ads, etc.
        return blocks.filter((block) => {
          if (block.type === "paragraph" && block.content) {
            return !block.content.match(
              /(Related articles|More on this story|Guardian readers|Subscribe to|Support the Guardian)/i,
            );
          }
          return true;
        });
      }
    } catch (error) {
      console.warn(
        "HTML parsing failed, falling back to text processing:",
        error,
      );
      // Fallback to text processing
      sourceType = "text";
      input = input
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }
  }

  // Text/PDF Processing (fallback and default)
  if (sourceType === "text" || sourceType === "pdf") {
    const paragraphs = splitIntoParagraphs(input);

    paragraphs.forEach((paragraph) => {
      blockOrder++;

      // Enhanced heading detection for academic papers (arXiv)
      if (paragraph.match(/^#{1,6}\s+/)) {
        const level = paragraph.match(/^(#{1,6})/)?.[1].length || 1;
        const content = paragraph.replace(/^#{1,6}\s+/, "").trim();
        blocks.push({
          type: "heading",
          order: blockOrder,
          level,
          content,
        });
      }
      // Academic section headings (Abstract, Introduction, etc.)
      else if (
        paragraph.match(
          /^(Abstract|Introduction|Conclusion|Discussion|Method|Results|Related Work|References|Bibliography|Acknowledgments)$/i,
        )
      ) {
        blocks.push({
          type: "heading",
          order: blockOrder,
          level: 2,
          content: paragraph,
        });
      }
      // Short potential headings
      else if (paragraph.length < 100 && paragraph.match(/^[A-Z].*[^.!?]$/)) {
        blocks.push({
          type: "heading",
          order: blockOrder,
          level: 3,
          content: paragraph,
        });
      }
      // Enhanced image detection
      else if (
        paragraph.match(
          /\[image\]|\[fig\]|\[figure\]|\[chart\]|\[diagram\]|Figure \d+|Fig\. \d+/i,
        )
      ) {
        blocks.push({
          type: "image",
          order: blockOrder,
          caption: "Figure - detailed extraction not yet implemented",
          content: paragraph,
          imageSnapshot: false,
        });
      }
      // Enhanced table detection
      else if (
        paragraph.match(/\[table\]|\[tab\]|\|\s*\w+\s*\||Table \d+|Tab\. \d+/i)
      ) {
        blocks.push({
          type: "table",
          order: blockOrder,
          caption: "Table - detailed extraction not yet implemented",
          html: `<div class="table-placeholder">${paragraph}</div>`,
          content: paragraph,
        });
      }
      // Lists
      else if (paragraph.match(/^\s*[-*+]\s+|\d+\.\s+/m)) {
        blocks.push({
          type: "list",
          order: blockOrder,
          content: paragraph,
        });
      }
      // Code blocks
      else if (
        paragraph.match(/```|`.*`/) ||
        (sourceType === "pdf" &&
          paragraph.match(/^[A-Za-z_][A-Za-z0-9_]*\s*\(/))
      ) {
        blocks.push({
          type: "code",
          order: blockOrder,
          content: paragraph,
        });
      }
      // Quotes
      else if (paragraph.match(/^>\s+|^"|"/)) {
        blocks.push({
          type: "quote",
          order: blockOrder,
          content: paragraph,
        });
      }
      // Regular paragraphs
      else if (paragraph.length > 10) {
        blocks.push({
          type: "paragraph",
          order: blockOrder,
          content: paragraph,
        });
      }
    });
  }

  // Global filtering: remove ads, navigation, footers
  return blocks.filter((block) => {
    if (block.type === "paragraph" && block.content) {
      const content = block.content.toLowerCase();
      // Filter common noise patterns
      if (
        content.match(
          /(subscribe|newsletter|follow us|share this|recommended|sponsored|cookie policy|privacy policy|terms of service)/i,
        )
      ) {
        return false;
      }
    }
    return true;
  });
}

// Helper function to convert relative URLs to absolute URLs
function convertToAbsoluteUrl(relativeUrl: string, originalUrl?: string, source?: string): string {
  console.log(`[convertToAbsoluteUrl] Converting ${relativeUrl} with base: ${originalUrl}, source: ${source}`);

  // If already absolute URL, return as-is
  if (relativeUrl.startsWith("http://") || relativeUrl.startsWith("https://")) {
    return relativeUrl;
  }

  // Handle data: URLs
  if (relativeUrl.startsWith("data:")) {
    return relativeUrl;
  }

  // If no original URL provided, try to construct from source
  if (!originalUrl && source) {
    // Extract domain from source if it contains RSS or domain info
    if (source.includes("RSS") || source.includes("NPR") || source.includes("Guardian")) {
      // Try common patterns for RSS sources
      if (source.includes("NPR")) {
        originalUrl = "https://www.npr.org";
      } else if (source.includes("Guardian")) {
        originalUrl = "https://www.theguardian.com";
      }
    }
  }

  // If still no base URL, return relative URL as-is (better than null)
  if (!originalUrl) {
    console.warn(`[convertToAbsoluteUrl] No base URL available for ${relativeUrl}, returning as-is`);
    return relativeUrl;
  }

  try {
    // Use URL constructor to properly resolve relative URLs
    const baseUrl = new URL(originalUrl);
    const absoluteUrl = new URL(relativeUrl, baseUrl);
    console.log(`[convertToAbsoluteUrl] Successfully converted ${relativeUrl} to ${absoluteUrl.href}`);
    return absoluteUrl.href;
  } catch (error) {
    console.error(`[convertToAbsoluteUrl] Error converting URL ${relativeUrl} with base ${originalUrl}:`, error);
    return relativeUrl; // Return original if conversion fails
  }
}