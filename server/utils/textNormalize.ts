/**
 * Advanced text normalization utilities for PDF and other document processing
 * 
 * Handles smart line break merging while preserving document structure:
 * - Merges broken sentences from PDF layout
 * - Preserves paragraph boundaries and structural elements
 * - Handles hyphenated words and URLs correctly
 * - Recognizes titles, headers, and lists
 */

export function smartNormalizeForSentenceProcessing(raw: string): string {
  if (!raw) return "";

  // 1) 줄바꿈 정규화
  let text = raw.replace(/\r\n?/g, "\n");

  // 2) 문단 경계(빈 줄 2+개)는 토큰으로 보호
  const PARA = "<<<__PARA__>>>";
  text = text.replace(/\n{2,}/g, PARA);

  // 3) 라인 단위 처리
  const lines = text.split("\n");
  const out: string[] = [];

  const isListOrHeader = (s: string) => /^\s*(?:[-*•]|\d+\.)\s+/.test(s);
  const endsWithSentencePunct = (s: string) => /[.!?…]+["'\u2019\u201D)\]]?$/.test(s.trim());
  const looksLikeUrlOrEmail = (s: string) =>
    /(https?:\/\/|www\.)/i.test(s) || /\S+@\S+\.\S+/.test(s);
  const hasTrailingHyphen = (s: string) => /[A-Za-z0-9]-$/.test(s);

  // 제목/헤더 추정: 단어 수가 짧고(<= 12), 대문자로 시작하는 단어 비율이 높음(>= 0.6)
  const isTitleLike = (s: string) => {
    const t = s.trim();
    if (!t) return false;
    const words = t.split(/\s+/);
    if (words.length > 12) return false;
    const capWords = words.filter(w => /^[A-Z][A-Za-z''-]*$/.test(w)).length;
    return words.length > 1 && capWords / words.length >= 0.6;
  };

  for (let i = 0; i < lines.length; i++) {
    let cur = lines[i];
    if (!cur) continue;

    if (cur.includes(PARA)) { // 문단 토큰은 보존
      out.push(cur);
      continue;
    }

    const next = i + 1 < lines.length ? lines[i + 1] : "";
    const curTrim = cur.trimEnd();
    const nextTrim = next.trimStart();

    // 3-1) 리스트/헤더 시작 라인은 줄바꿈 유지
    if (isListOrHeader(curTrim)) {
      out.push(curTrim);
      continue;
    }

    // 3-2) URL/이메일 포함 라인의 하이픈은 훼손 금지
    if (hasTrailingHyphen(curTrim) && looksLikeUrlOrEmail(curTrim + nextTrim)) {
      out.push(curTrim.slice(0, -1) + "-" + " " + nextTrim);
      i++; // next 소비
      continue;
    }

    // 3-3) 단어분할 하이픈: 붙여서 병합 (soft hyphenation)
    if (hasTrailingHyphen(curTrim)) {
      out.push(curTrim.slice(0, -1) + nextTrim);
      i++; // next 소비
      continue;
    }

    // 3-4) 문장 종료 부호면: 줄바꿈 → 공백 1개 (경계만 유지)
    if (endsWithSentencePunct(curTrim)) {
      if (next && !isListOrHeader(nextTrim) && !next.includes(PARA)) {
        out.push(curTrim + " ");
      } else {
        out.push(curTrim);
      }
      continue;
    }

    // 3-5) 대문자 시작 줄 처리(리플릿 피드백 반영)
    //  - 다음 줄이 대문자로 시작하고
    //  - 현재 줄이 제목/헤더처럼 보이거나(짧고 Capitalized)
    //  - 현재 줄 길이가 상대적으로 짧은 경우(<= 40)
    //    → 줄바꿈 보존(새 문단/헤더로 간주)
    const nextStartsUpper = /^[A-Z]/.test(nextTrim);
    if (next && nextStartsUpper && (isTitleLike(curTrim) || curTrim.length <= 40)) {
      out.push(curTrim); // 병합하지 않음
      continue;
    }

    // 3-6) 그 외 대부분: 줄바꿈은 공백으로 병합
    if (next) {
      if (isListOrHeader(nextTrim)) {
        out.push(curTrim);
      } else {
        out.push(curTrim + " " + nextTrim);
        i++; // next 소비
      }
    } else {
      out.push(curTrim);
    }
  }

  let joined = out.join("\n");

  // 4) 문단 토큰 복원
  joined = joined.replace(new RegExp(PARA, "g"), "\n\n");

  // 5) 과도 공백 정리(문단/문장 경계는 보존)
  joined = joined.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();

  return joined;
}

/**
 * Legacy text preprocessing for backward compatibility
 * 
 * @deprecated Use smartNormalizeForSentenceProcessing instead
 */
export function legacyPreprocessText(text: string): string {
  if (!text || typeof text !== 'string') {
    return '';
  }

  return text
    .replace(/<[^>]*>/g, '') // Remove all HTML tags
    .replace(/&[a-zA-Z0-9#]+;/g, ' ') // Remove HTML entities
    .replace(/&nbsp;/g, ' ') // Specific handling for non-breaking spaces
    .replace(/[\u200B-\u200D\uFEFF]/g, '') // Remove zero-width characters
    .normalize('NFC') // Normalize Unicode
    .replace(/\s+/g, ' ') // Normalize whitespace
    .trim();
}