import { useEffect, useCallback } from 'react';

interface KeyboardShortcutCallbacks {
  onEscape?: () => void;
  onPrevPage?: () => void; // ←
  onNextPage?: () => void; // →
  onTogglePanel?: () => void; // P
  onShowHeader?: () => void; // H
}

interface KeyboardShortcutsOptions {
  enabled?: boolean;
  preventDefaultOnMatch?: boolean;
}

/**
 * 몰입형 리더용 키보드 단축키 훅
 * 
 * 지원 단축키:
 * - ←: 이전 페이지
 * - →: 다음 페이지  
 * - P: 사이드 패널 토글
 * - H: 슬림 헤더 강제 표시
 * 
 * 컨텍스트 규칙:
 * - 입력 필드에 포커스가 있을 때는 전역 단축키 비활성화
 * - preventDefault()로 브라우저 기본 동작과 충돌 방지
 */
export function useKeyboardShortcuts(
  callbacks: KeyboardShortcutCallbacks,
  options: KeyboardShortcutsOptions = {}
) {
  const {
    enabled = true,
    preventDefaultOnMatch = true,
  } = options;

  // 현재 포커스가 입력 필드에 있는지 확인
  const isInputFocused = useCallback(() => {
    const activeElement = document.activeElement;
    if (!activeElement) return false;
    
    const tagName = activeElement.tagName.toLowerCase();
    const isContentEditable = activeElement.getAttribute('contenteditable') === 'true';
    const isInput = ['input', 'textarea', 'select'].includes(tagName);
    
    return isInput || isContentEditable;
  }, []);

  // 키보드 이벤트 핸들러
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    console.log('[DEBUG] Key pressed:', event.key, 'enabled:', enabled, 'isInputFocused:', isInputFocused());
    
    // 비활성화된 상태면 무시
    if (!enabled) return;
    
    // 입력 필드에 포커스가 있으면 전역 단축키 비활성화
    if (isInputFocused()) {
      return;
    }
    
    const { key, ctrlKey, metaKey } = event;
    const isModifierPressed = ctrlKey || metaKey;
    let handled = false;

    // ← - 이전 페이지 (단독 키)
    if (key === 'ArrowLeft' && !isModifierPressed) {
      callbacks.onPrevPage?.();
      handled = true;
    }
    
    // → - 다음 페이지 (단독 키)
    if (key === 'ArrowRight' && !isModifierPressed) {
      callbacks.onNextPage?.();
      handled = true;
    }
    
    // P - 패널 토글 (입력 필드가 아닐 때만)
    if (key.toLowerCase() === 'p' && !isModifierPressed && !isInputFocused()) {
      callbacks.onTogglePanel?.();
      handled = true;
    }
    
    // H - 헤더 표시 (입력 필드가 아닐 때만)
    if (key.toLowerCase() === 'h' && !isModifierPressed && !isInputFocused()) {
      callbacks.onShowHeader?.();
      handled = true;
    }

    // 처리된 이벤트면 기본 동작 방지
    if (handled && preventDefaultOnMatch) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, [enabled, callbacks, isInputFocused, preventDefaultOnMatch]);

  // 이벤트 리스너 등록/해제
  useEffect(() => {
    if (!enabled) return;

    window.document.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.document.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, handleKeyDown]);

  return {
    isInputFocused,
  };
}

export default useKeyboardShortcuts;