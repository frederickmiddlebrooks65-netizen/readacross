import { storage } from './storage.js';
import { parsePDF } from './pdfUtils.js';
import { generateStructuredBlocks } from './utils/structuredUtils.js';

/**
 * Normalize arXiv URL to HTML version for better structure preservation
 * This ensures we get the richest possible content structure from arXiv
 */
export function normalizeArxivUrl(input: string): string {
  if (!input || typeof input !== 'string') {
    return input;
  }

  try {
    // Handle different arXiv URL formats
    if (input.includes("arxiv.org/abs/")) {
      // abs/xxxx.xxxxx -> html/xxxx.xxxxx
      return input.replace("/abs/", "/html/");
    }
    
    if (input.includes("arxiv.org/pdf/")) {
      // pdf/xxxx.xxxxx.pdf -> html/xxxx.xxxxx
      return input.replace("/pdf/", "/html/").replace(/\.pdf($|\?)/, "$1");
    }
    
    // If it's already an HTML URL or different format, return as-is
    return input;
  } catch (error) {
    console.warn(`[normalizeArxivUrl] Error normalizing URL ${input}:`, error);
    return input;
  }
}

/**
 * Check if a URL/domain is from arXiv
 */
export function isArxivUrl(url: string): boolean {
  if (!url || typeof url !== 'string') {
    return false;
  }
  
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return hostname === 'arxiv.org' || hostname.endsWith('.arxiv.org');
  } catch {
    // If URL parsing fails, check for arxiv.org in the string
    return url.toLowerCase().includes('arxiv.org');
  }
}

interface ArxivPaper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  updated: string;
  categories: string[];
  pdfUrl: string;
  arxivUrl: string;
}

interface ArxivSearchResponse {
  feed: {
    entry?: ArxivEntry[];
  };
}

interface ArxivEntry {
  id: [string];
  title: [string];
  summary: [string];
  published: [string];
  updated: [string];
  author: Array<{ name: [string] }>;
  category: Array<{ $: { term: string } }>;
  link: Array<{ $: { title?: string; href: string; type?: string } }>;
}

// Curated list of computational linguistics papers for POC
const SAMPLE_PAPERS: ArxivPaper[] = [
  {
    id: "2301.13688",
    title: "A Multitask, Multilingual, Multimodal Evaluation of ChatGPT on Reasoning, Hallucination, and Interactivity",
    authors: ["Yejin Bang", "Samuel Cahyawijaya", "Nayeon Lee"],
    abstract: "This paper presents a comprehensive evaluation of ChatGPT across multiple dimensions including reasoning, hallucination, and interactivity.",
    published: "2023-01-31",
    updated: "2023-01-31",
    categories: ["cs.CL", "cs.AI"],
    pdfUrl: "https://arxiv.org/pdf/2301.13688.pdf",
    arxivUrl: "https://arxiv.org/abs/2301.13688"
  },
  {
    id: "2303.08774",
    title: "GPT-4 Technical Report",
    authors: ["OpenAI"],
    abstract: "We report the development of GPT-4, a large-scale, multimodal model which can accept image and text inputs and produce text outputs.",
    published: "2023-03-15",
    updated: "2023-03-27",
    categories: ["cs.CL", "cs.AI"],
    pdfUrl: "https://arxiv.org/pdf/2303.08774.pdf",
    arxivUrl: "https://arxiv.org/abs/2303.08774"
  },
  {
    id: "2005.14165",
    title: "Language Models are Few-Shot Learners",
    authors: ["Tom B. Brown", "Benjamin Mann", "Nick Ryder"],
    abstract: "Recent work has demonstrated substantial gains on many NLP tasks and benchmarks by pre-training on a large corpus of text followed by fine-tuning on a specific task.",
    published: "2020-05-28",
    updated: "2020-07-22",
    categories: ["cs.CL"],
    pdfUrl: "https://arxiv.org/pdf/2005.14165.pdf",
    arxivUrl: "https://arxiv.org/abs/2005.14165"
  },
  {
    id: "1706.03762",
    title: "Attention Is All You Need",
    authors: ["Ashish Vaswani", "Noam Shazeer", "Niki Parmar"],
    abstract: "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks that include an encoder and a decoder.",
    published: "2017-06-12",
    updated: "2017-12-06",
    categories: ["cs.CL", "cs.LG"],
    pdfUrl: "https://arxiv.org/pdf/1706.03762.pdf",
    arxivUrl: "https://arxiv.org/abs/1706.03762"
  },
  {
    id: "2310.06825",
    title: "Language Modeling Is Compression",
    authors: ["Grégoire Delétang", "Anian Ruoss", "Paul-Ambroise Duquenne"],
    abstract: "It has long been established that predictive models can be transformed into lossless compressors and vice versa.",
    published: "2023-10-10",
    updated: "2023-10-10",
    categories: ["cs.CL", "cs.IT"],
    pdfUrl: "https://arxiv.org/pdf/2310.06825.pdf",
    arxivUrl: "https://arxiv.org/abs/2310.06825"
  }
];

