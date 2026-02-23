현재 Explore 페이지에서 사용자가 직접 추가하는 RSS 피드 기능에 심각한 보안 및 아키텍처 결함이 있어. 사용자가 추가한 피드가 즉시 크롤링되어 isPublic: true 상태로 전체 사용자에게 노출되는 문제를 해결하고, 정책(Policy) 기반의 방어 로직을 구축해야 해. 아래 4단계 지시사항을 순서대로 구현해 줘.
1. Backend: RSS 문서 생성 시 Public/Private 철저히 분리 (server/rssCrawler.ts)
• convertRSSItemToDocument 및 convertRSSItemToDocumentEnhanced 함수 내부를 수정해 줘.
• 현재 isPublic: true로 하드코딩된 부분을 찾아, isPublic: feed.isSystemSource === true 로 변경해 줘. (시스템 소스일 때만 전체 공개)
• sourceType 또한 시스템 소스(isPublic이 true)일 경우에만 "explore"로 설정하고, 일반 사용자가 추가한 경우 "rss"로 설정하도록 조건부 처리해 줘.
2. Backend: RSS 추가 API에 정책 및 제한 적용 (server/routes/ 내의 POST /rss-feeds 또는 /api/rss-feeds 엔드포인트)
• 사용자가 피드를 추가할 때, 먼저 await storage.getRSSPolicy()를 호출해서 전역 RSS 정책을 가져와 줘.
• 사전 승인제 적용: policy.requireApproval이 true인 경우, 새 피드를 생성할 때 isBlocked: true (또는 lastStatus: "pending") 상태로 생성하고, 생성 직후에 호출되는 processRSSArticles(newFeed.id)(즉시 크롤링 로직)가 실행되지 않도록 조건문으로 막아 줘.
• 할당량 제한 방어: DB(또는 rssSubscriptions)를 조회해 현재 요청한 사용자가 등록한 피드 개수가 policy.maxFeedsPerUser를 초과하는지 검사하고, 초과 시 403 에러와 함께 차단하는 로직을 추가해 줘.
• 도메인 필터링: policy.blockedDomains 배열을 확인하여, 요청된 URL의 도메인이 블랙리스트에 포함되어 있다면 400 에러로 즉시 튕겨내 줘.
3. Frontend: Explore 페이지의 UX 텍스트 수정 (client/src/pages/Explore.tsx)
• handleAddRSSFeed 함수 내에서 RSS 피드 추가 성공 시 뜨는 Toast 알림 텍스트를 수정해 줘.
• 사용자가 추가한 콘텐츠가 더 이상 즉시 공개(Explore)되지 않으므로, 알림 텍스트를 "RSS 피드가 추가되었습니다. 콘텐츠가 내 라이브러리에 동기화되기까지 약간의 시간이 소요될 수 있습니다."와 같은 개인화된 뉘앙스로 변경해 줘.
4. Admin UI: 보류된 피드 관리 기능 추가 (client/src/pages/AdminNew.tsx)
• '소스 관리 > RSS 소스' 탭 내부의 피드 목록 렌더링 부분에서, 관리자가 사용자 추가 피드의 isBlocked 상태를 토글(허용/차단)할 수 있는 UI 버튼을 명확하게 추가해 줘.
• 승인 대기 중(isBlocked: true 또는 pending)인 피드들을 시각적으로 돋보이게(예: 주황색 뱃지) 만들어 관리자가 쉽게 식별하고 크롤링을 허가할 수 있도록 해 줘.
코드를 수정하면서 기존의 시스템 소스(arXiv, Gutenberg 등)의 크롤링 로직은 망가지지 않도록 각별히 유의해 줘.

--------------------------------------------------------------------------------
💡 이 프롬프트의 핵심 전략
1. 데이터 오염 원천 차단 (Step 1): 가장 핵심인 데이터베이스 입력단에서 사용자가 넣은 데이터는 무조건 isPublic: false를 부여하게 만들어, 시스템 해킹이나 스팸 등록이 발생하더라도 다른 사용자의 화면(Explore)에는 절대 노출되지 않도록 격리합니다.
2. 서버 자원 보호 (Step 2): 매크로나 악의적 사용자가 수십 개의 RSS를 등록해 서버를 마비시키는 것을 막기 위해 정책(할당량, 도메인, 승인 여부)을 API 라우트 최전선에 배치했습니다.
3. 운영자 통제력 확보 (Step 4): 무조건 막기만 하는 것이 아니라, 훌륭한 피드를 제안한 사용자가 있다면 관리자가 Admin 페이지에서 확인 후 허용(Unblock & System 승격)할 수 있는 여지를 열어두었습니다.