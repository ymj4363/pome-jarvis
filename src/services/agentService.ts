import type { AgentTask } from "../types";

const BASE = "http://localhost:3001";

export async function fetchAgents(): Promise<AgentTask[]> {
  const res = await fetch(`${BASE}/api/agents`);
  if (!res.ok) throw new Error("에이전트 목록 조회 실패");
  return res.json();
}

export async function runAgent(params: {
  prompt: string;
  workdir: string;
  skipPermissions: boolean;
}): Promise<{ id: string }> {
  const res = await fetch(`${BASE}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (res.status === 429) {
    const data = await res.json();
    throw new Error(data.error);
  }
  if (!res.ok) throw new Error("에이전트 실행 실패");
  return res.json();
}

export async function killAgent(id: string): Promise<void> {
  await fetch(`${BASE}/api/agents/${id}`, { method: "DELETE" });
}

export function streamAgent(
  id: string,
  onText: (text: string) => void,
  onClose: (code: number | null) => void
): () => void {
  const es = new EventSource(`${BASE}/api/agents/${id}/stream`);
  es.onmessage = e => {
    const data = JSON.parse(e.data);
    if (data.type === "stdout" || data.type === "stderr") onText(data.text);
    if (data.type === "close" || data.type === "killed" || data.type === "error") {
      onClose(data.code ?? null);
      es.close();
    }
  };
  es.onerror = () => { onClose(null); es.close(); };
  return () => es.close();
}

export async function browseDir(path: string): Promise<{
  path: string;
  parent: string | null;
  dirs: { name: string; path: string }[];
}> {
  const res = await fetch(`${BASE}/api/browse?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error("폴더 탐색 실패");
  return res.json();
}

export async function fetchAgentServerStatus(): Promise<{
  running: number;
  total: number;
  max: number;
} | null> {
  try {
    const res = await fetch(`${BASE}/api/agents/status`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}
