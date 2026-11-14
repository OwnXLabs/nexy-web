// How long an engine call may run. Text arriving means the engine is alive, so the limit is on
// silence, not on the whole answer: `quietMs` for the first words and between any two, under a
// hard `capMs` for the whole call, so a reply still being written is never cut short.
export const CAP_MS = Number(process.env.NEXY_AGENT_CAP_MS ?? 10 * 60_000);

export type Budget = {
  signal: AbortSignal;
  /** Call with each piece of text as it arrives. */
  heard(delta: string): void;
  /** The text so far. */
  readonly text: string;
  /** Why the call was stopped: null while it may still run. */
  readonly stopped: "quiet" | "cap" | null;
  end(): void;
};

export function budget(quietMs: number, capMs = CAP_MS): Budget {
  const c = new AbortController();
  let text = "", stopped: Budget["stopped"] = null;
  const stop = (why: "quiet" | "cap", ms: number) => () => {
    stopped = why;
    const secs = Math.round(ms / 1000);
    c.abort(new DOMException(why === "cap" ? `the reply ran past ${secs} s` : `no reply text for ${secs} s`, "TimeoutError"));
  };
  let quiet = setTimeout(stop("quiet", quietMs), quietMs);
  const cap = setTimeout(stop("cap", capMs), capMs);
  return {
    signal: c.signal,
    heard(d) {
      if (stopped) return;
      text += d;
      clearTimeout(quiet);
      quiet = setTimeout(stop("quiet", quietMs), quietMs);
    },
    get text() { return text; },
    get stopped() { return stopped; },
    end() { clearTimeout(quiet); clearTimeout(cap); },
  };
}
