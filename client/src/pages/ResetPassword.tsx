import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Lock, CheckCircle2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { apiRequest } from "@/lib/queryClient";

export default function ResetPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [token, setToken] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    password: "",
    confirmPassword: ""
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [resetSuccess, setResetSuccess] = useState(false);
  const [invalidToken, setInvalidToken] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get('token');
    
    if (!resetToken) {
      setInvalidToken(true);
    } else {
      setToken(resetToken);
    }
  }, []);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.password) {
      newErrors.password = t('auth.passwordRequired');
    } else if (formData.password.length < 8) {
      newErrors.password = t('auth.passwordMinLength');
    } else if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(formData.password)) {
      newErrors.password = t('auth.passwordRequirements');
    }

    if (formData.password !== formData.confirmPassword) {
      newErrors.confirmPassword = t('auth.passwordMismatch');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate() || !token) return;

    setIsLoading(true);
    setErrors({});

    try {
      await apiRequest('/api/auth/reset-password', {
        method: 'POST',
        json: {
          token,
          newPassword: formData.password
        }
      });

      setResetSuccess(true);
      toast({
        title: t('auth.passwordResetSuccess'),
        description: t('auth.passwordResetSuccessDescription'),
      });

      // Redirect to login after 3 seconds
      setTimeout(() => {
        setLocation('/login');
      }, 3000);

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
      
      if (errorDetail.toLowerCase().includes('token') || errorDetail.toLowerCase().includes('expired')) {
        setInvalidToken(true);
      } else if (errorField) {
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

  if (invalidToken) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-red-100 dark:bg-red-900 rounded-full flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <CardTitle className="text-2xl font-bold">{t('auth.invalidResetLink')}</CardTitle>
            <CardDescription>
              {t('auth.invalidResetLinkDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {t('auth.resetLinkExpiredOrInvalid')}
              </AlertDescription>
            </Alert>

            <div className="flex flex-col gap-2">
              <Button
                onClick={() => setLocation('/forgot-password')}
                data-testid="button-request-new-link"
              >
                {t('auth.requestNewResetLink')}
              </Button>
              <Button
                variant="outline"
                onClick={() => setLocation('/login')}
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

  if (resetSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-2xl font-bold">{t('auth.passwordResetSuccess')}</CardTitle>
            <CardDescription>
              {t('auth.passwordResetSuccessMessage')}
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
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">{t('auth.resetPassword')}</CardTitle>
          <CardDescription className="text-center">
            {t('auth.resetPasswordDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="password">{t('auth.newPassword')}</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder={t('auth.passwordPlaceholder')}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="pl-10"
                  data-testid="input-password"
                  disabled={isLoading}
                  autoFocus
                />
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password}</p>
              )}
              <p className="text-xs text-muted-foreground">
                {t('auth.passwordRequirementsHint')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">{t('auth.confirmPassword')}</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder={t('auth.confirmPasswordPlaceholder')}
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  className="pl-10"
                  data-testid="input-confirm-password"
                  disabled={isLoading}
                />
              </div>
              {errors.confirmPassword && (
                <p className="text-sm text-destructive">{errors.confirmPassword}</p>
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
                  {t('auth.resettingPassword')}
                </>
              ) : (
                t('auth.resetPassword')
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
