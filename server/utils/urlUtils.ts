import { createHash } from 'crypto';
import { JSDOM } from "jsdom";
import { Readability } from "@mozilla/readability";

/**
 * URL 정규화 함수 - 중복 피드 검사를 위한 canonical URL 생성
 * 프로토콜, www 제거, trailing slash 정리, 쿼리 파라미터 정렬
 */
export function normalizeUrl(url: string): string {
  try {
    const parsedUrl = new URL(url);
    
    // 프로토콜을 http로 통일 (https와 http는 같은 것으로 취급)
    parsedUrl.protocol = 'http:';
    
    // www. 제거
    if (parsedUrl.hostname.startsWith('www.')) {
      parsedUrl.hostname = parsedUrl.hostname.substring(4);
    }
    
    // 호스트명을 소문자로 변환
    parsedUrl.hostname = parsedUrl.hostname.toLowerCase();
    
    // 기본 포트 제거
    if (parsedUrl.port === '80' || parsedUrl.port === '443') {
      parsedUrl.port = '';
    }
    
    // trailing slash 제거 (루트가 아닌 경우)
    if (parsedUrl.pathname !== '/' && parsedUrl.pathname.endsWith('/')) {
      parsedUrl.pathname = parsedUrl.pathname.slice(0, -1);
    }
    
    // 쿼리 파라미터 정렬
    if (parsedUrl.searchParams.size > 0) {
      const sortedParams = Array.from(parsedUrl.searchParams.entries())
        .sort(([a], [b]) => a.localeCompare(b));
      parsedUrl.search = '';
      sortedParams.forEach(([key, value]) => {
        parsedUrl.searchParams.append(key, value);
      });
    }
    
    // fragment 제거 (RSS URL에서는 보통 불필요)
    parsedUrl.hash = '';
    
    return parsedUrl.toString();
  } catch (error) {
    // 잘못된 URL인 경우 원본 반환
    return url;
  }
}

/**
 * 정규화된 URL에서 해시 생성 - 중복 검사용
 */
export function generateUrlHash(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex');
}

/**
 * Feed URL에서 메타데이터 추출
 */
export function extractFeedMetadata(url: string): { domain: string; path: string; isSecure: boolean } {
  try {
    const parsedUrl = new URL(url);
    return {
      domain: parsedUrl.hostname,
      path: parsedUrl.pathname,
      isSecure: parsedUrl.protocol === 'https:'
    };
  } catch (error) {
    return {
      domain: 'unknown',
      path: '/',
      isSecure: false
    };
  }
}

/**
 * 중복 URL 검사를 위한 후보 URL 생성
 * 다양한 변형을 생성하여 중복을 감지
 */
export function generateUrlCandidates(originalUrl: string): string[] {
  const candidates = new Set<string>();
  
  try {
    const baseUrl = new URL(originalUrl);
    
    // 원본 정규화
    candidates.add(normalizeUrl(originalUrl));
    
    // HTTP/HTTPS 변형
    baseUrl.protocol = 'http:';
    candidates.add(normalizeUrl(baseUrl.toString()));
    baseUrl.protocol = 'https:';
    candidates.add(normalizeUrl(baseUrl.toString()));
    
    // www 변형
    const hostname = baseUrl.hostname;
    if (hostname.startsWith('www.')) {
      baseUrl.hostname = hostname.substring(4);
    } else {
      baseUrl.hostname = 'www.' + hostname;
    }
    candidates.add(normalizeUrl(baseUrl.toString()));
    
    // trailing slash 변형
    const path = baseUrl.pathname;
    if (path.endsWith('/') && path !== '/') {
      baseUrl.pathname = path.slice(0, -1);
    } else if (!path.endsWith('/')) {
      baseUrl.pathname = path + '/';
    }
    candidates.add(normalizeUrl(baseUrl.toString()));
    
  } catch (error) {
    // 잘못된 URL인 경우 원본만 추가
    candidates.add(originalUrl);
  }
  
  return Array.from(candidates);
}

/**
 * URL 유효성 검사
 */
export function isValidFeedUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    return ['http:', 'https:'].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}

/**
 * Validate URL format and scheme for web content
 */
