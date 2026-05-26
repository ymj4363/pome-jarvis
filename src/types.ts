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
};

export type Approval = {
  id: string;
  type: "email_send" | "calendar_change" | "doc_share" | "task_create";
  title: string;
  description: string;
  risk: "low" | "medium" | "high";
  createdAt: string;
  status: "pending" | "approved" | "rejected";
};

export type LogEntry = {
  id: string;
  action: string;
  detail: string;
  status: "success" | "failed" | "pending" | "rejected";
  createdAt: string;
};

