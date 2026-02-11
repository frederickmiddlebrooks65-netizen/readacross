import Parser from "rss-parser";
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";
import crypto from "crypto";
import { storage } from "./storage";
import { DocumentService } from "./services/DocumentService";
import type { RssFeed, RssArticle } from "@shared/schema";
import { thumbnailQueue } from "./thumbnailQueue";
// estimateDifficulty import removed (Guardian crawler no longer used)
// STEP 4 FIX: Use unified sentence splitting from textUtils
import { splitIntoSentences } from "./utils/textUtils";

// RSS용 토픽 태그 생성 함수
function generateTopicTags(content: string, feedTitle?: string): string[] {
  const tags = new Set<string>();

  // RSS/블로그 태그 추가
  tags.add("rss");
  tags.add("blog");

  // 피드 이름 기반 태그
  if (feedTitle) {
    const cleanTitle = feedTitle
      .toLowerCase()
      .replace(/[^\w\s]/g, "")
      .trim();
    if (cleanTitle.length > 2) {
      tags.add(cleanTitle.replace(/\s+/g, "-"));
    }
  }

  // 콘텐츠 기반 간단한 태그 생성
  const lowercaseContent = content.toLowerCase();

  // 기술 관련 키워드
  if (
    lowercaseContent.includes("technology") ||
    lowercaseContent.includes("ai") ||
    lowercaseContent.includes("software")
  ) {
    tags.add("technology");
  }

  // 정치 관련 키워드
  if (
    lowercaseContent.includes("politics") ||
    lowercaseContent.includes("election") ||
    lowercaseContent.includes("government")
  ) {
    tags.add("politics");
  }

  // 비즈니스 관련 키워드
  if (
    lowercaseContent.includes("business") ||
    lowercaseContent.includes("economy") ||
    lowercaseContent.includes("startup")
  ) {
    tags.add("business");
  }

  // 엔터테인먼트 관련 키워드
  if (
    lowercaseContent.includes("music") ||
    lowercaseContent.includes("movie") ||
    lowercaseContent.includes("entertainment")
  ) {
    tags.add("entertainment");
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
      "article p",
      "main p",
      ".content p",
      ".post-content p",
      ".entry-content p",
      "article div",
      "main div",
      ".content div",
    ];

    let paragraphElements: Element[] = [];

    // 우선순위 순서로 셀렉터 시도
    for (const selector of contentSelectors) {
      paragraphElements = Array.from(document.querySelectorAll(selector));
      if (paragraphElements.length > 0) {
        console.log(
          `Found ${paragraphElements.length} elements with selector: ${selector}`,
        );
        break;
      }
    }

    // 기본 fallback
    if (paragraphElements.length === 0) {
      paragraphElements = Array.from(document.querySelectorAll("p"));
      console.log(
        `Fallback to basic p tags: ${paragraphElements.length} elements`,
      );
    }

    const seenParagraphs = new Set<string>();
    const paragraphs: string[] = [];

    for (const el of paragraphElements) {
      const text = el.textContent?.trim() || "";

      // 더 엄격한 필터링
      if (text.length < 30) continue; // 최소 30자
      if (text.split(" ").length < 5) continue; // 최소 5단어

      // 메타데이터 및 불필요한 내용 제외
      if (
        text.match(
          /^(Posted by|Filed under|Tags:|Share:|Follow:|Subscribe:|Copyright|©|Read more|Continue reading)/i,
        )
      )
        continue;
      if (text.match(/^[\d\s\-\.\(\)]+$/)) continue; // 숫자만 포함된 텍스트
      if (text.match(/^[A-Z\s\d\.\-]{20,}$/)) continue; // 대문자로만 구성된 텍스트

      // 정규화된 텍스트로 중복 검사
      const normalizedText = text.toLowerCase().replace(/\s+/g, " ");
      if (seenParagraphs.has(normalizedText)) continue;

      seenParagraphs.add(normalizedText);
      paragraphs.push(text);
    }

    console.log(
      `Extracted ${paragraphs.length} unique paragraphs from HTML content (improved filtering)`,
    );
    return paragraphs;
  } catch (error) {
    console.error("Error extracting paragraphs from HTML:", error);
    return [];
  }
}

// STEP 4 FIX: Remove legacy sentence splitting, use unified textUtils version

