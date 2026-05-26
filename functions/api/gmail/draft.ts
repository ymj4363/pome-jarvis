/**
 * POST /api/gmail/draft
 * Authorization: Bearer <access_token>
 * Body: { to, subject, body }
 *
 * RFC 2822 메시지를 빌드해 Gmail 임시저장함(Drafts)에 저장.
 * messages/send 대신 drafts API 사용 — 사용자가 Gmail에서 최종 발송.
 */

type Env = Record<string, string>;

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

interface DraftRequest {
  to: string;
  subject: string;
  body: string;
}

function buildRFC2822(to: string, subject: string, body: string): string {
  const message = [
    `To: ${to}`,
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset="UTF-8"`,
    `MIME-Version: 1.0`,
    `Content-Transfer-Encoding: 8bit`,
    "",
    body
  ].join("\r\n");

  const bytes = new TextEncoder().encode(message);
  let binary = "";
  bytes.forEach(b => (binary += String.fromCharCode(b)));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function onRequestPost({ request }: { request: Request; env: Env }) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders
    });
  }
  const accessToken = auth.slice(7);

  let body: DraftRequest;
  try {
    body = (await request.json()) as DraftRequest;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  if (!body.to || !body.subject || !body.body) {
    return new Response(JSON.stringify({ error: "to, subject, body 필드 필요" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  const raw = buildRFC2822(body.to, body.subject, body.body);

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ message: { raw } })
  });

  if (!res.ok) {
    const detail = await res.text();
    return new Response(
      JSON.stringify({ error: `Gmail drafts failed: ${res.status}`, detail: detail.slice(0, 200) }),
      { status: 502, headers: jsonHeaders }
    );
  }

  const data = await res.json() as { id: string };
  return new Response(JSON.stringify({ ok: true, draftId: data.id }), { headers: jsonHeaders });
}
