import type { DraftReplyResult, Mail, MeetingActionResult } from "../types";
import { sentenceToTask } from "./meetingService";

const wait = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

export async function draftReply(mail: Mail): Promise<DraftReplyResult> {
  await wait(250);

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

export async function extractMeetingActions(meetingText: string): Promise<MeetingActionResult> {
  await wait(250);

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

