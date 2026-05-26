type Env = {
  OPENAI_API_KEY?: string;
};

type DraftReplyRequest = {
  mail: {
    sender: string;
    subject: string;
    label: string;
    summary: string;
    body: string;
  };
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};

function fallbackDraft(input: DraftReplyRequest) {
  const { mail } = input;
  return {
    draft: [
      `${mail.sender} 담당자님, 안녕하세요.`,
      "",
      `보내주신 "${mail.subject}" 메일 확인했습니다.`,
      mail.label === "urgent"
        ? "우선 현재 상황을 확인하고 있으며, 확인되는 원인과 조치 계획을 정리해서 공유드리겠습니다."
        : "요청하신 내용을 검토한 뒤 주요 의견과 필요한 수정 사항을 정리해 회신드리겠습니다.",
      "",
      "감사합니다."
    ].join("\n"),
    evidence: [
      `원문 제목: ${mail.subject}`,
      `요약 근거: ${mail.summary}`,
      `분류: ${mail.label}`
    ],
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

async function callOpenAI(apiKey: string, input: DraftReplyRequest) {
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
            "너는 승인형 개인 운영비서다. 메일을 실제 발송하지 말고, 사용자가 검토할 수 있는 한국어 답장 초안과 근거를 JSON으로 작성한다."
        },
        {
          role: "user",
          content: JSON.stringify(input.mail)
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "draft_reply",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              draft: { type: "string" },
              evidence: {
                type: "array",
                items: { type: "string" }
              }
            },
            required: ["draft", "evidence"]
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
    draft?: string;
    evidence?: string[];
  };

  return {
    draft: parsed.draft ?? "",
    evidence: parsed.evidence ?? [],
    source: "openai"
  };
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const input = await parseJson<DraftReplyRequest>(request);
  if (!input?.mail) {
    return new Response(JSON.stringify({ error: "mail is required" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  if (!env.OPENAI_API_KEY) {
    return new Response(JSON.stringify(fallbackDraft(input)), { headers: jsonHeaders });
  }

  try {
    const result = await callOpenAI(env.OPENAI_API_KEY, input);
    return new Response(JSON.stringify(result), { headers: jsonHeaders });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify(fallbackDraft(input)), { headers: jsonHeaders });
  }
}

