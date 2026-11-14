// Change a page that is already built, in place. Before this, any follow-up to a built page
// ("make the background darker", "add a pricing section") either rebuilt the whole site from
// scratch or went to chat, which cannot touch the page.
//
// The model returns small find/replace edits plus optional CSS, never the whole page: a full
// rewrite of a 30 KB page would take minutes on this machine and could change everything else.

const LLM = (process.env.NEXY_LLM_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const MODEL = process.env.NEXY_MODEL ?? "txt2txt";
const MAX_PAGE = 40_000;

const SYSTEM = [
  "You change an existing single-file HTML page. Reply with ONE JSON object and nothing else:",
  '{"edits":[{"find":"...","replace":"..."}],"css":"...","say":"..."}',
  "- find: text copied EXACTLY from the page, character for character, long enough to be unique but short: a few words to a line, never a whole long line. Keep placeholders like data:…[3] exactly as written.",
  "- replace: what that text becomes. To add something, find an existing line next to where it goes and put the new HTML before or after it in replace, keeping the original line.",
  "- css: optional rules added after everything else on the page. Prefer css for colours, fonts, sizes, spacing, rounding and backgrounds, with !important where it overrides an existing rule.",
  "- say: one short sentence, plain English, saying what you changed. Do not think out loud.",
  "If a value appears in more than one place (defaults and the settings actually used), change every place. Never repeat an edit.",
  "Change only what was asked. Never return the whole page. Never add links to images, fonts, scripts or anything else outside this page.",
  "No markdown, no comments.",
].join("\n");

export interface Edit { find: string; replace: string }
export interface Plan { edits: Edit[]; css: string; say: string }

// What the model reads: inlined images (and, on a page, long scripts) become numbered
// placeholders. They can be most of a page's bytes and are noise for a visual or copy change.
// Edits apply to exactly this masked text, so a `find` copied across a placeholder still
// matches, and unmask() puts the originals back.
export function mask(html: string, keepScripts = false): { text: string; kept: string[] } {
  const kept: string[] = [];
  let text = html.replace(/data:[a-z]+\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]{100,}/gi, (m) => `data:…[${kept.push(m) - 1}]`);
  // a game IS its script; a page usually is not
  if (!keepScripts) text = text.replace(/(<script\b[^>]*>)([\s\S]{400,}?)(<\/script>)/gi, (_, a, body, b) => `${a}/* script ${kept.push(body) - 1} omitted */${b}`);
  return { text, kept };
}

