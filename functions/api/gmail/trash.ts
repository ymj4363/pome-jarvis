/**
 * POST /api/gmail/trash
 * Authorization: Bearer <access_token>
 * Body: { messageId: string }
 *
 * 메시지를 Gmail 휴지통으로 이동 (영구 삭제 아님 — 30일 보관).
 */

type Env = Record<string, string>;

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export async function onRequestPost({ request }: { request: Request; env: Env }) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders
    });
  }
  const accessToken = auth.slice(7);

  let body: { messageId?: string };
  try {
    body = (await request.json()) as { messageId?: string };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  if (!body.messageId) {
    return new Response(JSON.stringify({ error: "Missing messageId" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(body.messageId)}/trash`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    return new Response(
      JSON.stringify({ error: `Gmail trash failed: ${res.status}`, detail: detail.slice(0, 200) }),
      { status: 502, headers: jsonHeaders }
    );
  }

  return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
}
