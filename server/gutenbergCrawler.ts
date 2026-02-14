import { storage } from "./storage.js";

interface GutenbergBook {
  title: string;
  titleKo?: string;
  author: string;
  textUrl: string;
  gutenbergId: number;
  difficulty: string;
  category: string;
}

// Foundation Classics: 15 curated books with Korean title mappings (is_permanent: true)
const FOUNDATION_CLASSICS: GutenbergBook[] = [
  {
    title: "Pride and Prejudice",
    titleKo: "오만과 편견",
    author: "Jane Austen",
    textUrl: "https://www.gutenberg.org/files/1342/1342-0.txt",
    gutenbergId: 1342,
    difficulty: "intermediate",
    category: "Literature"
  },
  {
    title: "Alice's Adventures in Wonderland",
    titleKo: "이상한 나라의 앨리스",
    author: "Lewis Carroll",
    textUrl: "https://www.gutenberg.org/files/11/11-0.txt",
    gutenbergId: 11,
    difficulty: "beginner",
    category: "Literature"
  },
  {
    title: "A Tale of Two Cities",
    titleKo: "두 도시 이야기",
    author: "Charles Dickens",
    textUrl: "https://www.gutenberg.org/files/98/98-0.txt",
    gutenbergId: 98,
    difficulty: "advanced",
    category: "Literature"
  },
  {
    title: "The Great Gatsby",
    titleKo: "위대한 개츠비",
    author: "F. Scott Fitzgerald",
    textUrl: "https://www.gutenberg.org/files/64317/64317-0.txt",
    gutenbergId: 64317,
    difficulty: "intermediate",
    category: "Literature"
  },
  {
    title: "Frankenstein",
    titleKo: "프랑켄슈타인",
    author: "Mary Wollstonecraft Shelley",
    textUrl: "https://www.gutenberg.org/files/84/84-0.txt",
    gutenbergId: 84,
    difficulty: "intermediate",
    category: "Literature"
  },
  {
    title: "The Adventures of Tom Sawyer",
    titleKo: "톰 소여의 모험",
    author: "Mark Twain",
    textUrl: "https://www.gutenberg.org/files/74/74-0.txt",
    gutenbergId: 74,
    difficulty: "beginner",
    category: "Literature"
  },
  {
    title: "The Picture of Dorian Gray",
    titleKo: "도리안 그레이의 초상",
    author: "Oscar Wilde",
    textUrl: "https://www.gutenberg.org/files/174/174-0.txt",
    gutenbergId: 174,
    difficulty: "advanced",
    category: "Literature"
  },
  {
    title: "The Time Machine",
    titleKo: "타임머신",
    author: "H. G. Wells",
    textUrl: "https://www.gutenberg.org/files/35/35-0.txt",
    gutenbergId: 35,
    difficulty: "intermediate",
    category: "Literature"
  },
  {
    title: "Dracula",
    titleKo: "드라큘라",
    author: "Bram Stoker",
    textUrl: "https://www.gutenberg.org/files/345/345-0.txt",
    gutenbergId: 345,
    difficulty: "advanced",
    category: "Literature"
  },
  {
    title: "The Adventures of Sherlock Holmes",
    titleKo: "셜록 홈즈의 모험",
    author: "Arthur Conan Doyle",
    textUrl: "https://www.gutenberg.org/files/1661/1661-0.txt",
    gutenbergId: 1661,
    difficulty: "intermediate",
    category: "Literature"
  },
  {
    title: "Moby Dick",
    titleKo: "모비 딕",
    author: "Herman Melville",
    textUrl: "https://www.gutenberg.org/files/2701/2701-0.txt",
    gutenbergId: 2701,
    difficulty: "advanced",
    category: "Literature"
  },
  {
    title: "The War of the Worlds",
    titleKo: "우주 전쟁",
    author: "H. G. Wells",
    textUrl: "https://www.gutenberg.org/files/36/36-0.txt",
    gutenbergId: 36,
    difficulty: "intermediate",
    category: "Literature"
  },
  {
    title: "The Wonderful Wizard of Oz",
    titleKo: "오즈의 마법사",
    author: "L. Frank Baum",
    textUrl: "https://www.gutenberg.org/files/55/55-0.txt",
    gutenbergId: 55,
    difficulty: "beginner",
    category: "Literature"
  },
  {
    title: "A Christmas Carol",
    titleKo: "크리스마스 캐럴",
    author: "Charles Dickens",
    textUrl: "https://www.gutenberg.org/files/46/46-0.txt",
    gutenbergId: 46,
    difficulty: "intermediate",
    category: "Literature"
  },
  {
    title: "The Strange Case of Dr. Jekyll and Mr. Hyde",
    titleKo: "지킬 박사와 하이드",
    author: "Robert Louis Stevenson",
    textUrl: "https://www.gutenberg.org/files/43/43-0.txt",
    gutenbergId: 43,
    difficulty: "intermediate",
    category: "Literature"
  }
];

