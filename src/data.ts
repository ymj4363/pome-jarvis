import type { Approval, CalendarEvent, LogEntry, Mail, Task } from "./types";

export const initialMails: Mail[] = [
  {
    id: "mail-1",
    sender: "ops@company.com",
    subject: "[긴급] 서버 장애 보고",
    receivedAt: "오늘 08:42",
    label: "urgent",
    summary: "운영 서버 장애 확인과 복구 상태 공유가 필요합니다.",
    body: "현재 프로덕션 API 응답 지연이 발생했습니다. 원인과 예상 복구 시간을 확인해 주세요."
  },
  {
    id: "mail-2",
    sender: "manager@company.com",
    subject: "Q2 보고서 검토 요청",
    receivedAt: "어제 17:20",
    label: "reply_needed",
    summary: "Q2 보고서 의견을 금요일 전까지 회신해야 합니다.",
    body: "첨부한 Q2 보고서 초안을 검토하고 수정 의견을 알려 주세요."
  },
  {
    id: "mail-3",
    sender: "newsletter@tech.io",
    subject: "AI 업무 자동화 리포트",
    receivedAt: "어제 09:10",
    label: "reference",
    summary: "AI 에이전트와 업무 자동화 도입 사례를 다룹니다.",
    body: "이번 주 주요 기술 트렌드와 자동화 사례를 정리했습니다."
  }
];

export const initialEvents: CalendarEvent[] = [
  { id: "event-1", title: "운영 이슈 점검", time: "09:30 - 10:00", location: "Zoom" },
  { id: "event-2", title: "제품 로드맵 리뷰", time: "14:00 - 15:30", location: "회의실 A" },
  { id: "event-3", title: "집중 작업 후보", time: "16:00 - 17:30", location: "캘린더 제안" }
];

export const initialTasks: Task[] = [
  { id: "task-1", title: "서버 장애 원인 정리", owner: "나", due: "오늘", source: "mail", done: false },
  { id: "task-2", title: "Q2 보고서 수정 의견 작성", owner: "나", due: "금요일", source: "mail", done: false },
  { id: "task-3", title: "로드맵 리뷰 회의록 정리", owner: "나", due: "내일", source: "meeting", done: false }
];

export const initialApprovals: Approval[] = [
  {
    id: "approval-1",
    type: "email_send",
    title: "Q2 보고서 검토 회신 초안",
    description: "manager@company.com에게 검토 완료와 주요 수정 의견을 전달하는 초안입니다.",
    risk: "medium",
    createdAt: "방금 전",
    status: "pending"
  },
  {
    id: "approval-2",
    type: "calendar_change",
    title: "내일 16:00 집중 시간 블록",
    description: "내일 오후 빈 시간을 집중 작업 시간으로 캘린더에 추가하는 제안입니다.",
    risk: "low",
    createdAt: "5분 전",
    status: "pending"
  }
];

export const initialLogs: LogEntry[] = [
  {
    id: "log-1",
    action: "briefing.generated",
    detail: "오늘의 운영판 브리핑을 생성했습니다.",
    status: "success",
    createdAt: "오늘 08:55"
  },
  {
    id: "log-2",
    action: "mail.classified",
    detail: "최근 메일 3건을 긴급, 답장 필요, 참고로 분류했습니다.",
    status: "success",
    createdAt: "오늘 08:56"
  }
];

