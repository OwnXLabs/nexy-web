import type { ChatResult, ChatTurn, MemoryItem, NexyEngine, Routine } from "./types";
import { readCompletion } from "./sse";

const DEFAULT_KEY = process.env.NEXY_AGENT_KEY ?? "";
const MODEL = process.env.NEXY_MODEL ?? "router/router:txt2txt";

// where a turn goes, by engine; Hermes' wording for any other gateway
const UPSTREAM: Record<string, string> = {
  "nexy-engine": "Nexy Engine, the agent engine on this machine, which keeps its own sessions and memory",
};
const HERMES_UPSTREAM = "the agent gateway, which keeps memory and sessions";

// name: what a reply says it came via (an engine picked in Settings says which); the kind stays "gateway"
export function gatewayEngine(url: string, KEY: string = DEFAULT_KEY, name = "gateway"): NexyEngine {
  const URL_ = url.replace(/\/+$/, "");
  const api = async (path: string, init: RequestInit = {}): Promise<any> => {
    if (!URL_) throw new Error("no agent gateway is configured");
    const res = await fetch(`${URL_}${path}`, {
      ...init, signal: init.signal ?? AbortSignal.timeout(30_000),
      headers: { "content-type": "application/json", ...(KEY ? { authorization: `Bearer ${KEY}` } : {}), ...(init.headers ?? {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`agent gateway ${res.status}: ${String(body?.error ?? "").slice(0, 120)}`);
    return body;
  };
  // a numeric job id, as the agent names its run sessions after it; "" for any other
  const runId = (v: unknown): string => (/^\d+$/.test(String(v ?? "")) ? String(v) : "");
  const when = (v: unknown): string | null => (v == null || v === "" ? null : typeof v === "number" ? new Date(v * (v < 1e12 ? 1000 : 1)).toISOString() : String(v));
  const sessions = async (): Promise<any[]> => (await api("/api/sessions?limit=200"))?.data ?? [];
  const toItem = (x: any): MemoryItem => ({ id: String(x.id), title: String(x.title ?? "Untitled"), source: String(x.source ?? ""), startedAt: typeof x.started_at === "number" ? x.started_at * 1000 : null, messages: Number(x.message_count ?? 0) });
  const lastReply = async (id: string): Promise<string | undefined> => {
    const m = await api(`/api/sessions/${encodeURIComponent(id)}/messages`);
    const list: any[] = m?.data ?? m?.messages ?? [];
    const a = [...list].reverse().find((x) => x?.role === "assistant" && typeof x?.content === "string" && x.content.trim());
    return a?.content;
  };
  // the gateway writes each tool call as it runs, newest last. Nexy Engine stamps them in whole
  // seconds, so a search in the turn's first second is counted from the start of that second.
  const callsSince = async (session: string, since: number): Promise<{ name: string; text: string }[] | null> => {
    const m = await api(`/api/sessions/${encodeURIComponent(`nexy-${session}`)}/messages?limit=40`).catch((e: Error) => {
      if (/^agent gateway 404\b/.test(e.message)) return null; // the first turn has not started yet
      throw e;
    });
    if (!m) return null;
    const list: any[] = m?.data ?? [];
    const from = Math.floor(since / 1000) * 1000;
    return list.filter((x) => x?.role === "tool" && Number(x?.timestamp) * 1000 >= from && x?.tool_name)
      .map((x) => ({ name: String(x.tool_name), text: typeof x?.content === "string" ? x.content : JSON.stringify(x?.content ?? "") }));
  };
  const toolsSince = async (session: string, since: number): Promise<string[] | null> => (await callsSince(session, since))?.map((c) => c.name) ?? null;
  return {
    id: "gateway",
    upstream: UPSTREAM[name] ?? HERMES_UPSTREAM,

    available: () => URL_ !== "",

    async chat(message, history, system, signal, session, onText, opts): Promise<ChatResult> {
      if (!URL_) throw new Error("no agent gateway is configured for this turn");
      const messages = [
        { role: "system", content: system },
        ...history.map((t: ChatTurn) => ({ role: t.role, content: t.content })),
        { role: "user", content: message },
      ];

      const res = await fetch(`${URL_}/v1/chat/completions`, {
        method: "POST",
        signal: signal ?? AbortSignal.timeout(240_000),
        headers: {
          "content-type": "application/json",
          ...(KEY ? { authorization: `Bearer ${KEY}` } : {}),
          // without it the gateway derives the session from the system prompt, which changes every
          // turn, so each turn opened a fresh browser on about:blank. It needs the key to be honoured.
          ...(KEY && session ? { "X-Hermes-Session-Id": `nexy-${session}` } : {}),
          ...(opts?.user ? { "x-nexy-user": opts.user } : {}),
        },
        // vouch for the system message only when the caller says it holds nothing from outside
        body: JSON.stringify({ model: "nexy", messages, stream: !!onText, ...(opts?.outside === false ? { context_clean: true } : {}), ...(opts?.tz ? { tz: opts.tz } : {}), ...(opts?.research ? { research: true } : {}) }),
      });

      if (!res.ok) {
        throw new Error(`agent gateway ${res.status}`);
      }
      const { content: reply, last: body } = await readCompletion(res, onText);
      // 0.22 marks a failed turn in the response itself; its reply text changes between
      // versions (an overload read "…send /retry, or switch models with /model…", which
      // reached a visitor on 2026-10-24), so trust the flag before the wording
      if (body?.choices?.[0]?.finish_reason === "error" || body?.hermes?.failed === true) {
        const why = `${body?.hermes?.error ?? ""} ${reply}`;
        throw new Error(/\b429\b|too many requests|rate.?limit/i.test(why)
          ? "agent gateway busy: the model is serving other requests"
          : `agent gateway upstream failed: ${String(body?.hermes?.error ?? "the turn failed").slice(0, 120)}`);
      }
      // The engine reports its own faults as an ordinary reply: "API call failed after
      // 3 retries: …", or "⚠ Provider authentication failed: /var/lib/hermes/…". Never a
      // reply to show anyone.
      const fault = /^API call failed after \d+ retries?: (.*)$/s.exec(reply.trim())?.[1]
        ?? /^\s*⚠\uFE0F?\s*(.*)$/s.exec(reply)?.[1];
      if (fault !== undefined) {
        throw new Error(/\b429\b/.test(fault)
          ? "agent gateway busy: the model is serving other requests"
          : `agent gateway upstream failed: ${fault.slice(0, 120)}`);
      }
      // Nexy Engine says what it ran in the reply itself ("nexy": {tools, …})
      const strs = (v: unknown) => (Array.isArray(v) ? v.map(String).slice(0, 40) : undefined);
      return { reply, via: name, grounded: true, cut: body?.choices?.[0]?.finish_reason === "length", tools: strs(body?.nexy?.tools), sources: strs(body?.nexy?.sources) };
    },

    browsed: async (session, since) => ((await toolsSince(session, since)) ?? []).some((t) => /^browser_/.test(t)),
    toolsSince,
    callsSince,
    memory: {
      async list() { return (await sessions()).map(toItem); },
      async export() {
        const out = [];
        for (const x of await sessions()) {
          const m = await api(`/api/sessions/${encodeURIComponent(x.id)}/messages`);
          out.push({ id: String(x.id), title: String(x.title ?? ""), messages: m?.data ?? m?.messages ?? [] });
        }
        return out;
      },
      async forget(id?: string) {
        const ids = id ? [id] : (await sessions()).map((x) => String(x.id));
        for (const one of ids) await api(`/api/sessions/${encodeURIComponent(one)}`, { method: "DELETE" });
        return ids.length;
      },
    },

    routines: {
      async list() {
        const jobs: any[] = (await api("/api/jobs"))?.jobs ?? [];
        const all = await sessions().catch(() => [] as any[]);
        const out: Routine[] = [];
        for (const j of jobs) {
          // a run's session: "cron-<id>-…" or "event-<id>-…" where the agent names it so, else a
          // scheduled session titled with the routine's name
          const sid = runId(j.id);
          const mine = (x: any) => (sid !== "" && [`cron-${sid}-`, `event-${sid}-`].some((p) => String(x.id ?? "").startsWith(p)))
            || (/cron|^event$/i.test(String(x.source ?? "")) && String(x.title ?? "").includes(String(j.name ?? "\u0000")));
          const run = all.filter(mine).sort((a, b) => (b.started_at ?? 0) - (a.started_at ?? 0))[0];
          out.push({
            id: String(j.id), name: String(j.name ?? ""), prompt: String(j.prompt ?? ""), enabled: j.enabled !== false,
            schedule: typeof j.schedule === "string" ? j.schedule : String(j.schedule?.expr ?? j.schedule?.display ?? j.schedule_display ?? JSON.stringify(j.schedule ?? "")),
            nextRunAt: when(j.next_run_at), lastRunAt: when(j.last_run_at), lastStatus: j.last_status ?? null,
            lastResult: run ? (await lastReply(String(run.id)).catch(() => undefined))?.slice(0, 1500) : undefined,
            pending: j.status === "pending", origin: j.origin == null ? null : String(j.origin),
            tz: typeof j.tz === "string" ? j.tz : null,
            // runs when this event arrives instead of on a schedule: "mail from=a@example.com"
            trigger: typeof j.trigger === "string" && j.trigger.trim() ? j.trigger : null,
          });
        }
        return out;
      },
      async create(r) {
        const post = async (schedule: string, tz?: string) => (await api("/api/jobs", { method: "POST", body: JSON.stringify({ name: r.name, schedule, prompt: r.prompt, deliver: "local", ...(tz ? { tz } : {}) }) }))?.job ?? {};
        let schedule = r.schedule, j = await post(schedule, r.tz);
        // an agent that does not keep zones read the local schedule as UTC: replace it with the UTC one
        if (r.tz && r.tz !== "UTC" && j.tz !== r.tz) {
          if (j.id != null) await api(`/api/jobs/${encodeURIComponent(String(j.id))}`, { method: "DELETE" });
          if (!r.utcSchedule) throw new Error("this agent reads routine times in UTC only");
          schedule = r.utcSchedule; j = await post(schedule);
        }
        return { id: String(j.id ?? ""), name: r.name, schedule, prompt: r.prompt, enabled: true, nextRunAt: when(j.next_run_at), lastRunAt: null, lastStatus: null, tz: typeof j.tz === "string" ? j.tz : null };
      },
      async remove(id) { await api(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" }); },
      async confirm(id, tz) {
        const b = await api(`/api/jobs/${encodeURIComponent(id)}/confirm`, { method: "POST", ...(tz ? { body: JSON.stringify({ tz }) } : {}) });
        return { nextRunAt: when(b?.job?.next_run_at), tz: typeof b?.job?.tz === "string" ? b.job.tz : null };
      },
      async discard(id) { await api(`/api/jobs/${encodeURIComponent(id)}/discard`, { method: "POST" }); },
      async setPaused(id, paused) {
        const b = await api(`/api/jobs/${encodeURIComponent(id)}/${paused ? "pause" : "resume"}`, { method: "POST" });
        return { enabled: typeof b?.job?.enabled === "boolean" ? b.job.enabled : !paused, nextRunAt: when(b?.job?.next_run_at) };
      },
      // a model run: as long as a chat turn may take
      async runNow(id) {
        const b = await api(`/api/jobs/${encodeURIComponent(id)}/run`, { method: "POST", signal: AbortSignal.timeout(240_000) });
        if (typeof b?.run?.reply !== "string") throw new Error("the agent gave no result for this run");
        return { reply: b.run.reply };
      },
    },
  };
}

export const hermesEngine = gatewayEngine(process.env.NEXY_AGENT_URL ?? "");

export const testEngine = gatewayEngine(process.env.NEXY_TEST_AGENT_URL ?? "");
