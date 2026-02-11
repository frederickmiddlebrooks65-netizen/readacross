export interface DocumentEngagementData {
  totalSentences: number;
  highlightCount: number;
  aiCoachingCount: number;
  activeDwellTime: number;
  isEngagementTrackingExcluded?: boolean;
}

export interface EngagementScore {
  total: number;
  highlightScore: number;
  coachingScore: number;
  timeScore: number;
  level: 'low' | 'medium' | 'high';
  opacity: number;
}

export const calculateEngagement = (doc: DocumentEngagementData): EngagementScore => {
  if (doc.isEngagementTrackingExcluded) {
    return {
      total: 1,
      highlightScore: 1,
      coachingScore: 1,
      timeScore: 1,
      level: 'high',
      opacity: 1
    };
  }

  const totalSentences = Math.max(doc.totalSentences, 1);
  
  const normHighlight = doc.highlightCount / totalSentences;
  
  const cappedCoaching = Math.min(doc.aiCoachingCount, 5);
  const normCoaching = cappedCoaching / totalSentences;
  
  const activeTimeFactor = Math.log(doc.activeDwellTime + 1);
  const maxTimeFactor = Math.log(3600 + 1);
  const normalizedTime = activeTimeFactor / maxTimeFactor;

  const total = 
    (normalizedTime * 0.2) + 
    (Math.min(normHighlight, 1) * 0.4) + 
    (Math.min(normCoaching, 1) * 0.4);

  const clampedTotal = Math.min(Math.max(total, 0), 1);

  let level: 'low' | 'medium' | 'high';
  let opacity: number;
  
  if (clampedTotal < 0.3) {
    level = 'low';
    opacity = 0.5 + clampedTotal * 0.5;
  } else if (clampedTotal < 0.6) {
    level = 'medium';
    opacity = 0.7 + (clampedTotal - 0.3) * 0.5;
  } else {
    level = 'high';
    opacity = 0.9 + (clampedTotal - 0.6) * 0.25;
  }

  opacity = Math.min(Math.max(opacity, 0.45), 1);

  return {
    total: clampedTotal,
    highlightScore: Math.min(normHighlight, 1),
    coachingScore: Math.min(normCoaching, 1),
    timeScore: normalizedTime,
    level,
    opacity
  };
};

export type MicroVariationType = 'pure_focus' | 'contextual_insight' | 'visual_break';

export const selectMicroVariation = (): MicroVariationType => {
  const rand = Math.random();
  if (rand < 0.7) return 'pure_focus';
  if (rand < 0.9) return 'contextual_insight';
  return 'visual_break';
};

export const getLowEngagementCopy = (language: 'ko' | 'en' = 'ko'): string => {
  const options = language === 'ko' ? [
    "다시 발견되기를 기다리는 문장들",
    "더 깊은 대화의 여지가 남은 글",
    "당신의 시선이 조금 더 필요한 지식"
  ] : [
    "Sentences waiting to be rediscovered",
    "Articles with room for deeper dialogue",
    "Knowledge that needs a bit more of your attention"
  ];
  
  return options[Math.floor(Math.random() * options.length)];
};
