/**
 * POST /api/assistant/extract-from-file
 * Body: { data: string (base64), mimeType: string }
 *
 * 이미지(JPG/PNG/WebP/GIF) 또는 PDF 파일에서 회의록 텍스트를 추출.
 * Claude Vision / Document API 사용.
 */

type Env = {
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
};

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };
const defaultModel = "claude-sonnet-4-6"; // 파일 처리는 Sonnet 사용

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
}

type SupportedImageType = "image/jpeg" | "image/png" | "image/gif" | "image/webp";

const SUPPORTED_IMAGES: string[] = ["image/jpeg", "image/png", "image/gif", "image/webp"];

export async function onRequestPost({
  request,
  env
}: {
  request: Request;
  env: Env;
}) {
  if (!env.ANTHROPIC_API_KEY) {
    return new Response(
      JSON.stringify({ error: "ANTHROPIC_API_KEY가 설정되지 않았습니다." }),
      { status: 500, headers: jsonHeaders }
    );
  }

  let body: { data?: string; mimeType?: string };
  try {
    body = (await request.json()) as { data?: string; mimeType?: string };
  } catch {
    return new Response(JSON.stringify({ error: "Invalid body" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  const { data, mimeType } = body;

  if (!data || !mimeType) {
    return new Response(JSON.stringify({ error: "data, mimeType 필드 필요" }), {
      status: 400,
      headers: jsonHeaders
    });
  }

  const isImage = SUPPORTED_IMAGES.includes(mimeType);
  const isPDF   = mimeType === "application/pdf";

  if (!isImage && !isPDF) {
    return new Response(
      JSON.stringify({ error: `지원하지 않는 파일 형식: ${mimeType}` }),
      { status: 400, headers: jsonHeaders }
    );
  }

  const model = env.ANTHROPIC_MODEL ?? defaultModel;

  // Claude 메시지 구성
  const fileContent = isImage
    ? {
        type: "image",
        source: { type: "base64", media_type: mimeType as SupportedImageType, data }
      }
    : {
        type: "document",
        source: { type: "base64", media_type: "application/pdf" as const, data }
      };

  const prompt = isImage
    ? "이 이미지는 회의록 또는 화이트보드 사진입니다. 이미지에 담긴 텍스트와 내용을 빠짐없이 한국어로 전사해 주세요. 원문 내용만 반환하세요."
    : "이 PDF는 회의록 문서입니다. 문서 내용을 한국어로 추출해 주세요. 원문 내용만 반환하세요.";

  const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key":         env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type":      "application/json"
    },
    body: JSON.stringify({
      model,
      max_tokens: 3000,
      messages: [
        {
          role: "user",
          content: [
            fileContent,
            { type: "text", text: prompt }
          ]
        }
      ]
    })
  });

  if (!claudeRes.ok) {
    const detail = await claudeRes.text();
    return new Response(
      JSON.stringify({ error: `Claude API 오류: ${claudeRes.status}`, detail: detail.slice(0, 200) }),
      { status: 502, headers: jsonHeaders }
    );
  }

  const claudeData = (await claudeRes.json()) as AnthropicResponse;
  const meetingText = claudeData.content
    .filter(c => c.type === "text" && c.text)
    .map(c => c.text)
    .join("");

  return new Response(
    JSON.stringify({ meetingText }),
    { headers: jsonHeaders }
  );
}