/**
 * Fetch PDF content from arXiv
 */
async function fetchPaperPDF(pdfUrl: string): Promise<Buffer> {
  console.log(`Fetching PDF from: ${pdfUrl}`);
  
  try {
    const response = await fetch(pdfUrl, {
      headers: {
        'User-Agent': 'ReadAcross/1.0 (Educational Language Learning Platform)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`Failed to fetch PDF: ${error}`);
    throw error;
  }
}

/**
 * Extract academic paper sections (Abstract, Introduction, Conclusion)
 */
function extractAcademicSections(text: string): { abstract: string; introduction: string; conclusion: string; fullText: string } {
  const cleanText = text
    .replace(/\s+/g, ' ')
    .replace(/\n+/g, '\n')
    .trim();

  console.log(`Processing text of length: ${cleanText.length}`);

  // Extract Abstract section - more flexible patterns
  let abstract = '';
  const abstractPatterns = [
    /(?:^|\n)\s*(?:Abstract|ABSTRACT)\s*[\n\r:]*([^]*?)(?=\n\s*(?:1[\s\.]*Introduction|Introduction|Keywords|1\.|I\.|Contents|\d+[\s\.]*[A-Z][a-z]|\n\s*\n))/i,
    /(?:^|\n)\s*(?:Abstract|ABSTRACT)\s*[\n\r:]*([^]*?)(?=\n\s*(?:Introduction|Keywords|1\s|I\s))/i,
    /(?:Abstract|ABSTRACT)\s*:?\s*([^]*?)(?=(?:Introduction|Keywords|1\s))/i
  ];
  
  for (const pattern of abstractPatterns) {
    const match = cleanText.match(pattern);
    if (match && match[1] && match[1].trim().length > 50) {
      abstract = match[1].trim();
      break;
    }
  }

  // Extract Introduction section - more flexible
  let introduction = '';
  const introPatterns = [
    /(?:^|\n)\s*(?:1[\s\.]*Introduction|Introduction|1\.|I\.)\s*[\n\r]*([^]*?)(?=\n\s*(?:2[\s\.]*|II\.|Related Work|Background|Methodology|Method|\d+[\s\.]*[A-Z][a-z]))/i,
    /(?:Introduction|1[\s\.]*Introduction)\s*[\n\r]*([^]*?)(?=(?:Related Work|Background|Method|2[\s\.]*))/i
  ];
  
  for (const pattern of introPatterns) {
    const match = cleanText.match(pattern);
    if (match && match[1] && match[1].trim().length > 100) {
      introduction = match[1].trim();
      break;
    }
  }

  // Extract Conclusion section - more flexible
  let conclusion = '';
  const conclusionPatterns = [
    /(?:^|\n)\s*(?:\d+[\s\.]*)?(?:Conclusion|Conclusions|Discussion|Summary|CONCLUSION|CONCLUSIONS)\s*[\n\r]*([^]*?)(?=\n\s*(?:References|Bibliography|Acknowledgments|Appendix|\d+[\s\.]*[A-Z])|$)/i,
    /(?:Conclusion|Conclusions|Discussion|Summary)\s*[\n\r]*([^]*?)(?=(?:References|Bibliography|Acknowledgments|Appendix)|$)/i
  ];
  
  for (const pattern of conclusionPatterns) {
    const match = cleanText.match(pattern);
    if (match && match[1] && match[1].trim().length > 50) {
      conclusion = match[1].trim();
      break;
    }
  }

  // If no sections found, try to extract from beginning and end
  if (!abstract && !introduction && !conclusion) {
    console.log('No sections found with patterns, trying fallback extraction...');
    
    // Try to find abstract at the beginning using word boundaries
    const words = cleanText.split(/\s+/);
    let abstractStart = -1;
    let abstractEnd = -1;
    
    // Look for "Abstract" keyword
    for (let i = 0; i < Math.min(200, words.length); i++) {
      if (words[i].toLowerCase() === 'abstract') {
        abstractStart = i + 1;
        break;
      }
    }
    
    if (abstractStart > -1) {
      // Find the end of abstract (look for Introduction, Keywords, or section numbers)
      for (let i = abstractStart; i < Math.min(abstractStart + 150, words.length); i++) {
        const word = words[i].toLowerCase();
        if (word === 'introduction' || word === 'keywords' || 
            word === '1.' || word === 'i.' || 
            (words[i].match(/^\d+$/) && i < words.length - 1 && words[i+1].toLowerCase() === 'introduction')) {
          abstractEnd = i;
          break;
        }
      }
      
      if (abstractEnd > abstractStart) {
        abstract = words.slice(abstractStart, abstractEnd).join(' ').trim();
      } else {
        // Take reasonable chunk if no clear end found
        abstract = words.slice(abstractStart, abstractStart + 100).join(' ').trim();
      }
    }
    
    // If still no abstract, take first paragraph-like content
    if (!abstract || abstract.length < 50) {
      const sentences = cleanText.split(/[.!?]+/).filter(s => s.trim().length > 20);
      if (sentences.length > 0) {
        abstract = sentences.slice(0, 3).join('. ').trim() + '.';
      }
    }
  }

  console.log(`Extracted sections - Abstract: ${abstract.length} chars, Introduction: ${introduction.length} chars, Conclusion: ${conclusion.length} chars`);

  return {
    abstract: abstract.substring(0, 1000), // Limit length
    introduction: introduction.substring(0, 2000),
    conclusion: conclusion.substring(0, 1500),
    fullText: cleanText
  };
}

/**
 * Split text into sentences for language learning - improved for full papers
 */
function splitIntoSentences(text: string): string[] {
  if (!text) return [];
  
  // More thorough text cleaning for academic papers
  const cleanText = text
    .replace(/\s+/g, ' ') // Normalize whitespace
    .replace(/([.!?])\s*\n+/g, '$1 ') // Join sentences across line breaks
    .replace(/\n/g, ' ') // Replace remaining newlines with spaces
    .replace(/\s{2,}/g, ' ') // Collapse multiple spaces
    .replace(/\b(et al\.|i\.e\.|e\.g\.|vs\.|cf\.|etc\.)/gi, (match) => match.replace('.', '●')) // Protect abbreviations
    .trim();

  // Enhanced sentence splitting for full academic papers
  const sentences = cleanText
    .split(/(?<=[.!?])\s+(?=[A-Z])/) // Split on sentence boundaries
    .map(s => s.replace(/●/g, '.').trim()) // Restore protected abbreviations
    .filter(s => s.length > 15 && s.length < 800) // Allow longer sentences for academic content
    .filter(s => !s.match(/^(Figure|Table|Equation|Algorithm|Fig\.|Tab\.|Ref\.|References|Bibliography|Acknowledgments)/i)) // Filter captions and references
    .filter(s => !/^[\d\.\)\]]+\s/.test(s)) // Filter numbered lists and references
    .filter(s => !s.match(/^[A-Z\s\d\.\-]{15,}$/)) // Filter ALL CAPS headings
    .filter(s => !(s.split(' ').length < 3)) // Filter very short fragments
    .filter(s => !s.match(/^\s*[\[\(].*[\]\)]\s*$/)) // Filter standalone references like [1], (2020)
    .filter(s => !s.match(/^(Abstract|Introduction|Conclusion|Discussion|Method|Results|Related Work)$/i)) // Filter standalone section headers
    .slice(0, 400); // Allow more sentences for full paper content

  console.log(`Extracted ${sentences.length} sentences for language learning`);
  return sentences;
}

/**
 * Create paragraphs from sentences with section information
 */
function createParagraphsFromSections(sections: { abstract: string; introduction: string; conclusion: string }): any[] {
  const paragraphs = [];
  let order = 0;

  // Abstract section
  if (sections.abstract && sections.abstract.length > 50) {
    const abstractSentences = splitIntoSentences(sections.abstract);
    if (abstractSentences.length > 0) {
      paragraphs.push({
        title: "Abstract",
        order: order++,
        sentences: abstractSentences.map((sentence, idx) => ({
          source: sentence,
          target: undefined,
          order: idx
        }))
      });
    }
  }

  // Introduction section - keep as single paragraph for better reading flow
  if (sections.introduction && sections.introduction.length > 100) {
    const introSentences = splitIntoSentences(sections.introduction);
    if (introSentences.length > 0) {
      // Keep introduction as one section but limit to reasonable length
      const maxSentences = 15;
      const limitedSentences = introSentences.slice(0, maxSentences);
      paragraphs.push({
        title: "Introduction",
        order: order++,
        sentences: limitedSentences.map((sentence, idx) => ({
          source: sentence,
          target: undefined,
          order: idx
        }))
      });
    }
  }

  // Conclusion section
  if (sections.conclusion && sections.conclusion.length > 50) {
    const conclusionSentences = splitIntoSentences(sections.conclusion);
    if (conclusionSentences.length > 0) {
      // Limit conclusion to reasonable length
      const maxSentences = 12;
      const limitedSentences = conclusionSentences.slice(0, maxSentences);
      paragraphs.push({
        title: "Conclusion",
        order: order++,
        sentences: limitedSentences.map((sentence, idx) => ({
          source: sentence,
          target: undefined,
          order: idx
        }))
      });
    }
  }

  return paragraphs;
}

/**
 * Get difficulty level based on paper characteristics
 */
function determineDifficulty(paper: ArxivPaper): string {
  const title = paper.title.toLowerCase();
  const abstract = paper.abstract.toLowerCase();

  // Advanced topics
  if (title.includes('deep learning') || title.includes('neural network') || 
      title.includes('transformer') || abstract.includes('state-of-the-art')) {
    return 'advanced';
  }

  // Survey or review papers tend to be more accessible
  if (title.includes('survey') || title.includes('review') || 
      title.includes('overview') || abstract.includes('comprehensive')) {
    return 'intermediate';
  }

  // Default to intermediate for academic papers
  return 'intermediate';
}

/**
 * Main seeding function for arXiv papers
 */
export async function seedArxivPapers(): Promise<void> {
  console.log("Starting arXiv papers seeding (POC - Limited to 5 papers)...");

  for (const paper of SAMPLE_PAPERS) {
    try {
      console.log(`Processing: ${paper.title}`);

      // Check if paper already exists
      const existingDocs = await storage.getAllDocuments();
      const exists = existingDocs.some(doc => 
        doc.originalUrl === paper.arxivUrl && doc.isPublic
      );

      if (exists) {
        console.log(`Paper already exists: ${paper.title}`);
        continue;
      }

      // 🔧 NEW: Try HTML first, fallback to PDF
      console.log('🎯 Attempting HTML extraction first for better structure...');
      
      // Normalize to HTML URL for arXiv
      const htmlUrl = normalizeArxivUrl(paper.arxivUrl);
      console.log(`Original: ${paper.arxivUrl} → HTML: ${htmlUrl}`);
      
      let fullText = '';
      let contentSourceType = 'html';
      
      try {
        // Try HTML extraction first
        const htmlResponse = await fetch(htmlUrl, {
          headers: {
            'User-Agent': 'ReadAcross/1.0 (Educational Language Learning Platform)'
          }
        });
        
        if (htmlResponse.ok) {
          const htmlContent = await htmlResponse.text();
          if (htmlContent && htmlContent.length > 1000) {
            fullText = htmlContent;
            contentSourceType = 'html';
            console.log(`✅ HTML extraction successful: ${fullText.length} chars`);
          } else {
            throw new Error('HTML content too short');
          }
        } else {
          throw new Error(`HTTP ${htmlResponse.status}`);
        }
      } catch (htmlError) {
        console.log(`⚠️ HTML extraction failed: ${htmlError}, falling back to PDF...`);
        
        // Fallback to PDF extraction
        const pdfBuffer = await fetchPaperPDF(paper.pdfUrl);
        fullText = await parsePDF(pdfBuffer);
        contentSourceType = 'pdf';
        console.log(`📄 PDF fallback successful: ${fullText.length} chars`);
      }
      
      if (!fullText || fullText.length < 100) {
        console.log(`Skipping paper due to insufficient text: ${paper.title}`);
        continue;
      }

      console.log('🔧 Processing with enhanced structured pipeline...');
      
      // 🔧 NEW: Use unified structured content processing
      const structuredBlocks = await generateStructuredBlocks(
        fullText,
        contentSourceType === 'html' ? 'auto' : 'text', // Use AUTO mode for HTML, TEXT for PDF
        `arXiv (${contentSourceType})`,
        {
          minBlockLength: 80, // Larger blocks for academic content
          whitelistTags: [
            'p', 'br', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div',
            'figure', 'figcaption', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
            'img', 'svg', 'caption', 'section', 'article', 'main',
            'math', 'annotation', 'semantics', 'mrow', 'mi', 'mo', 'mn',
            'aside', 'nav', 'header', 'footer', 'details', 'summary'
          ]
        },
        htmlUrl // Pass the original URL for domain detection
      );
      
      console.log(`✅ Generated ${structuredBlocks.length} structured blocks`);
      
      if (structuredBlocks.length === 0) {
        console.log(`Skipping paper due to no structured blocks: ${paper.title}`);
        continue;
      }
      
      // Create paragraphs from structured blocks for sentence-level processing
      const paragraphs = [];
      let paragraphOrder = 0;
      
      for (const block of structuredBlocks) {
        if (!block.content || block.content.length < 50) continue;
        
        // Split block content into sentences for language learning
        const sentences = splitIntoSentences(block.content);
        if (sentences.length === 0) continue;
        
        // Create paragraph title based on block type and content
        let sectionTitle = '';
        if (block.type === 'heading') {
          sectionTitle = block.content;
        } else {
          const firstWords = block.content.split(' ').slice(0, 4).join(' ');
          sectionTitle = `${block.type.charAt(0).toUpperCase() + block.type.slice(1)} ${paragraphOrder + 1}: ${firstWords}...`;
        }
        
        paragraphs.push({
          title: sectionTitle,
          order: paragraphOrder++,
          sentences: sentences.slice(0, 15).map((sentence, idx) => ({ // Limit sentences per paragraph
            source: sentence,
            target: undefined,
            order: idx
          }))
        });
        
        // Limit total paragraphs for better learning experience
        if (paragraphOrder >= 25) break;
      }

      // Determine category and difficulty
      const category = "Academic";
      const difficulty = determineDifficulty(paper);
      const authors = paper.authors.join(', ');
      
      // Create the document with paragraphs and sentences
      // Archetype: "academic" with confidence 1.0 because source is arXiv (per instructions.md)
      const document = await storage.createDocumentWithParagraphs({
        title: paper.title,
        sourceLanguage: "en",
        userId: undefined, // Public document
        fileType: "pdf",
        author: authors,
        source: "arXiv",
        category: category,
        difficulty: difficulty,
        tags: `arxiv,${paper.categories.join(',')},${difficulty},academic`,
        originalUrl: paper.arxivUrl,
        licenseType: "arXiv License",
        isPublic: true,
        structuredContent: structuredBlocks.length > 0 ? JSON.stringify(structuredBlocks) : undefined,
        structuredVersion: 2, // 🔧 NEW: Enhanced pipeline version
        contentSourceType, // 'html' or 'pdf' based on successful extraction
        paragraphs,
        // Source-based archetype per instructions.md section 2.3
        archetype: "academic",
        archetypeConfidence: 1.0,
        archetypeSource: "source"
      });

      console.log(`Successfully added: ${paper.title} (${paragraphs.length} sections, ${paragraphs.reduce((total, p) => total + p.sentences.length, 0)} sentences)`);

      // Add delay to be respectful to arXiv servers
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error(`Failed to process ${paper.title}:`, error);
      // Continue with other papers even if one fails
    }
  }

  console.log("arXiv papers seeding completed!");
}

/**
 * Search arXiv API for papers (for future expansion)
 */
export async function searchArxivPapers(query: string, maxResults: number = 10): Promise<ArxivPaper[]> {
  const encodedQuery = encodeURIComponent(query);
  const url = `http://export.arxiv.org/api/query?search_query=${encodedQuery}&start=0&max_results=${maxResults}`;

  try {
    const response = await fetch(url);
    const xml = await response.text();
    console.log('arXiv API response received, length:', xml.length);
    return [];
  } catch (error) {
    console.error('Failed to search arXiv:', error);
    return [];
  }
}

interface RssPaper {
  id: string;
  title: string;
  authors: string[];
  abstract: string;
  published: string;
  categories: string[];
  pdfUrl: string;
  arxivUrl: string;
}

/**
 * Fetch papers from arXiv RSS feed for a specific category
 */
async function fetchArxivRssFeed(category: string): Promise<RssPaper[]> {
  try {
    console.log(`[ARXIV] Fetching RSS feed for category: ${category}`);
    const response = await fetch(`https://rss.arxiv.org/rss/${category}`, {
      headers: {
        'User-Agent': 'ReadAcross/1.0 (Educational Language Learning Platform)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const xml = await response.text();
    const papers: RssPaper[] = [];
    
    // Parse RSS XML to extract papers
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    
    while ((match = itemRegex.exec(xml)) !== null) {
      const itemContent = match[1];
      
      // Extract paper details
      const titleMatch = itemContent.match(/<title>([^<]+)<\/title>/);
      const linkMatch = itemContent.match(/<link>([^<]+)<\/link>/);
      const descMatch = itemContent.match(/<description>([^<]+)<\/description>/);
      const creatorMatch = itemContent.match(/<dc:creator>([^<]+)<\/dc:creator>/i);
      
      if (titleMatch && linkMatch) {
        const arxivUrl = linkMatch[1].trim();
        const idMatch = arxivUrl.match(/abs\/(\d+\.\d+)/);
        
        if (idMatch) {
          papers.push({
            id: idMatch[1],
            title: titleMatch[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'),
            authors: creatorMatch ? creatorMatch[1].split(',').map(a => a.trim()) : ['Unknown'],
            abstract: descMatch ? descMatch[1].trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>') : '',
            published: new Date().toISOString().split('T')[0],
            categories: [category],
            pdfUrl: arxivUrl.replace('/abs/', '/pdf/') + '.pdf',
            arxivUrl
          });
        }
      }
    }
    
    console.log(`[ARXIV] Found ${papers.length} papers from ${category} RSS feed`);
    return papers;
  } catch (error) {
    console.error(`[ARXIV] Error fetching RSS feed for ${category}:`, error);
    return [];
  }
}

/**
 * Check if a paper exists in the database
 */
async function isPaperInDatabase(arxivId: string): Promise<boolean> {
  try {
    const existingDocs = await storage.getAllDocuments();
    return existingDocs.some(doc => 
      doc.source === 'arXiv' && 
      (doc.originalUrl?.includes(arxivId) || doc.originalUrl?.includes(`abs/${arxivId}`))
    );
  } catch (error) {
    console.error('[ARXIV] Error checking if paper exists:', error);
    return false;
  }
}

/**
 * Process and save a paper from RSS feed
 */
async function processAndSaveRssPaper(
  paper: RssPaper,
  options: { isPermanent: boolean; expiresAt?: Date }
): Promise<boolean> {
  try {
    console.log(`[ARXIV] Processing RSS paper: ${paper.title}`);

    // Check if paper already exists
    const exists = await isPaperInDatabase(paper.id);
    if (exists) {
      console.log(`[ARXIV] Paper already exists: ${paper.title}`);
      return false;
    }

    // Try HTML first, fallback to PDF
    const htmlUrl = normalizeArxivUrl(paper.arxivUrl);
    let fullText = '';
    let contentSourceType = 'html';
    
    try {
      const htmlResponse = await fetch(htmlUrl, {
        headers: {
          'User-Agent': 'ReadAcross/1.0 (Educational Language Learning Platform)'
        }
      });
      
      if (htmlResponse.ok) {
        const htmlContent = await htmlResponse.text();
        if (htmlContent && htmlContent.length > 1000) {
          fullText = htmlContent;
          contentSourceType = 'html';
        } else {
          throw new Error('HTML content too short');
        }
      } else {
        throw new Error(`HTTP ${htmlResponse.status}`);
      }
    } catch (htmlError) {
      console.log(`[ARXIV] HTML extraction failed, falling back to PDF...`);
      const pdfBuffer = await fetchPaperPDF(paper.pdfUrl);
      fullText = await parsePDF(pdfBuffer);
      contentSourceType = 'pdf';
    }
    
    if (!fullText || fullText.length < 100) {
      console.log(`[ARXIV] Skipping paper due to insufficient text: ${paper.title}`);
      return false;
    }

    const structuredBlocks = await generateStructuredBlocks(
      fullText,
      contentSourceType === 'html' ? 'auto' : 'text',
      `arXiv (${contentSourceType})`,
      { minBlockLength: 80 },
      htmlUrl
    );
    
    if (structuredBlocks.length === 0) {
      console.log(`[ARXIV] Skipping paper due to no structured blocks: ${paper.title}`);
      return false;
    }
    
    // Create paragraphs from structured blocks
    const paragraphs = [];
    let paragraphOrder = 0;
    
    for (const block of structuredBlocks) {
      if (!block.content || block.content.length < 50) continue;
      
      const sentences = splitIntoSentences(block.content);
      if (sentences.length === 0) continue;
      
      let sectionTitle = '';
      if (block.type === 'heading') {
        sectionTitle = block.content;
      } else {
        const firstWords = block.content.split(' ').slice(0, 4).join(' ');
        sectionTitle = `${block.type.charAt(0).toUpperCase() + block.type.slice(1)} ${paragraphOrder + 1}: ${firstWords}...`;
      }
      
      paragraphs.push({
        title: sectionTitle,
        order: paragraphOrder++,
        sentences: sentences.slice(0, 15).map((sentence, idx) => ({
          source: sentence,
          target: undefined,
          order: idx
        }))
      });
      
      if (paragraphOrder >= 25) break;
    }

    const difficulty = 'advanced'; // Most new AI/CL papers are advanced
    const authors = paper.authors.join(', ');
    
    // Archetype: "academic" with confidence 1.0 because source is arXiv (per instructions.md)
    await storage.createDocumentWithParagraphs({
      title: paper.title,
      sourceLanguage: "en",
      userId: undefined,
      fileType: "pdf",
      author: authors,
      source: "arXiv",
      category: "Academic",
      difficulty: difficulty,
      tags: `arxiv,${paper.categories.join(',')},${difficulty},academic`,
      originalUrl: paper.arxivUrl,
      licenseType: "arXiv License",
      isPublic: true,
      structuredContent: structuredBlocks.length > 0 ? JSON.stringify(structuredBlocks) : undefined,
      structuredVersion: 2,
      contentSourceType,
      expiresAt: options.expiresAt,
      paragraphs,
      // Source-based archetype per instructions.md section 2.3
      archetype: "academic",
      archetypeConfidence: 1.0,
      archetypeSource: "source"
    });

    console.log(`[ARXIV] Successfully added: ${paper.title}`);
    return true;
  } catch (error) {
    console.error(`[ARXIV] Failed to process ${paper.title}:`, error);
    return false;
  }
}

/**
 * Fetch daily papers from arXiv RSS (cs.AI and cs.CL categories)
 * Called Mon-Fri to add 3 new papers per day
 */
export async function fetchDailyArxivPapers(): Promise<{ 
  success: boolean; 
  papersAdded: number; 
  paperTitles: string[];
  error?: string 
}> {
  console.log("[ARXIV] Starting daily RSS fetch (cs.AI, cs.CL)...");
  
  const syncLog = await storage.createSyncLog({
    sourceType: 'arxiv',
    status: 'partial',
    details: { source: 'rss', categories: ['cs.AI', 'cs.CL'] }
  });

  try {
    // Fetch from both cs.AI and cs.CL categories
    const [csAiPapers, csClPapers] = await Promise.all([
      fetchArxivRssFeed('cs.AI'),
      fetchArxivRssFeed('cs.CL')
    ]);
    
    const allPapers = [...csAiPapers, ...csClPapers];
    console.log(`[ARXIV] Total papers from RSS: ${allPapers.length}`);
    
    if (allPapers.length === 0) {
      await storage.updateSyncLog(syncLog.id, {
        status: 'failed',
        errorMessage: 'No papers found in RSS feeds',
        completedAt: new Date()
      });
      return { success: false, papersAdded: 0, paperTitles: [], error: 'No papers found in RSS feeds' };
    }

    // Check for auto-approval keywords and prioritize matching papers
    const papersWithApproval = await Promise.all(
      allPapers.map(async (paper) => {
        const approval = await storage.checkAutoApproval(paper.title, paper.abstract);
        return { paper, ...approval };
      })
    );

    // Sort by approval (approved first), then by title
    papersWithApproval.sort((a, b) => {
      if (a.approved && !b.approved) return -1;
      if (!a.approved && b.approved) return 1;
      return 0;
    });

    const paperTitles: string[] = [];
    let papersAdded = 0;
    const targetCount = 3; // Add 3 papers per day
    
    for (const { paper, approved, matchedKeywords } of papersWithApproval) {
      if (papersAdded >= targetCount) break;
      
      // Check if already in database
      const exists = await isPaperInDatabase(paper.id);
      if (exists) continue;
      
      // Log matched keywords
      if (approved) {
        console.log(`[ARXIV] Auto-approved paper matches keywords: ${matchedKeywords.join(', ')}`);
        for (const keyword of matchedKeywords) {
          await storage.incrementKeywordMatchCount(keyword);
        }
      }

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 14); // 14-day expiration
      
      const success = await processAndSaveRssPaper(paper, { 
        isPermanent: false, 
        expiresAt 
      });
      
      if (success) {
        papersAdded++;
        paperTitles.push(paper.title);
        
        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    await storage.updateSyncLog(syncLog.id, {
      status: papersAdded > 0 ? 'success' : 'partial',
      documentsAdded: papersAdded,
      documentsSkipped: allPapers.length - papersAdded,
      details: {
        source: 'rss',
        categories: ['cs.AI', 'cs.CL'],
        paperTitles
      },
      completedAt: new Date()
    });

    console.log(`[ARXIV] Daily fetch completed: ${papersAdded} papers added`);
    return { success: true, papersAdded, paperTitles };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await storage.updateSyncLog(syncLog.id, {
      status: 'failed',
      errorMessage,
      completedAt: new Date()
    });
    
    console.error('[ARXIV] Daily fetch error:', error);
    return { success: false, papersAdded: 0, paperTitles: [], error: errorMessage };
  }
}

/**
 * Seed Foundation arXiv papers (is_permanent: true)
 */
export async function seedFoundationArxivPapers(): Promise<void> {
  console.log("[ARXIV] Starting Foundation arXiv papers seeding...");
  await seedArxivPapers();
}