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

// name: what a reply says it came via
export function openclawEngine(url: string, key: string, agent = DEFAULT_AGENT, name = "openclaw"): NexyEngine {
  const URL_ = url.replace(/\/+$/, "");
  return {
    id: "gateway",
    upstream: "OpenClaw's agent gateway on this machine; memory is not kept by Nexy, only by OpenClaw itself",
    available: () => URL_ !== "",
    async chat(message, history, system, signal, session, onText): Promise<ChatResult> {
      if (!URL_) throw new Error("no OpenClaw gateway is configured for this turn");
      const messages = [
        { role: "system", content: system },
        ...history.map((t: ChatTurn) => ({ role: t.role, content: t.content })),
        { role: "user", content: message },
      ];
      const req = openclawRequest(URL_, key, agent, messages, !!onText, session);
      const res = await fetch(req.url, { ...req.init, signal: signal ?? AbortSignal.timeout(240_000) });
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
