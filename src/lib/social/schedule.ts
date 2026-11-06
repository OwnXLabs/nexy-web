import type { Draft, Network, Slot, SocialState } from "./types.ts";

const TIMES = ["09:00", "12:30", "17:00"];

const hhmm = (s: string): [number, number] => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return [9, 0];
  return [Math.min(23, Number(m[1])), Math.min(59, Number(m[2]))];
};

function slotTime(from: Date, days: number, time: string): number {
  const [h, mi] = hhmm(time);
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + days, h, mi, 0, 0);
  return d.getTime();
}

export interface PlanOptions {
  now?: number;
  startInDays?: number;
  perDay?: number;
  times?: string[];
  cadence?: Partial<Record<Network, number>>;
}

export function plan(drafts: Draft[], opts: PlanOptions = {}): Slot[] {
  const live = drafts.filter((d) => !d.off);
  const times = opts.times?.length ? opts.times : TIMES;
  const perDay = Math.max(1, Math.floor(opts.perDay ?? 2));
  const from = new Date(opts.now ?? Date.now());
  const start = Math.max(0, Math.floor(opts.startInDays ?? 1));

  if (opts.cadence) {
    const seen: Partial<Record<Network, number>> = {};
    return live.flatMap((d) => {
      const perWeek = opts.cadence![d.net] ?? 0;
      if (perWeek <= 0) return [];
      const k = seen[d.net] = (seen[d.net] ?? -1) + 1;
      return [{
        id: `s_${d.id}`,
        draftId: d.id,
        net: d.net,
        at: slotTime(from, start + Math.floor((k * 7) / perWeek), times[k % times.length]),
        state: "scheduled" as const,
      }];
    });
  }

  return live.map((d, i) => {
    const day = start + Math.floor(i / perDay);
    const time = times[i % times.length];
    return {
      id: `s_${d.id}`,
      draftId: d.id,
      net: d.net,
      at: slotTime(from, day, time),
      state: "scheduled" as const,
    };
  });
}

export function applyPause(s: SocialState): void {
  for (const slot of s.schedule) slot.state = s.paused ? "held" : "scheduled";
}

export function upcoming(s: SocialState, n = 6, now = Date.now()): Slot[] {
  return [...s.schedule].filter((x) => x.at >= now).sort((a, b) => a.at - b.at).slice(0, n);
}

export function days(s: SocialState, n = 14, now = Date.now()): { date: Date; slots: Slot[] }[] {
  const base = new Date(now);
  const out: { date: Date; slots: Slot[] }[] = [];
  for (let i = 0; i < n; i++) {
    const date = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const end = date.getTime() + 86_400_000;
    out.push({
      date,
      slots: s.schedule.filter((x) => x.at >= date.getTime() && x.at < end).sort((a, b) => a.at - b.at),
    });
  }
  return out;
}
