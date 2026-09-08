/**
 * POST /api/auth/token
 *
 * 브라우저에서 받은 authorization code를 server-side에서 토큰으로 교환.
 * client_secret은 환경변수에만 보관 — 브라우저에 노출되지 않음.
 *
 * Required env var: GOOGLE_CLIENT_SECRET
 */

import { json, purgeIdleSessions, type Env } from "./_session";

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

interface TokenRequest {
  code: string;
  code_verifier: string;
  client_id: string;
  redirect_uri: string;
}

export async function onRequestPost({
  request,
  env
}: {
  request: Request;
  env: Env;
}) {
  if (!env.GOOGLE_CLIENT_SECRET) {
    return new Response(
      JSON.stringify({ error: "GOOGLE_CLIENT_SECRET is not configured" }),
      { status: 500, headers: jsonHeaders }
    );
  }

  let body: TokenRequest;
  try {
    body = (await request.json()) as TokenRequest;
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid request body" }),
      { status: 400, headers: jsonHeaders }
    );
  }

  if (!body.code || !body.code_verifier || !body.client_id || !body.redirect_uri) {
    return new Response(
      JSON.stringify({ error: "Missing required fields" }),
      { status: 400, headers: jsonHeaders }
    );
  }

  // 고아 세션 청소 — 토큰 교환보다 **앞**에 둔다.
  // 뒤에 두면 교환이 실패할 때 청소도 건너뛰어, 로그인이 계속 실패하는 동안 오래된
  // 자격증명이 그대로 남는다. 청소 실패가 로그인을 막아서는 안 되므로 삼킨다.
  try {
    await purgeIdleSessions(env);
  } catch {
    // 청소는 위생 작업이다 — 실패해도 로그인은 진행한다
  }

  // Google OAuth 토큰 교환 (server-side — client_secret 포함)
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id:     body.client_id,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      code:          body.code,
      code_verifier: body.code_verifier,
      grant_type:    "authorization_code",
      redirect_uri:  body.redirect_uri
    })
  });

  const data = await tokenRes.json() as {
    access_token: string; expires_in: number; refresh_token?: string;
    error?: string; error_description?: string; error_uri?: string;
  };
  if (!tokenRes.ok) {
    return json({ error: data.error, error_description: data.error_description, error_uri: data.error_uri }, tokenRes.status);
  }

  let sessionId: string | null = null;
  if (data.refresh_token) {
    sessionId = crypto.randomUUID();
    let email = "";
    try {
      const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${data.access_token}` }
      });
      if (userRes.ok) {
        const user = await userRes.json() as { email?: string };
        if (typeof user.email === "string") email = user.email;
      }
    } catch {
      // 이메일은 운영 식별용이므로 조회 실패 시에도 세션 저장
    }
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO auth_sessions (id, refresh_token, email, created_at, last_used_at) VALUES (?, ?, ?, ?, ?)")
      .bind(sessionId, data.refresh_token, email, now, now).run();
  }

  return json({ access_token: data.access_token, expires_in: data.expires_in, session_id: sessionId }, tokenRes.status);
}
