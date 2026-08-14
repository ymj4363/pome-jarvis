import { useEffect, useRef, useState } from "react";
import { browseDir, fetchAgents, killAgent, runAgent, streamAgent } from "../services/agentService";
import type { AgentTask, LogEntry } from "../types";
import { AGENT_STATUS_LABEL, MAX_AGENTS, type ShowToast } from "../constants";

/* ── 에이전트 섹션 (로컬 전용): 실행 폼·목록·폴더 피커 모달 ──────── */

type Props = {
  agentServerOnline: boolean;
  agentServerInfo: { running: number; total: number; max: number } | null;
  showToast: ShowToast;
  addLog: (entry: Omit<LogEntry, "id" | "createdAt">) => void;
};

export default function AgentSection({ agentServerOnline, agentServerInfo, showToast, addLog }: Props) {

  /* ── 에이전트 ───────────────────────────────────────────────── */
  const [agents, setAgents] = useState<AgentTask[]>([]);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentWorkdir, setAgentWorkdir] = useState("D:\\py\\pome-jarvis");
  const [agentSkipPerms, setAgentSkipPerms] = useState(true);
  const [agentLaunching, setAgentLaunching] = useState(false);
  const [expandedAgentId, setExpandedAgentId] = useState<string | null>(null);
  const streamCleanups = useRef<Map<string, () => void>>(new Map());

  // 폴더 피커
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const [browseData, setBrowseData] = useState<{ path: string; parent: string | null; dirs: { name: string; path: string }[] } | null>(null);
  const [browseLoading, setBrowseLoading] = useState(false);

  useEffect(() => {
    if (!agentServerOnline) return;
    fetchAgents().then(list => {
      setAgents(list);
      for (const a of list) {
        if (a.status === "running" && !streamCleanups.current.has(a.id)) {
          attachStream(a.id);
        }
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentServerOnline]);

  const attachStream = (id: string) => {
    const cleanup = streamAgent(
      id,
      text => setAgents(prev => prev.map(a => a.id === id ? { ...a, output: a.output + text } : a)),
      code => {
        setAgents(prev => prev.map(a =>
          a.id === id ? { ...a, status: code === 0 ? "done" : code === null ? "killed" : "error", exitCode: code ?? undefined, completedAt: new Date().toISOString() } : a
        ));
        streamCleanups.current.delete(id);
      }
    );
    streamCleanups.current.set(id, cleanup);
  };

  const handleRunAgent = async () => {
    if (!agentPrompt.trim()) return;
    const runningCount = agents.filter(a => a.status === "running").length;
    if (runningCount >= MAX_AGENTS) { showToast(`최대 ${MAX_AGENTS}개까지 동시 실행 가능합니다.`, "error"); return; }
    setAgentLaunching(true);
    try {
      const { id } = await runAgent({ prompt: agentPrompt, workdir: agentWorkdir, skipPermissions: agentSkipPerms });
      const newAgent: AgentTask = {
        id, prompt: agentPrompt, workdir: agentWorkdir,
        skipPermissions: agentSkipPerms,
        status: "running", output: "",
        createdAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
      };
      setAgents(prev => [newAgent, ...prev]);
      setAgentPrompt("");
      setExpandedAgentId(id);
      attachStream(id);
      addLog({ action: "agent.started", detail: `에이전트 실행: "${agentPrompt.slice(0, 60)}…"`, status: "pending" });
      showToast("에이전트를 실행했습니다.", "success");
    } catch (err) {
      showToast(`실행 실패: ${err instanceof Error ? err.message : "오류"}`, "error");
    } finally {
      setAgentLaunching(false);
    }
  };

  const handleKillAgent = async (id: string) => {
    await killAgent(id);
    setAgents(prev => prev.map(a => a.id === id ? { ...a, status: "killed", completedAt: new Date().toISOString() } : a));
    streamCleanups.current.get(id)?.();
    streamCleanups.current.delete(id);
    addLog({ action: "agent.killed", detail: `에이전트 중단 (${id.slice(0, 8)})`, status: "failed" });
    showToast("에이전트를 중단했습니다.", "info");
  };

  const openFolderPicker = async () => {
    setShowFolderPicker(true);
    setBrowseLoading(true);
    try {
      const data = await browseDir("__drives__");
      setBrowseData(data);
    } catch { showToast("폴더 탐색 실패", "error"); }
    finally { setBrowseLoading(false); }
  };

  const navigateTo = async (path: string) => {
    setBrowseLoading(true);
    try {
      const data = await browseDir(path);
      setBrowseData(data);
    } catch { showToast("접근할 수 없는 폴더입니다.", "error"); }
    finally { setBrowseLoading(false); }
  };

  const selectFolder = (path: string) => {
    setAgentWorkdir(path);
    setShowFolderPicker(false);
    setBrowseData(null);
  };
  void selectFolder; // 원본부터 미사용이던 함수 — 순수 이동으로 보존

  const handleClearDoneAgents = () => {
    const toRemove = agents.filter(a => a.status !== "running").map(a => a.id);
    setAgents(prev => prev.filter(a => a.status === "running"));
    toRemove.forEach(id => { streamCleanups.current.get(id)?.(); streamCleanups.current.delete(id); });
  };

  return (
    <>
    <section className="panel section-agent" id="agent">
      <div className="section-head">
        <div>
          <p className="eyebrow">Claude Code CLI</p>
          <h2>에이전트 실행 관리</h2>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className={`agent-server-badge ${agentServerOnline ? "online" : "offline"}`}>
            {agentServerOnline ? `● 서버 연결됨 (${agentServerInfo?.running ?? 0}/${MAX_AGENTS} 실행 중)` : "○ 서버 오프라인"}
          </span>
          {agents.some(a => a.status !== "running") && (
            <button className="ghost" style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }} onClick={handleClearDoneAgents}>
              🗑️ 완료 정리
            </button>
          )}
        </div>
      </div>

      {!agentServerOnline && (
        <div className="notice" style={{ marginBottom: 16 }}>
          에이전트 서버가 오프라인입니다. CMD에서 <code style={{ background: "var(--ink-2)", padding: "1px 6px", borderRadius: 4, fontSize: 12 }}>npm run agent</code> 를 실행하세요.
        </div>
      )}

      {/* 실행 폼 */}
      <div className="agent-form">
        <div className="agent-form-header">
          <span className="agent-form-header-title">새 에이전트</span>
          <span className={`agent-form-header-count${agents.filter(a => a.status === "running").length >= MAX_AGENTS ? " full" : ""}`}>
            {agents.filter(a => a.status === "running").length} / {MAX_AGENTS} 실행 중
          </span>
        </div>
        <div className="agent-form-body">
          <div className="agent-form-field">
            <label className="agent-form-label">작업 폴더</label>
            <div className="agent-folder-row">
              <div className="agent-folder-display">
                <span>📁</span>
                {agentWorkdir
                  ? <span>{agentWorkdir}</span>
                  : <span className="agent-folder-placeholder">폴더를 선택하세요</span>}
              </div>
              <button className="ghost" onClick={openFolderPicker} disabled={!agentServerOnline} style={{ padding: "0 14px" }}>
                📂 찾아보기
              </button>
            </div>
          </div>
          <div className="agent-form-field">
            <label className="agent-form-label">지시 내용</label>
            <textarea
              placeholder="Claude Code에게 시킬 작업을 자연어로 입력하세요…"
              value={agentPrompt}
              onChange={e => setAgentPrompt(e.target.value)}
              style={{ minHeight: 100 }}
            />
          </div>
          <div className="agent-form-footer">
            <label className="agent-perm-label">
              <input type="checkbox" checked={agentSkipPerms} onChange={e => setAgentSkipPerms(e.target.checked)} style={{ accentColor: "var(--brand)", width: 15, height: 15 }} />
              권한 자동승인
            </label>
            <button
              disabled={!agentPrompt.trim() || !agentWorkdir || !agentServerOnline || agentLaunching || agents.filter(a => a.status === "running").length >= MAX_AGENTS}
              onClick={handleRunAgent}
            >
              {agentLaunching ? <><span className="spinner" />실행 중…</> : "🤖 에이전트 실행"}
            </button>
          </div>
        </div>
      </div>

      {/* 에이전트 목록 */}
      {agents.length === 0 ? (
        <div className="empty-state"><div className="empty-icon">🤖</div><p>실행 중인 에이전트가 없습니다.</p></div>
      ) : (
        <div className="agent-list">
          {agents.map(agent => (
            <div key={agent.id} className={`agent-card ${agent.status}`}>
              <div className="agent-card-header" onClick={() => setExpandedAgentId(id => id === agent.id ? null : agent.id)}>
                <span className="agent-card-icon">
                  {agent.status === "running" ? "⏳" : agent.status === "done" ? "✅" : agent.status === "error" ? "❌" : "⏹"}
                </span>
                <div className="agent-card-body">
                  <div className="agent-card-prompt">
                    {agent.prompt.slice(0, 80)}{agent.prompt.length > 80 ? "…" : ""}
                  </div>
                  <div className="agent-card-meta">
                    <span className="agent-card-path">📁 {agent.workdir}</span>
                    <span className={`agent-status-badge ${agent.status}`}>{AGENT_STATUS_LABEL[agent.status]}</span>
                  </div>
                </div>
                <div className="agent-card-actions">
                  {agent.status === "running" && (
                    <button className="agent-kill-btn" onClick={e => { e.stopPropagation(); handleKillAgent(agent.id); }}>
                      ⏹ 중단
                    </button>
                  )}
                  <span className="agent-card-chevron">{expandedAgentId === agent.id ? "▲" : "▼"}</span>
                </div>
              </div>
              {expandedAgentId === agent.id && (
                <pre className="agent-output">{agent.output || "(출력 없음)"}</pre>
              )}
            </div>
          ))}
        </div>
      )}
    </section>

    {/* ── 폴더 피커 모달 (윈도우 탐색기 스타일) ──────────────── */}
    {showFolderPicker && (
      <div className="modal-overlay" onClick={() => setShowFolderPicker(false)} role="dialog" aria-modal="true">
        <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 560, width: "95%", padding: 0, overflow: "hidden" }}>

          {/* 타이틀바 */}
          <div style={{ padding: "10px 16px", background: "#f3f3f3", borderBottom: "1px solid #ddd", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#333" }}>폴더 찾아보기</span>
            <button className="ghost" style={{ minHeight: 24, padding: "0 8px", fontSize: 13 }} onClick={() => setShowFolderPicker(false)}>✕</button>
          </div>

          {/* 주소창 */}
          <div style={{ padding: "8px 12px", background: "#fafafa", borderBottom: "1px solid #e5e5e5", display: "flex", alignItems: "center", gap: 6 }}>
            <button
              className="ghost"
              style={{ minHeight: 28, padding: "0 8px", fontSize: 13, flexShrink: 0 }}
              onClick={() => browseData?.parent && navigateTo(browseData.parent)}
              disabled={!browseData?.parent}
              title="상위 폴더"
            >↑</button>
            <div style={{
              flex: 1, padding: "5px 10px", background: "var(--white)",
              border: "1px solid #c0c0c0", borderRadius: 4,
              fontSize: 13, fontFamily: "monospace", color: "#333",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
            }}>
              {browseData?.path === "__drives__" ? "내 PC" : (browseData?.path ?? "")}
            </div>
          </div>

          {/* 폴더 목록 */}
          <div style={{ height: 360, overflowY: "auto", background: "var(--white)" }}>
            {browseLoading ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
                <span className="spinner" style={{ width: 22, height: 22, borderWidth: 3, borderColor: "rgba(0,0,0,.1)", borderTopColor: "var(--brand)" }} />
              </div>
            ) : browseData?.dirs.length === 0 ? (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--ink-4)", fontSize: 13 }}>
                하위 폴더가 없습니다.
              </div>
            ) : (
              browseData?.dirs.map(dir => (
                <div
                  key={dir.path}
                  onDoubleClick={() => navigateTo(dir.path)}
                  onClick={() => setAgentWorkdir(dir.path)}
                  style={{
                    padding: "7px 16px", display: "flex", alignItems: "center", gap: 10,
                    cursor: "pointer", borderBottom: "1px solid #f0f0f0",
                    background: agentWorkdir === dir.path ? "#cce5ff" : "transparent",
                    userSelect: "none",
                  }}
                  onMouseEnter={e => { if (agentWorkdir !== dir.path) e.currentTarget.style.background = "#f0f4ff"; }}
                  onMouseLeave={e => { if (agentWorkdir !== dir.path) e.currentTarget.style.background = "transparent"; }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ flexShrink: 0 }}>
                    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" fill="#FFB900" />
                  </svg>
                  <span style={{ fontSize: 13, color: "#222", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{dir.name}</span>
                </div>
              ))
            )}
          </div>

          {/* 하단 선택창 + 버튼 */}
          <div style={{ padding: "10px 16px", background: "#f3f3f3", borderTop: "1px solid #ddd", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ flex: 1, padding: "5px 10px", background: "var(--white)", border: "1px solid #c0c0c0", borderRadius: 4, fontSize: 13, fontFamily: "monospace", color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {agentWorkdir || "폴더를 선택하세요"}
            </div>
            <button className="ghost" onClick={() => setShowFolderPicker(false)} style={{ minHeight: 30, padding: "0 16px", fontSize: 13 }}>취소</button>
            <button onClick={() => { setShowFolderPicker(false); setBrowseData(null); }} style={{ minHeight: 30, padding: "0 16px", fontSize: 13 }} disabled={!agentWorkdir}>
              확인
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
