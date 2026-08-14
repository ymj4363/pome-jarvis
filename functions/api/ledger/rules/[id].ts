import { json, readBody, requireOwner, type Env } from "../_auth";

const editable = ["kind", "sale_type", "partner_id", "title", "amount", "base_amount", "commission_rate", "day_of_month", "active", "memo"] as const;

export async function onRequestPut({ request, env, params }: { request: Request; env: Env; params: { id: string } }) {
  const rejected = await requireOwner(request, env);
  if (rejected) return rejected;
  const body = await readBody(request);
  const existing = await env.DB.prepare("SELECT * FROM recurring_rules WHERE id = ?").bind(params.id).first<Record<string, unknown>>();
  if (!existing) return json({ error: "반복 규칙을 찾을 수 없습니다." }, 404);
  if (!body) return json({ error: "요청 본문이 올바르지 않습니다." }, 400);
  if (body.day_of_month !== undefined && (typeof body.day_of_month !== "number" || !Number.isInteger(body.day_of_month) || body.day_of_month < 1 || body.day_of_month > 31)) return json({ error: "매월 일자는 1~31 사이여야 합니다." }, 400);
  if (body.partner_id !== undefined && (typeof body.partner_id !== "string" || !await env.DB.prepare("SELECT id FROM partners WHERE id = ?").bind(body.partner_id).first())) return json({ error: "거래처를 찾을 수 없습니다." }, 400);
  const fields = editable.filter(field => Object.prototype.hasOwnProperty.call(body, field));
  if (!fields.length) return json(existing);
  const values = fields.map(field => field === "title" && typeof body[field] === "string" ? body[field].trim() : body[field]);
  await env.DB.prepare(`UPDATE recurring_rules SET ${fields.map(field => `${field} = ?`).join(", ")} WHERE id = ?`).bind(...values, params.id).run();
  return json({ ...existing, ...Object.fromEntries(fields.map((field, index) => [field, values[index]])) });
}

export async function onRequestDelete({ request, env, params }: { request: Request; env: Env; params: { id: string } }) {
  const rejected = await requireOwner(request, env);
  if (rejected) return rejected;
  const existing = await env.DB.prepare("SELECT id FROM recurring_rules WHERE id = ?").bind(params.id).first();
  if (!existing) return json({ error: "반복 규칙을 찾을 수 없습니다." }, 404);
  await env.DB.prepare("DELETE FROM recurring_rules WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
