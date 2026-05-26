import type { Approval, Mail } from "../types";
import { makeId } from "./utils";

export function createReplyDraftApproval(mail: Mail): Approval {
  return {
    id: makeId("approval"),
    type: "email_send",
    title: `${mail.subject} 회신 초안`,
    description: `${mail.sender}에게 보낼 답장 초안입니다. 실제 발송은 MVP 범위에서 제외하고 승인 로그만 남깁니다.`,
    risk: mail.label === "urgent" ? "high" : "medium",
    createdAt: "방금 전",
    status: "pending"
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

