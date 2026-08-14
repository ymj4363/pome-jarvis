import { json, readBody, requireOwner, type Env } from "./_auth";

const KINDS = ["sale", "purchase"];
const SALE_TYPES = ["direct", "commission"];
const INVOICE_STATUSES = ["none", "issued", "received"];

function integer(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

export async function onRequestPost({ request, env }: { request: Request; env: Env }) {
  const rejected = await requireOwner(request, env);
  if (rejected) return rejected;
  const body = await readBody(request);
  const kind = typeof body?.kind === "string" ? body.kind : "";
  const saleType = typeof body?.sale_type === "string" ? body.sale_type : null;
  const partnerId = typeof body?.partner_id === "string" ? body.partner_id : "";
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const invoiceStatus = typeof body?.invoice_status === "string" ? body.invoice_status : "none";
  const isCommission = kind === "sale" && saleType === "commission";
  if (!KINDS.includes(kind) || (kind === "sale" && saleType !== null && !SALE_TYPES.includes(saleType))) {
    return json({ error: "올바르지 않은 거래 유형입니다." }, 400);
  }
  if (!title) return json({ error: "제목을 입력해 주세요." }, 400);
  if (!partnerId || !await env.DB.prepare("SELECT id FROM partners WHERE id = ?").bind(partnerId).first()) {
    return json({ error: "거래처를 찾을 수 없습니다." }, 400);
  }
  if (!INVOICE_STATUSES.includes(invoiceStatus)) return json({ error: "올바르지 않은 세금계산서 상태입니다." }, 400);
  const baseAmount = integer(body?.base_amount);
  const rate = typeof body?.commission_rate === "number" && Number.isFinite(body.commission_rate) ? body.commission_rate : null;
  const requestedAmount = integer(body?.amount);
  if (isCommission && (baseAmount === null || rate === null)) return json({ error: "수수료 건의 기준 금액과 수수료율을 입력해 주세요." }, 400);
  const amount = isCommission ? Math.round(baseAmount! * rate! / 100) : requestedAmount;
  if (amount === null) return json({ error: "금액은 정수로 입력해 주세요." }, 400);
  const now = new Date().toISOString();
  const entry = {
    id: crypto.randomUUID(), kind, sale_type: kind === "sale" ? saleType : null, partner_id: partnerId, title, amount,
    base_amount: isCommission ? baseAmount : null, commission_rate: isCommission ? rate : null,
    invoice_status: invoiceStatus, invoice_date: typeof body?.invoice_date === "string" ? body.invoice_date : null,
    due_date: typeof body?.due_date === "string" ? body.due_date : null, memo: typeof body?.memo === "string" ? body.memo : "",
    status: "open", created_at: now, updated_at: now
  };
  await env.DB.prepare(`INSERT INTO ledger_entries
    (id, kind, sale_type, partner_id, title, amount, base_amount, commission_rate, invoice_status, invoice_date, due_date, memo, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(entry.id, entry.kind, entry.sale_type, entry.partner_id, entry.title, entry.amount, entry.base_amount,
      entry.commission_rate, entry.invoice_status, entry.invoice_date, entry.due_date, entry.memo, entry.status,
      entry.created_at, entry.updated_at).run();
  return json(entry, 201);
}
