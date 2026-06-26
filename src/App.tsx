import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { initialEvents, initialMails } from "./data";
import { createReplyDraftApproval, decideApproval as decideApprovalState } from "./services/approvalService";
import { draftReply, extractMeetingActions, fetchBriefing } from "./services/assistantService";
import { createCalendarEvent, deleteCalendarEvent, fetchCalendarEvents } from "./services/calendarService";
import { fetchGmailMessages, fetchMailBody, fetchMoreMails, markAsRead, saveDraft, trashMail } from "./services/gmailService";
import {
  getAuthState,
  handleOAuthCallback,
  hasClientId,
  logout,
  startOAuth,
  type AuthState
} from "./services/googleAuthService";
import { createLog } from "./services/logService";
import { browseDir, fetchAgentServerStatus, fetchAgents, killAgent, runAgent, streamAgent } from "./services/agentService";
import type { AgentTask, Approval, BriefingResult, CalendarEvent, CalendarEventData, LogEntry, Mail, Task } from "./types";
import { usePersistentState } from "./usePersistentState";

/* ── 상수 ───────────────────────────────────────────────────────── */

type Toast       = { id: string; message: string; type: "success" | "error" | "info" };
type MeetingMode = "text" | "file" | "voice";

const LABEL_TEXT: Record<string, string> = {
  urgent:       "긴급",
  reply_needed: "답장 필요",
  reference:    "참고"
};

const RISK_TEXT: Record<string, string> = {
  low:    "위험 낮음",
  medium: "위험 중간",
  high:   "위험 높음"
};

const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

const NAV_ITEMS = IS_LOCAL
  ? [{ id: "agent", icon: "🤖", label: "에이전트" }]
  : [
      { id: "briefing", icon: "📊", label: "운영판" },
      { id: "meeting",  icon: "📝",  label: "회의록" },
      { id: "mail",     icon: "✉️",  label: "메일" },
      { id: "approval", icon: "✅",  label: "승인" },
      { id: "agent",    icon: "🤖",  label: "에이전트" },
      { id: "log",      icon: "📋",  label: "로그" }
    ];

const MAX_AGENTS = 10;

const AGENT_STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  running: "실행 중",
  done:    "완료",
  error:   "오류",
  killed:  "중단됨",
};

const MEETING_TABS: { id: MeetingMode; icon: string; label: string }[] = [
  { id: "text",  icon: "📝", label: "텍스트" },
  { id: "file",  icon: "📎", label: "이미지·문서" },
  { id: "voice", icon: "🎤", label: "음성 인식" }
];

function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

/* ── 컴포넌트 ───────────────────────────────────────────────────── */

