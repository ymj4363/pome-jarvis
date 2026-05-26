import type { Approval, DraftReplyResult, Mail } from "../types";
import { makeId } from "./utils";

/** "John Doe <john@example.com>" → "john@example.com" */
function extractEmail(sender: string): string {
  const match = sender.match(/<([^>]+)>/);
  return match ? match[1].trim() : sender.trim();
}

export function createReplyDraftApproval(mail: Mail, result: DraftReplyResult): Approval {
  return {
    id:           makeId("approval"),
    type:         "email_send",
    title:        `${mail.subject} 회신 초안`,
    description:  `${mail.sender}에게 보낼 답장 초안입니다. 승인하면 Gmail을 통해 실제로 발송됩니다.`,
    draft:        result.draft,
    evidence:     result.evidence,
    risk:         mail.label === "urgent" ? "high" : "medium",
    createdAt:    "방금 전",
    status:       "pending",
    recipientEmail: extractEmail(mail.sender),
    replySubject:   `Re: ${mail.subject}`
  };
}

export function decideApproval(
  approvals: Approval[],
  approvalId: string,
  status: "approved" | "rejected"
) {
  return approvals.map(approval =>
    approval.id === approvalId ? { ...approval, status } : approval
  );
}
