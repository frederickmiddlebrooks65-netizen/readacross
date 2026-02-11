import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useLanguage, useTranslation } from "@/i18n";

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();
  const { t } = useTranslation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full"
          data-testid="button-language-switcher"
        >
          <Globe className="h-5 w-5" />
          <span className="sr-only">{t('settings.changeLanguage')}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={12}>
        <DropdownMenuItem
          onClick={() => setLanguage('en')}
          className={language === 'en' ? 'bg-accent' : ''}
          data-testid="language-option-en"
        >
          {t('settings.languageEnglish')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => setLanguage('ko')}
          className={language === 'ko' ? 'bg-accent' : ''}
          data-testid="language-option-ko"
        >
          {t('settings.languageKorean')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
