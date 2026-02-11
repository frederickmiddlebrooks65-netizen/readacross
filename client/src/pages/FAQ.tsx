import { useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "@/i18n";
import Layout from "@/components/Layout";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FAQItem {
  question: string;
  answer: string;
}

interface FAQSection {
  title: string;
  items: FAQItem[];
}

function getFAQData(lang: string): FAQSection[] {
  if (lang === "ko") {
    return [
      {
        title: "서비스 기본",
        items: [
          {
            question: "ReadAcross는 어떤 서비스인가요?",
            answer:
              "ReadAcross는 논문, 에세이, 리포트와 같은 학술 문서에서 문학 작품까지 다양한 장문의 원문을 깊이 있게 읽고 이해하도록 돕는 AI 기반 리딩·학습 서비스입니다.\n\nReadAcross의 핵심은 전체 문서 단위의 AI 번역 기능입니다. 사용자는 원문 전체를 AI로 번역하고, 원문과 번역문을 나란히 비교하며 읽을 수 있습니다. 문서의 각 문단·문장을 클릭하여 원문과 번역을 즉시 대조하고, 필요한 부분에 하이라이트, 노트 작성, 그리고 해당 맥락에서 AI에게 질문할 수 있습니다.\n\n또한 번역문을 직접 수정·편집할 수 있어, 번역 연습이나 외국어 학습에도 활용할 수 있습니다. AI는 단순 요약이 아니라, 깊이 있는 이해와 분석, 문맥 속에서의 해석을 지원합니다. ReadAcross는 AI가 대신 읽어주는 서비스가 아니라, AI와 함께 읽고, 번역하고, 스스로 사고하며 학습할 수 있도록 돕는 도구입니다.",
          },
          {
            question: "Practice Hub는 무엇인가요?",
            answer:
              "Practice Hub는 요약된 내용을 잊지 않도록 AI가 퀴즈를 내주거나 복습 리마인드를 제공하는 공간입니다. 읽은 내용을 완전히 자신의 것으로 만들 수 있도록 돕는 ReadAcross만의 핵심 기능이며, 학습 효과를 극대화하는 데 중점을 둡니다.",
          },
          {
            question: "어떤 언어를 지원하나요?",
            answer:
              "현재 한국어와 영어를 완벽하게 지원하며, 원문이 어떤 언어든 사용자가 설정한 언어로 번역, 읽기, 분석이 가능합니다. 앞으로도 다양한 언어 지원을 확대해 나갈 예정입니다.",
          },
        ],
      },
      {
        title: "결제 및 플랜",
        items: [
          {
            question: "연간 플랜 결제 시 9,900원만 결제되나요?",
            answer:
              "연간 플랜은 월 환산 기준 9,900원에 이용할 수 있는 상품으로, 결제 시 12개월분 총액(118,800원)이 한 번에 결제됩니다. 매달 결제되는 번거로움 없이 1년 동안 모든 Pro 기능을 무제한으로 이용하실 수 있습니다.",
          },
          {
            question: "정기 결제(자동 갱신)가 되나요?",
            answer:
              "현재 ReadAcross는 자동 갱신을 지원하지 않는 '단건 결제' 방식입니다. 이용 기간 만료 전 안내를 드리며, 기간 종료 후에는 자동으로 무료 플랜으로 전환됩니다. (작성하신 데이터는 삭제되지 않으니 안심하세요.)",
          },
          {
            question: "결제 수단은 무엇이 있나요?",
            answer:
              "현재는 신용카드 및 체크카드 결제를 지원합니다. 카카오페이, 네이버페이 등 간편결제 수단은 추후 지원을 검토 중이며, 도입 시 공지를 통해 안내드릴 예정입니다.",
          },
        ],
      },
      {
        title: "환불 정책",
        items: [
          {
            question: "중도 해지 시 환불받을 수 있나요?",
            answer:
              "네, 가능합니다. 이용약관에 따라 공정하게 처리해 드립니다.\n\n• 결제 후 7일 이내: 유료 기능을 사용하지 않으셨다면 전액 환불됩니다.\n• 7일 이후 또는 서비스 이용 시: 할인 전 월 정상가(14,900원)를 기준으로 이용하신 개월 수를 차감한 후 잔액을 환불해 드립니다.",
          },
          {
            question: "환불 신청은 어떻게 하나요?",
            answer:
              "고객센터 이메일이나 서비스 내 '문의하기'를 통해 성함과 가입 이메일 주소를 남겨주시면, 영업일 기준 3일 이내에 신속히 처리해 드립니다.",
          },
        ],
      },
      {
        title: "계정 및 보안",
        items: [
          {
            question: "내 데이터의 보안은 안전한가요?",
            answer:
              "네, 사용자의 모든 데이터는 암호화되어 안전하게 전송 및 저장됩니다. 또한 개인의 학습 데이터는 사용자의 명시적인 동의 없이 외부 AI 모델의 학습용으로 공유되지 않으니 안심하셔도 됩니다.",
          },
          {
            question: "기기 제한이 있나요?",
            answer:
              "하나의 계정으로 PC, 태블릿, 모바일 어디서든 접속할 수 있습니다. 기기 대수 제한 없이 당신의 지식 라이브러리를 언제 어디서나 동기화하여 사용하세요.",
          },
        ],
      },
      {
        title: "이용 범위 및 제한",
        items: [
          {
            question: "무료 플랜과 유료 플랜의 차이는 무엇인가요?",
            answer:
              "무료 플랜은 기본적인 기능과 제한된 사용량을 제공하며, 유료 플랜(Pro)은 무제한 요약, 고급 AI 기능, Practice Hub 등 모든 프리미엄 기능을 이용할 수 있습니다.",
          },
          {
            question: "콘텐츠 사용에 제한이 있나요?",
            answer:
              "ReadAcross는 개인 학습 및 업무 활용 목적으로 제공되며, 상업적 재배포나 무단 복제는 금지됩니다. 자세한 내용은 이용약관을 참고해 주세요.",
          },
          {
            question: "계정 공유가 가능한가요?",
            answer:
              "계정은 1인 1계정 사용을 원칙으로 하며, 공유 시 서비스 이용 제한 또는 계정 정지 조치가 있을 수 있습니다.",
          },
        ],
      },
      {
        title: "고객 지원",
        items: [
          {
            question: "고객 지원은 어떻게 받을 수 있나요?",
            answer:
              "고객센터 이메일로 문의 주시면 영업일 기준 3일 이내에 답변드릴 수 있도록 노력하겠습니다.",
          },
          {
            question: "서비스 이용 중 문제가 발생하면 어떻게 하나요?",
            answer:
              "문제 발생 시 즉시 고객센터로 연락 주시면 신속하게 원인 파악과 해결을 도와드립니다. 또한 자주 묻는 질문(FAQ) 페이지에서 기본적인 문제 해결 방법도 확인하실 수 있습니다.",
          },
          {
            question: "기능 개선이나 제안은 어디에 제출하나요?",
            answer:
              "기능 개선이나 사용성에 대한 제안은 언제든지 고객센터 이메일로 보내주셔도 좋습니다. 보내주신 의견은 서비스 개선을 위해 내부적으로 검토하며, 향후 업데이트에 반영될 수 있습니다.",
          },
        ],
      },
    ];
  }

  return [
    {
      title: "General",
      items: [
        {
          question: "What is ReadAcross?",
          answer:
            "ReadAcross is an AI-powered reading and learning service designed to help you deeply read and understand lengthy texts — from academic papers, essays, and reports to literary works.\n\nAt its core, ReadAcross provides full-document AI translation. You can translate entire documents with AI and read the original and translated text side by side. Click on any paragraph or sentence to instantly compare the original with the translation, highlight important parts, take notes, and ask AI questions within that specific context.\n\nYou can also edit translations directly, making it useful for translation practice and language learning. Rather than just summarizing, the AI supports deep understanding, analysis, and contextual interpretation. ReadAcross isn't a service where AI reads for you — it's a tool that helps you read, translate, and think alongside AI.",
        },
        {
          question: "What is Practice Hub?",
          answer:
            "Practice Hub is a space where AI quizzes you and provides review reminders so you don't forget what you've summarized. It's a core ReadAcross feature designed to help you fully internalize what you've read and maximize your learning effectiveness.",
        },
        {
          question: "What languages are supported?",
          answer:
            "We currently fully support Korean and English. Regardless of the original text's language, you can translate, read, and analyze it in your preferred language. We plan to expand language support in the future.",
        },
      ],
    },
    {
      title: "Billing & Plans",
      items: [
        {
          question: "Is only ₩9,900 charged for the annual plan?",
          answer:
            "The annual plan is available at ₩9,900 per month equivalent, but the full 12-month amount (₩118,800) is charged at once. You can enjoy all Pro features for a full year without the hassle of monthly payments.",
        },
        {
          question: "Is there automatic renewal?",
          answer:
            "Currently, ReadAcross uses a one-time payment system without automatic renewal. We'll notify you before your subscription expires, and after it ends, your account will automatically switch to the free plan. (Don't worry — your data won't be deleted.)",
        },
        {
          question: "What payment methods are available?",
          answer:
            "We currently support credit and debit card payments. We're considering adding convenient payment options like KakaoPay and NaverPay in the future, and we'll announce when they become available.",
        },
      ],
    },
    {
      title: "Refund Policy",
      items: [
        {
          question: "Can I get a refund if I cancel early?",
          answer:
            "Yes, you can. Refunds are processed fairly according to our Terms of Service.\n\n• Within 7 days of payment: Full refund if you haven't used any paid features.\n• After 7 days or if the service has been used: The refund is calculated by deducting the number of months used at the regular monthly price (₩14,900) from the total amount paid.",
        },
        {
          question: "How do I request a refund?",
          answer:
            "Please contact us via customer service email or the in-app 'Contact Us' feature with your name and registered email address. We'll process your request within 3 business days.",
        },
      ],
    },
    {
      title: "Security",
      items: [
        {
          question: "Is my data secure?",
          answer:
            "Yes, all user data is encrypted during transmission and storage. Your personal learning data is never shared with external AI models for training without your explicit consent.",
        },
        {
          question: "Are there device limitations?",
          answer:
            "You can access your account from PCs, tablets, and mobile devices — there's no device limit. Sync your knowledge library and use it anytime, anywhere.",
        },
      ],
    },
    {
      title: "Usage Scope & Limitations",
      items: [
        {
          question: "What's the difference between free and paid plans?",
          answer:
            "The free plan provides basic features with limited usage, while the paid plan (Pro) gives you access to unlimited summaries, advanced AI features, Practice Hub, and all other premium features.",
        },
        {
          question: "Are there content usage restrictions?",
          answer:
            "ReadAcross is provided for personal learning and professional use. Commercial redistribution and unauthorized copying are prohibited. Please refer to our Terms of Service for details.",
        },
        {
          question: "Can I share my account?",
          answer:
            "Each account is intended for individual use only. Sharing accounts may result in service restrictions or account suspension.",
        },
      ],
    },
    {
      title: "Customer Support",
      items: [
        {
          question: "How can I get customer support?",
          answer:
            "Please contact us via our customer service email, and we'll do our best to respond within 3 business days.",
        },
        {
          question: "What should I do if I encounter a problem?",
          answer:
            "If you experience any issues, please contact our customer service immediately and we'll help identify and resolve the problem quickly. You can also check our FAQ page for basic troubleshooting.",
        },
        {
          question: "Where can I submit feature requests or suggestions?",
          answer:
            "Feel free to send any feature improvement or usability suggestions to our customer service email. Your feedback is reviewed internally for service improvement and may be reflected in future updates.",
        },
      ],
    },
  ];
}

function AccordionItem({
  item,
  isOpen,
  onToggle,
}: {
  item: FAQItem;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-muted/50 transition-colors"
      >
        <span className="font-medium text-sm sm:text-base pr-4">
          {item.question}
        </span>
        <ChevronDown
          className={cn(
            "h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200",
            isOpen && "rotate-180"
          )}
        />
      </button>
      <div
        className={cn(
          "grid transition-all duration-200 ease-in-out",
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        )}
      >
        <div className="overflow-hidden">
          <div className="px-5 pb-4 text-sm text-muted-foreground whitespace-pre-line leading-relaxed">
            {item.answer}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FAQ() {
  const [, setLocation] = useLocation();
  const { t, language } = useTranslation();
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());

  const sections = getFAQData(language);

  const toggleItem = (sectionIdx: number, itemIdx: number) => {
    const key = `${sectionIdx}-${itemIdx}`;
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <Layout>
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8 py-8 sm:py-12">
          <div className="mb-8">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => window.history.back()}
              className="mb-4 -ml-2"
            >
              <ArrowLeft className="h-4 w-4 mr-1" />
              {language === "ko" ? "돌아가기" : "Go Back"}
            </Button>
            <h1 className="text-2xl sm:text-3xl font-bold">
              {language === "ko" ? "자주 묻는 질문" : "Frequently Asked Questions"}
            </h1>
            <p className="mt-2 text-muted-foreground">
              {language === "ko"
                ? "ReadAcross 서비스에 대해 궁금한 점을 확인하세요."
                : "Find answers to common questions about ReadAcross."}
            </p>
          </div>

          <div className="space-y-8">
            {sections.map((section, sectionIdx) => (
              <div key={sectionIdx}>
                <h2 className="text-lg font-semibold mb-3 text-foreground">
                  {section.title}
                </h2>
                <div className="space-y-2">
                  {section.items.map((item, itemIdx) => (
                    <AccordionItem
                      key={itemIdx}
                      item={item}
                      isOpen={openItems.has(`${sectionIdx}-${itemIdx}`)}
                      onToggle={() => toggleItem(sectionIdx, itemIdx)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="mt-12 p-6 bg-muted/50 rounded-lg text-center">
            <p className="text-sm text-muted-foreground mb-3">
              {language === "ko"
                ? "원하는 답변을 찾지 못하셨나요?"
                : "Couldn't find what you're looking for?"}
            </p>
            <a
              href="mailto:hello@readacross.io"
              className="inline-flex items-center text-sm font-medium text-primary hover:underline"
            >
              {language === "ko"
                ? "이메일로 문의하기 →"
                : "Contact via Email →"}
            </a>
          </div>
        </div>
      </div>
    </Layout>
  );
}