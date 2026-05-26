type Env = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_DRAFT_MODEL?: string;
  ANTHROPIC_MEETING_MODEL?: string;
};

const defaultModel = "claude-haiku-4-5-20251001";

async function pingClaude(apiKey: string, model: string) {
  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: 16,
        messages: [{ role: "user", content: "Reply with ok." }]
      })
    });

    if (response.ok) {
      return { claudeReachable: true, claudeStatus: response.status };
    }

    const body = await response.text();
    return {
      claudeReachable: false,
      claudeStatus: response.status,
      claudeError: body.slice(0, 300)
    };
  } catch (error) {
    return {
      claudeReachable: false,
      claudeError: error instanceof Error ? error.message : "Unknown Claude API error"
    };
  }
}

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  const hasAnthropicKey = Boolean(env.ANTHROPIC_API_KEY?.trim());
  const model = env.ANTHROPIC_MODEL ?? defaultModel;
  const draftModel = env.ANTHROPIC_DRAFT_MODEL ?? model;
  const meetingModel = env.ANTHROPIC_MEETING_MODEL ?? model;
  const shouldPing = new URL(request.url).searchParams.get("ping") === "1";
  const claudePing =
    shouldPing && env.ANTHROPIC_API_KEY
      ? await pingClaude(env.ANTHROPIC_API_KEY, model)
      : undefined;

  return new Response(
    JSON.stringify({
      ok: true,
      hasAnthropicKey,
      model,
      draftModel,
      meetingModel,
      ...(claudePing ?? {})
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8"
      }
    }
  );
}
