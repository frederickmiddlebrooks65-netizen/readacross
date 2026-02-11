
import { SentenceWithUserData } from "./types.d";

export interface ExportOptions {
  format: 'markdown' | 'csv' | 'json' | 'txt';
  includeTranslations?: boolean;
  includeNotes?: boolean;
  includeTags?: boolean;
}

export function exportSentences(sentences: SentenceWithUserData[], options: ExportOptions): string {
  switch (options.format) {
    case 'markdown':
      return exportToMarkdown(sentences, options);
    case 'csv':
      return exportToCSV(sentences, options);
    case 'json':
      return exportToJSON(sentences, options);
    case 'txt':
      return exportToTXT(sentences, options);
    default:
      throw new Error(`Unsupported format: ${options.format}`);
  }
}

function exportToMarkdown(sentences: SentenceWithUserData[], options: ExportOptions): string {
  let output = '# My Sentences Export\n\n';
  
  sentences.forEach((sentence, index) => {
    output += `## ${index + 1}. ${sentence.source}\n\n`;
    
    if (options.includeTranslations && sentence.target) {
      output += `**Translation:** ${sentence.target}\n\n`;
    }
    
    if (sentence.userTranslation) {
      output += `**My Translation:** ${sentence.userTranslation}\n\n`;
    }
    
    if (options.includeNotes && sentence.noteContent) {
      output += `**Notes:** ${sentence.noteContent}\n\n`;
    }
    
    if (options.includeTags && sentence.tags) {
      const tags = JSON.parse(sentence.tags);
      output += `**Tags:** ${tags.map((tag: string) => `#${tag}`).join(', ')}\n\n`;
    }
    
    output += '---\n\n';
  });
  
  return output;
}

function exportToCSV(sentences: SentenceWithUserData[], options: ExportOptions): string {
  const headers = ['Original'];
  if (options.includeTranslations) headers.push('Translation');
  headers.push('My Translation');
  if (options.includeNotes) headers.push('Notes');
  if (options.includeTags) headers.push('Tags');
  
  let csv = headers.join(',') + '\n';
  
  sentences.forEach(sentence => {
    const row = [
      `"${sentence.source.replace(/"/g, '""')}"`,
    ];
    
    if (options.includeTranslations) {
      row.push(`"${(sentence.target || '').replace(/"/g, '""')}"`);
    }
    
    row.push(`"${(sentence.userTranslation || '').replace(/"/g, '""')}"`);
    
    if (options.includeNotes) {
      row.push(`"${(sentence.noteContent || '').replace(/"/g, '""')}"`);
    }
    
    if (options.includeTags) {
      const tags = sentence.tags ? JSON.parse(sentence.tags).join(', ') : '';
      row.push(`"${tags}"`);
    }
    
    csv += row.join(',') + '\n';
  });
  
  return csv;
}

function exportToJSON(sentences: SentenceWithUserData[], options: ExportOptions): string {
  const exportData = sentences.map(sentence => {
    const data: any = {
      original: sentence.source,
      myTranslation: sentence.userTranslation || null,
    };
    
    if (options.includeTranslations) {
      data.translation = sentence.target || null;
    }
    
    if (options.includeNotes) {
      data.notes = sentence.noteContent || null;
    }
    
    if (options.includeTags && sentence.tags) {
      data.tags = JSON.parse(sentence.tags);
    }
    
    return data;
  });
  
  return JSON.stringify(exportData, null, 2);
}

function exportToTXT(sentences: SentenceWithUserData[], options: ExportOptions): string {
  let output = 'My Sentences Export\n';
  output += '='.repeat(50) + '\n\n';
  
  sentences.forEach((sentence, index) => {
    output += `${index + 1}. ${sentence.source}\n`;
    
    if (options.includeTranslations && sentence.target) {
      output += `   Translation: ${sentence.target}\n`;
    }
    
    if (sentence.userTranslation) {
      output += `   My Translation: ${sentence.userTranslation}\n`;
    }
    
    if (options.includeNotes && sentence.noteContent) {
      output += `   Notes: ${sentence.noteContent}\n`;
    }
    
    if (options.includeTags && sentence.tags) {
      const tags = JSON.parse(sentence.tags);
      output += `   Tags: ${tags.map((tag: string) => `#${tag}`).join(', ')}\n`;
    }
    
    output += '\n';
  });
  
  return output;
}

export function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  
  // Safely check if document.body exists
  if (document.body) {
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  } else {
    console.error('document.body is not available for file download');
  }
  
  URL.revokeObjectURL(url);
}
