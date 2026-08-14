export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  all<T = unknown>(): Promise<{ results: T[] }>;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(query: string): D1Statement;
}

export type Env = { DB: D1Database; OWNER_EMAIL?: string; DEV_ALLOW_ALL?: string };

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return body && typeof body === "object" ? body as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export async function requireOwner(request: Request, env: Env): Promise<Response | null> {
  if (env.DEV_ALLOW_ALL === "1") return null;
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

  try {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: authorization }
    });
    if (!response.ok) return json({ error: "Unauthorized" }, 401);
    const profile = await response.json() as { email?: string };
    if (!env.OWNER_EMAIL || profile.email !== env.OWNER_EMAIL) {
      return json({ error: "Forbidden" }, 403);
    }
    return null;
  } catch {
    return json({ error: "Unauthorized" }, 401);
  }
}
