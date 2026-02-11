import React, { useState, useEffect, useRef, ReactNode } from "react";

interface ImmersiveShellProps {
  children: ReactNode;
  theme?: "follow" | "light" | "dark" | "sepia";
  onShowUI?: (show: boolean) => void;
  onShowRightDrawer?: (show: boolean) => void;
  rightDrawerOpen?: boolean;
  className?: string;
  useSerif?: boolean;
  disableAutoOpen?: boolean; // 자동 열기 비활성화 플래그
  headerHasOpenMenu?: boolean; // 헤더 메뉴 열림 상태
  isAIDrawerOpen?: boolean; // AI drawer 열림 상태 - 열려있으면 모든 호버 동작 비활성화
}

/**
 * ImmersiveShell - 몰입형 리더를 위한 메인 컨테이너
 *
 * 주요 기능:
 * - 테마 스코프 컨테이너 (data-theme 속성)
 * - 마우스 모서리 접근 시 UI 표시
 * - 전체 화면 몰입형 레이아웃
 */
export default function ImmersiveShell({
  children,
  theme = "follow",
  onShowUI,
  onShowRightDrawer,
  rightDrawerOpen = false,
  className = "",
  useSerif = false,
  disableAutoOpen = false,
  headerHasOpenMenu = false,
  isAIDrawerOpen = false,
}: ImmersiveShellProps) {
  const [showUIControls, setShowUIControls] = useState(true);
  const mouseTimeoutRef = useRef<number | null>(null);
  const drawerTriggerTimeoutRef = useRef<number | null>(null); // 드로어 트리거 전용 timeout
  const containerRef = useRef<HTMLDivElement>(null);

  const EDGE = 180; // 트리거 영역 180px로 확대 - 더 넓은 호버 영역으로 사용성 개선
  const DELAY = 150; // 자연스러운 지연

  const cancelDrawerOpen = () => {
    if (drawerTriggerTimeoutRef.current !== null) {
      clearTimeout(drawerTriggerTimeoutRef.current);
      drawerTriggerTimeoutRef.current = null;
    }
  };

  // 마우스 가장자리 감지 및 UI/사이드패널 표시/숨김 제어
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const { clientY, clientX } = e;
      const windowWidth = window.innerWidth;

      // AI Drawer나 Reader Panel이 열려있으면 모든 호버 동작 비활성화
      if (isAIDrawerOpen || rightDrawerOpen) {
        return;
      }

      // 상단 64px 영역에서 UI 표시 (10% -> 64px 고정)
      // 사이드패널이 열려있어도 상단 헤더는 표시 가능
      const shouldShowUI = clientY < 64;

      // 우측 EDGE px 영역에서 사이드패널 표시 트리거 (더 넓은 거리)
      const nearRightEdge = clientX >= windowWidth - EDGE;

      // 직접 UI 상태 설정
      setShowUIControls(shouldShowUI);

      // 타임아웃 정리
      if (mouseTimeoutRef.current !== null) {
        clearTimeout(mouseTimeoutRef.current);
        mouseTimeoutRef.current = null;
      }

      // UI 표시/숨김 제어 - 메뉴가 열려있으면 숨기지 않음
      if (!shouldShowUI && !headerHasOpenMenu) {
        mouseTimeoutRef.current = window.setTimeout(() => {
          setShowUIControls(false);
          onShowUI?.(false);
          mouseTimeoutRef.current = null;
        }, 300);
      } else {
        onShowUI?.(true);
      }

      // 사이드패널 자동 열기 로직 제거됨 - 이제 버튼으로만 열림
      // Reader Panel은 헤더의 버튼을 통해서만 열립니다
      if (!nearRightEdge) {
        cancelDrawerOpen();
      }
    };

    // 마우스 아웃 핸들러: 윈도우 벗어날 때 타이머 취소
    const handleMouseOut = (e: MouseEvent) => {
      // When leaving the window (relatedTarget is null), cancel pending timers
      if (!e.relatedTarget) {
        if (mouseTimeoutRef.current !== null) {
          clearTimeout(mouseTimeoutRef.current);
          mouseTimeoutRef.current = null;
        }
        cancelDrawerOpen();
      }
    };

    // 마우스 이벤트 리스너 등록
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseout", handleMouseOut);

    // 초기에는 UI 표시, 2초 후 숨김
    const initialTimeout = window.setTimeout(() => {
      setShowUIControls(false);
      onShowUI?.(false);
    }, 2000);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseout", handleMouseOut);
      if (mouseTimeoutRef.current !== null) {
        clearTimeout(mouseTimeoutRef.current);
        mouseTimeoutRef.current = null;
      }
      cancelDrawerOpen();
      clearTimeout(initialTimeout);
    };
  }, [
    onShowUI,
    onShowRightDrawer,
    rightDrawerOpen,
    disableAutoOpen,
    headerHasOpenMenu,
    isAIDrawerOpen,
  ]); // dependency 업데이트

  // 드로어가 열리거나 자동열기 비활성화시 대기중 타이머 취소
  useEffect(() => {
    if (rightDrawerOpen || disableAutoOpen) {
      cancelDrawerOpen();
    }
  }, [rightDrawerOpen, disableAutoOpen]);

  // 테마 데이터 속성 설정
  const themeAttribute = theme === "follow" ? undefined : theme;

  return (
    <div
      ref={containerRef}
      className={`ImmersiveShell flex flex-col h-screen overflow-hidden bg-background ${className}`}
      data-theme={themeAttribute}
      data-serif={useSerif}
      data-show-ui={showUIControls}
    >
      {/* Edge hover trigger completely removed - Reader Panel opens only via header button */}
      {children}
    </div>
  );
}
