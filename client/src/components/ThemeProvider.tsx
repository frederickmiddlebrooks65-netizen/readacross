"use client";

import * as React from "react";
import { createContext, useContext, useEffect, useState } from "react";

type Theme = "dark" | "light" | "system";

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  effectiveGlobalTheme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  effectiveGlobalTheme: "light",
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

// One-time migration function - must run before theme state initialization
function migrateOldThemeData() {
  if (typeof window === 'undefined') return;
  
  try {
    const migrationKey = 'cr:theme:migrated:v1';
    if (localStorage.getItem(migrationKey)) return;
    
    // Migrate legacy 'theme' key to 'ui-theme'
    const legacyTheme = localStorage.getItem('theme');
    const currentTheme = localStorage.getItem('ui-theme');
    
    if (legacyTheme && !currentTheme) {
      localStorage.setItem('ui-theme', legacyTheme);
      console.log('[ThemeProvider] Migrated legacy theme:', legacyTheme);
    }
    
    // Remove legacy theme key
    localStorage.removeItem('theme');
    
    // Migrate document-specific themes: 'follow' → 'inherit'
    const keys = Object.keys(localStorage);
    keys.forEach(key => {
      if (key.startsWith('immersive_doc_') && key.includes('_theme')) {
        const value = localStorage.getItem(key);
        // Handle both JSON-quoted and plain string values
        if (value === '"follow"' || value === 'follow') {
          localStorage.setItem(key, '"inherit"');
          console.log('[ThemeProvider] Migrated doc theme:', key, 'follow → inherit');
        }
      }
    });
    
    localStorage.setItem(migrationKey, 'true');
  } catch (e) {
    console.warn('[ThemeProvider] Migration failed:', e);
  }
}

export function ThemeProvider({
  children,
  defaultTheme = "system", // Restored to match pre-paint script behavior
  storageKey = "ui-theme",
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return defaultTheme;
    
    // Run migration BEFORE reading theme to ensure legacy data is available
    migrateOldThemeData();
    
    return (localStorage.getItem(storageKey) as Theme) || defaultTheme;
  });
  
  const [mounted, setMounted] = useState(false);
  const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window === 'undefined') return 'light';
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  // Calculate effective global theme
  const effectiveGlobalTheme: 'light' | 'dark' = React.useMemo(() => {
    return theme === 'system' ? systemTheme : theme;
  }, [theme, systemTheme]);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // System theme change listener
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    
    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    
    mediaQuery.addEventListener('change', handleSystemThemeChange);
    return () => mediaQuery.removeEventListener('change', handleSystemThemeChange);
  }, []);
  
  // Apply theme to document element
  useEffect(() => {
    if (!mounted) return;
    
    const root = window.document.documentElement;
    
    // Clean up any existing theme classes and apply current theme
    root.classList.remove('light', 'dark');
    root.classList.add(effectiveGlobalTheme);
  }, [effectiveGlobalTheme, mounted]);

  const value = {
    theme,
    effectiveGlobalTheme,
    setTheme: (theme: Theme) => {
      if (typeof window !== 'undefined') {
        localStorage.setItem(storageKey, theme);
      }
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};