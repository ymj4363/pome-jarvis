import type { LogEntry } from "../types";
import { makeId, nowLabel } from "./utils";

export function createLog(entry: Omit<LogEntry, "id" | "createdAt">): LogEntry {
  return {
    ...entry,
    id: makeId("log"),
    createdAt: nowLabel()
  };
}

