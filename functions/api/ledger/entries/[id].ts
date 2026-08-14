import { json, readBody, requireOwner, type Env } from "../_auth";

const editable = ["partner_id", "sale_type", "title", "amount", "base_amount", "commission_rate", "invoice_status", "invoice_date", "due_date", "paid_date", "paid_amount", "status", "memo"] as const;
const invoiceStatuses = ["none", "issued", "received"];
const statuses = ["open", "paid", "canceled"];
const saleTypes = ["direct", "commission"];

export async function onRequestPut({ request, env, params }: { request: Request; env: Env; params: { id: string } }) {
  const rejected = await requireOwner(request, env);
  if (rejected) return rejected;
  const body = await readBody(request);
  const existing = await env.DB.prepare("SELECT * FROM ledger_entries WHERE id = ?").bind(params.id).first<Record<string, unknown>>();
  if (!existing) return json({ error: "거래를 찾을 수 없습니다." }, 404);
  if (!body) return json({ error: "요청 본문이 올바르지 않습니다." }, 400);
  if (typeof body.title === "string" && !body.title.trim()) return json({ error: "제목을 입력해 주세요." }, 400);
  if (body.amount !== undefined && (!Number.isInteger(body.amount) || typeof body.amount !== "number")) return json({ error: "금액은 정수여야 합니다." }, 400);
  if (body.paid_amount !== undefined && body.paid_amount !== null && (!Number.isInteger(body.paid_amount) || typeof body.paid_amount !== "number")) return json({ error: "지급 금액은 정수여야 합니다." }, 400);
  if (body.invoice_status !== undefined && (typeof body.invoice_status !== "string" || !invoiceStatuses.includes(body.invoice_status))) return json({ error: "올바르지 않은 세금계산서 상태입니다." }, 400);
  if (body.status !== undefined && (typeof body.status !== "string" || !statuses.includes(body.status))) return json({ error: "올바르지 않은 상태입니다." }, 400);
  if (body.sale_type !== undefined && body.sale_type !== null && (typeof body.sale_type !== "string" || !saleTypes.includes(body.sale_type))) return json({ error: "올바르지 않은 거래 유형입니다." }, 400);
  if (body.partner_id !== undefined && (typeof body.partner_id !== "string" || !await env.DB.prepare("SELECT id FROM partners WHERE id = ?").bind(body.partner_id).first())) return json({ error: "거래처를 찾을 수 없습니다." }, 400);
  const fields = editable.filter(field => Object.prototype.hasOwnProperty.call(body, field));
  if (fields.length === 0) return json(existing);
  const values = fields.map(field => field === "title" && typeof body[field] === "string" ? body[field].trim() : body[field]);
  const setClause = [...fields.map(field => `${field} = ?`), "updated_at = ?"].join(", ");
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(`UPDATE ledger_entries SET ${setClause} WHERE id = ?`).bind(...values, updatedAt, params.id).run();
  return json({ ...existing, ...Object.fromEntries(fields.map((field, index) => [field, values[index]])), updated_at: updatedAt });
}

export async function onRequestDelete({ request, env, params }: { request: Request; env: Env; params: { id: string } }) {
  const rejected = await requireOwner(request, env);
  if (rejected) return rejected;
  const existing = await env.DB.prepare("SELECT id FROM ledger_entries WHERE id = ?").bind(params.id).first();
  if (!existing) return json({ error: "거래를 찾을 수 없습니다." }, 404);
  await env.DB.prepare("DELETE FROM ledger_entries WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
