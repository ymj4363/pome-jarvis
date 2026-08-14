import { useMemo, useState, type FormEvent } from "react";
import type { LogEntry } from "../types";
import type { ShowToast } from "../constants";
import { createEntry, createPartner, createRule, deleteEntry, deletePartner, deleteRule, updateEntry, updatePartner, updateRule } from "../services/ledgerService";
import { ENTRY_STATUS_LABEL, invoiceLabel, KIND_LABEL, SALE_TYPE_LABEL } from "./constants";
import type { EntryInput, LedgerData, LedgerEntry, LedgerKind, Partner, PartnerKind, RecurringRule, RuleInput, SaleType } from "./types";
import { calcCommission, formatAmountInput, formatKRW, isDueSoon, isOverdue, parseAmountInput, todayKST } from "./utils";

type Props = { data: LedgerData | null; accessToken: string | null; onReload: () => Promise<void>; showToast: ShowToast; addLog: (e: Omit<LogEntry, "id" | "createdAt">) => void };
type EntryForm = { title: string; partner_id: string; sale_type: SaleType; amount: string; base_amount: string; commission_rate: string; invoice_status: "none" | "issued" | "received"; due_date: string; memo: string };
const initialForm: EntryForm = { title: "", partner_id: "", sale_type: "direct", amount: "", base_amount: "", commission_rate: "", invoice_status: "none", due_date: "", memo: "" };

function message(error: unknown) { return error instanceof Error ? error.message : "알 수 없는 오류"; }

