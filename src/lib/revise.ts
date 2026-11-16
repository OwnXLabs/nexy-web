// Change a page that is already built, in place. Before this, any follow-up to a built page
// ("make the background darker", "add a pricing section") either rebuilt the whole site from
// scratch or went to chat, which cannot touch the page (design feedback, 2026-10-23).
//
// The model returns small find/replace edits plus optional CSS, never the whole page: a full
// rewrite of a 30 KB page would take minutes on this machine and could change everything else.

import { answerOf, quietChat, starved } from "./quiet.ts";

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
// matches, and unmask() puts the originals back. (Applying to the original instead missed on a
// game whose settings sit on one line with its images, 2026-10-23.)
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

// What a person reads on the page: no scripts, styles or tags.
export function visibleText(html: string): string {
  return html.replace(/<(script|style|head|noscript|template)\b[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ").trim();
}

// times written one way: "7am", "7:00 AM", "7 a.m." and "07:00" are all 7am; "18:00" is 6pm
function times(t: string): string {
  return t.toLowerCase().replace(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s?m\b\.?/g, (_, h, m, a) => `${Number(h)}${m && m !== "00" ? ":" + m : ""}${a}m`)
    .replace(/\b(\d{1,2}):(\d{2})\b(?![ap]m)/g, (all, h, m) => {
      const n = Number(h);
      if (n > 23) return all;
      return `${n % 12 || 12}${m !== "00" ? ":" + m : ""}${n < 12 ? "a" : "p"}m`;
    });
}

const DAY = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|june|july|august|september|october|november|december)\b/gi;
const TIME = /\b\d{1,2}(?::\d{2})?[ap]m\b/g;
const QUOTED = /"([^"]{2,80})"|“([^”]{2,80})”/g;
const PRICE = /(?:[$€£₱]\s?\d[\d,.]*\d|\b\d[\d,.]*\s?(?:usd|eur|gbp|php)\b)/gi;
const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g;
const PHONE = /\+?\d[\d ()-]{6,}\d/g;
// "add a section with our opening hours", "added the address": new words for the page
const ADDS_WORDS = /\b(?:add(?:s|ed|ing)?|insert(?:s|ed)?|include[sd]?|put|write|wrote|list(?:ed)?|mention(?:s|ed)?)\b(?:\s+(?!(?:to|on|onto|around|under|behind|for|in|into)\b)[\w'’-]+){0,4}?\s+(?:section|paragraph|heading|text|line|lines|list|hours|footer|address|phone|email|prices?|menu|testimonials?|faq|tagline|quote|reviews?|story|description|caption|contact|banner|notice|announcement|opening|times)\b/i;

// What the person asked to see on the page that is not on it after the change: concrete
// words from the request (times, days, quoted text, prices, an email or phone number), and
// new text at all when the request or the model's own summary says words were added. Small
// models often say "added opening hours" and add only a style rule (capability test, 2026-11-17).
export function unmet(before: string, after: string, change: string, say = ""): string[] {
  const was = visibleText(before), now = visibleText(after);
  const has = (page: string, x: string) => page.includes(x);
  const wasN = times(was), nowN = times(now), ask = times(change);
  const missing: string[] = [];
  const want = (shown: string, inWas: boolean, inNow: boolean) => { if (!inWas && !inNow && !missing.includes(shown)) missing.push(shown); };
  for (const m of ask.matchAll(TIME)) want(m[0], has(wasN, m[0]), has(nowN, m[0]));
  for (const m of change.matchAll(DAY)) {
    const d = m[1].toLowerCase().slice(0, 3), re = new RegExp(`\\b${d}`, "i");
    want(m[1], re.test(was), re.test(now));
  }
  for (const re of [QUOTED, PRICE, EMAIL, PHONE]) for (const m of change.matchAll(re)) {
    const x = (m[1] ?? m[2] ?? m[0]).trim(), low = (p: string) => p.toLowerCase().replace(/\s+/g, " ");
    want(x, low(was).includes(low(x)), low(now).includes(low(x)));
  }
  if (!missing.length && was === now && (ADDS_WORDS.test(change) || ADDS_WORDS.test(say))) missing.push("the new text");
  return missing.slice(0, 6);
}

export class Busy extends Error {}
// the model answered, but with nothing that changes the page: asking again at once will not help
export class NoChange extends Error {}

const BUDGET = 1500, ROOMY = 4000;

export async function revise(html: string, instruction: string, opts: { game?: boolean } = {}, signal?: AbortSignal): Promise<{ html: string; say: string; applied: number; missed: number; unmet: string[] }> {
  const masked = mask(html, opts.game);
  const user = `${opts.game ? "The game (change its script values, such as speeds, sizes, colours and rules, with find/replace; do not rewrite it)" : "The page"}:\n${masked.text.slice(0, MAX_PAGE)}\n\nThe change: ${instruction.slice(0, 6000)}`;
  const ask = (maxTokens: number, content: string) => quietChat(LLM, {
    model: MODEL, max_tokens: maxTokens, temperature: 0.2,
    messages: [{ role: "system", content: SYSTEM }, { role: "user", content }],
  }, signal ?? AbortSignal.timeout(240_000));
  let res = await ask(BUDGET, user);
  if (res.status === 429 || res.status === 503) throw new Busy("the model is busy with another job");
  if (!res.ok) throw new Error(`the model answered ${res.status}`);
  let j: any = await res.json();
  // a server that thinks anyway: once more, told not to (qwen3's own switch), with room to answer
  if (starved(j)) {
    res = await ask(ROOMY, `${user}\n\n/no_think`);
    if (!res.ok) throw new Error(`the model answered ${res.status}`);
    j = await res.json();
    if (starved(j)) throw new NoChange("the model spent its whole answer thinking and wrote no change");
  }
  const plan = parsePlan(answerOf(j));
  if (!plan) throw new NoChange("the model did not return a change it could apply");
  const r = applyPlan(masked.text, plan);
  const p = opts.game ? propagateSettings(r.html, plan.edits) : { text: r.html, changed: 0 };
  const out = unmask(p.text, masked.kept);
  // a picked part arrives wrapped; what was asked is after "The change: "
  const at = instruction.lastIndexOf("The change: "), change = at >= 0 ? instruction.slice(at + 12) : instruction;
  return { ...r, html: out, say: tidySay(plan.say), unmet: unmet(html, out, change, plan.say) };
}
