// An engine's own failure ("agent gateway 404: …") is logged for the owner and said plainly on screen.
export function engineFailure(e: unknown, what: string): { error: string } {
  const raw = String((e as any)?.message ?? e);
  console.warn(`[nexy] ${what}: ${raw.slice(0, 300)}`);
  const missing = /\b(404|405|501)\b/.test(raw);
  return {
    error: missing
      ? "The agent engine on this machine can't do that yet. An update to it will add it."
      : "The agent engine didn't answer just now. Try again in a moment.",
  };
}
