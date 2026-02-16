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

import type {
  Sentence,
  Block,
  TranslatableBlock,
  MetadataBlock,
  NonSemanticBlock,
  BlockType,
  TranslatableBlockType,
  MetadataBlockType,
  NonSemanticBlockType,
  PDFStats,
  LineClassification,
  DocumentArchetype,
  ArchetypeDetectionResult,
  AcademicParsingDecision,
  AcademicParsingStrictness,
  AcademicParsingProfile,
  PDFParseResult,
} from "./pdfTypes.js";

import {
  isTranslatableBlock,
  isMetadataBlock,
  isNonSemanticBlock,
  isReferencesHeading,
  isExplicitSectionHeading,
} from "./pdfTypes.js";

import { calculateStatsFromLines } from "./pdfLayout.js";
import { mergeLineTexts, joinLinesWithHyphenPreservation } from "./pdfLayout.js";
import { classifyLineSimplified, isDefiniteHeading, fixupAuthorClassifications } from "./pdfLineClassifier.js";
import { shouldEndParagraphSimplified } from "./pdfParagraph.js";
import { isSentenceContinuation } from "./pdfGrammar.js";
import {
  detectArchetypeFromBlocks,
  getArchetypeFromSource,
  detectParsingStrictness,
  postProcessBlocksStructural,
  postProcessBlocksAcademic,
} from "./pdfArchetype.js";

export { initializePdfExtractor };

type ExtractorMode = "pymupdf" | "pdftotext" | "auto";

function getExtractorMode(): ExtractorMode {
  const mode = process.env.PDF_EXTRACTOR?.toLowerCase();
  if (mode === "pdftotext") return "pdftotext";
  if (mode === "auto") return "auto";
  return "pymupdf";
}

function generateSentencesFromContent(
  content: string,
  blockOrder: number,
  archetype?: "academic" | "literary" | "essay" | "generic",
): Sentence[] {
  const trimmedContent = content.trim();

  const sentenceUnits = splitIntoSentencesWithType(trimmedContent, {
    archetype,
  });

  const validUnits = sentenceUnits.filter(
    (unit) => unit.text.trim().length > 0,
  );

  if (validUnits.length === 0 && trimmedContent.length > 0) {
    console.log(
      `[PDF_EXTRACTOR] Fallback: Block ${blockOrder} sentence split empty, promoting paragraph as unit (${trimmedContent.length} chars)`,
    );
    return [
      {
        id: `block-${blockOrder}-sent-1`,
        text: trimmedContent,
        order: 1,
        type: "sentence",
        isFallbackUnit: true,
      },
    ];
  }

  return validUnits.map((unit, index) => ({
    id: `block-${blockOrder}-sent-${index + 1}`,
    text: unit.text.trim(),
    order: index + 1,
    type: unit.type,
  }));
}

function removeTrailingPunctuation(text: string): string {
  return text.replace(/\.\s*$/, "").trim();
}

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

  if (type === "document_title" || type === "heading") {
    trimmedContent = removeTrailingPunctuation(trimmedContent);
  }

  let sentences: Sentence[];

  if (["document_title", "heading"].includes(type)) {
    sentences = [
      {
        id: `block-${order}-sent-1`,
        text: trimmedContent,
        order: 1,
        type: "sentence",
      },
    ];
  } else {
    if (deferSentenceSplitting) {
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
    sentences,
    page,
    order,
    origin,
  };

  if (type === "document_title") block.level = 1;
  if (type === "heading") block.level = 2;
  if (type === "abstract_body") block.level = 1;

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

  if (type === "abstract_label") {
    trimmedContent = removeTrailingPunctuation(trimmedContent);
  }

  return {
    type,
    content: trimmedContent,
    page,
    order,
    origin,
  };
}

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
    origin,
    preserveLineBreaks,
  };
}

function normalizeHeadingLikeText(text: string): string {
  return text.replace(/[.:]\s*$/, "").trim();
}

