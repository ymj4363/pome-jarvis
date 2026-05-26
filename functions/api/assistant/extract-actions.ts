type Env = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
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

const defaultModel = "claude-3-5-haiku-latest";

function fallbackExtract(input: ExtractActionsRequest) {
  const sentences = input.meetingText
    .split(/[.!?。]\s*|\n/)
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
      system:
        "너는 회의록에서 실행 가능한 액션 아이템만 추출하는 개인 운영비서다. 한국어 JSON으로 작업 제목, 담당자, 기한, 근거를 작성한다.",
      messages: [
        {
          role: "user",
          content: [
            "다음 회의록에서 실행 가능한 액션 아이템만 추출해줘.",
            "반드시 아래 JSON 형식만 반환해.",
            '{"tasks":[{"title":"작업 제목","owner":"담당자","due":"기한"}],"evidence":["근거 1","근거 2"]}',
            input.meetingText
          ].join("\n\n")
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`Claude request failed: ${response.status}`);
  }

  const data = await response.json() as AnthropicMessageResponse;
  const parsed = JSON.parse(extractText(data)) as {
    tasks?: ExtractedTask[];
    evidence?: string[];
  };

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
    const result = await callClaude(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL ?? defaultModel, input);
    return new Response(JSON.stringify(result), { headers: jsonHeaders });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify(fallbackExtract(input)), { headers: jsonHeaders });
  }
}

