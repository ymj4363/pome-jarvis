import { useMemo, useState } from "react";
import {
  defaultMeetingText,
  initialApprovals,
  initialEvents,
  initialLogs,
  initialMails,
  initialTasks
} from "./data";
import { createReplyDraftApproval, decideApproval as decideApprovalState } from "./services/approvalService";
import { draftReply, extractMeetingActions } from "./services/assistantService";
import { createLog } from "./services/logService";
import type { Approval, LogEntry, Mail, Task } from "./types";
import { usePersistentState } from "./usePersistentState";

const labelText = {
  urgent: "긴급",
  reply_needed: "답장 필요",
  reference: "참고"
};

const riskText = {
  low: "낮음",
  medium: "중간",
  high: "높음"
};

export default function App() {
  const [mails] = useState<Mail[]>(initialMails);
  const [tasks, setTasks] = usePersistentState<Task[]>("pome.tasks", initialTasks);
  const [approvals, setApprovals] = usePersistentState<Approval[]>("pome.approvals", initialApprovals);
  const [logs, setLogs] = usePersistentState<LogEntry[]>("pome.logs", initialLogs);
  const [meetingText, setMeetingText] = usePersistentState("pome.meetingText", defaultMeetingText);
  const [draftMailId, setDraftMailId] = usePersistentState("pome.draftMailId", initialMails[1]?.id ?? "");
  const [assistantBusy, setAssistantBusy] = useState<"draft" | "meeting" | null>(null);

  const unreadImportant = useMemo(
    () => mails.filter(mail => mail.label !== "reference"),
    [mails]
  );
  const pendingApprovals = approvals.filter(item => item.status === "pending");
  const openTasks = tasks.filter(task => !task.done);

  const addLog = (entry: Omit<LogEntry, "id" | "createdAt">) => {
    setLogs(current => [createLog(entry), ...current]);
  };

  const createReplyDraft = async () => {
    const mail = mails.find(item => item.id === draftMailId);
    if (!mail) return;

    setAssistantBusy("draft");
    try {
      const result = await draftReply(mail);
      const approval = createReplyDraftApproval(mail, result);
      setApprovals(current => [approval, ...current]);
      addLog({
        action: "assistant.draft_reply",
        detail: `${mail.subject} 답장 초안을 생성하고 승인 대기함에 추가했습니다.`,
        status: "pending"
      });
    } finally {
      setAssistantBusy(null);
    }
  };

  const extractActions = async () => {
    setAssistantBusy("meeting");
    try {
      const result = await extractMeetingActions(meetingText);
      setTasks(current => [...result.tasks, ...current]);
      addLog({
        action: "assistant.extract_meeting_actions",
        detail: `회의록에서 액션 ${result.tasks.length}건을 추출했습니다.`,
        status: "success"
      });
    } finally {
      setAssistantBusy(null);
    }
  };

  const decideApproval = (approvalId: string, status: "approved" | "rejected") => {
    const item = approvals.find(approval => approval.id === approvalId);
    if (!item) return;

    setApprovals(current => decideApprovalState(current, approvalId, status));
    addLog({
      action: status === "approved" ? "approval.approved" : "approval.rejected",
      detail: `${item.title} 항목을 ${status === "approved" ? "승인" : "거절"}했습니다.`,
      status: status === "approved" ? "success" : "rejected"
    });
  };

  const toggleTask = (taskId: string) => {
    setTasks(current =>
      current.map(task => (task.id === taskId ? { ...task, done: !task.done } : task))
    );
  };

  const resetDemoState = () => {
    setTasks(initialTasks);
    setApprovals(initialApprovals);
    setLogs(initialLogs);
    setMeetingText(defaultMeetingText);
    setDraftMailId(initialMails[1]?.id ?? "");
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div>
            <strong>Pome Jarvis</strong>
            <span>승인형 개인 운영비서</span>
          </div>
        </div>
        <nav className="nav-list" aria-label="주요 화면">
          <a href="#briefing">오늘의 운영판</a>
          <a href="#mail">이메일 요약</a>
          <a href="#meeting">회의록 액션</a>
          <a href="#approval">승인 대기함</a>
          <a href="#log">실행 로그</a>
        </nav>
        <div className="sidebar-note">
          4주 MVP는 외부 서비스 완전 연동이 아니라 핵심 흐름 검증 데모입니다.
          <button className="reset-button" onClick={resetDemoState}>데모 초기화</button>
        </div>
      </aside>

      <main className="content">
        <header className="hero" id="briefing">
          <div>
            <p className="eyebrow">오늘의 운영판</p>
            <h1>중요한 일만 먼저 정리했습니다.</h1>
            <p>
              일정, 메일, 할 일을 한 화면에서 확인하고 실행이 필요한 항목은 승인 대기함에서 처리합니다.
            </p>
          </div>
          <div className="hero-metrics">
            <div><strong>{unreadImportant.length}</strong><span>중요 메일</span></div>
            <div><strong>{openTasks.length}</strong><span>열린 할 일</span></div>
            <div><strong>{pendingApprovals.length}</strong><span>승인 대기</span></div>
          </div>
        </header>

        <section className="grid three">
          <article className="panel">
            <h2>오늘 일정</h2>
            <div className="stack">
              {initialEvents.map(event => (
                <div className="row-item" key={event.id}>
                  <div>
                    <strong>{event.title}</strong>
                    <span>{event.location}</span>
                  </div>
                  <time>{event.time}</time>
                </div>
              ))}
            </div>
          </article>

          <article className="panel">
            <h2>추천 액션</h2>
            <div className="stack">
              <div className="notice urgent">서버 장애 메일을 우선 확인하세요.</div>
              <div className="notice">Q2 보고서 답장 초안을 승인 대기함에 추가할 수 있습니다.</div>
              <div className="notice">16:00 이후 집중 작업 시간이 비어 있습니다.</div>
            </div>
          </article>

          <article className="panel">
            <h2>열린 할 일</h2>
            <div className="stack">
              {openTasks.slice(0, 4).map(task => (
                <label className="task-row" key={task.id}>
                  <input type="checkbox" checked={task.done} onChange={() => toggleTask(task.id)} />
                  <span>{task.title}</span>
                </label>
              ))}
            </div>
          </article>
        </section>

        <section className="panel" id="mail">
          <div className="section-head">
            <div>
              <p className="eyebrow">이메일 요약</p>
              <h2>중요도와 다음 액션을 분류했습니다.</h2>
            </div>
            <div className="draft-control">
              <select value={draftMailId} onChange={event => setDraftMailId(event.target.value)}>
                {mails.map(mail => (
                  <option key={mail.id} value={mail.id}>{mail.subject}</option>
                ))}
              </select>
              <button disabled={assistantBusy === "draft"} onClick={createReplyDraft}>
                {assistantBusy === "draft" ? "초안 생성 중" : "답장 초안 만들기"}
              </button>
            </div>
          </div>
          <div className="mail-list">
            {mails.map(mail => (
              <article className={`mail-card ${mail.label}`} key={mail.id}>
                <div className="mail-topline">
                  <span className="pill">{labelText[mail.label]}</span>
                  <time>{mail.receivedAt}</time>
                </div>
                <h3>{mail.subject}</h3>
                <p>{mail.summary}</p>
                <small>{mail.sender}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="grid two" id="meeting">
          <article className="panel">
            <p className="eyebrow">회의록 액션 추출</p>
            <h2>텍스트 회의록에서 할 일을 뽑습니다.</h2>
            <textarea value={meetingText} onChange={event => setMeetingText(event.target.value)} />
            <button disabled={assistantBusy === "meeting"} onClick={extractActions}>
              {assistantBusy === "meeting" ? "추출 중" : "액션 추출"}
            </button>
          </article>

          <article className="panel">
            <h2>작업 목록</h2>
            <div className="stack">
              {tasks.slice(0, 7).map(task => (
                <div className={`task-card ${task.done ? "done" : ""}`} key={task.id}>
                  <button onClick={() => toggleTask(task.id)}>{task.done ? "완료" : "진행"}</button>
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.owner} · {task.due} · {task.source}</span>
                  </div>
                </div>
              ))}
            </div>
          </article>
        </section>

        <section className="panel" id="approval">
          <div className="section-head">
            <div>
              <p className="eyebrow">승인 대기함</p>
              <h2>실행 전 확인이 필요한 항목입니다.</h2>
            </div>
            <span className="counter">{pendingApprovals.length} pending</span>
          </div>
          <div className="approval-list">
            {approvals.map(approval => (
              <article className={`approval-card ${approval.status}`} key={approval.id}>
                <div>
                  <div className="mail-topline">
                    <span className="pill">{riskText[approval.risk]}</span>
                    <span>{approval.type}</span>
                  </div>
                  <h3>{approval.title}</h3>
                  <p>{approval.description}</p>
                  {approval.draft && (
                    <pre className="draft-preview">{approval.draft}</pre>
                  )}
                  {approval.evidence && approval.evidence.length > 0 && (
                    <ul className="evidence-list">
                      {approval.evidence.map(item => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  )}
                  <small>{approval.createdAt} · {approval.status}</small>
                </div>
                {approval.status === "pending" && (
                  <div className="approval-actions">
                    <button onClick={() => decideApproval(approval.id, "approved")}>승인</button>
                    <button className="ghost" onClick={() => decideApproval(approval.id, "rejected")}>거절</button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </section>

        <section className="panel" id="log">
          <p className="eyebrow">실행 로그</p>
          <h2>비서가 한 일을 기록합니다.</h2>
          <div className="log-list">
            {logs.map(log => (
              <div className={`log-row ${log.status}`} key={log.id}>
                <time>{log.createdAt}</time>
                <strong>{log.action}</strong>
                <span>{log.detail}</span>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

