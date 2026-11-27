// A short job for the local model, with thinking off on every server Nexy meets: llama-server
// reads chat_template_kwargs; Ollama's OpenAI endpoint ignores that and reads reasoning_effort
// "none". With neither, a qwen3 model spent all of a 1500-token edit on thinking and wrote no
// change. A server that refuses the field is asked again without it.
export const QUIET = { chat_template_kwargs: { enable_thinking: false }, reasoning_effort: "none" } as const;

// ticket: the gate's ticket for this call (Nexy Cloud), passed on untouched so the model network knows whose it is
export async function quietChat(base: string, body: Record<string, unknown>, signal?: AbortSignal, ticket?: string | null): Promise<Response> {
  const send = (b: Record<string, unknown>) => fetch(`${base}/v1/chat/completions`, {
    method: "POST", signal, headers: { "content-type": "application/json", ...(ticket ? { "x-nexy-ticket": ticket } : {}) }, body: JSON.stringify(b),
  });
  const res = await send({ ...body, ...QUIET });
  if (res.status !== 400 || !/reasoning/i.test(await res.clone().text().catch(() => ""))) return res;
  return send({ ...body, chat_template_kwargs: QUIET.chat_template_kwargs });
}

// the model's words, without any thinking that came back inline
export const answerOf = (j: any): string =>
  String(j?.choices?.[0]?.message?.content ?? "").replace(/<think>[\s\S]*?(?:<\/think>|$)/g, "").trim();

// it thought until it ran out of room and never answered
export const starved = (j: any): boolean => {
  const c = j?.choices?.[0];
  return c?.finish_reason === "length" && !answerOf(j) && !!(c?.message?.reasoning || c?.message?.reasoning_content || /<think>/.test(c?.message?.content ?? ""));
};
