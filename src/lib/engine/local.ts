import type { ChatResult, ChatTurn, NexyEngine } from "./types";
import { readCompletion } from "./sse";
import { quietChat } from "../quiet.ts";

const URL_ = (process.env.NEXY_LLM_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const MODEL = process.env.NEXY_MODEL ?? "router/router:txt2txt";
// 1024 cut a 600-word guide mid-sentence; local models have the context for this much
const MAX_TOKENS = Number(process.env.NEXY_MAX_TOKENS) || 4096;

export const localEngine: NexyEngine = {
  id: "local",

  available: () => true,

  async chat(message, history, system, signal, _session, onText): Promise<ChatResult> {
    const messages = [
      { role: "system", content: `<no_think>\n${system}` },
      ...history.map((t: ChatTurn) => ({ role: t.role, content: t.content })),
      { role: "user", content: message },
    ];

    const res = await quietChat(URL_, { model: MODEL, messages, max_tokens: MAX_TOKENS, stream: !!onText }, signal ?? AbortSignal.timeout(240_000));

    // the server's own words go into the log, never on screen; a shared Own 1's are read (lib/guest.ts)
    if (!res.ok) throw new Error(`llama-swap ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
    const { content, last } = await readCompletion(res, onText);
    return { reply: content, via: "local", grounded: false, cut: last?.choices?.[0]?.finish_reason === "length", tools: [] };
  },
};
