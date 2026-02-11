export function extractMeaningfulSnippet(content: string | undefined | null, title: string): string {
  if (!content || typeof content !== 'string') {
    return '';
  }

  const extractKeywords = (text: string): string[] => {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'must', 'shall', 'can', 'need', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between', 'under', 'again', 'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and', 'but', 'if', 'or', 'because', 'until', 'while', 'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom', 'it', 'its']);
    
    const words = text.toLowerCase()
      .replace(/[^\w\s가-힣]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length >= 2 && !stopWords.has(word));
    
    return words.slice(0, 3);
  };

  const isTOCSentence = (sentence: string): boolean => {
    if (sentence.length < 30) return true;
    if (/\d+$/.test(sentence.trim())) return true;
    if (/\.{2,}/.test(sentence)) return true;
    if (sentence.split(/[.!?]/).length <= 1 && sentence.length < 60) return true;
    if (/^(chapter|section|part|table of contents|contents|index)\s/i.test(sentence.trim())) return true;
    if (/^\d+[\.\)]\s/.test(sentence.trim())) return true;
    return false;
  };

  const splitIntoSentences = (text: string): string[] => {
    return text
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  };

  const sentences = splitIntoSentences(content);
  const keywords = extractKeywords(title);
  
  if (sentences.length === 0) {
    return '';
  }

  interface ScoredSentence {
    sentence: string;
    index: number;
    score: number;
  }

  const scoredSentences: ScoredSentence[] = sentences
    .slice(1, 25)
    .map((sentence, idx) => {
      const actualIndex = idx + 1;
      
      if (isTOCSentence(sentence)) {
        return { sentence, index: actualIndex, score: -1 };
      }

      let score = 0;
      
      const lowerSentence = sentence.toLowerCase();
      keywords.forEach(keyword => {
        if (lowerSentence.includes(keyword.toLowerCase())) {
          score += 10;
        }
      });

      if (actualIndex >= 2 && actualIndex <= 20) {
        score += 5;
      }

      if (sentence.length >= 60 && sentence.length <= 200) {
        score += 3;
      }

      if (/[.!?]$/.test(sentence)) {
        score += 2;
      }

      return { sentence, index: actualIndex, score };
    })
    .filter(item => item.score >= 0);

  scoredSentences.sort((a, b) => b.score - a.score);

  if (scoredSentences.length > 0 && scoredSentences[0].score > 0) {
    return scoredSentences[0].sentence;
  }

  const fallback = sentences.find((s, idx) => idx > 0 && s.length >= 60 && !isTOCSentence(s));
  if (fallback) {
    return fallback;
  }

  const firstValidSentence = sentences.find((s, idx) => idx > 0 && !isTOCSentence(s));
  return firstValidSentence || sentences[0] || '';
}

export function truncateSnippet(snippet: string, maxLength: number = 150): string {
  if (!snippet || snippet.length <= maxLength) {
    return snippet || '';
  }
  
  const truncated = snippet.slice(0, maxLength);
  const lastSpace = truncated.lastIndexOf(' ');
  
  if (lastSpace > maxLength * 0.7) {
    return truncated.slice(0, lastSpace) + '...';
  }
  
  return truncated + '...';
}

export function extractRandomSnippet(content: string | undefined | null, title: string, documentId?: string | number): string {
  if (!content || typeof content !== 'string') {
    return '';
  }

  const lowerTitle = title.toLowerCase();
  
  const isTOCOrHeaderContent = (sentence: string): boolean => {
    const lower = sentence.toLowerCase();
    if (sentence.length < 40) return true;
    if (/\d+$/.test(sentence.trim())) return true;
    if (/\.{2,}/.test(sentence)) return true;
    if (sentence.split(/[.!?]/).length <= 1 && sentence.length < 80) return true;
    if (/^(chapter|section|part|table of contents|contents|index|act|scene|prologue|epilogue|preface|introduction)\s/i.test(sentence.trim())) return true;
    if (/^\d+[\.\)]\s/.test(sentence.trim())) return true;
    if (/^[A-Z\s]+$/.test(sentence.trim()) && sentence.length < 60) return true;
    if (lower.includes('table of contents') || lower.includes('contents')) return true;
    const titleWords = lowerTitle.split(/\s+/).filter(w => w.length > 3);
    const matchingWords = titleWords.filter(w => lower.includes(w));
    if (matchingWords.length >= 2 && sentence.length < 150) return true;
    return false;
  };

  const isGoodQuote = (sentence: string): boolean => {
    if (sentence.length < 40 || sentence.length > 400) return false;
    if (isTOCOrHeaderContent(sentence)) return false;
    if (!/[.!?,;:]$/.test(sentence)) return false;
    const wordCount = sentence.split(/\s+/).length;
    if (wordCount < 6) return false;
    return true;
  };

  const splitIntoSentences = (text: string): string[] => {
    return text
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .split(/(?<=[.!?])\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  };

  const sentences = splitIntoSentences(content);
  
  const startIndex = Math.min(20, Math.floor(sentences.length * 0.1));
  const endIndex = Math.min(sentences.length, Math.max(150, Math.floor(sentences.length * 0.5)));
  
  const goodSentences = sentences
    .slice(startIndex, endIndex)
    .filter(isGoodQuote);

  if (goodSentences.length === 0) {
    const fallbackSentences = sentences
      .slice(15, Math.min(sentences.length, 300))
      .filter(s => s.length >= 30 && s.length <= 500 && s.split(/\s+/).length >= 5);
    
    if (fallbackSentences.length > 0) {
      const seed = documentId ? 
        (typeof documentId === 'string' ? documentId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) : documentId) : 
        Date.now();
      return fallbackSentences[Math.abs(seed) % fallbackSentences.length];
    }
    return extractMeaningfulSnippet(content, title);
  }

  const seed = documentId ? 
    (typeof documentId === 'string' ? documentId.split('').reduce((a, c) => a + c.charCodeAt(0), 0) : documentId) : 
    Date.now();
  const randomIndex = Math.abs(seed) % goodSentences.length;
  
  return goodSentences[randomIndex];
}
