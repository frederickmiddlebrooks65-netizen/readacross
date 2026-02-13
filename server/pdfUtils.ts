import { PDFDocument } from "pdf-lib";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { spawn } from "child_process";
import {
  extractPdfLines,
  checkPyMuPDFAvailable,
  initializePdfExtractor,
  type TextLine,
  type PyMuPDFResult,
} from "./pdfLayoutExtractor.js";
import { splitIntoSentencesWithType, SentenceUnit } from "./utils/textUtils.js";

// Re-export initializer for server startup
export { initializePdfExtractor };

// Phase 2-4: Sentence type distinguishes complete sentences from fragments/utterances
export type SentenceType = "sentence" | "utterance";

// Sentence interface for translation pipeline
export interface Sentence {
  id: string;
  text: string;
  order: number;
  type: SentenceType; // Phase 2-4: sentence = TM eligible, utterance = TM excluded by default
  isFallbackUnit?: boolean; // Phase 2-3a: True when paragraph promoted as single unit (TM OFF by default)
}

// 1. Core Block Interface - STRUCTURAL FIX per instructions.md
// All translatable blocks MUST own sentences[] - downstream consumes sentences[] only
// Metadata blocks are non-translatable and do NOT have sentences[]

// Metadata block types (non-translatable, isolated before semantic unit creation)
export type MetadataBlockType =
  | "doi"
  | "author"
  | "journal"
  | "affiliation"
  | "abstract_label";

// Non-semantic block types (Phase 2-3a: excluded from sentence model entirely)
// reference_block: References/Bibliography section - no sentence parsing, no TM storage
export type NonSemanticBlockType = "reference_block";

// Translatable block types (own sentences[])
// document_title: highest-level translatable block, detected on page 1, largest font
export type TranslatableBlockType =
  | "document_title"
  | "heading"
  | "paragraph"
  | "abstract_body";

// All block types
export type BlockType =
  | TranslatableBlockType
  | MetadataBlockType
  | NonSemanticBlockType;

// Base block interface
interface BaseBlock {
  type: BlockType;
  content: string;
  order: number;
  page: number;
  origin?: { page: number; bbox: [number, number, number, number] };
}

// Translatable block - HAS sentences[]
export interface TranslatableBlock extends BaseBlock {
  type: TranslatableBlockType;
  sentences: Sentence[]; // REQUIRED: All translatable blocks own sentences[]
  level?: number;
}

// Metadata block - NO sentences[] (non-translatable)
export interface MetadataBlock extends BaseBlock {
  type: MetadataBlockType;
  // No sentences[] - these are isolated metadata, not semantic units
}

// Phase 2-3a: Non-semantic block - excluded from sentence model entirely
export interface NonSemanticBlock extends BaseBlock {
  type: NonSemanticBlockType;
  // No sentences[] - these are not semantic units, not for translation
  // Preserve original line breaks for presentation
  preserveLineBreaks?: boolean;
}

// Union type for all blocks
export type Block = TranslatableBlock | MetadataBlock | NonSemanticBlock;

// Type guard helpers
export function isTranslatableBlock(block: Block): block is TranslatableBlock {
  return ["document_title", "heading", "paragraph", "abstract_body"].includes(
    block.type,
  );
}

export function isMetadataBlock(block: Block): block is MetadataBlock {
  return ["doi", "author", "journal", "affiliation", "abstract_label"].includes(
    block.type,
  );
}

// Phase 2-3a: Check if block is non-semantic (excluded from TM)
export function isNonSemanticBlock(block: Block): block is NonSemanticBlock {
  return ["reference_block"].includes(block.type);
}

// Phase 2-3a: Check if heading is a References section heading
const REFERENCES_HEADING_PATTERNS = [
  /^references$/i,
  /^bibliography$/i,
  /^works\s+cited$/i,
  /^literature\s+cited$/i,
  /^cited\s+references$/i,
  /^reference\s+list$/i,
];

export function isReferencesHeading(text: string): boolean {
  const trimmed = text.trim();
  return REFERENCES_HEADING_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function isExplicitSectionHeading(text: string): boolean {
  const trimmed = text.trim();
  const isAllCapsHeading = /^[A-Z][A-Z\s]{3,}$/.test(trimmed);
  const matchesExplicitKeyword =
    /^(bionote|bio\s*note|notes|endnotes|appendix|acknowledg(e)?ments?|about\s+the\s+author|author\s+note|author\s+bio(graphy|graphies)?|biographical\s+note(s)?)$/i.test(
      trimmed,
    );
  return (isAllCapsHeading || matchesExplicitKeyword) && !isReferencesHeading(trimmed);
}

// ========== Archetype Detection per instructions.md ==========
// Document archetype determines parsing strategy (not rendering option)
// Archetype is decided at parsing time because sentence segmentation is irreversible

export type DocumentArchetype = "academic" | "literary" | "essay" | "generic";
export type ArchetypeSource = "source" | "auto" | "user";

export interface ArchetypeDetectionResult {
  archetype: DocumentArchetype;
  confidence: number; // 0-1 confidence score
  source: ArchetypeSource;
  signals: string[]; // Debug info: which signals triggered the detection
}

// Phase 2-Stage2: Academic Parsing Strictness
// Replaces academicMode: boolean with parsing strategy axis
// strict = STEM journal-like parsing (aggressive header/footer removal, ALL CAPS heading ON)
// relaxed = essay-like academic parsing (preserve paragraph structure, less aggressive removal)
export type AcademicParsingStrictness = "strict" | "relaxed";

// Phase 2-Stage3: Academic Parsing Profile
// Separate axis from strictness - determines which RULES to apply
// journal = STEM journal assumptions (section hierarchy, numbered headings, Method/Results)
// essay_academic = humanities/theory academic (prose-focused, fewer structural assumptions)
export type AcademicParsingProfile = "journal" | "essay_academic" | "arxiv";

export interface AcademicParsingDecision {
  strictness: AcademicParsingStrictness;
  profile: AcademicParsingProfile; // NEW: which rule set to apply
  confidence: number; // 0-1 confidence score
  score: number; // Raw point score (0-12)
  signals: string[]; // Debug info: which signals contributed to score
}

/**
 * Detect document archetype from parsed blocks using lightweight heuristics
 * per instructions.md section 9: "70% accuracy is sufficient"
 *
 * Signals for academic:
 * - Abstract / References / DOI / arXiv ID
 * - Two-column layout
 * - Citation patterns [1], (Author, 2024)
 *
 * Signals for literary:
 * - Chapter headings
 * - Dialogue patterns (quotation marks)
 * - No academic metadata
 */
function detectArchetypeFromBlocks(
  blocks: Block[],
  textSample: string,
): ArchetypeDetectionResult {
  const signals: string[] = [];
  let academicScore = 0;
  let literaryScore = 0;
  let essayScore = 0;

  // Check for academic signals in blocks
  for (const block of blocks) {
    if (block.type === "doi") {
      academicScore += 3;
      signals.push("DOI detected");
    }
    if (block.type === "abstract_label" || block.type === "abstract_body") {
      academicScore += 2;
      signals.push("Abstract section detected");
    }
    if (block.type === "affiliation") {
      academicScore += 1.5;
      signals.push("Affiliation detected");
    }
    if (block.type === "journal") {
      academicScore += 1.5;
      signals.push("Journal info detected");
    }
    if (
      block.type === "author" &&
      blocks.filter((b) => b.type === "author").length >= 2
    ) {
      academicScore += 1;
      signals.push("Multiple authors detected");
    }
  }

  // Text-based heuristics
  const lowerText = textSample.toLowerCase();

  // Academic patterns
  if (/\barxiv:\d+\.\d+/i.test(textSample)) {
    academicScore += 3;
    signals.push("arXiv ID pattern");
  }
  if (
    /\breferences\b/i.test(lowerText) &&
    /\[\d+\]|\(\d{4}\)/.test(textSample)
  ) {
    academicScore += 2;
    signals.push("References section with citations");
  }
  if (
    /\bmethodology\b|\bresults\b|\bdiscussion\b|\bconclusion\b/i.test(lowerText)
  ) {
    academicScore += 1;
    signals.push("Academic section headings");
  }
  if (/et\s+al\.|ibid\./i.test(textSample)) {
    academicScore += 1;
    signals.push("Academic citation style");
  }

  // Literary patterns
  const dialogueCount = (textSample.match(/[""][^""]+[""]/g) || []).length;
  if (dialogueCount > 10) {
    literaryScore += 2;
    signals.push(`Dialogue detected (${dialogueCount} instances)`);
  }
  if (
    /\bchapter\s+\d+/i.test(lowerText) ||
    /\bpart\s+(one|two|i|ii|iii)/i.test(lowerText)
  ) {
    literaryScore += 2;
    signals.push("Chapter/Part structure detected");
  }
  if (/\bonce upon a time\b|\bthe end\b/i.test(lowerText)) {
    literaryScore += 1;
    signals.push("Narrative markers detected");
  }

  // Essay patterns (falls between academic and literary)
  if (/\bin my (opinion|view|experience)\b/i.test(lowerText)) {
    essayScore += 1.5;
    signals.push("Personal essay markers");
  }
  if (/\bI believe\b|\bI argue\b|\bI think\b/i.test(lowerText)) {
    essayScore += 1;
    signals.push("First-person argumentation");
  }

  // Determine archetype based on scores
  const maxScore = Math.max(academicScore, literaryScore, essayScore);

  if (maxScore < 2) {
    return {
      archetype: "generic",
      confidence: 0.5,
      source: "auto",
      signals:
        signals.length > 0 ? signals : ["No strong archetype signals detected"],
    };
  }

  if (academicScore >= literaryScore && academicScore >= essayScore) {
    const confidence = Math.min(0.95, 0.5 + academicScore * 0.1);
    return {
      archetype: "academic",
      confidence,
      source: "auto",
      signals,
    };
  }

  if (literaryScore > essayScore) {
    const confidence = Math.min(0.9, 0.5 + literaryScore * 0.15);
    return {
      archetype: "literary",
      confidence,
      source: "auto",
      signals,
    };
  }

  const confidence = Math.min(0.85, 0.5 + essayScore * 0.15);
  return {
    archetype: "essay",
    confidence,
    source: "auto",
    signals,
  };
}

/**
 * Get archetype from source provider (arXiv = academic, Gutenberg = literary)
 */
export function getArchetypeFromSource(
  source: string,
): ArchetypeDetectionResult | null {
  const lowerSource = source.toLowerCase();

  if (lowerSource.includes("arxiv")) {
    return {
      archetype: "academic",
      confidence: 1.0,
      source: "source",
      signals: ["Source: arXiv"],
    };
  }

  if (lowerSource.includes("gutenberg")) {
    return {
      archetype: "literary",
      confidence: 1.0,
      source: "source",
      signals: ["Source: Project Gutenberg"],
    };
  }

  if (lowerSource.includes("guardian") || lowerSource.includes("news")) {
    return {
      archetype: "essay",
      confidence: 0.9,
      source: "source",
      signals: [`Source: ${source}`],
    };
  }

  return null; // Unknown source, need auto-detection
}

/**
 * Phase 2-Stage2: Decide parsing strictness for academic documents
 *
 * Point-based scoring system (0-12 points):
 * - ≥7 points = relaxed (essay-like, preserve paragraph structure)
 * - ≤4 points = strict (STEM journal-like, aggressive removal)
 * - 5-6 points = relaxed (ambiguous → fail-safe to relaxed)
 *
 * Signals:
 * - Layout: single-column (+2)
 * - Heading patterns: no numbered headings (+1), no Method/Results keywords (+1)
 * - Textual: 1st person pronouns (+2), narrative citations (+1),
 *   low formula density (+1), no figure/table references (+1)
 * - Paragraph structure: short paragraphs (+1)
 *
 * Fail-safe: Ambiguous cases default to relaxed (NOT strict) to prevent information loss
 */
function detectParsingStrictness(
  blocks: Block[],
  textSample: string,
): AcademicParsingDecision {
  const signals: string[] = [];
  let score = 0;

  // === Layout Signals ===
  // Single-column detection: Check if most blocks have similar x positions
  // (Journal papers typically have 2-column layout)
  const paragraphBlocks = blocks.filter(
    (b) => b.type === "paragraph" && b.origin,
  );
  if (paragraphBlocks.length >= 5) {
    const xPositions = paragraphBlocks
      .filter((b) => b.origin)
      .map((b) => b.origin!.bbox[0]);
    const uniqueXPositions = new Set(xPositions.map((x) => Math.round(x / 50))); // Group by 50pt buckets
    if (uniqueXPositions.size <= 1) {
      score += 2;
      signals.push("Single-column layout (+2)");
    }
  }

  // === Heading Pattern Signals ===
  const headingBlocks = blocks.filter((b) => b.type === "heading");
  const headingTexts = headingBlocks.map((b) => b.content);

  // Check for numbered headings (common in journal papers)
  const numberedHeadingPattern = /^(\d+\.|\d+\s+|[IVX]+\.?\s+)/;
  const hasNumberedHeadings = headingTexts.some((h) =>
    numberedHeadingPattern.test(h.trim()),
  );
  if (!hasNumberedHeadings && headingBlocks.length >= 2) {
    score += 1;
    signals.push("No numbered headings (+1)");
  }

  // Check for Method/Results/Conclusion keywords (journal-specific sections)
  const journalSectionKeywords =
    /\b(method|methodology|materials|results|discussion|conclusion|findings|experiment|data\s+analysis)\b/i;
  const hasJournalSections = headingTexts.some((h) =>
    journalSectionKeywords.test(h),
  );
  if (!hasJournalSections && headingBlocks.length >= 2) {
    score += 1;
    signals.push("No Method/Results sections (+1)");
  }

  // === Textual Signals (from text sample) ===
  const lowerText = textSample.toLowerCase();

  // First person pronouns (essays use "I", "we" more narratively)
  const firstPersonMatches = lowerText.match(
    /\b(i\s+think|i\s+believe|i\s+argue|in\s+my\s+view|my\s+opinion|i\s+contend|i\s+suggest|we\s+argue|we\s+believe|we\s+contend)\b/g,
  );
  if (firstPersonMatches && firstPersonMatches.length >= 2) {
    score += 2;
    signals.push(
      `First-person narrative (${firstPersonMatches.length} matches, +2)`,
    );
  }

  // Narrative citations (Author says/argues/notes vs (Author, 2020))
  const narrativeCitationPattern =
    /\b(\w+)\s+(argues?|says?|notes?|contends?|suggests?|claims?|believes?|states?|maintains?|asserts?)\b/g;
  const narrativeCitations = lowerText.match(narrativeCitationPattern);
  const parentheticalCitations = textSample.match(
    /\([A-Z][a-z]+(?:\s+(?:et\s+al\.?|&\s+[A-Z][a-z]+))?,?\s*\d{4}\)/g,
  );

  const narrativeCount = narrativeCitations?.length || 0;
  const parentheticalCount = parentheticalCitations?.length || 0;

  if (narrativeCount > parentheticalCount && narrativeCount >= 3) {
    score += 1;
    signals.push(
      `Narrative citations dominant (${narrativeCount} vs ${parentheticalCount} parenthetical, +1)`,
    );
  }

  // Low formula/equation density (essays rarely have formulas)
  const formulaIndicators = textSample.match(/[=∑∏∫∂∇≈≠≤≥±×÷]/g);
  const formulaCount = formulaIndicators?.length || 0;
  if (formulaCount < 3) {
    score += 1;
    signals.push(`Low formula density (${formulaCount} indicators, +1)`);
  }

  // No figure/table references (journal papers reference "Figure 1", "Table 2")
  const figTableRefs = textSample.match(
    /\b(figure|fig\.?|table|tab\.?)\s*\d+/gi,
  );
  if (!figTableRefs || figTableRefs.length < 2) {
    score += 1;
    signals.push("Few/no figure-table references (+1)");
  }

  // === Paragraph Structure Signals ===
  // Short paragraphs (essays tend to have more varied, shorter paragraphs)
  if (paragraphBlocks.length >= 5) {
    const avgLength =
      paragraphBlocks.reduce((sum, b) => sum + b.content.length, 0) /
      paragraphBlocks.length;
    if (avgLength < 400) {
      // Average < 400 chars suggests essay-style
      score += 1;
      signals.push(`Short paragraphs (avg ${Math.round(avgLength)} chars, +1)`);
    }
  }

  // === Determine Parsing Strictness ===
  // FAIL-SAFE PRINCIPLE: strict is risky optimization, relaxed is safe default
  // ≤1 = clear STEM journal → strict (aggressive removal OK)
  // ≥2 = any ambiguity exists → relaxed (preserve paragraph structure)
  let strictness: AcademicParsingStrictness;
  if (score <= 1) {
    strictness = "strict";
  } else {
    strictness = "relaxed";
  }

  // === Determine Parsing Profile ===
  // Separate from strictness - determines which RULE SET to apply
  // ≥3 = essay_academic (humanities/theory - disable journal assumptions)
  // <3 = journal (STEM - apply section hierarchy, numbered headings)
  let profile: AcademicParsingProfile;
  if (score >= 3) {
    profile = "essay_academic";
  } else {
    profile = "journal";
  }

  // === arXiv Profile Override ===
  // If arXiv ID detected in text sample, force profile to arxiv
  if (/\barxiv:\d+\.\d+/i.test(textSample)) {
    profile = "arxiv";
    strictness = "relaxed";
    signals.push("Profile override: arXiv");
  }

  // === FAIL-SAFE: Single-column + relaxed → essay_academic ===
  // Per instructions.md: humanities/translation/philosophy papers protection rule
  // "archetype === academic AND strictness === relaxed AND single-column → essay_academic (강제)"
  // This catches humanities papers that score < 3 but have essay-like layout
  const isSingleColumn = signals.some((s) => s.includes("Single-column"));
  if (strictness === "relaxed" && isSingleColumn && profile === "journal") {
    profile = "essay_academic";
    signals.push("Fail-safe: single-column relaxed → essay_academic");
  }

  // Confidence calculation: higher when score is extreme (0-1 or 10+)
  const confidence = score <= 1 ? 0.9 : Math.min(0.9, 0.5 + score * 0.05);

  return {
    strictness,
    profile,
    confidence,
    score,
    signals,
  };
}

/**
 * Detect hyphenated slug pattern (URL-like text)
 * Phase-1 safety guard for missing origin/bbox data
 *
 * Examples:
 * - "Multilingual-Communication-Across-Global-Industries-Research-by-SNS-" → true
 * - "Multi-word phrase" → false (has space)
 * - "Ethical-considerations" → true (but later filtered by sentence criteria)
 *
 * NOTE:
 * This filter is a Phase-1 safety guard.
 * It compensates for missing layout/origin data from PyMuPDF.
 * Proper footnote / layout-based protection will be enabled
 * once bbox is provided (Phase 2).
 */
function looksLikeHyphenatedSlug(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.includes(" ")) return false;
  // Hyphens only, 3+ parts, no spaces, allow trailing hyphen
  // e.g. "Multilingual-Communication-Across-Global-Industries-Research-by-SNS-"
  return /^[A-Za-z]+(-[A-Za-z]+){2,}-?$/.test(trimmed);
}

