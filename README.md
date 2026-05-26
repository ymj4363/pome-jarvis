# Pome Jarvis

승인형 개인 운영비서 MVP입니다. 1차 목표는 외부 서비스 완전 연동이 아니라 핵심 UX, 승인 흐름, 실행 로그 구조를 검증하는 데모입니다.

## MVP 범위

- 오늘의 운영판: 일정, 메일, 할 일, 추천 액션 요약
- 이메일 요약: 긴급, 답장 필요, 참고 메일 분류
- 답장 초안: 샘플 메일 기반 초안 생성
- 일정 제안: 집중 시간 후보 제안
- 회의록 액션 추출: 담당자, 기한, 할 일 추출
- 승인 대기함: 실행 전 승인/거절
- 실행 로그: 제안, 승인, 거절 이력 기록

## 개발

```bash
pnpm install
pnpm dev
```

## 빌드

```bash
pnpm build
```

## Cloudflare Pages

- Build command: `pnpm build`
- Output directory: `dist`

### Assistant API

Cloudflare Pages Functions are included under `functions/api/assistant/*`.

- `POST /api/assistant/draft-reply`
- `POST /api/assistant/extract-actions`

If `ANTHROPIC_API_KEY` is not configured, the functions return deterministic fallback responses so the MVP demo keeps working.

To enable real Claude responses, add these Cloudflare Pages environment variables/secrets:

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_MODEL` optional, default: `claude-3-5-haiku-latest`
- `ANTHROPIC_DRAFT_MODEL` optional, used for reply drafts
- `ANTHROPIC_MEETING_MODEL` optional, used for meeting action extraction

Recommended MVP values:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `ANTHROPIC_MODEL` | `claude-3-5-haiku-latest` |
| `ANTHROPIC_DRAFT_MODEL` | `claude-sonnet-4-20250514` |
| `ANTHROPIC_MEETING_MODEL` | `claude-sonnet-4-20250514` |

Cloudflare input path:

1. Open Cloudflare Dashboard.
2. Go to `Workers & Pages`.
3. Open the `pome-jarvis` Pages project.
4. Go to `Settings`.
5. Open `Environment variables`.
6. Under `Production`, add the variables above.
7. Save changes.
8. Trigger a new deployment from `Deployments` or push a commit to `main`.

Anthropic API reference:

- https://docs.anthropic.com/en/api/messages
- https://docs.anthropic.com/en/docs/about-claude/models/overview

### Automatic deployment

Use Cloudflare Pages Git integration:

- Repository: `ymj4363/pome-jarvis`
- Production branch: `main`
- Build command: `pnpm build`
- Build output directory: `dist`
- Root directory: leave empty
