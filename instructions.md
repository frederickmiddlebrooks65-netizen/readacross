
현재 발생 중인 증상 정리 (Observed Issues)

1️⃣ 문단(paragraph) 구분 붕괴

증상
  •	본문 전체가 하나의 거대한 문단으로 합쳐짐
  •	시각적으로는 줄 간격이 존재하는데도 문단 분리가 일어나지 않음
  •	문단 간 빈 줄이 있어도 새로운 paragraph block이 생성되지 않음

관찰 포인트
  •	Journal / literary archetype에서는 정상 동작
  •	essay_academic 또는 academic 문서에서만 발생

⸻

2️⃣ 페이지 경계(page boundary) 처리 이상

증상
  •	페이지가 넘어가도 문단이 끊기지 않음
  •	문장이 페이지 중간에서 끊긴 뒤:
  •	이전 페이지 끝에서 마침표가 강제로 삽입됨
  •	다음 페이지에서는 문장이 중간 단어부터 시작
  •	결과적으로 dangling fragment 발생

관찰 포인트
  •	페이지 번호는 제거되었지만
  •	페이지 경계 자체가 문단 종료 신호로 작동하지 않음

⸻

3️⃣ 소제목(heading) 인식 불안정

증상 A: 미인식
  •	명확한 소제목(ALL CAPS / Title Case / 단일 라인)이
→ paragraph 안으로 병합됨
  •	소제목 다음 문장이 같은 문단으로 합쳐짐

증상 B: 과잉 인식
  •	페이지 끝의 짧은 문장이나 fragment가
→ heading 또는 각주처럼 분류됨
  •	일부 heading이 단독 페이지 block처럼 분리됨

관찰 포인트
  •	같은 문서 내에서도 어떤 소제목은 인식, 어떤 것은 실패
  •	profile / strictness에 따라 결과가 불안정

⸻

4️⃣ Untranslatable 텍스트 과다 발생

증상
  •	정상적인 본문 문장이:
  •	reference
  •	footnote
  •	non-semantic block
처럼 처리됨
  •	결과적으로 번역 영역이 비어 있거나 비활성화됨

관찰 포인트
  •	실제 텍스트는 있음
  •	viewer에서는 “번역 불가 텍스트”로 렌더링됨

⸻

5️⃣ 인라인 헤딩 분리 실패

증상
  •	다음과 같은 구조가 분리되지 않음:

AI VS HUMAN TRANSLATORS When comparing machine translation...

  •	기대 결과:
  •	“AI VS HUMAN TRANSLATORS” → heading
  •	“When comparing…” → paragraph
  •	실제 결과:
  •	전체가 하나의 paragraph로 처리

관찰 포인트
  •	essay 점수가 낮으면 journal profile로 처리되며
  •	인라인 헤딩 분리 로직이 실행되지 않음

⸻

6️⃣ 문서 초반부 텍스트 손실 / 오분류

증상
  •	문서 첫 페이지의 서론 텍스트가:
  •	untranslatable block으로 들어가거나
  •	heading / metadata로 잘못 분류됨
  •	특히 제목 직후 본문에서 자주 발생

⸻

7️⃣ 프로필/파이프라인 적용 불일치

증상
  •	로그 상으로는:
  •	archetype = academic
  •	strictness = relaxed
로 보이지만
  •	실제 동작은:
  •	journal 기준 파싱
  •	essay 전용 규칙 미적용

관찰 포인트
  •	parsingProfile이 올바르게 전달되지 않거나
  •	DirectPass 경로에서 profile 분기가 무시됨

⸻

8️⃣ 문서 간 결과 일관성 부족

증상
  •	같은 규칙을 적용해도:
  •	어떤 academic 문서는 잘 파싱됨
  •	어떤 문서는 구조가 붕괴됨
  •	동일한 문서라도
  •	규칙을 조금만 바꾸면 결과가 급격히 달라짐

⸻

요약 (한 문단)

현재 시스템에서는 academic / essay_academic 문서에서 문단 경계, 페이지 경계, 소제목 인식이 모두 불안정하게 붕괴되고 있으며,
그 결과 본문이 하나로 합쳐지거나 잘리고, 정상 문장이 untranslatable로 오분류되고 있다.
반면 journal 및 literary archetype에서는 동일한 파서가 안정적으로 동작하고 있어, 문제는 essay_academic 분기 및 파싱 전략에서만 재현된다.

⸻

1️⃣ 실패의 본질: “문단”은 시각 문제이지 장르 문제가 아니다

