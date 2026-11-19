// Reads an OpenAI-style completion, streamed (SSE) or whole. Returns the full text and the last chunk.
// onRoute hears Nexy Engine's ": route <where>" comments: where each model call runs, as it is answered.
export async function readCompletion(res: Response, onText?: (delta: string) => void, onRoute?: (where: string) => void): Promise<{ content: string; last: any }> {
  if (!(res.headers.get("content-type") ?? "").includes("text/event-stream") || !res.body) {
    const body = await res.json();
    const content = String(body?.choices?.[0]?.message?.content ?? "");
    if (content) onText?.(content);
    return { content, last: body };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", content = "", last: any = {};
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      const route = /^: route ([a-z0-9]{1,16})$/.exec(line)?.[1];
      if (route) { onRoute?.(route); continue; }
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      let chunk: any;
      try { chunk = JSON.parse(data); } catch { continue; }
      last = chunk;
      const d = chunk?.choices?.[0]?.delta?.content;
      if (typeof d === "string" && d) { content += d; onText?.(d); }
    }
  }
  return { content, last };
}
