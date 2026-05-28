export type Priority = "urgent" | "reply_needed" | "reference";

export type Mail = {
  id: string;
  sender: string;
  subject: string;
  receivedAt: string;
  label: Priority;
  summary: string;
  body: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  time: string;
  location: string;
};

export type Task = {
  id: string;
  title: string;
  owner: string;
  due: string;
  source: "manual" | "meeting" | "mail";
  done: boolean;
  pinned?: boolean;
};

export type CalendarEventData = {
  title: string;
  startDateTime: string; // ISO 8601 (allDay 시 날짜만 "YYYY-MM-DD")
  endDateTime: string;   // ISO 8601 (allDay 시 날짜만 "YYYY-MM-DD")
  allDay?: boolean;       // true면 종일 일정 (Google Calendar date 형식)
  description?: string;
  location?: string;
  timeZone?: string;
};

export type Approval = {
  id: string;
  type: "email_send" | "calendar_change" | "doc_share" | "task_create";
  title: string;
  description: string;
  draft?: string;
  evidence?: string[];
  risk: "low" | "medium" | "high";
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  // 실제 실행 데이터
  recipientEmail?: string;     // email_send: 수신자 주소
  replySubject?: string;       // email_send: 제목
  calendarEventData?: CalendarEventData; // calendar_change: 생성할 일정
  executedAt?: string;         // 실제 실행된 시각
};

export type BriefingResult = {
  summary: string;
  highlights: string[];
  actions: string[];
};

export type DraftReplyResult = {
  draft: string;
  evidence: string[];
};

export type MeetingActionResult = {
  tasks: Task[];
  evidence: string[];
};

export type LogEntry = {
  id: string;
  action: string;
  detail: string;
  status: "success" | "failed" | "pending" | "rejected";
  createdAt: string;
};

export type AgentStatus = "pending" | "running" | "done" | "error" | "killed";

export type AgentTask = {
  id: string;
  prompt: string;
  workdir: string;
  skipPermissions: boolean;
  status: AgentStatus;
  output: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  exitCode?: number;
};
