import type { LedgerData, LedgerEntry } from "./types";

export const formatKRW = (amount: number) => `${new Intl.NumberFormat("ko-KR").format(amount)}원`;
export const todayKST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
export const isOverdue = (entry: LedgerEntry, today: string) => entry.status === "open" && !!entry.due_date && entry.due_date < today;
export const isDueSoon = (entry: LedgerEntry, today: string) => {
  if (entry.status !== "open" || !entry.due_date) return false;
  const end = new Date(`${today}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 7);
  return entry.due_date >= today && entry.due_date <= end.toISOString().slice(0, 10);
};
export const countOverdue = (data: LedgerData | null) => data ? data.entries.filter(entry => isOverdue(entry, todayKST())).length : 0;
export const calcCommission = (base: number, rate: number) => Math.round(base * rate / 100);

// 금액 입력 필드용: 입력과 동시에 천단위 콤마 표시 / 저장 시 숫자로 환원 (빈 값은 NaN → 검증에서 걸림)
export const formatAmountInput = (value: string) => { const digits = value.replace(/[^\d]/g, ""); return digits ? Number(digits).toLocaleString("ko-KR") : ""; };
export const parseAmountInput = (value: string) => { const digits = value.replace(/[^\d]/g, ""); return digits ? Number(digits) : NaN; };
