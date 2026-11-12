const SEARXNG = (process.env.NEXY_SEARXNG_URL ?? "").replace(/\/+$/, "");
const LLM = (process.env.NEXY_LLM_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const MODEL = process.env.NEXY_MODEL ?? "router/router:txt2txt";

export interface Snippet { title: string; url: string; text: string }
export interface Point { label: string; value: number; quote: string; snippet: number; unit?: string; kind?: string }
export interface Chart {
  query: string; title: string; unit: string; kind: "bar" | "line" | "table";
  points: { label: string; value: number; unit: string; source: { title: string; url: string }; quote: string }[];
  dropped: number; sources: { title: string; url: string }[];
}

export function buildQuery(question: string): string {
  return question
    .replace(/^\s*(?:hey\s+nexy[,\s]+)?(?:please\s+)?(?:can you\s+)?(?:show|give|draw|make|build|plot|chart|graph)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(?:bar\s+|line\s+)?(?:graph|chart|plot|visuali[sz]ation)?\s*(?:of|for|showing|on|about)?\s*/i, "")
    .replace(/[?.!]+$/, "")
    .trim()
    .slice(0, 160);
}

// a computer without a search service (Nexy on Windows) has none, and says so plainly
export const NO_SEARCH = "Web search isn't on this computer yet.";
export const searchHere = (): boolean => !!SEARXNG;

export async function search(query: string, limit = 8): Promise<Snippet[]> {
  if (!SEARXNG) throw new Error(NO_SEARCH);
  const res = await fetch(`${SEARXNG}/search?q=${encodeURIComponent(query)}&format=json&safesearch=1`, {
    headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`search ${res.status}`);
  const body = (await res.json()) as { results?: Array<Record<string, unknown>>; nexy_unavailable?: string };
  // the app's search front door says why there is no search (installing, offline, engines refusing)
  if (body.nexy_unavailable) throw new Error(`I can't search the web right now. ${body.nexy_unavailable}`);
  return (body.results ?? []).slice(0, limit)
    .map((r) => ({ title: String(r.title ?? ""), url: String(r.url ?? ""), text: String(r.content ?? "").slice(0, 700) }))
    .filter((s) => s.text.length > 20);
}

const norm = (s: string) => s.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();

function numberIn(value: number, quote: string): boolean {
  const q = quote.replace(/,(?=\d{3}\b)/g, "");
  const nums = (q.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  return nums.some((n) => Math.abs(n - value) < 1e-9 || Math.abs(n - value) <= Math.abs(value) * 0.005);
}

export function verify(points: Point[], snippets: Snippet[]): { kept: Point[]; dropped: number } {
  const kept = points.filter((p) => {
    const s = snippets[p.snippet];
    if (!s || typeof p.value !== "number" || !isFinite(p.value) || !p.quote || !p.label) return false;
    return norm(s.text).includes(norm(p.quote)) && numberIn(p.value, p.quote);
  });
  return { kept, dropped: points.length - kept.length };
}

async function extract(question: string, snippets: Snippet[]): Promise<{ title: string; unit: string; kind: string; points: Point[] }> {
  const numbered = snippets.map((s, i) => `[${i}] ${s.title}\n${s.text}`).join("\n\n");
  const system = `<no_think>
You extract figures for a chart, from the numbered snippets ONLY. Never use anything you know that is not in them.
Reply with ONLY a JSON object: {"title": title for these figures, "kind": "bar" or "line",
 "points": [{"label": short label such as a year, region or name, "value": number, "unit": unit of this value (e.g. GW, %, TWh, USD bn),
   "quote": the exact words from the snippet that contain this number, "snippet": index,
   "kind": "actual" for a measured or reported figure, "forecast" for a projection, estimate of the future or target}]}
Include every figure relevant to the request, each with its own unit. At most 12. No figures in the snippets → empty points list.
If the request is about change over time (growth, expansion, trend, "last N months/years"), prefer the SAME measure at different dates, and make each label the date or year (e.g. "2023", "Q2 2025").`;
  let res: Response | null = null;
  const tries = Number(process.env.OWN_BUSY_TRIES ?? 20);
  for (let i = 0; i < tries; i++) {
    res = await fetch(`${LLM}/v1/chat/completions`, {
      method: "POST", signal: AbortSignal.timeout(180_000), headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL, max_tokens: 1200, temperature: 0.1,
        chat_template_kwargs: { enable_thinking: false },
        messages: [{ role: "system", content: system }, { role: "user", content: `Chart request: ${question}\n\nSnippets:\n${numbered}` }],
      }),
    });
    if (res.status !== 429 && res.status !== 503) break;
    const after = Number(res.headers.get("retry-after")) * 1000;
    await new Promise((r) => setTimeout(r, after > 0 ? Math.min(after, 15_000) : 6_000));
  }
  if (!res || !res.ok) throw new Error(res?.status === 429 || res?.status === 503 ? "the model is busy with other requests; try again in a minute" : `model ${res?.status}`);
  const body = await res.json();
  const text = String(body?.choices?.[0]?.message?.content ?? "{}");
  const json = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1) || "{}");
  return { title: String(json.title ?? ""), unit: "", kind: String(json.kind ?? "bar"), points: Array.isArray(json.points) ? json.points : [] };
}

