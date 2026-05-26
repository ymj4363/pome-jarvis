type Env = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  ANTHROPIC_DRAFT_MODEL?: string;
  ANTHROPIC_MEETING_MODEL?: string;
};

const defaultModel = "claude-haiku-4-5-20251001";

export async function onRequestGet({ env }: { env: Env }) {
  const hasAnthropicKey = Boolean(env.ANTHROPIC_API_KEY?.trim());
  const model = env.ANTHROPIC_MODEL ?? defaultModel;
  const draftModel = env.ANTHROPIC_DRAFT_MODEL ?? model;
  const meetingModel = env.ANTHROPIC_MEETING_MODEL ?? model;

  return new Response(
    JSON.stringify({
      ok: true,
      hasAnthropicKey,
      model,
      draftModel,
      meetingModel
    }),
    {
      headers: {
        "content-type": "application/json; charset=utf-8"
      }
    }
  );
}