/**
 * Detect author/affiliation metadata blocks
 * Phase-2 semantic gate: prevent metadata from being promoted to heading
 *
 * Examples of true cases:
 * - "Corina DOBROTĂ" (name pattern)
 * - "John Smith, PhD" (name with title)
 * - "University of Galati" (affiliation keyword)
 * - "Department of Computer Science" (institutional affiliation)
 *
 * Examples of false cases:
 * - "Ethical considerations" (no affiliation keyword, not a name)
 * - "The translator as a cultural mediator" (too long, has article)
 *
 * This filter is applied BEFORE heading promotion heuristics
 * to ensure metadata never enters the heading pool.
 */
function looksLikeAuthorBlock(block: Block): boolean {
  if (!block.content) return false;
  
  const text = block.content.trim();
  
  // Position guard: Author/affiliation typically appear near document start
  // (document_title, abstract_label, then author metadata)
  // Blocks beyond position 10 are unlikely to be author metadata
  const isEarlyPosition = (block as any).order !== undefined ? (block as any).order <= 10 : true;
  if (!isEarlyPosition) return false;
  
  // Length guard: Author names and affiliations are typically < 120 chars
  if (text.length >= 120) return false;
  
  // Sentence guard: Author blocks don't end with sentence terminators
  if (/[.!?]["']?\s*$/.test(text)) return false;
  
  // Space guard: Must have at least one space (not a single word)
  if (!text.includes(" ")) return false;
  
  // Pattern 1: Name pattern (First Last, possibly with middle initials/accented names)
  // "Corina DOBROTĂ", "Jean-Pierre Dubois", "Maria García López"
  // Allow both uppercase and lowercase letters in surnames
  const namePattern = /^[A-Z][A-Za-zÀ-ÿ]+([\s\-][A-Z][A-Za-zÀ-ÿ]+)*$/;
  if (namePattern.test(text)) {
    // DEBUG: Additional validation for name patterns
    const parts = text.split(/[\s\-]+/);
    // Name should have 2-4 parts (First Last, or First Middle Last, etc.)
    if (parts.length >= 2 && parts.length <= 4) {
      return true;
    }
  }
  
  // Pattern 2: Institutional affiliation keywords
  // "University of X", "Institute of X", "Department of X", etc.
  const affiliationKeywords = /(University|Institute|Department|Faculty|College|School|Laboratory|Center|Centre|Research Lab|Academy)/i;
  if (affiliationKeywords.test(text)) return true;
  
  return false;
}

/**
 * Block-level standalone detection
 * Used as merge-protection flag ONLY (not for paragraph splitting)
 * 
 * A paragraph block is "standalone" if it looks like a subheading:
 * - Short text (≤70 chars, ≤6 words)
 * - Title case
 * - No terminal punctuation (not a sentence)
 */
function isStandaloneBlock(block: Block): boolean {
  if (block.type !== "paragraph") return false;

  const text = block.content.trim();
  const words = text.split(/\s+/);

  const isShortStandalone =
    text.length <= 70 &&
    words.length <= 6 &&
    /^[A-Z]/.test(text) &&
    !/[.!?]\s*$/.test(text);

  // Exclude footnote-zone blocks (bottom of page)
  if ((block as any).origin?.bbox) {
    const [, yStart] = (block as any).origin.bbox;
    const pageHeight = 792;
    const yRatio = yStart / pageHeight;
    if (yRatio > 0.8) {
      return false;
    }
  }

  return isShortStandalone;
}

/**
 * Block-level post-processing for essay-academic documents
 * This function runs AFTER initial block extraction and BEFORE sentence splitting
 *
 * 1. Running header removal (global rule - applies to all profiles)
 * 2. Running footer removal (global rule - applies to all profiles)
 * 3. Essay-academic heading recovery (essay_academic profile only)
 */
/**
 * LAYER 1: Block-level STRUCTURAL post-processing (archetype-independent)
 * 
 * Applies to ALL document types (academic, essay, literary, generic)
 * Focuses on semantic role correction without document-type assumptions.
 * 
 * Responsibilities:
 * 1. Author/affiliation/journal metadata protection (never promote to heading)
 * 2. Footnote/footer zone heading ban (bottom 20% of page)
 * 3. References section protection (no heading promotion inside)
 * 4. Hyphenated slug/URL fragment rejection
 * 5. Noun-phrase heading promotion (common structural rule)
 * 
 * DOES NOT handle:
 * - Running header/footer removal (academic-specific)
 * - STEM journal conventions (academic-specific)
 * - Profile-based strictness adjustments (academic-specific)
 */
function postProcessBlocksStructural(
  blocks: Block[],
  log: (msg: string) => void,
): Block[] {
  if (blocks.length === 0) return blocks;

  log(
    `[PostProcess_Structural] Starting block-level structural analysis. Input blocks: ${blocks.length}`,
  );

  let promotedCount = 0;

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const prevBlock = i > 0 ? blocks[i - 1] : undefined;
    const nextBlock = i < blocks.length - 1 ? blocks[i + 1] : undefined;

    // Only process paragraph blocks for potential heading promotion
    if (block.type !== "paragraph") continue;

    // === PROTECTION 1: Author/Affiliation Metadata ===
    // Author and affiliation blocks must NEVER be promoted to heading.
    // This is a semantic rule independent of document type.
    if (looksLikeAuthorBlock(block)) {
      log(
        `[Structural_SKIP] author/affiliation metadata: "${block.content.substring(0, 60)}..."`,
      );
      continue;
    }

    // === PROTECTION 2: References Section Content ===
    // Never promote content inside References sections
    const blockTextLower = block.content.trim().toLowerCase();
    if (
      blockTextLower === "references" ||
      blockTextLower === "bibliography" ||
      blockTextLower === "works cited" ||
      blockTextLower === "literature cited" ||
      blockTextLower === "cited references" ||
      blockTextLower === "reference list"
    ) {
      log(`[Structural_SKIP] references section keyword: "${blockTextLower}"`);
      continue;
    }

    // === PROTECTION 3: Footnote/Footer Zone (bottom 20%) ===
    // Footnotes contain short noun phrases but are not structural headings
    if ((block as any).origin?.bbox) {
      const [, yStart] = (block as any).origin.bbox;
      const pageHeight = 792; // standard PDF height
      const yRatio = yStart / pageHeight;
      if (yRatio > 0.8) {
        log(
          `[Structural_SKIP] footnote zone (yRatio=${yRatio.toFixed(2)}): "${blockTextLower.substring(0, 40)}..."`,
        );
        continue;
      }
    }

    // === PROTECTION 4: Metadata Block Types ===
    // Reject blocks already classified as metadata
    const blockType = block.type as string;
    if (
      blockType === "header" ||
      blockType === "footer" ||
      blockType === "author" ||
      blockType === "journal" ||
      blockType === "affiliation" ||
      blockType === "doi" ||
      blockType === "abstract_label"
    ) {
      log(`[Structural_SKIP] metadata block type: "${blockType}"`);
      continue;
    }

    // === REJECTION 1: Sentence Terminal Punctuation ===
    // Headings do not end with periods/question marks
    const text = block.content.trim();
    if (/[.!?]["']?\s*$/.test(text)) {
      log(`[Structural_SKIP] sentence terminal punctuation: "${text.substring(0, 40)}..."`);
      continue;
    }

    // === REJECTION 2: Length Threshold ===
    // Noun-phrase headings are typically < 120 characters
    if (text.length > 120) {
      log(`[Structural_SKIP] too long (${text.length}): "${text.substring(0, 40)}..."`);
      continue;
    }

    // === REJECTION 3: Hyphenated Slug / URL Pattern ===
    // URLs and citation fragments should not become headings
    if (looksLikeHyphenatedSlug(text)) {
      log(
        `[Structural_SKIP] hyphenated slug (URL fragment): "${text.substring(0, 60)}"`,
      );
      continue;
    }

    // === PROMOTION CRITERIA: Structural Context ===
    // Block qualifies for heading promotion if:
    // 1. It is visually isolated (standalone or surrounded by paragraphs)
    // 2. It has paragraph neighbors (context for prose connection)
    // 3. All protection rules pass
    
    let isVisuallyIsolated = false;
    if ((block as any).isStandalone === true) {
      isVisuallyIsolated = true;
    } else {
      // Consider isolated if surrounded by paragraphs
      // (typical structure: heading + body paragraph)
      if (
        prevBlock &&
        nextBlock &&
        prevBlock.type === "paragraph" &&
        nextBlock.type === "paragraph"
      ) {
        isVisuallyIsolated = true;
      }
    }

    if (!isVisuallyIsolated) {
      log(`[Structural_SKIP] not visually isolated: "${text.substring(0, 40)}..."`);
      continue;
    }

    // === FINAL SAFETY CHECK: Redundant Author/Affiliation Check ===
    // Second defense for metadata protection
    if (looksLikeAuthorBlock(block)) {
      log(`[Structural_SKIP] author/affiliation (redundant check): "${text.substring(0, 60)}..."`);
      continue;
    }

    // === PROMOTE TO HEADING ===
    log(`[Structural_PROMOTE] noun-phrase heading: "${text}"`);
    (block as any).type = "heading";
    (block as any).level = 2;

    // Ensure sentences[] exists after promotion
    const tBlock = block as any;
    if (!tBlock.sentences || tBlock.sentences.length === 0) {
      tBlock.sentences = [
        {
          id: `block-${block.order}-sent-1`,
          text: text.replace(/\.\s*$/, ""), // Remove trailing period only
          order: 1,
          type: "sentence",
        },
      ];
      log(`[Structural_PROMOTE] generated sentence for heading: "${text}"`);
    }
    promotedCount++;
  }

  log(
    `[PostProcess_Structural] Complete. Promoted ${promotedCount} blocks to heading.`,
  );
  return blocks;
}

/**
 * LAYER 2: Academic-specific post-processing
 *
 * Applies ONLY to academic archetype documents.
 * Handles document-type-specific rules:
 * - Running header/footer removal (profile-dependent)
 * - STEM journal conventions
 * - Strictness-based thresholds
 *
 * MUST NOT alter heading/paragraph structure decided by Layer 1.
 * Only performs profile-specific filtering and cleanup.
 */
function postProcessBlocksAcademic(
  blocks: Block[],
  parsingProfile: AcademicParsingProfile,
  log: (msg: string) => void,
): Block[] {
  if (blocks.length === 0) return blocks;

  log(
    `[PostProcess_Academic] Starting academic-specific filtering. Profile: ${parsingProfile}, Input blocks: ${blocks.length}`,
  );

  // Build a map of block text -> pages it appears on (for running header/footer detection)
  const blockTextPages: Map<string, Set<number>> = new Map();
  const blocksByPage: Map<number, Block[]> = new Map();

  for (const block of blocks) {
    const normalizedText = block.content.trim().toLowerCase();
    if (!blockTextPages.has(normalizedText)) {
      blockTextPages.set(normalizedText, new Set());
    }
    blockTextPages.get(normalizedText)!.add(block.page);

    if (!blocksByPage.has(block.page)) {
      blocksByPage.set(block.page, []);
    }
    blocksByPage.get(block.page)!.push(block);
  }

  // === Academic Profile-Based Filtering ===
  // Pattern: essay_academic uses aggressive pattern-based detection
  // journal uses conservative repetition-based detection

  let filteredBlocks: Block[];

  if (parsingProfile === "essay_academic") {
    // Essay-academic: Pattern-based immediate removal
    filteredBlocks = blocks.filter((block) => {
      const text = block.content.trim();
      const normalizedText = text.toLowerCase();

      // Pure page number - always remove
      if (/^\d+$/.test(text)) {
        log(`[Academic] Removing page number: "${text}"`);
        return false;
      }

      // Journal metadata patterns (volume, issue, year)
      if (
        /\b(vol\.?|volume|issue|special\s*issue|\d{4})\b/i.test(text) &&
        text.length < 80
      ) {
        const pages = blockTextPages.get(normalizedText);
        if (pages && pages.size >= 2) {
          log(
            `[Academic] Removing repeated journal metadata: "${text.substring(0, 50)}..."`,
          );
          return false;
        }
        log(
          `[Academic] Preserving journal metadata (not repeated): "${text.substring(0, 50)}..."`,
        );
        return true;
      }

      // Author name pattern (only remove if repeated)
      if (text.length < 40 && /^[A-Z][a-z]+\s+[A-ZĂÎșț]+$/i.test(text)) {
        if (isReferencesHeading(text)) {
          return true;
        }
        if ((block as any).isStandalone || (block as any).mergeProtected) {
          return true;
        }
        const pages = blockTextPages.get(normalizedText);
        if (!pages || pages.size < 2) {
          return true;
        }
        log(`[Academic] Removing author name (repeated): "${text}"`);
        return false;
      }

      // Running title pattern
      const pages = blockTextPages.get(normalizedText);
      if (
        pages &&
        pages.size >= 2 &&
        text.length < 80 &&
        !/[.!?]\s*$/.test(text)
      ) {
        log(`[Academic] Removing running title: "${text.substring(0, 50)}..."`);
        return false;
      }

      return true;
    });
  } else {
    // Journal profile: Repetition-based detection
    const runningHeaderTexts = new Set<string>();
    const requiredPageCount = 2;
    const headerYThreshold = 0.08;

    for (const [text, pages] of Array.from(blockTextPages.entries())) {
      if (pages.size >= requiredPageCount) {
        const words = text.split(/\s+/).filter((w: string) => w.length > 0);
        const hasEndPunctuation = /[.!?]\s*$/.test(text);
        if (words.length <= 4 && !hasEndPunctuation) {
          let topZoneCount = 0;
          for (const page of Array.from(pages)) {
            const pageBlocks = blocksByPage.get(page) || [];
            const blockIndex = pageBlocks.findIndex(
              (b) => b.content.trim().toLowerCase() === text,
            );
            if (blockIndex >= 0 && blockIndex < 3) {
              const block = pageBlocks[blockIndex];
              if (block.origin) {
                const yRatio = block.origin.bbox[1] / 792;
                if (yRatio < headerYThreshold) {
                  topZoneCount++;
                }
              } else if (blockIndex === 0) {
                topZoneCount++;
              }
            }
          }
          if (topZoneCount >= requiredPageCount) {
            runningHeaderTexts.add(text);
            log(`[Academic] Identified running header: "${text.substring(0, 50)}..."`);
          }
        }
      }
    }

    const runningFooterTexts = new Set<string>();
    for (const [text, pages] of Array.from(blockTextPages.entries())) {
      const trimmed = text.trim();
      const tokens = trimmed.split(/\s+/);
      const isPageNumberPattern =
        /^\d+$/.test(trimmed) ||
        (tokens.length <= 2 && tokens.some((t: string) => /^\d+$/.test(t)));

      if (isPageNumberPattern && pages.size >= requiredPageCount) {
        let bottomZoneCount = 0;
        for (const page of Array.from(pages)) {
          const pageBlocks = blocksByPage.get(page) || [];
          const blockIndex = pageBlocks.findIndex(
            (b) => b.content.trim().toLowerCase() === text,
          );
          if (blockIndex >= 0) {
            const block = pageBlocks[blockIndex];
            if (block.origin) {
              if (block.origin.bbox[1] / 792 > 0.9) bottomZoneCount++;
            } else if (blockIndex === pageBlocks.length - 1) {
              bottomZoneCount++;
            }
          }
        }
        if (bottomZoneCount >= requiredPageCount) {
          runningFooterTexts.add(text);
          log(`[Academic] Identified running footer: "${text}"`);
        }
      }
    }

    filteredBlocks = blocks.filter((block) => {
      const normalizedText = block.content.trim().toLowerCase();
      if (runningHeaderTexts.has(normalizedText)) {
        log(
          `[Academic] Removing header block: "${block.content.substring(0, 40)}..."`,
        );
        return false;
      }
      if (runningFooterTexts.has(normalizedText)) {
        log(`[Academic] Removing footer block: "${block.content}"`);
        return false;
      }
      return true;
    });
  }

  const removedCount = blocks.length - filteredBlocks.length;
  if (removedCount > 0) {
    log(`[PostProcess_Academic] Removed ${removedCount} academic-specific blocks`);
  }

  log(`[PostProcess_Academic] Complete. Output blocks: ${filteredBlocks.length}`);
  return filteredBlocks;
}


// Extended result type for parsePDFToBlocks
export interface PDFParseResult {
  blocks: Block[];
  archetype: ArchetypeDetectionResult;
  academicParsing?: AcademicParsingDecision; // Only present when archetype === "academic"
}

// PDF_EXTRACTOR environment variable: pymupdf | pdftotext | auto
type ExtractorMode = "pymupdf" | "pdftotext" | "auto";

function getExtractorMode(): ExtractorMode {
  const mode = process.env.PDF_EXTRACTOR?.toLowerCase();
  if (mode === "pdftotext") return "pdftotext";
  if (mode === "auto") return "auto";
  return "pymupdf"; // Default
}

// ========== PyMuPDF-based Layout Pipeline ==========

interface PDFStats {
  medianBodyFont: number;
  medianLineHeight: number;
  maxLineWidth: number;
  bodyMedianWidth: number;
  headerFooterPatterns: Set<string>;
  pageHeights: Map<number, number>;
  page1LargestFont: number;
  page1TitleCandidateY: number;
}

function calculateStatsFromLines(
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

// Line classification types - now includes metadata types per instructions.md
type LineClassification =
  | "document_title" // Main document title on page 1, largest font
  | "heading"
  | "abstract_label" // "Abstract" keyword only (not body)
  | "abstract_body" // Abstract content after the label
  | "header"
  | "footer"
  | "footnote"
  | "paragraph"
  | "doi" // DOI lines
  | "author" // Author names/affiliations
  | "journal" // Journal info, volume, issue
  | "affiliation"; // Institution affiliations

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
function isDefiniteHeading(line: TextLine, prevLine?: TextLine): boolean {
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
function classifyLineSimplified(
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
  const isJournalMeta =
    (/\b(volume|vol\.?|issue|no\.?|pp\.?|pages)\b/i.test(text) &&
      text.length < 100) ||
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

// Safe hyphen merge patterns (3-5)
const SAFE_HYPHEN_PREFIXES =
  /-(post|pre|non|anti|co|re|self|ex|sub|inter|intra|multi|semi|pseudo|quasi|meta|trans|cross|over|under|out|mid|neo|proto|para|hyper|ultra|super|micro|macro|bio|geo|eco|electro|neuro|cyber|techno|socio|psycho|physio)\s*$/i;

// Check if hyphen join is safe (3-5)
function isSafeHyphenJoin(
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
function mergeLineTexts(
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
function joinLinesWithHyphenPreservation(lines: TextLine[]): string {
  if (lines.length === 0) return "";
  return lines
    .reduce((acc, line, i) => {
      if (i === 0) return line.text;
      return mergeLineTexts(acc, line.text, false); // Not heading context
    }, "")
    .trim();
}

// Line-level heading extraction removed.
// Heading detection is now strictly a block-level concern:
// - Line-level: only `isDefiniteHeading` handles definite headings
//   (ALL CAPS, References, numbered sections, abstract label).
// - Block-level: noun-phrase heading recovery runs in
//   `postProcessBlocksForEssayAcademic` where short paragraph blocks
//   followed by long prose are promoted to `heading`.

// Heading continuation merge helper - for multi-line headings
function shouldMergeHeadingContinuation(
  cur: TextLine,
  next: TextLine,
  stats: PDFStats,
): boolean {
  const curText = cur.text.trim();
  const nextText = next.text.trim();

  // Strong signal: hyphen at end of line
  const hyphenBreak = /-\s*$/.test(curText);

  // CRITICAL: Stop merge if next line contains "Abstract" keyword - it's a section boundary
  if (/\bAbstract\b/i.test(nextText)) {
    return false;
  }

  // Stop merge if next line looks like author line with superscript numbers
  // Pattern: "Name Name1," or "Name Name1, Name Name2" - names followed by superscript numbers and commas
  const hasAuthorPattern =
    /^[A-Z][a-z]+.*[,\d]\s*,?\s*[A-Z]?/.test(nextText) &&
    /\d+[,\s]/.test(nextText) &&
    nextText.includes(",");
  if (hasAuthorPattern) {
    return false;
  }

  // === CRITICAL: Body text detection - NEVER merge headings with body text ===
  // Body text indicators that should NEVER be merged into headings:

  // 1. Next line is too long (> 55 chars) - likely body text, not title continuation
  if (nextText.length > 55) {
    return false;
  }

  // 2. Next line contains commas (common in body sentences, rare in titles)
  // Exception: Short lists in titles like "Methods, Materials, and Results"
  if (nextText.includes(",") && nextText.length > 30) {
    return false;
  }

  // 3. Next line starts with common body text patterns
  // "The", "When", "In", "A", "An", "This", "These", "It", "As", "For" followed by lowercase
  const bodyTextStarters =
    /^(The|When|In|A|An|This|These|It|As|For|Of|To|With|Among|Despite|Although|Because|Since|After|Before|While|Where|Which|That|However|Therefore|Furthermore|Moreover|Additionally|Consequently|Accordingly)\s+[a-z]/;
  if (bodyTextStarters.test(nextText)) {
    return false;
  }

  // 4. Next line has multiple sentences (contains period followed by space and capital)
  if (/\.\s+[A-Z]/.test(nextText)) {
    return false;
  }

  // Font similarity check
  const similarFont =
    Math.abs(next.fontHeight - cur.fontHeight) <= stats.medianBodyFont * 0.25;

  // Indent similarity check
  const similarIndent =
    Math.abs(next.xStart - cur.xStart) <= stats.medianBodyFont * 0.8;

  // Next line looks like title continuation (short, no terminal punctuation)
  const nextLooksTitle =
    nextText.length <= 55 && !/[.!?]["']?\s*$/.test(nextText);

  // Gap check - titles can have larger gaps but not too far
  const gap = next.y - cur.y;
  const notTooFar = gap > 0 && gap <= stats.medianLineHeight * 6;

  return (
    (hyphenBreak || (similarFont && similarIndent && nextLooksTitle)) &&
    notTooFar
  );
}

// GLOBAL Sentence Continuation Detection (archetype/profile agnostic)
// This function determines if two lines are part of the same sentence
// across page boundaries. It MUST be checked BEFORE any heading or
// paragraph boundary logic to prevent mid-sentence splitting.
// Rule: Header/footer removal is line selection; sentence continuation is line connectivity.
// These are separate concerns - H/F between pages should NOT block sentence merging.
// Types that are NOT prose and should never participate in sentence continuation
const NON_PROSE_TYPES = [
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
const COMMON_ABBREVIATIONS =
  /\b(i\.e\.|e\.g\.|etc\.|et\s+al\.|ibid\.|vs\.|vol\.|fig\.|dr\.|mr\.|ms\.|prof\.)\s*$/i;

// Extended sentence terminator: allows trailing quotes/brackets/paren and footnote markers.
// Examples: "...end."  "...end.)"  "...end.]"  "...end.”"  "...end.1"
const SENTENCE_TERMINATOR_EXTENDED =
  /[.!?]["'\u201D\u2019\]\)]*\s*(?:\d+|[\*\u2020\u2021\u00A7\u00B6])?\s*$/;

function isSentenceContinuation(
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

// Paragraph break detection with enhanced signals
// parsingProfile: "journal" always breaks at page boundaries
//                 "essay_academic" allows continuation across pages with strong signals
// parsingStrictness: Controls threshold sensitivity for layout-based paragraph breaks
//                    "strict" = aggressive breaks (lower thresholds)
//                    "relaxed" = conservative breaks (higher thresholds)
function shouldEndParagraphSimplified(
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
    const lineTerminated =
      SENTENCE_TERMINATOR_EXTENDED.test(curText) &&
      !COMMON_ABBREVIATIONS.test(curText);
    const endsWithColonSemicolon = /[:;]\s*$/.test(curText);

    if (!lineTerminated && !endsWithColonSemicolon && nxtText.length > 0) {
      const nextStartsLower = /^[a-z]/.test(nxtText);
      const nextStartsWithContinuationWord =
        /^(and|or|but|nor|yet|so|that|which|who|whom|whose|where|when|while|because|since|although|though|if|as|to|of|in|on|at|by|with|from|for|into|onto|upon|depending|including|may|might|can|could|should|would|will|shall|must|also|then|thus|hence|thereby|furthermore|moreover|however|nevertheless|nonetheless|whereas|whether|unless|until|after|before|during|between|through|within|without|against|among|beyond|despite|regarding|especially|particularly|specifically)\b/i.test(
          nxtText,
        );

      if (nextStartsLower || nextStartsWithContinuationWord) {
        console.log(
          `[PAGE_BOUNDARY_CONTINUE] Incomplete sentence at page ${currentLine.page}->${nextLine.page}: "${curText.substring(Math.max(0, curText.length - 40))}" -> "${nxtText.substring(0, 40)}" -> CONTINUE`,
        );
        return false;
      }
    }

    console.log(
      `[PAGE_BOUNDARY_BREAK] page ${currentLine.page}->${nextLine.page} -> BREAK`,
    );
    return true;
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

// Helper to generate sentences from content
// Phase 2-2: Supports archetype-aware sentence splitting
// Phase 2-3a FIX: Fallback to paragraph-level unit when sentence split fails
// Phase 2-4: Now includes sentence type (sentence/utterance) for TM eligibility
function generateSentencesFromContent(
  content: string,
  blockOrder: number,
  archetype?: "academic" | "literary" | "essay" | "generic",
): Sentence[] {
  const trimmedContent = content.trim();

  // Phase 2-4: Use splitIntoSentencesWithType for type information
  const sentenceUnits = splitIntoSentencesWithType(trimmedContent, {
    archetype,
  });

  // Filter out invalid/empty sentences
  const validUnits = sentenceUnits.filter(
    (unit) => unit.text.trim().length > 0,
  );

  // FALLBACK: If sentence split produces no valid sentences,
  // promote the entire paragraph as a single semantic unit
  // This ensures the block remains translatable
  if (validUnits.length === 0 && trimmedContent.length > 0) {
    console.log(
      `[PDF_EXTRACTOR] Fallback: Block ${blockOrder} sentence split empty, promoting paragraph as unit (${trimmedContent.length} chars)`,
    );
    return [
      {
        id: `block-${blockOrder}-sent-1`,
        text: trimmedContent,
        order: 1,
        type: "sentence", // Phase 2-4: Fallback units are treated as sentences
        isFallbackUnit: true, // Mark as fallback for potential TM handling
      },
    ];
  }

  // Phase 2-4: Map SentenceUnit to Sentence with type field
  return validUnits.map((unit, index) => ({
    id: `block-${blockOrder}-sent-${index + 1}`,
    text: unit.text.trim(),
    order: index + 1,
    type: unit.type, // Phase 2-4: Preserve sentence type from splitting
  }));
}

// Block creation helper - STRUCTURAL FIX per instructions.md
// Translatable blocks own sentences[], metadata blocks do NOT

// Phase 1: Remove trailing punctuation from headings/titles
function removeTrailingPunctuation(text: string): string {
  // Remove trailing period, but preserve other meaningful punctuation like ? or !
  return text.replace(/\.\s*$/, "").trim();
}

// Phase 2-2: Archetype parameter for sentence splitting mode
function createTranslatableBlock(
  type: TranslatableBlockType,
  content: string,
  page: number,
  order: number,
  origin?: { page: number; bbox: [number, number, number, number] },
  archetype?: "academic" | "literary" | "essay" | "generic",
  deferSentenceSplitting: boolean = false,
): TranslatableBlock {
  let trimmedContent = content.trim();

  // Phase 1: Remove trailing punctuation from document_title and heading
  if (type === "document_title" || type === "heading") {
    trimmedContent = removeTrailingPunctuation(trimmedContent);
  }

  // Phase 2-2 FIX: Heading is a translatable semantic unit
  // Per instructions: "Heading ≠ sentence, but still a semantic unit"
  // - Heading must have sentences = [{ text: content }]
  // - Do NOT auto-append punctuation
  // - This makes heading translatable while preserving clean text
  let sentences: Sentence[];

  if (["document_title", "heading"].includes(type)) {
    // Create single semantic unit for heading (no punctuation added)
    // Phase 2-4: Headings are always type "sentence" (complete semantic units)
    sentences = [
      {
        id: `block-${order}-sent-1`,
        text: trimmedContent, // Clean text, NO punctuation
        order: 1,
        type: "sentence", // Headings are full sentences
      },
    ];
  } else {
    // Paragraph and abstract_body use normal sentence splitting
    if (deferSentenceSplitting) {
      // Defer sentence splitting until archetype is known (create empty sentences[] placeholder)
      sentences = [];
    } else {
      sentences = generateSentencesFromContent(
        trimmedContent,
        order,
        archetype,
      );
    }
  }

  const block: TranslatableBlock = {
    type,
    content: trimmedContent,
    sentences, // Single semantic unit for headings, split sentences for body blocks
    page,
    order,
    origin, // Layout information for post-processing (yRatio calculation)
  };

  if (type === "document_title") block.level = 1; // Document title is level 1
  if (type === "heading") block.level = 2;
  if (type === "abstract_body") block.level = 1; // Abstract body is a major section

  return block;
}

function createMetadataBlock(
  type: MetadataBlockType,
  content: string,
  page: number,
  order: number,
  origin?: { page: number; bbox: [number, number, number, number] },
): MetadataBlock {
  let trimmedContent = content.trim();

  // Phase 1: Clean abstract_label - remove trailing punctuation
  if (type === "abstract_label") {
    trimmedContent = removeTrailingPunctuation(trimmedContent);
  }

  return {
    type,
    content: trimmedContent,
    page,
    order,
    origin, // Layout information for post-processing
    // NO sentences[] - metadata blocks are non-translatable
  };
}

// Phase 2-3a: Create non-semantic block (excluded from sentence model)
function createNonSemanticBlock(
  type: NonSemanticBlockType,
  content: string,
  page: number,
  order: number,
  origin?: { page: number; bbox: [number, number, number, number] },
  preserveLineBreaks: boolean = true,
): NonSemanticBlock {
  return {
    type,
    content: content.trim(),
    page,
    order,
    origin, // Layout information for post-processing
    preserveLineBreaks,
    // NO sentences[] - non-semantic blocks are not for translation
  };
}

// Phase 1 requirement: Normalize heading-like blocks to remove trailing punctuation
// This is a hard normalization rule applied at block creation time
function normalizeHeadingLikeText(text: string): string {
  return text.replace(/[.:]\s*$/, "").trim();
}

// Unified block creation - routes to appropriate creator
// Phase 2-2: Archetype parameter flows through block creation chain
function createBlock(
  type: BlockType,
  content: string,
  page: number,
  order: number,
  origin?: { page: number; bbox: [number, number, number, number] },
  archetype?: "academic" | "literary" | "essay" | "generic",
  deferSentenceSplitting: boolean = false,
): Block {
  // Phase 1: Apply trailing punctuation normalization for heading-like blocks
  let normalizedContent = content;
  if (["document_title", "heading", "abstract_label"].includes(type)) {
    normalizedContent = normalizeHeadingLikeText(content);
  }

  // Phase 2-3a: Non-semantic blocks (reference_block)
  if (["reference_block"].includes(type)) {
    return createNonSemanticBlock(
      type as NonSemanticBlockType,
      content,
      page,
      order,
      origin,
      true,
    );
  }

  if (
    ["document_title", "heading", "paragraph", "abstract_body"].includes(type)
  ) {
    return createTranslatableBlock(
      type as TranslatableBlockType,
      normalizedContent,
      page,
      order,
      origin,
      archetype,
      deferSentenceSplitting,
    );
  }
  return createMetadataBlock(
    type as MetadataBlockType,
    normalizedContent,
    page,
    order,
    origin,
  );
}

// PyMuPDF-based block extraction
// parsingStrictness: "strict" enables aggressive removal (STEM journals), "relaxed" preserves content (essays)
// parsingProfile: "journal" applies STEM assumptions, "essay_academic" disables them
async function parsePDFToBlocksWithPyMuPDF(
  buffer: Buffer,
  parsingStrictness: AcademicParsingStrictness = "relaxed",
  parsingProfile: AcademicParsingProfile = "journal",
  deferSentenceSplitting: boolean = false,
): Promise<Block[]> {
  const result = await extractPdfLines(buffer);
  let lines = result.lines;
  
  // === ENRICHMENT: Add origin (bbox) information to each TextLine ===
  // This enables layout role detection in post-processing
  lines = lines.map((line) => ({
    ...line,
    origin: {
      page: line.page,
      bbox: [line.xStart, line.y, line.xEnd, line.y + line.fontHeight] as [number, number, number, number],
    },
  }));

  const stats = calculateStatsFromLines(lines, result.pageHeights);

  // File-based logging for debugging (bypasses workflow log truncation)
  const fs = await import("fs");
  const debugLog = (msg: string) => {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(
      "/tmp/pdf_archetype_debug.log",
      `[${timestamp}] ${msg}\n`,
    );
    console.log(msg);
  };

  // Log verification info
  debugLog(
    `[PDF_EXTRACTOR] Extractor: ${result.extractorVersion}, parsingStrictness: ${parsingStrictness}, parsingProfile: ${parsingProfile}`,
  );
  debugLog(
    `[PDF_EXTRACTOR] Pages: ${Object.keys(result.pageHeights).length}, Lines: ${lines.length}`,
  );

  // === UNIFIED PIPELINE (journal and essay_academic use same logic) ===
  // essay_academic is "relaxed journal" - uses same paragraph logic but with:
  // - ALL CAPS heading OFF
  // - Section keyword heading OFF
  // - Page boundary continuation signals allowed
  // Classify all lines first - STRUCTURAL FIX per instructions.md: includes metadata types
  // parsingStrictness enables stricter classification rules when "strict"
  // parsingProfile determines which RULE SET to apply (journal vs essay_academic)
  const classifiedTypes: LineClassification[] = lines.map((line, i) =>
    classifyLineSimplified(
      line,
      stats,
      i > 0 ? lines[i - 1] : undefined,
      parsingStrictness,
      parsingProfile,
    ),
  );

  // ============================================================
  // DEFINITE HEADING PRE-DETECTION (runs BEFORE paragraph merge)
  // ============================================================
  // Mark standalone ALL CAPS headings that cannot be absorbed into paragraphs.
  // These bypass the SKIP_FAKE_HEADING check in the main loop.
  const definiteHeadings: boolean[] = lines.map((line, i) =>
    isDefiniteHeading(line, i > 0 ? lines[i - 1] : undefined),
  );

  // Log definite headings for debugging
  definiteHeadings.forEach((isDef, i) => {
    if (isDef) {
      debugLog(
        `[DEFINITE_HEADING] Line ${i}: "${lines[i].text.trim().substring(0, 40)}"`,
      );
    }
  });

  const blocks: Block[] = [];
  let currentParaLines: TextLine[] = [];
  let lastPage = 1;
  let inAbstractBody = false; // Track if we're collecting abstract body lines
  let abstractBodyLines: TextLine[] = [];

  // Phase 2-3a: Track References section
  let inReferencesSection = false;
  let referenceLines: TextLine[] = [];

  // Helper to flush current paragraph with hyphen preservation
  const flushParagraph = () => {
    if (currentParaLines.length > 0) {
      const paraContent = joinLinesWithHyphenPreservation(currentParaLines);

      if (paraContent.length > 20) {
        // Use first line's origin for block layout role
        const firstLineOrigin = currentParaLines[0].origin;
        blocks.push(
          createBlock(
            "paragraph",
            paraContent,
            lastPage,
            blocks.length,
            firstLineOrigin,
            undefined,
            deferSentenceSplitting,
          ),
        );
      }
      currentParaLines = [];
    }
  };

  // Helper to flush abstract body
  const flushAbstractBody = () => {
    if (abstractBodyLines.length > 0) {
      const abstractContent =
        joinLinesWithHyphenPreservation(abstractBodyLines);
      if (abstractContent.length > 20) {
        // Use first line's origin for block layout role
        const firstLineOrigin = abstractBodyLines[0].origin;
        blocks.push(
          createBlock(
            "abstract_body",
            abstractContent,
            lastPage,
            blocks.length,
            firstLineOrigin,
            undefined,
            deferSentenceSplitting,
          ),
        );
      }
      abstractBodyLines = [];
      inAbstractBody = false;
    }
  };

  // Phase 2-3a: Helper to flush reference block
  // NOTE:
  // reference_block is presentation-only.
  // content intentionally preserves original line breaks.
  // This block is non-translatable and excluded from semantic / TM processing.
  const flushReferenceBlock = () => {
    if (referenceLines.length > 0) {
      const rawContent = referenceLines.map((l) => l.text).join("\n");
      if (rawContent.length > 10) {
        // Use first line's origin for block layout role
        const firstLineOrigin = referenceLines[0].origin;
        blocks.push(
          createNonSemanticBlock(
            "reference_block",
            rawContent,
            lastPage,
            blocks.length,
            firstLineOrigin,
            true,
          ),
        );
      }
      referenceLines = [];
    }
  };

  // Helper: Find effective next content line (skipping headers/footers AND metadata)
  // This is crucial for page boundary continuation - we need to check against
  // actual content, not header/footer/metadata lines that will be handled separately
  // Skipped types: header, footer, author, journal, affiliation, doi, footnote (all non-body content)
  // NOTE: "footnote" includes page numbers which are often misclassified as footnotes
  //
  // KEY INSIGHT from user: If current line is INCOMPLETE (no terminator), then
  // the next line CANNOT be a heading. Headings only appear after complete sentences.
  // So if currentLineText doesn't end with terminator, skip any "heading" lines.
  const findEffectiveNextLine = (
    startIndex: number,
    currentPage?: number,
    currentLineText?: string,
  ): {
    line: TextLine | undefined;
    classification: LineClassification | undefined;
    index: number;
  } => {
    const skipTypes = [
      "header",
      "footer",
      "author",
      "journal",
      "affiliation",
      "doi",
      "footnote",
      "abstract_label",
    ];

    // Check if current line is incomplete (no sentence terminator)
    const currentIsIncomplete = currentLineText
      ? !/[.!?]["'\u201D\u2019]?\s*$/.test(currentLineText.trim()) &&
        !/:\s*$/.test(currentLineText.trim())
      : false;

    let lookAhead = startIndex;
    while (lookAhead < lines.length) {
      const classification = classifiedTypes[lookAhead];
      const candidateLine = lines[lookAhead];

      // Skip explicit non-content types
      if (skipTypes.includes(classification)) {
        lookAhead++;
        continue;
      }

      // KEY RULE: If current line is incomplete, skip "heading" lines
      // Because headings can only appear after complete sentences
      // This handles running headers misclassified as headings
      if (currentIsIncomplete && classification === "heading") {
        debugLog(
          `[SKIP_HEADING_AFTER_INCOMPLETE] Skipping "${candidateLine.text.trim().substring(0, 40)}..." (current line incomplete, cannot be heading)`,
        );
        lookAhead++;
        continue;
      }

      return { line: candidateLine, classification, index: lookAhead };
    }
    return { line: undefined, classification: undefined, index: -1 };
  };

  // Track indices that have been pulled into previous paragraphs (for page boundary continuation)
  const processedIndices = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    // Skip lines that were already pulled into a previous paragraph
    if (processedIndices.has(i)) {
      continue;
    }

    const line = lines[i];
    // CRITICAL: Definite headings override classifiedTypes
    // This ensures ALL CAPS standalone headings like "CONCLUSIONS" are treated as headings
    // even when essay_academic profile disables ALL CAPS heading detection in classifyLineSimplified
    let type = definiteHeadings[i] ? "heading" : classifiedTypes[i];

    // Debug: Track specific content to understand classification
    if (
      line.text.toLowerCase().includes("ai vs") ||
      line.text.toLowerCase().includes("human translator")
    ) {
      debugLog(
        `[LINE_CLASSIFY] Line ${i}: type="${type}", text="${line.text.substring(0, 80)}..."`,
      );
    }

    // Find effective next line (skipping headers/footers)
    // This ensures page boundary continuation checks against actual content
    // Pass current page and text to enable smart heading skip when current line is incomplete
    const effective = findEffectiveNextLine(i + 1, line.page, line.text);
    const nextLine = effective.line;
    const nextClassification = effective.classification;

    // Skip headers/footers (removed from output entirely)
    // But allow explicit section headings to terminate References even if misclassified
    if (type === "header" || type === "footer") {
      if (inReferencesSection && isExplicitSectionHeading(line.text)) {
        flushReferenceBlock();
        inReferencesSection = false;
        type = "heading";
      } else {
        continue;
      }
    }

    // === METADATA BLOCKS (non-translatable, per instructions.md section 4.3) ===
    // These are isolated BEFORE semantic unit creation

    if (type === "doi") {
      flushParagraph();
      flushAbstractBody();
      blocks.push(
        createMetadataBlock("doi", line.text.trim(), line.page, blocks.length, line.origin),
      );
      lastPage = line.page;
      continue;
    }

    if (type === "author") {
      flushParagraph();
      flushAbstractBody();
      blocks.push(
        createMetadataBlock(
          "author",
          line.text.trim(),
          line.page,
          blocks.length,
          line.origin,
        ),
      );
      lastPage = line.page;
      continue;
    }

    if (type === "journal") {
      flushParagraph();
      flushAbstractBody();
      blocks.push(
        createMetadataBlock(
          "journal",
          line.text.trim(),
          line.page,
          blocks.length,
          line.origin,
        ),
      );
      lastPage = line.page;
      continue;
    }

    if (type === "affiliation") {
      flushParagraph();
      flushAbstractBody();
      blocks.push(
        createMetadataBlock(
          "affiliation",
          line.text.trim(),
          line.page,
          blocks.length,
          line.origin,
        ),
      );
      lastPage = line.page;
      continue;
    }

    // === ABSTRACT PROCESSING (per instructions.md: section with label + body) ===
    // "abstract_label" is metadata (non-translatable)
    // Following paragraphs until next heading become "abstract_body" (translatable)

    if (type === "abstract_label") {
      flushParagraph();
      flushAbstractBody();
      blocks.push(
        createMetadataBlock(
          "abstract_label",
          line.text.trim(),
          line.page,
          blocks.length,
          line.origin,
        ),
      );
      inAbstractBody = true; // Start collecting abstract body
      lastPage = line.page;
      continue;
    }

    // If we're in abstract body mode, check for termination conditions
    // 1. heading or document_title
    // 2. Keywords/Introduction/1. pattern (section boundary keywords)
    if (inAbstractBody) {
      const shouldTerminateAbstract =
        type === "heading" ||
        type === "document_title" ||
        // Keywords line terminates abstract (but is NOT abstract body)
        /^keywords?\s*[:.]?\s*/i.test(line.text.trim()) ||
        // Introduction heading pattern (numbered or standalone)
        /^1\.?\s*(introduction|overview)/i.test(line.text.trim()) ||
        /^introduction$/i.test(line.text.trim());

      if (shouldTerminateAbstract) {
        flushAbstractBody();
      }
    }

    // === DOCUMENT TITLE PROCESSING (Phase 1) ===
    // Similar to heading but highest-level translatable block
    // Supports multi-line title merge with hyphen preservation (e.g., "Post-" + "Humanism")
    if (type === "document_title") {
      flushParagraph();
      flushAbstractBody();

      // Merge consecutive document_title lines with isHeading=true for safe hyphen join
      let titleText = line.text.trim();
      let j = i;
      while (j + 1 < lines.length) {
        const nextCand = lines[j + 1];
        const nextCandType = classifiedTypes[j + 1];

        // Phase 1: Stop if next is any metadata type (author, affiliation, etc.) - never merge with metadata
        if (
          [
            "header",
            "footer",
            "abstract_label",
            "doi",
            "author",
            "journal",
            "affiliation",
          ].includes(nextCandType)
        )
          break;

        // Stop if next is regular heading (title merge ends at section headings)
        if (nextCandType === "heading") break;

        // Only merge with continuation document_title lines or paragraphs that look like title continuation
        const isTitleContinuation =
          nextCandType === "document_title" ||
          (nextCandType === "paragraph" &&
            shouldMergeHeadingContinuation(lines[j], nextCand, stats));

        if (!isTitleContinuation) break;

        titleText = mergeLineTexts(titleText, nextCand.text.trim(), true); // isHeading=true for hyphen preservation
        j++;
      }

      blocks.push(
        createBlock(
          "document_title",
          titleText,
          line.page,
          blocks.length,
          line.origin,
          undefined,
          deferSentenceSplitting,
        ),
      );
      lastPage = line.page;
      i = j; // Skip merged lines
      continue;
    }

    // ============================================================
    // REFERENCES SECTION DETECTION (HIGHEST PRIORITY)
    // ============================================================
    // Detect References heading FIRST, before any other heading processing.
    // Once References is detected, ALL subsequent lines are references
    // until end of document (no other heading can end references).
    if (!inReferencesSection && type === "heading") {
      const headingText = line.text.trim();
      if (isReferencesHeading(headingText)) {
        console.log(
          `[PDF_EXTRACTOR] References section detected (FIRST-PRIORITY): "${headingText}"`,
        );
        flushParagraph();
        flushAbstractBody();
        flushReferenceBlock(); // Flush any pending references before new section
        inReferencesSection = true;

        // Create References heading block
        blocks.push(
          createBlock(
            "heading",
            headingText,
            line.page,
            blocks.length,
            line.origin,
            undefined,
            deferSentenceSplitting,
          ),
        );
        lastPage = line.page;
        continue; // Skip all further processing for References heading
      }
    }

    // ============================================================
    // REFERENCES SECTION STATE - SKIP ALL LINE PROCESSING
    // ============================================================
    // Once in References, collect ALL lines without classification or heading detection.
    // No heading, no paragraph split, no sentence analysis.
    if (inReferencesSection) {
      const headingText = line.text.trim();
      const nextHeadingText = nextLine?.text.trim() || "";
      const nextIsHeading = nextClassification === "heading";
      const nextIsReferenceHeading =
        nextIsHeading && isReferencesHeading(nextHeadingText);
      const yGapToNext = nextLine ? nextLine.y - line.y : 0;
      const hasHeadingGap = yGapToNext >= stats.medianLineHeight * 1.5;
      const pageBreakToHeading =
        nextLine && nextLine.page !== line.page && nextIsHeading;

      // End references BEFORE creating/extending reference_block if a new section heading appears
      if (
        (nextIsHeading && !nextIsReferenceHeading && hasHeadingGap) ||
        (pageBreakToHeading && !nextIsReferenceHeading)
      ) {
        referenceLines.push(line);
        flushReferenceBlock();
        inReferencesSection = false;
        continue;
      }

      // End references when current line is an explicit non-reference section heading
      if (isExplicitSectionHeading(headingText)) {
        flushReferenceBlock();
        inReferencesSection = false;
        // fall through to normal heading processing
      } else if (type === "heading" && !isReferencesHeading(headingText)) {
        flushReferenceBlock();
        inReferencesSection = false;
        // fall through to normal heading processing
      } else {
        referenceLines.push(line);
        // Create reference block at page breaks only
        if (line.page !== nextLine?.page && referenceLines.length > 0) {
          flushReferenceBlock();
        }
        continue; // ❗ Skip ALL further processing - no classification, no heading, no paragraph logic
      }
    }

    // Heading processing with lookahead merge (for "Post-" + "Humanism" etc.)
    if (type === "heading") {
      // ============================================================
      // DEFINITE HEADING BYPASS
      // ============================================================
      // If this is a definite heading (ALL CAPS standalone), it ALWAYS creates
      // a heading block, regardless of paragraph completion status.
      // This ensures "CONCLUSIONS", "REFERENCES", etc. are never absorbed.
      const isDefinite = definiteHeadings[i];

      // KEY FIX: If current paragraph is incomplete (last line has no terminator),
      // this "heading" cannot be a real heading - it's likely a running header.
      // EXCEPTION: Definite headings (ALL CAPS standalone) always pass through.
      if (!isDefinite && currentParaLines.length > 0) {
        const lastParaLine = currentParaLines[currentParaLines.length - 1];
        const lastText = lastParaLine.text.trim();
        const lastIsIncomplete =
          !/[.!?]["'\u201D\u2019]?\s*$/.test(lastText) &&
          !/:\s*$/.test(lastText);
        if (lastIsIncomplete) {
          debugLog(
            `[SKIP_FAKE_HEADING] Skipping "${line.text.trim().substring(0, 40)}..." (current paragraph incomplete)`,
          );
          continue; // Skip this line, don't flush
        }
      }

      if (isDefinite) {
        debugLog(
          `[DEFINITE_HEADING_PATH] Creating definite heading: "${line.text.substring(0, 60)}..."`,
        );
      } else {
        debugLog(
          `[HEADING_PATH] Creating heading: "${line.text.substring(0, 60)}..."`,
        );
      }
      flushParagraph();
      flushReferenceBlock(); // Phase 2-3a: Flush any pending references before heading

      // Merge consecutive heading lines with isHeading=true for safe hyphen join
      let headingText = line.text.trim();
      let j = i;
      while (j + 1 < lines.length) {
        const nextCand = lines[j + 1];
        const nextCandType = classifiedTypes[j + 1];

        // Phase 1: Stop if next is metadata, document_title, or other non-mergeable types
        // Critical: author/affiliation/abstract_label are NEVER merged into headings
        if (
          [
            "header",
            "footer",
            "abstract_label",
            "doi",
            "author",
            "journal",
            "affiliation",
            "document_title",
          ].includes(nextCandType)
        )
          break;

        // Check if should merge
        if (!shouldMergeHeadingContinuation(lines[j], nextCand, stats)) break;

        headingText = mergeLineTexts(headingText, nextCand.text.trim(), true); // isHeading=true
        j++;
      }

      // Phase 2-3a: Detect References section heading
      // ❗ NOTE: References detection now happens FIRST (see above)
      // This section should never be reached because References heading
      // is detected and handled before reaching normal heading processing.

      blocks.push(
        createBlock(
          "heading",
          headingText,
          line.page,
          blocks.length,
          line.origin,
          undefined,
          deferSentenceSplitting,
        ),
      );
      lastPage = line.page;
      i = j; // Skip merged lines
      continue;
    }

    // Footnote processing - flush before, create separate paragraph block
    if (type === "footnote") {
      flushParagraph();
      flushAbstractBody();
      blocks.push(
        createBlock(
          "paragraph",
          line.text,
          line.page,
          blocks.length,
          line.origin,
          undefined,
          deferSentenceSplitting,
        ),
      );
      lastPage = line.page;
      continue;
    }

    // === PARAGRAPH / ABSTRACT BODY / REFERENCES PROCESSING ===
    // Phase 2-3a: If in References section, collect as reference_block (no sentence parsing)
    // If in abstract body mode, collect lines as abstract body
    // Otherwise, collect as regular paragraph

    // DEBUG: Log when we hit the target case (style/nuance -> are preserved)
    const curTextDbg = line.text.trim().toLowerCase();
    const nextTextDbg = nextLine?.text.trim().toLowerCase() || "";
    if (
      curTextDbg.includes("nuance") ||
      curTextDbg.includes("style and") ||
      nextTextDbg.includes("are preserved")
    ) {
      debugLog(
        `[MAIN_LOOP_DEBUG] Processing line page=${line.page}, nextPage=${nextLine?.page}`,
      );
      debugLog(
        `[MAIN_LOOP_DEBUG] curText(last 60)="${line.text.trim().substring(Math.max(0, line.text.trim().length - 60))}"`,
      );
      debugLog(
        `[MAIN_LOOP_DEBUG] nextText(first 60)="${nextLine?.text.trim().substring(0, 60) || "(none)"}"`,
      );
      debugLog(
        `[MAIN_LOOP_DEBUG] nextClassification="${nextClassification || "paragraph"}"`,
      );
    }

    // ============================================================
    // STANDALONE PARAGRAPH CANDIDATE HANDLING (aggregation control)
    // ============================================================
    // Standalone lines (e.g., "Changing Translator Roles") should NEVER
    // merge with previous or next paragraphs. Create immediate single-line block.
    // This check runs BEFORE shouldEndParagraphSimplified to prevent merging.
    if (isStandaloneParagraphCandidate(line, stats)) {
      // Flush any accumulated paragraph lines
      if (currentParaLines.length > 0) {
        flushParagraph();
      }

      // Create standalone block immediately
      const blockContent = line.text.trim();
      if (blockContent.length > 0) {
        blocks.push(
          createBlock(
            "paragraph",
            blockContent,
            line.page,
            blocks.length,
            line.origin,
            undefined,
            deferSentenceSplitting,
          ),
        );
        // Mark this block as standalone (merge-protection flag)
        (blocks[blocks.length - 1] as any).isStandalone = true;
      }

      lastPage = line.page;
      continue; // Never merge this line with others
    }

    const shouldSplit = shouldEndParagraphSimplified(
      line,
      nextLine,
      type, // currentClassification
      nextClassification || "paragraph",
      stats,
      parsingProfile,
      parsingStrictness,
    );

    // DEBUG: Log result for target case
    if (
      curTextDbg.includes("nuance") ||
      curTextDbg.includes("style and") ||
      nextTextDbg.includes("are preserved")
    ) {
      debugLog(
        `[MAIN_LOOP_DEBUG] shouldSplit=${shouldSplit}, inReferencesSection=${inReferencesSection}, inAbstractBody=${inAbstractBody}`,
      );
    }

    if (inAbstractBody) {
      // Debug: Track abstract_body path for target content
      if (
        line.text.toLowerCase().includes("ai vs") ||
        line.text.toLowerCase().includes("human translator")
      ) {
        debugLog(
          `[ABSTRACT_BODY_PATH] Line absorbed: "${line.text.substring(0, 60)}..."`,
        );
      }
      // Collecting abstract body lines
      if (shouldSplit && abstractBodyLines.length > 0) {
        abstractBodyLines.push(line);
        flushAbstractBody();
      } else {
        abstractBodyLines.push(line);
      }
    } else {
      // Debug: Track paragraph path for target content
      if (
        line.text.toLowerCase().includes("ai vs") ||
        line.text.toLowerCase().includes("human translator")
      ) {
        debugLog(
          `[PARAGRAPH_PATH] Line added: shouldSplit=${shouldSplit}, currentParaLines.length=${currentParaLines.length}, text="${line.text.substring(0, 60)}..."`,
        );
      }
      // Regular paragraph processing
      // ============================================================
      // LAYOUT-BASED PARAGRAPH BOUNDARIES (per user principle)
      // ============================================================
      // Paragraphs contain MULTIPLE sentences. A sentence ending does NOT
      // indicate a paragraph break. Only LAYOUT signals (indent, gap, heading)
      // should trigger paragraph breaks.
      //
      // REMOVED: "sentence ends → flush" logic (caused false positives)
      // A paragraph like "Sentence one. Sentence two. Sentence three." must
      // stay as ONE block, not split into 3 separate paragraphs.
      const lineText = line.text.trim();
      const lineEndsSentence = /[.!?]["'\u201D\u2019]?\s*$/.test(lineText);
      const lineIsIncomplete = !lineEndsSentence && !/:\s*$/.test(lineText);
      const nextHeadingText = nextLine?.text.trim() || "";
      const nextIsHeading = nextClassification === "heading";
      const nextIsReferenceHeading = nextIsHeading && isReferencesHeading(nextHeadingText);
      const yGapToNext = nextLine ? nextLine.y - line.y : 0;
      const hasHeadingGap = yGapToNext >= stats.medianLineHeight * 1.5;
      const pageBreakToHeading =
        nextLine && nextLine.page !== line.page && nextIsHeading;

      if (inReferencesSection) {
        // End references if a new section heading appears
        if (
          (nextIsHeading && !nextIsReferenceHeading && hasHeadingGap) ||
          (pageBreakToHeading && !nextIsReferenceHeading)
        ) {
          referenceLines.push(line);
          flushReferenceBlock();
          inReferencesSection = false;
          continue;
        }

        if ((type as string) === "heading" && !isReferencesHeading(lineText)) {
          flushReferenceBlock();
          inReferencesSection = false;
          // fall through to normal heading processing
        } else {
          referenceLines.push(line);
          // Create reference block at page breaks only
          if (line.page !== nextLine?.page && referenceLines.length > 0) {
            flushReferenceBlock();
          }
          continue; // Skip ALL further processing - no classification, no heading, no paragraph logic
        }
      }

      currentParaLines.push(line);

      // Only flush when shouldSplit is true (layout-based conditions)
      // NOT when sentence ends - that would create false positives
      if (shouldSplit && currentParaLines.length > 0) {
        flushParagraph();
      } else if (!shouldSplit) {
        // Line is incomplete - check for page boundary continuation
        if (lineIsIncomplete && nextLine && nextLine.page !== line.page) {
          // We're at a page boundary with incomplete sentence
          // Pull in all continuation lines until sentence completes or we hit a real break
          let pullIdx = effective.index;
          while (pullIdx < lines.length && pullIdx >= 0) {
            const pullLine = lines[pullIdx];
            const pullType = classifiedTypes[pullIdx];

            // Skip header/footer/footnote/metadata - they're not content
            if (
              [
                "header",
                "footer",
                "footnote",
                "doi",
                "author",
                "journal",
                "affiliation",
              ].includes(pullType)
            ) {
              pullIdx++;
              continue;
            }

            // Skip "heading" if previous paragraph line is incomplete
            // (real headings only come after complete sentences)
            if (pullType === "heading") {
              const lastPulled = currentParaLines[currentParaLines.length - 1];
              const lastPulledText = lastPulled.text.trim();
              const lastPulledIncomplete =
                !/[.!?]["'\u201D\u2019]?\s*$/.test(lastPulledText) &&
                !/:\s*$/.test(lastPulledText);
              if (lastPulledIncomplete) {
                debugLog(
                  `[PAGE_BOUNDARY_SKIP_HEADING] Skipping "${pullLine.text.trim().substring(0, 40)}..." (last line incomplete)`,
                );
                pullIdx++;
                continue;
              }
            }

            // Found a content line - add it to current paragraph
            debugLog(
              `[PAGE_BOUNDARY_PULL] Pulling "${pullLine.text.trim().substring(0, 50)}..." into paragraph`,
            );
            currentParaLines.push(pullLine);

            // Mark this line as processed (skip in main loop)
            processedIndices.add(pullIdx);

            // Check if this line completes the sentence
            const pullText = pullLine.text.trim();
            const pullComplete =
              /[.!?]["'\u201D\u2019]?\s*$/.test(pullText) ||
              /:\s*$/.test(pullText);
            if (pullComplete) {
              debugLog(
                `[PAGE_BOUNDARY_COMPLETE] Sentence complete at "${pullText.substring(Math.max(0, pullText.length - 40))}"`,
              );
              break;
            }

            pullIdx++;
          }
        }
      }
    }

    lastPage = line.page;
  }

  // Final flush for remaining content
  flushAbstractBody();
  flushReferenceBlock(); // Phase 2-3a: Flush remaining references
  flushParagraph(); // Finalize paragraphs; noun-phrase heading recovery runs later

  // Phase 1 + 2-3a: Enhanced verification logging with all block types
  const documentTitles = blocks.filter((b) => b.type === "document_title");
  const headings = blocks.filter((b) => b.type === "heading");
  const paragraphs = blocks.filter((b) => b.type === "paragraph");
  const metadataBlocks = blocks.filter((b) => isMetadataBlock(b));
  const abstractBodies = blocks.filter((b) => b.type === "abstract_body");
  const referenceBlocks = blocks.filter((b) => b.type === "reference_block");

  // Count removed headers/footers
  const removedHF = classifiedTypes.filter(
    (t) => t === "header" || t === "footer",
  ).length;

  console.log(
    `[PDF_EXTRACTOR] Blocks: ${blocks.length} (Title: ${documentTitles.length}, Headings: ${headings.length}, Paragraphs: ${paragraphs.length}, Abstract: ${abstractBodies.length}, References: ${referenceBlocks.length}, Metadata: ${metadataBlocks.length})`,
  );
  console.log(`[PDF_EXTRACTOR] Removed headers/footers: ${removedHF} lines`);
  console.log(
    `[PDF_EXTRACTOR] Page 1 largest font: ${stats.page1LargestFont.toFixed(1)}pt, median body: ${stats.medianBodyFont.toFixed(1)}pt`,
  );
  console.log(
    `[PDF_EXTRACTOR] Metadata blocks: ${metadataBlocks.map((b) => b.type).join(", ") || "none"}`,
  );

  // Phase 2-3a: Log References detection status
  if (inReferencesSection) {
    console.log(
      `[PDF_EXTRACTOR] Phase 2-3a: References section found, ${referenceBlocks.length} reference blocks created`,
    );
  }

  // Log document title if found
  if (documentTitles.length > 0) {
    console.log(
      `[PDF_EXTRACTOR] Document title: "${documentTitles[0].content.substring(0, 60)}${documentTitles[0].content.length > 60 ? "..." : ""}"`,
    );
  }

  // Log first 5 headings with page/order for debugging
  console.log(`[PDF_EXTRACTOR] First 5 headings (page/order/text):`);
  headings.slice(0, 5).forEach((h, i) => {
    const nextBlock = blocks[h.order + 1];
    const nextPreview = nextBlock
      ? `→ next: [${nextBlock.type}] "${nextBlock.content.substring(0, 30)}..."`
      : "→ (end)";
    console.log(
      `  ${i + 1}. p${h.page}/#${h.order}: "${h.content.substring(0, 50)}${h.content.length > 50 ? "..." : ""}" ${nextPreview}`,
    );
  });

  // ============================================================
  // MARK STANDALONE BLOCKS (merge-protection flag)
  // Runs AFTER aggregation, NOT during paragraph splitting
  // ============================================================
  for (const block of blocks) {
    if (isStandaloneBlock(block)) {
      (block as any).isStandalone = true;
    }
  }

  return blocks;
}

// ========== Legacy pdftotext-based Pipeline ==========

interface BBoxTextElement {
  text: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

async function extractTextWithBBox(
  pdfPath: string,
): Promise<{ elements: BBoxTextElement[]; pageHeights: Map<number, number> }> {
  return new Promise((resolve, reject) => {
    const pdftotext = spawn("pdftotext", [
      "-bbox",
      "-enc",
      "UTF-8",
      pdfPath,
      "-",
    ]);
    let output = "";
    pdftotext.stdout.on("data", (data) => (output += data.toString("utf8")));
    pdftotext.on("close", (code) => {
      if (code !== 0) return reject(new Error("pdftotext failed"));
      resolve(parseBBoxOutput(output));
    });
    pdftotext.on("error", (err) => reject(err));
  });
}

function parseBBoxOutput(html: string): {
  elements: BBoxTextElement[];
  pageHeights: Map<number, number>;
} {
  const elements: BBoxTextElement[] = [];
  const pageHeights = new Map<number, number>();
  const pageRegex = /<page\s+width="([\d.]+)"\s+height="([\d.]+)">/gi;
  const wordRegex =
    /<word\s+xMin="([\d.]+)"\s+yMin="([\d.]+)"\s+xMax="([\d.]+)"\s+yMax="([\d.]+)"[^>]*>([^<]+)<\/word>/gi;

  let pageMatch;
  let pageNum = 0;
  while ((pageMatch = pageRegex.exec(html)) !== null) {
    pageNum++;
    pageHeights.set(pageNum, parseFloat(pageMatch[2]));
    const pageContent = html.substring(
      pageMatch.index,
      html.indexOf("</page>", pageMatch.index),
    );
    let wordMatch;
    while ((wordMatch = wordRegex.exec(pageContent)) !== null) {
      elements.push({
        text: wordMatch[5].replace(/&amp;/g, "&"),
        page: pageNum,
        x: parseFloat(wordMatch[1]),
        y: parseFloat(wordMatch[2]),
        width: parseFloat(wordMatch[3]) - parseFloat(wordMatch[1]),
        height: parseFloat(wordMatch[4]) - parseFloat(wordMatch[2]),
      });
    }
  }
  return { elements, pageHeights };
}

function groupWordsIntoLinesLegacy(
  elements: BBoxTextElement[],
  medianLineHeight: number,
): TextLine[] {
  if (elements.length === 0) return [];

  const lines: TextLine[] = [];
  const elementsByPage = new Map<number, BBoxTextElement[]>();

  for (const el of elements) {
    if (!elementsByPage.has(el.page)) elementsByPage.set(el.page, []);
    elementsByPage.get(el.page)!.push(el);
  }

  Array.from(elementsByPage.entries()).forEach(
    ([page, pageElements]: [number, BBoxTextElement[]]) => {
      pageElements.sort((a: BBoxTextElement, b: BBoxTextElement) => a.y - b.y);
      let currentLine: BBoxTextElement[] = [pageElements[0]];

      for (let i = 1; i < pageElements.length; i++) {
        const el = pageElements[i];
        const prevEl = pageElements[i - 1];
        const yDiff = Math.abs(el.y - prevEl.y);
        const lineThreshold = medianLineHeight * 0.4;

        if (yDiff <= lineThreshold) {
          currentLine.push(el);
        } else {
          if (currentLine.length > 0) {
            lines.push(createTextLineFromElements(currentLine));
          }
          currentLine = [el];
        }
      }

      if (currentLine.length > 0) {
        lines.push(createTextLineFromElements(currentLine));
      }
    },
  );

  return lines;
}

function createTextLineFromElements(elements: BBoxTextElement[]): TextLine {
  elements.sort((a, b) => a.x - b.x);
  const text = elements.map((el) => el.text).join(" ");
  const fontHeights = elements.map((el) => el.height);
  fontHeights.sort((a, b) => a - b);
  const fontHeight = fontHeights[Math.floor(fontHeights.length / 2)];

  return {
    text,
    page: elements[0].page,
    y: elements[0].y,
    xStart: elements[0].x,
    xEnd: elements[elements.length - 1].x + elements[elements.length - 1].width,
    fontHeight,
  };
}

async function parsePDFToBlocksWithPdftotext(
  buffer: Buffer,
  deferSentenceSplitting: boolean = false,
): Promise<Block[]> {
  console.log("[PDF_EXTRACTOR] Using legacy pdftotext extractor");

  const tempPath = path.join(os.tmpdir(), `pdf-${Date.now()}.pdf`);
  await fs.promises.writeFile(tempPath, buffer);

  try {
    const { elements, pageHeights } = await extractTextWithBBox(tempPath);

    // Calculate median line height for grouping
    const heights = elements.map((e) => e.height);
    heights.sort((a, b) => a - b);
    const medianHeight = heights[Math.floor(heights.length / 2)] || 12;
    const medianLineHeight = medianHeight * 1.2;

    let lines = groupWordsIntoLinesLegacy(elements, medianLineHeight);
    
    // === ENRICHMENT: Add origin (bbox) information to each TextLine ===
    // This enables layout role detection in post-processing
    lines = lines.map((line) => ({
      ...line,
      origin: {
        page: line.page,
        bbox: [line.xStart, line.y, line.xEnd, line.y + line.fontHeight] as [number, number, number, number],
      },
    }));
    
    const pageHeightsRecord: Record<number, number> = {};
    pageHeights.forEach((v, k) => {
      pageHeightsRecord[k] = v;
    });

    const stats = calculateStatsFromLines(lines, pageHeightsRecord);

    console.log(`[PDF_EXTRACTOR] Extractor: pdftotext-legacy`);
    console.log(
      `[PDF_EXTRACTOR] Pages: ${pageHeights.size}, Words: ${elements.length}, Lines: ${lines.length}`,
    );

    // Classify all lines - STRUCTURAL FIX per instructions.md: includes metadata types
    const classifiedTypes: LineClassification[] = lines.map((line, i) =>
      classifyLineSimplified(line, stats, i > 0 ? lines[i - 1] : undefined),
    );

    const blocks: Block[] = [];
    let currentParaLines: TextLine[] = [];
    let lastPage = 1;
    let inAbstractBody = false;
    let abstractBodyLines: TextLine[] = [];
    let inReferencesSection = false;
    let referenceLines: TextLine[] = [];

    // Helper to flush current paragraph with hyphen preservation
    const flushParagraph = () => {
      if (currentParaLines.length > 0) {
        const paraContent = joinLinesWithHyphenPreservation(currentParaLines);
        if (paraContent.length > 20) {
          // Use first line's origin for block layout role
          const firstLineOrigin = currentParaLines[0].origin;
          blocks.push(
            createBlock(
              "paragraph",
              paraContent,
              lastPage,
              blocks.length,
              firstLineOrigin,
              undefined,
              deferSentenceSplitting,
            ),
          );
        }
        currentParaLines = [];
      }
    };

    // Helper to flush abstract body
    const flushAbstractBody = () => {
      if (abstractBodyLines.length > 0) {
        const abstractContent =
          joinLinesWithHyphenPreservation(abstractBodyLines);
        if (abstractContent.length > 20) {
          // Use first line's origin for block layout role
          const firstLineOrigin = abstractBodyLines[0].origin;
          blocks.push(
            createBlock(
              "abstract_body",
              abstractContent,
              lastPage,
              blocks.length,
              firstLineOrigin,
              undefined,
              deferSentenceSplitting,
            ),
          );
        }
        abstractBodyLines = [];
        inAbstractBody = false;
      }
    };

    // Helper to flush reference block
    // NOTE:
    // reference_block is presentation-only.
    // content intentionally preserves original line breaks.
    // This block is non-translatable and excluded from semantic / TM processing.
    const flushReferenceBlock = () => {
      if (referenceLines.length > 0) {
        const rawContent = referenceLines.map((l) => l.text).join("\n");
        if (rawContent.length > 10) {
          // Use first line's origin for block layout role
          const firstLineOrigin = referenceLines[0].origin;
          blocks.push(
            createNonSemanticBlock(
              "reference_block",
              rawContent,
              lastPage,
              blocks.length,
              firstLineOrigin,
              true,
            ),
          );
        }
        referenceLines = [];
      }
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const nextLine = i < lines.length - 1 ? lines[i + 1] : undefined;
      const nextClassification = classifiedTypes[i + 1];
      let type = classifiedTypes[i];

      if (type === "header" || type === "footer") {
        if (inReferencesSection && isExplicitSectionHeading(line.text)) {
          flushReferenceBlock();
          inReferencesSection = false;
          type = "heading";
        } else {
          continue;
        }
      }

      // === METADATA BLOCKS (non-translatable) ===
      if (type === "doi") {
        flushParagraph();
        flushAbstractBody();
        blocks.push(
          createMetadataBlock(
            "doi",
            line.text.trim(),
            line.page,
            blocks.length,
            line.origin,
          ),
        );
        lastPage = line.page;
        continue;
      }

      if (type === "author") {
        flushParagraph();
        flushAbstractBody();
        blocks.push(
          createMetadataBlock(
            "author",
            line.text.trim(),
            line.page,
            blocks.length,
            line.origin,
          ),
        );
        lastPage = line.page;
        continue;
      }

      if (type === "journal") {
        flushParagraph();
        flushAbstractBody();
        blocks.push(
          createMetadataBlock(
            "journal",
            line.text.trim(),
            line.page,
            blocks.length,
            line.origin,
          ),
        );
        lastPage = line.page;
        continue;
      }

      if (type === "affiliation") {
        flushParagraph();
        flushAbstractBody();
        blocks.push(
          createMetadataBlock(
            "affiliation",
            line.text.trim(),
            line.page,
            blocks.length,
            line.origin,
          ),
        );
        lastPage = line.page;
        continue;
      }

      // === ABSTRACT PROCESSING ===
      if (type === "abstract_label") {
        flushParagraph();
        flushAbstractBody();
        blocks.push(
          createMetadataBlock(
            "abstract_label",
            line.text.trim(),
            line.page,
            blocks.length,
            line.origin,
          ),
        );
        inAbstractBody = true;
        lastPage = line.page;
        continue;
      }

      if (inAbstractBody && type === "heading") {
        flushAbstractBody();
      }

      // ============================================================
      // REFERENCES SECTION DETECTION (HIGHEST PRIORITY)
      // ============================================================
      // Detect References heading FIRST, before any other heading processing.
      if (!inReferencesSection && type === "heading") {
        const headingText = line.text.trim();
        if (isReferencesHeading(headingText)) {
          console.log(
            `[PDF_EXTRACTOR-PDFTOTEXT] References section detected: "${headingText}"`,
          );
          flushParagraph();
          flushAbstractBody();
          flushReferenceBlock();
          inReferencesSection = true;

          blocks.push(
            createBlock(
              "heading",
              headingText,
              line.page,
              blocks.length,
              line.origin,
              undefined,
              deferSentenceSplitting,
            ),
          );
          lastPage = line.page;
          continue;
        }
      }

      // ============================================================
      // REFERENCES SECTION STATE - SKIP ALL LINE PROCESSING
      // ============================================================
      if (inReferencesSection) {
        const headingText = line.text.trim();
        const nextHeadingText = nextLine?.text.trim() || "";
        const nextIsHeading = nextClassification === "heading";
        const nextIsReferenceHeading =
          nextIsHeading && isReferencesHeading(nextHeadingText);
        const yGapToNext = nextLine ? nextLine.y - line.y : 0;
        const hasHeadingGap = yGapToNext >= stats.medianLineHeight * 1.5;
        const pageBreakToHeading =
          nextLine && nextLine.page !== line.page && nextIsHeading;

        // End references BEFORE creating/extending reference_block if a new section heading appears
        if (
          (nextIsHeading && !nextIsReferenceHeading && hasHeadingGap) ||
          (pageBreakToHeading && !nextIsReferenceHeading)
        ) {
          referenceLines.push(line);
          flushReferenceBlock();
          inReferencesSection = false;
          continue;
        }

        // End references when current line is an explicit non-reference section heading
        if (isExplicitSectionHeading(headingText)) {
          flushReferenceBlock();
          inReferencesSection = false;
          // fall through to normal heading processing
        } else if (type === "heading" && !isReferencesHeading(headingText)) {
          flushReferenceBlock();
          inReferencesSection = false;
          // fall through to normal heading processing
        } else {
          referenceLines.push(line);
          // Create reference block at page breaks only
          if (line.page !== nextLine?.page && referenceLines.length > 0) {
            flushReferenceBlock();
          }
          continue; // ❗ Skip ALL further processing
        }
      }

      // Heading processing with lookahead merge
      if (type === "heading") {
        flushParagraph();

        let headingText = line.text.trim();
        let j = i;
        while (j + 1 < lines.length) {
          const nextCand = lines[j + 1];
          const nextCandType = classifiedTypes[j + 1];

          if (
            [
              "header",
              "footer",
              "abstract_label",
              "doi",
              "author",
              "journal",
              "affiliation",
            ].includes(nextCandType)
          )
            break;
          if (!shouldMergeHeadingContinuation(lines[j], nextCand, stats)) break;

          headingText = mergeLineTexts(headingText, nextCand.text.trim(), true);
          j++;
        }

        blocks.push(
          createBlock(
            "heading",
            headingText,
            line.page,
            blocks.length,
            line.origin,
            undefined,
            deferSentenceSplitting,
          ),
        );
        lastPage = line.page;
        i = j;
        continue;
      }

      // Footnote processing
      if (type === "footnote") {
        flushParagraph();
        flushAbstractBody();
        blocks.push(
          createBlock(
            "paragraph",
            line.text,
            line.page,
            blocks.length,
            line.origin,
            undefined,
            deferSentenceSplitting,
          ),
        );
        lastPage = line.page;
        continue;
      }

      // ============================================================
      // STANDALONE PARAGRAPH CANDIDATE HANDLING (aggregation control)
      // ============================================================
      // Standalone lines should NEVER merge with previous or next paragraphs.
      // Create immediate single-line block.
      if (isStandaloneParagraphCandidate(line, stats)) {
        // Flush any accumulated paragraph lines
        if (currentParaLines.length > 0) {
          const paraContent = joinLinesWithHyphenPreservation(currentParaLines);
          if (paraContent.length > 20) {
            blocks.push(
              createBlock(
                "paragraph",
                paraContent,
                lastPage,
                blocks.length,
                undefined,
                undefined,
                deferSentenceSplitting,
              ),
            );
          }
          currentParaLines = [];
        }

        // Create standalone block immediately
        const blockContent = line.text.trim();
        if (blockContent.length > 0) {
          blocks.push(
            createBlock(
              "paragraph",
              blockContent,
              line.page,
              blocks.length,
              undefined,
              undefined,
              deferSentenceSplitting,
            ),
          );
          // Mark this block as standalone (merge-protection flag)
          (blocks[blocks.length - 1] as any).isStandalone = true;
        }

        lastPage = line.page;
        continue; // Never merge this line with others
      }

      // Paragraph / Abstract body processing
      const shouldSplit = shouldEndParagraphSimplified(
        line,
        nextLine,
        type, // currentClassification
        nextClassification || "paragraph",
        stats,
        "journal", // pdftotext pipeline uses journal profile only
        "relaxed", // pdftotext pipeline uses relaxed strictness
      );

      if (inAbstractBody) {
        if (shouldSplit && abstractBodyLines.length > 0) {
          abstractBodyLines.push(line);
          flushAbstractBody();
        } else {
          abstractBodyLines.push(line);
        }
      } else {
        if (shouldSplit && currentParaLines.length > 0) {
          currentParaLines.push(line);
          const paraContent = joinLinesWithHyphenPreservation(currentParaLines);
          if (paraContent.length > 20) {
            blocks.push(
              createBlock(
                "paragraph",
                paraContent,
                lastPage,
                blocks.length,
                undefined,
                undefined,
                deferSentenceSplitting,
              ),
            );
          }
          currentParaLines = [];
        } else {
          currentParaLines.push(line);
        }
      }

      lastPage = line.page;
    }

    // Final flush for remaining content
    flushAbstractBody();
    if (currentParaLines.length > 0) {
      const paraContent = joinLinesWithHyphenPreservation(currentParaLines);
      if (paraContent.length > 20) {
        blocks.push(
          createBlock(
            "paragraph",
            paraContent,
            lastPage,
            blocks.length,
            undefined,
            undefined,
            deferSentenceSplitting,
          ),
        );
      }
    }

    // Enhanced verification logging with metadata block counts
    const headings = blocks.filter((b) => b.type === "heading");
    const paragraphs = blocks.filter((b) => b.type === "paragraph");
    const metadataBlocks = blocks.filter((b) => isMetadataBlock(b));
    const abstractBodies = blocks.filter((b) => b.type === "abstract_body");

    // Count removed headers/footers
    const removedHF = classifiedTypes.filter(
      (t) => t === "header" || t === "footer",
    ).length;

    console.log(
      `[PDF_EXTRACTOR] Blocks: ${blocks.length} (Headings: ${headings.length}, Paragraphs: ${paragraphs.length}, Abstract: ${abstractBodies.length}, Metadata: ${metadataBlocks.length})`,
    );
    console.log(`[PDF_EXTRACTOR] Removed headers/footers: ${removedHF} lines`);
    console.log(
      `[PDF_EXTRACTOR] Metadata blocks: ${metadataBlocks.map((b) => b.type).join(", ") || "none"}`,
    );

    return blocks;
  } finally {
    await fs.promises.unlink(tempPath).catch(() => {});
  }
}

// ========== Main Entry Point with Fallback Logic ==========

/**
 * Parse PDF to structured blocks
 * Uses PDF_EXTRACTOR environment variable to determine extraction method:
 * - pymupdf (default): Use PyMuPDF, fail hard on error
 * - pdftotext: Use legacy pdftotext only
 * - auto: Try PyMuPDF first, fallback to pdftotext with warning
 */
export async function parsePDFToBlocks(
  buffer: Buffer,
  parsingStrictness: AcademicParsingStrictness = "relaxed",
  parsingProfile: AcademicParsingProfile = "journal",
  deferSentenceSplitting: boolean = false,
): Promise<Block[]> {
  const mode = getExtractorMode();
  console.log(
    `[PDF_EXTRACTOR] Mode: ${mode}, parsingStrictness: ${parsingStrictness}, parsingProfile: ${parsingProfile}`,
  );

  if (mode === "pdftotext") {
    return parsePDFToBlocksWithPdftotext(buffer, deferSentenceSplitting);
  }

  if (mode === "pymupdf") {
    // Fail hard if PyMuPDF is not available or fails
    const available = await checkPyMuPDFAvailable();
    if (!available) {
      throw new Error(
        "[PDF_EXTRACTOR] PyMuPDF not available and mode is 'pymupdf' (no fallback)",
      );
    }
    return parsePDFToBlocksWithPyMuPDF(
      buffer,
      parsingStrictness,
      parsingProfile,
      deferSentenceSplitting,
    );
  }

  // mode === "auto": try PyMuPDF, fallback to pdftotext
  const available = await checkPyMuPDFAvailable();
  if (!available) {
    console.warn(
      "[PDF_EXTRACTOR] PyMuPDF not available, FALLBACK_TO_PDFTOTEXT",
    );
    return parsePDFToBlocksWithPdftotext(buffer, deferSentenceSplitting);
  }

  try {
    return await parsePDFToBlocksWithPyMuPDF(
      buffer,
      parsingStrictness,
      parsingProfile,
      deferSentenceSplitting,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`[PDF_EXTRACTOR] PyMuPDF failed: ${errorMessage}`);
    console.warn("[PDF_EXTRACTOR] FALLBACK_TO_PDFTOTEXT");
    return parsePDFToBlocksWithPdftotext(buffer, deferSentenceSplitting);
  }
}

/**
 * Phase 2-2/2-3: Regenerate sentences with archetype-aware splitting
 * Only applies to paragraph and abstract_body blocks (not headings/titles)
 *
 * Phase 2-3: Now processes ALL archetypes (academic, literary, essay, generic)
 * Each archetype has its own sentence splitting rules
 */
function reprocessBlocksWithArchetype(
  blocks: Block[],
  archetype: DocumentArchetype,
): Block[] {
  // Phase 2-3: All archetypes now have specific splitting logic
  // No early return - process all types
  console.log(
    `[PDF_ARCHETYPE] Reprocessing ${blocks.length} blocks with archetype: ${archetype}`,
  );

  return blocks.map((block, index) => {
    // Only reprocess translatable body blocks
    if (block.type === "paragraph" || block.type === "abstract_body") {
      const translatableBlock = block as TranslatableBlock;
      if (translatableBlock.content) {
        // Regenerate sentences with academic-aware splitting
        const newSentences = generateSentencesFromContent(
          translatableBlock.content,
          index,
          archetype,
        );
        return {
          ...translatableBlock,
          sentences: newSentences,
        };
      }
    }
    return block;
  });
}

/**
 * Parse PDF with archetype detection
 * Returns both blocks AND archetype detection result per instructions.md
 * Use this when you need archetype info for downstream processing
 *
 * Phase 2-2: Now includes archetype-aware sentence reprocessing
 *
 * @param buffer - PDF file buffer
 * @param sourceHint - Optional source provider (e.g., "arxiv", "gutenberg") for source-based archetype
 */
export async function parsePDFWithArchetype(
  buffer: Buffer,
  sourceHint?: string,
): Promise<PDFParseResult> {
  // Write logs to file for debugging (bypasses log truncation)
  const fs = await import("fs");
  const logFile = "/tmp/pdf_archetype_debug.log";
  const log = (msg: string) => {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [PDF_ARCHETYPE] ${msg}\n`;
    fs.appendFileSync(logFile, logLine);
    console.log(`[PDF_ARCHETYPE] ${msg}`);
  };

  log(`=== Starting parsePDFWithArchetype ===`);
  log(`sourceHint: ${sourceHint || "none"}`);

  // Step 1: First pass - NEUTRAL parse (no strictness applied yet)
  // This allows archetype detection from content before applying parsing strategy
  log(`Step 1: First pass with neutral parsing (relaxed mode for safety)`);
  // Defer sentence splitting during initial parsing to avoid doing expensive
  // sentence tokenization until archetype is known. Sentences will be
  // generated later by reprocessBlocksWithArchetype.
  let blocks = await parsePDFToBlocks(buffer, "relaxed", "journal", true);
  log(`Step 1 complete: ${blocks.length} blocks extracted`);

  // Step 2: Detect archetype from source hint or content analysis
  let detectedArchetype: ArchetypeDetectionResult;
  const textSample = blocks
    .slice(0, 20)
    .map((b) => b.content)
    .join("\n")
    .substring(0, 5000);

  if (sourceHint) {
    const sourceArchetype = getArchetypeFromSource(sourceHint);
    if (sourceArchetype) {
      log(
        `Step 2: Source-based archetype: ${sourceArchetype.archetype} (source: ${sourceHint})`,
      );
      detectedArchetype = sourceArchetype;
    } else {
      detectedArchetype = detectArchetypeFromBlocks(blocks, textSample);
      log(
        `Step 2: Auto-detected: ${detectedArchetype.archetype} (confidence: ${detectedArchetype.confidence.toFixed(2)})`,
      );
      log(`Step 2 Signals: ${detectedArchetype.signals.join(", ")}`);
    }
  } else {
    detectedArchetype = detectArchetypeFromBlocks(blocks, textSample);
    log(
      `Step 2: Auto-detected: ${detectedArchetype.archetype} (confidence: ${detectedArchetype.confidence.toFixed(2)})`,
    );
    log(`Step 2 Signals: ${detectedArchetype.signals.join(", ")}`);
  }

  // Step 3: For academic documents, decide parsing strictness and profile
  let academicParsingResult: AcademicParsingDecision | undefined;
  let needsReparse = false;
  let targetStrictness: AcademicParsingStrictness = "relaxed";
  let targetProfile: AcademicParsingProfile = "journal";

  if (detectedArchetype.archetype === "academic") {
    // Compute strictness from essay-like signals
    const strictnessTextSample = blocks
      .filter((b) => b.type === "paragraph" || b.type === "abstract_body")
      .slice(0, 30)
      .map((b) => b.content)
      .join("\n")
      .substring(0, 8000);

    academicParsingResult = detectParsingStrictness(
      blocks,
      strictnessTextSample,
    );
    targetStrictness = academicParsingResult.strictness;
    targetProfile = academicParsingResult.profile;

    log(
      `Step 3: Parsing strictness decided: ${targetStrictness} (score: ${academicParsingResult.score}/12, confidence: ${academicParsingResult.confidence.toFixed(2)})`,
    );
    log(`Step 3: Parsing profile decided: ${targetProfile}`);
    log(`Step 3 Signals: ${academicParsingResult.signals.join(", ")}`);

    // Re-parse needed if:
    // 1. Strictness is strict (first pass was relaxed)
    // 2. Profile is essay_academic (needs different rule set even in relaxed mode)
    if (targetStrictness === "strict" || targetProfile === "essay_academic") {
      needsReparse = true;
      log(
        `Step 3: Re-parse needed for strictness=${targetStrictness}, profile=${targetProfile}`,
      );
    }
  }

  // Step 4: Re-parse with determined strictness and profile if needed
  if (needsReparse) {
    log(
      `Step 4: Re-parsing with strictness=${targetStrictness}, profile=${targetProfile}...`,
    );
    const blocksBeforeReparse = blocks.length;
    // Defer sentence splitting during reparse as well; we'll perform
    // archetype-aware sentence splitting in Step 5.
    blocks = await parsePDFToBlocks(
      buffer,
      targetStrictness,
      targetProfile,
      true,
    );
    log(
      `Step 4 complete: ${blocksBeforeReparse} -> ${blocks.length} blocks after reparse`,
    );
  } else {
    log(
      `Step 4: No re-parse needed (already in relaxed/journal mode or non-academic)`,
    );
  }

  // Step 4.5: Block-level post-processing (structural + academic-specific)
  // Layer 1: Structural post-processing (all archetype-independent rules)
  log(
    `Step 4.5a: Applying block-level structural post-processing`,
  );
  const blocksAfterStructural = postProcessBlocksStructural(blocks, log);

  // Layer 2: Academic-specific post-processing (running headers, profile-specific rules)
  let blocksAfterPostProcess = blocksAfterStructural;
  if (detectedArchetype.archetype === "academic") {
    log(
      `Step 4.5b: Applying academic-specific post-processing (profile=${targetProfile})`,
    );
    const blocksBeforeAcademic = blocksAfterStructural.length;
    blocksAfterPostProcess = postProcessBlocksAcademic(blocksAfterStructural, targetProfile, log);
    log(
      `Step 4.5b complete: ${blocksBeforeAcademic} -> ${blocksAfterPostProcess.length} blocks after academic filtering`,
    );
  } else {
    log(`Step 4.5b: Skipping academic-specific filtering (archetype=${detectedArchetype.archetype})`);
  }

  blocks = blocksAfterPostProcess;

  // Step 5: Reprocess blocks with archetype-aware sentence splitting for ALL archetypes
  // Each archetype (academic, literary, essay, generic) has its own sentence splitting rules
  log(
    `Step 5: Applying archetype-aware sentence splitting (archetype=${detectedArchetype.archetype})`,
  );
  blocks = reprocessBlocksWithArchetype(blocks, detectedArchetype.archetype);

  log(`=== parsePDFWithArchetype complete: ${blocks.length} final blocks ===`);

  return {
    blocks,
    archetype: detectedArchetype,
    academicParsing: academicParsingResult,
  };
}

/**
 * Legacy function for backward compatibility with arXiv crawler and other consumers
 * Signature and contract unchanged: returns plain text string
 * Note: Metadata blocks are included but marked with special prefix for visibility
 */
export async function parsePDF(buffer: Buffer): Promise<string> {
  console.log(
    "[parsePDF] Called - routing through unified parsePDFToBlocks pipeline",
  );
  const blocks = await parsePDFToBlocks(buffer);

  let text = "";
  for (const block of blocks) {
    if (block.type === "heading") {
      text += `\n## ${block.content}\n\n`;
    } else if (block.type === "abstract_body") {
      // Abstract body is translatable, include normally
      text += `${block.content}\n\n`;
    } else if (isMetadataBlock(block)) {
      // Metadata blocks are non-translatable, mark as such
      text += `[${block.type.toUpperCase()}] ${block.content}\n\n`;
    } else {
      text += `${block.content}\n\n`;
    }
  }
  return text.trim();
}

// Standalone paragraph candidate helper
function isStandaloneParagraphCandidate(line: TextLine, stats: PDFStats): boolean {
  const text = line.text.trim();
  if (!text) return false;

  // === PHASE-1 SAFETY GUARD ===
  // Reject URL slug patterns (compensates for missing origin/bbox from PyMuPDF)
  // These are typically footnote URLs or artifact fragments that should not be heading candidates
  if (looksLikeHyphenatedSlug(text)) {
    return false;
  }

  // Must NOT look like a sentence
  if (/[.!?]["']?\s*$/.test(text)) return false;

  // Detect ragged-right: line width vs body-text median width (excludes title/header/footer)
  const lineWidth = (line.xEnd && line.xStart) ? (line.xEnd - line.xStart) : 0;
  const isRaggedRight = stats.bodyMedianWidth > 0 ? lineWidth < stats.bodyMedianWidth * 0.85 : false;

  // Short text length (also checks if line is short)
  const isShort = text.length <= 70;

  // Starts with capital (noun-phrase style)
  const startsWithCapital = /^[A-Z]/.test(text);

  // Title-case pattern: "The Translator as a Cultural Mediator"
  const looksTitleCase = /^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,}$/.test(text);

  // Font emphasis: noticeably larger than body text
  const fontJump = line.fontHeight > stats.medianBodyFont * 1.15;

  // Standalone if (short AND ragged-right) OR (title-case) OR (font jump)
  // This catches subheadings like "Ethical considerations", "Changing Translator Roles"
  return (isShort && isRaggedRight) || looksTitleCase || fontJump;
}