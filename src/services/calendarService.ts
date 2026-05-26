import type { CalendarEvent } from "../types";

/**
 * Cloudflare Function /api/calendar/events 를 통해 오늘 일정 조회.
 * 함수 내부에서 Google Calendar API 호출.
 */
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
