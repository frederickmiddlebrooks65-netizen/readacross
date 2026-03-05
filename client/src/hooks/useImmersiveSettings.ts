import { useState, useEffect, useCallback } from 'react';
import { ViewMode } from '@/lib/types.d';
import { useTheme } from '@/components/ThemeProvider';

export interface ImmersiveSettings {
  // Theme settings  
  theme: 'follow' | 'inherit' | 'light' | 'dark' | 'sepia';
  
  // Typography settings
  fontSize: number;
  lineHeight: number;
  useSerif: boolean;
  documentWidth: number;
  
  // View settings
  viewMode: ViewMode;
  showRightDrawer: boolean;
  showHoverTooltip: boolean;
  
  // Layout settings
  immersiveMode: boolean;
}

interface DocumentSettings extends ImmersiveSettings {
  documentId?: number;
}

const DEFAULT_SETTINGS: ImmersiveSettings = {
  theme: 'follow',
  fontSize: 16,
  lineHeight: 1.6,
  useSerif: false,
  documentWidth: 1000,
  viewMode: 'side-by-side',
  showRightDrawer: true,
  showHoverTooltip: true,
  immersiveMode: true,
};

/**
 * 몰입형 리더 설정 관리 훅
 * 
 * 기능:
 * - localStorage와 서버 동기화
 * - 문서별 설정 오버라이드
 * - URL 파라미터 지원
 * - 전역/문서별 테마 우선순위 관리
 */
export function useImmersiveSettings(documentId?: number) {
  const [settings, setSettings] = useState<ImmersiveSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // LocalStorage 키 생성
  const getStorageKey = useCallback((key: keyof ImmersiveSettings) => {
    if (documentId) {
      return `immersive_doc_${documentId}_${key}`;
    }
    return `immersive_global_${key}`;
  }, [documentId]);

  // LocalStorage에서 설정 로드
  const loadFromStorage = useCallback(() => {
    try {
      const stored: Partial<ImmersiveSettings> = {};
      
      Object.keys(DEFAULT_SETTINGS).forEach((key) => {
        const storageKey = getStorageKey(key as keyof ImmersiveSettings);
        const value = localStorage.getItem(storageKey);
        
        if (value !== null) {
          try {
            stored[key as keyof ImmersiveSettings] = JSON.parse(value);
          } catch {
            // Fallback for simple string values
            (stored as any)[key] = value;
          }
        }
      });

      // URL 파라미터 처리
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('immersive') === '1') {
        stored.immersiveMode = true;
      }

      return { ...DEFAULT_SETTINGS, ...stored };
    } catch (err) {
      console.warn('Failed to load settings from localStorage:', err);
      return DEFAULT_SETTINGS;
    }
  }, [getStorageKey]);

  // LocalStorage에 설정 저장
  const saveToStorage = useCallback((newSettings: Partial<ImmersiveSettings>) => {
    try {
      Object.entries(newSettings).forEach(([key, value]) => {
        const storageKey = getStorageKey(key as keyof ImmersiveSettings);
        localStorage.setItem(storageKey, JSON.stringify(value));
      });
    } catch (err) {
      console.warn('Failed to save settings to localStorage:', err);
    }
  }, [getStorageKey]);

  // 서버에 설정 동기화 (향후 구현)
  const syncToServer = useCallback(async (newSettings: Partial<DocumentSettings>) => {
    if (!documentId) return;
    
    try {
      // TODO: 서버 API 호출 구현
      // await apiRequest('/api/user-preferences/documents', {
      //   method: 'PATCH',
      //   json: {
      //     documentId,
      //     settings: newSettings
      //   }
      // });
    } catch (err) {
      console.warn('Failed to sync settings to server:', err);
      setError('Failed to sync settings to server');
    }
  }, [documentId]);

  // 설정 업데이트
  const updateSettings = useCallback((updates: Partial<ImmersiveSettings>) => {
    setSettings(current => {
      const newSettings = { ...current, ...updates };
      
      // LocalStorage에 저장
      saveToStorage(updates);
      
      // 서버에 동기화 (비동기)
      syncToServer(updates);
      
      return newSettings;
    });
  }, [saveToStorage, syncToServer]);

  // 특정 설정 업데이트
  const updateSetting = useCallback(<K extends keyof ImmersiveSettings>(
    key: K,
    value: ImmersiveSettings[K]
  ) => {
    updateSettings({ [key]: value } as Partial<ImmersiveSettings>);
  }, [updateSettings]);

  // 설정 리셋
  const resetSettings = useCallback(() => {
    try {
      // localStorage 클리어
      Object.keys(DEFAULT_SETTINGS).forEach((key) => {
        const storageKey = getStorageKey(key as keyof ImmersiveSettings);
        localStorage.removeItem(storageKey);
      });
      
      setSettings(DEFAULT_SETTINGS);
      setError(null);
    } catch (err) {
      console.warn('Failed to reset settings:', err);
      setError('Failed to reset settings');
    }
  }, [getStorageKey]);

  // useTheme context에서 전역 테마 정보 가져오기
  const { effectiveGlobalTheme } = useTheme();

  // 유효한 테마 계산 (follow/inherit -> 전역 테마 사용)
  const getEffectiveTheme = useCallback((): 'light' | 'dark' | 'sepia' => {
    if (settings.theme === 'follow' || settings.theme === 'inherit') {
      // 전역 테마 설정을 따라감 (통합된 ThemeProvider 사용)
      return effectiveGlobalTheme;
    }
    return settings.theme;
  }, [settings.theme, effectiveGlobalTheme]);

  // 초기 설정 로드
  useEffect(() => {
    setIsLoading(true);
    try {
      const loadedSettings = loadFromStorage();
      setSettings(loadedSettings);
      setError(null);
    } catch (err) {
      console.error('Failed to initialize settings:', err);
      setError('Failed to load settings');
      setSettings(DEFAULT_SETTINGS);
    } finally {
      setIsLoading(false);
    }
  }, [loadFromStorage]);

  // Note: Global theme change detection is handled automatically via useTheme context
  // When effectiveGlobalTheme changes, this component re-renders and getEffectiveTheme
  // returns the updated value. No manual effect needed.

  return {
    settings,
    updateSettings,
    updateSetting,
    resetSettings,
    getEffectiveTheme,
    isLoading,
    error,
  };
}

export default useImmersiveSettings;