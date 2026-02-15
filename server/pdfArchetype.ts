import type {
  Block,
  ArchetypeDetectionResult,
  AcademicParsingDecision,
  AcademicParsingStrictness,
  AcademicParsingProfile,
} from "./pdfTypes.js";
import { isReferencesHeading } from "./pdfTypes.js";

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
export function detectArchetypeFromBlocks(
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
export function detectParsingStrictness(
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
export function postProcessBlocksStructural(
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
export function postProcessBlocksAcademic(
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

// ========== Private helper functions ==========

function looksLikeHyphenatedSlug(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.includes(" ")) return false;
  return /^[A-Za-z]+(-[A-Za-z]+){2,}-?$/.test(trimmed);
}

function looksLikeAuthorBlock(block: Block): boolean {
  if (!block.content) return false;
  
  const text = block.content.trim();
  
  const isEarlyPosition = (block as any).order !== undefined ? (block as any).order <= 10 : true;
  if (!isEarlyPosition) return false;
  
  if (text.length >= 120) return false;
  
  if (/[.!?]["']?\s*$/.test(text)) return false;
  
  if (!text.includes(" ")) return false;
  
  const namePattern = /^[A-Z][A-Za-zÀ-ÿ]+([\s\-][A-Z][A-Za-zÀ-ÿ]+)*$/;
  if (namePattern.test(text)) {
    const parts = text.split(/[\s\-]+/);
    if (parts.length >= 2 && parts.length <= 4) {
      return true;
    }
  }
  
  const affiliationKeywords = /(University|Institute|Department|Faculty|College|School|Laboratory|Center|Centre|Research Lab|Academy)/i;
  if (affiliationKeywords.test(text)) return true;
  
  return false;
}
