// An engine's own failure ("agent gateway 404: …") is logged for the owner and said plainly on screen:
// the engine's own explanation when it gives one, never the status code or transport words.
export function engineFailure(e: unknown, what: string): { error: string } {
  const raw = String((e as any)?.message ?? e);
  console.warn(`[nexy] ${what}: ${raw.slice(0, 300)}`);
  const m = /^agent gateway (?:upstream failed: )?(\d{3})?:?\s*(.*)$/s.exec(raw.trim());
  const code = m?.[1] ? Number(m[1]) : 0;
  const detail = (m ? m[2] : raw).trim();
  // a plain sentence from the engine (a routine waiting for confirmation, an unknown id) is passed on
  if (detail && code >= 400 && code < 500 && !/^(not found|method not allowed|<)/i.test(detail) && !/\b\d{3}\b/.test(detail))
    return { error: detail.slice(0, 200) };
  if ([404, 405, 501].includes(code)) return { error: "The agent engine on this machine can't do that yet. An update to it will add it." };
  return { error: "The agent engine didn't answer just now. Try again in a moment." };
}