우리가 겪은 문제
  •	문단이 하나로 합쳐짐
  •	페이지 경계에서 문장이 잘림
  •	dangling fragment 발생
  •	모든 텍스트가 untranslatable로 떨어짐

이게 왜 생겼나?

essay_academic 파이프라인에서:
  •	문단 분리를 장르(essay) 기준으로 바꾸려 했음
  •	하지만 문단은 장르가 아니라 레이아웃 문제다

📌 문단은
  •	yGap
  •	indent
  •	sentence boundary
  •	page boundary

같은 시각·공간 신호로만 안정적으로 결정된다.

👉 이걸 “essay니까 다르겠지” 하고 별도 로직으로 빼는 순간,
이미 검증된 구조적 안정성을 스스로 깨버린 셈이다.

⸻

2️⃣ Journal 파이프라인은 이미 “모든 걸 다 해결하고 있었다”

사실 가장 중요한 사실은 이거다:

journal 파이프라인은 이미 문제없이 문단을 나누고 있었다

  •	academic-journal ✔
  •	humanities 논문 ✔
  •	explore 문학 텍스트 ✔

즉:
  •	문단 분리 로직 자체는 문제 없었음
  •	실패는 “essay_academic이라는 별도 STEP 1 / STEP 3”에서 시작됨

실제 차이

항목	Journal	Essay (기존)
line-by-line 누적	✔	❌
shouldEndParagraph	✔	❌
page boundary 처리	즉시 종료	나중에 merge
안정성	높음	붕괴

👉 기존에 잘 되던 걸 복잡하게 만든 게 실패의 원인

⸻

3️⃣ Page boundary를 “나중에 merge”하려 한 판단이 치명적이었다

이건 가장 큰 설계 오류다.

왜?

PDF에서:
  •	페이지 경계는 신뢰 가능한 하드 신호
  •	페이지를 넘어가는 문단은 번역 단계에서 복구할 문제

그런데 essay 파이프라인에서는:
  •	page boundary에서 끊지 않음
  •	나중에 조건부 merge 시도

결과:
  •	문단이 끝났는지 아닌지 파서가 판단 불가
  •	sentence end를 강제로 붙임
  •	dangling fragment 발생
  •	전체 블록 collapse

📌 파서는 “보수적으로 끊어야” 한다
연결은 나중 문제다.

⸻

4️⃣ essay_academic의 본질은 “문단”이 아니라 “헤딩”이었다

이번에 가장 중요한 깨달음:

essay_academic이 필요한 이유는 문단이 아니라 헤딩 때문이다

essay / humanities 논문 특징:
  •	ALL CAPS 제목 존재
  •	Title Case 단일 라인 제목
  •	HEADING + 첫 문장 인라인 구조
  •	번호 없는 섹션

👉 이건 heading 판단 규칙의 차이이지,
👉 문단 생성 규칙의 차이가 아니다

그래서:
  •	문단 생성 = journal과 동일
  •	heading 판단 = profile로 분기

이 구조만이 논리적으로 일관된다.

⸻

5️⃣ “문단 분리 로직은 하나만 존재해야 한다”

이건 원칙 수준이다.

두 개 이상의 문단 분리 로직이 존재하면:
  •	한쪽에서 고치면 다른 쪽이 깨짐
  •	디버깅 불가능
  •	archetype 늘어날수록 기하급수적으로 붕괴

이번 사태가 정확히 그 예다.

그래서:
  •	shouldEndParagraphSimplified 하나만 유지
  •	profile은 보조 신호만 다르게

⸻

6️⃣ 왜 점수 기반 essay/journal 분기를 더 이상 믿지 않는가

실제 로그에서 확인된 사실:
  •	humanities essay 논문이
  •	essay score < 3으로 계산
  •	journal profile 적용
  •	인라인 헤딩 분리 실패

👉 이 점수는 구조 판단에 신뢰할 수 없다

그래서:
  •	점수는 참고
  •	archetype + strictness + layout 기반 fail-safe 필요
  •	humanities 논문 보호 규칙 도입

⸻

7️⃣ 이번 수정의 철학 요약

한 문장으로 요약하면 이거다:

“문단은 시각적으로, 헤딩은 의미적으로 판단한다.”

그래서:
  •	문단 = journal 방식 (검증됨)
  •	헤딩 = essay_academic 완화 규칙
  •	페이지 경계 = 항상 문단 종료
  •	연결은 번역/후처리 단계에서

