import type { Task } from "../types";
import { makeId } from "./utils";

export function inferOwner(sentence: string) {
  if (sentence.includes("김대리")) return "김대리";
  if (sentence.includes("박팀장")) return "박팀장";
  return "나";
}

export function inferDue(sentence: string) {
  if (sentence.includes("금요일")) return "금요일";
  if (sentence.includes("내일")) return "내일";
  if (sentence.includes("오늘")) return "오늘";
  if (sentence.includes("다음 주")) return "다음 주";
  return "미정";
}

export function sentenceToTask(sentence: string): Task {
  return {
    id: makeId("task"),
    title: sentence,
    owner: inferOwner(sentence),
    due: inferDue(sentence),
    source: "meeting",
    done: false
  };
}

