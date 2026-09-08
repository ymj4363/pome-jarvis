#!/usr/bin/env node
/**
 * 계약 테스트 — 구글 로그인 세션 유지 개선 (PRD-2026-09-08)
 *
 * 검수 측(위임자)이 위임 **전에** 작성했다. Executor는 이 파일을 수정할 수 없다.
 * PRD 성공 기준 중 "없어야 할 것의 부재"를 확인하는 검사가 중심이다 —
 * 구현자가 자기 안전망을 자기가 통과시키는 순환을 막기 위해서다.
 *
 * 전제 (검수 측이 준비한다):
 *   1) npm run build
 *   2) npx wrangler pages dev dist --port 8788 --ip 127.0.0.1  (백그라운드)
 *   3) npx wrangler d1 migrations apply pome-jarvis-db --local
 *   4) .dev.vars 에 GOOGLE_CLIENT_SECRET (로컬 계약 테스트용 더미 값)
 *
 * 실행: node scripts/contract-test-auth.mjs
 * 종료 코드: 0 = 전부 통과 / 1 = 실패 있음 / 2 = 검사기 자체 고장
 */

import { execSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://127.0.0.1:8788";
const DB = "pome-jarvis-db";
const IDLE_LIMIT_HOURS = 12;

let pass = 0;
let fail = 0;
const failures = [];

function ok(name) {
  pass += 1;
  console.log(`[OK]   ${name}`);
}

function bad(name, detail) {
  fail += 1;
  failures.push(`${name} — ${detail}`);
  console.log(`[FAIL] ${name}\n       ${detail}`);
}

function check(name, condition, detail) {
  if (condition) ok(name);
  else bad(name, detail);
}

/** 검사기 자체가 성립하지 않으면 통과/실패가 아니라 고장으로 끝낸다 */
function selfCheck(condition, message) {
  if (!condition) {
    console.error(`\n[검사기 고장] ${message}`);
    process.exit(2);
  }
}

/* ── D1 헬퍼 ────────────────────────────────────────────────────── */

function d1(sql) {
  // Windows 에서 execFileSync + shell:true 는 인자를 공백으로 재분해해 SQL 이 깨진다.
  // 명령 문자열을 직접 만들고 SQL 을 큰따옴표로 감싼다 (SQL 안에는 작은따옴표만 쓴다).
  selfCheck(!sql.includes('"'), `SQL 에 큰따옴표가 들어 있다 — 인용이 깨진다: ${sql.slice(0, 80)}`);
  const out = execSync(
    `npx wrangler d1 execute ${DB} --local --json --command "${sql}"`,
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  );
  // wrangler가 배너를 섞어 내보내므로 첫 '[' 부터 잘라 파싱한다
  const start = out.indexOf("[");
  selfCheck(start !== -1, `d1 응답에서 JSON을 찾지 못했다: ${out.slice(0, 200)}`);
  const parsed = JSON.parse(out.slice(start));
  return parsed[0]?.results ?? [];
}

function countSession(id) {
  const rows = d1(`SELECT COUNT(*) AS n FROM auth_sessions WHERE id = '${id}'`);
  selfCheck(rows.length === 1, "COUNT 질의가 행을 돌려주지 않았다 — 검사기 고장");
  return Number(rows[0].n);
}

/** last_used_at 을 지금으로부터 hoursAgo 시간 전으로 심는다 */
function seedSession(id, hoursAgo) {
  const at = new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString();
  d1(`DELETE FROM auth_sessions WHERE id = '${id}'`);
  d1(
    `INSERT INTO auth_sessions (id, refresh_token, email, created_at, last_used_at) ` +
    `VALUES ('${id}', 'invalid-refresh-token-for-contract-test', 'jym@atix.co.kr', '${at}', '${at}')`
  );
  // 자가 진단: 실제로 심어졌는가 (0이면 "없다"가 아니라 "검사기 고장")
  selfCheck(countSession(id) === 1, `세션 ${id} 을 심지 못했다 — 이후 부재 검사가 무의미해진다`);
}

function cleanup() {
  d1("DELETE FROM auth_sessions WHERE id LIKE 'contract-%'");
}

/* ── HTTP 헬퍼 ──────────────────────────────────────────────────── */

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function post(path, body, contentType = "application/json") {
  // wrangler pages dev 는 로컬 D1 상태 파일이 바뀌면 워커를 리로드한다. 세션을 심은 직후의
  // 첫 요청이 그 창에 걸리면 연결이 끊겨 fetch 가 예외를 던진다 — 구현 결함이 아니라
  // 검증 환경 문제다. 연결 자체가 실패한 경우에만 재시도한다.
  // (HTTP 응답을 받았다면 그것이 답이므로 재시도하지 않는다.)
  let lastError = "";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    let res;
    try {
      res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { "content-type": contentType },
        body: typeof body === "string" ? body : JSON.stringify(body)
      });
    } catch (e) {
      lastError = e.message;
      if (attempt < 4) { await sleep(700 * attempt); continue; }
      return { status: 0, text: `fetch 실패 (${attempt}회 시도): ${lastError}`, json: null };
    }
    return finish(res, attempt);
  }
  return { status: 0, text: `fetch 실패: ${lastError}`, json: null };
}

