import React, { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Type, Palette, PanelRight, ChevronDown, Languages, BookPlus, Loader2, Sparkles, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ViewMode } from '@/lib/types.d';
import { useTranslation } from '@/i18n';

interface AITierInfo {
  plan: string;
  modelTier: "Basic" | "Premium";
  model: string;
  description: string;
}

interface SlimHeaderProps {
  title: string;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  theme?: 'follow' | 'light' | 'dark' | 'sepia';
  onThemeChange?: (theme: 'follow' | 'light' | 'dark' | 'sepia') => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  lineHeight: number;
  onLineHeightChange: (height: number) => void;
  useSerif: boolean;
  onUseSerifChange: (serif: boolean) => void;
  documentWidth: number;
  onDocumentWidthChange: (width: number) => void;
  showHoverTooltip: boolean;
  onShowHoverTooltipChange: (show: boolean) => void;
  isVisible: boolean;
  className?: string;
  onMenuStateChange?: (hasOpenMenu: boolean) => void;
  isExploreDocument?: boolean;
  isTranslating?: boolean;
  isTranslationComplete?: boolean;
  isAddingToLibrary?: boolean;
  isAlreadyInLibrary?: boolean;
  libraryDocumentId?: number | null;
  onTranslateDocument?: () => void;
  onAddToLibrary?: () => void;
  onToggleReaderPanel?: () => void;
  isReaderPanelOpen?: boolean;
}

/**
 * SlimHeader - 몰입형 리더용 슬림 헤더
 * 
 * 주요 기능:
 * - 뒤로가기 (← Library)
 * - 문서 제목과 진행률 표시
 * - View 모드 선택
 * - 타이포그래피 설정 (Aa 팝오버)
 * - 테마 선택
 * - 단축키 도움말
 */
