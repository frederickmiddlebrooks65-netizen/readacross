
export function extractArticleContent(html: string, url: string): {
  title: string;
  author?: string;
  content: string;
} {
  // Simple HTML parsing without external dependencies
  // Extract title from <title> tag or Open Graph
  let title = '';
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    title = titleMatch[1].trim();
  }

  // Try to get better title from Open Graph
  const ogTitleMatch = html.match(/<meta[^>]*property=['"](og:title|twitter:title)['"][^>]*content=['"]([^'"]+)['"]/i);
  if (ogTitleMatch) {
    title = ogTitleMatch[2].trim();
  }

  // Extract author
  let author = '';
  const authorMatch = html.match(/<meta[^>]*name=['"]author['"][^>]*content=['"]([^'"]+)['"]/i);
  if (authorMatch) {
    author = authorMatch[1].trim();
  }

  // Extract main content
  let content = '';
  
  // Remove script and style tags
  const cleanHtml = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

  // Try to find main content areas
  const contentSelectors = [
    /<article[^>]*>([\s\S]*?)<\/article>/gi,
    /<main[^>]*>([\s\S]*?)<\/main>/gi,
    /<div[^>]*class=['"][^'"]*content[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi,
    /<div[^>]*class=['"][^'"]*article[^'"]*['"][^>]*>([\s\S]*?)<\/div>/gi,
  ];

  for (const selector of contentSelectors) {
    const matches = cleanHtml.match(selector);
    if (matches && matches.length > 0) {
      content = matches[0];
      break;
    }
  }

  // If no specific content area found, extract all paragraph text
  if (!content) {
    const paragraphs = cleanHtml.match(/<p[^>]*>[\s\S]*?<\/p>/gi) || [];
    content = paragraphs.join('\n\n');
  }

  // Clean up HTML tags and decode entities
  content = content
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

  return {
    title: title || 'Untitled',
    author: author || undefined,
    content: content
  };
}
