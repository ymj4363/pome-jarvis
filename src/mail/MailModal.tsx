import type { Mail } from "../types";
import { LABEL_TEXT } from "../constants";

/* ── 메일 본문 모달 ──────────────────────────────────────────────── */

type Props = {
  mail: Mail;
  body: string;
  loading: boolean;
  onClose: () => void;
  onReply: () => void;
};

export default function MailModal({ mail, body, loading, onClose, onReply }: Props) {
  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className={`pill ${mail.label}`}>{LABEL_TEXT[mail.label]}</span>
            <h2 style={{ marginTop: 8, fontSize: 16, lineHeight: 1.35 }}>{mail.subject}</h2>
            <p className="modal-meta">{mail.sender} · {mail.receivedAt}</p>
          </div>
          <button className="ghost modal-close" onClick={onClose}>✕ 닫기</button>
        </div>
        <div className="modal-body">
          {loading ? (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <span className="spinner" style={{ borderColor: "rgba(0,0,0,.12)", borderTopColor: "var(--brand)", width: 24, height: 24, borderWidth: 3 }} />
              <p style={{ marginTop: 12, fontSize: 13, color: "var(--ink-5)" }}>본문 불러오는 중…</p>
            </div>
          ) : (
            <pre className="mail-body-text">{body || mail.summary}</pre>
          )}
        </div>
        <div className="modal-footer">
          <button className="ghost" onClick={onReply}>
            ✉️ 답장 초안 만들기
          </button>
          <button onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
