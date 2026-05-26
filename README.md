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

