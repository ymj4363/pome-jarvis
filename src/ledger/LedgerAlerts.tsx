import { formatKRW, isDueSoon, isOverdue, todayKST } from "./utils";
import type { LedgerData } from "./types";

export default function LedgerAlerts({ data, onNavigate }: { data: LedgerData | null; onNavigate: () => void }) {
  if (!data) return null;
  const today = todayKST();
  const partners = new Map(data.partners.map(partner => [partner.id, partner.name]));
  const overdue = data.entries.filter(entry => isOverdue(entry, today));
  const dueSoon = data.entries.filter(entry => isDueSoon(entry, today));
  if (!overdue.length && !dueSoon.length) return null;
  const total = [...overdue, ...dueSoon].reduce((sum, entry) => sum + entry.amount, 0);
  return <div className="ledger-alerts">
    <strong>💰 수금 알림 — 지연 {overdue.length}건 · 이번 주 예정 {dueSoon.length}건 ({formatKRW(total)})</strong>
    {overdue.slice(0, 3).map(entry => {
      const days = Math.max(1, Math.floor((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${entry.due_date}T00:00:00Z`).getTime()) / 86400000));
      return <span key={entry.id}>{entry.title} · {partners.get(entry.partner_id) ?? "거래처"} · D+{days}</span>;
    })}
    <button className="ghost" onClick={onNavigate}>매출·매입에서 처리 →</button>
  </div>;
}
