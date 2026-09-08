export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = unknown>(): Promise<{ results: T[] }>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(query: string): D1Statement;
}

export type Env = { DB: D1Database; GOOGLE_CLIENT_SECRET?: string };

export const IDLE_LIMIT_MS = 12 * 60 * 60 * 1000;

// DB 사용 시각과 마지막 사용자 조작 시각 중 하나라도 유휴 상한을 넘으면 만료
export function isIdleExpired(lastUsedAt: string, lastActiveAt?: unknown): boolean {
  const now = Date.now();
  const lastUsed = Date.parse(lastUsedAt);
  const lastActive = typeof lastActiveAt === "string" ? Date.parse(lastActiveAt) : NaN;
  return Number.isNaN(lastUsed)
    || now - lastUsed > IDLE_LIMIT_MS
    || (!Number.isNaN(lastActive) && now - lastActive > IDLE_LIMIT_MS);
}

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

// JSON 응답 생성
export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

// Beacon의 text/plain 본문도 JSON으로 읽어 세션 ID 추출
export async function readSessionId(request: Request): Promise<string | null> {
  try {
    const body = JSON.parse(await request.text());
    return typeof body?.session_id === "string" && body.session_id ? body.session_id : null;
  } catch {
    return null;
  }
}

// 서버 세션 삭제
export async function deleteSession(env: Env, id: string): Promise<void> {
  await env.DB.prepare("DELETE FROM auth_sessions WHERE id = ?").bind(id).run();
}

// 유휴 상한을 넘긴 고아 세션을 구글 폐기 후 삭제하고 삭제 건수를 돌려준다
//
// 탭을 닫으면 브라우저의 session_id는 사라지지만 D1 행은 남는다. 그 행에는 refresh
// 요청이 영영 오지 않으므로 refresh 시점의 유휴 판정이 닿지 않는다 — 아무도 치우지
// 않으면 탭을 닫을 때마다 refresh token이 하나씩 영구히 쌓인다.
// 로그인이 사람이 실제로 오는 유일한 시점이라 청소 시점으로 쓴다(크론 불필요).
export async function purgeIdleSessions(env: Env): Promise<number> {
  const cutoff = new Date(Date.now() - IDLE_LIMIT_MS).toISOString();
  // toISOString은 자리수가 고정된 UTC라 사전순 비교가 시간순과 일치한다
  const { results } = await env.DB
    .prepare("SELECT id, refresh_token FROM auth_sessions WHERE last_used_at < ?")
    .bind(cutoff)
    .all<{ id: string; refresh_token: string }>();

  for (const row of results) {
    await revokeAtGoogle(row.refresh_token);
    await deleteSession(env, row.id);
  }
  return results.length;
}

// 구글 자격증명 폐기는 로컬 세션 삭제를 막지 않도록 best-effort로 수행
export async function revokeAtGoogle(refreshToken: string): Promise<void> {
  try {
    await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken })
    });
  } catch {
    // 구글 요청 실패와 무관하게 호출부의 세션 삭제를 계속 진행
  }
}