// Fallback list if Top 100 scraping fails
const GUTENBERG_VETTED_IDS = [
  1400, 1260, 768, 120, 1232, 1184, 219, 2591, 730, 76,
  2542, 514, 16328, 3207, 25344, 844, 244, 2814, 996, 1952
];

async function fetchBookText(url: string, removeLimit: boolean = true): Promise<string> {
  try {
    console.log(`[GUTENBERG] Fetching book from: ${url}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ReadAcross/1.0 (Educational Language Learning Platform)'
      }
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }
    const text = await response.text();

    const startMarkers = [
      "*** START OF THE PROJECT GUTENBERG EBOOK",
      "*** START OF THIS PROJECT GUTENBERG EBOOK",
      "START OF THE PROJECT GUTENBERG EBOOK"
    ];

    const endMarkers = [
      "*** END OF THE PROJECT GUTENBERG EBOOK",
      "*** END OF THIS PROJECT GUTENBERG EBOOK",
      "END OF THE PROJECT GUTENBERG EBOOK"
    ];

    let cleanText = text;

    for (const marker of startMarkers) {
      const startIndex = cleanText.indexOf(marker);
      if (startIndex !== -1) {
        const lineEnd = cleanText.indexOf('\n', startIndex);
        if (lineEnd !== -1) {
          cleanText = cleanText.substring(lineEnd + 1);
          break;
        }
      }
    }

    for (const marker of endMarkers) {
      const endIndex = cleanText.indexOf(marker);
      if (endIndex !== -1) {
        cleanText = cleanText.substring(0, endIndex);
        break;
      }
    }

    cleanText = cleanText.trim();
    console.log(`[GUTENBERG] Fetched ${cleanText.length} characters (full text, no limit)`);

    return cleanText;
  } catch (error) {
    console.error(`[GUTENBERG] Error fetching book from ${url}:`, error);
    throw error;
  }
}

function splitIntoSentences(text: string): string[] {
  const sentences = text
    .split(/[.!?]+/)
    .map(s => s.trim())
    .filter(s => s.length > 10 && s.length < 500);

  return sentences;
}

function createParagraphsFromSentences(
  sentences: string[], 
  options?: { hasStructuredContent?: boolean }
) {
  const paragraphs = [];
  const sentencesPerParagraph = 5;
  const preventSyntheticHeadings = options?.hasStructuredContent || false;

  for (let i = 0; i < sentences.length; i += sentencesPerParagraph) {
    const paragraphSentences = sentences.slice(i, i + sentencesPerParagraph);
    const paragraphNumber = Math.floor(i / sentencesPerParagraph) + 1;
    
    let title: string | undefined;
    if (!preventSyntheticHeadings) {
      title = `Chapter ${paragraphNumber}`;
    }

    paragraphs.push({
      title: title || null,
      order: Math.floor(i / sentencesPerParagraph),
      sentences: paragraphSentences.map((sentence, idx) => ({
        order: idx,
        source: sentence,
        target: undefined
      }))
    });
  }

  return paragraphs;
}

interface Top100Book {
  rank: number;
  id: number;
  title: string;
}

async function fetchTop100Books(): Promise<Top100Book[]> {
  try {
    console.log('[GUTENBERG] Fetching Top 100 eBooks list...');
    const response = await fetch('https://www.gutenberg.org/browse/scores/top', {
      headers: {
        'User-Agent': 'ReadAcross/1.0 (Educational Language Learning Platform)'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch Top 100: ${response.status}`);
    }

    const html = await response.text();
    const books: Top100Book[] = [];
    
    // Parse the Top 100 list from HTML
    // The list format is: <li><a href="/ebooks/XXXX">Title by Author</a> (YYYY downloads)</li>
    const listMatch = html.match(/Top 100 EBooks last 7 days[\s\S]*?<ol[^>]*>([\s\S]*?)<\/ol>/i);
    if (listMatch) {
      const listContent = listMatch[1];
      const itemRegex = /<li[^>]*><a\s+href="\/ebooks\/(\d+)"[^>]*>([^<]+)<\/a>/gi;
      let match;
      let rank = 1;
      
      while ((match = itemRegex.exec(listContent)) !== null && rank <= 100) {
        books.push({
          rank,
          id: parseInt(match[1], 10),
          title: match[2].trim()
        });
        rank++;
      }
    }

    console.log(`[GUTENBERG] Found ${books.length} books in Top 100`);
    return books;
  } catch (error) {
    console.error('[GUTENBERG] Error fetching Top 100:', error);
    return [];
  }
}

