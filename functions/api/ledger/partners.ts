import { json, readBody, requireOwner, type Env } from "./_auth";

const PARTNER_KINDS = ["customer", "intermediary", "vendor"];

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const rejected = await requireOwner(request, env);
  if (rejected) return rejected;
  const body = await readBody(request);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const kind = typeof body?.kind === "string" ? body.kind : "customer";
  const memo = typeof body?.memo === "string" ? body.memo : "";
  if (!name) return json({ error: "거래처 이름을 입력해 주세요." }, 400);
  if (!PARTNER_KINDS.includes(kind)) return json({ error: "올바르지 않은 거래처 구분입니다." }, 400);
  const partner = { id: crypto.randomUUID(), name, kind, memo, created_at: new Date().toISOString() };
  await env.DB.prepare("INSERT INTO partners (id, name, kind, memo, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(partner.id, partner.name, partner.kind, partner.memo, partner.created_at).run();
  return json(partner, 201);
}
