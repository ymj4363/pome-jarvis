/** 기존 오류 메시지에 HTTP 상태를 함께 전달 */
export class HttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

export function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function nowLabel() {
  return new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());
}

