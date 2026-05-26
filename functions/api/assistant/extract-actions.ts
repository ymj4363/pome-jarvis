type Env = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_MEETING_MODEL?: string;
};

type ExtractActionsRequest = {
  meetingText: string;
};

type ExtractedTask = {
  title: string;
  owner: string;
  due: string;
};

type AnthropicMessageResponse = {
  content: Array<{ type: string; text?: string }>;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};

const defaultModel = "claude-haiku-4-5-20251001";

function fallbackExtract(input: ExtractActionsRequest) {
  const sentences = input.meetingText
    .split(/[.!?\n]/)
    .map(item => item.trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    tasks: sentences.map(sentence => ({
      title: sentence,
      owner: sentence.includes("김대리") ? "김대리" : "나",
      due: sentence.includes("금요일")
        ? "금요일"
        : sentence.includes("내일")
          ? "내일"
          : sentence.includes("오늘")
            ? "오늘"
            : sentence.includes("다음 주")
              ? "다음 주"
              : "미정"
    })),
    evidence: sentences.map(sentence => `회의록 문장: ${sentence}`),
    source: "fallback"
  };
}

async function parseJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function extractText(data: AnthropicMessageResponse) {
  return data.content
    .filter(item => item.type === "text" && item.text)
    .map(item => item.text)
    .join("\n")
    .trim();
}

function parseClaudeJson<T>(text: string): T {
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");

  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Claude response did not contain a JSON object");
  }

  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

async function callClaude(apiKey: string, model: string, input: ExtractActionsRequest) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 1200,
      temperature: 0.2,
      system:
        "You are a Korean executive assistant. Extract only actionable tasks from meeting notes. Return only valid JSON with keys tasks and evidence.",
      messages: [
        {
          role: "user",
          content: [
            "Extract action items from these meeting notes.",
            "Return only this JSON shape:",
            '{"tasks":[{"title":"task title","owner":"owner","due":"due date"}],"evidence":["reason 1","reason 2"]}',
            input.meetingText
          ].join("\n\n")
        }
      ]
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Claude request failed: ${response.status} ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as AnthropicMessageResponse;
  const parsed = parseClaudeJson<{
    tasks?: ExtractedTask[];
    evidence?: string[];
  }>(extractText(data));

  return {
    tasks: parsed.tasks ?? [],
    evidence: parsed.evidence ?? [],
    source: "claude"
  };
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const input = await parseJson<ExtractActionsRequest>(request);
  if (!input?.meetingText) {
    return new Response(JSON.stringify({ error: "meetingText is required" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  if (!env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify(fallbackExtract(input)), { headers: jsonHeaders });
  }

  try {
    const model = env.ANTHROPIC_MEETING_MODEL ?? env.ANTHROPIC_MODEL ?? defaultModel;
    const result = await callClaude(env.ANTHROPIC_API_KEY, model, input);
    return new Response(JSON.stringify(result), { headers: jsonHeaders });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify(fallbackExtract(input)), { headers: jsonHeaders });
  }
}
