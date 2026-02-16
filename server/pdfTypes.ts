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
// table: Detected table region - no sentence parsing, no translation
export type NonSemanticBlockType = "reference_block" | "table";

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
  return ["reference_block", "table"].includes(block.type);
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

// Extended result type for parsePDFToBlocks
export interface PDFParseResult {
  blocks: Block[];
  archetype: ArchetypeDetectionResult;
  academicParsing?: AcademicParsingDecision; // Only present when archetype === "academic"
}

// PyMuPDF-based Layout Pipeline types
export interface PDFStats {
  medianBodyFont: number;
  medianLineHeight: number;
  maxLineWidth: number;
  bodyMedianWidth: number;
  headerFooterPatterns: Set<string>;
  pageHeights: Map<number, number>;
  page1LargestFont: number;
  page1TitleCandidateY: number;
}

// Line classification types - now includes metadata types per instructions.md
export type LineClassification =
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

// Layout cluster type (currently not used in main file but part of type definitions)
export interface LayoutCluster {
  xStart: number;
  width: number;
  count: number;
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

export function isExplicitSectionHeading(text: string): boolean {
  const trimmed = text.trim();
  const isAllCapsHeading = /^[A-Z][A-Z\s]{3,}$/.test(trimmed);
  const matchesExplicitKeyword =
    /^(bionote|bio\s*note|notes|endnotes|appendix|acknowledg(e)?ments?|about\s+the\s+author|author\s+note|author\s+bio(graphy|graphies)?|biographical\s+note(s)?)$/i.test(
      trimmed,
    );
  return (isAllCapsHeading || matchesExplicitKeyword) && !isReferencesHeading(trimmed);
}
