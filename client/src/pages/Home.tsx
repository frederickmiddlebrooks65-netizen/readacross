import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/useAuth";
import { useTranslation } from "@/i18n";
import { Loader2 } from "lucide-react";

export default function Home() {
  const [, setLocation] = useLocation();
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useTranslation();

  useEffect(() => {
    if (!isLoading) {
      if (isAuthenticated) {
        setLocation("/library");
      } else {
        setLocation("/explore");
      }
    }
  }, [isAuthenticated, isLoading, setLocation]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-primary" />
        <p className="text-muted-foreground">{t('common.loading')}</p>
      </div>
    </div>
  );
}
