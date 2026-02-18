import { Sentence } from "./types";

/**
 * Translate text using Gemini AI API
 * @param text Text to translate
 * @param sourceLanguage Source language code (e.g., 'en', 'ko')
 * @param targetLanguage Target language code
 * @returns Promise with translated text
 */
export async function translateText(
  text: string,
  sourceLanguage: string,
  targetLanguage: string
): Promise<string> {
  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text,
        sourceLanguage,
        targetLanguage,
      }),
    });

    if (!response.ok) {
      throw new Error(`Translation request failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.translation;
  } catch (error) {
    console.error("Translation error:", error);
    throw error;
  }
}

/**
 * Batch translate sentences for a document
 * @param sentences Array of sentences to translate
 * @param sourceLanguage Source language code
 * @param targetLanguage Target language code
 * @returns Promise with translated sentences
 */
export async function batchTranslateSentences(
  sentences: Pick<Sentence, "source">[],
  sourceLanguage: string,
  targetLanguage: string
): Promise<string[]> {
  try {
    const response = await fetch("/api/translate/batch", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sentences: sentences.map(s => s.source),
        sourceLanguage,
        targetLanguage,
      }),
    });

    if (!response.ok) {
      throw new Error(`Batch translation request failed: ${response.statusText}`);
    }

    const data = await response.json();
    return data.translations;
  } catch (error) {
    console.error("Batch translation error:", error);
    throw error;
  }
}