async function getBookMetadata(gutenbergId: number): Promise<{ title: string; author: string } | null> {
  try {
    const response = await fetch(`https://www.gutenberg.org/ebooks/${gutenbergId}`, {
      headers: {
        'User-Agent': 'ReadAcross/1.0 (Educational Language Learning Platform)'
      }
    });
    
    if (!response.ok) return null;
    
    const html = await response.text();
    
    // Extract title
    const titleMatch = html.match(/<h1[^>]*itemprop="name"[^>]*>([^<]+)<\/h1>/i) ||
                       html.match(/<title>([^|<]+)/i);
    const title = titleMatch ? titleMatch[1].trim() : `Book #${gutenbergId}`;
    
    // Extract author
    const authorMatch = html.match(/itemprop="creator"[^>]*>([^<]+)<\/a>/i) ||
                        html.match(/by\s+<a[^>]*>([^<]+)<\/a>/i);
    const author = authorMatch ? authorMatch[1].trim() : 'Unknown Author';
    
    return { title, author };
  } catch (error) {
    console.error(`[GUTENBERG] Error fetching metadata for book ${gutenbergId}:`, error);
    return null;
  }
}

async function isBookInDatabase(gutenbergId: number): Promise<boolean> {
  try {
    const existingDocs = await storage.getAllDocuments();
    return existingDocs.some(doc => 
      doc.source === 'Project Gutenberg' && 
      doc.originalUrl?.includes(`/${gutenbergId}/`) ||
      doc.originalUrl?.includes(`/${gutenbergId}-`)
    );
  } catch (error) {
    console.error('[GUTENBERG] Error checking if book exists:', error);
    return false;
  }
}

async function processAndSaveBook(
  book: GutenbergBook, 
  options: { isPermanent: boolean; expiresAt?: Date }
): Promise<boolean> {
  try {
    console.log(`[GUTENBERG] Processing: ${book.title} by ${book.author}`);

    // Check if book already exists
    const exists = await isBookInDatabase(book.gutenbergId);
    if (exists) {
      console.log(`[GUTENBERG] Book already exists: ${book.title}`);
      return false;
    }

    const rawText = await fetchBookText(book.textUrl, true);
    const sentences = splitIntoSentences(rawText);
    
    const { generateStructuredBlocks } = await import('./utils/structuredUtils.js');
    let structuredBlocks: any[] = [];
    try {
      structuredBlocks = await generateStructuredBlocks(rawText, 'auto', 'Project Gutenberg');
    } catch (error) {
      console.warn('[GUTENBERG] Failed to generate structured content blocks:', error);
    }
    
    const hasStructuredContent = structuredBlocks && structuredBlocks.length > 0;
    const paragraphs = createParagraphsFromSentences(sentences, { hasStructuredContent });

    const document = await storage.createDocumentWithParagraphs({
      title: book.title,
      sourceLanguage: "en",
      userId: null,
      fileType: "text",
      author: book.author,
      source: "Project Gutenberg",
      category: book.category as any,
      difficulty: book.difficulty,
      tags: `gutenberg,${book.category},${book.difficulty}`,
      originalUrl: book.textUrl,
      licenseType: "Public Domain",
      isPublic: true,
      sourceType: "explore",
      structuredContent: structuredBlocks.length > 0 ? JSON.stringify(structuredBlocks) : undefined,
      structuredVersion: 1,
      contentSourceType: 'text',
      isPermanent: options.isPermanent,
      expiresAt: options.expiresAt,
      paragraphs
    });

    // Log the seeding operation
    await storage.createSyncLog({
      sourceType: 'gutenberg',
      status: 'success',
      documentsAdded: 1,
      details: {
        selectedBookId: book.gutenbergId,
        selectedBookTitle: book.title,
        isPermanent: options.isPermanent
      }
    });

    console.log(`[GUTENBERG] Successfully added: ${book.title} (${paragraphs.length} paragraphs, ${sentences.length} sentences)`);
    return true;
  } catch (error) {
    console.error(`[GUTENBERG] Failed to process ${book.title}:`, error);
    return false;
  }
}

