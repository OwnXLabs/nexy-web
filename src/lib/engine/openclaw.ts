import type { ChatResult, ChatTurn, NexyEngine } from "./types";
import { readCompletion } from "./sse";

// OpenClaw's gateway: the OpenAI chat API only (docs/gateway/openai-http-api.md). It keeps no
// sessions or jobs Nexy can read, so this engine has no memory, routines or browser view.
// model: an agent target, "openclaw/default" or "openclaw/<agentId>".
export const DEFAULT_AGENT = "openclaw/default";

// one OpenClaw session per Nexy chat. Safe characters only, so a key can never name one of its
// own kinds (subagent:, cron:, acp:).
export function sessionKey(session: string): string {
  const safe = session.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 96);
  return safe ? `nexy-${safe}` : "";
}

export function openclawRequest(url: string, key: string, agent: string, messages: unknown[], stream: boolean, session?: string): { url: string; init: RequestInit } {
  const sk = session ? sessionKey(session) : "";
  return {
    url: `${url.replace(/\/+$/, "")}/v1/chat/completions`,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(key ? { authorization: `Bearer ${key}` } : {}),
        ...(sk ? { "x-openclaw-session-key": sk } : {}),
      },
      body: JSON.stringify({ model: agent || DEFAULT_AGENT, messages, stream, ...(sk ? { user: sk } : {}) }),
    },
  };
}

// Its own system prompt is long: a trivial turn took 48 s on the box, against 7-9 s for the others
export const QUIET_MS = Number(process.env.NEXY_ENGINE_OPENCLAW_BUDGET_MS ?? 120_000);
// For a few seconds after a restart the gateway answers 500 "internal error": asked once more
export const RETRY_MS = Number(process.env.NEXY_ENGINE_OPENCLAW_RETRY_MS ?? 3_000);

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((ok, no) => {
  if (signal?.aborted) return no(signal.reason);
  const t = setTimeout(ok, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); no(signal.reason); }, { once: true });
});

// name: what a reply says it came via
export function openclawEngine(url: string, key: string, agent = DEFAULT_AGENT, name = "openclaw"): NexyEngine {
  const URL_ = url.replace(/\/+$/, "");
  return {
    id: "gateway",
    upstream: "OpenClaw's agent gateway on this machine; memory is not kept by Nexy, only by OpenClaw itself",
    quietMs: QUIET_MS,
    // a cold prompt cache: about 40 s on the first turn after a pause or an engine switch
    waitNote: "OpenClaw is getting ready…",
    available: () => URL_ !== "",
    async chat(message, history, system, signal, session, onText): Promise<ChatResult> {
      if (!URL_) throw new Error("no OpenClaw gateway is configured for this turn");
      const messages = [
        { role: "system", content: system },
        ...history.map((t: ChatTurn) => ({ role: t.role, content: t.content })),
        { role: "user", content: message },
      ];
      const req = openclawRequest(URL_, key, agent, messages, !!onText, session);
      const sig = signal ?? AbortSignal.timeout(240_000);
      let res = await fetch(req.url, { ...req.init, signal: sig });
      if (res.status === 500) {
        await res.body?.cancel();
        console.warn(`[nexy] openclaw gateway 500, asking once more in ${Math.round(RETRY_MS / 1000)} s`);
        await wait(RETRY_MS, sig);
        res = await fetch(req.url, { ...req.init, signal: sig });
      }
      // the status only: a body could echo the request
      if (!res.ok) throw new Error(`openclaw gateway ${res.status}`);
      const { content: reply, last } = await readCompletion(res, onText);
      const finish = last?.choices?.[0]?.finish_reason;
      if (finish === "error") throw new Error("openclaw gateway upstream failed");
      if (!reply.trim()) throw new Error("openclaw gateway gave no reply");
      return { reply, via: name, grounded: true, cut: finish === "length" };
    },
  };
}
