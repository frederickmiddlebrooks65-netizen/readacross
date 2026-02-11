/**
 * Split text into paragraphs
 * @param text The input text
 * @returns Array of paragraphs
 */
export function splitIntoParagraphs(text: string): string[] {
  // Split by double newlines to separate paragraphs
  return text
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.length > 0);
}

/**
 * Extract title from a paragraph if it looks like a heading
 * @param paragraph The paragraph text
 * @returns Object with title and content
 */
export function extractTitleFromParagraph(paragraph: string): { title: string | null; content: string } {
  // Check if the paragraph starts with a title-like pattern
  // Matches # Heading, ## Heading, or lines that end with a colon and are short
  const titleMatch = paragraph.match(/^(#+\s+)(.+?)(\n|$)/) || 
                    paragraph.match(/^(.{1,60}):(\n|$)/);
  
  if (titleMatch) {
    const title = titleMatch[2].trim();
    const remainingContent = paragraph.substring(titleMatch[0].length).trim();
    return {
      title,
      content: remainingContent || paragraph, // If no content left, use whole paragraph
    };
  }

  return {
    title: null,
    content: paragraph,
  };
}

/**
 * Split paragraph into sentences
 * @param paragraph The paragraph to split
 * @returns Array of sentences
 */
export function splitIntoSentences(paragraph: string): string[] {
  // More sophisticated sentence splitting considering abbreviations, quotes, etc.
  // This is a simplified version
  const sentenceRegex = /[.!?]+["'\)\]]*\s+/g;
  
  // Split by sentence-ending punctuation followed by space
  const sentences = paragraph.split(sentenceRegex);
  
  // Filter out empty sentences and ensure we don't have trailing empty items
  return sentences
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/**
 * Process a document text into structured paragraphs and sentences
 * @param text Full document text
 * @returns Structured document with paragraphs and sentences
 */
export function processDocumentText(text: string): {
  paragraphs: Array<{
    title: string | null;
    sentences: string[];
  }>;
} {
  const paragraphs = splitIntoParagraphs(text);
  
  const processedParagraphs = paragraphs.map(paragraph => {
    const { title, content } = extractTitleFromParagraph(paragraph);
    const sentences = splitIntoSentences(content);
    
    return {
      title,
      sentences,
    };
  });
  
  return {
    paragraphs: processedParagraphs,
  };
}
