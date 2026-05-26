import type { CalendarEvent, CalendarEventData } from "../types";

/**
 * Cloudflare Function /api/calendar/* 를 통해 Google Calendar 연동.
 */

/* ── 오늘 일정 조회 ──────────────────────────────────────────────── */

export async function fetchCalendarEvents(accessToken: string): Promise<CalendarEvent[]> {
  const response = await fetch("/api/calendar/events", {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new Error(`Calendar fetch failed (${response.status})`);
  }

  const data = await response.json() as { events: CalendarEvent[] };
  return data.events;
}

/* ── 일정 생성 ───────────────────────────────────────────────────── */

export async function createCalendarEvent(
  accessToken: string,
  data: CalendarEventData
): Promise<string> {
  const response = await fetch("/api/calendar/create", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(data)
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "unknown" })) as {
      error?: string;
      detail?: string;
    };
    throw new Error(body.error ?? `Calendar create failed: ${response.status}`);
  }

  const result = await response.json() as { ok: boolean; id: string; link: string };
  return result.id;
}

/* ── 일정 삭제 ───────────────────────────────────────────────────── */

export async function deleteCalendarEvent(
  accessToken: string,
  eventId: string
): Promise<void> {
  const response = await fetch("/api/calendar/delete", {
    method: "POST",
    headers: {
      Authorization:  `Bearer ${accessToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ eventId })
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "unknown" })) as { error?: string };
    throw new Error(body.error ?? `Calendar delete failed: ${response.status}`);
  }
}