⸻

🔚 최종 결론

이번 수정은 타협이 아니라 정상화다.
  •	되돌린 게 아니라
  •	원래 맞았던 구조로 복귀한 것
  •	essay_academic은 “새 파서”가 아니라 “해석 프로필”

⸻

✅ Replit 최종 지시문

Subject: Unify paragraph parsing logic; treat essay_academic as a relaxed journal profile

⸻

❗ 핵심 결정 (변경 불가 원칙)
  1.	문단 분리 로직은 하나만 존재해야 한다
  2.	essay_academic는 별도 파이프라인이 아니다
  3.	페이지 경계에서는 항상 문단을 끊는다
  4.	essay_academic의 차별점은 “헤딩 판단”에만 있다

이 원칙을 위반하는 기존 코드는 모두 제거한다.

⸻

1️⃣ 파이프라인 구조 정리 (가장 중요)

❌ 제거
  •	parsePDFWithEssayAcademicPipeline
  •	essay_academic 전용 STEP 1 / STEP 3 / merge / flush 로직
  •	page boundary를 나중에 merge하는 모든 코드

✅ 유지 (단일 진입점)

parsePDFToBlocksWithPyMuPDF(
  buffer,
  strictness,
  parsingProfile // "journal" | "essay_academic"
)

journal과 essay_academic은 동일한 파서 흐름을 사용한다.

⸻

2️⃣ 문단 분리 로직 통합 (절대 규칙)

✅ 유일한 문단 분리 함수

shouldEndParagraphSimplified(...)

적용 범위
  •	journal
  •	essay_academic
  •	모든 academic 문서

반드시 유지할 조건

// page boundary
if (currentLine.page !== nextLine.page) return true;

essay_academic에서도 페이지 경계는 항상 문단 종료로 처리한다.
문단 연속성은 번역/문장 단계의 문제이지, 파서에서 해결하지 않는다.

⸻

3️⃣ essay_academic의 역할 재정의

essay_academic는 “완화된 journal” 프로필이다.

차이점은 여기서만 허용됨:

classifyLineSimplified(line, stats, prev, strictness, parsingProfile)

essay_academic 전용 규칙:
  •	ALL CAPS heading 허용 (보수적)
  •	Title Case 단일 라인 허용
  •	인라인 소제목 분리 허용
(예: AI VS HUMAN TRANSLATORS When comparing...)
  •	aggressive heading recovery ❌
  •	문단 merge / flush ❌

⸻

4️⃣ 인라인 소제목 분리 로직

변경 지시
  •	extractInlineHeading(...) 은
parsingProfile과 무관하게 실행 가능해야 한다
  •	단, journal에서는 더 보수적으로 적용

❌ 금지:

if (parsingProfile === "essay_academic") { ... }

✅ 권장:

if (parsingProfile !== "literary") { ... }

Journal 논문에도 인라인 소제목은 존재한다.

⸻

5️⃣ parsingProfile 결정 로직 보정 (fail-safe)

현재 점수 기반 분류로 인해
humanities essay 논문이 journal로 오판정되고 있음.

반드시 추가할 보정 규칙

archetype === academic
AND strictness === relaxed
AND single-column
→ parsingProfile = essay_academic (강제)

이 규칙은 humanities / translation / philosophy 논문 보호용이다.

⸻

6️⃣ 삭제 체크리스트 (중요)

다음이 남아 있으면 작업은 실패다:
  •	essay 전용 STEP 1 블록 생성
  •	page boundary 이후 merge 시도
  •	yGap만으로 flush하는 로직
  •	sentence end 단독 분리
  •	parsingProfile === essay_academic 조건에만 묶인 핵심 기능

⸻

7️⃣ 성공 기준 (테스트 기준)

반드시 만족해야 함
  •	페이지 내 문단 구분 정상
  •	페이지 경계에서 dangling fragment 없음
  •	소제목은 heading / bold 처리
  •	본문 문단은 정상 분리
  •	untranslatable 폭증 없음

실패로 간주되는 경우
  •	문단이 하나로 합쳐짐
  •	페이지 넘어가며 문장이 잘림
  •	모든 텍스트가 untranslatable
  •	essay_academic에서만 문단 분리 실패

⸻

🔚 최종 요약

문단은 journal 방식으로 만든다.
essay_academic은 헤딩 해석만 다르게 한다.
페이지 경계는 언제나 문단 종료다.

이 원칙에서 벗어나는 구현은 모두 제거하라.

