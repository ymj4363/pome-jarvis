/**
 * POST /api/calendar/create
 * Authorization: Bearer <access_token>
 * Body: { title, startDateTime, endDateTime, description?, location?, timeZone? }
 *
 * Google Calendar API로 일정을 생성.
 */

type Env = Record<string, string>;

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

interface CreateEventRequest {
  title: string;
  startDateTime: string; // ISO 8601
  endDateTime: string;   // ISO 8601
  description?: string;
  location?: string;
  timeZone?: string;
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

  let body: CreateEventRequest;
  try {
    body = (await request.json()) as CreateEventRequest;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  if (!body.title || !body.startDateTime || !body.endDateTime) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: title, startDateTime, endDateTime" }),
      { status: 400, headers: jsonHeaders }
    );
  }

  const timeZone = body.timeZone ?? "Asia/Seoul";

  const event = {
    summary:     body.title,
    description: body.description,
    location:    body.location,
    start: { dateTime: body.startDateTime, timeZone },
    end:   { dateTime: body.endDateTime,   timeZone }
  };

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${accessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(event)
    }
  );

  if (!res.ok) {
    const detail = await res.text();
    return new Response(
      JSON.stringify({ error: `Calendar create failed: ${res.status}`, detail: detail.slice(0, 200) }),
      { status: 502, headers: jsonHeaders }
    );
  }

  const created = (await res.json()) as { id: string; htmlLink: string };
  return new Response(
    JSON.stringify({ ok: true, id: created.id, link: created.htmlLink }),
    { headers: jsonHeaders }
  );
}
