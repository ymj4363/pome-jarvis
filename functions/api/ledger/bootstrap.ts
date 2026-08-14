import { json, requireOwner, type Env } from "./_auth";

function currentKST(): { period: string; now: string } {
  const now = new Date();
  return { period: new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 7), now: now.toISOString() };
}

function dueDate(period: string, dayOfMonth: number): string {
  const [year, month] = period.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(Math.min(dayOfMonth, lastDay)).padStart(2, "0")}`;
}

export async function onRequestGet({ request, env }: { request: Request; env: Env }) {
  const rejected = await requireOwner(request, env);
  if (rejected) return rejected;

  const { period, now } = currentKST();
  const rules = await env.DB.prepare("SELECT * FROM recurring_rules WHERE active = 1").all<Record<string, unknown>>();
  for (const rule of rules.results) {
    await env.DB.prepare(`INSERT OR IGNORE INTO ledger_entries
      (id, kind, sale_type, partner_id, title, amount, base_amount, commission_rate, invoice_status, due_date, status, recurring_rule_id, period, memo, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'none', ?, 'open', ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), rule.kind, rule.sale_type ?? null, rule.partner_id, rule.title, rule.amount,
        rule.base_amount ?? null, rule.commission_rate ?? null, dueDate(period, Number(rule.day_of_month)),
        rule.id, period, rule.memo ?? "", now, now).run();
  }

  const [partners, entries, allRules] = await Promise.all([
    env.DB.prepare("SELECT * FROM partners ORDER BY name COLLATE NOCASE").all(),
    env.DB.prepare("SELECT * FROM ledger_entries ORDER BY due_date IS NULL, due_date ASC").all(),
    env.DB.prepare("SELECT * FROM recurring_rules ORDER BY created_at DESC").all()
  ]);
  return json({ partners: partners.results, entries: entries.results, rules: allRules.results });
}
