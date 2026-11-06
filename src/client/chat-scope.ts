// A scope is captured before an async job starts. Only synchronous callbacks enter it;
// never leave a global "current job" set across an await.
let selected = "";
let target: string | undefined;
export const chatScope = () => target ?? selected;
export const visibleChat = () => selected;
export function inChat<T>(id: string, fn: () => T): T {
  const prev = target;
  target = id;
  try { return fn(); } finally { target = prev; }
}
export function bindChat<A extends unknown[], R>(fn: (...args: A) => R, id = chatScope()): (...args: A) => R {
  return (...args) => inChat(id, () => fn(...args));
}
export function selectChat(id: string): void {
  selected = id;
  window.dispatchEvent(new CustomEvent("nexy:chat-selected", { detail: id }));
}
