export type PartnerKind = "customer" | "intermediary" | "vendor";
export type LedgerKind = "sale" | "purchase";
export type SaleType = "direct" | "commission";
export type InvoiceStatus = "none" | "issued" | "received";
export type EntryStatus = "open" | "paid" | "canceled";

export type Partner = {
  id: string;
  name: string;
  kind: PartnerKind;
  memo: string;
  created_at: string;
};

export type LedgerEntry = {
  id: string;
  kind: LedgerKind;
  sale_type: SaleType | null;
  partner_id: string;
  title: string;
  amount: number;
  base_amount: number | null;
  commission_rate: number | null;
  invoice_status: InvoiceStatus;
  invoice_date: string | null;
  due_date: string | null;
  paid_date: string | null;
  paid_amount: number | null;
  status: EntryStatus;
  recurring_rule_id: string | null;
  period: string | null;
  memo: string;
  created_at: string;
  updated_at: string;
};

export type RecurringRule = {
  id: string;
  kind: LedgerKind;
  sale_type: SaleType | null;
  partner_id: string;
  title: string;
  amount: number;
  base_amount: number | null;
  commission_rate: number | null;
  day_of_month: number;
  active: number;
  memo: string;
  created_at: string;
};

export type LedgerData = { partners: Partner[]; entries: LedgerEntry[]; rules: RecurringRule[] };

export type EntryInput = Pick<LedgerEntry, "kind" | "partner_id" | "title" | "amount"> & Partial<Pick<LedgerEntry,
  "sale_type" | "base_amount" | "commission_rate" | "invoice_status" | "invoice_date" | "due_date" | "memo">>;
export type RuleInput = Pick<RecurringRule, "kind" | "partner_id" | "title" | "amount" | "day_of_month"> & Partial<Pick<RecurringRule,
  "sale_type" | "base_amount" | "commission_rate" | "active" | "memo">>;