// Seed Foundation Classics (15 books, is_permanent: true)
export async function seedFoundationClassics(): Promise<void> {
  console.log("[GUTENBERG] Starting Foundation Classics seeding (15 books)...");

  let added = 0;
  let skipped = 0;

  for (const book of FOUNDATION_CLASSICS) {
    try {
      const success = await processAndSaveBook(book, { isPermanent: true });
      if (success) {
        added++;
      } else {
        skipped++;
      }
      
      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1500));
    } catch (error) {
      console.error(`[GUTENBERG] Error processing ${book.title}:`, error);
      skipped++;
    }
  }

  console.log(`[GUTENBERG] Foundation Classics seeding completed: ${added} added, ${skipped} skipped`);
}

// Weekly dynamic fetch from Top 100 (is_permanent: false, 30-day expiry)
export async function fetchWeeklyTopBook(): Promise<{ success: boolean; bookTitle?: string; error?: string }> {
  console.log("[GUTENBERG] Starting weekly Top 100 fetch...");
  
  const syncLog = await storage.createSyncLog({
    sourceType: 'gutenberg',
    status: 'partial',
    details: { source: 'top100' }
  });

  try {
    // Fetch Top 100 list
    const top100 = await fetchTop100Books();
    
    if (top100.length === 0) {
      console.log("[GUTENBERG] Top 100 fetch failed, using fallback list...");
      // Use fallback list
      for (const gutenbergId of GUTENBERG_VETTED_IDS) {
        const exists = await isBookInDatabase(gutenbergId);
        if (!exists) {
          const metadata = await getBookMetadata(gutenbergId);
          if (metadata) {
            const book: GutenbergBook = {
              title: metadata.title,
              author: metadata.author,
              textUrl: `https://www.gutenberg.org/files/${gutenbergId}/${gutenbergId}-0.txt`,
              gutenbergId,
              difficulty: 'intermediate',
              category: 'Literature'
            };

            const expiresAt = new Date();
            expiresAt.setDate(expiresAt.getDate() + 30);
            
            const success = await processAndSaveBook(book, { isPermanent: false, expiresAt });
            
            if (success) {
              await storage.updateSyncLog(syncLog.id, {
                status: 'success',
                documentsAdded: 1,
                details: {
                  selectedBookId: gutenbergId,
                  selectedBookTitle: metadata.title,
                  source: 'fallback'
                },
                completedAt: new Date()
              });
              
              return { success: true, bookTitle: metadata.title };
            }
          }
        }
      }
      
      await storage.updateSyncLog(syncLog.id, {
        status: 'failed',
        errorMessage: 'All fallback books already exist',
        completedAt: new Date()
      });
      
      return { success: false, error: 'All fallback books already exist' };
    }

    // Find highest-ranked book not in database
    for (const topBook of top100) {
      const exists = await isBookInDatabase(topBook.id);
      if (!exists) {
        const metadata = await getBookMetadata(topBook.id);
        if (metadata) {
          const book: GutenbergBook = {
            title: metadata.title,
            author: metadata.author,
            textUrl: `https://www.gutenberg.org/files/${topBook.id}/${topBook.id}-0.txt`,
            gutenbergId: topBook.id,
            difficulty: 'intermediate',
            category: 'Literature'
          };

          const expiresAt = new Date();
          expiresAt.setDate(expiresAt.getDate() + 30);
          
          const success = await processAndSaveBook(book, { isPermanent: false, expiresAt });
          
          if (success) {
            await storage.updateSyncLog(syncLog.id, {
              status: 'success',
              documentsAdded: 1,
              details: {
                selectedBookId: topBook.id,
                selectedBookTitle: metadata.title,
                topChartRank: topBook.rank,
                source: 'top100'
              },
              completedAt: new Date()
            });
            
            console.log(`[GUTENBERG] Added Top 100 book (rank #${topBook.rank}): ${metadata.title}`);
            return { success: true, bookTitle: metadata.title };
          }
        }
      }
    }

    await storage.updateSyncLog(syncLog.id, {
      status: 'failed',
      errorMessage: 'All Top 100 books already exist',
      completedAt: new Date()
    });
    
    return { success: false, error: 'All Top 100 books already exist' };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await storage.updateSyncLog(syncLog.id, {
      status: 'failed',
      errorMessage,
      completedAt: new Date()
    });
    
    console.error('[GUTENBERG] Weekly fetch error:', error);
    return { success: false, error: errorMessage };
  }
}

// Legacy function for compatibility
export async function seedGutenbergBooks(): Promise<void> {
  await seedFoundationClassics();
}
