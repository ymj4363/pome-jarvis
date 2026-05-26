/**
 * DELETE /api/calendar/delete
 * Authorization: Bearer <access_token>
 * Body: { eventId: string }
 *
 * Google Calendar에서 해당 이벤트를 삭제(취소)합니다.
 */

type Env = Record<string, string>;

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export async function onRequestDelete({ request }: { request: Request; env: Env }) {
  return handleRequest(request);
}

export async function onRequestPost({ request }: { request: Request; env: Env }) {
  return handleRequest(request);
}

async function handleRequest(request: Request) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders
    });
  }
  const accessToken = auth.slice(7);

  let body: { eventId?: string };
  try {
    body = (await request.json()) as { eventId?: string };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  if (!body.eventId) {
    return new Response(JSON.stringify({ error: "eventId 필드 필요" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(body.eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` }
    }
  );

  // 204 No Content = 성공
  if (res.status === 204 || res.ok) {
    return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders });
  }

  const detail = await res.text();
  return new Response(
    JSON.stringify({ error: `Calendar delete failed: ${res.status}`, detail: detail.slice(0, 200) }),
    { status: 502, headers: jsonHeaders }
  );
}
