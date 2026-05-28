import { spawn, execSync } from "child_process";
import { createServer } from "http";
import { randomUUID } from "crypto";
import { existsSync, readdirSync, statSync } from "fs";
import { join, dirname, parse } from "path";

// claude CLI 경로 자동 탐색
function findClaude() {
  try {
    const result = execSync("where claude", { encoding: "utf8" }).trim().split("\n")[0].trim();
    if (result) return result;
  } catch {}
  const candidates = [
    process.env.APPDATA + "\\npm\\claude.cmd",
    process.env.APPDATA + "\\npm\\claude",
    "C:\\Program Files\\nodejs\\claude.cmd",
  ];
  for (const c of candidates) { if (existsSync(c)) return c; }
  return "claude"; // 마지막 시도
}

const CLAUDE_PATH = findClaude();
console.log(`[Claude CLI] ${CLAUDE_PATH}`);

const PORT = 3001;
const MAX_AGENTS = 10;

const agents = new Map(); // id → { process, status, output, startedAt, ... }
const sseClients = new Map(); // id → Set<res>

function broadcast(id, data) {
  const clients = sseClients.get(id);
  if (!clients) return;
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try { res.write(msg); } catch {}
  }
}

function runningCount() {
  let n = 0;
  for (const a of agents.values()) if (a.status === "running") n++;
  return n;
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function json(res, status, body) {
  cors(res);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => (data += c));
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { reject(new Error("Invalid JSON")); } });
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = url.pathname;

  if (req.method === "OPTIONS") { cors(res); res.writeHead(204); res.end(); return; }

  // GET /api/agents — 목록
  if (req.method === "GET" && path === "/api/agents") {
    const list = [...agents.entries()].map(([id, a]) => ({
      id, prompt: a.prompt, workdir: a.workdir,
      skipPermissions: a.skipPermissions,
      status: a.status, output: a.output,
      createdAt: a.createdAt, startedAt: a.startedAt,
      completedAt: a.completedAt, exitCode: a.exitCode,
    }));
    return json(res, 200, list);
  }

  // POST /api/agents — 에이전트 실행
  if (req.method === "POST" && path === "/api/agents") {
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: "Invalid body" }); }

    const { prompt, workdir = process.cwd(), skipPermissions = true } = body;
    if (!prompt) return json(res, 400, { error: "prompt required" });
    if (!existsSync(workdir)) return json(res, 400, { error: `경로를 찾을 수 없습니다: ${workdir}` });
    if (runningCount() >= MAX_AGENTS) return json(res, 429, { error: `최대 ${MAX_AGENTS}개까지 동시 실행 가능합니다.` });

    const id = randomUUID();
    const now = new Date().toISOString();
    const args = ["-p", prompt];
    if (skipPermissions) args.push("--dangerously-skip-permissions");

    const agent = {
      prompt, workdir, skipPermissions,
      status: "running", output: "",
      createdAt: now, startedAt: now,
      completedAt: null, exitCode: null,
      process: null,
    };
    agents.set(id, agent);
    sseClients.set(id, new Set());

    const proc = spawn(CLAUDE_PATH, args, {
      cwd: workdir,
      shell: false,
      env: { ...process.env },
      windowsHide: true,
    });
    agent.process = proc;

    proc.stdout.on("data", chunk => {
      const text = chunk.toString();
      agent.output += text;
      broadcast(id, { type: "stdout", text });
    });

    proc.stderr.on("data", chunk => {
      const text = chunk.toString();
      agent.output += text;
      broadcast(id, { type: "stderr", text });
    });

    proc.on("close", code => {
      agent.status = code === 0 ? "done" : "error";
      agent.exitCode = code;
      agent.completedAt = new Date().toISOString();
      agent.process = null;
      broadcast(id, { type: "close", code });
    });

    proc.on("error", err => {
      agent.status = "error";
      agent.output += `\n[실행 오류] ${err.message}`;
      agent.completedAt = new Date().toISOString();
      broadcast(id, { type: "error", message: err.message });
    });

    return json(res, 201, { id });
  }

  // GET /api/agents/:id/stream — SSE
  const streamMatch = path.match(/^\/api\/agents\/([^/]+)\/stream$/);
  if (req.method === "GET" && streamMatch) {
    const id = streamMatch[1];
    const agent = agents.get(id);
    if (!agent) return json(res, 404, { error: "not found" });

    cors(res);
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // 기존 출력 먼저 전송
    if (agent.output) {
      res.write(`data: ${JSON.stringify({ type: "stdout", text: agent.output })}\n\n`);
    }
    if (agent.status !== "running") {
      res.write(`data: ${JSON.stringify({ type: "close", code: agent.exitCode })}\n\n`);
      res.end();
      return;
    }

    sseClients.get(id).add(res);
    req.on("close", () => sseClients.get(id)?.delete(res));
    return;
  }

  // DELETE /api/agents/:id — 에이전트 종료
  const agentMatch = path.match(/^\/api\/agents\/([^/]+)$/);
  if (req.method === "DELETE" && agentMatch) {
    const id = agentMatch[1];
    const agent = agents.get(id);
    if (!agent) return json(res, 404, { error: "not found" });

    if (agent.process) {
      try { agent.process.kill("SIGTERM"); } catch {}
    }
    agent.status = "killed";
    agent.completedAt = new Date().toISOString();
    broadcast(id, { type: "killed" });
    return json(res, 200, { ok: true });
  }

  // GET /api/agents/status — 서버 상태
  if (req.method === "GET" && path === "/api/agents/status") {
    return json(res, 200, {
      running: runningCount(),
      total: agents.size,
      max: MAX_AGENTS,
    });
  }

  // GET /api/browse?path=D:\ — 폴더 탐색
  if (req.method === "GET" && path === "/api/browse") {
    const targetPath = url.searchParams.get("path") || "C:\\";
    try {
      // Windows 드라이브 루트 목록
      if (targetPath === "__drives__") {
        const drives = ["C:", "D:", "E:", "F:", "G:"].filter(d => {
          try { statSync(d + "\\"); return true; } catch { return false; }
        });
        return json(res, 200, {
          path: "__drives__",
          parent: null,
          dirs: drives.map(d => ({ name: d, path: d + "\\" })),
        });
      }
      if (!existsSync(targetPath)) return json(res, 404, { error: "경로 없음" });
      const entries = readdirSync(targetPath, { withFileTypes: true });
      const dirs = entries
        .filter(e => e.isDirectory() && !e.name.startsWith("."))
        .map(e => ({ name: e.name, path: join(targetPath, e.name) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const parsed = parse(targetPath);
      const parent = targetPath === parsed.root ? "__drives__" : dirname(targetPath);
      return json(res, 200, { path: targetPath, parent, dirs });
    } catch (e) {
      return json(res, 500, { error: String(e) });
    }
  }

  json(res, 404, { error: "not found" });
});

server.listen(PORT, () => {
  console.log(`[Jarvis Agent Server] http://localhost:${PORT}`);
  console.log(`[최대 동시 실행] ${MAX_AGENTS}개`);
});
