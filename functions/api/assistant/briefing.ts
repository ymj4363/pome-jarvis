/**
 * POST /api/assistant/briefing
 * Body: { mails, events, userName? }
 *
 * 실제 Gmail·캘린더 데이터로 오늘의 AI 브리핑 생성.
 * ANTHROPIC_API_KEY 없으면 { fallback: true } 반환.
 */

type Env = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const defaultModel = "claude-haiku-4-5-20251001";

interface MailInput  { subject: string; sender: string; label: string; summary: string; }
interface EventInput { title: string; time: string; location?: string; }

interface BriefingRequest {
  mails:     MailInput[];
  events:    EventInput[];
  userName?: string;
}

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
}

function extractJson<T>(text: string): T {
  const cleaned = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const s = cleaned.indexOf("{");
  const e = cleaned.lastIndexOf("}");
  if (s === -1 || e <= s) throw new Error("No JSON");
  return JSON.parse(cleaned.slice(s, e + 1)) as T;
}

export async function onRequestPost({
  request,
  env
}: {
  request: Request;
  env: Env;
}) {
  if (!env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ fallback: true }),
      { status: 200, headers: jsonHeaders }
    );
  }

  let body: BriefingRequest;
  try {
    body = (await request.json()) as BriefingRequest;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  const { mails = [], events = [], userName = "사용자" } = body;

  if (mails.length === 0 && events.length === 0) {
    return new Response(
      JSON.stringify({ fallback: true }),
      { status: 200, headers: jsonHeaders }
    );
  }

  const mailText = mails.length === 0
    ? "메일 없음"
    : mails.map((m, i) =>
        `[${i + 1}] (${m.label}) ${m.subject} — ${m.sender}\n  요약: ${m.summary}`
      ).join("\n");

  const eventText = events.length === 0
    ? "오늘 일정 없음"
    : events.map(e => `• ${e.time} ${e.title}${e.location ? ` @ ${e.location}` : ""}`).join("\n");

  const prompt = [
    `${userName}님의 오늘 현황입니다.`,
    "",
    "=== 받은 메일 ===",
    mailText,
    "",
    "=== 오늘 일정 ===",
    eventText,
    "",
    "위 정보를 바탕으로 아래 JSON 형식으로 오늘의 간결한 브리핑을 작성하세요.",
    '{ "summary": "2~3문장 오늘 상황 요약", "highlights": ["핵심 포인트 최대 3개"], "actions": ["지금 해야 할 액션 최대 3개"] }',
    "모든 텍스트는 한국어로. JSON만 출력하세요."
  ].join("\n");

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
      max_tokens: 1000,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!claudeRes.ok) {
    return new Response(
      JSON.stringify({ fallback: true }),
      { status: 200, headers: jsonHeaders }
    );
  }

  const claudeData = (await claudeRes.json()) as AnthropicResponse;
  const text = claudeData.content
    .filter(c => c.type === "text" && c.text)
    .map(c => c.text)
    .join("");

  try {
    const parsed = extractJson<{
      summary: string;
      highlights: string[];
      actions: string[];
    }>(text);

    return new Response(
      JSON.stringify({ ok: true, ...parsed }),
      { headers: jsonHeaders }
    );
  } catch {
    // JSON 파싱 실패 — raw text로 fallback
    return new Response(
      JSON.stringify({
        ok: true,
        summary: text.slice(0, 300),
        highlights: [],
        actions: []
      }),
      { headers: jsonHeaders }
    );
  }
}
