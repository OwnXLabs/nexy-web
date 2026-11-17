// An engine's own failure ("agent gateway 404: …") is logged for the owner and said plainly on screen:
// the engine's own explanation when it gives one, never the status code or transport words.
export function engineFailure(e: unknown, what: string): { error: string } {
  const raw = String((e as any)?.message ?? e);
  console.warn(`[nexy] ${what}: ${raw.slice(0, 300)}`);
  const r = refusal(raw);
  if (r) return { error: r.message };
  const m = /^agent gateway (?:upstream failed: )?(\d{3})?:?\s*(.*)$/s.exec(raw.trim());
  const code = m?.[1] ? Number(m[1]) : 0;
  const detail = (m ? m[2] : raw).trim();
  // a plain sentence from the engine (a routine waiting for confirmation, an unknown id) is passed on
  if (detail && code >= 400 && code < 500 && !/^(not found|method not allowed|<)/i.test(detail) && !/\b\d{3}\b/.test(detail))
    return { error: detail.slice(0, 200) };
  if ([404, 405, 501].includes(code)) return { error: "The agent engine on this machine can't do that yet. An update to it will add it." };
  return { error: "The agent engine didn't answer just now. Try again in a moment." };
}

// The app's router refuses in plain words, OpenAI-style, and the engine passes them on inside its
// own text: `model server 429: {"error":{"message":"…"}}` (Nexy Engine), `llama-swap 503: {…}` (the model alone).
const KIND = { 503: "model-offline", 429: "model-limit", 403: "model-denied" } as const;
export type Refusal = { code: keyof typeof KIND; message: string; result: (typeof KIND)[keyof typeof KIND] };

/** The router's own sentence for a refusal (offline or busy, daily limit, code no longer valid), or null. */
export function refusal(e: unknown): Refusal | null {
  const raw = String((e as any)?.message ?? e);
  const m = /\b(403|429|503):\s*(\{.*)$/s.exec(raw);
  if (!m) return null;
  const code = Number(m[1]) as Refusal["code"];
  let said: unknown;
  try { said = JSON.parse(m[2])?.error?.message; }
  catch {
    // cut short on the way here: the sentence counts only when its closing quote arrived
    const q = /"error"\s*:\s*\{\s*(?:"[^"]*"\s*:\s*"(?:[^"\\]|\\.)*"\s*,\s*)*"message"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(m[2])?.[1];
    try { said = q ? JSON.parse(q) : undefined; } catch { said = undefined; }
  }
  if (typeof said !== "string") return null;
  const message = said.replace(/\s+/g, " ").trim();
  // only a sentence for a person: no markup, no status codes, not a wall of text
  if (!/[a-z]{3}/i.test(message) || /[{}<>]/.test(message) || new RegExp(`\\b${code}\\b`).test(message) || message.length > 300) return null;
  return { code, message, result: KIND[code] };
}
