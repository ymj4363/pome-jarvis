import { deleteSession, isIdleExpired, json, readSessionId, revokeAtGoogle, type Env } from "./_session";

// 세션의 유휴 상한을 먼저 확인한 뒤 액세스 토큰 갱신
export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const bodyRequest = request.clone();
  const id = await readSessionId(request);
  if (!id) return json({ error: "Unauthorized", reason: "no_session" }, 401);

  const session = await env.DB.prepare("SELECT refresh_token, last_used_at FROM auth_sessions WHERE id = ?")
    .bind(id).first<{ refresh_token: string; last_used_at: string }>();
  if (!session) return json({ error: "Unauthorized", reason: "no_session" }, 401);

  const body = JSON.parse(await bodyRequest.text()) as { client_id?: unknown; last_active_at?: unknown };
  if (isIdleExpired(session.last_used_at, body.last_active_at)) {
    await deleteSession(env, id);
    await revokeAtGoogle(session.refresh_token);
    return json({ error: "Session expired", reason: "idle_expired" }, 401);
  }

  if (!env.GOOGLE_CLIENT_SECRET) {
    return json({ error: "GOOGLE_CLIENT_SECRET is not configured" }, 500);
  }

  let tokens: { access_token?: string; expires_in?: number };
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: typeof body.client_id === "string" ? body.client_id : "",
        client_secret: env.GOOGLE_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: session.refresh_token
      })
    });
    if (!response.ok) throw new Error("Google refresh failed");
    tokens = await response.json();
    if (!tokens.access_token || typeof tokens.expires_in !== "number" || tokens.expires_in <= 0) {
      throw new Error("Invalid token response");
    }
  } catch {
    await deleteSession(env, id);
    return json({ error: "Token refresh failed", reason: "refresh_failed" }, 401);
  }

  await env.DB.prepare("UPDATE auth_sessions SET last_used_at = ? WHERE id = ?")
    .bind(new Date().toISOString(), id).run();
  return json({ access_token: tokens.access_token, expires_in: tokens.expires_in });
}
