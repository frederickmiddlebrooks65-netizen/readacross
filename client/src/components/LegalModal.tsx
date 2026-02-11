import { useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTranslation } from "@/i18n";

type LegalType = "terms" | "privacy" | "cookies" | null;

interface LegalModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: LegalType;
  scrollToSection?: string | null;
}

const legalContent = {
  terms: {
    en: {
      title: "Terms of Service",
      content: `ReadAcross Terms of Service

Article 1 (Purpose)

These Terms of Service (the "Terms") aim to stipulate the rights, obligations, and responsibilities of ReadAcross (the "Company," "Service," "we," "us," or "our") and the users in connection with the use of the reading record and related services provided by the Company.

Article 2 (Definitions)

"Service" refers to the functions provided by the Company, including reading record management, community activities, and book information lookup.

"User" refers to both members and non-members who agree to these Terms and use the Service.

Article 3 (Effect and Amendment of Terms)

These Terms shall take effect by being posted on the service screen or by notifying members via email or other electronic means.

The Company may amend these Terms within the scope not violating relevant laws. In the event of an amendment, the Company shall announce the application date and reasons for the amendment at least 7 days prior (30 days prior for significant changes affecting users' rights).

Article 4 (Provision and Modification of Service)

In principle, the Service shall be provided 24 hours a day, year-round.

The Company may temporarily suspend the provision of the Service in the event of maintenance, replacement, or breakdown of information and communication facilities, or communication failure.

Article 5 (Obligations of the User)

Users shall not engage in the following activities:

• Stealing other people's information.
• Altering information posted by the Company.
• Infringing upon the intellectual property rights, including copyrights, of the Company or any third party.
• Posting or disclosing messages, images, sounds, or any information that goes against public order and morals.

Article 6 (Copyright of Posts)

The copyright of posts, such as reading notes and reviews, posted by the user within the Service belongs to the respective author of the post.

Users shall not use the information obtained through the Service for commercial purposes by reproducing, transmitting, publishing, distributing, broadcasting, or other methods without the prior consent of the Company, nor shall they allow any third party to use it.

Article 7 (Limitation of Liability)

The Company shall be exempt from liability for failure to provide the Service due to natural disasters or equivalent force majeure.

The Company shall not be liable for service usage disruptions caused by reasons attributable to the user.

Article 8 (Governing Law and Jurisdiction)

Any disputes arising between the Company and the user shall be governed by the laws of the Republic of Korea.

Any lawsuit regarding disputes arising from the use of the Service shall be filed with the court having jurisdiction under the Civil Procedure Act of the Republic of Korea.

Article 9 (Paid Services and Payment)

Paid services such as the "Pro Plan" provided by the Company are available when the user selects the plan and completes payment by registering a payment method.

Paid services operate on a "subscription-based" model with automatic recurring payments on a monthly or yearly basis.

Service fees are automatically charged to the payment method registered by the user on a monthly/yearly basis, and the subscription continues to renew until the user cancels.

Article 10 (Withdrawal and Refund)

Users may request a withdrawal (full refund) within 7 days after payment only if there is no usage history (no document uploads, feature usage, or any service activity).

Due to the nature of digital content, refunds may be restricted in accordance with the "Act on the Consumer Protection in Electronic Commerce" if the service has already been used or usage history exists.

Upon receiving a refund request, the Company will process the payment cancellation or refund within 3 business days. However, actual refund timing may vary depending on the payment gateway and credit card company.

Article 11 (Service Period and Termination)

Users may use the Service during the purchased service period (e.g., 30 days or 365 days).

This Service is provided on a one-time payment basis, and payments are not automatically renewed upon expiration of the service period.

Users may withdraw from the Service at any time during the service period; however, refunds for the remaining unused period shall be governed by Article 10.

Article 12 (Language and Interpretation)

These Terms are provided in both Korean and English. In the event of any conflict or discrepancy between the Korean version and the English version, the Korean version shall prevail and take precedence in all respects.

Announcement Date: January 15, 2026
Effective Date: January 15, 2026`,
    },
    ko: {
      title: "서비스 이용약관",
      content: `ReadAcross 서비스 이용약관

제1조 (목적)

본 약관은 ReadAcross(이하 "회사" 또는 "서비스")가 제공하는 독서 기록 및 관련 서비스의 이용과 관련하여 회사와 이용자 사이의 권리, 의무 및 책임사항을 규정함을 목적으로 합니다.

제2조 (용어의 정의)

"서비스"라 함은 회사가 제공하는 독서 기록 관리, 커뮤니티 활동, 도서 정보 조회 등의 기능을 의미합니다.

"이용자"란 본 약관에 동의하고 서비스를 이용하는 회원 및 비회원을 말합니다.

제3조 (약관의 효력 및 변경)

본 약관은 서비스 화면에 게시하거나 전자우편 등의 방법으로 회원에게 공지함으로써 효력이 발생합니다.

회사는 관계 법령을 위배하지 않는 범위에서 본 약관을 개정할 수 있으며, 개정 시 적용일자 7일 전(중요한 사항은 30일 전)에 공지합니다.

제4조 (서비스의 제공 및 변경)

서비스는 연중무휴, 1일 24시간 제공함을 원칙으로 합니다.

회사는 컴퓨터 등 정보통신설비의 보수점검, 교체 및 고장, 통신두절 등의 사유가 발생한 경우에는 서비스의 제공을 일시적으로 중단할 수 있습니다.

제5조 (회원의 의무)

이용자는 다음 행위를 하여서는 안 됩니다.

• 타인의 정보 도용
• 회사가 게시한 정보의 변경
• 회사와 기타 제3자의 저작권 등 지식재산권에 대한 침해
• 외설 또는 폭력적인 메시지, 화상, 음성, 기타 공서양속에 반하는 정보를 서비스에 공개 또는 게시하는 행위

제6조 (게시물의 저작권)

이용자가 서비스 내에 게시한 독서 노트, 리뷰 등 게시물의 저작권은 해당 게시물의 저작자에게 귀속됩니다.

이용자는 서비스를 이용함으로써 얻은 정보를 회사의 사전 승낙 없이 복제, 송신, 출판, 배포, 방송 기타 방법에 의하여 영리 목적으로 이용하거나 제3자에게 이용하게 하여서는 안 됩니다.

제7조 (책임제한)

회사는 천재지변 또는 이에 준하는 불가항력으로 인하여 서비스를 제공할 수 없는 경우에는 서비스 제공에 관한 책임이 면제됩니다.

회사는 이용자의 귀책사유로 인한 서비스 이용의 장애에 대하여는 책임을 지지 않습니다.

제8조 (준거법 및 재판관할)

회사와 이용자 간에 발생한 분쟁에 대하여는 대한민국법을 준거법으로 합니다.

본 서비스 이용과 관련하여 발생한 분쟁에 대한 소송은 민사소송법상의 관할법원에 제기합니다.

제9조 (유료 서비스의 이용 및 결제)

회사가 제공하는 "Pro 플랜" 등 유료 서비스는 이용자가 해당 플랜을 선택하고 결제 수단을 등록하여 결제를 완료했을 때 제공됩니다.

유료 서비스는 매월 또는 매년 정기적으로 자동 결제되는 "구독형 서비스"를 원칙으로 합니다.

이용자가 등록한 결제 수단으로 매월/매년 서비스 이용 요금이 자동으로 청구되며, 이용자가 직접 구독을 해지하기 전까지 지속적으로 갱신됩니다.

제10조 (청약철회 및 환불)

이용자는 유료 결제 후 이용 내역이 없는 경우(문서 업로드, 상세 기능 사용 등 서비스 활용 이력이 없는 경우)에 한하여 7일 이내에 청약철회(전액 환불)를 요청할 수 있습니다.

디지털 콘텐츠의 특성상 서비스를 이미 이용하였거나 이용 내역이 존재하는 경우, "전자상거래 등에서의 소비자보호에 관한 법률"에 따라 환불이 제한될 수 있습니다.

환불 프로세스는 회사가 이용자의 요청을 확인한 후 3영업일 이내에 결제 취소 또는 환불 절차를 진행합니다. 단, PG사 및 카드사의 사정에 따라 실제 환급까지는 시일이 더 소요될 수 있습니다.

제11조 (이용 기간 및 서비스 종료)

이용자는 결제한 이용 기간(30일 또는 365일 등) 동안 서비스를 이용할 수 있습니다.

본 서비스는 단건 결제 방식으로 제공되며, 이용 기간 종료 시 자동으로 결제가 연장되지 않습니다.

이용자는 이용 기간 중 언제든지 탈퇴할 수 있으나, 이미 이용 중인 잔여 기간에 대한 환불은 제10조 규정에 따릅니다.

공고일자: 2026년 1월 15일
시행일자: 2026년 1월 15일`,
    },
  },
  privacy: {
    en: {
      title: "Privacy Policy",
      content: `ReadAcross Privacy Policy

ReadAcross ("the Company," "we," "us," or "our") values your privacy and complies with the Personal Information Protection Act and other relevant laws of the Republic of Korea. This Privacy Policy explains how we collect, use, and protect the information you provide to us.

1. Items and Methods of Collection

We collect the following personal information for membership registration, customer support, and service provision.

Mandatory Items: Email address, password, nickname

Optional Items: Profile picture, preferred book genres, and reading preference information

Automatically Collected Information: Service usage records, access logs, cookies, IP addresses, and reading data (book titles, notes, completion status, etc.)

2. Purpose of Collection and Use

The Company utilizes the collected personal information for the following purposes:

Service Provision and Management: Content delivery, personalized services, and identity verification.

Member Management: Identity verification for member-only services, prevention of unauthorized or fraudulent use, confirmation of registration intent, and handling of inquiries or complaints.

New Service Development and Marketing: Development of new services, provision of tailored services, display of advertisements based on statistical characteristics, verification of service effectiveness, and provision of event information/participation opportunities (subject to optional consent).

3. Retention and Use Period

In principle, personal information is destroyed without delay once the purpose of collection and use is achieved. However, the Company may retain certain information for a specified period as required by relevant laws:

Internal Policy for Fraud Prevention:
• Record of fraudulent use: 1 year

Statutory Retention Periods:
• Website visit records: 3 months (Protection of Communications Secrets Act)
• Records on consumer complaints or dispute handling: 3 years (Act on the Consumer Protection in Electronic Commerce)
• Records on contracts or withdrawal of offers: 5 years (Act on the Consumer Protection in Electronic Commerce)

4. Destruction Procedures and Methods

Procedure: Information entered for registration is transferred to a separate database after the purpose is achieved and stored for a certain period according to internal policies and relevant laws before being destroyed.

Method: Personal information stored in electronic file format is deleted using technical methods that prevent reproduction. Information printed on paper is shredded or incinerated.

5. Rights of Users and How to Exercise Them

Users may view or modify their registered personal information at any time and may request to withdraw their consent (termination of membership).

If a user requests the correction of errors in their personal information, the Company will not use or provide such information until the correction is completed.

6. Installation, Operation, and Rejection of Automatic Collection Devices

We use 'cookies' to save and retrieve your information to provide specialized and personalized services.

Purpose of Cookies: To analyze visit frequency, duration, popular search terms, and secure access to provide an optimized user experience.

How to Reject Cookies: You have the right to choose whether to install cookies. You can allow all cookies, require confirmation for each, or refuse all cookies through your web browser settings. (Note: Refusing cookies may limit access to certain services that require login.)

7. Privacy Officer and Contact Information

The Company has designated a Privacy Officer to protect your information and handle complaints.

Privacy Officer: Soohyun Pae
Position: Information Security Manager
Email: hello@readacross.io

8. Governing Language and Law

This Privacy Policy is governed by the laws of the Republic of Korea. In the event of any discrepancy between the Korean version and the English version of this policy, the Korean version shall prevail.

Announcement Date: January 10, 2026
Effective Date: January 10, 2026`,
    },
    ko: {
      title: "개인정보 처리방침",
      content: `ReadAcross 개인정보 처리방침

ReadAcross(이하 '회사')는 이용자의 개인정보를 중요시하며, 「개인정보 보호법」 및 관련 법령을 준수하고 있습니다. 회사는 본 개인정보 처리방침을 통하여 이용자가 제공하는 개인정보가 어떠한 용도와 방식으로 이용되고 있으며, 개인정보 보호를 위해 어떠한 조치가 취해지고 있는지 알려드립니다.

1. 수집하는 개인정보 항목 및 수집 방법

회사는 회원가입, 고객지원, 서비스 제공을 위해 아래와 같은 개인정보를 수집하고 있습니다.

필수 수집 항목: 이메일 주소, 비밀번호, 닉네임

선택 수집 항목: 프로필 사진, 선호 도서 장르 및 독서 취향 정보

자동 수집 정보: 서비스 이용 기록, 접속 로그, 쿠키, 접속 IP 정보, 독서 데이터(도서명, 메모, 완독 여부 등)

2. 개인정보의 수집 및 이용 목적

회사는 수집한 개인정보를 다음의 목적을 위해 활용합니다.

서비스 제공 및 관리: 콘텐츠 제공, 맞춤형 서비스 제공, 본인 인증 등.

회원 관리: 회원제 서비스 이용에 따른 본인 확인, 부정 이용 방지, 가입 의사 확인, 문의 및 불만 처리.

신규 서비스 개발 및 마케팅: 신규 서비스 개발, 통계적 특성에 따른 서비스 제공 및 광고 게재, 서비스 유효성 확인, 이벤트 정보 및 참여 기회 제공 (선택 동의 시).

3. 개인정보의 보유 및 이용 기간

원칙적으로 개인정보는 수집 및 이용 목적이 달성되면 지체 없이 파기합니다. 단, 관련 법령의 규정에 의하여 보존할 필요가 있는 경우 아래와 같이 일정 기간 보관합니다.

회사 내부 방침에 의한 부정 이용 방지:
• 부정 이용 기록: 1년

관련 법령에 의한 보존 기간:
• 웹사이트 방문 기록: 3개월 (통신비밀보호법)
• 소비자의 불만 또는 분쟁 처리에 관한 기록: 3년 (전자상거래 등에서의 소비자보호에 관한 법률)
• 계약 또는 청약 철회 등에 관한 기록: 5년 (전자상거래 등에서의 소비자보호에 관한 법률)

4. 개인정보의 파기 절차 및 방법

절차: 수집 목적이 달성된 정보는 별도의 DB로 옮겨져(종이의 경우 별도의 서류함) 내부 방침 및 관련 법령에 따라 일정 기간 저장된 후 파기됩니다.

방법: 전자적 파일 형태의 정보는 기록을 재생할 수 없는 기술적 방법을 사용하여 삭제하며, 종이에 출력된 정보는 분쇄하거나 소각하여 파기합니다.

5. 이용자의 권리와 그 행사 방법

이용자는 언제든지 자신의 개인정보를 조회하거나 수정할 수 있으며, 가입 해지(동의 철회)를 요청할 수 있습니다.

이용자가 개인정보 오류 정정을 요청한 경우, 정정이 완료될 때까지 해당 개인정보를 이용하거나 제공하지 않습니다.

6. 개인정보 자동 수집 장치의 설치·운영 및 그 거부에 관한 사항

회사는 이용자에게 최적화된 맞춤형 서비스를 제공하기 위해 '쿠키(cookie)'를 사용합니다.

쿠키의 사용 목적: 방문 빈도, 머문 시간, 인기 검색어 분석 및 보안 접속 확인 등을 통해 최적화된 사용자 경험을 제공합니다.

쿠키 설정 거부 방법: 이용자는 웹 브라우저의 옵션을 설정함으로써 모든 쿠키를 허용하거나, 저장 시마다 확인을 거치거나, 모든 쿠키의 저장을 거부할 수 있습니다. (단, 쿠키 저장을 거부할 경우 로그인이 필요한 일부 서비스 이용에 제한이 있을 수 있습니다.)

7. 개인정보 보호책임자 및 연락처

회사는 이용자의 개인정보를 보호하고 관련 불만을 처리하기 위하여 아래와 같이 개인정보 보호책임자를 지정하고 있습니다.

개인정보 보호책임자: 배수현
직책: 정보보안 관리자
이메일: hello@readacross.io

8. 준거법 및 언어

본 개인정보 처리방침은 대한민국 법률의 적용을 받습니다. 본 방침의 한국어 버전과 영문 버전이 상충할 경우, 한국어 버전이 우선합니다.

공고일자: 2026년 1월 10일
시행일자: 2026년 1월 10일`,
    },
  },
  cookies: {
    en: {
      title: "Cookie Policy",
      content: `ReadAcross Cookie Policy

This Cookie Policy explains how ReadAcross ("the Company," "we," "us," or "our") uses cookies and similar technologies to recognize you when you visit our website. It explains what these technologies are and why we use them, as well as your rights to control our use of them.

1. What are Cookies?

Cookies are small data files that are placed on your computer or mobile device when you visit a website. Cookies are widely used by website owners in order to make their websites work, or to work more efficiently, as well as to provide reporting information.

2. Why Do We Use Cookies?

We use first-party and third-party cookies for several reasons. Some cookies are required for technical reasons in order for our Website to operate, and we refer to these as "strictly necessary" cookies. Other cookies also enable us to track and target the interests of our users to enhance the experience on our Online Sections.

Types of Cookies used on our Website:

Strictly Necessary Cookies: These cookies are strictly necessary to provide you with services available through our Website and to use some of its features, such as access to secure areas (Login).

Performance and Functionality Cookies: These cookies are used to enhance the performance and functionality of our Website but are non-essential to their use (e.g., remembering your language preference).

Analytics and Customization Cookies: These cookies collect information that is used either in aggregate form to help us understand how our Website is being used or how effective our marketing campaigns are.

Advertising Cookies: These cookies are used to make advertising messages more relevant to you. They perform functions like preventing the same ad from continuously reappearing.

3. Specific Cookies Used by ReadAcross

Below is a list of the primary cookies we use:

| Name | Purpose | Duration |
|------|---------|----------|
| session_id | Maintains user session and secure login. | Session |
| lang_pref | Remembers the user's selected language (EN/KO). | 1 Year |
| _ga / _gid | Google Analytics: Used to distinguish users and track site usage. | 2 Years |

4. How Can I Control Cookies?

You have the right to decide whether to accept or reject cookies. You can set or amend your web browser controls to accept or refuse cookies. If you choose to reject cookies, you may still use our website, though your access to some functionality and areas of our website may be restricted.

To manage cookies in your browser:

• Google Chrome: Settings > Privacy and Security > Cookies and other site data
• Apple Safari: Preferences > Privacy > Block all cookies
• Mozilla Firefox: Options > Privacy & Security > Cookies and Site Data
• Microsoft Edge: Settings > Cookies and site permissions

5. Updates to This Cookie Policy

We may update this Cookie Policy from time to time in order to reflect, for example, changes to the cookies we use or for other operational, legal, or regulatory reasons. Please re-visit this Cookie Policy regularly to stay informed about our use of cookies and related technologies.

6. Language and Governing Law

This Cookie Policy is provided in both Korean and English. In the event of any discrepancy or conflict between the Korean version and the English version, the Korean version shall prevail.

Announcement Date: January 10, 2026
Effective Date: January 10, 2026`,
    },
    ko: {
      title: "쿠키 정책",
      content: `ReadAcross 쿠키 정책

본 쿠키 정책은 ReadAcross(이하 '회사')가 운영하는 웹사이트에서 쿠키를 어떻게 사용하는지 설명합니다. 당사 서비스를 이용함으로써 귀하는 본 정책에 따른 쿠키 사용에 동의하게 됩니다.

1. 쿠키(Cookie)란 무엇인가요?

쿠키는 귀하가 웹사이트를 방문할 때 귀하의 컴퓨터나 모바일 기기에 저장되는 작은 텍스트 파일입니다. 웹사이트가 귀하의 접속 정보나 설정 등을 기억하여 더 편리한 서비스를 제공할 수 있도록 돕습니다.

2. 쿠키를 사용하는 이유

회사는 다음과 같은 목적으로 쿠키를 사용합니다.

필수 쿠키 (Strictly Necessary): 로그인 상태 유지, 보안 설정 등 웹사이트의 기본 기능을 수행하기 위해 반드시 필요합니다.

성능 및 분석 쿠키 (Performance & Analytics): 방문자가 웹사이트를 어떻게 이용하는지 파악하여 서비스 품질을 개선하는 데 사용됩니다. (예: 구글 애널리틱스)

기능 쿠키 (Functional): 귀하가 설정한 언어 환경이나 개인화된 설정을 기억합니다.

타겟팅/광고 쿠키 (Targeting/Advertising): 이용자의 관심사에 맞는 콘텐츠나 광고를 제공하기 위해 사용될 수 있습니다.

3. 사용되는 주요 쿠키 항목

| 쿠키 종류 | 목적 | 보유 기간 |
|-----------|------|-----------|
| 세션 쿠키 | 로그인 유지 및 보안 | 브라우저 종료 시까지 |
| 언어 설정 | 사용자 선호 언어 기억 | 1년 |
| GA 쿠키 | 웹사이트 방문자 통계 분석 | 최대 2년 |

4. 쿠키 설정 및 거부 방법

귀하는 쿠키 설치에 대한 선택권을 가지고 있습니다. 대부분의 웹 브라우저에서는 설정을 통해 쿠키를 거부하거나 삭제할 수 있습니다.

• Chrome: 설정 > 개인정보 및 보안 > 인터넷 사용 기록 삭제 또는 쿠키 및 기타 사이트 데이터
• Safari: 환경설정 > 개인정보 보호 > 쿠키 및 웹사이트 데이터 관리
• Edge: 설정 > 쿠키 및 사이트 권한

단, 쿠키 저장을 거부할 경우 로그인이 필요한 일부 서비스 이용에 제한이 있을 수 있음을 유의하시기 바랍니다.

5. 정책의 변경

회사는 서비스 내용의 변경이나 관련 법령의 개정에 따라 본 쿠키 정책을 수정할 수 있습니다.

시행일자: 2026년 1월 10일`,
    },
  },
};

