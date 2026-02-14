import Parser from 'rss-parser';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { storage } from './storage';
import type { RssFeed, RssArticle } from '@shared/schema';
import { thumbnailQueue } from './thumbnailQueue';
import { estimateDifficulty } from './guardianCrawler';

// RSS용 토픽 태그 생성 함수
function generateTopicTags(content: string, feedTitle?: string): string[] {
  const tags = new Set<string>();
  
  // RSS/블로그 태그 추가
  tags.add('rss');
  tags.add('blog');
  
  // 피드 이름 기반 태그
  if (feedTitle) {
    const cleanTitle = feedTitle.toLowerCase().replace(/[^\w\s]/g, '').trim();
    if (cleanTitle.length > 2) {
      tags.add(cleanTitle.replace(/\s+/g, '-'));
    }
  }
  
  // 콘텐츠 기반 간단한 태그 생성
  const lowercaseContent = content.toLowerCase();
  
  // 기술 관련 키워드
  if (lowercaseContent.includes('technology') || lowercaseContent.includes('ai') || lowercaseContent.includes('software')) {
    tags.add('technology');
  }
  
  // 정치 관련 키워드
  if (lowercaseContent.includes('politics') || lowercaseContent.includes('election') || lowercaseContent.includes('government')) {
    tags.add('politics');
  }
  
  // 비즈니스 관련 키워드
  if (lowercaseContent.includes('business') || lowercaseContent.includes('economy') || lowercaseContent.includes('startup')) {
    tags.add('business');
  }
  
  // 엔터테인먼트 관련 키워드
  if (lowercaseContent.includes('music') || lowercaseContent.includes('movie') || lowercaseContent.includes('entertainment')) {
    tags.add('entertainment');
  }
  
  return Array.from(tags);
}

// HTML에서 문단 추출 함수 - 중복 방지 개선
function extractParagraphsFromHTML(htmlContent: string): string[] {
  try {
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;

    // 주요 콘텐츠 영역에서만 문단 추출 (더 정확한 파싱)
    const contentSelectors = [
      'article p', 'main p', '.content p', '.post-content p', '.entry-content p',
      'article div', 'main div', '.content div'
    ];
    
    let paragraphElements: Element[] = [];
    
    // 우선순위 순서로 셀렉터 시도
    for (const selector of contentSelectors) {
      paragraphElements = Array.from(document.querySelectorAll(selector));
      if (paragraphElements.length > 0) {
        console.log(`Found ${paragraphElements.length} elements with selector: ${selector}`);
        break;
      }
    }
    
    // 기본 fallback
    if (paragraphElements.length === 0) {
      paragraphElements = Array.from(document.querySelectorAll('p'));
      console.log(`Fallback to basic p tags: ${paragraphElements.length} elements`);
    }

    const seenParagraphs = new Set<string>();
    const paragraphs: string[] = [];
    
    for (const el of paragraphElements) {
      const text = el.textContent?.trim() || '';
      
      // 더 엄격한 필터링
      if (text.length < 30) continue; // 최소 30자
      if (text.split(' ').length < 5) continue; // 최소 5단어
      
      // 메타데이터 및 불필요한 내용 제외
      if (text.match(/^(Posted by|Filed under|Tags:|Share:|Follow:|Subscribe:|Copyright|©|Read more|Continue reading)/i)) continue;
      if (text.match(/^[\d\s\-\.\(\)]+$/)) continue; // 숫자만 포함된 텍스트
      if (text.match(/^[A-Z\s\d\.\-]{20,}$/)) continue; // 대문자로만 구성된 텍스트
      
      // 정규화된 텍스트로 중복 검사
      const normalizedText = text.toLowerCase().replace(/\s+/g, ' ');
      if (seenParagraphs.has(normalizedText)) continue;
      
      seenParagraphs.add(normalizedText);
      paragraphs.push(text);
    }

    console.log(`Extracted ${paragraphs.length} unique paragraphs from HTML content (improved filtering)`);
    return paragraphs;
  } catch (error) {
    console.error('Error extracting paragraphs from HTML:', error);
    return [];
  }
}

