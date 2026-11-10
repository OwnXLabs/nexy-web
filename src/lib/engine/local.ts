import type { ChatResult, ChatTurn, NexyEngine } from "./types";
import { readCompletion } from "./sse";

const URL_ = (process.env.NEXY_LLM_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const MODEL = process.env.NEXY_MODEL ?? "router/router:txt2txt";

export const localEngine: NexyEngine = {
  id: "local",

  available: () => true,

  async chat(message, history, system, signal, _session, onText): Promise<ChatResult> {
    const messages = [
      { role: "system", content: `<no_think>\n${system}` },
      ...history.map((t: ChatTurn) => ({ role: t.role, content: t.content })),
      { role: "user", content: message },
    ];

    const res = await fetch(`${URL_}/v1/chat/completions`, {
      method: "POST",
      signal: signal ?? AbortSignal.timeout(240_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 1024,
        chat_template_kwargs: { enable_thinking: false },
        stream: !!onText,
      }),
    });

    if (!res.ok) throw new Error(`llama-swap ${res.status}`);
    const { content } = await readCompletion(res, onText);
    return { reply: content, via: "local", grounded: false };
  },
};
