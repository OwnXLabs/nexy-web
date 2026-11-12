import { siteHost } from "./place";
import { renderMd } from "./md";
import { PICK } from "./pick";
import type { Artifact, ArtifactKind } from "./canvas";
import { sheetArtifact } from "./sheet-view";
import { themedHTML } from "./theme-apps";
import { plainName } from "./state";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

// allow-forms: generated apps submit forms (add a card, sign up); still no same-origin.
const SANDBOX = 'sandbox="allow-scripts allow-forms"';

// The sandbox has no allow-same-origin, so a built app touching localStorage threw
// "SecurityError: ... the document is sandboxed" and died (a kanban board, 2026-10-08 feedback).
// An in-memory stand-in keeps it working for the session; nothing is stored.
export const STORAGE_SHIM =
  `(function(){try{localStorage.getItem("_")}catch(_){var m=function(){var d={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(d,k)?d[k]:null},` +
  `setItem:function(k,v){d[k]=String(v)},removeItem:function(k){delete d[k]},clear:function(){d={}},key:function(i){return Object.keys(d)[i]||null},` +
  `get length(){return Object.keys(d).length}}};["localStorage","sessionStorage"].forEach(function(n){try{Object.defineProperty(window,n,{value:m(),configurable:true})}catch(_){}})}})();`;
const PROBE =
  `<script>${STORAGE_SHIM}(function(){function r(m){try{parent.postMessage({nexyRunError:String(m).slice(0,200)},"*")}catch(_){}}` +
  `addEventListener("error",function(e){r(e.message||e.error)});` +
  `addEventListener("unhandledrejection",function(e){r(e.reason&&e.reason.message||e.reason)})})()</script>`;
export function withProbe(html: string): string {
  // the picker rides with the probe, so Select works on any page Nexy shows
  const head = PROBE + PICK;
  for (const re of [/<head[^>]*>/i, /<html[^>]*>/i, /<!doctype[^>]*>/i]) {
    const m = re.exec(html);
    if (m) return html.slice(0, m.index + m[0].length) + head + html.slice(m.index + m[0].length);
  }
  return head + html;
}

export interface Made {
  title: string;
  meta?: string;
  href?: string;
}

const id = (kind: ArtifactKind, title: string) => `${kind}:${title}`;

function nothing(what: string, where: string): string {
  return (
    `<div class="empty"><b>Nothing to show.</b><br>` +
    `This is a ${esc(what)} and it arrived empty, so there is nothing to draw — ` +
    `which is not the same as something that failed to load. ${esc(where)}</div>`
  );
}

export function htmlArtifact(m: Made & { html: string; url?: string }): Artifact {
  let html = m.html;
  return {
    id: id("html", m.title),
    kind: "html",
    title: m.title,
    meta: m.meta,
    href: m.href,
    source: html.trim() ? { get: () => html, set: (h) => { html = h; } } : undefined,
    render(host) {
      if (!html.trim()) {
        host.innerHTML = nothing("page", "Qiki is the app that builds pages on this machine.");
        return;
      }
      host.innerHTML =
        `<div class="browser"><div class="bbar"><span></span><span></span><span></span>` +
        `<i>${esc(m.url ?? siteHost)}</i></div>` +
        `<iframe ${SANDBOX} srcdoc="${esc(themedHTML(withProbe(html)))}"></iframe></div>`;
    },
  };
}

export function gameArtifact(m: Made & { html: string }): Artifact {
  // editable like a page, so "make the player faster" changes this game instead of building a new one
  let html = m.html;
  return {
    id: id("game", m.title),
    kind: "game",
    snapshot: () => ({ source: html }),
    source: html.trim() ? { get: () => html, set: (h) => { html = h; } } : undefined,
    title: m.title,
    meta: m.meta,
    href: m.href,
    render(host) {
      if (!html.trim()) {
        host.innerHTML = nothing("game", "Nothing on this machine builds games yet; this one came from the model.");
        return;
      }
      host.innerHTML =
        `<div class="frame game"><iframe ${SANDBOX} srcdoc="${esc(themedHTML(withProbe(html)))}"></iframe></div>` +
        `<div class="cvnote">Runs sandboxed: it can use scripts, and it cannot reach Nexy, ` +
        `your projects or anything else on this machine.</div>`;
    },
  };
}

export type Cell = string | number | null | undefined;

