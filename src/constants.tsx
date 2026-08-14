/* ── 공용 상수·타입 (여러 화면이 공유하는 단일 진실 소스) ───────── */

export type Toast       = { id: string; message: string; type: "success" | "error" | "info" };
export type MeetingMode = "text" | "file" | "voice";

// showToast / addLog 공용 시그니처 (분할된 섹션 컴포넌트에 props로 전달)
export type ShowToast = (message: string, type?: Toast["type"]) => void;

export const LABEL_TEXT: Record<string, string> = {
  urgent:       "긴급",
  reply_needed: "답장 필요",
  reference:    "참고"
};

export const RISK_TEXT: Record<string, string> = {
  low:    "위험 낮음",
  medium: "위험 중간",
  high:   "위험 높음"
};

export const IS_LOCAL = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";

export const NAV_ITEMS = IS_LOCAL
  ? [{ id: "agent", icon: "🤖", label: "에이전트" }]
  : [
      { id: "briefing", icon: "📊", label: "운영판" },
      { id: "ledger",   icon: "💰", label: "매출·매입" },
      { id: "meeting",  icon: "📝",  label: "회의록" },
      { id: "mail",     icon: "✉️",  label: "메일" },
      { id: "approval", icon: "✅",  label: "승인" },
      { id: "agent",    icon: "🤖",  label: "에이전트" },
      { id: "log",      icon: "📋",  label: "로그" }
    ];

export const MAX_AGENTS = 10;

export const AGENT_STATUS_LABEL: Record<string, string> = {
  pending: "대기",
  running: "실행 중",
  done:    "완료",
  error:   "오류",
  killed:  "중단됨",
};

export const MEETING_TABS: { id: MeetingMode; icon: string; label: string }[] = [
  { id: "text",  icon: "📝", label: "텍스트" },
  { id: "file",  icon: "📎", label: "이미지·문서" },
  { id: "voice", icon: "🎤", label: "음성 인식" }
];

export function GoogleIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}
