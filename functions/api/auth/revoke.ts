import { deleteSession, readSessionId, revokeAtGoogle, type Env } from "./_session";

// 세션 존재 여부와 폐기 결과에 관계없이 빈 응답 반환
export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  try {
    const id = await readSessionId(request);
    if (id) {
      try {
        const session = await env.DB.prepare("SELECT refresh_token FROM auth_sessions WHERE id = ?")
          .bind(id).first<{ refresh_token: string }>();
        if (session) await revokeAtGoogle(session.refresh_token);
      } finally {
        await deleteSession(env, id);
      }
    }
  } catch {
    // Beacon 호출에는 오류나 세션 존재 여부를 노출하지 않음
  }
  return new Response(null, { status: 204 });
}
