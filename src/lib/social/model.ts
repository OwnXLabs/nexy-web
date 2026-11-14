import type { Complete } from "./draft.ts";
import { guardIdentity } from "../engine/identity-guard.ts";
import { AGENT_KEY } from "../engine/key.ts";

const GATEWAY = process.env.NEXY_AGENT_URL ?? "";
const GATEWAY_KEY = AGENT_KEY;
const FALLBACK = process.env.NEXY_LLM_URL ?? "http://127.0.0.1:8080";
const MODEL = process.env.NEXY_MODEL ?? "router/router:txt2txt";

// what a person reads in an error: never the engine's product name
export const via = (): string => (GATEWAY ? "the agent" : "the model");

export const complete: Complete = async ({ system, user, maxTokens }) => {
  const base = GATEWAY || FALLBACK;
  const body: Record<string, unknown> = {
    model: GATEWAY ? "nexy" : MODEL,
    messages: [
      { role: "system", content: GATEWAY ? system : `<no_think>\n${system}` },
      { role: "user", content: user },
    ],
    max_tokens: Math.max(1024, maxTokens),
    stream: false,
  };
  if (!GATEWAY) body.chat_template_kwargs = { enable_thinking: false };

  const r = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(GATEWAY && GATEWAY_KEY ? { authorization: `Bearer ${GATEWAY_KEY}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(240_000),
  });

  const j: any = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(`${via()} answered ${r.status}: ${String(j?.error?.message ?? j?.error ?? "").slice(0, 160)}`);
  }
  const m = j?.choices?.[0]?.message;
  const text = [m?.content, m?.reasoning_content].filter(Boolean).join("\n\n").trim();
  if (!text) throw new Error(`${via()} returned an empty message`);
  // The agent reports its own faults as an ordinary 200 reply; these were saved as draft
  // posts reading "API call failed after 3 retries: HTTP 429".
  const fault = /^API call failed after \d+ retries?: (.*)$/s.exec(text)?.[1] ?? /^\s*⚠️?\s*(.*)$/s.exec(text)?.[1];
  if (fault !== undefined) {
    throw new Error(/\b429\b/.test(fault) ? "the model is busy with other requests; try again shortly" : `${via()} failed: ${fault.slice(0, 120)}`);
  }
  return guardIdentity(text).reply;
};