export function diagramArtifact(m: Made & { mermaid: string }): Artifact {
  return {
    id: id("diagram", m.title),
    kind: "diagram",
    title: m.title,
    meta: m.meta ?? "Mermaid source · on device",
    href: m.href,
    render(host) {
      if (!m.mermaid.trim()) {
        host.innerHTML = nothing("diagram", "The model returned an empty diagram block.");
        return;
      }
      host.innerHTML =
        `<pre class="code">${esc(m.mermaid.trim())}</pre>` +
        `<div class="cvnote">This is Mermaid source, not a picture. Nothing on this machine draws it: ` +
        `Mermaid is not installed, and Nexy does not pull scripts off the internet — on a box that is ` +
        `often offline that would show a blank frame and look like a bug. Adding <b>mermaid</b> to ` +
        `nexy/package.json is the one change that turns this into a diagram.</div>`;
    },
  };
}

const LANGS: Record<string, string> = {
  js: "JavaScript", ts: "TypeScript", jsx: "JavaScript", tsx: "TypeScript",
  py: "Python", rs: "Rust", go: "Go", sh: "Shell", bash: "Shell",
  nix: "Nix", json: "JSON", yaml: "YAML", yml: "YAML", css: "CSS",
  sql: "SQL", html: "HTML", toml: "TOML",
};

export function codeArtifact(m: Made & { code: string; lang?: string }): Artifact {
  const ext = (m.lang ?? m.title.split(".").pop() ?? "").toLowerCase();
  const lang = LANGS[ext] ?? (ext ? ext.toUpperCase() : "");
  return {
    id: id("code", m.title),
    kind: "code",
    title: m.title,
    meta: m.meta ?? [lang, "on device"].filter(Boolean).join(" · "),
    href: m.href,
    render(host) {
      if (!m.code.trim()) {
        host.innerHTML = nothing("file", "The model returned an empty code block.");
        return;
      }
      const lines = m.code.trim().split("\n").length;
      host.innerHTML =
        `<pre class="code">${esc(m.code.trim())}</pre>` +
        `<div class="cvnote">${esc(m.title)}${lang ? ` · ${esc(lang)}` : ""} · ${lines} line${lines === 1 ? "" : "s"}` +
        ` · not syntax-coloured: no highlighter ships with this app.</div>`;
    },
  };
}

// one renderer for documents and chat bubbles (md.ts)
export const mdHtml = (md: string): string => renderMd(md, "doc");

export function markdownArtifact(m: Made & { md: string }): Artifact {
  return {
    id: id("doc", m.title),
    kind: "doc",
    title: m.title,
    meta: m.meta,
    href: m.href,
    render(host) {
      if (!m.md.trim()) {
        host.innerHTML = nothing("document", "Own Docs is the app that holds documents on this machine.");
        return;
      }
      host.innerHTML = `<div class="doc">${mdHtml(m.md)}</div>`;
    },
  };
}

function csvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const numify = (s: string): Cell => {
  const t = s.trim();
  if (!t) return "";
  const n = Number(t.replace(/^\$/, "").replace(/,/g, ""));
  return t !== "" && isFinite(n) && /^[-$]?[\d,.]+$/.test(t) ? n : t;
};

export function csvRows(text: string): Cell[][] {
  return text.trim().split(/\r?\n/).filter(Boolean).map((l) => csvLine(l).map(numify));
}

// each markdown table in a reply, in order: a run of "|" lines with a separator under its header.
// Two tables one after the other are two tables: read as one, the second's rows were added into
// the first's total (0.2.8)
function pipeTables(text: string): Cell[][][] {
  // a separator has dashes: a header of blank cells ("| | |") is a header, not a separator; taken
  // for one, the first data row became the header (2026-10-28)
  const sep = (l: string) => /^\s*\|[\s:|-]*-[\s:|-]*\|\s*$/.test(l);
  const cells = (l: string) => l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => numify(c.trim().replace(/\*\*(.*?)\*\*/g, "$1").replace(/^\*\*|\*\*$/g, "")));
  const runs: string[][] = [];
  let run: string[] = [];
  for (const l of text.split(/\r?\n/)) {
    if (l.trim().startsWith("|")) run.push(l);
    else if (run.length) { runs.push(run); run = []; }
  }
  if (run.length) runs.push(run);
  return runs.filter((r) => r.length >= 2 && sep(r[1])).map((r) => r.filter((l) => !sep(l)).map(cells));
}

