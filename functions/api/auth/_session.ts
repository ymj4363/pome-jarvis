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
