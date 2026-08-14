import { json, readBody, requireOwner, type Env } from "./_auth";

const KINDS = ["sale", "purchase"];
const SALE_TYPES = ["direct", "commission"];

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const rejected = await requireOwner(request, env);
  if (rejected) return rejected;
  const body = await readBody(request);
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const saleType = typeof body?.sale_type === "string" ? body.sale_type : null;
  const partnerId = typeof body?.partner_id === "string" ? body.partner_id : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const amount = typeof body?.amount === "number" && Number.isInteger(body.amount) ? body.amount : null;
  const day = typeof body?.day_of_month === "number" && Number.isInteger(body.day_of_month) ? body.day_of_month : null;
  if (!KINDS.includes(kind) || (kind === "sale" && saleType !== null && !SALE_TYPES.includes(saleType))) return json({ error: "올바르지 않은 거래 유형입니다." }, 400);
  if (!partnerId || !await env.DB.prepare("SELECT id FROM partners WHERE id = ?").bind(partnerId).first()) return json({ error: "거래처를 찾을 수 없습니다." }, 400);
  if (!title || amount === null || day === null || day < 1 || day > 31) return json({ error: "반복 규칙 입력값이 올바르지 않습니다." }, 400);
  const rule = { id: crypto.randomUUID(), kind, sale_type: kind === "sale" ? saleType : null, partner_id: partnerId, title, amount,
    base_amount: typeof body?.base_amount === "number" ? body.base_amount : null,
    commission_rate: typeof body?.commission_rate === "number" ? body.commission_rate : null,
    day_of_month: day, active: 1, memo: typeof body?.memo === "string" ? body.memo : "", created_at: new Date().toISOString() };
  await env.DB.prepare(`INSERT INTO recurring_rules
    (id, kind, sale_type, partner_id, title, amount, base_amount, commission_rate, day_of_month, active, memo, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(rule.id, rule.kind, rule.sale_type, rule.partner_id, rule.title, rule.amount, rule.base_amount,
      rule.commission_rate, rule.day_of_month, rule.active, rule.memo, rule.created_at).run();
  return json(rule, 201);
}
