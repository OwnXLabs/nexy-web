// Markdown from a model, as safe HTML: for chat bubbles and for documents in the pane. Everything
// is escaped first and only these tags are made: headings, paragraphs, lists, block quotes, tables,
// code, emphasis and http(s) links that open outside. No raw HTML, no other link schemes.
// Output has no newlines outside <pre>: chat bubbles keep white-space: pre-wrap.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** One line of text: code spans, links, bold, italics, strikethrough. */
export function inline(raw: string): string {
  const code: string[] = [];
  // code spans are kept aside so nothing inside them is read as markdown
  let t = esc(raw.replace(/\u0000/g, "")).replace(/`([^`]+)`/g, (_, c: string) => `\u0000${code.push(`<code>${c}</code>`) - 1}\u0000`);
  // only http(s) becomes a link; any other scheme stays as its words
  t = t.replace(/\[([^\]]+)\]\(\s*([^\s)]+)(?:\s+&quot;[^)]*&quot;)?\s*\)/g, (_, label: string, url: string) =>
    /^https?:\/\/[^\s]+$/i.test(url) ? `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>` : label);
  t = t
    .replace(/\*\*(?=\S)(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^\w])__(?=\S)(.+?)__(?![\w])/g, "$1<b>$2</b>")
    .replace(/(^|[^*\w])\*(?=\S)([^*]+?)\*(?![*\w])/g, "$1<i>$2</i>")
    .replace(/(^|[^\w])_(?=\S)([^_]+?)_(?![\w])/g, "$1<i>$2</i>")
    .replace(/~~(?=\S)(.+?)~~/g, "<s>$1</s>");
  return t.replace(/\u0000(\d+)\u0000/g, (_, i: string) => code[Number(i)]);
}

const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (l: string) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const BULLET = /^\s*([-*+]|\d+[.)])\s+/;
const HEAD = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;

export type Heads = "doc" | "chat";
// a document's title is h1 and its sections h2; in a chat bubble headings stay small
const heading = (level: number, heads: Heads) => (heads === "doc" ? (level === 1 ? "h1" : "h2") : level <= 2 ? "h3" : "h4");

function lines(ls: string[], heads: Heads): string {
  let out = "";
  for (let i = 0; i < ls.length;) {
    const l = ls[i];
    if (!l.trim()) { i++; continue; }
    const h = HEAD.exec(l);
    if (h) { const tag = heading(h[1].length, heads); out += `<${tag}>${inline(h[2])}</${tag}>`; i++; continue; }
    if (RULE.test(l)) { out += "<hr>"; i++; continue; }
    if (/^\s*>/.test(l)) {
      const q: string[] = [];
      while (i < ls.length && /^\s*>/.test(ls[i])) q.push(ls[i++].replace(/^\s*>\s?/, ""));
      out += `<blockquote>${lines(q, heads)}</blockquote>`;
      continue;
    }
    if (l.includes("|") && i + 1 < ls.length && SEP.test(ls[i + 1]) && ls[i + 1].includes("-")) {
      const head = cells(l);
      i += 2;
      const body: string[][] = [];
      while (i < ls.length && ls[i].includes("|") && ls[i].trim()) body.push(cells(ls[i++]));
      out += `<div class="mdt"><table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead>` +
        `<tbody>${body.map((r) => `<tr>${head.map((_, k) => `<td>${inline(r[k] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
      continue;
    }
    if (BULLET.test(l)) {
      const ordered = /^\s*\d/.test(l);
      const items: string[] = [];
      while (i < ls.length && BULLET.test(ls[i]) && /^\s*\d/.test(ls[i]) === ordered) items.push(ls[i++].replace(BULLET, ""));
      // "1. … (blank line) 2. …" is one list in two blocks: it keeps counting from its own number
      const start = ordered ? Number(/\d+/.exec(l)![0]) : 1;
      const tag = ordered ? `ol${start !== 1 ? ` start="${start}"` : ""}` : "ul";
      out += `<${tag}>${items.map((t) => `<li>${inline(t)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`;
      continue;
    }
    const para: string[] = [];
    while (i < ls.length && ls[i].trim() && !HEAD.test(ls[i]) && !RULE.test(ls[i]) && !/^\s*>/.test(ls[i]) && !BULLET.test(ls[i]) &&
      !(ls[i].includes("|") && i + 1 < ls.length && SEP.test(ls[i + 1]))) para.push(ls[i++]);
    out += `<p>${para.map(inline).join("<br>")}</p>`;
  }
  return out;
}

/** Markdown to safe HTML. */
export function renderMd(md: string, heads: Heads = "chat"): string {
  return md
    .split("```")
    .map((part, i) => {
      if (i % 2 === 0) return lines(part.split(/\r?\n/), heads);
      const nl = part.indexOf("\n");
      const info = nl < 0 ? "" : part.slice(0, nl).trim();
      const body = nl >= 0 && !/\s/.test(info) ? part.slice(nl + 1) : part;
      return `<pre class="code">${esc(body.replace(/\n+$/, ""))}</pre>`;
    })
    .join("");
}
