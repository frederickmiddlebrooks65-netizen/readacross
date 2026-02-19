import { useState } from "react";
import { Link, useLocation } from "wouter";
import LegalModal from "./LegalModal";
import { useTranslation } from "@/i18n";

type LegalType = "terms" | "privacy" | "cookies" | null;

interface LegalLink {
  label: string;
  type: "terms" | "privacy" | "cookies";
  scrollTo: string | null;
}

interface NavLink {
  label: string;
  href: string;
}

type FooterLink =
  | { kind: "legal"; link: LegalLink }
  | { kind: "nav"; link: NavLink };

export default function Footer() {
  const currentYear = new Date().getFullYear();
  const [modalType, setModalType] = useState<LegalType>(null);
  const [scrollToSection, setScrollToSection] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const { t } = useTranslation();

  const footerLinks: FooterLink[] = [
    {
      kind: "legal",
      link: { label: t("footer.termsOfService"), type: "terms", scrollTo: null },
    },
    {
      kind: "legal",
      link: { label: t("footer.privacyPolicy"), type: "privacy", scrollTo: null },
    },
    {
      kind: "legal",
      link: { label: t("footer.cookiePolicy"), type: "cookies", scrollTo: null },
    },
    {
      kind: "legal",
      link: { label: t("footer.refundPolicy"), type: "terms", scrollTo: "article9" },
    },
    {
      kind: "nav",
      link: { label: t("footer.faq"), href: "/faq" },
    },
  ];

  const handleLegalClick = (type: LegalType, scrollTo: string | null) => {
    setModalType(type);
    setScrollToSection(scrollTo);
  };

  const handleModalClose = (open: boolean) => {
    if (!open) {
      setModalType(null);
      setScrollToSection(null);
    }
  };

  return (
    <>
      <footer
        className="w-full border-t border-border bg-background"
        data-testid="footer"
      >
        <div className="mx-auto max-w-[var(--page-max-width)] px-4 sm:px-6 lg:px-8 py-8">
          <div className="flex flex-col items-center text-center space-y-4">
            <nav
              className="flex flex-wrap justify-center gap-x-4 gap-y-2"
              data-testid="footer-nav"
            >
              {footerLinks.map((item, index) => (
                <span
                  key={item.kind === "legal" ? (item.link.scrollTo || item.link.type) : item.link.href}
                  className="flex items-center"
                >
                  {item.kind === "legal" ? (
                    <button
                      onClick={() => handleLegalClick(item.link.type, item.link.scrollTo)}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      data-testid={`link-${item.link.scrollTo || item.link.type}`}
                    >
                      {item.link.label}
                    </button>
                  ) : (
                    <Link
                      href={item.link.href}
                      className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                      data-testid={`link-${item.link.href.slice(1)}`}
                    >
                      {item.link.label}
                    </Link>
                  )}
                  {index < footerLinks.length - 1 && (
                    <span className="ml-4 text-muted-foreground/50 hidden sm:inline">
                      |
                    </span>
                  )}
                </span>
              ))}
            </nav>

            <div className="w-full max-w-md border-t border-border/50 pt-4" />

            <div
              className="space-y-1 text-gray-400"
              data-testid="footer-company-info"
              style={{ fontSize: "11px" }}
            >
              <p>오픈아이디어랩 (Open Idea Lab)</p>
              <p>
                이메일:{" "}
                <a
                  href="mailto:hello@readacross.io"
                  className="hover:text-gray-300 transition-colors"
                >
                  hello@readacross.io
                </a>
              </p>
              <p className="pt-1">현재 서비스 점검 및 사업자 정보 업데이트 중입니다.</p>
            </div>

            <p
              className="text-gray-400 pt-2"
              data-testid="footer-copyright"
              style={{ fontSize: "11px" }}
            >
              © {currentYear} 오픈아이디어랩 (Open Idea Lab).{" "}
              {t("footer.allRightsReserved")}
            </p>
          </div>
        </div>
      </footer>
      <LegalModal
        open={modalType !== null}
        onOpenChange={handleModalClose}
        type={modalType}
        scrollToSection={scrollToSection}
      />
    </>
  );
}
