/**
 * GET /api/gmail/messages
 *
 * Authorization: Bearer <google_access_token> 헤더 필요.
 * Gmail 받은편지함 최근 10건을 가져와 Claude로 분류·요약 후 반환.
 * ANTHROPIC_API_KEY 없으면 snippet 기반 기본값 반환.
 */

type Env = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
};

interface GmailListResponse {
  messages?: Array<{ id: string }>;
  nextPageToken?: string;
}

interface GmailMessage {
  id: string;
  snippet: string;
  internalDate: string;
  payload: {
    headers: Array<{ name: string; value: string }>;
  };
}

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
}

type MailLabel = "urgent" | "reply_needed" | "reference";

interface MailResult {
  id: string;
  sender: string;
  subject: string;
  receivedAt: string;
  label: MailLabel;
  summary: string;
  body: string;
}

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const defaultModel = "claude-haiku-4-5-20251001";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";

/* ── 헬퍼 ──────────────────────────────────────────────────────── */

function getHeader(msg: GmailMessage, name: string): string {
  const lower = name.toLowerCase();
  return msg.payload.headers.find(h => h.name.toLowerCase() === lower)?.value ?? "";
}

function formatDate(internalDate: string): string {
  const date = new Date(parseInt(internalDate, 10));
  const now   = new Date();
  const diffH = Math.floor((now.getTime() - date.getTime()) / 3_600_000);
  const diffD = Math.floor(diffH / 24);

  const hhmm = date.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Seoul" });
  if (diffH < 1) return "방금 전";
  if (diffH < 24) return `오늘 ${hhmm}`;
  if (diffD === 1) return `어제 ${hhmm}`;
  return `${diffD}일 전`;
}

function extractJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const s = cleaned.indexOf("{");
  const e = cleaned.lastIndexOf("}");
  if (s === -1 || e <= s) throw new Error("No JSON object found");
  return JSON.parse(cleaned.slice(s, e + 1)) as T;
}

function gmailFetch(path: string, accessToken: string): Promise<Response> {
  return fetch(`${GMAIL_BASE}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
}

/* ── Cloudflare Function ────────────────────────────────────────── */

export async function onRequestGet({
  request,
  env
}: {
  request: Request;
  env: Env;
}) {
  const auth = request.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: jsonHeaders
    });
  }
  const accessToken = auth.slice(7);

  // pageToken (더 보기 페이지네이션)
  const reqUrl    = new URL(request.url);
  const pageToken = reqUrl.searchParams.get("pageToken");
  // 안 읽은 받은편지함 메일 최신 10건 (Gmail 최신순 정렬)
  const q = encodeURIComponent("in:inbox is:unread");
  const listPath  = `/messages?maxResults=10&q=${q}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;

  // 1. 받은편지함 목록 조회 (최근 10건)
  const listRes = await gmailFetch(listPath, accessToken);

  if (!listRes.ok) {
    const body = await listRes.text();
    return new Response(
      JSON.stringify({ error: `Gmail API error: ${listRes.status}`, detail: body.slice(0, 200) }),
      { status: 502, headers: jsonHeaders }
    );
  }

  const listData = (await listRes.json()) as GmailListResponse;
  const { messages = [], nextPageToken } = listData;

  if (messages.length === 0) {
    return new Response(JSON.stringify({ mails: [], nextPageToken: undefined }), { headers: jsonHeaders });
  }

  // 2. 메일 상세 병렬 조회 (메타데이터 + snippet)
  const details = await Promise.all(
    messages.map(m =>
      gmailFetch(
        `/messages/${m.id}?format=metadata` +
          `&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        accessToken
      ).then(r => r.json() as Promise<GmailMessage>)
    )
  );

  // 3. Claude 분류 (API key 없으면 기본값)
  let classifications: Array<{
    index: number;
    label: MailLabel;
    summary: string;
  }> = [];

  if (env.ANTHROPIC_API_KEY) {
    const mailList = details.map((m, i) => ({
      index:   i,
      from:    getHeader(m, "From"),
      subject: getHeader(m, "Subject"),
      snippet: m.snippet?.slice(0, 200) ?? ""
    }));

    const model = env.ANTHROPIC_MODEL ?? defaultModel;

    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key":         env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type":      "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        temperature: 0.1,
        system:
          "You are a Korean executive assistant. Classify emails and summarize in Korean. Return only valid JSON, no markdown fences.",
        messages: [
          {
            role: "user",
            content: [
              "Classify each email. Labels: urgent (immediate action needed), reply_needed (reply required), reference (informational).",
              'Return JSON: {"results":[{"index":0,"label":"urgent","summary":"한국어 1~2문장 요약"}]}',
              "",
              "Emails:",
              JSON.stringify(mailList)
            ].join("\n")
          }
        ]
      })
    });

    if (claudeRes.ok) {
      const claudeData = (await claudeRes.json()) as AnthropicResponse;
      const text = claudeData.content
        .filter(c => c.type === "text" && c.text)
        .map(c => c.text)
        .join("");

      try {
        const parsed = extractJson<{ results: typeof classifications }>(text);
        classifications = parsed.results ?? [];
      } catch {
        // Claude 파싱 실패 시 기본값으로 진행
      }
    }
  }

  // 4. 최종 Mail 객체 조립
  const mails: MailResult[] = details.map((msg, i) => {
    const cls = classifications.find(c => c.index === i);
    return {
      id:         msg.id,
      sender:     getHeader(msg, "From"),
      subject:    getHeader(msg, "Subject"),
      receivedAt: formatDate(msg.internalDate),
      label:      cls?.label ?? "reference",
      summary:    cls?.summary ?? (msg.snippet?.slice(0, 120) ?? ""),
      body:       msg.snippet ?? ""
    };
  });

  return new Response(JSON.stringify({ mails, nextPageToken }), { headers: jsonHeaders });
}
