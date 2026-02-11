import { useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Mail, CheckCircle2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { apiRequest } from "@/lib/queryClient";

export default function ForgotPassword() {
  const { toast } = useToast();
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!email.trim()) {
      newErrors.email = t('auth.emailRequired');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      newErrors.email = t('auth.emailInvalid');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate()) return;

    setIsLoading(true);
    setErrors({});

    try {
      await apiRequest('/api/auth/forgot-password', {
        method: 'POST',
        json: { email }
      });

      setResetSuccess(true);
      toast({
        title: t('auth.resetEmailSent'),
        description: t('auth.resetEmailSentDescription'),
      });

    } catch (error: any) {
      let errorDetail = t('auth.resetPasswordErrorGeneric');
      let errorField = null;
      
      if (error?.message) {
        const match = error.message.match(/^\d+:\s*(.+)$/);
        if (match) {
          try {
            const parsed = JSON.parse(match[1]);
            errorDetail = parsed.detail || errorDetail;
            if (parsed.meta?.field) {
              errorField = parsed.meta.field;
            }
          } catch {
            errorDetail = match[1];
          }
        }
      }
      
      if (errorField) {
        setErrors({ [errorField]: errorDetail });
      } else {
        toast({
          title: t('auth.resetPasswordError'),
          description: errorDetail,
          variant: "destructive"
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (resetSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-2xl font-bold">{t('auth.checkYourEmail')}</CardTitle>
            <CardDescription>
              {t('auth.resetEmailInstructions')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <Mail className="h-4 w-4" />
              <AlertDescription>
                {t('auth.resetEmailSentTo', { email })}
              </AlertDescription>
            </Alert>
            
            <div className="text-center text-sm text-muted-foreground space-y-2">
              <p>{t('auth.didntReceiveEmail')}</p>
              <Button
                variant="link"
                onClick={() => setResetSuccess(false)}
                className="p-0 h-auto"
                data-testid="button-resend-email"
              >
                {t('auth.resendEmail')}
              </Button>
            </div>

            <div className="text-center pt-4">
              <Button
                variant="outline"
                onClick={() => window.location.href = '/login'}
                data-testid="button-back-to-login"
              >
                {t('auth.backToLogin')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">{t('auth.forgotPassword')}</CardTitle>
          <CardDescription className="text-center">
            {t('auth.forgotPasswordDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder={t('auth.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  data-testid="input-email"
                  disabled={isLoading}
                  autoFocus
                />
              </div>
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={isLoading}
              data-testid="button-submit"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('auth.sendingResetLink')}
                </>
              ) : (
                t('auth.sendResetLink')
              )}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground pt-2">
            {t('auth.rememberPassword')}{' '}
            <Link href="/login" className="text-primary hover:underline" data-testid="link-login">
              {t('auth.backToLogin')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
