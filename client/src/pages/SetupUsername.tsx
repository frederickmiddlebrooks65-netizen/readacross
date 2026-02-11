import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useToast } from '@/hooks/use-toast';
import { useTranslation } from '@/i18n';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { CheckCircle2, Loader2, UserCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

type UsernameFormData = {
  username: string;
};

export default function SetupUsername() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const { t } = useTranslation();
  const { user, isLoading: isAuthLoading } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCheckingUsername, setIsCheckingUsername] = useState(false);
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [isExchangingSession, setIsExchangingSession] = useState(true);

  const usernameSchema = z.object({
    username: z.string()
      .min(3, t('auth.usernameMinLength'))
      .max(30, t('auth.usernameMaxLength'))
      .regex(/^[a-zA-Z0-9_-]+$/, t('auth.usernameInvalidChars')),
  });

  const form = useForm<UsernameFormData>({
    resolver: zodResolver(usernameSchema),
    defaultValues: {
      username: '',
    },
  });

  // Exchange session for tokens on mount (for OAuth flow)
  useEffect(() => {
    const exchangeSession = async () => {
      // Check if we already have tokens
      const accessToken = localStorage.getItem('accessToken');
      if (accessToken) {
        setIsExchangingSession(false);
        return;
      }

      // Exchange session for tokens
      try {
        const response = await fetch('/api/auth/session', {
          method: 'POST',
          credentials: 'include', // Include session cookie
          headers: {
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error('Failed to exchange session');
        }

        const data = await response.json();
        
        // Store tokens
        localStorage.setItem('accessToken', data.accessToken);
        localStorage.setItem('refreshToken', data.refreshToken);
        
        // Invalidate auth queries to refetch user data
        queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
        
        setIsExchangingSession(false);
      } catch (error) {
        console.error('Session exchange error:', error);
        toast({
          title: t('common.error'),
          description: t('auth.authError'),
          variant: 'destructive',
        });
        setTimeout(() => setLocation('/login'), 1500);
      }
    };

    exchangeSession();
  }, [toast, setLocation, t]);

  // Set default username from current user
  useEffect(() => {
    if (user && user.username) {
      form.setValue('username', user.username);
    }
  }, [user, form]);

  // Redirect if user doesn't need username setup
  useEffect(() => {
    if (!isAuthLoading && !isExchangingSession && user) {
      // If user already completed username setup, redirect to library
      if (user.needsUsernameSetup === false) {
        setLocation('/library');
      }
    }
  }, [user, isAuthLoading, isExchangingSession, setLocation]);

  // Check username availability when typing stops
  useEffect(() => {
    const username = form.watch('username');
    
    if (!username || username === user?.username) {
      setUsernameAvailable(null);
      return;
    }

    // Validate format first
    const validation = usernameSchema.safeParse({ username });
    if (!validation.success) {
      setUsernameAvailable(null);
      return;
    }

    const timer = setTimeout(async () => {
      setIsCheckingUsername(true);
      try {
        const response = await fetch(`/api/auth/check-username?username=${encodeURIComponent(username)}`);
        const data = await response.json();
        setUsernameAvailable(data.available);
      } catch (error) {
        console.error('Error checking username:', error);
        setUsernameAvailable(null);
      } finally {
        setIsCheckingUsername(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [form.watch('username'), user?.username]);

  const onSubmit = async (data: UsernameFormData) => {
    if (usernameAvailable === false) {
      form.setError('username', {
        type: 'manual',
        message: t('auth.usernameTaken'),
      });
      return;
    }

    setIsSubmitting(true);
    
    // Debug: log what we're sending
    console.log('[SetupUsername] Submitting username:', data.username);
    console.log('[SetupUsername] Form data:', data);
    
    try {
      const requestPayload = { username: data.username };
      console.log('[SetupUsername] Request payload:', requestPayload);
      
      await apiRequest('/api/auth/setup-username', {
        method: 'POST',
        json: requestPayload,
      });

      // Refresh auth state to get updated user with needsUsernameSetup = false
      await queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });

      toast({
        title: t('auth.welcomeMessage'),
        description: t('auth.usernameSetSuccess'),
      });

      // Redirect to library
      setTimeout(() => {
        setLocation('/library');
      }, 500);
    } catch (error: any) {
      console.error('Setup username error:', error);
      
      const errorMessage = error.message || t('auth.usernameError');
      
      if (errorMessage.includes('already taken') || errorMessage.includes('USERNAME_TAKEN')) {
        form.setError('username', {
          type: 'manual',
          message: t('auth.usernameTaken'),
        });
      } else {
        toast({
          title: t('common.error'),
          description: errorMessage,
          variant: 'destructive',
        });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isAuthLoading || isExchangingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/20">
        <div className="text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">{t('common.authenticating')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/20 p-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="space-y-3 text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
            <UserCircle className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">{t('auth.usernameSetup')}</CardTitle>
          <CardDescription>
            {t('auth.usernameWelcome')} {t('auth.usernamePrompt')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('auth.usernameLabel')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          placeholder="username"
                          autoComplete="username"
                          disabled={isSubmitting}
                          data-testid="input-username"
                        />
                        {isCheckingUsername && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        )}
                        {!isCheckingUsername && usernameAvailable === true && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2">
                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                          </div>
                        )}
                      </div>
                    </FormControl>
                    <FormDescription>
                      {t('auth.usernameDescription')}
                    </FormDescription>
                    <FormMessage />
                    {usernameAvailable === false && (
                      <p className="text-sm text-destructive">{t('auth.usernameTaken')}</p>
                    )}
                  </FormItem>
                )}
              />

              <Alert className="bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
                <AlertDescription className="text-sm text-blue-900 dark:text-blue-100">
                  {t('auth.usernameChangeNote')}
                </AlertDescription>
              </Alert>

              <Button
                type="submit"
                className="w-full"
                disabled={isSubmitting || isCheckingUsername || usernameAvailable === false}
                data-testid="button-submit"
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t('auth.settingUp')}
                  </>
                ) : (
                  t('auth.startButton')
                )}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
