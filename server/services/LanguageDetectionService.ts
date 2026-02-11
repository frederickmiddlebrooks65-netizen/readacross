import { GeminiService } from "./GeminiService.js";

export type LanguageCode = string;

export interface LanguageDetectionResult {
  language: LanguageCode;
  confidence: number;
}

const LANGUAGE_CODE_MAP: Record<string, LanguageCode> = {
  english: "en",
  korean: "ko",
  japanese: "ja",
  chinese: "zh",
  spanish: "es",
  french: "fr",
  german: "de",
  portuguese: "pt",
  italian: "it",
  russian: "ru",
  arabic: "ar",
  hindi: "hi",
  vietnamese: "vi",
  thai: "th",
  indonesian: "id",
};

export class LanguageDetectionService {
  static async detectLanguage(text: string): Promise<LanguageDetectionResult> {
    if (!process.env.GOOGLE_API_KEY) {
      console.warn("[LANG_DETECT] Google API key not set, using fallback detection");
      return this.fallbackDetection(text);
    }

    try {
      const result = await GeminiService.detectLanguage(text);
      return {
        language: result.language,
        confidence: result.confidence
      };
    } catch (error) {
      console.error("[LANG_DETECT] Detection failed, using fallback:", error);
      return this.fallbackDetection(text);
    }
  }

  static fallbackDetection(text: string): LanguageDetectionResult {
    const koreanRegex = /[\uAC00-\uD7AF\u1100-\u11FF]/;
    const japaneseRegex = /[\u3040-\u309F\u30A0-\u30FF]/;
    const chineseRegex = /[\u4E00-\u9FFF]/;
    const arabicRegex = /[\u0600-\u06FF]/;
    const cyrillicRegex = /[\u0400-\u04FF]/;
    
    if (koreanRegex.test(text)) {
      return { language: "ko", confidence: 0.9 };
    }
    if (japaneseRegex.test(text)) {
      return { language: "ja", confidence: 0.9 };
    }
    if (chineseRegex.test(text) && !japaneseRegex.test(text)) {
      return { language: "zh", confidence: 0.8 };
    }
    if (arabicRegex.test(text)) {
      return { language: "ar", confidence: 0.9 };
    }
    if (cyrillicRegex.test(text)) {
      return { language: "ru", confidence: 0.8 };
    }
    
    return { language: "en", confidence: 0.7 };
  }

  static getLanguageDisplayName(code: LanguageCode): string {
    const displayNames: Record<string, string> = {
      en: "English",
      ko: "한국어",
      ja: "日本語",
      zh: "中文",
      es: "Español",
      fr: "Français",
      de: "Deutsch",
      pt: "Português",
      it: "Italiano",
      ru: "Русский",
      ar: "العربية",
      hi: "हिन्दी",
      vi: "Tiếng Việt",
      th: "ไทย",
      id: "Bahasa Indonesia",
    };
    return displayNames[code] || code.toUpperCase();
  }
}