// 웹 페이지에서 아티클 콘텐츠 추출
async function extractArticleContent(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; ReadAcross/1.0; +https://readacross.app)",
      },
    });

    if (!response.ok) {
      console.log(`Failed to fetch article: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // Readability를 사용하여 주요 콘텐츠 추출
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article && article.content) {
      console.log(`Extracted content from: ${url}`);
      return article.content;
    }

    return null;
  } catch (error) {
    console.error(`Error extracting content from ${url}:`, error);
    return null;
  }
}

// RSS 피드 가져오기
export async function fetchRSSFeed(feedUrl: string): Promise<any> {
  const parser = new Parser({
    timeout: 10000,
    customFields: {
      item: [
        "content",
        "content:encoded",
        "description",
        "summary",
        "media:content",
        "enclosure",
      ],
    },
  });

  try {
    const feed = await parser.parseURL(feedUrl);
    console.log(`Fetched RSS feed: ${feed.title} (${feed.items.length} items)`);
    return feed;
  } catch (error) {
    console.error(`Error fetching RSS feed ${feedUrl}:`, error);
    throw error;
  }
}

// RSS 피드의 아티클들을 처리
export async function processRSSArticles(feedId: number): Promise<void> {
  try {
    console.log(`Processing RSS articles for feed ${feedId}`);

    const feed = await storage.getRSSFeedById(feedId);
    if (!feed) {
      throw new Error("Feed not found");
    }

    // RSS 피드 가져오기
    const rssData = await fetchRSSFeed(feed.canonicalUrl);
    console.log(`Processing ${rssData.items.length} items from ${feed.title}`);

    let processedCount = 0;
    let errorCount = 0;

    // 각 아티클 처리
    for (const item of rssData.items.slice(0, 10)) {
      // 최대 10개 아티클만 처리
      try {
        // 중복 검사 (제목과 URL 기준)
        const duplicateDocument = await storage.getDocumentByTitleAndUrl(
          item.title,
          item.link,
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
          content =
            item.contentEncoded || item.description || item.summary || "";
        }

        // RSS 아티클을 직접 문서로 변환
        try {
          const documentId = await convertRSSItemToDocumentEnhanced(
            item,
            feed,
            content,
          );
          if (documentId && typeof documentId === 'number') {
            console.log(
              `Created document ${documentId} from RSS item: ${item.title}`,
            );
            processedCount++;
          } else {
            console.log(
              `Skipped RSS item: ${item.title} (paywalled or filtered)`,
            );
            // Don't increment error count for valid skips like paywalled content
          }
        } catch (conversionError) {
          console.error(
            `Failed to convert RSS item to document:`,
            conversionError,
          );
          errorCount++;
        }

        // 요청 간 딜레이 (서버 부하 방지)
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error processing article ${item.title}:`, error);
        errorCount++;
      }
    }

    // 동기화 성공 상태 업데이트
    await storage.updateNewRSSFeed(feedId, {
      lastRunAt: new Date(),
      lastStatus: errorCount > 0 ? "partial" : "success",
      errorCount: errorCount,
      lastError:
        errorCount > 0
          ? `Processed ${processedCount} articles with ${errorCount} errors`
          : null,
    });

    console.log(
      `Finished processing feed ${feedId}: ${processedCount} articles processed, ${errorCount} errors`,
    );
  } catch (error) {
    console.error(`Error processing RSS feed ${feedId}:`, error);

    // 동기화 실패 상태 업데이트
    const feed = await storage.getRSSFeedById(feedId);
    const currentErrorCount = (feed?.errorCount || 0) + 1;

    await storage.updateNewRSSFeed(feedId, {
      lastRunAt: new Date(),
      lastStatus: "failed",
      errorCount: currentErrorCount,
      lastError: error instanceof Error ? error.message : "Unknown error",
    });

    throw error;
  }
}

