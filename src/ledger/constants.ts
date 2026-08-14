import type { EntryStatus, InvoiceStatus, LedgerKind, SaleType } from "./types";

export const KIND_LABEL: Record<LedgerKind, string> = { sale: "매출", purchase: "매입" };
export const SALE_TYPE_LABEL: Record<SaleType, string> = { direct: "직접", commission: "수수료" };
export const INVOICE_LABEL: Record<InvoiceStatus, string> = { none: "미발행", issued: "발행 완료", received: "수취 완료" };
export const ENTRY_STATUS_LABEL: Record<EntryStatus, string> = { open: "대기", paid: "완료", canceled: "취소" };

export function invoiceLabel(status: InvoiceStatus, kind: LedgerKind): string {
  if (status === "none") return "미발행";
  return kind === "sale" ? (status === "issued" ? "발행 완료" : "수취 완료") : (status === "received" ? "수취 완료" : "발행 완료");
}
