import { formatDistanceToNow as fnsFormatDistanceToNow, format as fnsFormat, type Locale } from "date-fns";
import { ko, enUS } from "date-fns/locale";

const locales: Record<string, Locale> = {
  ko: ko,
  'ko-KR': ko,
  en: enUS,
  'en-US': enUS,
};

function getLocale(language: string): Locale {
  if (locales[language]) {
    return locales[language];
  }
  const baseLanguage = language.split('-')[0];
  return locales[baseLanguage] || ko;
}

export function formatDateWithTimezone(
  date: Date | string | number,
  formatStr: string,
  options: { timezone?: string; language?: string } = {}
): string {
  const { timezone = 'Asia/Seoul', language = 'ko' } = options;
  const dateObj = new Date(date);
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  
  const parts = formatter.formatToParts(dateObj);
  const getPart = (type: string) => parts.find(p => p.type === type)?.value || '0';
  
  const tzDate = new Date(
    parseInt(getPart('year')),
    parseInt(getPart('month')) - 1,
    parseInt(getPart('day')),
    parseInt(getPart('hour')),
    parseInt(getPart('minute')),
    parseInt(getPart('second'))
  );
  
  return fnsFormat(tzDate, formatStr, { locale: getLocale(language) });
}

export function formatDistanceToNowWithTimezone(
  date: Date | string | number,
  options: { timezone?: string; language?: string; addSuffix?: boolean } = {}
): string {
  const { language = 'ko', addSuffix = true } = options;
  const dateObj = new Date(date);
  
  return fnsFormatDistanceToNow(dateObj, { 
    addSuffix,
    locale: getLocale(language)
  });
}

export function formatRelativeDate(
  date: Date | string | number,
  options: { timezone?: string; language?: string } = {}
): string {
  const { timezone = 'Asia/Seoul', language = 'ko' } = options;
  const dateObj = new Date(date);
  const now = new Date();
  
  const diffMs = now.getTime() - dateObj.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  
  if (diffDays < 7) {
    return formatDistanceToNowWithTimezone(date, { language, addSuffix: true });
  } else if (diffDays < 365) {
    return formatDateWithTimezone(date, 'MMM d', { timezone, language });
  } else {
    return formatDateWithTimezone(date, 'MMM d, yyyy', { timezone, language });
  }
}

export function formatDateTime(
  date: Date | string | number,
  options: { timezone?: string; language?: string } = {}
): string {
  const { timezone = 'Asia/Seoul', language = 'ko' } = options;
  return formatDateWithTimezone(date, 'PPpp', { timezone, language });
}

export function formatShortDate(
  date: Date | string | number,
  options: { timezone?: string; language?: string } = {}
): string {
  const { timezone = 'Asia/Seoul', language = 'ko' } = options;
  const baseLanguage = language.split('-')[0];
  // English: MM.DD.YYYY, Korean: YYYY.MM.DD
  const formatStr = baseLanguage === 'en' ? 'MM.dd.yyyy' : 'yyyy.MM.dd';
  return formatDateWithTimezone(date, formatStr, { timezone, language });
}
