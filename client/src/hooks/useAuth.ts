import React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest } from "@/lib/queryClient";

export interface User {
  id: number;
  username: string;
  email: string;
  role: string;
  status: string;
  plan: "starter" | "pro" | "admin" | "beta_pro";
  planType?: string | null;
  planExpiresAt?: string | null;
  emailVerifiedAt?: string;
  lastLoginAt?: string;
  oauthProvider?: string | null;
  oauthProviderId?: string | null;
  needsUsernameSetup?: boolean;
}

export function useAuth() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const accessToken = localStorage.getItem('accessToken');
  const refreshToken = localStorage.getItem('refreshToken');

  // Auto-refresh token when close to expiry (15 minutes before)
  React.useEffect(() => {
    if (!accessToken) return;

    try {
      const payload = JSON.parse(atob(accessToken.split('.')[1]));
      const expiryTime = payload.exp * 1000;
      const timeUntilExpiry = expiryTime - Date.now();
      const refreshTime = Math.max(0, timeUntilExpiry - 15 * 60 * 1000); // 15 minutes before expiry

      if (refreshTime > 0) {
        const timeoutId = setTimeout(async () => {
          const currentRefreshToken = localStorage.getItem('refreshToken');
          if (currentRefreshToken) {
            try {
              const response = await apiRequest('/api/auth/refresh', {
                method: 'POST',
                json: { refreshToken: currentRefreshToken }
              });

              if (response.accessToken) {
                localStorage.setItem('accessToken', response.accessToken);
                queryClient.invalidateQueries({ queryKey: ['/api/auth/me'] });
              }
            } catch (error) {
              // Auto-refresh failed silently
            }
          }
        }, refreshTime);

        return () => clearTimeout(timeoutId);
      }
    } catch (error) {
      // Failed to parse token silently
    }
  }, [accessToken, queryClient]);

  const { data: authResponse, isLoading, error } = useQuery({
    queryKey: ['/api/auth/me'],
    enabled: !!accessToken, // Only run if we have a token
    retry: false,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: true,
  });

  // Extract user from the auth response - server returns { message, user }
  const user = (authResponse as { message?: string; user: User } | undefined)?.user;

  const hasValidTokens = !!accessToken && !!refreshToken;
  const isTokenExpired = error && (
    (error as any).message?.includes('401') || 
    (error as any).message?.includes('403') ||
    (error as any).status === 401 ||
    (error as any).status === 403
  );

  React.useEffect(() => {
    if (isTokenExpired) {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      queryClient.clear();
    }
  }, [isTokenExpired, queryClient]);

  const isAuthenticated = hasValidTokens && !!user && !error && !isTokenExpired;

  // Logout mutation
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          await apiRequest('/api/auth/logout', {
            method: 'POST',
            json: { refreshToken },
          });
        } catch (error) {
          // Logout API failed, but continue with cleanup
        }
      }
    },
    onSettled: () => {
      // Clear tokens and redirect regardless of logout API success/failure
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');

      // Clear all queries and reset query client
      queryClient.clear();
      queryClient.resetQueries();
      queryClient.invalidateQueries();

      setLocation('/login');
    }
  });

  // Redirect to login if not authenticated (for protected routes)
  const requireAuth = () => {
    if (!isLoading && !isAuthenticated) {
      setLocation('/login');
    }
  };

  return {
    user,
    isLoading,
    isAuthenticated,
    requireAuth,
    logout: () => logoutMutation.mutate()
  };
}