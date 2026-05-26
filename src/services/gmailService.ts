import type { Mail } from "../types";

/**
 * Cloudflare Function /api/gmail/* 를 통해 Gmail 연동.
 */

/* ── 메일 목록 조회 ──────────────────────────────────────────────── */

export async function fetchGmailMessages(
  accessToken: string
): Promise<{ mails: Mail[]; nextPageToken?: string }> {
  const response = await fetch("/api/gmail/messages", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "unknown" })) as { error?: string };
    throw new Error(`Gmail fetch failed (${response.status}): ${body.error ?? ""}`);
  }

  const data = await response.json() as { mails: Mail[]; nextPageToken?: string };
  return data;
}

/* ── 다음 페이지 메일 조회 ───────────────────────────────────────── */

export async function fetchMoreMails(
  accessToken: string,
  pageToken: string
): Promise<{ mails: Mail[]; nextPageToken?: string }> {
  const response = await fetch(
    `/api/gmail/messages?pageToken=${encodeURIComponent(pageToken)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    throw new Error(`Gmail fetch more failed (${response.status})`);
  }

  return response.json() as Promise<{ mails: Mail[]; nextPageToken?: string }>;
}

/* ── 메일 본문 전체 조회 ─────────────────────────────────────────── */

export async function fetchMailBody(
  accessToken: string,
  messageId: string
): Promise<string> {
  const response = await fetch(`/api/gmail/body/${encodeURIComponent(messageId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new Error(`Gmail body fetch failed (${response.status})`);
  }

  const data = await response.json() as { body: string };
  return data.body;
}

/* ── 메일 발송 ───────────────────────────────────────────────────── */

export async function sendEmail(
  accessToken: string,
  to: string,
  subject: string,
  body: string
): Promise<void> {
  const response = await fetch("/api/gmail/send", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ to, subject, body })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: "unknown" })) as {
      error?: string;
      detail?: string;
    };
    throw new Error(data.error ?? `Send failed: ${response.status}`);
  }
}