export default function SlimHeader({
  title,
  viewMode,
  onViewModeChange,
  theme = 'follow',
  onThemeChange,
  fontSize,
  onFontSizeChange,
  lineHeight,
  onLineHeightChange,
  useSerif,
  onUseSerifChange,
  documentWidth,
  onDocumentWidthChange,
  showHoverTooltip,
  onShowHoverTooltipChange,
  isVisible,
  className = '',
  onMenuStateChange,
  // 액션 버튼 관련 props
  isExploreDocument = false,
  isTranslating = false,
  isTranslationComplete = false,
  isAddingToLibrary = false,
  isAlreadyInLibrary = false,
  libraryDocumentId = null,
  onTranslateDocument,
  onAddToLibrary,
  onToggleReaderPanel,
  isReaderPanelOpen = false,
}: SlimHeaderProps) {
  const { t } = useTranslation();
  const [, setLocation] = useLocation();
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  
  // Fetch AI tier info for current user
  const { data: aiTierInfo } = useQuery<AITierInfo>({
    queryKey: ['/api/ai-tier'],
    staleTime: 1000 * 60 * 5, // Cache for 5 minutes
  });
  
  // View mode labels
  const viewModeLabels: Record<string, string> = {
    "original-only": t('viewer.viewMode.sourceOnly'),
    "side-by-side": t('viewer.viewMode.sideBySide'),
    "translation-only": t('viewer.viewMode.targetOnly')
  };

  // Theme labels
  const themeLabels: Record<string, string> = {
    "follow": t('viewerControls.followSite'),
    "light": t('common.light'),
    "dark": t('common.dark'),
    "sepia": t('common.sepia')
  };
  
  // 메뉴 상태 추적
  const [viewDropdownOpen, setViewDropdownOpen] = useState(false);
  const [typographyPopoverOpen, setTypographyPopoverOpen] = useState(false);
  const [themeDropdownOpen, setThemeDropdownOpen] = useState(false);
  
  // 메뉴 상태가 변경될 때마다 부모에게 알림
  useEffect(() => {
    const hasOpenMenu = viewDropdownOpen || typographyPopoverOpen || themeDropdownOpen || showShortcutHelp;
    onMenuStateChange?.(hasOpenMenu);
  }, [viewDropdownOpen, typographyPopoverOpen, themeDropdownOpen, showShortcutHelp, onMenuStateChange]);

  const handleBackToHome = () => {
    setLocation('/');
  };

  return (
    <header
      className={`
        fixed top-0 left-0 right-0 z-[60] bg-background/95
        backdrop-blur-sm border-b border-border
        transform transition-transform duration-300 ease-in-out
        ${isVisible ? 'translate-y-0' : '-translate-y-full'}
        ${className}
        
        /* Responsive height: larger on mobile for better touch targets */
        h-12 max-[900px]:h-14
      `}
      data-testid="slim-header"
    >
      <div className="h-full flex items-center justify-between px-4 max-[900px]:px-3">
        {/* 좌측: 뒤로가기 + 제목/진행률 */}
        <div className="flex items-center gap-2 max-[900px]:gap-3 flex-1 min-w-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleBackToHome}
            className="flex items-center gap-1 text-muted-foreground hover:text-foreground
                       /* Mobile: larger touch target */
                       max-[900px]:min-h-[44px] max-[900px]:min-w-[44px] max-[900px]:px-2"
            data-testid="button-back-to-home"
          >
            <ArrowLeft className="h-4 w-4 max-[900px]:h-5 max-[900px]:w-5" />
            <span className="hidden sm:inline">{t('common.home')}</span>
          </Button>
          
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-sm font-medium truncate flex-1 text-foreground" title={title}>
                {title}
              </h1>
              
              {/* 액션 버튼 - Explore/Library 문서에 따라 다른 버튼 표시 */}
              {isExploreDocument ? (
                // Explore 문서: Save to Library 버튼
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={isAlreadyInLibrary 
                    ? () => setLocation(libraryDocumentId ? `/viewer/${libraryDocumentId}` : '/library')
                    : onAddToLibrary
                  }
                  disabled={isAddingToLibrary}
                  className="hidden sm:flex items-center gap-2 px-3 h-7 text-xs rounded-md bg-muted hover:bg-muted/80 text-foreground"
                  data-testid="button-save-to-library"
                >
                  {isAddingToLibrary ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>{t('viewer.addingToLibrary')}</span>
                    </>
                  ) : isAlreadyInLibrary ? (
                    <>
                      <BookPlus className="h-3 w-3" />
                      <span>{t('library.openInLibrary')}</span>
                    </>
                  ) : (
                    <>
                      <BookPlus className="h-3 w-3" />
                      <span>{t('viewer.saveToLibrary')}</span>
                    </>
                  )}
                </Button>
              ) : (
                // Library 문서: Translate All 버튼
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onTranslateDocument}
                  disabled={isTranslationComplete}
                  className="hidden sm:flex items-center gap-2 px-3 h-7 text-xs rounded-md bg-muted hover:bg-muted/80 text-foreground"
                  data-testid="button-translate-all"
                >
                  {isTranslating ? (
                    <>
                      <Loader2 className="h-3 w-3 animate-spin" />
                      <span>{t('viewer.translating')}</span>
                    </>
                  ) : isTranslationComplete ? (
                    <>
                      <Languages className="h-3 w-3" />
                      <span>{t('viewer.translationComplete')}</span>
                    </>
                  ) : (
                    <>
                      <Languages className="h-3 w-3" />
                      <span>{t('viewer.translateAll')}</span>
                    </>
                  )}
                </Button>
              )}

              {/* 모바일에서는 아이콘만 표시 */}
              {isExploreDocument ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={isAlreadyInLibrary ? () => setLocation('/library') : onAddToLibrary}
                  disabled={isAddingToLibrary}
                  className="sm:hidden flex items-center justify-center h-8 w-8 rounded-full bg-muted hover:bg-muted/80 text-foreground"
                  data-testid="button-save-to-library-mobile"
                >
                  {isAddingToLibrary ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <BookPlus className="h-4 w-4" />
                  )}
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onTranslateDocument}
                  disabled={isTranslationComplete}
                  className="sm:hidden flex items-center justify-center h-8 w-8 rounded-full bg-muted hover:bg-muted/80 text-foreground"
                  data-testid="button-translate-all-mobile"
                >
                  {isTranslating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Languages className={`h-4 w-4 ${isTranslationComplete ? 'text-green-600 dark:text-green-400' : ''}`} />
                  )}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* 우측: AI Tier Badge / View/Aa/Theme/Help */}
        <div className="flex items-center gap-1 max-[900px]:gap-2 ml-3">
          {/* AI Tier Badge */}
          {aiTierInfo && (
            <div 
              className={`hidden sm:flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium ${
                aiTierInfo.modelTier === "Premium" 
                  ? "bg-brand-subtle text-brand dark:text-brand border border-brand/30" 
                  : "bg-muted text-muted-foreground border border-border"
              }`}
              title={aiTierInfo.description}
              data-testid="badge-ai-tier"
            >
              {aiTierInfo.modelTier === "Premium" ? (
                <Sparkles className="h-3 w-3" />
              ) : (
                <Zap className="h-3 w-3" />
              )}
              <span>{aiTierInfo.modelTier === "Premium" ? "Premium AI" : "Basic AI"}</span>
            </div>
          )}
          
          {/* View Mode Dropdown */}
          <DropdownMenu modal={false} open={viewDropdownOpen} onOpenChange={setViewDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-1 text-xs text-foreground
                           /* Mobile: larger touch target */
                           max-[900px]:min-h-[44px] max-[900px]:min-w-[44px] max-[900px]:px-2"
                data-testid="dropdown-view-mode"
              >
                <span className="hidden sm:inline">{t('viewerControls.viewMode')}</span>
                <ChevronDown className="h-3 w-3 max-[900px]:h-4 max-[900px]:w-4 text-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[70]">
              {Object.entries(viewModeLabels).map(([mode, label]) => (
                <DropdownMenuItem
                  key={mode}
                  onClick={() => onViewModeChange(mode as ViewMode)}
                  className={viewMode === mode ? 'bg-accent' : ''}
                >
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Typography Settings (Aa) Popover */}
          <Popover open={typographyPopoverOpen} onOpenChange={setTypographyPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-1 text-foreground
                           /* Mobile: larger touch target */
                           max-[900px]:min-h-[44px] max-[900px]:min-w-[44px] max-[900px]:px-2"
                data-testid="popover-typography"
              >
                <Type className="h-4 w-4 max-[900px]:h-5 max-[900px]:w-5 text-foreground" />
                <span className="hidden sm:inline text-xs text-foreground">Aa</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 z-[70]" align="end">
              <div className="space-y-4">
                <h4 className="font-medium text-sm">{t('viewerControls.readerSettings')}</h4>
                
                {/* Font Size */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">{t('viewerControls.fontSize')}</Label>
                    <span className="text-xs text-muted-foreground">{fontSize}px</span>
                  </div>
                  <Slider
                    value={[fontSize]}
                    onValueChange={(value) => onFontSizeChange(value[0])}
                    min={12}
                    max={24}
                    step={1}
                    data-testid="slider-font-size"
                  />
                </div>

                {/* Line Height */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">{t('viewerControls.lineHeight')}</Label>
                    <span className="text-xs text-muted-foreground">{lineHeight}</span>
                  </div>
                  <Slider
                    value={[lineHeight]}
                    onValueChange={(value) => onLineHeightChange(value[0])}
                    min={1.2}
                    max={2.0}
                    step={0.1}
                    data-testid="slider-line-height"
                  />
                </div>

                {/* Document Width */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm">{t('viewerControls.documentWidth')}</Label>
                    <span className="text-xs text-muted-foreground">{documentWidth}px</span>
                  </div>
                  <Slider
                    value={[documentWidth]}
                    onValueChange={(value) => onDocumentWidthChange(value[0])}
                    min={800}
                    max={1200}
                    step={50}
                    data-testid="slider-document-width"
                  />
                </div>

                {/* Serif Font Toggle */}
                <div className="flex items-center justify-between">
                  <Label className="text-sm">{t('viewerControls.useSerifFont')}</Label>
                  <Switch
                    checked={useSerif}
                    onCheckedChange={onUseSerifChange}
                    data-testid="switch-serif-font"
                  />
                </div>

                {/* Hover Tooltip Toggle */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <Label className="text-sm">{t('viewerControls.showHoverTooltip')}</Label>
                    <p className="text-xs text-muted-foreground">{t('viewerControls.showHoverTooltipDescription')}</p>
                  </div>
                  <Switch
                    checked={showHoverTooltip}
                    onCheckedChange={onShowHoverTooltipChange}
                    data-testid="switch-hover-tooltip"
                  />
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Theme Dropdown */}
          <DropdownMenu modal={false} open={themeDropdownOpen} onOpenChange={setThemeDropdownOpen}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="flex items-center gap-1 text-foreground"
                data-testid="dropdown-theme"
              >
                <Palette className="h-4 w-4 text-foreground" />
                <span className="hidden sm:inline text-xs text-foreground">{t('common.theme')}</span>
                <ChevronDown className="h-3 w-3 text-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[70]">
              {Object.entries(themeLabels).map(([themeKey, label]) => (
                <DropdownMenuItem
                  key={themeKey}
                  onClick={() => onThemeChange?.(themeKey as any)}
                  className={theme === themeKey ? 'bg-accent' : ''}
                >
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Reader Panel Toggle Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleReaderPanel}
            data-testid="button-reader-panel"
            className={`text-foreground ${isReaderPanelOpen ? 'bg-muted' : ''}`}
            title={t('viewer.readerPanel')}
          >
            <PanelRight className="h-4 w-4 text-foreground" />
          </Button>
        </div>
      </div>
    </header>
  );
}