function createBlock(
  type: BlockType,
  content: string,
  page: number,
  order: number,
  origin?: { page: number; bbox: [number, number, number, number] },
  archetype?: "academic" | "literary" | "essay" | "generic",
  deferSentenceSplitting: boolean = false,
): Block {
  let normalizedContent = content;
  if (["document_title", "heading", "abstract_label"].includes(type)) {
    normalizedContent = normalizeHeadingLikeText(content);
  }

  if (["reference_block", "table"].includes(type)) {
    return createNonSemanticBlock(
      type as NonSemanticBlockType,
      content,
      page,
      order,
      origin,
      type === "reference_block",
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

function shouldMergeHeadingContinuation(
  cur: TextLine,
  next: TextLine,
  stats: PDFStats,
): boolean {
  const curText = cur.text.trim();
  const nextText = next.text.trim();

  const hyphenBreak = /-\s*$/.test(curText);

  if (/\bAbstract\b/i.test(nextText)) {
    return false;
  }

  const hasAuthorPattern =
    /^[A-Z][a-z]+.*[,\d]\s*,?\s*[A-Z]?/.test(nextText) &&
    /\d+[,\s]/.test(nextText) &&
    nextText.includes(",");
  if (hasAuthorPattern) {
    return false;
  }

  if (nextText.length > 55) {
    return false;
  }

  if (nextText.includes(",") && nextText.length > 30) {
    return false;
  }

  const bodyTextStarters =
    /^(The|When|In|A|An|This|These|It|As|For|Of|To|With|Among|Despite|Although|Because|Since|After|Before|While|Where|Which|That|However|Therefore|Furthermore|Moreover|Additionally|Consequently|Accordingly)\s+[a-z]/;
  if (bodyTextStarters.test(nextText)) {
    return false;
  }

  if (/\.\s+[A-Z]/.test(nextText)) {
    return false;
  }

  const similarFont =
    Math.abs(next.fontHeight - cur.fontHeight) <= stats.medianBodyFont * 0.25;

  const similarIndent =
    Math.abs(next.xStart - cur.xStart) <= stats.medianBodyFont * 0.8;

  const nextLooksTitle =
    nextText.length <= 55 && !/[.!?]["']?\s*$/.test(nextText);

  const gap = next.y - cur.y;
  const notTooFar = gap > 0 && gap <= stats.medianLineHeight * 6;

  return (
    (hyphenBreak || (similarFont && similarIndent && nextLooksTitle)) &&
    notTooFar
  );
}

function isStandaloneBlock(block: Block): boolean {
  if (block.type !== "paragraph") return false;

  const text = block.content.trim();
  const words = text.split(/\s+/);

  const isShortStandalone =
    text.length <= 70 &&
    words.length <= 6 &&
    /^[A-Z]/.test(text) &&
    !/[.!?]\s*$/.test(text);

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

function looksLikeHyphenatedSlug(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.includes(" ")) return false;
  return /^[A-Za-z]+(-[A-Za-z]+){2,}-?$/.test(trimmed);
}

function isStandaloneParagraphCandidate(line: TextLine, stats: PDFStats): boolean {
  const text = line.text.trim();
  if (!text) return false;

  if (looksLikeHyphenatedSlug(text)) {
    return false;
  }

  if (/[.!?]["']?\s*$/.test(text)) return false;

  const lineWidth = (line.xEnd && line.xStart) ? (line.xEnd - line.xStart) : 0;
  const isRaggedRight = stats.bodyMedianWidth > 0 ? lineWidth < stats.bodyMedianWidth * 0.85 : false;

  const isShort = text.length <= 70;

  const startsWithCapital = /^[A-Z]/.test(text);

  const looksTitleCase = /^[A-Z][a-z]+(\s+[A-Z][a-z]+){1,}$/.test(text);

  const fontJump = line.fontHeight > stats.medianBodyFont * 1.15;

  return (isShort && isRaggedRight) || looksTitleCase || fontJump;
}

// PyMuPDF-based block extraction
async function parsePDFToBlocksWithPyMuPDF(
  buffer: Buffer,
  parsingStrictness: AcademicParsingStrictness = "relaxed",
  parsingProfile: AcademicParsingProfile = "journal",
  deferSentenceSplitting: boolean = false,
): Promise<Block[]> {
  const result = await extractPdfLines(buffer);
  let lines = result.lines;
  
  lines = lines.map((line) => ({
    ...line,
    origin: {
      page: line.page,
      bbox: [line.xStart, line.y, line.xEnd, line.y + line.fontHeight] as [number, number, number, number],
    },
  }));

  // Mark lines that fall inside detected table bounding boxes
  const tableBboxes = result.tableBboxes || [];
  if (tableBboxes.length > 0) {
    for (const line of lines) {
      const lineMidY = line.y + line.fontHeight / 2;
      for (const tb of tableBboxes) {
        if (
          line.page === tb.page &&
          line.xStart >= tb.bbox[0] - 2 &&
          line.xEnd <= tb.bbox[2] + 2 &&
          lineMidY >= tb.bbox[1] - 2 &&
          lineMidY <= tb.bbox[3] + 2
        ) {
          line.isTable = true;
          break;
        }
      }
    }
  }

  const stats = calculateStatsFromLines(lines, result.pageHeights);

  const fsModule = await import("fs");
  const debugLog = (msg: string) => {
    const timestamp = new Date().toISOString();
    fsModule.appendFileSync(
      "/tmp/pdf_archetype_debug.log",
      `[${timestamp}] ${msg}\n`,
    );
    console.log(msg);
  };

  debugLog(
    `[PDF_EXTRACTOR] Extractor: ${result.extractorVersion}, parsingStrictness: ${parsingStrictness}, parsingProfile: ${parsingProfile}`,
  );
  debugLog(
    `[PDF_EXTRACTOR] Pages: ${Object.keys(result.pageHeights).length}, Lines: ${lines.length}`,
  );
  debugLog(`[PDF_EXTRACTOR] Table bboxes: ${tableBboxes.length}`);
  for (const tb of tableBboxes) {
    debugLog(`[PDF_EXTRACTOR] Table bbox: page=${tb.page}, bbox=[${tb.bbox.join(', ')}]`);
  }
  // Dump lines around "produce" and "concretely" for debugging
  for (let dbgI = 0; dbgI < lines.length; dbgI++) {
    const t = lines[dbgI].text.trim().toLowerCase();
    if (t.includes('produce.') || t.includes('concretely') || t.includes('table 1.') || t.includes('systems, including')) {
      debugLog(`[LINE_DUMP] i=${dbgI}, page=${lines[dbgI].page}, y=${lines[dbgI].y.toFixed(1)}, x=${lines[dbgI].xStart.toFixed(1)}-${lines[dbgI].xEnd.toFixed(1)}, isTable=${lines[dbgI].isTable || false}, text="${lines[dbgI].text.trim().substring(0, 80)}"`);
    }
  }

  const rawClassifiedTypes: LineClassification[] = lines.map((line, i) =>
    classifyLineSimplified(
      line,
      stats,
      i > 0 ? lines[i - 1] : undefined,
      parsingStrictness,
      parsingProfile,
    ),
  );

  const classifiedTypes = fixupAuthorClassifications(lines, rawClassifiedTypes, parsingProfile);

  const definiteHeadings: boolean[] = lines.map((line, i) =>
    isDefiniteHeading(line, i > 0 ? lines[i - 1] : undefined),
  );

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
  let inAbstractBody = false;
  let abstractBodyLines: TextLine[] = [];

  let inReferencesSection = false;
  let referenceLines: TextLine[] = [];

  // Buffer for table blocks encountered mid-paragraph
  // Tables are floating elements in academic papers - they should not break paragraph flow
  let pendingTableBlocks: { content: string; page: number; origin?: { page: number; bbox: [number, number, number, number] } }[] = [];
  let pendingTableCaptions: { text: string; page: number; origin?: { page: number; bbox: [number, number, number, number] } }[] = [];

  const flushPendingTables = () => {
    for (const tb of pendingTableBlocks) {
      blocks.push(
        createNonSemanticBlock(
          "table",
          tb.content,
          tb.page,
          blocks.length,
          tb.origin,
          false,
        ),
      );
      debugLog(`[TABLE_BLOCK] Flushed buffered table block on page ${tb.page}`);
    }
    for (const cap of pendingTableCaptions) {
      blocks.push(
        createBlock(
          "paragraph",
          cap.text,
          cap.page,
          blocks.length,
          cap.origin,
          undefined,
          deferSentenceSplitting,
        ),
      );
      debugLog(`[TABLE_CAPTION] Flushed table caption: "${cap.text.substring(0, 60)}..."`);
    }
    pendingTableBlocks = [];
    pendingTableCaptions = [];
  };

  const flushParagraph = () => {
    if (currentParaLines.length > 0) {
      const paraContent = joinLinesWithHyphenPreservation(currentParaLines);

      if (paraContent.length > 20) {
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
      flushPendingTables();
    }
  };

  const flushAbstractBody = () => {
    if (abstractBodyLines.length > 0) {
      const abstractContent =
        joinLinesWithHyphenPreservation(abstractBodyLines);
      if (abstractContent.length > 20) {
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

  const flushReferenceBlock = () => {
    if (referenceLines.length > 0) {
      const rawContent = referenceLines.map((l) => l.text).join("\n");
      if (rawContent.length > 10) {
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

  const findEffectiveNextLine = (
    startIndex: number,
    currentPage?: number,
    currentLineText?: string,
  ): {
    line: TextLine | undefined;
    classification: LineClassification | undefined;
    index: number;
    skippedTable: boolean;
    skippedCaptionIndices: number[];
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

    const tableCaptionPattern = /^(Table|Figure|Fig\.)\s+\d+/i;

    const currentIsIncomplete = currentLineText
      ? !/[.!?]["'\u201D\u2019]?\s*$/.test(currentLineText.trim()) &&
        !/:\s*$/.test(currentLineText.trim())
      : false;

    let lookAhead = startIndex;
    let skippedTable = false;
    const skippedCaptionIndices: number[] = [];
    while (lookAhead < lines.length) {
      const classification = classifiedTypes[lookAhead];
      const candidateLine = lines[lookAhead];

      if (candidateLine.isTable) {
        skippedTable = true;
        lookAhead++;
        continue;
      }

      if (skipTypes.includes(classification)) {
        lookAhead++;
        continue;
      }

      if (skippedTable && tableCaptionPattern.test(candidateLine.text.trim())) {
        debugLog(
          `[TABLE_CAPTION_SKIP] Skipping table caption in findEffectiveNextLine: "${candidateLine.text.trim().substring(0, 60)}..."`,
        );
        skippedCaptionIndices.push(lookAhead);
        lookAhead++;
        continue;
      }

      if (currentIsIncomplete && classification === "heading") {
        debugLog(
          `[SKIP_HEADING_AFTER_INCOMPLETE] Skipping "${candidateLine.text.trim().substring(0, 40)}..." (current line incomplete, cannot be heading)`,
        );
        lookAhead++;
        continue;
      }

      return { line: candidateLine, classification, index: lookAhead, skippedTable, skippedCaptionIndices };
    }
    return { line: undefined, classification: undefined, index: -1, skippedTable, skippedCaptionIndices };
  };

  const processedIndices = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    if (processedIndices.has(i)) {
      continue;
    }

    const line = lines[i];
    let type = definiteHeadings[i] ? "heading" : classifiedTypes[i];

    if (
      line.text.toLowerCase().includes("ai vs") ||
      line.text.toLowerCase().includes("human translator")
    ) {
      debugLog(
        `[LINE_CLASSIFY] Line ${i}: type="${type}", text="${line.text.substring(0, 80)}..."`,
      );
    }

    const effective = findEffectiveNextLine(i + 1, line.page, line.text);
    const nextLine = effective.line;
    const nextClassification = effective.classification;

    if (type === "header" || type === "footer") {
      if (inReferencesSection && isExplicitSectionHeading(line.text)) {
        flushReferenceBlock();
        inReferencesSection = false;
        type = "heading";
      } else {
        continue;
      }
    }

    // Table lines: buffer as pending table blocks without breaking paragraph flow
    // Academic papers have floating tables - text paragraphs continue across them
    if (line.isTable) {
      const tableLines: TextLine[] = [line];
      let j = i + 1;
      while (j < lines.length && lines[j].isTable) {
        tableLines.push(lines[j]);
        processedIndices.add(j);
        j++;
      }
      const tableContent = tableLines.map((l) => l.text).join("\n");
      pendingTableBlocks.push({
        content: tableContent,
        page: line.page,
        origin: line.origin,
      });
      debugLog(`[TABLE_BLOCK] Buffered table block on page ${line.page} with ${tableLines.length} lines (paragraph continues)`);
      continue;
    }

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

    if (inAbstractBody) {
      const shouldTerminateAbstract =
        type === "heading" ||
        type === "document_title" ||
        /^keywords?\s*[:.]?\s*/i.test(line.text.trim()) ||
        /^1\.?\s*(introduction|overview)/i.test(line.text.trim()) ||
        /^introduction$/i.test(line.text.trim());

      if (shouldTerminateAbstract) {
        flushAbstractBody();
      }
    }

    if (type === "document_title") {
      flushParagraph();
      flushAbstractBody();

      let titleText = line.text.trim();
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

        if (nextCandType === "heading") break;

        const isTitleContinuation =
          nextCandType === "document_title" ||
          (nextCandType === "paragraph" &&
            shouldMergeHeadingContinuation(lines[j], nextCand, stats));

        if (!isTitleContinuation) break;

        titleText = mergeLineTexts(titleText, nextCand.text.trim(), true);
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
      i = j;
      continue;
    }

    if (!inReferencesSection && type === "heading") {
      const headingText = line.text.trim();
      if (isReferencesHeading(headingText)) {
        console.log(
          `[PDF_EXTRACTOR] References section detected (FIRST-PRIORITY): "${headingText}"`,
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

      if (
        (nextIsHeading && !nextIsReferenceHeading && hasHeadingGap) ||
        (pageBreakToHeading && !nextIsReferenceHeading)
      ) {
        referenceLines.push(line);
        flushReferenceBlock();
        inReferencesSection = false;
        continue;
      }

      if (isExplicitSectionHeading(headingText)) {
        flushReferenceBlock();
        inReferencesSection = false;
      } else if (type === "heading" && !isReferencesHeading(headingText)) {
        flushReferenceBlock();
        inReferencesSection = false;
      } else {
        referenceLines.push(line);
        if (line.page !== nextLine?.page && referenceLines.length > 0) {
          flushReferenceBlock();
        }
        continue;
      }
    }

    if (type === "heading") {
      const isDefinite = definiteHeadings[i];

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
          continue;
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
      flushReferenceBlock();

      let headingText = line.text.trim();

      // Merge with previous block if it's a standalone section number heading
      // e.g., previous block "4" or "4.1" + current line "Provocations from..."
      if (blocks.length > 0) {
        const prevBlock = blocks[blocks.length - 1];
        if (
          prevBlock.type === "heading" &&
          /^\d+(\.\d+)*$/.test(prevBlock.content.trim())
        ) {
          headingText = prevBlock.content.trim() + " " + headingText;
          blocks.pop();
        }
      }

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
            "document_title",
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

    const curTextDbg = line.text.trim().toLowerCase();
    const nextTextDbg = nextLine?.text.trim().toLowerCase() || "";
    if (
      curTextDbg.includes("produce") ||
      curTextDbg.includes("concretely") ||
      curTextDbg.includes("systems, including") ||
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

    if (isStandaloneParagraphCandidate(line, stats)) {
      if (currentParaLines.length > 0) {
        flushParagraph();
      }

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
        (blocks[blocks.length - 1] as any).isStandalone = true;
      }

      lastPage = line.page;
      continue;
    }

    // When table lines were skipped between current and next line,
    // synthesize a virtual nextLine with adjusted position to prevent
    // false paragraph breaks due to large Y-gap or page boundary
    let effectiveNextLine = nextLine;
    if (nextLine && effective.skippedTable) {
      effectiveNextLine = {
        ...nextLine,
        page: line.page,
        y: line.y + stats.medianLineHeight,
      };
      debugLog(`[TABLE_SKIP_BRIDGE] Bridging paragraph across table: "${line.text.trim().substring(0, 40)}..." → "${nextLine.text.trim().substring(0, 40)}..."`);

      for (const capIdx of effective.skippedCaptionIndices) {
        const capLine = lines[capIdx];
        processedIndices.add(capIdx);
        pendingTableCaptions.push({
          text: capLine.text.trim(),
          page: capLine.page,
          origin: capLine.origin,
        });
        debugLog(`[TABLE_CAPTION_BUFFER] Buffered caption at index ${capIdx}: "${capLine.text.trim().substring(0, 60)}..."`);
      }
    }

    const shouldSplit = shouldEndParagraphSimplified(
      line,
      effectiveNextLine,
      type,
      nextClassification || "paragraph",
      stats,
      parsingProfile,
      parsingStrictness,
    );

    if (
      curTextDbg.includes("produce") ||
      curTextDbg.includes("concretely") ||
      curTextDbg.includes("systems, including") ||
      curTextDbg.includes("nuance") ||
      curTextDbg.includes("style and") ||
      nextTextDbg.includes("are preserved")
    ) {
      debugLog(
        `[MAIN_LOOP_DEBUG] shouldSplit=${shouldSplit}, skippedTable=${effective.skippedTable}, inReferencesSection=${inReferencesSection}, inAbstractBody=${inAbstractBody}, yGap=${nextLine ? (nextLine.y - line.y).toFixed(1) : 'N/A'}, pageDiff=${nextLine ? nextLine.page - line.page : 'N/A'}`,
      );
    }

    if (inAbstractBody) {
      if (
        line.text.toLowerCase().includes("ai vs") ||
        line.text.toLowerCase().includes("human translator")
      ) {
        debugLog(
          `[ABSTRACT_BODY_PATH] Line absorbed: "${line.text.substring(0, 60)}..."`,
        );
      }
      if (shouldSplit && abstractBodyLines.length > 0) {
        abstractBodyLines.push(line);
        flushAbstractBody();
      } else {
        abstractBodyLines.push(line);
      }
    } else {
      if (
        line.text.toLowerCase().includes("ai vs") ||
        line.text.toLowerCase().includes("human translator")
      ) {
        debugLog(
          `[PARAGRAPH_PATH] Line added: shouldSplit=${shouldSplit}, currentParaLines.length=${currentParaLines.length}, text="${line.text.substring(0, 60)}..."`,
        );
      }
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
        } else {
          referenceLines.push(line);
          if (line.page !== nextLine?.page && referenceLines.length > 0) {
            flushReferenceBlock();
          }
          continue;
        }
      }

      currentParaLines.push(line);

      if (shouldSplit && currentParaLines.length > 0) {
        flushParagraph();
      } else if (!shouldSplit) {
        if (lineIsIncomplete && nextLine && nextLine.page !== line.page && !effective.skippedTable) {
          let pullIdx = effective.index;
          while (pullIdx < lines.length && pullIdx >= 0) {
            const pullLine = lines[pullIdx];
            const pullType = classifiedTypes[pullIdx];

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

            debugLog(
              `[PAGE_BOUNDARY_PULL] Pulling "${pullLine.text.trim().substring(0, 50)}..." into paragraph`,
            );
            currentParaLines.push(pullLine);

            processedIndices.add(pullIdx);

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

  flushAbstractBody();
  flushReferenceBlock();
  flushParagraph();
  flushPendingTables();

  const documentTitles = blocks.filter((b) => b.type === "document_title");
  const headings = blocks.filter((b) => b.type === "heading");
  const paragraphs = blocks.filter((b) => b.type === "paragraph");
  const metadataBlocks = blocks.filter((b) => isMetadataBlock(b));
  const abstractBodies = blocks.filter((b) => b.type === "abstract_body");
  const referenceBlocks = blocks.filter((b) => b.type === "reference_block");

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

  if (inReferencesSection) {
    console.log(
      `[PDF_EXTRACTOR] Phase 2-3a: References section found, ${referenceBlocks.length} reference blocks created`,
    );
  }

  if (documentTitles.length > 0) {
    console.log(
      `[PDF_EXTRACTOR] Document title: "${documentTitles[0].content.substring(0, 60)}${documentTitles[0].content.length > 60 ? "..." : ""}"`,
    );
  }

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
    pdftotext.stdout.on("data", (data: Buffer) => (output += data.toString("utf8")));
    pdftotext.on("close", (code: number) => {
      if (code !== 0) return reject(new Error("pdftotext failed"));
      resolve(parseBBoxOutput(output));
    });
    pdftotext.on("error", (err: Error) => reject(err));
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

    const heights = elements.map((e) => e.height);
    heights.sort((a, b) => a - b);
    const medianHeight = heights[Math.floor(heights.length / 2)] || 12;
    const medianLineHeight = medianHeight * 1.2;

    let lines = groupWordsIntoLinesLegacy(elements, medianLineHeight);
    
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

    const flushParagraph = () => {
      if (currentParaLines.length > 0) {
        const paraContent = joinLinesWithHyphenPreservation(currentParaLines);
        if (paraContent.length > 20) {
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

    const flushAbstractBody = () => {
      if (abstractBodyLines.length > 0) {
        const abstractContent =
          joinLinesWithHyphenPreservation(abstractBodyLines);
        if (abstractContent.length > 20) {
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

    const flushReferenceBlock = () => {
      if (referenceLines.length > 0) {
        const rawContent = referenceLines.map((l) => l.text).join("\n");
        if (rawContent.length > 10) {
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

        if (
          (nextIsHeading && !nextIsReferenceHeading && hasHeadingGap) ||
          (pageBreakToHeading && !nextIsReferenceHeading)
        ) {
          referenceLines.push(line);
          flushReferenceBlock();
          inReferencesSection = false;
          continue;
        }

        if (isExplicitSectionHeading(headingText)) {
          flushReferenceBlock();
          inReferencesSection = false;
        } else if (type === "heading" && !isReferencesHeading(headingText)) {
          flushReferenceBlock();
          inReferencesSection = false;
        } else {
          referenceLines.push(line);
          if (line.page !== nextLine?.page && referenceLines.length > 0) {
            flushReferenceBlock();
          }
          continue;
        }
      }

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

      if (isStandaloneParagraphCandidate(line, stats)) {
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
          (blocks[blocks.length - 1] as any).isStandalone = true;
        }

        lastPage = line.page;
        continue;
      }

      const shouldSplit = shouldEndParagraphSimplified(
        line,
        nextLine,
        type,
        nextClassification || "paragraph",
        stats,
        "journal",
        "relaxed",
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

    const headings = blocks.filter((b) => b.type === "heading");
    const paragraphs = blocks.filter((b) => b.type === "paragraph");
    const metadataBlocks = blocks.filter((b) => isMetadataBlock(b));
    const abstractBodies = blocks.filter((b) => b.type === "abstract_body");

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

function reprocessBlocksWithArchetype(
  blocks: Block[],
  archetype: DocumentArchetype,
): Block[] {
  console.log(
    `[PDF_ARCHETYPE] Reprocessing ${blocks.length} blocks with archetype: ${archetype}`,
  );

  return blocks.map((block, index) => {
    if (block.type === "paragraph" || block.type === "abstract_body") {
      const translatableBlock = block as TranslatableBlock;
      if (translatableBlock.content) {
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

export async function parsePDFWithArchetype(
  buffer: Buffer,
  sourceHint?: string,
): Promise<PDFParseResult> {
  const fsModule = await import("fs");
  const logFile = "/tmp/pdf_archetype_debug.log";
  const log = (msg: string) => {
    const timestamp = new Date().toISOString();
    const logLine = `[${timestamp}] [PDF_ARCHETYPE] ${msg}\n`;
    fsModule.appendFileSync(logFile, logLine);
    console.log(`[PDF_ARCHETYPE] ${msg}`);
  };

  log(`=== Starting parsePDFWithArchetype ===`);
  log(`sourceHint: ${sourceHint || "none"}`);

  log(`Step 1: First pass with neutral parsing (relaxed mode for safety)`);
  let blocks = await parsePDFToBlocks(buffer, "relaxed", "journal", true);
  log(`Step 1 complete: ${blocks.length} blocks extracted`);

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

  let academicParsingResult: AcademicParsingDecision | undefined;
  let needsReparse = false;
  let targetStrictness: AcademicParsingStrictness = "relaxed";
  let targetProfile: AcademicParsingProfile = "journal";

  if (detectedArchetype.archetype === "academic") {
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

    if (targetStrictness === "strict" || targetProfile === "essay_academic" || targetProfile === "arxiv") {
      needsReparse = true;
      log(
        `Step 3: Re-parse needed for strictness=${targetStrictness}, profile=${targetProfile}`,
      );
    }
  }

  if (needsReparse) {
    log(
      `Step 4: Re-parsing with strictness=${targetStrictness}, profile=${targetProfile}...`,
    );
    const blocksBeforeReparse = blocks.length;
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

  log(
    `Step 4.5a: Applying block-level structural post-processing`,
  );
  const blocksAfterStructural = postProcessBlocksStructural(blocks, log);

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
      text += `${block.content}\n\n`;
    } else if (isMetadataBlock(block)) {
      text += `[${block.type.toUpperCase()}] ${block.content}\n\n`;
    } else {
      text += `${block.content}\n\n`;
    }
  }
  return text.trim();
}