// HTML에서 구조화된 요소(이미지, 테이블, 제목) 추출
function extractStructuredElements(htmlContent: string): any[] {
  try {
    const dom = new JSDOM(htmlContent);
    const document = dom.window.document;
    const structuredBlocks: any[] = [];
    const seenContent = new Set<string>(); // 중복 콘텐츠 방지

    // 모든 요소를 순서대로 가져와서 처리
    const allElements = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6, img, table, p, div'));
    
    allElements.forEach((element: Element, index: number) => {
      const tagName = element.tagName.toLowerCase();
      
      // 제목 추출
      if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(tagName)) {
        const text = element.textContent?.trim();
        if (text && text.length > 3) {
          const contentKey = `heading:${text.toLowerCase()}`;
          if (!seenContent.has(contentKey)) {
            seenContent.add(contentKey);
            structuredBlocks.push({
              type: 'heading',
              level: parseInt(tagName.charAt(1)),
              order: index * 10,
              content: text
            });
          }
        }
      }
      
      // 이미지 추출
      if (tagName === 'img') {
        const src = element.getAttribute('src');
        const alt = element.getAttribute('alt') || '';
        const title = element.getAttribute('title') || '';
        
        if (src && !src.startsWith('data:')) { // data: URL 제외
          const contentKey = `image:${src}`;
          if (!seenContent.has(contentKey)) {
            seenContent.add(contentKey);
            const caption = alt || title || 'Image from article';
            structuredBlocks.push({
              type: 'image',
              order: index * 10,
              src: src.startsWith('http') ? src : null, // 절대 URL만 허용
              caption: caption
            });
          }
        }
      }
      
      // 테이블 추출
      if (tagName === 'table') {
        const html = element.outerHTML;
        const caption = element.querySelector('caption')?.textContent?.trim() || 'Table from article';
        
        // 테이블이 실제 데이터를 포함하는지 확인
        const rows = element.querySelectorAll('tr');
        if (rows.length > 1) { // 헤더 + 최소 1개 데이터 행
          structuredBlocks.push({
            type: 'table',
            order: index * 10,
            html: html,
            caption: caption
          });
        }
      }
    });

    console.log(`Extracted ${structuredBlocks.length} structured elements from HTML`);
    return structuredBlocks;
  } catch (error) {
    console.error('Error extracting structured elements from HTML:', error);
    return [];
  }
}

// 문장 분리 함수 (NPR, Guardian 크롤러와 유사)
function splitIntoSentences(text: string): string[] {
  if (!text) return [];

  // 텍스트 정리
  const cleanText = text
    .replace(/\s+/g, ' ')
    .replace(/([.!?])\s*\n+/g, '$1 ')
    .replace(/\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    // 일반적인 약어 보호
    .replace(/\b(Mr\.|Mrs\.|Ms\.|Dr\.|Prof\.|Sr\.|Jr\.|vs\.|etc\.|Inc\.|Ltd\.|Corp\.|Co\.|UK|US|EU|UN|BBC|CNN|NASA|FBI|CIA|NHS|GDP|CEO|PM|MP|TV|PC|AI|IT|HR|PR|VIP)/g, (match) => match.replace('.', '●'))
    .trim();

  // 문장으로 분리
  const sentences = cleanText
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.replace(/●/g, '.').trim())
    .filter(s => s.length >= 10 && s.length <= 500) // 길이 필터
    .filter(s => s.split(' ').length >= 3) // 최소 3단어
    .filter(s => !s.match(/^\s*[\[\(].*[\]\)]\s*$/)); // 참조 제외

  return sentences;
}

// RSS 파서 초기화
const parser = new Parser({
  customFields: {
    item: [
      ['description', 'description'],
      ['content:encoded', 'contentEncoded'],
      ['summary', 'summary']
    ]
  }
});

