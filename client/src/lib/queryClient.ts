import { QueryClient, QueryFunction } from "@tanstack/react-query";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest<T = any>(
  url: string,
  options: RequestInit & { json?: unknown } = {}
): Promise<T> {
  const headers = new Headers(options.headers || {});

  // Auto-set Content-Type for JSON requests
  if (options.json !== undefined) {
    headers.set('Content-Type', 'application/json');
    console.log('[apiRequest] JSON payload:', options.json);
  }

  // Public endpoints that don't require authentication
  const PUBLIC_ENDPOINTS = [
    '/api/auth/login',
    '/api/auth/signup',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/auth/verify-email',
    '/api/auth/resend-verification',
    '/api/library/explore',
    '/api/rss-feeds'
  ];

  const isPublicEndpoint = (url: string) => {
    return PUBLIC_ENDPOINTS.some(endpoint => url.includes(endpoint));
  };

  // Document detail endpoints (/api/documents/:id) can be accessed without auth for public documents
  const isDocumentDetailEndpoint = (url: string) => {
    return /^\/api\/documents\/\d+$/.test(url);
  };

  // Add authorization header if token exists
  const accessToken = localStorage.getItem('accessToken');
  if (accessToken && !isPublicEndpoint(url)) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  } else if (!isPublicEndpoint(url) && !isDocumentDetailEndpoint(url)) {
    // For non-public endpoints (except document detail), require authentication
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    throw new Error('Authentication required - no token found');
  }

  const requestOptions: RequestInit = {
    ...options,
    headers,
    credentials: options.credentials || "include",
    body: options.json !== undefined ? JSON.stringify(options.json) : options.body,
  };


  try {
    let res = await fetch(url, requestOptions);

    // Handle 403 Forbidden separately - this is for Pro features, not auth issues
    // Don't try to refresh token for 403, just throw with status for proper handling
    if (res.status === 403) {
      const errorData = await res.json().catch(() => ({ error: 'Forbidden' }));
      const error = new Error(errorData.message || errorData.error || 'Forbidden') as any;
      error.status = 403;
      error.response = { status: 403, data: errorData };
      throw error;
    }

    // Handle 401 Unauthorized - try token refresh
    if (res.status === 401 && accessToken) {
      const refreshToken = localStorage.getItem('refreshToken');
      if (refreshToken) {
        try {
          const refreshRes = await fetch('/api/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken }),
          });

          if (refreshRes.ok) {
            const { accessToken: newAccessToken } = await refreshRes.json();
            localStorage.setItem('accessToken', newAccessToken);

            // Retry original request with new token
            headers.set('Authorization', `Bearer ${newAccessToken}`);
            res = await fetch(url, { ...requestOptions, headers });
            await throwIfResNotOk(res);
            return res.status === 204 ? (null as T) : ((await res.json()) as T);
          }
        } catch (refreshError) {
          // Token refresh failed - clear tokens but don't redirect here
          localStorage.removeItem('accessToken');
          localStorage.removeItem('refreshToken');
          throw refreshError;
        }
      }

      // If refresh fails or no refresh token, clear tokens and throw
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      throw new Error('Authentication required');
    }

    await throwIfResNotOk(res);

    // Handle empty responses (204 No Content)
    return res.status === 204 ? (null as T) : ((await res.json()) as T);
  } catch (error) {
    // If it's a network error or other fetch error, just throw it
    throw error;
  }
}

export const getQueryFn = (): QueryFunction => {
  return async ({ queryKey }) => {
    return await apiRequest(queryKey[0] as string);
  };
};

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn(),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});