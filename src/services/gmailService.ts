import type { Mail } from "../types";

/**
 * Cloudflare Function /api/gmail/messages 를 통해 Gmail 메일 조회.
 * 함수 내부에서 Gmail API 호출 + Claude 분류 처리.
 */
export async function fetchGmailMessages(accessToken: string): Promise<Mail[]> {
  const response = await fetch("/api/gmail/messages", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "unknown" })) as { error?: string };
    throw new Error(`Gmail fetch failed (${response.status}): ${body.error ?? ""}`);
  }

  const data = await response.json() as { mails: Mail[] };
  return data.mails;
}