export default function App() {

  /* ── Core state ─────────────────────────────────────────────── */
  const [mails, setMails]   = useState<Mail[]>(initialMails);
  const [events, setEvents] = usePersistentState<CalendarEvent[]>("pome.events", initialEvents);
  const [tasks, setTasks]         = usePersistentState<Task[]>("pome.tasks", []);
  const [approvals, setApprovals] = usePersistentState<Approval[]>("pome.approvals", []);
  const [logs, setLogs]           = usePersistentState<LogEntry[]>("pome.logs", []);
  const [meetingText, setMeetingText] = usePersistentState("pome.meetingText", "");
  const [draftMailId, setDraftMailId] = usePersistentState("pome.draftMailId", "");

  const [assistantBusy, setAssistantBusy] = useState<"draft" | "meeting" | null>(null);
  const [auth, setAuth]               = useState<AuthState | null>(null);
  const [dataLoading, setDataLoading] = useState(false);
  const [toasts, setToasts]           = useState<Toast[]>([]);
  const [activeSection, setActiveSection] = useState("briefing");

  /* ── Mail modal ─────────────────────────────────────────────── */
  const [selectedMail, setSelectedMail]   = useState<Mail | null>(null);
  const [mailBody, setMailBody]           = useState("");
  const [mailBodyLoading, setMailBodyLoading] = useState(false);

  /* ── Mail pagination ────────────────────────────────────────── */
  const [nextPageToken, setNextPageToken]       = useState<string | null>(null);
  const [moreMailsLoading, setMoreMailsLoading] = useState(false);

  /* ── AI 브리핑 ──────────────────────────────────────────────── */
  const [briefing, setBriefing]               = useState<BriefingResult | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);

  /* ── Approval execution ─────────────────────────────────────── */
  const [executingApprovalId, setExecutingApprovalId] = useState<string | null>(null);

  /* ── 일정 추가 폼 ───────────────────────────────────────────── */
  const [showEventForm, setShowEventForm] = useState(false);
  const todayStr = new Date().toISOString().split("T")[0];
  const [eventForm, setEventForm] = useState({
    title: "", date: todayStr, startTime: "", endTime: "", location: "", allDay: false
  });

  /* ── 회의록 다중 입력 ────────────────────────────────────────── */
  const [meetingMode, setMeetingMode]             = useState<MeetingMode>("text");
  const [uploadedFileName, setUploadedFileName]   = useState("");
  const [uploadedFileData, setUploadedFileData]   = useState<{ data: string; mimeType: string } | null>(null);
  const [fileExtracting, setFileExtracting]       = useState(false);
  const [voiceRecording, setVoiceRecording]       = useState(false);
  const [voiceTranscript, setVoiceTranscript]     = useState("");
  const [voiceInterim, setVoiceInterim]           = useState("");
  const [voiceSupported, setVoiceSupported]       = useState(true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const manualStopRef = useRef(false);
  const restartTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 열린 할 일 전체 보기
  const [showAllOpenTasks, setShowAllOpenTasks] = useState(false);

  // 승인 대기함 접기/펼치기 + 처리 완료 토글
  const [collapsedApprovals, setCollapsedApprovals] = useState<Record<string, boolean>>({});
  const [showProcessed, setShowProcessed] = useState(false);

  // 실행 로그
  const [showLog, setShowLog] = useState(true);

  /* ── 에이전트 ───────────────────────────────────────────────── */
  const [agents, setAgents] = useState<AgentTask[]>([]);
  const [agentServerOnline, setAgentServerOnline] = useState(false);
  const [agentServerInfo, setAgentServerInfo] = useState<{ running: number; total: number; max: number } | null>(null);
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

  // 섹션 접기/펼치기
  const [showMails, setShowMails] = useState(true);
  const [showTasks, setShowTasks] = useState(true);

  // 할 일 직접 추가
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskDue,   setNewTaskDue]   = useState("");

  // 할 일 인라인 편집
  const [editingTaskId,    setEditingTaskId]    = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState("");
  const [editingTaskDue,   setEditingTaskDue]   = useState("");
  const [editingTaskOwner, setEditingTaskOwner] = useState("");

  const approvalRef      = useRef<HTMLElement>(null);
  const lastRefreshedAt  = useRef<number>(0);       // 마지막 데이터 갱신 시각 (ms)
  const REFRESH_COOLDOWN = 10 * 60 * 1000;          // 10분

  /* ── 파생 상태 ──────────────────────────────────────────────── */
  const unreadImportant    = useMemo(() => mails.filter(m => m.label !== "reference"), [mails]);
  const pendingApprovals   = approvals.filter(a => a.status === "pending");
  const processedApprovals = approvals.filter(a => a.status !== "pending");
  const openTasks          = tasks.filter(t => !t.done);

  /* ── Toast ──────────────────────────────────────────────────── */
  const showToast = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4200);
  }, []);

  /* ── 실제 데이터 로드 ───────────────────────────────────────── */
  const loadRealData = useCallback(async (accessToken: string, userName?: string) => {
    setDataLoading(true);
    setBriefing(null);
    try {
      const [gmailResult, calendarResult] = await Promise.allSettled([
        fetchGmailMessages(accessToken),
        fetchCalendarEvents(accessToken)
      ]);

      let loadedMails:  Mail[]           = mails;
      let loadedEvents: CalendarEvent[]  = events;
      let loaded = 0;

      if (gmailResult.status === "fulfilled") {
        setMails(gmailResult.value.mails);
        setNextPageToken(gmailResult.value.nextPageToken ?? null);
        loadedMails = gmailResult.value.mails;
        loaded++;
      } else {
        showToast("Gmail 메일을 불러오지 못했습니다.", "error");
      }

      if (calendarResult.status === "fulfilled") {
        setEvents(calendarResult.value);
        loadedEvents = calendarResult.value;
        loaded++;
      } else {
        showToast("캘린더 일정을 불러오지 못했습니다.", "error");
      }

      if (loaded > 0) {
        showToast(
          `실제 데이터 연동 완료 (Gmail${gmailResult.status === "fulfilled" ? " ✓" : " ✗"}, 캘린더${calendarResult.status === "fulfilled" ? " ✓" : " ✗"})`,
          "success"
        );
        setBriefingLoading(true);
        fetchBriefing(loadedMails, loadedEvents, userName)
          .then(result => setBriefing(result))
          .finally(() => setBriefingLoading(false));
      }
    } finally {
      setDataLoading(false);
      lastRefreshedAt.current = Date.now();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

  /* ── OAuth 콜백 & 세션 복원 ─────────────────────────────────── */
  useEffect(() => {
    const url   = new URL(window.location.href);
    const code  = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (code || error) window.history.replaceState({}, "", window.location.pathname);
    if (error) { showToast("구글 로그인이 취소되었습니다.", "info"); return; }

    const resetMeeting = () => {
      setMeetingText(""); setMeetingMode("text");
      setUploadedFileName(""); setUploadedFileData(null);
      setVoiceTranscript(""); setVoiceInterim("");
      recognitionRef.current?.stop(); recognitionRef.current = null;
      setVoiceRecording(false);
    };

    if (code && state) {
      handleOAuthCallback(code, state)
        .then(newAuth => {
          setAuth(newAuth);
          resetMeeting();
          return loadRealData(newAuth.accessToken, newAuth.user.name);
        })
        .catch(() => showToast("구글 로그인에 실패했습니다. 다시 시도해 주세요.", "error"));
      return;
    }

    const existing = getAuthState();
    if (existing) { setAuth(existing); resetMeeting(); loadRealData(existing.accessToken, existing.user.name); }
  }, [loadRealData, showToast]);

  /* ── 활성 섹션 추적 (로컬: 스크롤 감지 / 배포: 클릭 전환) ───── */
  useEffect(() => {
    if (!IS_LOCAL) return;
    const elements = NAV_ITEMS
      .map(n => document.getElementById(n.id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;
    const observer = new IntersectionObserver(
      entries => { const v = entries.find(e => e.isIntersecting); if (v) setActiveSection(v.target.id); },
      { rootMargin: "-15% 0px -70% 0px" }
    );
    elements.forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  /* ── ESC 키 ─────────────────────────────────────────────────── */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleCloseMail(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ── 음성 탭 이탈 시 중지 ───────────────────────────────────── */
  useEffect(() => {
    if (meetingMode !== "voice" && voiceRecording) stopVoiceRecognition();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meetingMode]);

  /* ── 에이전트 서버 상태 폴링 ───────────────────────────────── */
  useEffect(() => {
    const check = async () => {
      const status = await fetchAgentServerStatus();
      setAgentServerOnline(!!status);
      setAgentServerInfo(status);
    };
    check();
    const t = setInterval(check, 5000);
    return () => clearInterval(t);
  }, []);

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

  const handleClearDoneAgents = () => {
    const toRemove = agents.filter(a => a.status !== "running").map(a => a.id);
    setAgents(prev => prev.filter(a => a.status === "running"));
    toRemove.forEach(id => { streamCleanups.current.get(id)?.(); streamCleanups.current.delete(id); });
  };

  /* ── 탭 복귀 시 자동 새로고침 (10분 쿨다운) ─────────────────── */
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== "visible") return;
      if (!auth) return;
      if (Date.now() - lastRefreshedAt.current < REFRESH_COOLDOWN) return;
      loadRealData(auth.accessToken, auth.user.name);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth, loadRealData]);

  /* ── 공통 핸들러 ────────────────────────────────────────────── */
  const addLog = (entry: Omit<LogEntry, "id" | "createdAt">) =>
    setLogs(current => [createLog(entry), ...current]);

  const handleLogin  = () => startOAuth().catch(() => showToast("로그인 시작에 실패했습니다.", "error"));
  const handleLogout = () => {
    logout(); setAuth(null); setMails(initialMails); setEvents(initialEvents);
    setNextPageToken(null); setBriefing(null);
    showToast("로그아웃했습니다.", "info");
  };
  const handleRefreshData = () => { if (auth) loadRealData(auth.accessToken, auth.user.name); };

  /* ── 메일 모달 ──────────────────────────────────────────────── */
  const handleMailClick = async (mail: Mail) => {
    setSelectedMail(mail); setMailBody("");
    if (auth) {
      setMailBodyLoading(true);
      // 본문 로드 + 읽음 처리 병렬 실행
      const [bodyResult] = await Promise.allSettled([
        fetchMailBody(auth.accessToken, mail.id),
        markAsRead(auth.accessToken, mail.id)
          .then(() => setMails(current => current.filter(m => m.id !== mail.id)))
          .catch(() => {/* 읽음 처리 실패는 무시 */})
      ]);
      setMailBodyLoading(false);
      setMailBody(
        bodyResult.status === "fulfilled"
          ? (bodyResult.value || mail.summary)
          : (mail.body || mail.summary || "본문을 불러오지 못했습니다.")
      );
    } else {
      setMailBody(mail.body || mail.summary);
    }
  };
  const handleCloseMail = () => { setSelectedMail(null); setMailBody(""); };

  /* ── 메일 삭제 (Gmail 휴지통) ───────────────────────────────── */
  const handleTrashMail = async (e: React.MouseEvent, mail: Mail) => {
    e.stopPropagation(); // 모달 열림 방지
    setMails(current => current.filter(m => m.id !== mail.id)); // 즉시 UI에서 제거
    if (auth) {
      try {
        await trashMail(auth.accessToken, mail.id);
        showToast("메일을 휴지통으로 이동했습니다.", "info");
        addLog({ action: "mail.trashed", detail: `"${mail.subject}" 를 휴지통으로 이동.`, status: "success" });
      } catch (err) {
        setMails(current => [mail, ...current]); // 실패 시 복원
        showToast(`삭제 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`, "error");
      }
    } else {
      showToast("메일을 숨겼습니다. (데모 모드)", "info");
    }
  };

  /* ── 더 보기 ────────────────────────────────────────────────── */
  const handleLoadMoreMails = async () => {
    if (!auth || !nextPageToken) return;
    setMoreMailsLoading(true);
    try {
      const result = await fetchMoreMails(auth.accessToken, nextPageToken);
      setMails(current => [...current, ...result.mails]);
      setNextPageToken(result.nextPageToken ?? null);
    } catch { showToast("추가 메일을 불러오지 못했습니다.", "error"); }
    finally { setMoreMailsLoading(false); }
  };

  /* ── 일정 취소 ─────────────────────────────────────────────── */
  const handleDeleteEvent = async (event: CalendarEvent) => {
    setEvents(current => current.filter(e => e.id !== event.id));
    if (auth) {
      try {
        await deleteCalendarEvent(auth.accessToken, event.id);
        showToast(`"${event.title}" 일정을 취소했습니다.`, "info");
        addLog({ action: "calendar.deleted", detail: `"${event.title}" 일정 취소.`, status: "success" });
      } catch (err) {
        setEvents(current => [event, ...current]);
        showToast(`일정 취소 실패: ${err instanceof Error ? err.message : "오류"}`, "error");
      }
    } else {
      showToast(`"${event.title}" 일정을 숨겼습니다. (데모 모드)`, "info");
    }
  };

  /* ── 할 일 개별 삭제 ────────────────────────────────────────── */
  const handleDeleteTask = (taskId: string, title: string) => {
    setTasks(current => current.filter(t => t.id !== taskId));
    addLog({ action: "task.deleted", detail: `"${title}" 할 일을 삭제했습니다.`, status: "success" });
    showToast(`할 일을 삭제했습니다.`, "info");
  };

  /* ── 할 일 편집 ─────────────────────────────────────────────── */
  const startEditTask = (task: Task) => {
    setEditingTaskId(task.id);
    setEditingTaskTitle(task.title);
    setEditingTaskDue(task.due === "미정" ? "" : task.due);
    setEditingTaskOwner(task.owner);
  };
  const commitEditTask = (taskId: string) => {
    const trimmed = editingTaskTitle.trim();
    if (trimmed) setTasks(current => current.map(t =>
      t.id === taskId ? { ...t, title: trimmed, due: editingTaskDue.trim() || "미정", owner: editingTaskOwner.trim() || t.owner } : t
    ));
    setEditingTaskId(null);
    setEditingTaskTitle("");
    setEditingTaskDue("");
    setEditingTaskOwner("");
  };
  const cancelEditTask = () => {
    setEditingTaskId(null);
    setEditingTaskTitle("");
    setEditingTaskDue("");
    setEditingTaskOwner("");
  };

  /* ── 할 일 상단 고정 ─────────────────────────────────────────── */
  const handlePinTask = (taskId: string) => {
    setTasks(current => current.map(t => t.id === taskId ? { ...t, pinned: !t.pinned } : t));
  };

  /* ── 일정 추가 (승인 대기함 경유) ───────────────────────────── */
  const handleAddEventApproval = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventForm.title || !eventForm.date) return;
    if (!eventForm.allDay && (!eventForm.startTime || !eventForm.endTime)) return;

    // 종일 일정이면 날짜만, 아니면 ISO datetime 문자열
    const calendarEventData: CalendarEventData = eventForm.allDay
      ? {
          title:         eventForm.title,
          startDateTime: eventForm.date,
          endDateTime:   eventForm.date,
          allDay:        true,
          location:      eventForm.location || undefined,
          timeZone:      "Asia/Seoul"
        }
      : {
          title:         eventForm.title,
          startDateTime: `${eventForm.date}T${eventForm.startTime}:00`,
          endDateTime:   `${eventForm.date}T${eventForm.endTime}:00`,
          location:      eventForm.location || undefined,
          timeZone:      "Asia/Seoul"
        };

    const timeDesc = eventForm.allDay
      ? "시간 미정"
      : `${eventForm.startTime} ~ ${eventForm.endTime}`;

    const approval: Approval = {
      id:          crypto.randomUUID(),
      type:        "calendar_change",
      title:       `📅 ${eventForm.title}`,
      description: `${eventForm.date} ${timeDesc}${eventForm.location ? ` · ${eventForm.location}` : ""}`,
      risk:        "low",
      createdAt:   "방금 전",
      status:      "pending",
      calendarEventData
    };

    setApprovals(current => [approval, ...current]);
    setShowEventForm(false);
    setEventForm({ title: "", date: todayStr, startTime: "", endTime: "", location: "", allDay: false });
    showToast("일정 추가 요청을 승인 대기함에 추가했습니다.", "success");
    addLog({ action: "calendar.draft", detail: `"${eventForm.title}" 일정 추가 요청 생성.`, status: "pending" });
    setTimeout(() => approvalRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
  };

  /* ── 답장 초안 생성 ─────────────────────────────────────────── */
  const createReplyDraft = async () => {
    const mail = mails.find(m => m.id === draftMailId);
    if (!mail) return;
    setAssistantBusy("draft");
    try {
      const result   = await draftReply(mail);
      const approval = createReplyDraftApproval(mail, result);
      setApprovals(current => [approval, ...current]);
      addLog({ action: "assistant.draft_reply", detail: `${mail.subject} 답장 초안 생성.`, status: "pending" });
      showToast("답장 초안을 승인 대기함에 추가했습니다.", "success");
      setTimeout(() => approvalRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 300);
    } finally { setAssistantBusy(null); }
  };

  /* ── 파일 업로드 ────────────────────────────────────────────── */
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { showToast("파일 크기는 10MB 이하만 지원합니다.", "error"); return; }

    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = evt => {
      const result = (evt.target?.result as string) ?? "";
      const [header, data] = result.split(",");
      const mimeType = header.split(":")[1]?.split(";")[0] ?? file.type;
      setUploadedFileData({ data, mimeType });
    };
    reader.readAsDataURL(file);
  };

  /* ── 음성 인식 ──────────────────────────────────────────────── */
  const startVoiceRecognitionInternal = (isRestart: boolean = false) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) { setVoiceSupported(false); showToast("이 브라우저는 음성 인식을 지원하지 않습니다. Chrome을 사용해 주세요.", "error"); return; }

    // 이전 인스턴스 핸들러 제거 후 정리
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      try { recognitionRef.current.stop(); } catch {}
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new SpeechRecognitionAPI() as any;
    recognition.lang = "ko-KR";
    recognition.continuous = true;
    recognition.interimResults = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let finalText = "";
      let interimText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t;
        else interimText += t;
      }
      if (finalText) setVoiceTranscript(prev => prev + (prev ? " " : "") + finalText);
      setVoiceInterim(interimText);
    };

    recognition.onerror = (e: any) => {
      if (e.error === "not-allowed") {
        showToast("마이크 권한이 거부되었습니다. 브라우저 설정에서 허용해주세요.", "error");
        manualStopRef.current = true;
      }
      // 네트워크/묵음 오류는 onend에서 자동 재시작
    };

    recognition.onend = () => {
      recognitionRef.current = null;
      if (manualStopRef.current) {
        setVoiceRecording(false);
        setVoiceInterim("");
        return;
      }
      // 묵음/네트워크 종료 시 즉시 재시작 (recording 상태 유지)
      if (restartTimerRef.current) clearTimeout(restartTimerRef.current);
      restartTimerRef.current = setTimeout(() => {
        if (!manualStopRef.current) startVoiceRecognitionInternal(true);
      }, 0);
    };

    recognition.start();
    recognitionRef.current = recognition;
    if (!isRestart) setVoiceRecording(true);
  };

  const startVoiceRecognition = () => {
    manualStopRef.current = false;
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    startVoiceRecognitionInternal(false);
  };

  const stopVoiceRecognition = () => {
    manualStopRef.current = true;
    if (restartTimerRef.current) { clearTimeout(restartTimerRef.current); restartTimerRef.current = null; }
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
      try { recognitionRef.current.stop(); } catch {}
      recognitionRef.current = null;
    }
    setVoiceRecording(false);
    setVoiceInterim("");
  };

  /* ── 회의록 입력 초기화 (작업 목록은 유지) ──────────────────── */
  const resetMeetingInput = () => {
    if (voiceRecording) stopVoiceRecognition();
    setMeetingText("");
    setUploadedFileName("");
    setUploadedFileData(null);
    setVoiceTranscript("");
    setVoiceInterim("");
    setMeetingMode("text");
    showToast("회의록 입력을 초기화했습니다. 작업 목록은 유지됩니다.", "info");
  };

  /* ── 회의록 액션 추출 ───────────────────────────────────────── */
  const extractActions = async () => {
    setAssistantBusy("meeting");
    try {
      let textToProcess = meetingText;

      if (meetingMode === "file" && uploadedFileData) {
        setFileExtracting(true);
        try {
          const res = await fetch("/api/assistant/extract-from-file", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(uploadedFileData)
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ error: "알 수 없는 오류" })) as { error?: string };
            throw new Error(err.error ?? `파일 처리 실패: ${res.status}`);
          }
          const data = await res.json() as { meetingText: string };
          textToProcess = data.meetingText;
          setMeetingText(textToProcess);
          setMeetingMode("text");
          showToast("파일에서 텍스트를 추출했습니다.", "success");
        } finally { setFileExtracting(false); }
      } else if (meetingMode === "voice") {
        textToProcess = voiceTranscript;
        if (voiceRecording) stopVoiceRecognition();
      }

      if (!textToProcess.trim()) { showToast("처리할 내용이 없습니다.", "info"); return; }

      const result = await extractMeetingActions(textToProcess);
      setTasks(current => [...result.tasks, ...current]);
      addLog({ action: "assistant.extract_meeting_actions", detail: `회의록에서 액션 ${result.tasks.length}건을 추출했습니다.`, status: "success" });
      showToast(`액션 ${result.tasks.length}건을 추출했습니다.`, "success");
    } catch (err) {
      showToast(`추출 실패: ${err instanceof Error ? err.message : "알 수 없는 오류"}`, "error");
    } finally { setAssistantBusy(null); }
  };

  /* ── 승인 결정 ──────────────────────────────────────────────── */
  const decideApproval = async (approvalId: string, status: "approved" | "rejected") => {
    const item = approvals.find(a => a.id === approvalId);
    if (!item) return;

    setApprovals(current => decideApprovalState(current, approvalId, status));
    addLog({
      action: status === "approved" ? "approval.approved" : "approval.rejected",
      detail: `${item.title} 항목을 ${status === "approved" ? "승인" : "거절"}했습니다.`,
      status: status === "approved" ? "success" : "rejected"
    });
    showToast(
      status === "approved" ? `"${item.title}" 승인했습니다.` : `"${item.title}" 거절했습니다.`,
      status === "approved" ? "success" : "info"
    );

    if (status !== "approved" || !auth) return;

    setExecutingApprovalId(approvalId);
    try {
      if (item.type === "email_send" && item.recipientEmail && item.draft) {
        await saveDraft(auth.accessToken, item.recipientEmail, item.replySubject ?? item.title, item.draft);
        showToast(`📝 Gmail 임시저장 완료 — Gmail에서 최종 발송하세요.`, "success");
        addLog({ action: "email.draft_saved", detail: `"${item.replySubject ?? item.title}" 임시저장 완료 (수신: ${item.recipientEmail}).`, status: "success" });
      } else if (item.type === "calendar_change" && item.calendarEventData) {
        await createCalendarEvent(auth.accessToken, item.calendarEventData);
        showToast(`📅 일정 생성 완료: ${item.calendarEventData.title}`, "success");
        addLog({ action: "calendar.created", detail: `"${item.calendarEventData.title}" 일정 추가 완료.`, status: "success" });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "알 수 없는 오류";
      showToast(`실행 실패: ${msg}`, "error");
      addLog({ action: "execution.failed", detail: `${item.title} 실행 실패: ${msg}`, status: "failed" });
    } finally { setExecutingApprovalId(null); }
  };

  const updateApprovalDraft = (approvalId: string, newDraft: string) =>
    setApprovals(current => current.map(a => a.id === approvalId ? { ...a, draft: newDraft } : a));

  const toggleApprovalCollapse = (id: string) =>
    setCollapsedApprovals(prev => ({ ...prev, [id]: !prev[id] }));

  const handleAddTask = () => {
    const title = newTaskTitle.trim();
    if (!title) return;
    const task: Task = {
      id:     crypto.randomUUID(),
      title,
      owner:  auth?.user.name ?? "나",
      due:    newTaskDue || "미정",
      source: "manual",
      done:   false
    };
    setTasks(current => [task, ...current]);
    setNewTaskTitle("");
    setNewTaskDue("");
    addLog({ action: "task.added", detail: `"${title}" 할 일을 추가했습니다.`, status: "success" });
  };

  const toggleTask = (taskId: string) => {
    setTasks(current => current.map(t => {
      if (t.id !== taskId) return t;
      const next = { ...t, done: !t.done };
      addLog({
        action: next.done ? "task.completed" : "task.reopened",
        detail: `"${t.title}" 를 ${next.done ? "완료" : "미완료"}로 변경했습니다.`,
        status: next.done ? "success" : "pending"
      });
      return next;
    }));
  };

  const resetAllData = () => {
    if (!window.confirm("승인함·실행 로그·회의록 입력을 초기화합니다.\n할 일 목록은 유지됩니다. 계속할까요?")) return;
    setApprovals([]); setLogs([]);
    setMeetingText(""); setDraftMailId("");
    if (!auth) { setMails(initialMails); setEvents(initialEvents); }
    showToast("데이터를 초기화했습니다. (할 일 목록은 유지)", "info");
  };

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div className="app-shell">

      {/* ── Sidebar ────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div>
            <strong>Pome Jarvis</strong>
            <span>{IS_LOCAL ? "에이전트 모드" : "승인형 개인 운영비서"}</span>
          </div>
        </div>

        <p className="nav-label">메뉴</p>
        <nav className="nav-list" aria-label="주요 화면">
          {NAV_ITEMS.map(item => {
            const badge =
              item.id === "approval" && pendingApprovals.length > 0 ? { count: pendingApprovals.length, color: "danger" } :
              item.id === "mail"     && auth && mails.length > 0     ? { count: mails.length,            color: "brand" }  :
              item.id === "meeting"  && openTasks.length > 0         ? { count: openTasks.length,         color: "warning" } :
              null;
            return (
              <a
                key={item.id}
                href={IS_LOCAL ? `#${item.id}` : undefined}
                className={activeSection === item.id ? "active" : ""}
                onClick={!IS_LOCAL ? (e) => { e.preventDefault(); setActiveSection(item.id); } : undefined}
                style={{ cursor: "pointer" }}
              >
                <span className="nav-icon">{item.icon}</span>
                <span className="nav-label-text">{item.id === "meeting" ? "회의록·할일" : item.label}</span>
                {badge && (
                  <span className={`nav-badge nav-badge-${badge.color}`}>{badge.count}</span>
                )}
              </a>
            );
          })}
        </nav>

        {/* 로컬 전용: 사용 순서 + 상황별 동작 */}
        {IS_LOCAL && (
          <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 16, padding: "0 2px" }}>

            <div>
              <p className="agent-section-label">사용 순서</p>
              <div className="agent-steps">
                {[
                  { step: "1", label: "npm run dev", done: true },
                  { step: "2", label: "npm run agent", done: agentServerOnline },
                  { step: "3", label: "작업 경로 입력", done: false },
                  { step: "4", label: "지시 내용 작성", done: false },
                  { step: "5", label: "에이전트 실행", done: false },
                  { step: "6", label: "결과 확인", done: false },
                ].map(({ step, label, done }) => (
                  <div key={step} className={`agent-step${done ? " done" : ""}`}>
                    <span className="agent-step-num">{done ? "✓" : step}</span>
                    <span className="agent-step-label">{label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="agent-section-label">상황별 동작</p>
              <div className="agent-situation">
                {([
                  ["탭 닫음", true],
                  ["브라우저 종료", true],
                  ["PC 절전", true],
                  ["agent 종료", false],
                  ["PC 종료", false],
                ] as [string, boolean][]).map(([label, ok]) => (
                  <div key={label} className="agent-situation-row">
                    <span className="agent-situation-label">{label}</span>
                    <span className={`agent-situation-badge ${ok ? "ok" : "bad"}`}>{ok ? "계속" : "중단"}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>
        )}


      </aside>

      {/* ── Content ────────────────────────────────────────────── */}
      <main className="content">

        {/* ── Topbar ───────────────────────────────────────────── */}
        <div className="topbar">
          <span className="topbar-brand">
            <div className="brand-mark" style={{ width: 26, height: 26, fontSize: 13 }}>P</div>
            Pome Jarvis
            {!auth && <span style={{ fontSize: 11, fontWeight: 500, color: "var(--ink-5)", marginLeft: 4 }}>{IS_LOCAL ? "에이전트 모드" : "데모 모드"}</span>}
          </span>
          {auth ? (
            <>
              <button className="ghost" style={{ minHeight: 34, padding: "0 12px", fontSize: 13 }} onClick={handleRefreshData} disabled={dataLoading}>
                {dataLoading ? <span className="spinner" /> : "🔄"} 새로고침
              </button>
              <div className="topbar-user">
                <img src={auth.user.picture} alt={auth.user.name} className="user-avatar" referrerPolicy="no-referrer" />
                <strong>{auth.user.name}</strong>
              </div>
              <button className="ghost" style={{ minHeight: 34, padding: "0 12px", fontSize: 13 }} onClick={handleLogout}>
                로그아웃
              </button>
            </>
          ) : (
            <>
              {hasClientId() && (
                <button
                  style={{ background: "var(--white)", color: "var(--ink-7)", boxShadow: "inset 0 0 0 1px var(--ink-3)", fontSize: 13, fontWeight: 600, minHeight: 34, padding: "0 14px" }}
                  onClick={handleLogin}
                >
                  <GoogleIcon /> 구글 계정 연동
                </button>
              )}
              <button className="ghost" style={{ minHeight: 34, padding: "0 12px", fontSize: 13 }} onClick={resetAllData}>
                🔄 초기화
              </button>
            </>
          )}
        </div>

        {dataLoading && <div className="data-loading-bar" />}

        {!IS_LOCAL && (<>
        {activeSection === "briefing" && <header className="hero" id="briefing">
          <div className="hero-text">
            <p className="eyebrow">{auth ? `${auth.user.name}님의 운영판` : "오늘의 운영판"}</p>
            <h1>중요한 일만<br />먼저 정리했습니다.</h1>
            <p>일정, 메일, 할 일을 한 화면에서 확인하고<br />실행이 필요한 항목은 승인 대기함에서 처리합니다.</p>
          </div>
          <div className="hero-metrics">
            <div className="hero-metric"><strong>{unreadImportant.length}</strong><span>중요 메일</span></div>
            <div className="hero-metric"><strong>{openTasks.length}</strong><span>열린 할 일</span></div>
            <div className="hero-metric"><strong>{pendingApprovals.length}</strong><span>승인 대기</span></div>
          </div>
        </header>}

        {activeSection === "briefing" && <section className="grid two">

          {/* 오늘 일정 + 추가 폼 */}
          <article className="panel panel-calendar">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
              <h2>오늘 일정</h2>
              <button
                className="ghost"
                style={{ minHeight: 28, padding: "0 10px", fontSize: 12, fontWeight: 600 }}
                onClick={() => setShowEventForm(f => !f)}
              >
                {showEventForm ? "취소" : "+ 일정 추가"}
              </button>
            </div>

            {showEventForm && (
              <form className="event-form" onSubmit={handleAddEventApproval}>
                <input
                  type="text" placeholder="일정 제목 *" required
                  value={eventForm.title}
                  onChange={e => setEventForm(f => ({ ...f, title: e.target.value }))}
                />
                <input
                  type="date" required
                  value={eventForm.date}
                  onChange={e => setEventForm(f => ({ ...f, date: e.target.value }))}
                />
                <label className="event-form-allday">
                  <input
                    type="checkbox"
                    checked={eventForm.allDay}
                    onChange={e => setEventForm(f => ({ ...f, allDay: e.target.checked, startTime: "", endTime: "" }))}
                    style={{ accentColor: "var(--brand)", width: 14, height: 14, cursor: "pointer" }}
                  />
                  <span>시간 미정 (종일 일정)</span>
                </label>
                {!eventForm.allDay && (
                  <div className="event-form-times">
                    <input type="time" required value={eventForm.startTime}
                      onChange={e => setEventForm(f => ({ ...f, startTime: e.target.value }))} />
                    <span>~</span>
                    <input type="time" required value={eventForm.endTime}
                      onChange={e => setEventForm(f => ({ ...f, endTime: e.target.value }))} />
                  </div>
                )}
                <input
                  type="text" placeholder="장소 (선택)"
                  value={eventForm.location}
                  onChange={e => setEventForm(f => ({ ...f, location: e.target.value }))}
                />
                <button type="submit" style={{ width: "100%", marginTop: 4 }}>
                  📅 승인 대기함에 추가
                </button>
              </form>
            )}

            {events.length === 0 && !showEventForm ? (
              <div className="empty-state"><div className="empty-icon">📅</div><p>오늘 일정이 없습니다.</p></div>
            ) : (
              <div className="stack">
                {events.map(event => (
                  <div className="row-item" key={event.id}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>{event.title}</strong>
                      {event.location && <span>{event.location}</span>}
                    </div>
                    <time style={{ flexShrink: 0 }}>
                      {event.time || <span className="badge-allday">시간 미정</span>}
                    </time>
                    <button
                      className="mail-trash-btn"
                      style={{ flexShrink: 0 }}
                      onClick={() => handleDeleteEvent(event)}
                      title="일정 취소"
                      aria-label="일정 취소"
                    >
                      🗑️
                    </button>
                  </div>
                ))}
              </div>
            )}
          </article>

          {/* AI 브리핑 / 추천 액션 */}
          <article className="panel panel-briefing">
            <h2 style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {briefing ? "AI 브리핑" : "추천 액션"}
              {briefingLoading && <span className="spinner" style={{ borderColor: "rgba(0,0,0,.12)", borderTopColor: "var(--brand)", width: 13, height: 13 }} />}
            </h2>
            {briefing ? (
              <div className="stack">
                <p className="briefing-summary">{briefing.summary}</p>
                {briefing.highlights.length > 0 && (
                  <div className="briefing-section">
                    <strong className="briefing-label">📌 주요 포인트</strong>
                    <ul className="briefing-list">{briefing.highlights.map((h, i) => <li key={i}>{h}</li>)}</ul>
                  </div>
                )}
                {briefing.actions.length > 0 && (
                  <div className="briefing-section">
                    <strong className="briefing-label">⚡ 권장 액션</strong>
                    <ul className="briefing-list">{briefing.actions.map((a, i) => <li key={i}>{a}</li>)}</ul>
                  </div>
                )}
              </div>
            ) : !briefingLoading && (
              <div className="stack">
                {unreadImportant.filter(m => m.label === "urgent").length > 0 && (
                  <div className="notice urgent">긴급 메일 {unreadImportant.filter(m => m.label === "urgent").length}건을 확인하세요.</div>
                )}
                {unreadImportant.filter(m => m.label === "reply_needed").length > 0 && (
                  <div className="notice">답장 필요한 메일 {unreadImportant.filter(m => m.label === "reply_needed").length}건이 있습니다.</div>
                )}
                {pendingApprovals.length > 0 && <div className="notice">승인 대기함에 {pendingApprovals.length}건이 있습니다.</div>}
                {unreadImportant.length === 0 && pendingApprovals.length === 0 && <div className="notice">오늘 중요한 메일이나 대기 항목이 없습니다. 👍</div>}
              </div>
            )}
          </article>

        </section>}

        {activeSection === "meeting" && <section className="grid two section-meeting" id="meeting">
          <article className="panel">
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
              <div>
                <p className="eyebrow">회의록 액션 추출</p>
                <h2>회의록에서 할 일을 추출합니다.</h2>
              </div>
              <button
                className="ghost"
                style={{ minHeight: 28, padding: "0 10px", fontSize: 12, flexShrink: 0, marginTop: 2 }}
                onClick={resetMeetingInput}
                title="입력만 초기화 — 작업 목록은 그대로 유지됩니다"
              >
                🗑️ 입력 초기화
              </button>
            </div>

            {/* 입력 방식 탭 */}
            <div className="meeting-tabs">
              {MEETING_TABS.map(tab => (
                <button
                  key={tab.id}
                  className={meetingMode === tab.id ? "" : "ghost"}
                  style={{ flex: 1, minHeight: 34, fontSize: 12, padding: "0 8px" }}
                  onClick={() => setMeetingMode(tab.id)}
                >
                  {tab.icon} {tab.label}
                </button>
              ))}
            </div>

            {/* 텍스트 모드 */}
            {meetingMode === "text" && (
              <div style={{ marginTop: 12 }}>
                <textarea value={meetingText} onChange={e => setMeetingText(e.target.value)} />
              </div>
            )}

            {/* 파일 모드 */}
            {meetingMode === "file" && (
              <div style={{ marginTop: 12 }}>
                <label htmlFor="meeting-file-input" className="file-drop-label">
                  <span style={{ fontSize: 28 }}>📂</span>
                  <span>이미지 또는 PDF 파일 선택</span>
                  <span className="file-drop-hint">JPG · PNG · WebP · GIF · PDF · 최대 10MB</span>
                </label>
                <input
                  id="meeting-file-input"
                  type="file"
                  accept="image/*,.pdf,application/pdf"
                  style={{ display: "none" }}
                  onChange={handleFileUpload}
                />
                {uploadedFileName && (
                  <p className="uploaded-file-name">📄 {uploadedFileName}</p>
                )}
              </div>
            )}

            {/* 음성 인식 모드 */}
            {meetingMode === "voice" && (
              <div style={{ marginTop: 12 }}>
                {!voiceSupported ? (
                  <p className="voice-unsupported">⚠️ Chrome 브라우저에서만 음성 인식을 지원합니다.</p>
                ) : (
                  <>
                    <button
                      className={voiceRecording ? "danger-ghost" : ""}
                      style={{ width: "100%", marginBottom: 10 }}
                      onClick={voiceRecording ? stopVoiceRecognition : startVoiceRecognition}
                    >
                      {voiceRecording ? "⏹ 인식 중지" : "🎤 음성 인식 시작"}
                    </button>
                    {voiceRecording && (
                      <div className="voice-recording-indicator">
                        <span className="voice-dot" />
                        인식 중… {voiceInterim && <em style={{ color: "var(--ink-4)", fontStyle: "normal" }}>{voiceInterim}</em>}
                      </div>
                    )}
                    {voiceTranscript && (
                      <textarea
                        className="voice-transcript-area"
                        value={voiceTranscript}
                        onChange={e => setVoiceTranscript(e.target.value)}
                        placeholder="인식된 텍스트가 여기에 표시됩니다."
                      />
                    )}
                    {!voiceRecording && !voiceTranscript && (
                      <p style={{ fontSize: 13, color: "var(--ink-5)", marginTop: 8 }}>
                        시작 버튼을 눌러 회의록을 말씀하세요. 한국어로 인식됩니다.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <button
                disabled={
                  assistantBusy === "meeting" || fileExtracting ||
                  (meetingMode === "file" && !uploadedFileData) ||
                  (meetingMode === "voice" && !voiceTranscript)
                }
                onClick={extractActions}
                style={{ width: "100%" }}
              >
                {(assistantBusy === "meeting" || fileExtracting) ? (
                  <><span className="spinner" />{fileExtracting ? "파일 분석 중…" : "추출 중…"}</>
                ) : <>📝 액션 추출</>}
              </button>
            </div>
          </article>

          <article className="panel section-tasks">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div>
                <p className="eyebrow">할 일 관리</p>
                <h2>할 일 목록</h2>
              </div>
              <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                {tasks.some(t => t.done) && (
                  <button
                    className="ghost"
                    style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
                    onClick={() => {
                      const doneCount = tasks.filter(t => t.done).length;
                      setTasks(c => c.filter(t => !t.done));
                      showToast("완료된 항목을 제거했습니다.", "info");
                      addLog({ action: "task.cleanup", detail: `완료된 작업 ${doneCount}건을 제거했습니다.`, status: "success" });
                    }}
                    title="완료된 작업 제거"
                  >
                    🗑️ 완료 정리
                  </button>
                )}
                <button
                  className="ghost"
                  style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
                  onClick={() => setShowTasks(s => !s)}
                >
                  {showTasks ? "▲ 접기" : "▼ 펼치기"}
                </button>
              </div>
            </div>
            <div className="task-add-row">
              <input
                type="text"
                className="task-add-input"
                placeholder="할 일 추가… (Enter)"
                value={newTaskTitle}
                onChange={e => setNewTaskTitle(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleAddTask()}
              />
              <input
                type="date"
                className="task-add-date"
                value={newTaskDue}
                min={todayStr}
                onChange={e => setNewTaskDue(e.target.value)}
                title="마감일 (선택)"
              />
              <button
                style={{ flexShrink: 0 }}
                disabled={!newTaskTitle.trim()}
                onClick={handleAddTask}
              >
                + 추가
              </button>
            </div>

            {showTasks && (tasks.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📋</div><p>작업이 없습니다.<br />회의록에서 액션을 추출해 보세요.</p></div>
            ) : (
              <div className="stack">
                {(showAllOpenTasks
                  ? [...tasks].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0))
                  : [...tasks].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)).slice(0, 3)
                ).map(task => (
                  <div className={`task-card ${task.done ? "done" : ""} ${task.pinned ? "pinned" : ""}`} key={task.id}>
                    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, flex: 1, minWidth: 0, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={task.done}
                        onChange={() => toggleTask(task.id)}
                        style={{ width: 16, height: 16, flexShrink: 0, accentColor: "var(--brand)", cursor: "pointer", marginTop: 2 }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }} onClick={e => e.preventDefault()}>
                        {editingTaskId === task.id ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }} onClick={e => { e.stopPropagation(); e.preventDefault(); }}>
                            <input
                              className="task-edit-input"
                              value={editingTaskTitle}
                              autoFocus
                              placeholder="제목"
                              onChange={e => setEditingTaskTitle(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") commitEditTask(task.id);
                                if (e.key === "Escape") cancelEditTask();
                              }}
                            />
                            <input
                              className="task-edit-input"
                              value={editingTaskOwner}
                              placeholder="담당자"
                              onChange={e => setEditingTaskOwner(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") commitEditTask(task.id);
                                if (e.key === "Escape") cancelEditTask();
                              }}
                            />
                            <input
                              type="date"
                              className="task-edit-input"
                              value={editingTaskDue}
                              min={todayStr}
                              onChange={e => setEditingTaskDue(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") commitEditTask(task.id);
                                if (e.key === "Escape") cancelEditTask();
                              }}
                            />
                            <div style={{ display: "flex", gap: 4 }}>
                              <button type="button" style={{ fontSize: 11, padding: "2px 8px" }} onClick={e => { e.preventDefault(); e.stopPropagation(); commitEditTask(task.id); }}>저장</button>
                              <button type="button" style={{ fontSize: 11, padding: "2px 8px" }} onClick={e => { e.preventDefault(); e.stopPropagation(); cancelEditTask(); }}>취소</button>
                            </div>
                          </div>
                        ) : (
                          <strong>{task.title}</strong>
                        )}
                        {editingTaskId !== task.id && <span>{task.owner} · {task.due} · {task.source}</span>}
                      </div>
                    </label>
                    <div className="task-actions">
                      <button
                        className="mail-trash-btn"
                        style={{ alignSelf: "center" }}
                        onClick={() => startEditTask(task)}
                        title="수정"
                        aria-label="수정"
                      >
                        ✏️
                      </button>
                      <button
                        className={`mail-trash-btn ${task.pinned ? "pin-active" : ""}`}
                        style={{ alignSelf: "center" }}
                        onClick={() => handlePinTask(task.id)}
                        title={task.pinned ? "고정 해제" : "상단 고정"}
                        aria-label="상단 고정"
                      >
                        📌
                      </button>
                      <button
                        className="mail-trash-btn"
                        style={{ alignSelf: "center" }}
                        onClick={() => handleDeleteTask(task.id, task.title)}
                        title="할 일 삭제"
                        aria-label="할 일 삭제"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>
                ))}
                {tasks.length > 3 && (
                  <button
                    className="ghost"
                    style={{ width: "100%", fontSize: 12, minHeight: 28 }}
                    onClick={() => setShowAllOpenTasks(s => !s)}
                  >
                    {showAllOpenTasks ? "▲ 접기" : `▼ 외 ${tasks.length - 3}건 더 보기`}
                  </button>
                )}
              </div>
            ))}
          </article>
        </section>}

        {activeSection === "mail" && <section className="panel section-mail" id="mail">
          <div className="section-head">
            <div>
              <p className="eyebrow">이메일 요약</p>
              <h2>{auth ? "Gmail 메일함" : "중요도와 다음 액션을 분류했습니다."}</h2>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className="draft-control">
                <select value={draftMailId} onChange={e => setDraftMailId(e.target.value)}>
                  <option value="">— 답장할 메일 선택 —</option>
                  {mails.map(mail => <option key={mail.id} value={mail.id}>{mail.subject}</option>)}
                </select>
                <button disabled={assistantBusy === "draft" || !draftMailId} onClick={createReplyDraft}>
                  {assistantBusy === "draft" ? <><span className="spinner" />초안 생성 중</> : <>✉️ 답장 초안 만들기</>}
                </button>
              </div>
              <button
                className="ghost"
                style={{ minHeight: 28, padding: "0 10px", fontSize: 12, flexShrink: 0 }}
                onClick={() => auth ? handleRefreshData() : setMails([])}
                title={auth ? "Gmail에서 안 읽은 메일 다시 불러오기" : "목록 지우기"}
                disabled={dataLoading}
              >
                {dataLoading ? <span className="spinner" /> : "🔄"} 동기화
              </button>
              <button
                className="ghost"
                style={{ minHeight: 28, padding: "0 10px", fontSize: 12, flexShrink: 0 }}
                onClick={() => setShowMails(s => !s)}
              >
                {showMails ? "▲ 접기" : "▼ 펼치기"}
              </button>
            </div>
          </div>

          {showMails && (mails.length === 0 ? (
            <div className="empty-state"><div className="empty-icon">📭</div><p>받은 메일이 없습니다.</p></div>
          ) : (
            <>
              <div className="mail-list">
                {mails.map(mail => (
                  <article
                    className={`mail-card ${mail.label}`} key={mail.id}
                    onClick={() => handleMailClick(mail)}
                    role="button" tabIndex={0}
                    onKeyDown={e => e.key === "Enter" && handleMailClick(mail)}
                  >
                    <div className="mail-topline">
                      <span className={`pill ${mail.label}`}>{LABEL_TEXT[mail.label]}</span>
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <time>{mail.receivedAt}</time>
                        <button
                          className="mail-trash-btn"
                          onClick={e => handleTrashMail(e, mail)}
                          title="메일 삭제 (휴지통)"
                          aria-label="메일 삭제"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                    <h3>{mail.subject}</h3>
                    <p>{mail.summary}</p>
                    <small>{mail.sender}</small>
                  </article>
                ))}
              </div>
              {auth && nextPageToken && (
                <div style={{ marginTop: 16, textAlign: "center" }}>
                  <button className="ghost" disabled={moreMailsLoading} onClick={handleLoadMoreMails}>
                    {moreMailsLoading ? <><span className="spinner" />불러오는 중…</> : "📬 메일 더 보기"}
                  </button>
                </div>
              )}
            </>
          ))}
        </section>}

        {activeSection === "approval" && <section className="panel section-approval" id="approval" ref={approvalRef as React.Ref<HTMLElement>}>
          <div className="section-head">
            <div>
              <p className="eyebrow">승인 대기함</p>
              <h2>실행 전 확인이 필요한 항목입니다.</h2>
            </div>
            {pendingApprovals.length > 0 && <span className="counter">{pendingApprovals.length} 대기</span>}
          </div>

          {/* 대기 중 항목 */}
          {pendingApprovals.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">✅</div>
              <p>{processedApprovals.length > 0 ? "모든 항목이 처리되었습니다." : "대기 중인 승인 항목이 없습니다."}</p>
            </div>
          ) : (
            <div className="approval-list">
              {pendingApprovals.map(approval => {
                const isCollapsed = collapsedApprovals[approval.id] ?? false;
                return (
                  <article className="approval-card pending" key={approval.id}>
                    <div>
                      <div className="mail-topline">
                        <span className={`pill risk-${approval.risk}`}>{RISK_TEXT[approval.risk]}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto" }}>
                          <span style={{ fontSize: 11, color: "var(--ink-5)" }}>{approval.type}</span>
                          <button
                            className="ghost"
                            style={{ minHeight: 22, padding: "0 8px", fontSize: 11 }}
                            onClick={() => toggleApprovalCollapse(approval.id)}
                          >
                            {isCollapsed ? "▼ 펼치기" : "▲ 접기"}
                          </button>
                        </div>
                      </div>
                      <h3>{approval.title}</h3>

                      {!isCollapsed && (
                        <>
                          <p>{approval.description}</p>
                          {approval.recipientEmail && (
                            <p style={{ fontSize: 12, color: "var(--brand)", marginTop: 4 }}>📧 수신자: {approval.recipientEmail}</p>
                          )}
                          {approval.draft && (
                            <div className="draft-edit-wrapper">
                              <span className="draft-edit-label">✏️ 발송 전 내용을 직접 수정할 수 있습니다</span>
                              <textarea
                                className="draft-preview draft-editable"
                                value={approval.draft}
                                onChange={e => updateApprovalDraft(approval.id, e.target.value)}
                              />
                            </div>
                          )}
                          {approval.evidence && approval.evidence.length > 0 && (
                            <ul className="evidence-list">
                              {approval.evidence.map(item => <li key={item}>{item}</li>)}
                            </ul>
                          )}
                        </>
                      )}
                      <small style={{ marginTop: 8, display: "block" }}>{approval.createdAt} · 대기 중</small>
                    </div>

                    <div className="approval-actions">
                      <button
                        disabled={executingApprovalId === approval.id}
                        onClick={() => decideApproval(approval.id, "approved")}
                      >
                        {executingApprovalId === approval.id ? <><span className="spinner" />실행 중</> : "✅ 승인"}
                      </button>
                      <button
                        className="ghost"
                        disabled={executingApprovalId === approval.id}
                        onClick={() => decideApproval(approval.id, "rejected")}
                      >
                        ✕ 거절
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          {/* 처리 완료 항목 */}
          {processedApprovals.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="ghost"
                  style={{ flex: 1, fontSize: 12, minHeight: 32 }}
                  onClick={() => setShowProcessed(s => !s)}
                >
                  {showProcessed ? "▲ 처리 완료 항목 숨기기" : `처리 완료 항목 ${processedApprovals.length}건 보기`}
                </button>
                <button
                  className="ghost"
                  style={{ fontSize: 12, minHeight: 32, padding: "0 14px", flexShrink: 0 }}
                  onClick={() => {
                    setApprovals(c => c.filter(a => a.status === "pending"));
                    setShowProcessed(false);
                    showToast("처리 완료 항목을 모두 삭제했습니다.", "info");
                    addLog({ action: "approval.cleared", detail: `처리 완료 항목 ${processedApprovals.length}건을 삭제했습니다.`, status: "success" });
                  }}
                  title="처리 완료 항목 전체 삭제"
                >
                  🗑️ 전체 삭제
                </button>
              </div>
              {showProcessed && (
                <div className="approval-list" style={{ marginTop: 8, opacity: 0.7 }}>
                  {processedApprovals.map(approval => (
                    <article className={`approval-card ${approval.status}`} key={approval.id}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="mail-topline">
                          <span className={`pill risk-${approval.risk}`}>{RISK_TEXT[approval.risk]}</span>
                          <span style={{ fontSize: 11, color: "var(--ink-5)" }}>{approval.type}</span>
                        </div>
                        <h3>{approval.title}</h3>
                        <small style={{ marginTop: 6, display: "block" }}>
                          {approval.createdAt} · {approval.status === "approved" ? "✅ 승인됨" : "✕ 거절됨"}
                        </small>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>}

        </>)}

        {IS_LOCAL && <section className="panel section-agent" id="agent">
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
        </section>}

        {!IS_LOCAL && (<>
        {/* 에이전트 모드 사용 순서 */}
        {activeSection === "agent" && <section className="panel section-agent" id="agent">
          <div className="section-head">
            <div>
              <p className="eyebrow">Claude Code CLI</p>
              <h2>에이전트 모드 사용 순서</h2>
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
            {[
              { step: "1", title: "CMD 창 1 — 자비스 UI", code: "D:\ncd py\\pome-jarvis\nnpm run dev" },
              { step: "2", title: "CMD 창 2 — 에이전트 서버", code: "D:\ncd py\\pome-jarvis\nnpm run agent" },
              { step: "3", title: "localhost:3002 접속", desc: "에이전트 전용 로컬 화면으로 이동" },
              { step: "4", title: "작업 폴더 선택", desc: "Claude가 파일을 읽고 수정할 폴더 지정" },
              { step: "5", title: "지시 내용 입력 후 실행", desc: "자연어로 작업 입력 → 백그라운드 자동 처리" },
              { step: "6", title: "결과 확인", desc: "에이전트 카드 클릭 → 실시간 출력 확인" },
            ].map(({ step, title, code, desc }) => (
              <div key={step} style={{ padding: "14px 16px", borderRadius: 10, background: "var(--ink-0)", border: "1px solid var(--ink-2)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: code || desc ? 10 : 0 }}>
                  <span style={{ width: 24, height: 24, borderRadius: "50%", background: "var(--brand)", color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{step}</span>
                  <strong style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.4 }}>{title}</strong>
                </div>
                {code && <pre style={{ margin: 0, padding: "8px 12px", background: "#0f1117", color: "#a8b4c8", borderRadius: 6, fontSize: 12, fontFamily: "Consolas, monospace", whiteSpace: "pre-wrap", lineHeight: 1.7 }}>{code}</pre>}
                {desc && <p style={{ margin: 0, fontSize: 12, color: "var(--ink-5)", lineHeight: 1.6 }}>{desc}</p>}
              </div>
            ))}
          </div>
        </section>}

        {/* 실행 로그 */}
        {activeSection === "log" && <section className="panel section-log" id="log">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
            <div>
              <p className="eyebrow">실행 로그</p>
              <h2>비서가 한 일을 기록합니다.</h2>
            </div>
            <div style={{ display: "flex", gap: 6, flexShrink: 0, marginTop: 2 }}>
              {logs.length > 0 && (
                <button
                  className="ghost"
                  style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
                  onClick={() => {
                    setLogs([]);
                    showToast("로그를 모두 삭제했습니다.", "info");
                  }}
                >
                  🗑️ 전체 삭제
                </button>
              )}
              <button
                className="ghost"
                style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
                onClick={() => setShowLog(s => !s)}
              >
                {showLog ? "▲ 접기" : "▼ 펼치기"}
              </button>
            </div>
          </div>

          {showLog && (
            logs.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📋</div><p>아직 기록이 없습니다.</p></div>
            ) : (
              <div className="log-list">
                {logs.map(log => (
                  <div className={`log-row ${log.status}`} key={log.id}>
                    <time>{log.createdAt}</time>
                    <strong>{log.action}</strong>
                    <span>{log.detail}</span>
                  </div>
                ))}
              </div>
            )
          )}
        </section>}
        </>)}
      </main>

      {/* ── Mobile Bottom Nav ───────────────────────────────────── */}
      <nav className="mobile-nav" aria-label="모바일 탐색">
        {NAV_ITEMS.map(item => {
          const badge =
            item.id === "approval" && pendingApprovals.length > 0 ? { count: pendingApprovals.length, color: "danger" } :
            item.id === "mail"     && auth && mails.length > 0     ? { count: mails.length,            color: "brand" }  :
            item.id === "meeting"  && openTasks.length > 0         ? { count: openTasks.length,         color: "warning" } :
            null;
          return (
            <a
              key={item.id}
              href={IS_LOCAL ? `#${item.id}` : undefined}
              className={activeSection === item.id ? "active" : ""}
              onClick={!IS_LOCAL ? (e) => { e.preventDefault(); setActiveSection(item.id); } : undefined}
              style={{ cursor: "pointer" }}
            >
              <span className="mobile-nav-icon">{item.icon}</span>
              <span className="mobile-nav-label">{item.id === "meeting" ? "회의록·할일" : item.label}</span>
              {badge && <span className={`mobile-nav-badge mobile-nav-badge-${badge.color}`}>{badge.count}</span>}
            </a>
          );
        })}
      </nav>

      {/* ── Toast ──────────────────────────────────────────────── */}
      <div className="toast-container" aria-live="polite">
        {toasts.map(toast => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            <span className="toast-icon">{toast.type === "success" && "✓"}{toast.type === "error" && "✕"}{toast.type === "info" && "ℹ"}</span>
            {toast.message}
          </div>
        ))}
      </div>

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

      {/* ── Mail Modal ──────────────────────────────────────────── */}
      {selectedMail && (
        <div className="modal-overlay" onClick={handleCloseMail} role="dialog" aria-modal="true">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className={`pill ${selectedMail.label}`}>{LABEL_TEXT[selectedMail.label]}</span>
                <h2 style={{ marginTop: 8, fontSize: 16, lineHeight: 1.35 }}>{selectedMail.subject}</h2>
                <p className="modal-meta">{selectedMail.sender} · {selectedMail.receivedAt}</p>
              </div>
              <button className="ghost modal-close" onClick={handleCloseMail}>✕ 닫기</button>
            </div>
            <div className="modal-body">
              {mailBodyLoading ? (
                <div style={{ textAlign: "center", padding: "32px 0" }}>
                  <span className="spinner" style={{ borderColor: "rgba(0,0,0,.12)", borderTopColor: "var(--brand)", width: 24, height: 24, borderWidth: 3 }} />
                  <p style={{ marginTop: 12, fontSize: 13, color: "var(--ink-5)" }}>본문 불러오는 중…</p>
                </div>
              ) : (
                <pre className="mail-body-text">{mailBody || selectedMail.summary}</pre>
              )}
            </div>
            <div className="modal-footer">
              <button className="ghost" onClick={() => { setDraftMailId(selectedMail.id); handleCloseMail(); setTimeout(() => document.getElementById("mail")?.scrollIntoView({ behavior: "smooth" }), 100); }}>
                ✉️ 답장 초안 만들기
              </button>
              <button onClick={handleCloseMail}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
