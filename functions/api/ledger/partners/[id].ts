import { json, readBody, requireOwner, type Env } from "../_auth";

const PARTNER_KINDS = ["customer", "intermediary", "vendor"];

export async function onRequestPut({ request, env, params }: { request: Request; env: Env; params: { id: string } }) {
  const rejected = await requireOwner(request, env);
  if (rejected) return rejected;
  const body = await readBody(request);
  const existing = await env.DB.prepare("SELECT * FROM partners WHERE id = ?").bind(params.id).first<Record<string, unknown>>();
  if (!existing) return json({ error: "거래처를 찾을 수 없습니다." }, 404);
  const name = typeof body?.name === "string" ? body.name.trim() : String(existing.name);
  const kind = typeof body?.kind === "string" ? body.kind : String(existing.kind);
  const memo = typeof body?.memo === "string" ? body.memo : String(existing.memo ?? "");
  if (!name) return json({ error: "거래처 이름을 입력해 주세요." }, 400);
  if (!PARTNER_KINDS.includes(kind)) return json({ error: "올바르지 않은 거래처 구분입니다." }, 400);
  await env.DB.prepare("UPDATE partners SET name = ?, kind = ?, memo = ? WHERE id = ?").bind(name, kind, memo, params.id).run();
  return json({ ...existing, name, kind, memo });
}

export async function onRequestDelete({ request, env, params }: { request: Request; env: Env; params: { id: string } }) {
  const rejected = await requireOwner(request, env);
  if (rejected) return rejected;
  const used = await env.DB.prepare("SELECT id FROM ledger_entries WHERE partner_id = ? LIMIT 1").bind(params.id).first();
  if (used) return json({ error: "사용 중인 거래처는 삭제할 수 없습니다." }, 409);
  const existing = await env.DB.prepare("SELECT id FROM partners WHERE id = ?").bind(params.id).first();
  if (!existing) return json({ error: "거래처를 찾을 수 없습니다." }, 404);
  await env.DB.prepare("DELETE FROM partners WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