export function validateUrl(url: string): { isValid: boolean; error?: string } {
  try {
    const parsedUrl = new URL(url);
    
    // Check for supported schemes
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { isValid: false, error: 'URL은 http 또는 https로 시작해야 합니다' };
    }
    
    // Check URL length
    if (url.length > 2000) {
      return { isValid: false, error: 'URL이 너무 깁니다 (최대 2000자)' };
    }
    
    // Check for blocked domains (basic security)
    const hostname = parsedUrl.hostname.toLowerCase();
    const blockedDomains = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    if (blockedDomains.some(domain => hostname.includes(domain))) {
      return { isValid: false, error: '로컬 주소는 지원되지 않습니다' };
    }
    
    return { isValid: true };
  } catch (error) {
    return { isValid: false, error: '올바른 URL 형식이 아닙니다' };
  }
}

/**
 * Fetch HTML content from URL with timeout and error handling
 */
export async function fetchHtml(url: string): Promise<string> {
  const timeoutMs = 10000; // 10 seconds timeout
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    console.log(`Fetching HTML from: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'ReadAcross/1.0 (Educational Language Learning Platform)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const html = await response.text();
    console.log(`Successfully fetched ${html.length} characters of HTML`);
    
    return html;
  } catch (error) {
    clearTimeout(timeoutId);
    
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error('요청 시간이 초과되었습니다 (10초)');
    }
    
    console.error(`Error fetching HTML from ${url}:`, error);
    throw error instanceof Error ? error : new Error('알 수 없는 오류가 발생했습니다');
  }
}

/**
 * Extract main article content using Readability
 */
export function extractArticle(html: string, sourceUrl?: string): { 
  content: string; 
  title?: string; 
  excerpt?: string; 
  byline?: string;
  siteName?: string;
} {
  try {
    console.log(`Extracting article content using Readability`);
    
    const dom = new JSDOM(html, { url: sourceUrl || "https://example.com" });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();
    
    if (!article || !article.content) {
      throw new Error('Readability failed to extract content');
    }
    
    console.log(`✅ Readability extracted ${article.content.length} chars of clean content`);
    
    return {
      content: article.content,
      title: article.title || undefined,
      excerpt: article.excerpt || undefined,
      byline: article.byline || undefined,
      siteName: article.siteName || undefined,
    };
  } catch (error) {
    console.error('Readability extraction failed:', error);
    throw new Error('페이지에서 메인 콘텐츠를 추출할 수 없습니다');
  }
}

/**
 * Extract metadata from HTML document
 */
export function extractMetadata(html: string): {
  title?: string;
  description?: string;
  ogImage?: string;
  publishedTime?: string;
  author?: string;
  siteName?: string;
  language?: string;
} {
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // Helper function to get meta content
    const getMeta = (property: string): string | undefined => {
      const element = document.querySelector(`meta[property="${property}"], meta[name="${property}"]`);
      return element?.getAttribute('content') || undefined;
    };
    
    return {
      title: getMeta('og:title') || document.querySelector('title')?.textContent || undefined,
      description: getMeta('og:description') || getMeta('description') || undefined,
      ogImage: getMeta('og:image') || undefined,
      publishedTime: getMeta('article:published_time') || getMeta('published_time') || undefined,
      author: getMeta('author') || getMeta('article:author') || undefined,
      siteName: getMeta('og:site_name') || undefined,
      language: document.documentElement.lang || getMeta('language') || undefined,
    };
  } catch (error) {
    console.error('Error extracting metadata:', error);
    return {};
  }
}
export async function extractContentFromUrl(url: string): Promise<{
  title: string;
  author?: string;
  source?: string;
  content: string;
}> {
  try {
    // Validate URL
    const urlObj = new URL(url);
    if (!['http:', 'https:'].includes(urlObj.protocol)) {
      throw new Error("Only HTTP and HTTPS URLs are supported");
    }

    // Fetch HTML content with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ReadAcross/1.0)',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();

    // Extract content using Readability-like approach
    const { extractArticleContent } = await import('../utils/htmlParser.js');
    const extractedContent = extractArticleContent(html, url);

    return {
      title: extractedContent.title || urlObj.hostname,
      author: extractedContent.author,
      source: urlObj.hostname,
      content: extractedContent.content
    };

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error("Request timeout - the URL took too long to respond");
    }
    throw error;
  }
}
