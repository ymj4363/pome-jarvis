import type { EntryInput, LedgerData, LedgerEntry, Partner, PartnerKind, RecurringRule, RuleInput } from "../ledger/types";

async function request<T>(accessToken: string, path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: "알 수 없는 오류" })) as { error?: string };
    throw new Error(data.error ?? `Ledger request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const fetchLedgerBootstrap = (accessToken: string) => request<LedgerData>(accessToken, "/api/ledger/bootstrap");
export const createPartner = (accessToken: string, input: { name: string; kind: PartnerKind; memo?: string }) => request<Partner>(accessToken, "/api/ledger/partners", "POST", input);
export const updatePartner = (accessToken: string, id: string, input: Partial<Pick<Partner, "name" | "kind" | "memo">>) => request<Partner>(accessToken, `/api/ledger/partners/${encodeURIComponent(id)}`, "PUT", input);
export const deletePartner = (accessToken: string, id: string) => request<{ ok: true }>(accessToken, `/api/ledger/partners/${encodeURIComponent(id)}`, "DELETE");
export const createEntry = (accessToken: string, input: EntryInput) => request<LedgerEntry>(accessToken, "/api/ledger/entries", "POST", input);
export const updateEntry = (accessToken: string, id: string, input: Partial<LedgerEntry>) => request<LedgerEntry>(accessToken, `/api/ledger/entries/${encodeURIComponent(id)}`, "PUT", input);
export const deleteEntry = (accessToken: string, id: string) => request<{ ok: true }>(accessToken, `/api/ledger/entries/${encodeURIComponent(id)}`, "DELETE");
export const createRule = (accessToken: string, input: RuleInput) => request<RecurringRule>(accessToken, "/api/ledger/rules", "POST", input);
export const updateRule = (accessToken: string, id: string, input: Partial<RecurringRule>) => request<RecurringRule>(accessToken, `/api/ledger/rules/${encodeURIComponent(id)}`, "PUT", input);
export const deleteRule = (accessToken: string, id: string) => request<{ ok: true }>(accessToken, `/api/ledger/rules/${encodeURIComponent(id)}`, "DELETE");
