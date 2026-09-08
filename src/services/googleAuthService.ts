/**
 * Google OAuth 2.0 PKCE flow
 *
 * Client Secret 없이 브라우저에서 직접 OAuth 처리.
 * Access token은 sessionStorage에 저장 (탭 닫으면 사라짐).
 * Cloudflare KV 불필요.
 */

export type GoogleUser = {
  email: string;
  name: string;
  picture: string;
};

export type AuthState = {
  accessToken: string;
  expiresAt: number;
  user: GoogleUser;
  sessionId: string | null;
};

const STORAGE_KEY  = "pome.google_auth";
const VERIFIER_KEY = "pome.pkce_verifier";
const STATE_KEY    = "pome.oauth_state";
let authRevision = 0;
let loggingOut = false;
let pendingRefresh: { id: string; promise: Promise<AuthState | null> } | null = null;

/** Vite 빌드 타임에 주입 — Cloudflare Pages 환경변수 VITE_GOOGLE_CLIENT_ID */
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify", // 읽기 + 휴지통 이동 (readonly 대체)
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "openid email profile"
].join(" ");

/* ── PKCE 헬퍼 ──────────────────────────────────────────────────── */

function generateVerifier(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generateChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/* ── Public API ─────────────────────────────────────────────────── */

/** VITE_GOOGLE_CLIENT_ID가 설정되어 있는지 확인 */
export function hasClientId(): boolean {
  return CLIENT_ID.length > 0;
}

/** Google OAuth 동의 화면으로 리다이렉트 */
export async function startOAuth(): Promise<void> {
  if (!CLIENT_ID) throw new Error("VITE_GOOGLE_CLIENT_ID is not configured");

  const verifier   = generateVerifier();
  const challenge  = await generateChallenge(verifier);
  const state      = crypto.randomUUID();

  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(STATE_KEY, state);

  const params = new URLSearchParams({
    client_id:             CLIENT_ID,
    redirect_uri:          window.location.origin,
    response_type:         "code",
    scope:                 SCOPES,
    code_challenge:        challenge,
    code_challenge_method: "S256",
    state,
    access_type:           "offline",
    prompt:                "consent"
  });

  window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Google 리다이렉트 콜백 처리 — code + state 교환 */
export async function handleOAuthCallback(code: string, state: string): Promise<AuthState> {
  if (!CLIENT_ID) throw new Error("VITE_GOOGLE_CLIENT_ID is not configured");

  const storedState = sessionStorage.getItem(STATE_KEY);
  const verifier    = sessionStorage.getItem(VERIFIER_KEY);

  sessionStorage.removeItem(STATE_KEY);
  sessionStorage.removeItem(VERIFIER_KEY);

  if (state !== storedState || !verifier) {
    throw new Error("OAuth state mismatch — possible CSRF");
  }

  // Authorization Code → Access Token (server-side via Cloudflare Function)
  // client_secret은 서버에만 보관 — 브라우저에 노출 안 됨
  const tokenRes = await fetch("/api/auth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id:     CLIENT_ID,
      code,
      code_verifier: verifier,
      redirect_uri:  window.location.origin
    })
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error(`Token exchange failed: ${err.slice(0, 200)}`);
  }

  const tokens = await tokenRes.json() as { access_token: string; expires_in: number; session_id: string | null };

  // 사용자 정보 조회
  const userRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` }
  });
  const user = await userRes.json() as GoogleUser;

  const authState: AuthState = {
    accessToken: tokens.access_token,
    expiresAt:   Date.now() + tokens.expires_in * 1000,
    sessionId:   tokens.session_id ?? null,
    user
  };

  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(authState));
  return authState;
}

/** 액세스 토큰이 만료 판정 시점에 도달했는지 확인 */
export function isAuthExpired(state: AuthState): boolean {
  return Date.now() > state.expiresAt - 60_000;
}

/** sessionStorage에서 인증 상태 반환 (갱신 가능한 만료 세션은 보존) */
export function getAuthState(): AuthState | null {
  if (loggingOut) return null;
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY);
    if (!stored) return null;

    const state = JSON.parse(stored) as AuthState;
    state.sessionId = state.sessionId ?? null;
    // 만료 1분 전에 무효 처리
    if (isAuthExpired(state) && !state.sessionId) {
      sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return state;
  } catch {
    return null;
  }
}

/** 만료된 인증 상태를 비우고 진행 중인 갱신 결과 무효화 */
export function clearAuthState(): void {
  authRevision++;
  sessionStorage.removeItem(STORAGE_KEY);
}

/** 동일 세션의 동시 요청은 하나의 갱신 결과를 공유 */
export async function refreshAccessToken(sessionId: string, lastActiveAt?: string): Promise<AuthState | null> {
  if (pendingRefresh?.id === sessionId) return pendingRefresh.promise;
  const state = getAuthState();
  if (!state || state.sessionId !== sessionId) return null;
  const revision = authRevision;
  const promise = (async (): Promise<AuthState | null> => {
    try {
      const response = await fetch("/api/auth/refresh", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, client_id: CLIENT_ID, last_active_at: lastActiveAt })
      });
      if (!response.ok) throw new Error("Session refresh failed");
      const tokens = await response.json() as { access_token: string; expires_in: number };
      if (!tokens.access_token || !Number.isFinite(tokens.expires_in) || tokens.expires_in <= 0) {
        throw new Error("Invalid token response");
      }
      if (revision !== authRevision || getAuthState()?.sessionId !== sessionId) return null;
      const updated: AuthState = {
        accessToken: tokens.access_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        user: state.user,
        sessionId
      };
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      return updated;
    } catch {
      if (revision === authRevision && getAuthState()?.sessionId === sessionId) clearAuthState();
      return null;
    }
  })();
  pendingRefresh = { id: sessionId, promise };
  try {
    return await promise;
  } finally {
    if (pendingRefresh?.promise === promise) pendingRefresh = null;
  }
}

/** 로그아웃 — 서버 세션 폐기 후 sessionStorage 초기화 */
export async function logout(): Promise<void> {
  const state = getAuthState();
  loggingOut = true;
  authRevision++;
  try {
    if (state?.sessionId) {
      await fetch("/api/auth/revoke", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: state.sessionId })
      });
    }
  } catch {
    // 서버 폐기 실패와 무관하게 브라우저에서는 로그아웃
  } finally {
    clearAuthState();
    loggingOut = false;
  }
}
