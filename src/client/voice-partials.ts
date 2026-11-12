// Live words while the user holds to talk: the recording so far is re-read on this machine at a fixed
// interval. Only one read runs at a time; a tick that finds one still running is skipped. If reads keep
// taking far longer than the interval (a slow computer), the live words stop and only the final one shows.

export interface PartialOpts {
  every: number; // ms between reads
  job: () => Promise<string | null>; // the words so far, or null to show nothing new (busy, too short)
  onText: (text: string) => void;
  onSlow?: () => void;
  slowMs?: number; // a read longer than this counts as slow; two in a row stop the live words
  now?: () => number;
  timer?: { set: (f: () => void, ms: number) => unknown; clear: (h: unknown) => void };
}

export interface Partials {
  stop(): void;
  stats(): { runs: number; skips: number; slow: boolean; ms: number[] };
}

export function partialScheduler(o: PartialOpts): Partials {
  const now = o.now ?? (() => performance.now());
  const timer = o.timer ?? { set: (f: () => void, ms: number) => setInterval(f, ms), clear: (h: unknown) => clearInterval(h as ReturnType<typeof setInterval>) };
  const slowMs = o.slowMs ?? 3000;
  let busy = false, stopped = false, runs = 0, skips = 0, slowRow = 0, slow = false;
  const ms: number[] = [];
  const tick = () => {
    if (stopped) return;
    if (busy) { skips++; return; }
    busy = true; runs++;
    const t0 = now();
    o.job().then(
      (text) => { if (!stopped && text !== null) o.onText(text); },
      (e) => { console.warn("[nexy] live words skipped", e); },
    ).finally(() => {
      busy = false;
      const d = now() - t0;
      ms.push(d);
      slowRow = d > slowMs ? slowRow + 1 : 0;
      if (slowRow >= 2 && !stopped) { slow = true; stop(); o.onSlow?.(); }
    });
  };
  const h = timer.set(tick, o.every);
  const stop = () => { if (stopped) return; stopped = true; timer.clear(h); };
  return { stop, stats: () => ({ runs, skips, slow, ms: [...ms] }) };
}
