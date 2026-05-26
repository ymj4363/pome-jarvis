import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  defaultMeetingText,
  initialApprovals,
  initialEvents,
  initialLogs,
  initialMails,
  initialTasks
} from "./data";
import { createReplyDraftApproval, decideApproval as decideApprovalState } from "./services/approvalService";
import { draftReply, extractMeetingActions, fetchBriefing } from "./services/assistantService";
import { createCalendarEvent, fetchCalendarEvents } from "./services/calendarService";
import { fetchGmailMessages, fetchMailBody, fetchMoreMails, saveDraft, trashMail } from "./services/gmailService";
import {
  getAuthState,
  handleOAuthCallback,
  hasClientId,
  logout,
  startOAuth,
  type AuthState
} from "./services/googleAuthService";
import { createLog } from "./services/logService";
import type { Approval, BriefingResult, CalendarEvent, CalendarEventData, LogEntry, Mail, Task } from "./types";
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

const NAV_ITEMS = [
  { id: "briefing", icon: "📊", label: "운영판" },
  { id: "meeting",  icon: "📝",  label: "회의록" },
  { id: "mail",     icon: "✉️",  label: "메일" },
  { id: "approval", icon: "✅",  label: "승인" },
  { id: "log",      icon: "📋",  label: "로그" }
];

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
  const [events, setEvents] = useState<CalendarEvent[]>(initialEvents);
  const [tasks, setTasks]         = usePersistentState<Task[]>("pome.tasks", initialTasks);
  const [approvals, setApprovals] = usePersistentState<Approval[]>("pome.approvals", initialApprovals);
  const [logs, setLogs]           = usePersistentState<LogEntry[]>("pome.logs", initialLogs);
  const [meetingText, setMeetingText] = usePersistentState("pome.meetingText", defaultMeetingText);
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

  /* ── 서명 설정 ──────────────────────────────────────────────── */
  const [gmailSignature, setGmailSignature]           = usePersistentState("pome.signature", "");
  const [showSignatureSetting, setShowSignatureSetting] = useState(false);

  /* ── 일정 추가 폼 ───────────────────────────────────────────── */
  const [showEventForm, setShowEventForm] = useState(false);
  const todayStr = new Date().toISOString().split("T")[0];
  const [eventForm, setEventForm] = useState({
    title: "", date: todayStr, startTime: "", endTime: "", location: ""
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

  // 열린 할 일 전체 보기
  const [showAllOpenTasks, setShowAllOpenTasks] = useState(false);

  // 승인 대기함 접기/펼치기 + 처리 완료 토글
  const [collapsedApprovals, setCollapsedApprovals] = useState<Record<string, boolean>>({});
  const [showProcessed, setShowProcessed] = useState(false);

  // 실행 로그
  const [showLog, setShowLog] = useState(true);

  // 섹션 접기/펼치기
  const [showMails, setShowMails] = useState(true);
  const [showTasks, setShowTasks] = useState(true);

  const approvalRef = useRef<HTMLElement>(null);

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

    if (code && state) {
      handleOAuthCallback(code, state)
        .then(newAuth => { setAuth(newAuth); return loadRealData(newAuth.accessToken, newAuth.user.name); })
        .catch(() => showToast("구글 로그인에 실패했습니다. 다시 시도해 주세요.", "error"));
      return;
    }

    const existing = getAuthState();
    if (existing) { setAuth(existing); loadRealData(existing.accessToken, existing.user.name); }
  }, [loadRealData, showToast]);

  /* ── 활성 섹션 추적 ─────────────────────────────────────────── */
  useEffect(() => {
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
      try { setMailBody(await fetchMailBody(auth.accessToken, mail.id) || mail.summary); }
      catch { setMailBody(mail.body || mail.summary || "본문을 불러오지 못했습니다."); }
      finally { setMailBodyLoading(false); }
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

  /* ── 일정 추가 (승인 대기함 경유) ───────────────────────────── */
  const handleAddEventApproval = (e: React.FormEvent) => {
    e.preventDefault();
    if (!eventForm.title || !eventForm.date || !eventForm.startTime || !eventForm.endTime) return;

    const calendarEventData: CalendarEventData = {
      title:         eventForm.title,
      startDateTime: `${eventForm.date}T${eventForm.startTime}:00`,
      endDateTime:   `${eventForm.date}T${eventForm.endTime}:00`,
      location:      eventForm.location || undefined,
      timeZone:      "Asia/Seoul"
    };

    const approval: Approval = {
      id:          crypto.randomUUID(),
      type:        "calendar_change",
      title:       `📅 ${eventForm.title}`,
      description: `${eventForm.date} ${eventForm.startTime} ~ ${eventForm.endTime}${eventForm.location ? ` · ${eventForm.location}` : ""}`,
      risk:        "low",
      createdAt:   "방금 전",
      status:      "pending",
      calendarEventData
    };

    setApprovals(current => [approval, ...current]);
    setShowEventForm(false);
    setEventForm({ title: "", date: todayStr, startTime: "", endTime: "", location: "" });
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
      const approval = createReplyDraftApproval(mail, result, gmailSignature);
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
  const startVoiceRecognition = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) { setVoiceSupported(false); showToast("이 브라우저는 음성 인식을 지원하지 않습니다. Chrome을 사용해 주세요.", "error"); return; }

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
    recognition.onerror = () => { setVoiceRecording(false); setVoiceInterim(""); };
    recognition.onend   = () => { setVoiceRecording(false); setVoiceInterim(""); recognitionRef.current = null; };

    recognition.start();
    recognitionRef.current = recognition;
    setVoiceRecording(true);
  };

  const stopVoiceRecognition = () => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
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

  const resetDemoState = () => {
    setTasks(initialTasks); setApprovals(initialApprovals); setLogs(initialLogs);
    setMeetingText(defaultMeetingText); setDraftMailId(initialMails[1]?.id ?? "");
    if (!auth) { setMails(initialMails); setEvents(initialEvents); }
    showToast("데모 상태를 초기화했습니다.", "info");
  };

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div className="app-shell">

      {/* ── Sidebar ────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">P</div>
          <div><strong>Pome Jarvis</strong><span>승인형 개인 운영비서</span></div>
        </div>

        <p className="nav-label">메뉴</p>
        <nav className="nav-list" aria-label="주요 화면">
          {NAV_ITEMS.map(item => (
            <a key={item.id} href={`#${item.id}`} className={activeSection === item.id ? "active" : ""}>
              <span className="nav-icon">{item.icon}</span>
              {item.label}
              {item.id === "approval" && pendingApprovals.length > 0 && (
                <span className="nav-badge">{pendingApprovals.length}</span>
              )}
            </a>
          ))}
        </nav>

        <div className="sidebar-footer">
          {auth ? (
            <>
              <div className="user-info">
                <img src={auth.user.picture} alt={auth.user.name} className="user-avatar" referrerPolicy="no-referrer" />
                <div className="user-info-text">
                  <strong>{auth.user.name}</strong>
                  <span>{auth.user.email}</span>
                </div>
              </div>
              <button className="icon-button" onClick={handleRefreshData} disabled={dataLoading}>
                {dataLoading ? <span className="spinner" /> : "🔄"} 새로고침
              </button>
              <div className="signature-setting">
                <button className="signature-toggle" onClick={() => setShowSignatureSetting(s => !s)}>
                  ✍️ 이메일 서명 {showSignatureSetting ? "▲" : "▼"}
                </button>
                {showSignatureSetting && (
                  <textarea className="signature-input" placeholder={"홍길동 | 개발팀\njane@example.com\n010-0000-0000"} value={gmailSignature} onChange={e => setGmailSignature(e.target.value)} rows={3} />
                )}
              </div>
              <button className="reset-button" onClick={handleLogout}>로그아웃</button>
            </>
          ) : (
            <>
              <p className="sidebar-note">
                {hasClientId() ? "구글 계정을 연동하면 실제 메일·일정을 가져옵니다." : "데모 모드 — 더미 데이터로 동작합니다."}
              </p>
              {hasClientId() && (
                <button className="google-login-btn" onClick={handleLogin}>
                  <GoogleIcon /> 구글 계정 연동
                </button>
              )}
              <div className="signature-setting">
                <button className="signature-toggle" onClick={() => setShowSignatureSetting(s => !s)}>
                  ✍️ 이메일 서명 {showSignatureSetting ? "▲" : "▼"}
                </button>
                {showSignatureSetting && (
                  <textarea className="signature-input" placeholder={"홍길동 | 개발팀\njane@example.com\n010-0000-0000"} value={gmailSignature} onChange={e => setGmailSignature(e.target.value)} rows={3} />
                )}
              </div>
              <button className="reset-button" onClick={resetDemoState}>🔄 데모 초기화</button>
            </>
          )}
        </div>
      </aside>

      {/* ── Content ────────────────────────────────────────────── */}
      <main className="content">
        {dataLoading && <div className="data-loading-bar" />}

        {/* Hero */}
        <header className="hero" id="briefing">
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
        </header>

        {/* 2-column 요약 */}
        <section className="grid two">

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
                <div className="event-form-times">
                  <input type="time" required value={eventForm.startTime}
                    onChange={e => setEventForm(f => ({ ...f, startTime: e.target.value }))} />
                  <span>~</span>
                  <input type="time" required value={eventForm.endTime}
                    onChange={e => setEventForm(f => ({ ...f, endTime: e.target.value }))} />
                </div>
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
                    <div><strong>{event.title}</strong>{event.location && <span>{event.location}</span>}</div>
                    <time>{event.time}</time>
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

        </section>

        {/* 회의록 액션 */}
        <section className="grid two section-meeting" id="meeting">
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
            {showTasks && (tasks.length === 0 ? (
              <div className="empty-state"><div className="empty-icon">📋</div><p>작업이 없습니다.<br />회의록에서 액션을 추출해 보세요.</p></div>
            ) : (
              <div className="stack">
                {(showAllOpenTasks ? tasks : tasks.slice(0, 3)).map(task => (
                  <label className={`task-card ${task.done ? "done" : ""}`} key={task.id} style={{ cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={task.done}
                      onChange={() => toggleTask(task.id)}
                      style={{ width: 16, height: 16, flexShrink: 0, accentColor: "var(--brand)", cursor: "pointer", marginTop: 2 }}
                    />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>{task.title}</strong>
                      <span>{task.owner} · {task.due} · {task.source}</span>
                    </div>
                  </label>
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
        </section>

        {/* 이메일 요약 */}
        <section className="panel section-mail" id="mail">
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
        </section>

        {/* 승인 대기함 */}
        <section className="panel section-approval" id="approval" ref={approvalRef as React.Ref<HTMLElement>}>
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
        </section>

        {/* 실행 로그 */}
        <section className="panel section-log" id="log">
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
        </section>
      </main>

      {/* ── Mobile Bottom Nav ───────────────────────────────────── */}
      <nav className="mobile-nav" aria-label="모바일 탐색">
        {NAV_ITEMS.map(item => (
          <a key={item.id} href={`#${item.id}`} className={activeSection === item.id ? "active" : ""}>
            <span className="mobile-nav-icon">{item.icon}</span>
            <span className="mobile-nav-label">{item.label}</span>
            {item.id === "approval" && pendingApprovals.length > 0 && (
              <span className="mobile-nav-badge">{pendingApprovals.length}</span>
            )}
          </a>
        ))}
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
