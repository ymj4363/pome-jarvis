/**
 * GET /api/gmail/body/:id
 * Authorization: Bearer <access_token>
 *
 * Gmail 메시지 전체 본문 조회 (format=full → text/plain 추출).
 */

type Env = Record<string, string>;

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const GMAIL_BASE  = "https://gmail.googleapis.com/gmail/v1/users/me";

interface GmailPart {
  mimeType: string;
  body: { data?: string; size?: number };
  parts?: GmailPart[];
}

interface GmailFullMessage {
  id: string;
  snippet: string;
  payload: GmailPart;
}

function base64Decode(str: string): string {
  // base64url → base64 → UTF-8 string
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded  = base64.padEnd(base64.length + (4 - (base64.length % 4)) % 4, "=");
  try {
    const binary = atob(padded);
    const bytes  = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return atob(padded);
  }
}

function extractText(part: GmailPart): string {
  if (part.mimeType === "text/plain" && part.body.data) {
    return base64Decode(part.body.data);
  }
  if (part.parts) {
    for (const p of part.parts) {
      const t = extractText(p);
      if (t) return t;
    }
  }
  return "";
}

export async function onRequestGet({
  request,
  params
}: {
  request: Request;
  env: Env;
  params: Record<string, string>;
}) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: jsonHeaders
    });
  }
  const accessToken = auth.slice(7);
  const id = params.id ?? "";

  if (!id) {
    return new Response(JSON.stringify({ error: "Missing id" }), {
      status: 400, headers: jsonHeaders
    });
  }

  const res = await fetch(
    `${GMAIL_BASE}/messages/${encodeURIComponent(id)}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    const detail = await res.text();
    return new Response(
      JSON.stringify({ error: `Gmail API error: ${res.status}`, detail: detail.slice(0, 200) }),
      { status: 502, headers: jsonHeaders }
    );
  }

  const msg = (await res.json()) as GmailFullMessage;
  const body = extractText(msg.payload) || msg.snippet || "";

  return new Response(JSON.stringify({ body }), { headers: jsonHeaders });
}