export function unmask(text: string, kept: string[]): string {
  return text
    .replace(/\/\* script (\d+) omitted \*\//g, (m, i) => kept[Number(i)] ?? m)
    .replace(/data:…\[(\d+)\]/g, (m, i) => kept[Number(i)] ?? m);
}

// what the model sees: the masked page, capped
export const readable = (html: string, keepScripts = false): string => mask(html, keepScripts).text.slice(0, MAX_PAGE);

// one plain sentence; the model sometimes thinks out loud in it
export function tidySay(say: string): string {
  const first = (say.match(/^[^.!?]*[.!?]/)?.[0] ?? say).trim();
  return first.length > 3 && first.length <= 160 && !/\b(wait|actually|hmm)\b/i.test(first) ? first : "Changed it.";
}

export function parsePlan(raw: string): Plan | null {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/```(?:json)?/g, "");
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  let j: any = null;
  if (start >= 0 && end > start) { try { j = JSON.parse(text.slice(start, end + 1)); } catch { j = null; } }
  // A reply cut off at the length limit (the model sometimes repeats an edit until it runs out):
  // keep every complete edit rather than discarding the lot.
  if (!j) {
    const pairs = [...text.matchAll(/\{\s*"find"\s*:\s*("(?:[^"\\]|\\.)*")\s*,\s*"replace"\s*:\s*("(?:[^"\\]|\\.)*")\s*\}/g)];
    if (!pairs.length) return null;
    j = { edits: pairs.map((p) => { try { return { find: JSON.parse(p[1]), replace: JSON.parse(p[2]) }; } catch { return null; } }).filter(Boolean) };
  }
  const seen = new Set<string>();
  const edits = (Array.isArray(j?.edits) ? j.edits : [])
    .filter((e: any) => e && typeof e.find === "string" && e.find && typeof e.replace === "string" && e.find !== e.replace)
    .filter((e: any) => { const k = e.find + "\u0000" + e.replace; return !seen.has(k) && !!seen.add(k); })
    .slice(0, 20)
    .map((e: any) => ({ find: e.find, replace: e.replace }));
  return { edits, css: typeof j?.css === "string" ? j.css.trim() : "", say: typeof j?.say === "string" ? j.say.trim() : "" };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Exact first; then with whitespace runs treated as equal, since the model reflows indentation.
function replaceOnce(html: string, find: string, replace: string): string | null {
  const i = html.indexOf(find);
  if (i >= 0) return html.slice(0, i) + replace + html.slice(i + find.length);
  const loose = new RegExp(escapeRe(find.trim()).replace(/\s+/g, "\\s+"));
  const m = loose.exec(html);
  return m ? html.slice(0, m.index) + replace + html.slice(m.index + m[0].length) : null;
}

export function applyPlan(html: string, plan: Plan): { html: string; applied: number; missed: number } {
  let out = html, applied = 0, missed = 0;
  for (const e of plan.edits) {
    const next = replaceOnce(out, e.find, e.replace);
    if (next === null || next === out) { missed++; continue; }
    out = next; applied++;
  }
  if (plan.css && !/<\/?script|<\/style/i.test(plan.css)) {
    const tag = `<style data-nexy-edit>${plan.css}</style>`;
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${tag}</head>`) : `${tag}${out}`;
    applied++;
  }
  return { html: out, applied, missed };
}

// Games keep a setting in more than one place (fallback defaults and the settings in use);
// the model reliably changes one. When an edit changes a named number (gap:175 -> 250), the
// same key with the same old value changes everywhere. Same key, same value, nothing else.
const NUM = /"?([A-Za-z_][\w]*)"?\s*:\s*(-?\d+(?:\.\d+)?)/g;
export function propagateSettings(text: string, edits: Edit[]): { text: string; changed: number } {
  let out = text, changed = 0;
  for (const e of edits) {
    const before = new Map([...e.find.matchAll(NUM)].map((m) => [m[1], m[2]]));
    for (const m of e.replace.matchAll(NUM)) {
      const old = before.get(m[1]);
      if (old === undefined || old === m[2]) continue;
      const re = new RegExp(`("?${m[1]}"?\\s*:\\s*)${old.replace(".", "\\.")}(?![\\d.])`, "g");
      out = out.replace(re, (_, k) => { changed++; return k + m[2]; });
    }
  }
  return { text: out, changed };
}

export class Busy extends Error {}

export async function revise(html: string, instruction: string, opts: { game?: boolean } = {}, signal?: AbortSignal): Promise<{ html: string; say: string; applied: number; missed: number }> {
  const masked = mask(html, opts.game);
  const res = await fetch(`${LLM}/v1/chat/completions`, {
    method: "POST", signal: signal ?? AbortSignal.timeout(240_000), headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 1500, temperature: 0.2, chat_template_kwargs: { enable_thinking: false },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: `${opts.game ? "The game (change its script values, such as speeds, sizes, colours and rules, with find/replace; do not rewrite it)" : "The page"}:\n${masked.text.slice(0, MAX_PAGE)}\n\nThe change: ${instruction.slice(0, 6000)}` },
      ],
    }),
  });
  if (res.status === 429 || res.status === 503) throw new Busy("the model is busy with another job");
  if (!res.ok) throw new Error(`the model answered ${res.status}`);
  const plan = parsePlan(String((await res.json())?.choices?.[0]?.message?.content ?? ""));
  if (!plan) throw new Error("the model did not return a change it could apply");
  const r = applyPlan(masked.text, plan);
  const p = opts.game ? propagateSettings(r.html, plan.edits) : { text: r.html, changed: 0 };
  return { ...r, html: unmask(p.text, masked.kept), say: tidySay(plan.say) };
}
