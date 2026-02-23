import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation } from 'wouter';
import { ChevronRight, Sparkles, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { selectMicroVariation, type MicroVariationType } from '@/lib/engagement';
import { useTranslation, useLanguage } from '@/i18n';

interface TodaySentence {
  id: number;
  text: string;
  translation?: string;
  source: string;
  documentId: number;
  documentTitle: string;
}

const CURATION_MESSAGES_KO = [
  "오늘의 한 문장으로 시작하는 깊은 읽기",
  "생각을 확장시키는 문장을 만나보세요",
  "매일 새로운 시선으로 세상을 읽습니다"
];

const CURATION_MESSAGES_EN = [
  "Start your day with a meaningful sentence",
  "Discover words that expand your thinking",
  "Read the world with fresh perspective each day"
];

export default function HeroSection() {
  const { t } = useTranslation();
  const { language } = useLanguage();
  const [, setLocation] = useLocation();
  
  const [variationType, setVariationType] = useState<MicroVariationType>('pure_focus');
  const [curationMessage, setCurationMessage] = useState('');

  useEffect(() => {
    const type = selectMicroVariation();
    setVariationType(type);
    
    const messages = language === 'ko' ? CURATION_MESSAGES_KO : CURATION_MESSAGES_EN;
    setCurationMessage(messages[Math.floor(Math.random() * messages.length)]);
    
  }, [language]);

  const { data: todaySentence, isLoading } = useQuery<TodaySentence>({
    queryKey: ['/api/today-sentence'],
    retry: false,
    staleTime: 1000 * 60 * 60,
  });

  const { data: recentDoc } = useQuery<{ id: number; title: string }>({
    queryKey: ['/api/documents/recent'],
    enabled: variationType === 'visual_break',
    retry: false,
  });

  const handleSentenceClick = () => {
    if (todaySentence?.documentId) {
      setLocation(`/viewer/${todaySentence.documentId}`);
    }
  };

  const displaySentence = useMemo(() => {
    if (isLoading) return language === 'ko' ? '오늘의 문장을 불러오는 중...' : 'Loading today\'s sentence...';
    if (!todaySentence) {
      return language === 'ko' 
        ? '"읽는다는 것은 새로운 생각을 만나는 일이다."'
        : '"Reading is an encounter with new thoughts."';
    }
    return `"${todaySentence.text}"`;
  }, [todaySentence, isLoading, language]);

  const displaySource = useMemo(() => {
    if (!todaySentence) {
      return language === 'ko' ? '— 오늘의 첫 문장을 기다리며' : '— Awaiting your first sentence';
    }
    return `— ${todaySentence.documentTitle}`;
  }, [todaySentence, language]);

  return (
    <section
      className="relative w-full min-h-[25vh] overflow-hidden bg-[hsl(var(--brand-subtle))]"
    >

      <div className="relative z-10 container mx-auto px-6 py-8 flex flex-col items-center justify-center min-h-[25vh]">
        {variationType === 'contextual_insight' && (
          <div className="flex items-center gap-2 mb-4 text-brand-amber/80">
            <Sparkles className="h-4 w-4" />
            <span className="text-sm font-medium tracking-wide">
              {curationMessage}
            </span>
          </div>
        )}

        <div 
          className={cn(
            "max-w-3xl text-center cursor-pointer group transition-all duration-400",
            todaySentence && "hover:scale-[1.01]"
          )}
          onClick={handleSentenceClick}
          data-testid="hero-sentence"
        >
          <blockquote 
            className={cn(
              "hero-quote text-xl md:text-2xl lg:text-3xl",
              "transition-all duration-400"
            )}
          >
            {displaySentence}
          </blockquote>
          
          <cite 
            className="block mt-4 text-sm md:text-base text-emerald-900/50 not-italic"
          >
            {displaySource}
          </cite>

          {todaySentence && (
            <div className="mt-4 flex items-center justify-center gap-2 text-brand-amber opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <span className="text-sm">
                {language === 'ko' ? '원문 읽기' : 'Read full context'}
              </span>
              <ChevronRight className="h-4 w-4" />
            </div>
          )}
        </div>

        {variationType === 'visual_break' && recentDoc && (
          <div className="mt-4 flex items-center gap-2 text-muted-foreground/70">
            <BookOpen className="h-4 w-4" />
            <span className="text-sm">
              {language === 'ko' ? '최근 읽던 글:' : 'Recently reading:'}{' '}
              <span className="text-foreground/80">{recentDoc.title}</span>
            </span>
          </div>
        )}
      </div>

      <div 
        className={cn(
          "absolute bottom-0 left-0 right-0 h-16 pointer-events-none",
          "bg-gradient-to-t from-background to-transparent"
        )}
      />
    </section>
  );
}
