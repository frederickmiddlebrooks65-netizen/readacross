import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Mail, Lock, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { apiRequest } from "@/lib/queryClient";
import { SiGoogle } from "react-icons/si";

export default function Login() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const [serverError, setServerError] = useState<string>("");
  const [formData, setFormData] = useState({
    email: "",
    password: ""
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);

  // Handle OAuth callback - exchange session for tokens
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthSuccess = params.get('oauth_success');
    const error = params.get('error');

    if (error) {
      setServerError(decodeURIComponent(error));
      // Clean URL
      window.history.replaceState({}, '', '/login');
    } else if (oauthSuccess === 'true') {
      // Exchange session for tokens via secure API call
      (async () => {
        try {
          const response = await fetch('/api/auth/session', {
            method: 'POST',
            credentials: 'include', // Include session cookie
            headers: {
              'Content-Type': 'application/json',
            },
          });

          if (!response.ok) {
            setServerError(t('auth.loginError'));
            window.history.replaceState({}, '', '/login');
            return;
          }

          const data = await response.json();
          
          // Store tokens in localStorage
          localStorage.setItem('accessToken', data.accessToken);
          localStorage.setItem('refreshToken', data.refreshToken);

          toast({
            title: t('auth.loginSuccess'),
            description: t('auth.loginSuccessDescription'),
          });

          // Clean URL and redirect
          window.history.replaceState({}, '', '/login');
          setLocation('/');
        } catch (error) {
          setServerError(t('auth.loginError'));
          window.history.replaceState({}, '', '/login');
        }
      })();
    }
  }, [setLocation, toast, t]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.email.trim()) {
      newErrors.email = t('auth.emailRequired');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = t('auth.emailInvalid');
    }

    if (!formData.password) {
      newErrors.password = t('auth.passwordRequired');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validate()) return;

    setIsLoading(true);
    setErrors({});
    setServerError("");

    try {
      const response = await apiRequest('/api/auth/login', {
        method: 'POST',
        json: {
          email: formData.email,
          password: formData.password
        }
      });

      // Store tokens
      localStorage.setItem('accessToken', response.accessToken);
      localStorage.setItem('refreshToken', response.refreshToken);

      toast({
        title: t('auth.loginSuccess'),
        description: t('auth.loginSuccessDescription'),
      });

      setLocation('/');
    } catch (error: any) {
      let errorDetail = t('auth.loginErrorGeneric');
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
        setServerError(errorDetail);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold text-center">{t('auth.welcome')}</CardTitle>
          <CardDescription className="text-center">
            {t('auth.loginDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {serverError && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {serverError}
              </AlertDescription>
            </Alert>
          )}

          <Button
            type="button"
            variant="outline"
            className="w-full"
            size="lg"
            onClick={() => window.location.href = '/api/auth/google'}
            data-testid="button-google-login"
          >
            <SiGoogle className="mr-2 h-5 w-5" />
            {t('auth.googleLogin')}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">
                {t('auth.orContinueWith')}
              </span>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">{t('auth.email')}</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder={t('auth.emailPlaceholder')}
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="pl-10"
                  data-testid="input-email"
                  disabled={isLoading}
                />
              </div>
              {errors.email && (
                <p className="text-sm text-destructive">{errors.email}</p>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">{t('auth.password')}</Label>
                <Link 
                  href="/forgot-password" 
                  className="text-xs text-primary hover:underline"
                  data-testid="link-forgot-password"
                >
                  {t('auth.forgotPassword')}
                </Link>
              </div>
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
                />
              </div>
              {errors.password && (
                <p className="text-sm text-destructive">{errors.password}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full"
              size="lg"
              disabled={isLoading}
              data-testid="button-login"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('auth.loggingIn')}
                </>
              ) : (
                t('auth.login')
              )}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground pt-2">
            {t('auth.dontHaveAccount')}{' '}
            <Link href="/signup" className="text-primary hover:underline" data-testid="link-signup">
              {t('auth.signup')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
