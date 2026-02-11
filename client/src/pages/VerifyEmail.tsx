import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Loader2, Mail } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { apiRequest } from "@/lib/queryClient";

function parseErrorMessage(error: any): string {
  if (error?.message) {
    const match = error.message.match(/^\d+:\s*(.+)$/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        return parsed.detail || parsed.message || error.message;
      } catch {
        return match[1];
      }
    }
    return error.message;
  }
  return 'An error occurred';
}

export default function VerifyEmail() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [isResending, setIsResending] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [resendError, setResendError] = useState("");

  useEffect(() => {
    const verifyEmail = async () => {
      const params = new URLSearchParams(window.location.search);
      const token = params.get('token');

      if (!token) {
        setStatus('error');
        setErrorMessage(t('auth.verificationTokenMissing'));
        return;
      }

      try {
        await apiRequest('/api/auth/verify-email', {
          method: 'POST',
          json: { token }
        });

        setStatus('success');
        toast({
          title: t('auth.emailVerified'),
          description: t('auth.emailVerifiedDescription'),
        });

        setTimeout(() => {
          setLocation('/login');
        }, 3000);

      } catch (error: any) {
        setStatus('error');
        setErrorMessage(parseErrorMessage(error) || t('auth.emailVerificationError'));
      }
    };

    verifyEmail();
  }, [setLocation, toast, t]);

  const handleResendVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!resendEmail.trim()) {
      setResendError(t('auth.emailRequired'));
      return;
    }
    
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resendEmail)) {
      setResendError(t('auth.emailInvalid'));
      return;
    }

    setIsResending(true);
    setResendError("");

    try {
      await apiRequest('/api/auth/resend-verification', {
        method: 'POST',
        json: { email: resendEmail }
      });

      toast({
        title: t('auth.verificationEmailResent'),
        description: t('auth.verificationEmailResentDescription'),
      });

    } catch (error: any) {
      toast({
        title: t('auth.resendVerificationError'),
        description: parseErrorMessage(error) || t('auth.resendVerificationErrorGeneric'),
        variant: "destructive"
      });
    } finally {
      setIsResending(false);
    }
  };

  if (status === 'verifying') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
              <Loader2 className="h-6 w-6 text-blue-600 dark:text-blue-400 animate-spin" />
            </div>
            <CardTitle className="text-2xl font-bold">{t('auth.verifyingEmail')}</CardTitle>
            <CardDescription>
              {t('auth.verifyingEmailDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Alert>
              <Loader2 className="h-4 w-4 animate-spin" />
              <AlertDescription>
                {t('auth.pleaseWait')}
              </AlertDescription>
            </Alert>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-2xl font-bold">{t('auth.emailVerified')}</CardTitle>
            <CardDescription>
              {t('auth.emailVerifiedSuccessMessage')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                {t('auth.redirectingToLogin')}
              </AlertDescription>
            </Alert>
            
            <div className="text-center pt-4">
              <Button
                onClick={() => setLocation('/login')}
                data-testid="button-goto-login"
              >
                {t('auth.goToLogin')}
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
        <CardHeader className="text-center space-y-4">
          <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center">
            <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
          </div>
          <CardTitle className="text-2xl font-bold">{t('auth.verificationFailed')}</CardTitle>
          <CardDescription>
            {t('auth.verificationFailedDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {errorMessage}
            </AlertDescription>
          </Alert>

          <div className="space-y-4">
            <p className="text-sm text-muted-foreground text-center">
              {t('auth.verificationLinkExpired')}
            </p>
            
            <form onSubmit={handleResendVerification} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="resend-email">{t('auth.email')}</Label>
                <Input
                  id="resend-email"
                  type="email"
                  placeholder={t('auth.emailPlaceholder')}
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  data-testid="input-resend-email"
                />
                {resendError && (
                  <p className="text-sm text-destructive">{resendError}</p>
                )}
              </div>
              
              <Button
                type="submit"
                className="w-full"
                disabled={isResending}
                data-testid="button-resend-verification"
              >
                {isResending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('auth.resendingVerification')}
                  </>
                ) : (
                  <>
                    <Mail className="mr-2 h-4 w-4" />
                    {t('auth.resendVerificationEmail')}
                  </>
                )}
              </Button>
            </form>
          </div>

          <div className="text-center pt-2">
            <Link 
              href="/login" 
              className="text-sm text-primary hover:underline"
              data-testid="link-back-to-login"
            >
              {t('auth.backToLogin')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