export default function LedgerSection({ data, accessToken, onReload, showToast, addLog }: Props) {
  const [tab, setTab] = useState<"dashboard" | "sale" | "purchase" | "settings">("dashboard");
  const [showEntryForm, setShowEntryForm] = useState(false);
  const [entryForm, setEntryForm] = useState<EntryForm>(initialForm);
  const [filter, setFilter] = useState<"open" | "paid" | "all">("open");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [dateEditing, setDateEditing] = useState<string | null>(null);
  const [partnerName, setPartnerName] = useState("");
  const [partnerKind, setPartnerKind] = useState<PartnerKind>("customer");
  const [partnerMemo, setPartnerMemo] = useState("");
  const [editingPartner, setEditingPartner] = useState<string | null>(null);
  const [ruleForm, setRuleForm] = useState({ kind: "sale" as LedgerKind, partner_id: "", title: "", amount: "", day_of_month: "1", memo: "" });
  const [showRuleForm, setShowRuleForm] = useState(false);
  const today = todayKST();
  const partners = data?.partners ?? [];
  const partnerNameById = useMemo(() => new Map(partners.map(partner => [partner.id, partner.name])), [partners]);

  const mutate = async (action: () => Promise<unknown>, log: Omit<LogEntry, "id" | "createdAt">, toast: string) => {
    if (!accessToken) return;
    try { await action(); await onReload(); addLog(log); showToast(toast, "success"); }
    catch (error) { showToast(message(error), "error"); }
  };

  const complete = (entry: LedgerEntry) => mutate(
    () => updateEntry(accessToken!, entry.id, { paid_date: today, paid_amount: entry.amount, status: "paid" }),
    { action: "ledger.paid", detail: `"${entry.title}" ${entry.kind === "sale" ? "수금" : "지급"} 완료.`, status: "success" },
    `${entry.kind === "sale" ? "수금" : "지급"} 완료 처리했습니다.`
  );

  const resetEntryForm = () => { setEntryForm(initialForm); setShowEntryForm(false); setEditingEntryId(null); };

  // 수정: 등록 폼에 기존 값을 채워 열고, 저장 시 전체 필드를 PUT으로 반영
  const startEditEntry = (entry: LedgerEntry) => {
    setEntryForm({
      title: entry.title, partner_id: entry.partner_id, sale_type: entry.sale_type ?? "direct",
      amount: entry.amount.toLocaleString("ko-KR"),
      base_amount: entry.base_amount === null ? "" : entry.base_amount.toLocaleString("ko-KR"),
      commission_rate: entry.commission_rate === null ? "" : String(entry.commission_rate),
      invoice_status: entry.invoice_status, due_date: entry.due_date ?? "", memo: entry.memo
    });
    setEditingEntryId(entry.id);
    setShowEntryForm(true);
  };

  const saveEntry = async (kind: LedgerKind, event: FormEvent) => {
    event.preventDefault();
    const isCommission = kind === "sale" && entryForm.sale_type === "commission";
    const base = parseAmountInput(entryForm.base_amount);
    const rate = Number(entryForm.commission_rate);
    const amount = isCommission ? calcCommission(base, rate) : parseAmountInput(entryForm.amount);
    if (!entryForm.partner_id || !entryForm.title.trim() || !Number.isInteger(amount) || (isCommission && (!Number.isFinite(base) || !Number.isFinite(rate)))) {
      showToast("거래처, 제목, 금액을 확인해 주세요.", "error"); return;
    }
    if (editingEntryId) {
      await mutate(() => updateEntry(accessToken!, editingEntryId, {
        partner_id: entryForm.partner_id, title: entryForm.title.trim(), amount,
        sale_type: kind === "sale" ? entryForm.sale_type : null,
        base_amount: isCommission ? base : null, commission_rate: isCommission ? rate : null,
        invoice_status: entryForm.invoice_status, due_date: entryForm.due_date || null, memo: entryForm.memo
      }), { action: "ledger.updated", detail: `"${entryForm.title.trim()}" 거래 수정.`, status: "success" }, "거래를 수정했습니다.");
    } else {
      const input: EntryInput = { kind, partner_id: entryForm.partner_id, title: entryForm.title.trim(), amount, sale_type: kind === "sale" ? entryForm.sale_type : undefined,
        base_amount: isCommission ? base : undefined, commission_rate: isCommission ? rate : undefined, invoice_status: entryForm.invoice_status,
        due_date: entryForm.due_date || undefined, memo: entryForm.memo };
      await mutate(() => createEntry(accessToken!, input), { action: "ledger.created", detail: `"${input.title}" ${KIND_LABEL[kind]} 등록.`, status: "success" }, "거래를 등록했습니다.");
    }
    resetEntryForm();
  };

  const updateDueDate = (entry: LedgerEntry, due_date: string) => mutate(
    () => updateEntry(accessToken!, entry.id, { due_date: due_date || null }),
    { action: "ledger.updated", detail: `"${entry.title}" 예정일 변경.`, status: "success" }, "예정일을 변경했습니다."
  );

  const removeEntry = (entry: LedgerEntry) => {
    if (!window.confirm(`"${entry.title}" 거래를 삭제할까요?`)) return;
    void mutate(() => deleteEntry(accessToken!, entry.id), { action: "ledger.deleted", detail: `"${entry.title}" 거래 삭제.`, status: "success" }, "거래를 삭제했습니다.");
  };

  const savePartner = async (event: FormEvent) => {
    event.preventDefault();
    if (!partnerName.trim()) return;
    const existing = partners.find(partner => partner.id === editingPartner);
    await mutate(() => existing ? updatePartner(accessToken!, existing.id, { name: partnerName.trim(), kind: partnerKind, memo: partnerMemo }) : createPartner(accessToken!, { name: partnerName.trim(), kind: partnerKind, memo: partnerMemo }),
      { action: existing ? "ledger.updated" : "ledger.created", detail: `거래처 "${partnerName.trim()}" ${existing ? "수정" : "등록"}.`, status: "success" }, existing ? "거래처를 수정했습니다." : "거래처를 등록했습니다.");
    setPartnerName(""); setPartnerMemo(""); setPartnerKind("customer"); setEditingPartner(null);
  };

  const saveRule = async (event: FormEvent) => {
    event.preventDefault();
    const input: RuleInput = { kind: ruleForm.kind, partner_id: ruleForm.partner_id, title: ruleForm.title.trim(), amount: parseAmountInput(ruleForm.amount), day_of_month: Number(ruleForm.day_of_month), memo: ruleForm.memo };
    if (!input.partner_id || !input.title || !Number.isInteger(input.amount) || !Number.isInteger(input.day_of_month)) { showToast("반복 규칙 입력값을 확인해 주세요.", "error"); return; }
    await mutate(() => createRule(accessToken!, input), { action: "ledger.created", detail: `반복 규칙 "${input.title}" 등록.`, status: "success" }, "반복 규칙을 등록했습니다.");
    setRuleForm({ kind: "sale", partner_id: "", title: "", amount: "", day_of_month: "1", memo: "" }); setShowRuleForm(false);
  };

  if (!accessToken) return <div className="empty-state"><div className="empty-icon">💰</div><p>구글 계정 연동 후 사용할 수 있습니다.</p></div>;
  if (!data) return <div className="empty-state"><div className="empty-icon">💰</div><p>수금 데이터를 불러오는 중입니다.</p></div>;

  const orderedEntries = (kind: LedgerKind) => data.entries.filter(entry => entry.kind === kind && (filter === "all" || filter === entry.status))
    .sort((a, b) => Number(isOverdue(b, today)) - Number(isOverdue(a, today)) || Number(a.due_date === null) - Number(b.due_date === null) || (a.due_date ?? "").localeCompare(b.due_date ?? ""));
  const monthly = data.entries.filter(entry => entry.created_at.slice(0, 7) === today.slice(0, 7));
  const dashboardEntries = data.entries.filter(entry => entry.status === "open");

  const entryList = (kind: LedgerKind) => <>
    <div className="ledger-toolbar">
      <button onClick={() => { if (showEntryForm) { resetEntryForm(); } else { setEntryForm(initialForm); setEditingEntryId(null); setShowEntryForm(true); } }}>{showEntryForm ? "닫기" : "+ 등록"}</button>
      <div className="ledger-filters">{(["open", "paid", "all"] as const).map(value => <button key={value} className={filter === value ? "" : "ghost"} onClick={() => setFilter(value)}>{value === "open" ? (kind === "sale" ? "미수" : "미지급") : value === "paid" ? "완료" : "전체"}</button>)}</div>
    </div>
    {showEntryForm && <form className="event-form ledger-form" onSubmit={event => void saveEntry(kind, event)}>
      {editingEntryId && <strong className="ledger-form-mode">✏️ 거래 수정</strong>}
      {kind === "sale" && <div className="ledger-radio-row">{(["direct", "commission"] as SaleType[]).map(value => <label key={value}><input type="radio" checked={entryForm.sale_type === value} onChange={() => setEntryForm(form => ({ ...form, sale_type: value }))} /> {SALE_TYPE_LABEL[value]}</label>)}</div>}
      <select value={entryForm.partner_id} onChange={event => setEntryForm(form => ({ ...form, partner_id: event.target.value }))}><option value="">거래처 선택</option>{partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select>
      {!partners.length && <small>거래처·반복 탭에서 추가해 주세요.</small>}
      <input type="text" placeholder="제목" value={entryForm.title} onChange={event => setEntryForm(form => ({ ...form, title: event.target.value }))} />
      {kind === "sale" && entryForm.sale_type === "commission" ? <><input type="text" inputMode="numeric" placeholder="기준 금액" value={entryForm.base_amount} onChange={event => setEntryForm(form => ({ ...form, base_amount: formatAmountInput(event.target.value) }))} /><input type="number" step="0.01" placeholder="수수료율 (%)" value={entryForm.commission_rate} onChange={event => setEntryForm(form => ({ ...form, commission_rate: event.target.value }))} /><strong className="ledger-estimate">예상 금액 {formatKRW(calcCommission(parseAmountInput(entryForm.base_amount) || 0, Number(entryForm.commission_rate) || 0))}</strong></> : <input type="text" inputMode="numeric" placeholder="금액 (원)" value={entryForm.amount} onChange={event => setEntryForm(form => ({ ...form, amount: formatAmountInput(event.target.value) }))} />}
      <select value={entryForm.invoice_status} onChange={event => setEntryForm(form => ({ ...form, invoice_status: event.target.value as EntryForm["invoice_status"] }))}><option value="none">미발행</option><option value="issued">발행 완료</option><option value="received">수취 완료</option></select>
      <input type="date" value={entryForm.due_date} onChange={event => setEntryForm(form => ({ ...form, due_date: event.target.value }))} />
      <textarea placeholder="메모" value={entryForm.memo} onChange={event => setEntryForm(form => ({ ...form, memo: event.target.value }))} />
      <div className="ledger-form-actions">
        <button type="submit">{editingEntryId ? "수정 저장" : "등록"}</button>
        {editingEntryId && <button type="button" className="ghost" onClick={resetEntryForm}>취소</button>}
      </div>
    </form>}
    <div className="ledger-list">{orderedEntries(kind).map(entry => <EntryRow key={entry.id} entry={entry} partnerName={partnerNameById.get(entry.partner_id) ?? "-"} today={today} dateEditing={dateEditing === entry.id} onComplete={complete} onDelete={removeEntry} onEdit={() => startEditEntry(entry)} onDateEdit={() => setDateEditing(entry.id)} onDateSave={date => { void updateDueDate(entry, date); setDateEditing(null); }} />)}</div>
    {!orderedEntries(kind).length && <div className="empty-state"><div className="empty-icon">💰</div><p>표시할 {KIND_LABEL[kind]} 거래가 없습니다.</p></div>}
  </>;

  return <div className="ledger-section">
    <div className="meeting-tabs ledger-tabs">{[["dashboard", "대시보드"], ["sale", "매출"], ["purchase", "매입"], ["settings", "거래처·반복"]].map(([id, label]) => <button key={id} className={tab === id ? "" : "ghost"} onClick={() => { setTab(id as typeof tab); resetEntryForm(); }}>{label}</button>)}</div>
    {tab === "dashboard" && <><div className="ledger-stats"><Stat label="이번 달 매출" value={monthly.filter(entry => entry.kind === "sale").reduce((sum, entry) => sum + entry.amount, 0)} /><Stat label="이번 달 매입" value={monthly.filter(entry => entry.kind === "purchase").reduce((sum, entry) => sum + entry.amount, 0)} /><Stat label="미수 총액" accent value={dashboardEntries.filter(entry => entry.kind === "sale").reduce((sum, entry) => sum + entry.amount, 0)} /><Stat label="이번 주 받을 돈" value={dashboardEntries.filter(entry => entry.kind === "sale" && isDueSoon(entry, today)).reduce((sum, entry) => sum + entry.amount, 0)} /></div><DashboardList title="지연 목록" entries={dashboardEntries.filter(entry => isOverdue(entry, today))} partnerNameById={partnerNameById} onComplete={complete} /><DashboardList title="다가오는 7일" entries={dashboardEntries.filter(entry => isDueSoon(entry, today))} partnerNameById={partnerNameById} onComplete={complete} /></>}
    {tab === "sale" && entryList("sale")}{tab === "purchase" && entryList("purchase")}
    {tab === "settings" && <div className="ledger-settings"><section><h3>거래처</h3><form className="event-form ledger-form" onSubmit={event => void savePartner(event)}><input type="text" placeholder="거래처명" value={partnerName} onChange={event => setPartnerName(event.target.value)} /><select value={partnerKind} onChange={event => setPartnerKind(event.target.value as PartnerKind)}><option value="customer">고객</option><option value="intermediary">중간 업체</option><option value="vendor">매입처</option></select><input type="text" placeholder="메모" value={partnerMemo} onChange={event => setPartnerMemo(event.target.value)} /><button type="submit">{editingPartner ? "수정 저장" : "거래처 추가"}</button></form><div className="ledger-list">{partners.map(partner => <div className="ledger-row" key={partner.id}><span><strong>{partner.name}</strong><small>{partner.kind === "customer" ? "고객" : partner.kind === "intermediary" ? "중간 업체" : "매입처"} · {partner.memo}</small></span><button className="ghost" onClick={() => { setEditingPartner(partner.id); setPartnerName(partner.name); setPartnerKind(partner.kind); setPartnerMemo(partner.memo); }}>✏️ 수정</button><button className="danger-ghost" onClick={() => void mutate(() => deletePartner(accessToken, partner.id), { action: "ledger.deleted", detail: `거래처 "${partner.name}" 삭제.`, status: "success" }, "거래처를 삭제했습니다.")}>🗑️</button></div>)}</div></section><section><h3>반복 규칙</h3><p>활성 규칙은 매월 자동으로 건을 생성합니다.</p><button onClick={() => setShowRuleForm(open => !open)}>+ 반복 규칙</button>{showRuleForm && <form className="event-form ledger-form" onSubmit={event => void saveRule(event)}><select value={ruleForm.kind} onChange={event => setRuleForm(form => ({ ...form, kind: event.target.value as LedgerKind }))}><option value="sale">매출</option><option value="purchase">매입</option></select><select value={ruleForm.partner_id} onChange={event => setRuleForm(form => ({ ...form, partner_id: event.target.value }))}><option value="">거래처 선택</option>{partners.map(partner => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select><input type="text" placeholder="제목" value={ruleForm.title} onChange={event => setRuleForm(form => ({ ...form, title: event.target.value }))} /><input type="text" inputMode="numeric" placeholder="금액" value={ruleForm.amount} onChange={event => setRuleForm(form => ({ ...form, amount: formatAmountInput(event.target.value) }))} /><input type="number" min="1" max="31" placeholder="매월 일자" value={ruleForm.day_of_month} onChange={event => setRuleForm(form => ({ ...form, day_of_month: event.target.value }))} /><button type="submit">등록</button></form>}<div className="ledger-list">{data.rules.map(rule => <div className="ledger-row" key={rule.id}><span><strong>매월 {rule.day_of_month}일 · {rule.title}</strong><small>{formatKRW(rule.amount)} · {partnerNameById.get(rule.partner_id) ?? "거래처"}</small></span><label className="ledger-toggle"><input type="checkbox" checked={!!rule.active} onChange={() => void mutate(() => updateRule(accessToken, rule.id, { active: rule.active ? 0 : 1 }), { action: "ledger.updated", detail: `반복 규칙 "${rule.title}" 활성 상태 변경.`, status: "success" }, "반복 규칙을 변경했습니다.")} /> 활성</label><button className="danger-ghost" onClick={() => void mutate(() => deleteRule(accessToken, rule.id), { action: "ledger.deleted", detail: `반복 규칙 "${rule.title}" 삭제.`, status: "success" }, "반복 규칙을 삭제했습니다.")}>🗑️</button></div>)}</div></section></div>}
  </div>;
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: boolean }) { return <div className={`ledger-stat${accent ? " ledger-stat-accent" : ""}`}><span>{label}</span><strong>{formatKRW(value)}</strong></div>; }
function DashboardList({ title, entries, partnerNameById, onComplete }: { title: string; entries: LedgerEntry[]; partnerNameById: Map<string, string>; onComplete: (entry: LedgerEntry) => void }) { return <section className="ledger-dashboard-list"><h3>{title}</h3>{entries.length ? entries.map(entry => <div className="ledger-row" key={entry.id}><span><strong>{entry.title}</strong><small>{partnerNameById.get(entry.partner_id) ?? "거래처"} · {entry.due_date}</small></span><strong className="ledger-amount">{formatKRW(entry.amount)}</strong><button onClick={() => onComplete(entry)}>✓ {entry.kind === "sale" ? "수금" : "지급"} 완료</button></div>) : <p>해당 거래가 없습니다.</p>}</section>; }
function EntryRow({ entry, partnerName, today, dateEditing, onComplete, onDelete, onEdit, onDateEdit, onDateSave }: { entry: LedgerEntry; partnerName: string; today: string; dateEditing: boolean; onComplete: (entry: LedgerEntry) => void; onDelete: (entry: LedgerEntry) => void; onEdit: () => void; onDateEdit: () => void; onDateSave: (date: string) => void }) { const overdue = isOverdue(entry, today); const soon = isDueSoon(entry, today); const pill = entry.status === "paid" ? "paid" : overdue ? "overdue" : soon ? "soon" : "open"; return <div className={`ledger-row ledger-entry ${entry.status === "paid" ? "ledger-entry-paid" : ""}`}><span className={`ledger-pill ledger-pill-${pill}`}>{overdue ? "지연" : soon ? "임박" : ENTRY_STATUS_LABEL[entry.status]}</span><span className="ledger-entry-main">{entry.kind === "sale" && entry.sale_type && <em>{SALE_TYPE_LABEL[entry.sale_type]}</em>}<strong>{entry.title}</strong><small>{partnerName}</small></span><span className="ledger-due">{dateEditing ? <input type="date" autoFocus defaultValue={entry.due_date ?? ""} onBlur={event => onDateSave(event.target.value)} onKeyDown={event => { if (event.key === "Enter") onDateSave(event.currentTarget.value); }} /> : <button className="ghost ledger-date-button" onClick={onDateEdit}>{entry.due_date ?? "예정일 없음"}</button>}</span><strong className="ledger-amount">{formatKRW(entry.amount)}</strong><span className="ledger-mini-pill">{invoiceLabel(entry.invoice_status, entry.kind)}</span>{entry.status === "open" && <button onClick={() => onComplete(entry)}>✓ {entry.kind === "sale" ? "수금" : "지급"}</button>}<button className="ghost" onClick={onEdit}>✏️ 수정</button><button className="danger-ghost" onClick={() => onDelete(entry)}>🗑️ 삭제</button></div>; }
