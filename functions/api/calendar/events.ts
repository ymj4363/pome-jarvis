/**
 * GET /api/calendar/events
 *
 * Authorization: Bearer <google_access_token> 헤더 필요.
 * Google Calendar primary 캘린더의 오늘 일정을 반환.
 */

type Env = Record<string, string>;

interface GoogleCalendarEvent {
  id: string;
  summary?: string;
  location?: string;
  status: string;
  start: { dateTime?: string; date?: string };
  end:   { dateTime?: string; date?: string };
}

interface CalendarListResponse {
  items: GoogleCalendarEvent[];
}

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

/* ── 헬퍼 ──────────────────────────────────────────────────────── */

function formatTime(event: GoogleCalendarEvent): string {
  const startStr = event.start.dateTime ?? event.start.date ?? "";
  const endStr   = event.end.dateTime   ?? event.end.date   ?? "";

  if (!event.start.dateTime) return "종일";

  const fmt = (s: string) =>
    new Date(s).toLocaleTimeString("ko-KR", {
      hour:   "2-digit",
      minute: "2-digit",
      hour12: false
    });

  return `${fmt(startStr)} - ${fmt(endStr)}`;
}

/* ── Cloudflare Function ────────────────────────────────────────── */

export async function onRequestGet({ request }: { request: Request; env: Env }) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders
    });
  }
  const accessToken = auth.slice(7);

  // 오늘 날짜 범위 (KST 기준 자정 ~ 23:59:59)
  const now      = new Date();
  const timeMin  = new Date(now.getFullYear(), now.getMonth(), now.getDate(),  0,  0,  0).toISOString();
  const timeMax  = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

  const params = new URLSearchParams({
    timeMin,
    timeMax,
    singleEvents: "true",
    orderBy:      "startTime",
    maxResults:   "15"
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    const body = await res.text();
    return new Response(
      JSON.stringify({ error: `Calendar API error: ${res.status}`, detail: body.slice(0, 200) }),
      { status: 502, headers: jsonHeaders }
    );
  }

  const data = (await res.json()) as CalendarListResponse;

  const events = (data.items ?? [])
    .filter(e => e.status !== "cancelled")
    .map(e => ({
      id:       e.id,
      title:    e.summary ?? "(제목 없음)",
      time:     formatTime(e),
      location: e.location ?? ""
    }));

  return new Response(JSON.stringify({ events }), { headers: jsonHeaders });
}
