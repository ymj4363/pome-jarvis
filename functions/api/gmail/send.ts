/**
 * POST /api/gmail/send
 * Authorization: Bearer <access_token>
 * Body: { to, subject, body }
 *
 * RFC 2822 이메일을 생성해 Gmail API로 발송.
 */

type Env = Record<string, string>;

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

interface SendRequest {
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

  // Uint8Array → base64url
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

  let body: SendRequest;
  try {
    body = (await request.json()) as SendRequest;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  const raw = buildRFC2822(body.to, body.subject, body.body);

  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ raw })
  });

  if (!res.ok) {
    const detail = await res.text();
    return new Response(
      JSON.stringify({ error: `Gmail send failed: ${res.status}`, detail: detail.slice(0, 200) }),
      { status: 502, headers: jsonHeaders }
    );
  }

  return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
}
