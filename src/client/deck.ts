export interface DocSource { n: number; filename: string; excerpt: string }
export interface Slide { title: string; bullets: { text: string; source?: string }[]; note?: string }

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
export const monthIn = (s: string): string | null => {
  const m = new RegExp(`\\b(${MONTHS.join("|")})\\b`, "i").exec(s);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : null;
};

export const subjectIn = (s: string): string | null => {
  const m = /\b(?:deck|slides?|presentation)\s+(?:for|about|on)\s+(?:an?\s+|the\s+|my\s+|our\s+)?(.+?)[.?!\s]*$/i.exec(s.trim());
  return m ? m[1][0].toUpperCase() + m[1].slice(1) : null;
};

const nums = (s: string) => (s.replace(/,(?=\d{3}\b)/g, "").match(/\d+(?:\.\d+)?/g) ?? []).filter((n) => n.length > 1 || !/^\d$/.test(n));

function tracedTo(sentence: string, sources: DocSource[], cited: number[]): DocSource | null {
  const want = nums(sentence.replace(/\[\d+\]/g, ""));
  if (!want.length) return null;
  const order = [...sources.filter((s) => cited.includes(s.n)), ...sources.filter((s) => !cited.includes(s.n))];
  return order.find((s) => { const have = new Set(nums(s.excerpt).map(Number)); return want.every((n) => have.has(Number(n))); }) ?? null;
}

export function slidesFrom(answer: string, sources: DocSource[], month: string | null, tasks: string[], subject: string | null = null): { slides: Slide[]; traced: number; dropped: number } {
  const when = month ?? subject ?? "Latest";
  const sentences = answer.replace(/\s+/g, " ").replace(/([.!?]) (?=[A-Z0-9])/g, "$1\n").split("\n").map((s) => s.trim()).filter((s) => s.length > 3);
  const figures: Slide["bullets"] = [];
  const context: Slide["bullets"] = [];
  let dropped = 0;
  for (const s of sentences) {
    const cited = [...s.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    const text = s.replace(/\s*\[\d+\]/g, "");
    if (nums(text).length) {
      const src = tracedTo(s, sources, cited);
      if (src && figures.length < 5) figures.push({ text, source: src.filename });
      else if (!src) dropped++;
    } else if (context.length < 4 && !/\b(i (could|can)not|no (information|data)|not (found|mentioned))\b/i.test(text)) context.push({ text });
  }
  const s1: Slide = figures.length
    ? { title: `${when} in numbers`, bullets: figures }
    : { title: `${when} in numbers`, bullets: [], note: subject && !month
      ? `No figures on ${subject.toLowerCase()} were found in your documents. Attach some and ask again; nothing here is made up.`
      : `No ${when.toLowerCase()} figures were found in your documents. Attach the ${when} P&L or metrics and ask again; nothing here is made up.` };
  return {
    slides: [
      s1,
      { title: "What it means", bullets: context, note: context.length ? undefined : "Nothing beyond the figures was found in your documents." },
      { title: "Next steps", bullets: tasks.slice(0, 4).map((t) => ({ text: t })) },
    ],
    traced: figures.length,
    dropped,
  };
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export function deckHtml(title: string, slides: Slide[]): string {
  const body = slides.map((s, i) =>
    `<section class="s${i ? "" : " on"}"><h2>${esc(s.title)}</h2>` +
    (s.bullets.length ? `<ul>${s.bullets.map((b) => `<li>${esc(b.text)}${b.source ? `<small>from ${esc(b.source)}</small>` : ""}</li>`).join("")}</ul>` : "") +
    (s.note ? `<p class="note">${esc(s.note)}</p>` : "") +
    `<footer>${esc(title)} · ${i + 1} / ${slides.length}</footer></section>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
*{box-sizing:border-box;margin:0}body{background:#0e1016;color:#f2f3f5;font:16px system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:16px;gap:12px}
.deck{width:min(100%,960px);aspect-ratio:16/9;position:relative}section{display:none;position:absolute;inset:0;background:linear-gradient(135deg,#171b26,#10131b);border:1px solid #2a3040;border-radius:14px;padding:5% 6%;flex-direction:column}
section.on{display:flex}h2{font-size:clamp(20px,3.4vw,34px);margin-bottom:4%;color:#7dd3fc}ul{list-style:none;display:flex;flex-direction:column;gap:3%}li{font-size:clamp(13px,1.9vw,19px);line-height:1.35;padding-left:18px;position:relative}
li::before{content:"";position:absolute;left:0;top:.55em;width:7px;height:7px;border-radius:50%;background:#7dd3fc}small{display:block;color:#8b93a7;font-size:.72em;margin-top:2px}
.note{color:#c3c8d4;font-size:clamp(13px,1.8vw,18px);line-height:1.45;border-left:3px solid #f59e0b;padding-left:12px}footer{margin-top:auto;color:#6b7386;font-size:12px}
nav{display:flex;gap:8px}button{background:#1d2230;color:#e5e7eb;border:1px solid #2f3647;border-radius:8px;padding:6px 14px;font:inherit;cursor:pointer}</style></head><body>
<div class="deck">${body}</div><nav><button id="p">‹ Prev</button><button id="n">Next ›</button></nav>
<script>(function(){var s=[].slice.call(document.querySelectorAll("section")),i=0;function go(d){s[i].classList.remove("on");i=(i+d+s.length)%s.length;s[i].classList.add("on");}
document.getElementById("p").onclick=function(){go(-1)};document.getElementById("n").onclick=function(){go(1)};addEventListener("keydown",function(e){if(e.key==="ArrowRight")go(1);if(e.key==="ArrowLeft")go(-1);});})();</script></body></html>`;
}
