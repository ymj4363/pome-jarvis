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
- 배포: `npx wrangler pages deploy dist --project-name pome-jarvis --commit-dirty=true`
  (wrangler 로그인 필요. Pages 환경변수 OWNER_EMAIL 설정됨)
- 커밋 전 `dist/assets/*.js`에 localhost가 새로 들어가지 않았는지 확인 (기존 3건은
  로컬 에이전트 모드 전용으로 정상 — prep 스킬 부록 A 참조).

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
   wrangler 자식 esbuild/workerd가 잔존하면 CommandLine 경로 매칭으로 정리)

**디자인 선택지를 제시할 때는 이 절차로 각 안을 임시 적용한 실제 스크린샷을 찍어
나란히 보여준다** (전역 CLAUDE.md "질문할 때의 의무" 참조).

## 알려진 특성

- 반복 건은 크론이 아니라 bootstrap API 호출 시(화면 열 때) 그 달 치를 멱등 생성.
- 기간 필터·집계는 클라이언트 필터 (개인 규모 전제 — 수천 건 규모가 되면 서버 쿼리로).
- localStorage는 ledger에 사용 금지 (재무 데이터는 전부 D1).
