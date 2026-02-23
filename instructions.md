🚀 ReadAcross 탐색(Explore) 콘텐츠 확장 및 큐레이션 개편 제안서
1. 배경 및 비전 현재 ReadAcross의 시스템 소스(arXiv 논문, Gutenberg 고전 문학, Aeon 에세이 등)는 학술/심화 독해에 훌륭하지만 일반 직장인이나 초중급 영어 학습자가 접근하기에는 난이도가 너무 높음. 따라서 기존의 훌륭한 자동 수집 인프라(rssCrawler)를 활용하여 **'비즈니스/실무 아티클'**과 **'초중급자용 쉬운 뉴스(Graded Content)'**를 시스템 소스로 추가하고, 사용자가 이를 쉽게 찾을 수 있도록 Explore 페이지의 필터링 UI를 개편하고자 함.
2. 핵심 목표 및 작업 대상
🎯 Step 1: 백엔드 - 신규 시스템 RSS 소스 추가
• Target File: server/rssCrawler.ts (또는 시스템 기본 RSS 피드를 초기화하는 영역)
• 요구사항: 기존 프리미엄 RSS 소스 목록에 아래의 에듀테크 타겟용 신규 소스를 추가하여 스케줄러가 자동 수집하게 함.
    ◦ [초중급자용] VOA Learning English (쉬운 어휘/구조)
    ◦ [비즈니스용] Y Combinator (Paul Graham) Essays 또는 유명 비즈니스/스타트업 뉴스레터 RSS
    ◦ 이들의 Category는 'News' 또는 'Essays'로 매핑.
🎯 Step 2: 프론트엔드 - Explore 페이지 '난이도 필터' 추가
• Target File: client/src/pages/Explore.tsx
• 요구사항:
    ◦ 현재 코드에 이미 estimateDifficulty 함수(high, mid, low 반환)가 구현되어 카드 뱃지로 쓰이고 있음.
    ◦ 이 함수를 활용하여 Explore 페이지 상단의 필터 영역(Category 옆)에 **'난이도(Difficulty) 필터 드롭다운'**을 추가. (All, 초급(Beginner), 중급(Intermediate), 고급(Advanced))
    ◦ filteredExploreDocuments 로직에 선택된 난이도 필터링 조건을 추가 연동.
🎯 Step 3: 프론트엔드 - Intent 칩 업데이트 및 시스템 소스 토글 추가
• Target File: client/src/pages/Explore.tsx, client/src/components/ConversationalHero.tsx (해당 시)
• 요구사항:
    ◦ 검색창 하단의 intentChips 에 [#초급자용 쉬운 영어], [#비즈니스 아티클] 칩을 추가하고, 클릭 시 적절한 검색어 또는 카테고리/난이도가 세팅되도록 연결.
    ◦ 하단 'Explore 시스템 소스 설정' 모달에 새로 추가된 VOA, YC 등의 소스 토글 버튼을 추가하여 사용자가 켜고 끌 수 있게 반영.

--------------------------------------------------------------------------------
⚠️ 에이전트 작업 수칙 (명심할 것)
1. 기존에 잘 작동하는 arXiv, Gutenberg 크롤링 로직이나 V2 파싱 구조화 로직(generateStructuredContentV2)은 절대 건드리지 말 것.
2. 프론트엔드 디자인은 현재 적용된 Modern Zen Aesthetic(Tailwind 기반)을 그대로 유지하고 기존 컴포넌트(Select, Badge 등)를 재사용할 것.
3. 단계별로 지시할 테니 지금은 전체 맥락만 요약하고 대기할 것.