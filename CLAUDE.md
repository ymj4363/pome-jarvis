# Pome Jarvis

승인형 개인 운영비서 (React 19 + Vite + Cloudflare Pages/Functions + D1).
배포: https://pome-jarvis.pages.dev / 저장소: https://github.com/ymj4363/pome-jarvis

## 위키 및 브랜드

- 위키 경로: `D:\옵시디언\wiki` — 작업 기록·ADR은 이곳에 저장한다.
  (이 프로젝트 문서는 `01. 프로젝트\ATIX\Jarvis Assistant\` 트리)
- 브랜드 주황: `#F5A300` / 다크 주황: `#D98E00` / 차콜: `#3A3A3A`
- 위키 기록 전체 규칙은 전역 CLAUDE.md 참조.
- **색 변경 시 hex뿐 아니라 `rgba(...)` 표기도 전수 검색**한다 (2026-08-14 실사고:
  hex만 치환해 rgba 잔재 9곳이 살아남음).

## Git

- git 저장소는 이 프로젝트 폴더 안의 `.git`을 사용한다. 상위 디렉터리 저장소는 쓰지 않는다.
- `.gitignore`에 `node_modules/`, `dist/`, `.wrangler/`, `.env*`, `.dev.vars` 유지.

## 구조 (기능별 분할, 2026-08-14~)

- `src/App.tsx` — 앱 셸·상태 소유 (1단계 분할 후 ~1,700줄; 2단계 분할은 보류 목록)
- `src/constants.tsx` — NAV_ITEMS 등 공용 상수 (메뉴 추가는 여기)
- `src/agent/` `src/mail/` `src/ledger/` — 기능 모듈 / `src/services/` — API 래퍼
- `functions/api/` — Cloudflare Pages Functions (ledger는 D1 사용, `_auth.ts`의
  requireOwner가 구글 토큰 → OWNER_EMAIL 검증)
- `migrations/` — D1 마이그레이션 (`npx wrangler d1 migrations apply pome-jarvis-db
  --local` 또는 `--remote`)

## 빌드·배포

- 빌드: `npm run build` (tsc --noEmit && vite build). pnpm 미설치 — 필요 시 `corepack pnpm`.
- 배포: **로컬 `dist`를 직접 업로드하지 말고 `git push`로 배포한다.**
  `VITE_GOOGLE_CLIENT_ID`는 **Pages 환경변수에만 있고 로컬에는 없어서**, 로컬
  `npm run build` 산출물은 **client id가 빈 채로 빌드된다 — 로그인 버튼이 동작하지 않는
  번들이다.** 그걸 `wrangler pages deploy dist`로 올리면 깨진 배포가 된다 (2026-09-08
  실사고: 두 번 다 그렇게 올렸고, 나중에 끝난 Git 연동 빌드가 apex를 가져가 무사했다 —
  운이지 맞게 한 것이 아니다. 순서가 반대였으면 그 사이 로그인 불가).
  - 검사법: `grep -c 'apps.googleusercontent.com' dist/assets/index-*.js` 가 **0이면
    그 산출물을 배포하면 안 된다.** 로컬 검수용으로만 쓴다.
  - 부득이 직접 업로드해야 하면 `.env`에 `VITE_GOOGLE_CLIENT_ID`를 넣고 다시 빌드한다.
  - 참고 명령(로컬 검수·긴급용): `npx wrangler pages deploy dist --project-name pome-jarvis --commit-dirty=true`
    (wrangler 로그인 필요. Pages 환경변수 OWNER_EMAIL·GOOGLE_CLIENT_SECRET·VITE_GOOGLE_CLIENT_ID 설정됨)
- 커밋 전 `dist/assets/*.js`에 localhost가 새로 들어가지 않았는지 확인 (기존 3건은
  로컬 에이전트 모드 전용으로 정상 — prep 스킬 부록 A 참조).
- **커밋 하나당 배포가 두 개 생긴다** (2026-09-01 확인): 위 직접 업로드본과, GitHub
  연동이 같은 커밋으로 만드는 빌드. 나중에 끝나는 쪽이 apex를 가져가므로 **실제
  서빙본은 대개 Git 연동 빌드**다(번들 해시가 로컬 dist와 다르다 — 정상).
  `npx wrangler pages deployment list --project-name pome-jarvis`로 둘 다 보인다.
  - **해시가 다른 진짜 이유는 빌드 환경 차이가 아니라 환경변수 주입 차이다** (2026-09-08
    규명). Git 연동 빌드에는 `VITE_GOOGLE_CLIENT_ID`가 들어가고 로컬 빌드에는 안 들어간다.
    그래서 "해시가 다르다"를 무해한 차이로만 읽으면 안 된다 — **로컬본이 기능적으로
    열등한 것**이고, 그것이 apex를 가져가면 로그인이 깨진다.
- **배포 검증은 배포 명령의 성공 메시지가 아니라 서빙되는 번들로 한다**:
  `curl -s https://pome-jarvis.pages.dev/ | grep -o 'assets/index-[A-Za-z0-9_-]*\.js'`
  로 실제 서빙 번들을 찾아 내려받고, 이번에 넣은 문구가 있는지 / 없앤 문구가 0건인지
  센다. 성공 메시지는 빌드 실패·엉뚱한 배포 승격·캐시 모두와 양립한다.

## 로컬 검수·화면 목업 절차 (검증된 방법, 2026-08-14)

배포 모드 UI는 `IS_LOCAL`(localhost 판별) 때문에 localhost로는 볼 수 없다:

1. `npm run build` 후 `npx wrangler pages dev dist --port 8788 --ip 127.0.0.1` (백그라운드)
2. 브라우저에서 **http://lvh.me:8788** 접속 (127.0.0.1로 풀리는 공개 DNS 별칭 →
   배포 모드 진입. 127.0.0.2·LAN IP는 방화벽에 막힘)