// RSS 피드 파싱 및 콘텐츠 추출
export async function fetchRSSFeed(feedUrl: string): Promise<any> {
  try {
    console.log(`Fetching RSS feed: ${feedUrl}`);
    const feed = await parser.parseURL(feedUrl);
    console.log(`Successfully parsed feed: ${feed.title} (${feed.items.length} items)`);
    return feed;
  } catch (error) {
    console.error(`Error fetching RSS feed ${feedUrl}:`, error);
    throw new Error(`RSS 피드를 가져올 수 없습니다: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// 아티클 URL에서 전체 콘텐츠 추출
export async function extractArticleContent(articleUrl: string): Promise<string | null> {
  try {
    console.log(`Extracting content from: ${articleUrl}`);

    // fetch를 사용하여 HTML 가져오기
    const response = await fetch(articleUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; RSS-Reader/1.0)'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // JSDOM으로 DOM 파싱
    const dom = new JSDOM(html, { url: articleUrl });
    const document = dom.window.document;

    // Readability로 본문 추출 - HTML 구조 보존
    const reader = new Readability(document);
    const article = reader.parse();

    if (article && article.content) {
      console.log(`Successfully extracted content with HTML structure (${article.content.length} chars)`);
      // HTML 구조가 포함된 콘텐츠 반환 (문단 구조 보존)
      return article.content;
    } else if (article && article.textContent) {
      console.log(`Fallback to text content (${article.textContent.length} chars)`);
      return article.textContent.trim();
    }

    console.log('No content extracted, falling back to original description');
    return null;
  } catch (error) {
    console.error(`Error extracting content from ${articleUrl}:`, error);
    return null;
  }
}

// 특정 RSS 피드의 아티클들을 처리
export async function processRSSArticles(feedId: number): Promise<void> {
  try {
    console.log(`Processing RSS articles for feed ${feedId}`);

    // 새로운 RSS 시스템에서 피드 정보 가져오기
    const feed = await storage.getRSSFeedById(feedId);
    if (!feed) {
      console.log(`Feed ${feedId} not found`);
      return;
    }
    
    // 피드가 차단되었는지 확인
    if (feed.isBlocked) {
      console.log(`Feed ${feedId} is blocked`);
      return;
    }

    // RSS 피드 파싱
    const rssData = await fetchRSSFeed(feed.canonicalUrl);

    // RSS 피드의 title을 실제 RSS 제목으로 업데이트 (필요하면)
    if (rssData.title && feed.title === 'RSS Feed') {
      await storage.updateNewRSSFeed(feedId, { title: rssData.title });
    }

    // 동기화 상태 업데이트 (시작)
    await storage.updateNewRSSFeed(feedId, { 
      lastRunAt: new Date(), 
      lastStatus: 'running' 
    });

    let processedCount = 0;
    let errorCount = 0;

    for (const item of rssData.items) {
      try {
        // 문서 레벨에서 중복 확인 (제목과 원본 URL 기준) - 새로운 시스템은 RSS 아티클을 별도로 저장하지 않음
        const existingDocuments = await storage.getAllDocuments();
        const duplicateDocument = existingDocuments.find(doc => 
          doc.title === item.title && 
          doc.originalUrl === item.link &&
          doc.source === feed.title
        );

        if (duplicateDocument) {
          console.log(`Document already exists: ${item.title}`);
          continue;
        }

        // 콘텐츠 추출 시도
        let content = null;
        if (item.link) {
          content = await extractArticleContent(item.link);
        }

        // 콘텐츠가 없으면 description 사용
        if (!content) {
          content = item.contentEncoded || item.description || item.summary || '';
        }

        // RSS 아티클을 직접 문서로 변환 (새로운 시스템에서는 중간 단계 없이 바로 문서 생성)
        try {
          const documentId = await convertRSSItemToDocument(item, feed, content);
          console.log(`Created document ${documentId} from RSS item: ${item.title}`);
          processedCount++;
        } catch (conversionError) {
          console.error(`Failed to convert RSS item to document:`, conversionError);
          errorCount++;
        }

        // 요청 간 딜레이 (서버 부하 방지)
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`Error processing article ${item.title}:`, error);
        errorCount++;
      }
    }

    // 동기화 성공 상태 업데이트 (새로운 시스템)
    await storage.updateNewRSSFeed(feedId, {
      lastRunAt: new Date(),
      lastStatus: errorCount > 0 ? 'partial' : 'success',
      errorCount: errorCount,
      lastError: errorCount > 0 ? `Processed ${processedCount} articles with ${errorCount} errors` : null
    });

    console.log(`Finished processing feed ${feedId}: ${processedCount} articles processed, ${errorCount} errors`);

  } catch (error) {
    console.error(`Error processing RSS feed ${feedId}:`, error);

    // 동기화 실패 상태 업데이트 (새로운 시스템)
    const feed = await storage.getRSSFeedById(feedId);
    const currentErrorCount = (feed?.errorCount || 0) + 1;

    await storage.updateNewRSSFeed(feedId, {
      lastRunAt: new Date(),
      lastStatus: 'failed',
      errorCount: currentErrorCount,
      lastError: error instanceof Error ? error.message : 'Unknown error'
    });

    throw error;
  }
}

// 모든 활성 피드 동기화 (새로운 시스템 - 구독 기반)
export async function syncAllActiveFeeds(): Promise<void> {
  try {
    console.log('Starting sync of all active RSS feeds');

    // 새로운 시스템에서는 활성화된 구독을 기준으로 동기화
    const allSubscriptions = await storage.getRSSSubscriptions();
    console.log(`Found ${allSubscriptions.length} total subscriptions`);
    
    const activeSubscriptions = allSubscriptions.filter(sub => sub.enabled);
    console.log(`Found ${activeSubscriptions.length} enabled subscriptions`);

    // 구독별로 피드 정보를 가져와서 동기화할 피드 목록 생성
    const feedsToSync = new Map<number, any>();
    
    for (const subscription of activeSubscriptions) {
      console.log(`Processing subscription ${subscription.id} for feed ${subscription.feedId}`);
      if (!feedsToSync.has(subscription.feedId)) {
        const feed = await storage.getRSSFeedById(subscription.feedId);
        console.log(`Feed ${subscription.feedId}:`, feed ? `found, blocked=${feed.isBlocked}` : 'not found');
        if (feed && !feed.isBlocked) {
          feedsToSync.set(subscription.feedId, feed);
          console.log(`Added feed ${subscription.feedId} to sync list`);
        }
      }
    }

    const activeFeedsFiltered = Array.from(feedsToSync.values());
    console.log(`Found ${activeFeedsFiltered.length} active feeds to sync`);

    for (const feed of activeFeedsFiltered) {
      try {
        // 동기화 간격 확인 (새로운 시스템 필드명 사용) - 테스트를 위해 임시로 비활성화
        const now = new Date();
        const lastRun = feed.lastRunAt;

        // 테스트를 위해 간격 체크를 임시로 비활성화
        if (false) {
          const hoursSinceLastRun = (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60);
          if (hoursSinceLastRun < 12) { // 기본 12시간 간격
            console.log(`Skipping feed ${feed.id} - not yet time to sync (${hoursSinceLastRun}h < 12h)`);
            continue;
          }
        }

        console.log(`Syncing feed: ${feed.title} (${feed.canonicalUrl})`);
        await processRSSArticles(feed.id);

        // 피드 간 딜레이
        await new Promise(resolve => setTimeout(resolve, 2000));

      } catch (error) {
        console.error(`Error syncing feed ${feed.id} (${feed.title}):`, error);
        // 개별 피드 오류는 전체 동기화를 중단하지 않음
      }
    }

    console.log('Completed sync of all active RSS feeds');

  } catch (error) {
    console.error('Error in syncAllActiveFeeds:', error);
    throw error;
  }
}

// RSS 아티클을 문서로 변환
// RSS 아이템을 직접 문서로 변환하는 새로운 함수 (새로운 RSS 시스템용)
export async function convertRSSItemToDocument(item: any, feed: any, content: string): Promise<number | null> {
  try {
    console.log(`Converting RSS item to document: ${item.title}`);

    // 콘텐츠 정리 및 문단 구분 - HTML 구조 보존
    const finalContent = content || item.description || item.summary || item.title;

    // HTML에서 구조화된 요소 추출 - 통일된 파이프라인 사용
    let structuredBlocks: any[] = [];
    let paragraphs: any[] = [];

    if (finalContent.includes('<p>') || finalContent.includes('<div>') || finalContent.includes('<img>') || finalContent.includes('<table>')) {
      console.log('Processing HTML content for structured extraction');
      
      // 통일된 구조화 파이프라인 사용 (RSS HTML 콘텐츠)
      const { generateStructuredContent } = await import('./routes.js');
      structuredBlocks = await generateStructuredContent(finalContent, 'html', feed.title || 'RSS');
      
      // HTML 콘텐츠의 경우, 구조화된 블록만 사용하고 별도 문단/문장 생성 생략
      // 중복을 방지하기 위해 구조화된 블록 내용에서만 문장 추출
      console.log(`Generated ${structuredBlocks.length} structured blocks from HTML content`);
      
      // 구조화된 블록에서 문단과 문장을 추출하여 기존 시스템과 호환성 유지
      if (structuredBlocks && structuredBlocks.length > 0) {
        const seenSentences = new Set<string>();
        let paragraphOrder = 1;
        
        for (const block of structuredBlocks) {
          if (block.type === 'paragraph' && block.content) {
            const sentences = splitIntoSentences(block.content);
            const sentencesData = [];
            
            for (let sIndex = 0; sIndex < sentences.length; sIndex++) {
              const sentence = sentences[sIndex].trim();
              // 문장 길이와 중복 검사
              if (sentence && sentence.length > 10 && !seenSentences.has(sentence)) {
                seenSentences.add(sentence);
                sentencesData.push({
                  order: sIndex + 1,
                  source: sentence,
                });
              }
            }
            
            if (sentencesData.length > 0) {
              paragraphs.push({
                order: paragraphOrder++,
                title: null,
                sentences: sentencesData,
              });
            }
          }
        }
        console.log(`Extracted sentences from ${paragraphs.length} paragraph blocks, avoiding duplication`);
      }
    } else {
      console.log('Processing plain text content');
      // HTML이 없는 경우에만 기본 방식 사용
      const paragraphRegex = /\n\s*\n/;
      const textParagraphs = finalContent
        .split(paragraphRegex)
        .map((p) => p.trim())
        .filter((p) => p.length > 20); // 최소 길이 필터

      console.log(`Split content into ${textParagraphs.length} paragraphs`);

      const seenSentences = new Set<string>();
      for (let pIndex = 0; pIndex < textParagraphs.length; pIndex++) {
        const paragraphText = textParagraphs[pIndex];
        const sentences = splitIntoSentences(paragraphText);
        const sentencesData = [];

        for (let sIndex = 0; sIndex < sentences.length; sIndex++) {
          const sentence = sentences[sIndex].trim();
          if (sentence && sentence.length > 10 && !seenSentences.has(sentence)) {
            seenSentences.add(sentence);
            sentencesData.push({
              order: sIndex + 1,
              source: sentence,
            });
          }
        }

        if (sentencesData.length > 0) {
          paragraphs.push({
            order: pIndex + 1,
            title: null,
            sentences: sentencesData,
          });
        }
      }
    }

    if (paragraphs.length === 0) {
      console.log('No valid paragraphs found, skipping document creation');
      return null;
    }

    // 문서 생성
    const documentData = {
      title: item.title || 'Untitled RSS Article',
      sourceLanguage: 'en', // RSS 피드는 대부분 영어
      source: feed.title || 'RSS',
      isPublic: true, // RSS 문서는 공개
      category: feed.category || 'News',
      difficulty: estimateDifficulty(finalContent),
      totalSentences: paragraphs.reduce((total, p) => total + p.sentences.length, 0),
      originalUrl: item.link || null,
      author: item.creator || item.author || null,
      publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
      topicTags: generateTopicTags(finalContent, feed.title).join(','),
      docType: 'article',
      // 콘텐츠 필드 추가
      content: { paragraphs: paragraphs },
      structuredContent: structuredBlocks,
      paragraphs: paragraphs,
      structuredBlocks: structuredBlocks,
    };

    // 기본 문서 생성 (콘텐츠 없이)
    const basicDocumentData = {
      title: item.title || 'Untitled RSS Article',
      sourceLanguage: 'en' as const,
      source: feed.title || 'RSS',
      isPublic: true,
      category: feed.category || 'News',
      difficulty: estimateDifficulty(finalContent),
      originalUrl: item.link || null,
      author: item.creator || item.author || null,
      publishedAt: item.pubDate ? new Date(item.pubDate) : new Date(),
      tags: generateTopicTags(finalContent, feed.title).join(','),
      sourceType: 'rss' as const,
    };

    const document = await storage.createDocument(basicDocumentData);
    console.log(`✅ Created basic document ${document.id}: ${document.title}`);

    // 문단과 문장 별도 생성
    for (const paragraphData of paragraphs) {
      const newParagraph = await storage.createParagraph({
        documentId: document.id,
        order: paragraphData.order,
        title: paragraphData.title,
      });

      // 문장들 생성
      for (const sentenceData of paragraphData.sentences) {
        await storage.createSentence({
          paragraphId: newParagraph.id,
          order: sentenceData.order,
          source: sentenceData.source,
          target: null,
        });
      }
    }

    // 구조화된 콘텐츠 저장
    if (structuredBlocks && structuredBlocks.length > 0) {
      await storage.updateDocument(document.id, {
        structuredContent: JSON.stringify(structuredBlocks),
        contentSourceType: 'html',
      });
      console.log(`✅ Stored structured content for document ${document.id} - ${structuredBlocks.length} blocks`);
    }

    console.log(`✅ Completed document ${document.id} with ${paragraphs.length} paragraphs and ${paragraphs.reduce((total, p) => total + p.sentences.length, 0)} sentences`);

    // 썸네일 추출 작업을 큐에 추가
    try {
      // RSS 아이템의 이미지 정보와 콘텐츠에서 추출된 이미지를 모두 활용
      const sourceData = {
        ...item,
        extractedContent: finalContent, // HTML 콘텐츠에서 이미지 추출을 위해
        fallbackUrl: item.link // URL 기반 이미지 추출을 위한 fallback
      };

      await thumbnailQueue.addJob({
        documentId: document.id,
        sourceType: 'rss',
        sourceData: sourceData,
        priority: 'normal'
      });

      console.log(`Added thumbnail extraction job for RSS document ${document.id}`);
    } catch (error) {
      console.error(`Failed to queue thumbnail extraction for RSS document ${document.id}:`, error);
    }

    return document.id;

  } catch (error) {
    console.error('Error converting RSS item to document:', error);
    return null;
  }
}

export async function convertRSSArticleToDocument(articleId: number): Promise<number | null> {
  try {
    const article = await storage.getRSSArticle(articleId);
    if (!article) {
      throw new Error('Article not found');
    }

    const feed = await storage.getRSSFeed(article.feedId);
    if (!feed) {
      throw new Error('Feed not found');
    }

    // 콘텐츠 정리 및 문단 구분 - HTML 구조 보존
    const content = article.content || article.description || article.title;

    // HTML에서 구조화된 요소 추출 - 통일된 파이프라인 사용
    let structuredBlocks: any[] = [];
    let paragraphs: any[] = [];

    if (content.includes('<p>') || content.includes('<div>') || content.includes('<img>') || content.includes('<table>')) {
      console.log('Processing HTML content for structured extraction');
      
      // 통일된 구조화 파이프라인 사용 (RSS HTML 콘텐츠)
      const { generateStructuredContent } = await import('./routes.js');
      structuredBlocks = await generateStructuredContent(content, 'html', feed.alias || 'RSS');
      
      // HTML 콘텐츠의 경우, 구조화된 블록만 사용하고 별도 문단/문장 생성 생략
      // 중복을 방지하기 위해 구조화된 블록 내용에서만 문장 추출
      console.log(`Generated ${structuredBlocks.length} structured blocks from HTML content`);
      
      // 구조화된 블록에서 문단과 문장을 추출하여 기존 시스템과 호환성 유지
      if (structuredBlocks && structuredBlocks.length > 0) {
        const seenSentences = new Set<string>();
        let paragraphOrder = 1;
        
        for (const block of structuredBlocks) {
          if (block.type === 'paragraph' && block.content) {
            const sentences = splitIntoSentences(block.content);
            const sentencesData = [];
            
            for (let sIndex = 0; sIndex < sentences.length; sIndex++) {
              const sentence = sentences[sIndex].trim();
              // 문장 길이와 중복 검사
              if (sentence && sentence.length > 10 && !seenSentences.has(sentence)) {
                seenSentences.add(sentence);
                sentencesData.push({
                  order: sIndex + 1,
                  source: sentence,
                });
              }
            }
            
            if (sentencesData.length > 0) {
              paragraphs.push({
                order: paragraphOrder++,
                title: null,
                sentences: sentencesData,
              });
            }
          }
        }
        console.log(`Extracted sentences from ${paragraphs.length} paragraph blocks, avoiding duplication`);
      }
    } else {
      console.log('Processing plain text content');
      // HTML이 없는 경우에만 기본 방식 사용
      const paragraphRegex = /\n\s*\n/;
      const textParagraphs = content
        .split(paragraphRegex)
        .map((p) => p.trim())
        .filter((p) => p.length > 20); // 최소 길이 필터

      console.log(`Split content into ${textParagraphs.length} paragraphs`);

      const seenSentences = new Set<string>();
      
      for (let pIndex = 0; pIndex < textParagraphs.length; pIndex++) {
        const paragraph = textParagraphs[pIndex];
          const sentences = splitIntoSentences(paragraph);
          const sentencesData = [];
          
          for (let sIndex = 0; sIndex < sentences.length; sIndex++) {
            const sentence = sentences[sIndex].trim();
            // 문장 길이와 중복 검사
            if (sentence && sentence.length > 10 && !seenSentences.has(sentence)) {
              seenSentences.add(sentence);
              sentencesData.push({
                order: sIndex + 1,
                source: sentence,
              });
            }
          }
          
          if (sentencesData.length > 0) {
            paragraphs.push({
              order: pIndex + 1,
              title: null,
        .filter((p) => p.length > 20); // 최소 길이 필터

      console.log(`Split content into ${textParagraphs.length} paragraphs`);

      const seenSentences = new Set<string>();
      
      for (let pIndex = 0; pIndex < textParagraphs.length; pIndex++) {
        const paragraph = textParagraphs[pIndex];
          const sentences = splitIntoSentences(paragraph);
          const sentencesData = [];
          
          for (let sIndex = 0; sIndex < sentences.length; sIndex++) {
            const sentence = sentences[sIndex].trim();
            // 문장 길이와 중복 검사
            if (sentence && sentence.length > 10 && !seenSentences.has(sentence)) {
              seenSentences.add(sentence);
              sentencesData.push({
                order: sIndex + 1,
                source: sentence,
              });
            }
          }
          
          if (sentencesData.length > 0) {
            paragraphs.push({
              order: pIndex + 1,
              title: null,
              sentences: sentencesData,
            });
          }
        }
      }
    }

    // 문단이 없으면 기본 처리 (마지막 fallback)
    if (paragraphs.length === 0) {
      console.log('No paragraphs extracted, using fallback');
      const fallbackSentences = splitIntoSentences(content);
      if (fallbackSentences.length > 0) {
        paragraphs.push({
          order: 1,
          title: null,
          sentences: fallbackSentences.slice(0, 5).map((sentence, idx) => ({
            order: idx + 1,
            source: sentence,
          }))
        });
      } else {
        paragraphs.push({
          order: 1,
          title: null,
          sentences: [{
            order: 1,
            source: content.substring(0, 500) // 내용이 너무 길면 자르기
          }]
        });
      }
    }

    // 콘텐츠를 문서로 변환 - 새로운 필드 추가
    const documentData = {
      title: article.title,
      sourceLanguage: feed.language || 'en',
      userId: feed.userId,
      fileType: 'rss',
      author: article.author || undefined,
      structuredContent: structuredBlocks.length > 0 ? JSON.stringify(structuredBlocks) : null,
      structuredVersion: 1, // 새로운 통일 파이프라인 버전
      contentSourceType: 'html', // RSS는 HTML 콘텐츠
      source: feed.alias && feed.alias !== 'RSS Feed' ? feed.alias : 'RSS',
      category: feed.category || 'RSS Feed',
      originalUrl: article.link,
      publishedAt: article.publishedAt || undefined, // 작성일 정보 추가
      isPublic: true, // RSS 문서는 Explore 페이지에서 공개적으로 보여짐
      paragraphs,
      feedId: feed.id, // feedId 추가
      feedAlias: feed.alias, // feedAlias 필드 추가
    };

    const document = await storage.createDocumentWithParagraphs(documentData);

    // 아티클을 처리된 것으로 표시
    await storage.markRSSArticleAsProcessed(articleId, document.id);

    // Add thumbnail extraction to queue with both RSS data and URL
    try {
      const rssData = await fetchRSSFeed(feed.feedUrl);
      const rssItem = rssData.items.find((item: any) => item.guid === article.guid);

      // First try RSS item data, but always include URL as fallback
      if (rssItem) {
        await thumbnailQueue.addJob({
          documentId: document.id,
          sourceType: 'rss',
          sourceData: {
            ...rssItem,
            fallbackUrl: article.link,
            extractedContent: content // Include the extracted content which may have images
          },
          priority: 'normal'
        });
      } else if (article.link) {
        // Fallback to URL extraction if RSS item not found
        await thumbnailQueue.addJob({
          documentId: document.id,
          sourceType: 'url',
          sourceData: { url: article.link },
          priority: 'normal'
        });
      }
    } catch (error) {
      console.error(`Failed to queue thumbnail extraction for RSS document ${document.id}:`, error);
    }

    console.log(`Converted RSS article ${articleId} to document ${document.id}`);
    return document.id;

  } catch (error) {
    console.error(`Error converting RSS article ${articleId} to document:`, error);
    return null;
  }
}

// RSS 피드 유효성 검사
export async function validateRSSFeed(feedUrl: string): Promise<{ isValid: boolean; title?: string; itemCount?: number; error?: string }> {
  try {
    const feed = await fetchRSSFeed(feedUrl);
    return {
      isValid: true,
      title: feed.title,
      itemCount: feed.items.length
    };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}