async function finish(res, attempt) {
  if (attempt > 1) console.log(`       (연결 재시도 ${attempt}회째에 응답 받음 — 환경 문제)`);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 본문이 비었거나 JSON이 아님 */ }
  return { status: res.status, text, json };
}

/* ── 검사 ───────────────────────────────────────────────────────── */

async function main() {
  // 서버가 떠 있는지부터. 안 떠 있으면 모든 검사가 실패로 나와 원인을 가린다.
  try {
    await fetch(`${BASE}/`, { method: "GET" });
  } catch (e) {
    selfCheck(false, `${BASE} 에 붙지 못했다 — wrangler pages dev 가 떠 있는지 확인하라 (${e.message})`);
  }

  // auth_sessions 테이블 존재 확인 (마이그레이션 미적용이면 전부 고장)
  const tables = d1(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='auth_sessions'"
  );
  selfCheck(tables.length === 1, "auth_sessions 테이블이 없다 — 마이그레이션을 먼저 적용하라");

  cleanup();

  /* T1 — session_id 없이 갱신 요청 */
  {
    const r = await post("/api/auth/refresh", {});
    check(
      "T1 session_id 누락 → 401 reason=no_session",
      r.status === 401 && r.json?.reason === "no_session",
      `실제: status=${r.status} reason=${r.json?.reason} body=${r.text.slice(0, 160)}`
    );
  }

  /* T2 — 존재하지 않는 session_id */
  {
    const r = await post("/api/auth/refresh", { session_id: "contract-does-not-exist" });
    check(
      "T2 미존재 session_id → 401 reason=no_session",
      r.status === 401 && r.json?.reason === "no_session",
      `실제: status=${r.status} reason=${r.json?.reason} body=${r.text.slice(0, 160)}`
    );
  }

  /* T3 — 유휴 상한(12시간) 초과 세션은 거부되고 행이 사라져야 한다 */
  {
    const id = "contract-idle-expired";
    seedSession(id, IDLE_LIMIT_HOURS + 1);
    const r = await post("/api/auth/refresh", { session_id: id });
    check(
      `T3 유휴 ${IDLE_LIMIT_HOURS + 1}시간 세션 → 401 reason=idle_expired`,
      r.status === 401 && r.json?.reason === "idle_expired",
      `실제: status=${r.status} reason=${r.json?.reason} body=${r.text.slice(0, 160)}`
    );
    check(
      "T3-b 유휴 초과 세션의 D1 행이 삭제됨 (부재 검사)",
      countSession(id) === 0,
      `행이 ${countSession(id)}건 남아 있다 — 폐기 경로가 동작하지 않는다`
    );
  }

  /* T4 — 유휴 상한 안쪽 세션은 유휴 판정을 통과해 구글 갱신까지 가야 한다.
         refresh_token 이 가짜라 구글이 거부하므로 reason 이 refresh_failed 여야 한다.
         T3 과 reason 이 갈리는 것이 "유휴 판정이 실제로 동작한다"의 증거다 —
         둘 다 401 이므로 상태 코드만 보면 구별되지 않는다. */
  {
    const id = "contract-idle-ok";
    seedSession(id, IDLE_LIMIT_HOURS - 1);
    const r = await post("/api/auth/refresh", { session_id: id });
    check(
      `T4 유휴 ${IDLE_LIMIT_HOURS - 1}시간 세션 → 유휴 통과 후 구글 거부 → 401 reason=refresh_failed`,
      r.status === 401 && r.json?.reason === "refresh_failed",
      `실제: status=${r.status} reason=${r.json?.reason} body=${r.text.slice(0, 160)}`
    );
    check(
      "T4-b 구글이 거부한 세션의 D1 행이 삭제됨 (부재 검사)",
      countSession(id) === 0,
      `행이 ${countSession(id)}건 남아 있다 — 죽은 세션이 계속 쌓인다`
    );
  }

  /* T5 — revoke 는 항상 204 이고 행을 지운다 */
  {
    const id = "contract-revoke";
    seedSession(id, 1);
    const r = await post("/api/auth/revoke", { session_id: id });
    check(
      "T5 revoke → 204",
      r.status === 204,
      `실제: status=${r.status} body=${r.text.slice(0, 160)}`
    );
    check(
      "T5-b revoke 후 D1 행이 삭제됨 (부재 검사)",
      countSession(id) === 0,
      `행이 ${countSession(id)}건 남아 있다 — 로그아웃해도 자격증명이 남는다`
    );
  }

  /* T6 — revoke 는 Content-Type 을 신뢰하지 말고 본문을 JSON 으로 읽어야 한다.
         호출자가 어떤 방식으로 보내든 폐기가 성립해야 한다는 방어적 계약이다.
         (탭 종료 폐기 경로는 T13 에서 없앴다 — 새로고침도 pagehide 를 발화시키기 때문이다.) */
  {
    const id = "contract-beacon";
    seedSession(id, 1);
    const r = await post("/api/auth/revoke", JSON.stringify({ session_id: id }), "text/plain");
    check(
      "T6 revoke (sendBeacon text/plain) → 204 이고 행 삭제 (부재 검사)",
      r.status === 204 && countSession(id) === 0,
      `실제: status=${r.status} 남은행=${countSession(id)}`
    );
  }

  /* T7 — 어떤 응답에도 refresh_token 이 실려 나가면 안 된다 */
  {
    const id = "contract-leak";
    seedSession(id, 1);
    const r = await post("/api/auth/refresh", { session_id: id });
    check(
      "T7 갱신 응답 본문에 refresh_token 문자열 0건 (부재 검사)",
      !r.text.includes("refresh_token"),
      `응답에 refresh_token 이 실려 있다: ${r.text.slice(0, 200)}`
    );
  }

  /* T8 — 빌드 산출물(브라우저로 내려가는 코드)에 refresh token 흔적 0건 */
  {
    const assetsDir = join(process.cwd(), "dist", "assets");
    selfCheck(existsSync(assetsDir), "dist/assets 가 없다 — npm run build 를 먼저 돌려라");
    const jsFiles = readdirSync(assetsDir).filter(f => f.endsWith(".js"));
    selfCheck(jsFiles.length > 0, "dist/assets 에 .js 가 0건 — 빌드 산출물이 비었다 (검사기 고장)");
    const hits = [];
    for (const f of jsFiles) {
      const src = readFileSync(join(assetsDir, f), "utf8");
      if (src.includes("refresh_token")) hits.push(f);
    }
    check(
      `T8 빌드 산출물 ${jsFiles.length}개에 refresh_token 0건 (부재 검사)`,
      hits.length === 0,
      `refresh_token 이 들어 있는 번들: ${hits.join(", ")}`
    );
  }

  /* T9 — 클라이언트 소스가 refresh token 을 브라우저 저장소에 넣지 않는다 */
  {
    const authSrc = join(process.cwd(), "src", "services", "googleAuthService.ts");
    selfCheck(existsSync(authSrc), `${authSrc} 가 없다 — 검사 대상이 사라졌다 (검사기 고장)`);
    const src = readFileSync(authSrc, "utf8");
    check(
      "T9 googleAuthService 가 refresh_token 을 다루지 않음 (부재 검사)",
      !src.includes("refresh_token"),
      "클라이언트 소스에 refresh_token 이 등장한다 — 서버에만 두기로 한 계약 위반"
    );
    check(
      "T10 googleAuthService 가 access_type=offline 으로 요청",
      src.includes("offline"),
      "access_type 이 offline 이 아니면 구글이 refresh token 을 주지 않는다"
    );
  }

  /* T12 — 유휴 상한은 "사용자 조작" 기준이어야 한다.
         자동 갱신은 사용자가 아무것도 안 해도 55분마다 돈다. 서버가 갱신 때마다
         last_used_at 을 밀면 유휴 12시간에 영원히 도달하지 못한다.
         그래서 클라이언트가 마지막 조작 시각(last_active_at)을 함께 보내고,
         서버는 DB 기준(고아 세션)과 조작 기준(무조작) 둘 중 하나라도 넘으면 폐기한다.
         이 검사는 DB 의 last_used_at 이 방금인데도 조작 기준으로 만료되는지를 본다. */
  {
    const id = "contract-inactive";
    seedSession(id, 0); // DB 기준으로는 방금 쓴 세션
    const staleActive = new Date(Date.now() - (IDLE_LIMIT_HOURS + 1) * 3600 * 1000).toISOString();
    const r = await post("/api/auth/refresh", { session_id: id, last_active_at: staleActive });
    check(
      `T12 DB 는 최신이지만 사용자 무조작 ${IDLE_LIMIT_HOURS + 1}시간 → 401 reason=idle_expired`,
      r.status === 401 && r.json?.reason === "idle_expired",
      `실제: status=${r.status} reason=${r.json?.reason} — 자동 갱신이 유휴 상한을 무한정 밀어내고 있다`
    );
    check(
      "T12-b 무조작 만료 세션의 D1 행이 삭제됨 (부재 검사)",
      countSession(id) === 0,
      `행이 ${countSession(id)}건 남아 있다`
    );
  }

  /* T13 — pagehide 에서 서버 세션을 폐기하면 안 된다.
         pagehide 는 탭을 닫을 때만이 아니라 새로고침(F5)에서도 발화한다.
         거기서 revoke 를 부르면 새로고침이 곧 로그아웃이 되고, 더 나쁘게는
         sessionStorage 는 살아남아 화면만 로그인 상태로 보이는 "죽은 척"이 된다.
         탭을 닫으면 sessionStorage 가 사라지므로 애초에 revoke 가 필요 없다. */
  {
    const appSrc = join(process.cwd(), "src", "App.tsx");
    selfCheck(existsSync(appSrc), "src/App.tsx 가 없다 (검사기 고장)");
    const src = readFileSync(appSrc, "utf8");
    check(
      "T13 App.tsx 가 pagehide 를 세션 폐기에 연결하지 않음 (부재 검사)",
      !src.includes("pagehide"),
      "pagehide 리스너가 남아 있다 — 새로고침이 로그아웃이 된다"
    );
    const authSrc2 = readFileSync(join(process.cwd(), "src", "services", "googleAuthService.ts"), "utf8");
    check(
      "T13-b googleAuthService 에 sendBeacon 폐기 경로가 없음 (부재 검사)",
      !authSrc2.includes("sendBeacon"),
      "sendBeacon 폐기 경로가 남아 있다 — 어디선가 다시 연결될 수 있다"
    );
  }

  /* T11 — 테이블이 마이그레이션 파일로 만들어져야 한다.
         로컬 D1 상태는 gitignore 라, 마이그레이션 없이 손으로 만든 테이블로도
         위 검사는 전부 통과한다 — 그 구멍을 막는 검사다. */
  {
    const migDir = join(process.cwd(), "migrations");
    selfCheck(existsSync(migDir), "migrations/ 가 없다 (검사기 고장)");
    const sqlFiles = readdirSync(migDir).filter(f => f.endsWith(".sql"));
    selfCheck(sqlFiles.length > 0, "migrations/ 에 .sql 이 0건 (검사기 고장)");
    const creators = sqlFiles.filter(f => {
      const sql = readFileSync(join(migDir, f), "utf8");
      return /CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?auth_sessions/i.test(sql);
    });
    check(
      "T11 auth_sessions 를 만드는 마이그레이션 파일이 존재",
      creators.length === 1,
      `해당 마이그레이션이 ${creators.length}건이다 (1건이어야 함): ${sqlFiles.join(", ")}`
    );
  }

  cleanup();

  console.log(`\n결과: 통과 ${pass}건 / 실패 ${fail}건`);
  if (fail > 0) {
    console.log("\n실패 목록:");
    failures.forEach(f => console.log(`  - ${f}`));
  }
  selfCheck(pass + fail >= 18, `검사가 ${pass + fail}건만 돌았다 — 18건 이상이어야 한다 (검사기 고장)`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`\n[검사기 예외] ${err.stack}`);
  process.exit(2);
});
