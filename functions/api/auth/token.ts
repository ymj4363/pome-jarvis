/**
 * POST /api/auth/token
 *
 * 브라우저에서 받은 authorization code를 server-side에서 토큰으로 교환.
 * client_secret은 환경변수에만 보관 — 브라우저에 노출되지 않음.
 *
 * Required env var: GOOGLE_CLIENT_SECRET
 */

type Env = {
  GOOGLE_CLIENT_SECRET?: string;
};

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

  const data = await tokenRes.json();

  return new Response(JSON.stringify(data), {
    status: tokenRes.status,
    headers: jsonHeaders
  });
}
