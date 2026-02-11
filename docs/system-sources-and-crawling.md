
# ReadAcross 시스템 소스 및 크롤링 관리 방식

## 개요

ReadAcross는 다중 소스 콘텐츠 크롤링 시스템을 통해 다양한 학습 자료를 자동으로 수집하고 관리합니다. 안정적인 시스템 소스와 사용자 확장 가능한 RSS 소스를 결합한 하이브리드 방식으로 운영됩니다.

## 시스템 소스 구성

### 1. arXiv 학술 논문 (`server/arxivCrawler.ts`)

**특징**: 안정적 기본 소스
- **관리 방식**: 큐레이션된 5개의 샘플 논문 리스트 사용
- **크롤링 프로세스**:
  1. PDF 다운로드 (arXiv URL에서)
  2. 텍스트 추출 (pdftotext 사용)
  3. 섹션별 분리 (Abstract, Introduction, Conclusion)
  4. 학술 논문 구조화
- **처리 특징**:
  - 난이도 자동 분류 (advanced/intermediate)
  - 썸네일 추출 작업 큐 연동
  - 최대 400문장 추출로 학습용 최적화
  - 학술 특화 문장 분할 알고리즘

**처리된 논문 예시**:
- GPT-4 Technical Report
- Attention Is All You Need
- Language Models are Few-Shot Learners
- A Multitask, Multilingual, Multimodal Evaluation of ChatGPT

### 2. Project Gutenberg 고전 문학 (`server/gutenbergCrawler.ts`)

**특징**: 고전 문학 소스
- **관리 방식**: 큐레이션된 10개의 고전 도서 리스트
- **크롤링 프로세스**:
  1. 텍스트 파일 다운로드
  2. Project Gutenberg 헤더/푸터 정리
  3. 문장 분할 및 정제
  4. 언어학습용 문단 생성 (5문장씩 묶어서)
- **처리 특징**:
  - 공개 도메인 텍스트 처리
  - 최대 50,000자 제한 (데모 목적)
  - 챕터별 논리적 구조화

**포함된 도서 예시**:
- Pride and Prejudice (Jane Austen)
- Alice's Adventures in Wonderland (Lewis Carroll)
- The Great Gatsby (F. Scott Fitzgerald)
- Frankenstein (Mary Shelley)

## RSS 피드 시스템 (`server/rssCrawler.ts`)

### 특징
- **관리 방식**: 사용자가 추가한 RSS 피드들
- **크롤링 프로세스**:
  1. RSS 파싱 (rss-parser 사용)
  2. 웹 콘텐츠 추출 (Mozilla Readability)
  3. HTML 구조화 처리
  4. 중복 방지 메커니즘

### 핵심 기능
- **실시간 피드 동기화**: 12시간 간격 자동 실행
- **중복 방지**: URL 정규화 + SHA-256 해시 기반
- **건강도 모니터링**: 에러 횟수 및 성공률 추적
- **동적 차단**: 건강도 20점 이하 + 5회 연속 실패 시 자동 차단

### RSS 처리 파이프라인
```typescript
// 1. RSS 피드 파싱
const rssData = await fetchRSSFeed(feed.canonicalUrl);

// 2. 각 아티클 처리
for (const item of rssData.items) {
  // 3. 콘텐츠 추출 (Readability)
  const content = await extractArticleContent(item.link);
  
  // 4. 문서 변환 (V2 파이프라인)
  const document = await DocumentService.createDocumentWithPSAndStructureV2({
    contentType: "html",
    // ... 기타 메타데이터
  });
}
```

## 자동 크롤링 스케줄러 (`server/scheduler.ts`)

### 스케줄 구성
```typescript
// RSS 피드 동기화: 12시간마다 (0시, 12시)
const rssTask = cron.schedule('0 */12 * * *', async () => {
  await syncAllActiveFeeds();
});

// 통합 동기화: 매일 새벽 2시
const unifiedTask = cron.schedule('0 2 * * *', async () => {
  await syncAllActiveFeeds();
  // 향후 arXiv, Gutenberg 등 추가 예정
});
```

### 스케줄러 제어 기능
- **자동 시작**: 서버 시작 시 자동 초기화
- **수동 트리거**: 관리자 대시보드에서 즉시 실행
- **상태 모니터링**: 실행 상태, 마지막/다음 실행 시간 추적
- **에러 처리**: 개별 피드 실패가 전체 동기화를 중단하지 않음

## 통합 처리 파이프라인

### V2 문서 생성 파이프라인 (`server/services/DocumentService.ts`)
모든 소스가 동일한 파이프라인 사용:

1. **콘텐츠 추출** → 원본 텍스트/HTML 획득
2. **구조화된 블록 생성** → 단락, 제목, 리스트 등으로 분류
3. **문장 분할** → 언어학습용 문장 단위 분리
4. **앵커 연결** → 구조화된 블록과 문장 ID 매칭
5. **메타데이터 저장** → 소스, 버전, 스키마 정보 보존

### 파서 모드별 처리
- **RSS/Web**: `ParserMode.HTML` - DOM 기반 블록화
- **arXiv**: PDF → 텍스트 → 학술 특화 구조화
- **Gutenberg**: 텍스트 → 챕터/문단 구조화

