
import React, { useState } from "react";
import { ViewMode } from "@/lib/types.d";
import { Settings, Download, Share, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useTranslation } from "@/i18n";

interface ViewerControlsProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  onDownload: () => void;
  onShare: () => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  lineHeight: number;
  onLineHeightChange: (height: number) => void;
  paragraphsPerPage: number;
  onParagraphsPerPageChange: (count: number) => void;
  documentWidth?: number;
  onDocumentWidthChange?: (width: number) => void;
}

export default function ViewerControls({
  viewMode,
  onViewModeChange,
  onDownload,
  onShare,
  fontSize,
  onFontSizeChange,
  lineHeight,
  onLineHeightChange,
  paragraphsPerPage,
  onParagraphsPerPageChange,
  documentWidth,
  onDocumentWidthChange,
}: ViewerControlsProps) {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <Sheet>
        <SheetTrigger asChild>
          <Button size="icon" variant="outline" className="rounded-full shadow-lg">
            <Settings className="h-4 w-4" />
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-80">
          <SheetHeader>
            <SheetTitle>{t('viewerControls.readerSettings')}</SheetTitle>
            <SheetDescription>
              {t('viewerControls.customizeReading')}
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-6 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('viewerControls.viewMode')}</label>
              <Select
                value={viewMode}
                onValueChange={(value) => onViewModeChange(value as ViewMode)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('viewerControls.selectViewMode')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="original-only">{t('viewerControls.originalOnly')}</SelectItem>
                  <SelectItem value="side-by-side">{t('viewerControls.sideBySide')}</SelectItem>
                  <SelectItem value="translation-only">{t('viewerControls.translationOnly')}</SelectItem>
                  <SelectItem value="hover-to-translate">{t('viewerControls.hoverToTranslate')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('viewerControls.fontSize')} ({fontSize}px)</label>
              <Slider
                value={[fontSize]}
                onValueChange={(value) => onFontSizeChange(value[0])}
                min={12}
                max={24}
                step={1}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('viewerControls.lineHeight')} ({lineHeight})</label>
              <Slider
                value={[lineHeight]}
                onValueChange={(value) => onLineHeightChange(value[0])}
                min={1.2}
                max={2.0}
                step={0.1}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('viewerControls.documentWidth')} ({documentWidth}px)</label>
              <Slider
                value={[documentWidth || 1200]}
                onValueChange={(value) => onDocumentWidthChange?.(value[0])}
                min={600}
                max={1600}
                step={20}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">{t('viewerControls.paragraphsPerPage')}</label>
              <Select
                value={paragraphsPerPage.toString()}
                onValueChange={(value) => onParagraphsPerPageChange(Number(value))}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('viewerControls.selectParagraphsPerPage')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">{t('viewerControls.3paragraphs')}</SelectItem>
                  <SelectItem value="5">{t('viewerControls.5paragraphs')}</SelectItem>
                  <SelectItem value="10">{t('viewerControls.10paragraphs')}</SelectItem>
                  <SelectItem value="20">{t('viewerControls.20paragraphs')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button variant="outline" onClick={onDownload} className="flex-1">
                <Download className="h-4 w-4 mr-2" />
                {t('viewerControls.download')}
              </Button>
              <Button variant="outline" onClick={onShare} className="flex-1">
                <Share className="h-4 w-4 mr-2" />
                {t('viewerControls.share')}
              </Button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