3. 로그인 게이트 우회: 콘솔에서 `sessionStorage.setItem("pome.google_auth", ...)` 로
   가짜 세션 주입 후 새로고침. API 인증은 `.dev.vars`의 `DEV_ALLOW_ALL=1`이 우회
   (로컬 전용 — 프로덕션에 넣지 않는다)
4. **주의**: lvh.me는 HTTP 비보안 컨텍스트라 `crypto.randomUUID`가 없어 toast/log
   경로가 예외를 던진다 — 가짜 버그. 필요 시 콘솔에서 polyfill 주입 후 테스트.
5. 종료 시 8788 포트 리스너를 PID 특정해서만 종료 (이미지 이름 일괄 종료 금지 —
   wrangler 자식 esbuild/workerd가 잔존하면 CommandLine 경로 매칭으로 정리).
   **CommandLine 매칭 문자열이 내가 지금 실행 중인 명령 자신과도 겹치면 자기 셸을
   죽인다** (2026-09-01 실제로 겪음 — 종료는 됐지만 exit 255). 프로세스명(`node.exe`·
   `workerd.exe`)까지 함께 걸어 좁힌다.
6. ledger 화면 검수는 **로컬 D1에 검수 데이터를 심어야** 상태별(지연·임박·완료·매입)
   화면을 볼 수 있다:
   `npx wrangler d1 execute pome-jarvis-db --local --file seed.sql`
   id를 `demo-*`로 통일해 심고, 확인이 끝나면 `DELETE ... WHERE id LIKE 'demo-%'`로
   지우고 잔여 0건을 확인한다. **`--local`을 빠뜨리면 운영 D1이 대상이다.**
7. 가짜 세션 주입 직후 첫 화면에서는 ledger가 비어 보일 수 있다 — 새로고침 한 번
   더 하면 붙는다 (인증 상태 확정과 첫 bootstrap 호출의 순서 문제).

**디자인 선택지를 제시할 때는 이 절차로 각 안을 임시 적용한 실제 스크린샷을 찍어
나란히 보여준다** (전역 CLAUDE.md "질문할 때의 의무" 참조).

## UI 원칙

- **배지는 상태(형용사), 버튼은 동작(동사)** — 둘이 같은 시각 언어(채운 알약 등)를
  공유하면 사용자가 "이미 된 것"인지 "눌러야 하는 것"인지 구별하지 못한다
  (2026-09-01 실사고: `✓ 수금 완료` 버튼이 상태 배지와 같은 채운 주황 알약이었다).
  동작 버튼에는 완료형 문구를 쓰지 않는다 — "완료"는 배지가 쓴다.
- 상태 배지·금액 라벨·버튼 문구의 **판정은 `src/ledger/constants.ts` 한 곳**
  (`entryPill`·`amountLabel`·`actionLabel`)에서 하고, 대시보드와 목록이 함께 쓴다.
  화면마다 따로 계산하면 한쪽만 고쳐 어긋난다.

## 알려진 특성

- 반복 건은 크론이 아니라 bootstrap API 호출 시(화면 열 때) 그 달 치를 멱등 생성.
- 기간 필터·집계는 클라이언트 필터 (개인 규모 전제 — 수천 건 규모가 되면 서버 쿼리로).
- localStorage는 ledger에 사용 금지 (재무 데이터는 전부 D1).