## 관리자 제어 시스템 (`client/src/pages/AdminNew.tsx`)

### 시스템 현황 모니터링
- **문서 통계**: 전체/사용자/공개/만료 문서 수
- **스케줄러 상태**: 실행 상태, 마지막/다음 실행 시간
- **RSS 건강도**: 활성 피드, 건강한 피드, 문제 피드 수

### 운영 제어 기능

#### 시스템 소스 관리
- **arXiv 학술 논문**: 항상 활성화, 관리자 제어
- **Project Gutenberg**: 항상 활성화, 관리자 제어

#### RSS 소스 관리
- **Feed 관리**: 전역 피드 목록, 건강도 모니터링
- **Subscription 관리**: 사용자별 구독 현황
- **정책 설정**: 사용자당 최대 피드, 일일 페치 한도, 승인 필요 여부

#### 스케줄러 제어
- **자동 스케줄러**: 시작/재시작/중지 제어
- **수동 실행**: 전체/RSS/시스템 소스별 개별 실행
- **선택 실행**: 특정 RSS 피드만 선택하여 실행

## 초기화 및 시딩 프로세스 (`server/index.ts`)

### 서버 시작 시 자동 처리
1. **기존 콘텐츠 확인**: 데이터베이스에 문서 존재 여부 검사
2. **자동 시딩**: 콘텐츠가 없을 경우 자동으로 초기 데이터 생성
   - Project Gutenberg 고전 문학 10권
   - arXiv 학술 논문 5편
3. **스케줄러 초기화**: RSS 및 통합 스케줄러 자동 시작

```typescript
// 시딩 로직 예시
if (existingDocumentCount === 0) {
  console.log("[seed] No existing documents found, starting seeding...");
  await seedGutenbergBooks();
  await seedArxivPapers();
} else {
  console.log("[seed] Database already has documents, skipping seed");
}
```

## 데이터 모델 및 메타데이터

### 문서 메타데이터
- **소스 정보**: `content_source_type`, `source`, `sourceDomain`
- **구조 정보**: `structuredVersion`, `anchorSchemaVersion`
- **처리 정보**: `tokenizer_version`, `parserMode`
- **URL 정보**: `raw_url`, `canonical_url`, `fetched_at`

### 구조화된 블록
```typescript
interface StructuredBlock {
  type: 'paragraph' | 'heading' | 'list_item' | 'table' | 'image' | 'code';
  index: number;
  content: string; // 순수 텍스트만 저장
  meta: {
    tag?: string;
    headingLevel?: number;
    listType?: 'ordered' | 'unordered';
    depth?: number;
    // 기타 레이아웃 정보
  };
  anchor?: string; // 문장 ID와의 연결점
}
```

## 품질 관리 및 모니터링

### 성능 지표
- **URL 성공률**: 본문 추출 가능 ≥ 95%
- **앵커 커버리지**: 최저 90%, 평균 95%+
- **구조화 품질**: 태그 노출 0건, 적절한 블록 수 (8-20개)
- **메타데이터 수집**: Open Graph/메타 태그 수집 성공률 ≥ 90%

### 중복 방지 메커니즘
- **URL 정규화**: 프로토콜, www, trailing slash 통일
- **해시 기반 검사**: SHA-256 해시로 빠른 중복 검색
- **Feed 기준 처리**: 1회 fetch → Subscription fan-out

### 에러 처리
- **건강도 기반 차단**: 연속 실패 시 자동 비활성화
- **그레이스풀 처리**: 개별 소스 실패가 전체에 영향 주지 않음
- **재시도 로직**: 네트워크 오류 시 자동 재시도
- **상세 로깅**: 실패 원인 추적 및 디버깅 지원

## 향후 확장 계획

### URL 가져오기 기능 (계획 중)
- **RSS 파이프라인 재사용**: 기존 HTML 처리 로직 활용
- **Explore vs Library**: Explore에서는 미리보기만, Library 저장 시 앵커 생성
- **보안 강화**: 도메인 화이트리스트/블랙리스트, robots.txt 준수

### 추가 소스 통합
- **학술 데이터베이스**: PubMed Central, bioRxiv 등
- **교육 콘텐츠**: TED Talk 자막, Wikipedia Featured Articles
- **뉴스 소스**: The Guardian Open Platform (API 키 필요)

## 기술적 특징

### 통합 아키텍처
- **단일 파이프라인**: 모든 소스가 동일한 V2 처리 경로 사용
- **일관된 품질**: 소스에 관계없이 동일한 구조화 및 앵커링
- **확장성**: 새로운 소스 추가가 용이한 모듈형 설계

### 성능 최적화
- **배치 처리**: 여러 문서 동시 처리
- **요청 제한**: 서버 부하 방지를 위한 딜레이 및 제한
- **큐 시스템**: 썸네일 추출 등 백그라운드 작업 분리
- **캐시 전략**: 중복 요청 방지 및 빠른 응답

이 시스템은 **안정적인 큐레이션 + 사용자 확장 가능한 RSS**의 하이브리드 방식으로 운영되며, 모든 크롤링은 통합된 V2 파이프라인을 통해 일관된 품질로 처리됩니다.