const shortLabel = (l: string) => (l.length <= 28 ? l : l.slice(0, 27).replace(/\s+\S*$/, "") + "…");

export async function researchChart(question: string): Promise<Chart> {
  const query = buildQuery(question) || question.slice(0, 160);
  const snippets = await search(query);
  const raw = snippets.length ? await extract(question, snippets) : { title: "", unit: "", kind: "bar", points: [] };
  const checked = verify(raw.points.map((p: any) => ({ ...p, value: Number(p.value), snippet: Number(p.snippet), unit: String(p.unit ?? ""),
    kind: /forecast|project|estimate|target/i.test(String(p.kind ?? "")) || /\b(forecast|projected|expected|will reach|by 20[3-9]\d)\b/i.test(String(p.quote ?? "")) ? "forecast" : "actual" })), snippets);
  const seen = new Set<string>();
  checked.kept = checked.kept.filter((p) => { const k = `${norm(p.label)}|${p.value}|${norm(p.unit || "")}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const groups = new Map<string, Point[]>();
  for (const p of checked.kept) { const k = `${norm(p.unit || "").split(" ")[0] || "?"}|${p.kind}`; groups.set(k, [...(groups.get(k) ?? []), p]); }
  const overTime = /\b(growth|grow|expan\w*|trend|over time|last \d+ (months?|years?)|since|history|timeline)\b/i.test(question);
  const dated = (g: Point[]) => g.filter((p) => /\b(19|20)\d{2}\b|\bQ[1-4]\b|\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\b/i.test(p.label)).length;
  const score = (g: Point[]) => g.length + (overTime ? dated(g) * 2 : 0);
  const best = [...groups.values()].sort((a, b) => score(b) - score(a) || (a[0].kind === "actual" ? -1 : 1))[0] ?? [];
  const charted = best.length >= 2 && norm(best[0].unit || "") !== "";
  const series = charted && overTime && dated(best) === best.length;
  const when = (l: string) => { const y = /\b((?:19|20)\d{2})\b/.exec(l); const q = /\bQ([1-4])\b/i.exec(l); return (y ? +y[1] : 0) * 10 + (q ? +q[1] : 0); };
  const kept = charted ? (series ? [...best].sort((a, b) => when(a.label) - when(b.label)) : best) : checked.kept;
  const dropped = checked.dropped;
  const used = [...new Set(kept.map((p) => p.snippet))];
  return {
    query, title: (raw.title || query) + (charted && best[0].kind === "forecast" ? " (forecasts, not measurements)" : ""), unit: charted ? String(best[0].unit) : "", kind: !charted ? "table" : series || raw.kind === "line" ? "line" : "bar",
    points: kept.map((p) => ({ label: shortLabel(String(p.label)) + (!charted && p.kind === "forecast" ? " (forecast)" : ""), value: p.value, unit: String(p.unit ?? ""), quote: p.quote.slice(0, 200), source: { title: snippets[p.snippet].title, url: snippets[p.snippet].url } })),
    dropped,
    sources: used.map((i) => ({ title: snippets[i].title, url: snippets[i].url })),
  };
}