// 모든 활성 피드 동기화
export async function syncAllActiveFeeds(): Promise<void> {
  try {
    console.log("Starting sync of all active RSS feeds");

    const allSubscriptions = await storage.getRSSSubscriptions();
    console.log(`Found ${allSubscriptions.length} total subscriptions`);

    const activeSubscriptions = allSubscriptions.filter((sub) => sub.enabled);
    console.log(`Found ${activeSubscriptions.length} enabled subscriptions`);

    // 구독별로 피드 정보를 가져와서 동기화할 피드 목록 생성
    const feedsToSync = new Map<number, any>();

    for (const subscription of activeSubscriptions) {
      console.log(
        `Processing subscription ${subscription.id} for feed ${subscription.feedId}`,
      );
      if (!feedsToSync.has(subscription.feedId)) {
        const feed = await storage.getRSSFeedById(subscription.feedId);
        console.log(
          `Feed ${subscription.feedId}:`,
          feed ? `found, blocked=${feed.isBlocked}` : "not found",
        );
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
        // 동기화 간격 확인
        const now = new Date();
        const lastRun = feed.lastRunAt;

        // 테스트를 위해 간격 체크를 임시로 비활성화
        if (false) {
          const hoursSinceLastRun =
            (now.getTime() - lastRun.getTime()) / (1000 * 60 * 60);
          if (hoursSinceLastRun < 12) {
            // 기본 12시간 간격
            console.log(
              `Skipping feed ${feed.id} - not yet time to sync (${hoursSinceLastRun}h < 12h)`,
            );
            continue;
          }
        }

        console.log(`Syncing feed: ${feed.title} (${feed.canonicalUrl})`);
        await processRSSArticles(feed.id);

        // 피드 간 딜레이
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (error) {
        console.error(`Error syncing feed ${feed.id} (${feed.title}):`, error);
        // 개별 피드 오류는 전체 동기화를 중단하지 않음
      }
    }

    console.log("Completed sync of all active RSS feeds");
  } catch (error) {
    console.error("Error in syncAllActiveFeeds:", error);
    throw error;
  }
}

// RSS 아이템을 직접 문서로 변환하는 새로운 함수 (새로운 RSS 시스템용)
export async function convertRSSItemToDocument(
  item: any,
  feed: any,
  content: string,
): Promise<number | null> {
  try {
    console.log(`[RSS DEBUG] Converting RSS item to document: ${item.title}`);

    // 콘텐츠 정리
    const finalContent =
      content || item.description || item.summary || item.title;

    // ✅ V2 파이프라인 사용: RSS 문서 생성 시 앵커와 구조화된 콘텐츠를 한 번에 처리
    console.log(`[RSS V2] 🔧 Using V2 pipeline for RSS document creation with rss_html contentType`);
    console.log(`[RSS V2] 🔧 Content length: ${finalContent.length} chars`);

    const document = await DocumentService.createDocumentWithPSAndStructureV2({
      title: item.title || "Untitled RSS Article",
      sourceLanguage: "en" as const,
      targetLanguage: "ko" as const,
      content: finalContent,
      contentType: "html", // 🔧 CRITICAL FIX: Use html to match ParserMode.HTML in DocumentService
      source: feed.title || feed.alias || "RSS",
      author: item.creator || item.author || null,
      category: "News",
      originalUrl: item.link || null,
      isPublic: true,
      feedId: feed.feedId || undefined,
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
    });

    console.log(`✅ RSS Document created successfully with V2 pipeline: ${document.id}`);

    // ✅ V2 성공 시 즉시 반환 - 레거시 경로 완전 차단
    if (document && document.id) {
      // 썸네일 추출 작업을 큐에 추가
      try {
        const sourceData = {
          ...item,
          extractedContent: finalContent,
          fallbackUrl: item.link,
        };

        await thumbnailQueue.addJob({
          documentId: document.id,
          sourceType: "rss",
          sourceData: sourceData,
          priority: "normal",
        });

        console.log(`Added thumbnail extraction job for RSS document ${document.id}`);
      } catch (error) {
        console.error(`Failed to queue thumbnail extraction for RSS document ${document.id}:`, error);
      }

      return document.id;
    }

    // V2 실패 시 에러 발생 (레거시 폴백 제거)
    throw new Error('[RSS V2] Document creation failed - V2 pipeline is required');
  } catch (error) {
    console.error("Error converting RSS item to document:", error);
    // STEP 4 FIX: V2 pipeline should not return null, log error and continue processing
    // Instead of returning null which breaks downstream processing,
    // we continue the RSS feed processing without this article
    return null; // Keep null for now, but ensure calling code handles it gracefully
  }
}

export async function convertRSSArticleToDocument(
  articleId: number,
): Promise<number | null> {
  try {
    const article = await storage.getRSSArticle(articleId);
    if (!article) {
      throw new Error("Article not found");
    }

    const feed = await storage.getRSSFeed(article.feedId);
    if (!feed) {
      throw new Error("Feed not found");
    }

    // 콘텐츠 정리
    const content = article.content || article.description || article.title;

    // ✅ Phase 1 Implementation: Use lightweight Explore document creation
    console.log(`[RSS Phase1] Using lightweight Explore pipeline for RSS document creation`);

    const document = await DocumentService.createExploreDocument({
      title: article.title,
      content: content,
      sourceLanguage: "en" as const,
      targetLanguage: "ko" as const,
      source: feed.alias || "RSS",
      contentType: "rss_html", // Specific content type for RSS
      author: article.author || undefined,
      category: "RSS Feed",
      originalUrl: article.link,
      isPublic: true,
      feedId: feed.feedId || undefined,
      publishedAt: article.publishedAt || undefined,
    });

    console.log(`✅ RSS Document created successfully with V2 pipeline: ${document.id}`);

    // ✅ V2 성공 시 즉시 반환 - 레거시 경로 완전 차단
    if (document && document.id) {
      // Add thumbnail extraction to queue
      try {
        // Get feed URL from feed data if available
        const feedData = await storage.getRSSFeedById(feed.feedId);
        if (!feedData) {
          throw new Error("Feed data not found");
        }
        const rssData = await fetchRSSFeed(feedData.canonicalUrl);
        const rssItem = rssData.items.find(
          (item: any) => item.guid === article.guid,
        );

        if (rssItem) {
          await thumbnailQueue.addJob({
            documentId: document.id,
            sourceType: "rss",
            sourceData: {
              ...rssItem,
              fallbackUrl: article.link,
              extractedContent: content,
            },
            priority: "normal",
          });
        } else if (article.link) {
          await thumbnailQueue.addJob({
            documentId: document.id,
            sourceType: "url",
            sourceData: { url: article.link },
            priority: "normal",
          });
        }
      } catch (error) {
        console.error(
          `Failed to queue thumbnail extraction for RSS document ${document.id}:`,
          error,
        );
      }

      console.log(
        `Converted RSS article ${articleId} to document ${document.id}`,
      );
      return document.id;
    }

    // V2 실패 시 에러 발생 (레거시 폴백 제거)
    throw new Error('[RSS V2] Document creation failed - V2 pipeline is required');
  } catch (error) {
    console.error("Error converting RSS article to document:", error);
    return null;
  }
}

// RSS 피드 유효성 검사
export async function validateRSSFeed(
  feedUrl: string,
): Promise<{
  isValid: boolean;
  title?: string;
  itemCount?: number;
  error?: string;
}> {
  try {
    const feed = await fetchRSSFeed(feedUrl);
    return {
      isValid: true,
      title: feed.title,
      itemCount: feed.items.length,
    };
  } catch (error) {
    return {
      isValid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

// =============================================================================
// NEW SOURCE INTEGRATIONS - Based on instructions.md
// =============================================================================

/**
 * Initialize new sources RSS feeds in the unified RSS system
 * Based on instructions.md requirements
 */
export async function initializeNewSources(): Promise<void> {
  console.log("[NEW_SOURCES] Initializing new source feeds in unified RSS system");
  
  const sources = [
    {
      url: "https://aeon.co/feed",
      title: "Aeon Essays",
      description: "Essays on philosophy, science, society and culture",
      category: "Essays",
    },
    {
      url: "https://www.technologyreview.com/feed/",
      title: "MIT Technology Review", 
      description: "Latest technology news and analysis",
      category: "Technology",
    },
    {
      url: "https://theconversation.com/global/articles.atom",
      title: "The Conversation",
      description: "Academic insights and expert analysis", 
      category: "Academic",
    },
    {
      url: "https://nautil.us/feed/",
      title: "Nautilus",
      description: "Science, culture and philosophy magazine",
      category: "Science",
    },
  ];
  
  for (const source of sources) {
    try {
      // Check if feed already exists
      const existingFeeds = await storage.getAllRSSFeeds();
      const existingFeed = existingFeeds.find(feed => 
        feed.canonicalUrl === source.url
      );
      
      if (existingFeed) {
        console.log(`[NEW_SOURCES] Feed already exists: ${source.title}`);
        continue;
      }
      
      // Create new RSS feed in unified system
      const { normalizeUrl, generateUrlHash } = await import("./utils/urlUtils.js");
      const normalizedUrl = normalizeUrl(source.url);
      const urlHash = generateUrlHash(normalizedUrl);
      
      const newFeed = await storage.createNewRSSFeed({
        canonicalUrl: source.url,
        normalizedUrlHash: urlHash,
        title: source.title,
        description: source.description,
        language: "en",
        category: source.category,
        etag: null,
        lastModified: null,
        healthScore: 100,
        lastRunAt: null,
        lastStatus: "pending",
        errorCount: 0,
        lastError: null,
        isBlocked: false,
        isSystemSource: true,
      });
      
      console.log(`[NEW_SOURCES] Created RSS feed: ${source.title} (ID: ${newFeed.id})`);
      
    } catch (error) {
      console.error(`[NEW_SOURCES] Error creating feed ${source.title}:`, error);
    }
  }
}

/**
 * Enhanced RSS item processing with source-specific logic
 * Based on instructions.md requirements
 */
export async function convertRSSItemToDocumentEnhanced(
  item: any,
  feed: any,
  content: string,
): Promise<number | null> {
  try {
    console.log(`[RSS_ENHANCED] Converting item: ${item.title} from ${feed.title}`);
    
    // Source-specific validation and processing
    if (feed.title?.includes("MIT Technology Review")) {
      // MIT Technology Review: Check for paywall
      if (await isPaywalledContent(item, content)) {
        console.log(`[MIT_TR] Skipping paywalled article: ${item.title}`);
        return null;
      }
    }
    
    // Extract and enhance tags based on source
    const tags = extractAndEnhanceTags(item, feed, content);
    
    // Use V2 pipeline for document creation
    const document = await DocumentService.createDocumentWithPSAndStructureV2({
      title: item.title || "Untitled Article",
      sourceLanguage: "en" as const,
      targetLanguage: "ko" as const,
      content: content,
      contentType: "html",
      source: feed.title || "RSS",
      author: item.creator || item.author || null,
      category: getCategoryBySource(feed.title),
      originalUrl: item.link || null,
      isPublic: true,
      feedId: feed.id,
      publishedAt: item.pubDate ? new Date(item.pubDate) : undefined,
    });
    
    if (document?.id) {
      // Add tags separately after document creation
      await storage.updateDocument(document.id, {
        tags: JSON.stringify(tags),
      });
      
      // Add thumbnail extraction job
      await thumbnailQueue.addJob({
        documentId: document.id,
        sourceType: "rss",
        sourceData: {
          ...item,
          extractedContent: content,
          fallbackUrl: item.link,
        },
        priority: "normal",
      });
      
      console.log(`[RSS_ENHANCED] Created document ${document.id}: ${item.title}`);
      return document.id;
    }
    
    return null;
  } catch (error) {
    console.error("[RSS_ENHANCED] Error converting RSS item:", error);
    return null;
  }
}

/**
 * MIT Technology Review paywall detection
 * Based on instructions.md: "Exclude any articles marked as paywalled (subscriber-only)"
 */
async function isPaywalledContent(item: any, content: string): Promise<boolean> {
  try {
    // Check RSS item for paywall indicators
    const title = item.title?.toLowerCase() || "";
    const description = item.description?.toLowerCase() || "";
    const summary = item.summary?.toLowerCase() || "";
    
    // Common paywall indicators in RSS feeds
    const paywallIndicators = [
      "subscriber",
      "premium",
      "paywall", 
      "subscription required",
      "paid content",
      "member only",
      "exclusive"
    ];
    
    for (const indicator of paywallIndicators) {
      if (title.includes(indicator) || description.includes(indicator) || summary.includes(indicator)) {
        return true;
      }
    }
    
    // Check content for paywall markers
    if (content) {
      const lowercaseContent = content.toLowerCase();
      const contentPaywallMarkers = [
        "this content is for subscribers",
        "become a subscriber",
        "subscribe to continue reading",
        "premium content",
        "subscriber-only",
        "paywall"
      ];
      
      for (const marker of contentPaywallMarkers) {
        if (lowercaseContent.includes(marker)) {
          return true;
        }
      }
    }
    
    return false;
  } catch (error) {
    console.error("[PAYWALL_CHECK] Error checking paywall status:", error);
    // Default to false to avoid blocking legitimate content
    return false;
  }
}

/**
 * Extract and enhance tags from RSS items and content
 * Prioritizes source metadata over heuristics
 */
function extractAndEnhanceTags(item: any, feed: any, content: string): string[] {
  const tags = new Set<string>();
  
  // Add source-specific base tags
  const sourceTitle = feed.title?.toLowerCase() || "";
  
  if (sourceTitle.includes("aeon")) {
    tags.add("aeon");
    tags.add("essays");
  } else if (sourceTitle.includes("mit technology")) {
    tags.add("mit-technology-review");
    tags.add("technology");
  } else if (sourceTitle.includes("conversation")) {
    tags.add("the-conversation");
    tags.add("academic");
  } else if (sourceTitle.includes("nautilus")) {
    tags.add("nautilus");
    tags.add("science");
  }
  
  // Extract tags from RSS categories (prioritize official metadata)
  if (item.categories && Array.isArray(item.categories)) {
    item.categories.forEach((category: string) => {
      const cleanCategory = category.toLowerCase().replace(/[^\w\s]/g, "").trim();
      if (cleanCategory.length > 2) {
        tags.add(cleanCategory.replace(/\s+/g, "-"));
      }
    });
  }
  
  // Content-based enhancement (supplement, don't replace)
  if (content) {
    const lowercaseContent = content.toLowerCase();
    
    // Technology
    if (lowercaseContent.includes("artificial intelligence") || lowercaseContent.includes("ai")) {
      tags.add("artificial-intelligence");
    }
    if (lowercaseContent.includes("machine learning") || lowercaseContent.includes("ml")) {
      tags.add("machine-learning");
    }
    
    // Science
    if (lowercaseContent.includes("research") || lowercaseContent.includes("study")) {
      tags.add("research");
    }
    if (lowercaseContent.includes("climate") || lowercaseContent.includes("environment")) {
      tags.add("climate");
    }
    
    // Philosophy & Society  
    if (lowercaseContent.includes("philosophy") || lowercaseContent.includes("ethics")) {
      tags.add("philosophy");
    }
    if (lowercaseContent.includes("society") || lowercaseContent.includes("culture")) {
      tags.add("society");
    }
  }
  
  return Array.from(tags);
}

/**
 * Get category based on source
 */
function getCategoryBySource(sourceTitle: string): string {
  const title = sourceTitle?.toLowerCase() || "";
  
  // Academic: 학술 논문, 학회 발표 자료, 리서치 리포트
  if (title.includes("conversation")) return "Academic";
  
  // Literature: 문학 작품, 에세이, 비평, 서사적 글쓰기  
  // (Currently no RSS sources for Literature)
  
  // News: 뉴스 기사, 저널리즘 기반 콘텐츠
  if (title.includes("mit technology") || title.includes("nautilus") || title.includes("wired")) return "News";
  
  // Essays: 블로그 글, 칼럼, 개인 저널, 오피니언 피스
  if (title.includes("aeon")) return "Essays";
  
  return "Essays"; // Default for RSS feeds (mostly blog/opinion content)
}

// 기존 RSS 문서들의 앵커 정보 재생성 함수
export async function regenerateAnchorsForRSSDocuments(): Promise<void> {
  try {
    console.log(
      "[REGENERATE ANCHORS] Starting anchor regeneration for existing RSS documents",
    );

    // 앵커 정보가 없거나 부족한 RSS 문서들 찾기
    const allDocuments = await storage.getAllDocuments();
    const rssDocuments = allDocuments.filter(
      (doc) =>
        (doc.source === "NPR" || doc.feedId || doc.sourceType === "explore") &&
        doc.structuredContent &&
        (doc.structuredVersion ?? 0) >= 2,
    );

    console.log(
      `[REGENERATE ANCHORS] Found ${rssDocuments.length} RSS documents to check`,
    );

    let processedCount = 0;
    let updatedCount = 0;

    for (const document of rssDocuments) {
      try {
        console.log(
          `[REGENERATE ANCHORS] Checking document ${document.id}: ${document.title}`,
        );

        let structuredContent: any[] = [];
        try {
          if (typeof document.structuredContent === 'string') {
            const parsedContent = JSON.parse(document.structuredContent || "[]");
            structuredContent = Array.isArray(parsedContent) ? parsedContent : [];
          } else if (Array.isArray(document.structuredContent)) {
            structuredContent = document.structuredContent;
          } else {
            structuredContent = [];
          }
        } catch (error) {
          console.warn(
            `[REGENERATE ANCHORS] Failed to parse structured content for document ${document.id}`,
          );
          continue;
        }

        // 앵커가 없는 블록들 확인
        const paragraphBlocks = structuredContent.filter(
          (block) => block.type === "paragraph",
        );
        const blocksWithoutAnchors = paragraphBlocks.filter(
          (block) => !block.anchor,
        );

        if (blocksWithoutAnchors.length === 0) {
          console.log(
            `[REGENERATE ANCHORS] Document ${document.id} already has all anchors - skipping`,
          );
          processedCount++;
          continue;
        }

        console.log(
          `[REGENERATE ANCHORS] Document ${document.id} has ${blocksWithoutAnchors.length}/${paragraphBlocks.length} blocks without anchors`,
        );

        // 문서의 문장 데이터 가져오기
        const documentWithSentences = await storage.getDocumentWithParagraphs(
          document.id,
        );

        if (
          !documentWithSentences ||
          !documentWithSentences.paragraphs ||
          documentWithSentences.paragraphs.length === 0
        ) {
          console.warn(
            `[REGENERATE ANCHORS] Document ${document.id} has no sentence data - skipping`,
          );
          processedCount++;
          continue;
        }

        const totalSentences = documentWithSentences.paragraphs.reduce(
          (total: number, p: any) =>
            total + (p.sentences ? p.sentences.length : 0),
          0,
        );

        if (totalSentences === 0) {
          console.warn(
            `[REGENERATE ANCHORS] Document ${document.id} has no sentences - skipping`,
          );
          processedCount++;
          continue;
        }

        console.log(
          `[REGENERATE ANCHORS] Document ${document.id} has ${totalSentences} sentences available for anchor mapping`,
        );

        // 앵커 재생성
        try {
          const anchorUtilsModule = await import("./utils/anchorUtils.js");

          if (anchorUtilsModule.attachAnchorsToStructuredContent && typeof anchorUtilsModule.attachAnchorsToStructuredContent === 'function') {
            const finalStructuredContent = await anchorUtilsModule.attachAnchorsToStructuredContent(
              structuredContent,
              documentWithSentences,
            );

            const newAnchoredCount = finalStructuredContent.filter(
              (b: any) => b.anchor,
            ).length;
          const oldAnchoredCount = structuredContent.filter(
            (b: any) => b.anchor,
          ).length;

          if (newAnchoredCount > oldAnchoredCount) {
            // 문서 업데이트
            await storage.updateDocument(document.id, {
              structuredContent: JSON.stringify(finalStructuredContent),
            });

            console.log(
              `[REGENERATE ANCHORS] ✅ Updated document ${document.id} - anchors: ${oldAnchoredCount} -> ${newAnchoredCount}`,
            );
            updatedCount++;
          } else {
            console.log(
              `[REGENERATE ANCHORS] No improvement for document ${document.id} - anchors: ${newAnchoredCount}`,
            );
          }
          } else {
            console.warn(`[REGENERATE ANCHORS] attachAnchorsToStructuredContent function not found in utils module`);
          }
        } catch (error) {
          console.error(`[REGENERATE ANCHORS] Error importing anchor utils:`, error);
        }

        processedCount++;

        // 요청 간 딜레이 (서버 부하 방지)
        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (error) {
        console.error(
          `[REGENERATE ANCHORS] Error processing document ${document.id}:`,
          error,
        );
        processedCount++;
      }
    }

    console.log(
      `[REGENERATE ANCHORS] ✅ Completed: ${processedCount} documents processed, ${updatedCount} updated`,
    );
  } catch (error) {
    console.error(
      "[REGENERATE ANCHORS] Error in regenerateAnchorsForRSSDocuments:",
      error,
    );
    throw error;
  }
}