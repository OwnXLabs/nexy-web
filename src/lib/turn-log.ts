// Nexy's own turn log: one JSON line per event on stdout, kept by the journal across restarts.
// Never for an ultra-private chat.
export function logTurn(endpoint: string, fields: Record<string, unknown>, isPrivate = false): void {
  if (isPrivate) return;
  try {
    console.log(JSON.stringify({ at: new Date().toISOString(), endpoint, ...fields }));
  } catch (e) { console.warn("[nexy] a turn line could not be written", (e as Error).message); }
}

// where the error happened, when the builder or the run check says: "(line 42:7)", "(line 214: `code`)" or "app.js:42:7"
export function whereIn(error: string): string | undefined {
  const line = /\(line (\d{1,6})(?::(\d{1,6}))?(?:\)|: `)/.exec(error);
  if (line) return line[2] ? `line ${line[1]}:${line[2]}` : `line ${line[1]}`;
  const file = /([\w./-]{1,80}\.(?:m?js|ts|html?|css|json)):(\d{1,6})(?::(\d{1,6}))?/.exec(error);
  return file ? `${file[1]}:${file[2]}${file[3] ? `:${file[3]}` : ""}` : undefined;
}
