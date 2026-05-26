type Env = {
  OPENAI_API_KEY?: string;
};

type ExtractActionsRequest = {
  meetingText: string;
};

type ExtractedTask = {
  title: string;
  owner: string;
  due: string;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};

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

async function callOpenAI(apiKey: string, input: ExtractActionsRequest) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: [
        {
          role: "system",
          content:
            "너는 회의록에서 실행 가능한 액션 아이템만 추출하는 개인 운영비서다. 한국어 JSON으로 작업 제목, 담당자, 기한, 근거를 작성한다."
        },
        {
          role: "user",
          content: input.meetingText
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "meeting_actions",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              tasks: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    title: { type: "string" },
                    owner: { type: "string" },
                    due: { type: "string" }
                  },
                  required: ["title", "owner", "due"]
                }
              },
              evidence: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["tasks", "evidence"]
          },
          strict: true
        }
      }
    })
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed: ${response.status}`);
  }

  const data = await response.json() as { output_text?: string };
  const parsed = JSON.parse(data.output_text ?? "{}") as {
    tasks?: ExtractedTask[];
    evidence?: string[];
  };

  return {
    tasks: parsed.tasks ?? [],
    evidence: parsed.evidence ?? [],
    source: "openai"
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

  if (!env.OPENAI_API_KEY) {
    return new Response(JSON.stringify(fallbackExtract(input)), { headers: jsonHeaders });
  }

  try {
    const result = await callOpenAI(env.OPENAI_API_KEY, input);
    return new Response(JSON.stringify(result), { headers: jsonHeaders });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify(fallbackExtract(input)), { headers: jsonHeaders });
  }
}

