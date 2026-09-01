import type { EntryStatus, InvoiceStatus, LedgerEntry, LedgerKind, SaleType } from "./types";
import { isDueSoon, isOverdue, overdueDays } from "./utils";

export const KIND_LABEL: Record<LedgerKind, string> = { sale: "매출", purchase: "매입" };
export const SALE_TYPE_LABEL: Record<SaleType, string> = { direct: "직접", commission: "수수료" };
export const INVOICE_LABEL: Record<InvoiceStatus, string> = { none: "미발행", issued: "발행 완료", received: "수금 완료" };
export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = { open: "대기", paid: "완료", canceled: "취소" };

export function invoiceLabel(status: InvoiceStatus, kind: LedgerKind): string {
  if (status === "none") return "미발행";
  return kind === "sale" ? (status === "issued" ? "발행 완료" : "수금 완료") : (status === "received" ? "수금 완료" : "발행 완료");
}

// 상태 배지 — 대시보드와 매출·매입 목록이 같은 문구·색을 쓰도록 판정을 한 곳에 둔다.
// "완료"라는 말은 배지만 쓴다 (버튼은 아래 actionLabel의 동작형 문구).
export function entryPill(entry: LedgerEntry, today: string): { tone: string; label: string } {
  if (entry.status === "paid") return { tone: "paid", label: entry.kind === "sale" ? "수금 완료" : "지급 완료" };
  if (entry.status === "canceled") return { tone: "open", label: ENTRY_STATUS_LABEL.canceled };
  if (isOverdue(entry, today)) return { tone: "overdue", label: `지연 D+${overdueDays(entry, today)}` };
  if (isDueSoon(entry, today)) return { tone: "soon", label: "임박" };
  return { tone: "open", label: "대기" };
}

// 금액 방향 라벨 — 숫자만 보고도 받을 돈인지 받은 돈인지 구분되게 (취소 건은 라벨 없음)
export const amountLabel = (entry: LedgerEntry): string =>
  entry.status === "canceled" ? ""
    : entry.status === "paid" ? (entry.kind === "sale" ? "받은" : "지급한")
    : (entry.kind === "sale" ? "받을" : "지급할");

// 처리 버튼 문구 — 아직 하지 않은 동작이므로 완료형을 쓰지 않는다
export const actionLabel = (kind: LedgerKind): string => kind === "sale" ? "수금 처리" : "지급 처리";