/**
 * One table's total, checked against the column it sits in: only a single total row, last in the
 * table, under a column of plain numbers. A total that matches a run of the rows just above it
 * (costs under a selling price) or any shape less clear is left alone: no correction, no note.
 */
export function checkTotals(rows: Cell[][]): { rows: Cell[][]; fixes: string[] } {
  const fixes: string[] = [];
  const out = rows.map((r) => [...r]);
  const label = (r: Cell[]) => r.filter((c) => typeof c === "string").join(" ");
  const totals = out.map((r, i) => (i > 0 && /\btotal\b/i.test(label(r)) ? i : -1)).filter((i) => i > 0);
  const i = out.length - 1;
  if (totals.length !== 1 || totals[0] !== i) return { rows: out, fixes };
  const round = (n: number) => Math.round(n * 100) / 100;
  out[i].forEach((c, col) => {
    if (typeof c !== "number") return;
    const above = out.slice(1, i).map((x) => x[col]);
    if (above.length < 2 || !above.every((x): x is number => typeof x === "number")) return;
    // the sums of every run that ends just above the total, longest last
    const runs: number[] = [];
    for (let k = above.length - 1, s = 0; k >= 0; k--) runs.push(round((s += above[k])));
    const sum = runs[runs.length - 1];
    if (runs.some((r) => Math.abs(r - c) <= 0.005)) return;
    fixes.push(`${label(out[i]).replace(/\s+/g, " ").trim().slice(0, 40)}: the model wrote ${c.toLocaleString()}, the rows add to ${sum.toLocaleString()}`);
    out[i][col] = sum;
  });
  return { rows: out, fixes };
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 28) || "reply";

export interface Lifted {
  artifact: Artifact;
  prose: string;
  note: string;
}

export function fromReply(reply: string, hint = ""): Lifted | null {
  const fence = /```([A-Za-z0-9_+-]*)\r?\n([\s\S]*?)```/.exec(reply);

  if (!fence) {
    const tables = pipeTables(reply).map(checkTotals);
    // Two tables are not one sheet: joined, the second header became a row and the sheet's total
    // added both (QA 2026-11-12). They stay as written, in a document; a wrong total is pointed out.
    if (tables.length > 1) {
      const wrong = tables.flatMap((t) => t.fixes);
      return {
        artifact: markdownArtifact({ title: `${slug(hint)}.md`, md: reply }),
        prose: reply,
        note: wrong.length ? `The tables are in the pane on the right. Check ${wrong.length === 1 ? "this total" : "these totals"}: ${wrong.join("; ")}.` : "The tables are in the pane on the right.",
      };
    }
    const rows = tables.flatMap((t) => t.rows);
    if (rows.length < 2) return null;
    const fixes = tables.flatMap((t) => t.fixes);
    return {
      artifact: sheetArtifact({ title: `${slug(hint)}.csv`, rows: rows.map((r) => r.map((v) => v ?? null)) }),
      prose: reply,
      note: fixes.length
        ? `The table is in the pane on the right. I checked its totals and corrected ${fixes.length}: ${fixes.join("; ")}.`
        : "The table is in the pane on the right.",
    };
  }

  const lang = fence[1].toLowerCase();
  const body = fence[2];
  if (!body.trim()) return null;

  const prose = (reply.slice(0, fence.index) + reply.slice(fence.index + fence[0].length)).trim();
  const name = slug(hint);
  const lift = (artifact: Artifact, what: string): Lifted => ({
    artifact,
    prose,
    note: `The ${what} is in the pane on the right.`,
  });

  if (lang === "mermaid")
    return lift(diagramArtifact({ title: `${name}.mmd`, mermaid: body }), "diagram");
  if (lang === "csv")
    return lift(sheetArtifact({ title: `${name}.csv`, rows: csvRows(body).map((r) => r.map((v) => v ?? null)) }), "table");
  if (lang === "md" || lang === "markdown")
    return lift(markdownArtifact({ title: `${name}.md`, md: body }), "document");
  if (lang === "html" || lang === "site") {
    const game = /<canvas\b/i.test(body) && /requestAnimationFrame|addEventListener\(\s*["']key/i.test(body);
    return game
      ? lift(gameArtifact({ title: plainName(`${name}.game`), html: body }), "game")
      : lift(htmlArtifact({ title: plainName(`${name}.html`), html: body, url: `${siteHost}/${name}` }), "page");
  }

  const ext = lang || "txt";
  return lift(codeArtifact({ title: `${name}.${ext}`, code: body, lang: ext }), "file");
}
