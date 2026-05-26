type Env = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_DRAFT_MODEL?: string;
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

type AnthropicMessageResponse = {
  content: Array<{ type: string; text?: string }>;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};

const defaultModel = "claude-3-5-haiku-latest";

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

function extractText(data: AnthropicMessageResponse) {
  return data.content
    .filter(item => item.type === "text" && item.text)
    .map(item => item.text)
    .join("\n")
    .trim();
}

async function callClaude(apiKey: string, model: string, input: DraftReplyRequest) {
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
        "너는 승인형 개인 운영비서다. 메일을 실제 발송하지 말고, 사용자가 검토할 수 있는 한국어 답장 초안과 근거를 JSON으로만 작성한다.",
      messages: [
        {
          role: "user",
          content: [
            "다음 메일에 대한 답장 초안을 작성해줘.",
            "반드시 아래 JSON 형식만 반환해.",
            '{"draft":"답장 초안","evidence":["근거 1","근거 2"]}',
            JSON.stringify(input.mail)
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
    draft?: string;
    evidence?: string[];
  };

  return {
    draft: parsed.draft ?? "",
    evidence: parsed.evidence ?? [],
    source: "claude"
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

  if (!env.ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify(fallbackDraft(input)), { headers: jsonHeaders });
  }

  try {
    const model = env.ANTHROPIC_DRAFT_MODEL ?? env.ANTHROPIC_MODEL ?? defaultModel;
    const result = await callClaude(env.ANTHROPIC_API_KEY, model, input);
    return new Response(JSON.stringify(result), { headers: jsonHeaders });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify(fallbackDraft(input)), { headers: jsonHeaders });
  }
}
