import { useState } from "react";
import { useLocation, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Mail, Lock, User, CheckCircle2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/i18n";
import { apiRequest } from "@/lib/queryClient";
import { SiGoogle } from "react-icons/si";

export default function Signup() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: ""
  });
  
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.username.trim()) {
      newErrors.username = t('auth.usernameRequired');
    } else if (formData.username.length < 3) {
      newErrors.username = t('auth.usernameMinLength');
    } else if (!/^[a-zA-Z0-9_]+$/.test(formData.username)) {
      newErrors.username = t('auth.usernameInvalid');
    }

    if (!formData.email.trim()) {
      newErrors.email = t('auth.emailRequired');
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = t('auth.emailInvalid');
    }

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
    
    if (!validate()) return;

    setIsLoading(true);
    setErrors({});

    try {
      await apiRequest('/api/auth/signup', {
        method: 'POST',
        json: {
          username: formData.username,
          email: formData.email,
          password: formData.password
        }
      });

      setSignupSuccess(true);
      toast({
        title: t('auth.signupSuccess'),
        description: t('auth.signupSuccessDescription'),
      });

    } catch (error: any) {
      let errorDetail = t('auth.signupErrorGeneric');
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
          title: t('auth.signupError'),
          description: errorDetail,
          variant: "destructive"
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (signupSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center space-y-4">
            <div className="mx-auto w-12 h-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
            </div>
            <CardTitle className="text-2xl font-bold">{t('auth.checkYourEmail')}</CardTitle>
            <CardDescription>
              {t('auth.checkYourEmailDescription')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Alert>
              <Mail className="h-4 w-4" />
              <AlertDescription>
                {t('auth.verificationEmailSent', { email: formData.email })}
              </AlertDescription>
            </Alert>
            
            <div className="text-center pt-4">
              <Button
                variant="outline"
                onClick={() => setLocation('/login')}
                data-testid="button-goto-login"
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
          <CardTitle className="text-2xl font-bold text-center">{t('auth.createAccount')}</CardTitle>
          <CardDescription className="text-center">
            {t('auth.signupDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* OAuth Option */}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            size="lg"
            onClick={() => window.location.href = '/api/auth/google'}
            data-testid="button-google-signup"
          >
            <SiGoogle className="mr-2 h-5 w-5" />
            {t('auth.signupWithGoogle')}
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

          {/* Email/Password Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{t('auth.username')}</Label>
              <div className="relative">
                <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="username"
                  type="text"
                  placeholder={t('auth.usernamePlaceholder')}
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  className="pl-10"
                  data-testid="input-username"
                  disabled={isLoading}
                />
              </div>
              {errors.username && (
                <p className="text-sm text-destructive">{errors.username}</p>
              )}
            </div>

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
              <Label htmlFor="password">{t('auth.password')}</Label>
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
              data-testid="button-signup"
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('auth.creatingAccount')}
                </>
              ) : (
                t('auth.createAccount')
              )}
            </Button>
          </form>

          <div className="text-center text-sm text-muted-foreground pt-2">
            {t('auth.alreadyHaveAccount')}{' '}
            <Link href="/login" className="text-primary hover:underline" data-testid="link-login">
              {t('auth.login')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
