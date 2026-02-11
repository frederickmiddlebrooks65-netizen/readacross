import React from "react";
import Header from "./Header";
import Footer from "./Footer";

interface LayoutProps {
  children: React.ReactNode;
  showHeader?: boolean;
  showFooter?: boolean;
  lockBodyScroll?: boolean; // 기본: 스크롤 허용, Viewer 등에서만 true
}

export default function Layout({ children, showHeader = true, showFooter = true, lockBodyScroll = false }: LayoutProps) {
  // Apply body scroll lock only when needed
  React.useEffect(() => {
    if (lockBodyScroll) {
      document.body.classList.add('app-lock-scroll');
    } else {
      document.body.classList.remove('app-lock-scroll');
    }
    
    // Cleanup on unmount
    return () => {
      document.body.classList.remove('app-lock-scroll');
    };
  }, [lockBodyScroll]);

  return (
    <div className={lockBodyScroll ? "h-screen bg-background overflow-hidden flex flex-col" : "min-h-screen bg-background flex flex-col"}>
      {showHeader && <Header />}
      <main className="w-full px-2 flex-1">
        {children}
      </main>
      {showFooter && !lockBodyScroll && <Footer />}
    </div>
  );
}