export default function LegalModal({
  open,
  onOpenChange,
  type,
  scrollToSection,
}: LegalModalProps) {
  const { language } = useTranslation();
  const scrollAreaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && scrollToSection === "article9") {
      setTimeout(() => {
        const viewport = scrollAreaRef.current?.querySelector(
          "[data-radix-scroll-area-viewport]",
        );
        if (viewport) {
          const searchText = language === "ko" ? "제9조" : "Article 9";
          const content = viewport.textContent || "";
          const targetIndex = content.indexOf(searchText);

          if (targetIndex !== -1) {
            const totalLength = content.length;
            const scrollRatio = targetIndex / totalLength;
            const scrollHeight = viewport.scrollHeight - viewport.clientHeight;
            viewport.scrollTo({
              top: scrollHeight * scrollRatio,
              behavior: "smooth",
            });
          }
        }
      }, 150);
    }
  }, [open, scrollToSection, language]);

  if (!type) return null;

  const content =
    legalContent[type][language as "en" | "ko"] || legalContent[type].en;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl max-h-[85vh] p-0"
        data-testid={`modal-${type}`}
      >
        <DialogHeader className="px-6 pt-6 pb-4 border-b">
          <DialogTitle className="text-xl font-semibold">
            {content.title}
          </DialogTitle>
        </DialogHeader>
        <div ref={scrollAreaRef}>
          <ScrollArea className="h-[60vh] px-6 py-4">
            <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {content.content}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
