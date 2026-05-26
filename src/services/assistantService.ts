import type {
  BriefingResult,
  CalendarEvent,
  DraftReplyResult,
  Mail,
  MeetingActionResult,
  Task
} from "../types";
import { sentenceToTask } from "./meetingService";

type ApiDraftReplyResponse = DraftReplyResult & {
  source?: "openai" | "fallback";
};

type ApiExtractActionsResponse = {
  tasks: Array<Pick<Task, "title" | "owner" | "due">>;
  evidence: string[];
  source?: "openai" | "fallback";
};

type ApiBriefingResponse = {
  ok?: boolean;
  fallback?: boolean;
  summary?: string;
  highlights?: string[];
  actions?: string[];
  error?: string;
};

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

function fallbackDraftReply(mail: Mail): DraftReplyResult {
  return {
    draft: [
      `${mail.sender} 담당자님, 안녕하세요.`,
      "",
      `보내주신 "${mail.subject}" 메일 확인했습니다.`,
      mail.label === "urgent"
        ? "우선 현재 상황을 확인하고 있으며, 확인되는 원인과 조치 계획을 정리해서 공유드리겠습니다."
        : "요청하신 내용을 검토한 뒤 주요 의견과 필요한 수정 사항을 정리해 회신드리겠습니다.",
      "",
      "감사합니다."
    ].join("\n"),
    evidence: [
      `원문 제목: ${mail.subject}`,
      `요약 근거: ${mail.summary}`,
      `분류: ${mail.label}`
    ]
  };
}

function fallbackExtractMeetingActions(meetingText: string): MeetingActionResult {
  const sentences = meetingText
    .split(/[.!?。]\s*|\n/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    tasks: sentences.map(sentenceToTask),
    evidence: sentences.map(sentence => `회의록 문장: ${sentence}`)
  };
}

async function postJson<TResponse>(path: string, body: unknown): Promise<TResponse> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json() as Promise<TResponse>;
}

export async function draftReply(mail: Mail): Promise<DraftReplyResult> {
  try {
    return await postJson<ApiDraftReplyResponse>("/api/assistant/draft-reply", { mail });
  } catch {
    await wait(250);
    return fallbackDraftReply(mail);
  }
}

export async function extractMeetingActions(meetingText: string): Promise<MeetingActionResult> {
  try {
    const result = await postJson<ApiExtractActionsResponse>("/api/assistant/extract-actions", { meetingText });

    return {
      tasks: result.tasks.map(task => ({
        ...task,
        id:     crypto.randomUUID(),
        source: "meeting",
        done:   false
      })),
      evidence: result.evidence
    };
  } catch {
    await wait(250);
    return fallbackExtractMeetingActions(meetingText);
  }
}

/* ── AI 브리핑 ────────────────────────────────────────────────────── */

export async function fetchBriefing(
  mails:     Mail[],
  events:    CalendarEvent[],
  userName?: string
): Promise<BriefingResult | null> {
  try {
    const result = await postJson<ApiBriefingResponse>("/api/assistant/briefing", {
      mails:    mails.map(m => ({ subject: m.subject, sender: m.sender, label: m.label, summary: m.summary })),
      events:   events.map(e => ({ title: e.title, time: e.time, location: e.location })),
      userName: userName ?? "사용자"
    });

    if (result.fallback || !result.ok) return null;

    return {
      summary:    result.summary    ?? "",
      highlights: result.highlights ?? [],
      actions:    result.actions    ?? []
    };
  } catch {
    return null;
  }
}
