// An attached file read here, without Own Docs: text as it is, a PDF's text layer, images refused.
// Pure (Web APIs only), so the browser and the tests both use it.

export const LOCAL_READ_MAX = 20 * 1024 * 1024;
// what one file may add to the chat body; the server keeps 8000 characters of each (chat.ts docsBlock)
export const LOCAL_TEXT_MAX = 20_000;

export type FileRead =
  | { kind: "text"; text: string }
  | { kind: "image" }
  | { kind: "unreadable"; why: string };

const TEXT_EXT = /\.(?:txt|text|md|markdown|csv|tsv|json|log|ya?ml|xml|html?|rtf)$/i;
const IMAGE_EXT = /\.(?:png|jpe?g|gif|webp|heic|heif|bmp|tiff?|svg)$/i;

export const isTextFile = (name: string, type = ""): boolean => TEXT_EXT.test(name) || /^text\//.test(type) || type === "application/json";
export const isImageFile = (name: string, type = ""): boolean => /^image\//.test(type) || IMAGE_EXT.test(name);
export const isPdf = (name: string, type = ""): boolean => /\.pdf$/i.test(name) || type === "application/pdf";

export async function readLocally(name: string, type: string, bytes: Uint8Array): Promise<FileRead> {
  if (isImageFile(name, type)) return { kind: "image" };
  if (bytes.length > LOCAL_READ_MAX) return { kind: "unreadable", why: `over ${LOCAL_READ_MAX / 1024 / 1024} MB, too large to read here` };
  if (isPdf(name, type)) {
    const text = (await pdfText(bytes)).trim();
    return text ? { kind: "text", text: text.slice(0, LOCAL_TEXT_MAX) } : { kind: "unreadable", why: "this PDF has no text to read (a scan or a picture of a page)" };
  }
  if (isTextFile(name, type)) {
    const text = new TextDecoder().decode(bytes).replace(/^﻿/, "").trim();
    return text ? { kind: "text", text: text.slice(0, LOCAL_TEXT_MAX) } : { kind: "unreadable", why: "the file is empty" };
  }
  return { kind: "unreadable", why: "only text, Markdown, CSV and PDF files can be read here" };
}

// ---- PDF: the text layer of each page, through each font's ToUnicode map ----

const latin1 = (b: Uint8Array): string => { let s = ""; for (const c of b) s += String.fromCharCode(c); return s; };

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const out = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate"));
  const parts: Uint8Array[] = [];
  const r = out.getReader();
  // a stream cut short still gives what was read before the error
  try { for (;;) { const { done, value } = await r.read(); if (done) break; parts.push(value); } }
  catch (e) { if (!parts.length) throw e; }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}

interface Obj { dict: string; stream?: Uint8Array }

async function streamData(o: Obj): Promise<Uint8Array | null> {
  if (!o.stream) return null;
  const f = /\/Filter\s*(\[[^\]]*\]|\/\w+)/.exec(o.dict)?.[1] ?? "";
  if (!f) return o.stream;
  if (/^\/FlateDecode$|^\[\s*\/FlateDecode\s*\]$/.test(f)) return inflate(o.stream);
  return null;
}

// every object, from the file body and from object streams
async function objects(src: string, bytes: Uint8Array): Promise<Map<number, Obj>> {
  const map = new Map<number, Obj>();
  const re = /(\d+)\s+\d+\s+obj\b([\s\S]*?)\bendobj\b/g;
  for (let m; (m = re.exec(src)); ) {
    const body = m[2];
    const si = body.search(/\bstream\r?\n/);
    if (si < 0) { map.set(Number(m[1]), { dict: body }); continue; }
    const dict = body.slice(0, si);
    const start = m.index + m[0].indexOf(body) + si + body.slice(si).match(/^stream\r?\n/)![0].length;
    const len = Number(/\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict)?.[1] ?? NaN);
    const end = Number.isFinite(len) && start + len <= bytes.length ? start + len : m.index + m[0].lastIndexOf("endstream");
    map.set(Number(m[1]), { dict, stream: bytes.subarray(start, end) });
  }
  for (const o of [...map.values()]) {
    if (!/\/Type\s*\/ObjStm\b/.test(o.dict)) continue;
    const data = await streamData(o).catch(() => null);
    if (!data) continue;
    const s = latin1(data);
    const n = Number(/\/N\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
    const head = s.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const at = first + head[2 * i + 1], next = i + 1 < n ? first + head[2 * i + 3] : s.length;
      if (!map.has(head[2 * i])) map.set(head[2 * i], { dict: s.slice(at, next) });
    }
  }
  return map;
}

const refs = (s: string): number[] => [...s.matchAll(/(\d+)\s+\d+\s+R\b/g)].map((m) => Number(m[1]));

// the value of /Key: a dict, an array or a reference, as text
function entry(dict: string, key: string): string | null {
  const m = new RegExp(`/${key}(?![A-Za-z0-9])\\s*`).exec(dict);
  if (!m) return null;
  const rest = dict.slice(m.index + m[0].length);
  const open = rest.startsWith("<<") ? "<<" : rest.startsWith("[") ? "[" : null;
  if (!open) return /^\d+\s+\d+\s+R|^\S+/.exec(rest)?.[0] ?? null;
  const close = open === "<<" ? ">>" : "]";
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    if (rest.startsWith(open, i)) { depth++; i += open.length - 1; }
    else if (rest.startsWith(close, i)) { depth--; if (!depth) return rest.slice(0, i + close.length); i += close.length - 1; }
  }
  return null;
}

const deref = (v: string | null, objs: Map<number, Obj>): string | null => {
  const r = v && /^(\d+)\s+\d+\s+R$/.exec(v.trim());
  return r ? objs.get(Number(r[1]))?.dict ?? null : v;
};

interface Font { bytes: 1 | 2; map: Map<number, string>; mac?: boolean }

// one-byte fonts without a ToUnicode map: Mac Roman, else Windows-1252 (Latin-1 plus 0x80–0x9F)
const MAC_HIGH = "ÄÅÇÉÑÖÜáàâäãåçéèêëíìîïñóòôöõúùûü†°¢£§•¶ß®©™´¨≠ÆØ∞±≤≥¥µ∂∑∏π∫ªºΩæø¿¡¬√ƒ≈∆«»… ÀÃÕŒœ–—“”‘’÷◊ÿŸ⁄€‹›ﬁﬂ‡·‚„‰ÂÊÁËÈÍÎÏÌÓÔ\uF8FFÒÚÛÙıˆ˜¯˘˙˚¸˝˛ˇ";
const WIN_80 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008DŽ\u008F\u0090‘’“”•–—˜™š›œ\u009DžŸ";
const oneByte = (c: number, mac?: boolean): string =>
  c < 128 ? String.fromCharCode(c) : mac ? MAC_HIGH[c - 128] ?? "" : c < 160 ? WIN_80[c - 128] : String.fromCharCode(c);

function cmap(s: string): Font {
  const map = new Map<number, string>();
  const hex = (h: string) => { let t = ""; for (let i = 0; i < h.length; i += 4) t += String.fromCharCode(parseInt(h.slice(i, i + 4).padEnd(4, "0"), 16)); return t; };
  const space = /begincodespacerange\s*<([0-9a-fA-F]+)>/.exec(s);
  const bytes = space && space[1].length <= 2 ? 1 : 2;
  for (const b of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]*)>/g)) map.set(parseInt(m[1], 16), hex(m[2]));
  for (const b of s.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))
    for (const m of b[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]*>|\[[^\]]*\])/g)) {
      const lo = parseInt(m[1], 16), hi = Math.min(parseInt(m[2], 16), lo + 65535);
      if (m[3].startsWith("[")) { [...m[3].matchAll(/<([0-9a-fA-F]*)>/g)].forEach((d, i) => map.set(lo + i, hex(d[1]))); continue; }
      const base = m[3].slice(1, -1), last = parseInt(base.slice(-4) || "0", 16);
      for (let c = lo; c <= hi; c++) map.set(c, hex(base.slice(0, -4)) + String.fromCharCode(last + c - lo));
    }
  return { bytes, map };
}

async function fonts(resources: string | null, objs: Map<number, Obj>): Promise<Map<string, Font>> {
  const out = new Map<string, Font>();
  const dict = deref(entry(resources ?? "", "Font"), objs);
  if (!dict) return out;
  for (const m of dict.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g)) {
    const f = objs.get(Number(m[2]));
    if (!f) continue;
    const tu = entry(f.dict, "ToUnicode");
    const two = /\/Encoding\s*\/Identity-[HV]/.test(f.dict);
    const o = tu ? objs.get(refs(tu)[0] ?? -1) : undefined;
    const data = o ? await streamData(o).catch(() => null) : null;
    const enc = deref(entry(f.dict, "Encoding"), objs) ?? "";
    out.set(m[1], data ? cmap(latin1(data)) : { bytes: two ? 2 : 1, map: new Map(), mac: /MacRomanEncoding/.test(enc) });
  }
  return out;
}

// a PDF string literal or hex string, as its bytes
function pdfBytes(tok: string): number[] {
  if (tok.startsWith("<")) { const h = tok.slice(1, -1).replace(/\s+/g, ""); return Array.from({ length: Math.ceil(h.length / 2) }, (_, i) => parseInt(h.slice(2 * i, 2 * i + 2).padEnd(2, "0"), 16)); }
  const out: number[] = [];
  const s = tok.slice(1, -1);
  const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") { out.push(c.charCodeAt(0)); continue; }
    const n = s[++i];
    if (n in esc) out.push(esc[n]);
    else if (/[0-7]/.test(n)) { let o = n; while (o.length < 3 && /[0-7]/.test(s[i + 1] ?? "")) o += s[++i]; out.push(parseInt(o, 8) & 255); }
    else if (n === "\r") { if (s[i + 1] === "\n") i++; }
    else if (n !== "\n") out.push(n.charCodeAt(0));
  }
  return out;
}

const decode = (b: number[], f: Font | undefined): string => {
  let s = "";
  if (!f || (!f.map.size && f.bytes === 1)) { for (const c of b) s += oneByte(c, f?.mac); return s; }
  for (let i = 0; i < b.length; i += f.bytes) {
    const c = f.bytes === 2 ? (b[i] << 8) | (b[i + 1] ?? 0) : b[i];
    s += f.map.get(c) ?? (f.bytes === 1 ? oneByte(c, f.mac) : "");
  }
  return s;
};

const TOKEN = /\((?:\\[\s\S]|[^\\)(]|\((?:\\[\s\S]|[^\\)])*\))*\)|<[0-9a-fA-F\s]*>(?!>)|\[|\]|\/[^\s/<>[\]()]+|[-+]?\d*\.?\d+|[A-Za-z'"*]+/g;

function pageText(content: string, fontsOf: Map<string, Font>): string {
  let out = "", font: Font | undefined;
  const stack: string[] = [];
  let inArray = false, arr: (number[] | number)[] = [];
  const put = (t: string) => { out += t; };
  for (const m of content.matchAll(TOKEN)) {
    const t = m[0];
    if (t === "[") { inArray = true; arr = []; continue; }
    if (t === "]") { inArray = false; stack.push("\u0000arr"); continue; }
    if (inArray) { if (t[0] === "(" || t[0] === "<") arr.push(pdfBytes(t)); else if (/^[-+\d.]/.test(t)) arr.push(Number(t)); continue; }
    if (t[0] === "(" || t[0] === "<" || t[0] === "/" || /^[-+\d.]/.test(t)) { stack.push(t); continue; }
    switch (t) {
      case "Tf": font = fontsOf.get(String(stack[stack.length - 2] ?? "").slice(1)); break;
      case "Tj": { const s = stack[stack.length - 1]; if (s && (s[0] === "(" || s[0] === "<")) put(decode(pdfBytes(s), font)); break; }
      case "'": case '"': { const s = stack[stack.length - 1]; put("\n"); if (s && (s[0] === "(" || s[0] === "<")) put(decode(pdfBytes(s), font)); break; }
      case "TJ": for (const p of arr) put(typeof p === "number" ? (p < -200 ? " " : "") : decode(p, font)); break;
      // a move along the line is often inside a word (kerning), so only a new line counts
      case "Td": case "TD": if (Number(stack[stack.length - 1])) put("\n"); break;
      case "T*": put("\n"); break;
      case "Tm": if (!/\n$/.test(out)) put("\n"); break;
      case "ET": if (!/\s$/.test(out)) put(" "); break;
    }
    stack.length = 0;
  }
  return out;
}

/** The text of a PDF's pages, in order; "" when it has none this can read. */
export async function pdfText(bytes: Uint8Array): Promise<string> {
  const src = latin1(bytes);
  if (!src.startsWith("%PDF")) return "";
  const objs = await objects(src, bytes);
  const pages: { contents: number[]; resources: string | null }[] = [];
  const walk = (id: number, inherited: string | null, seen: Set<number>) => {
    if (seen.has(id) || seen.size > 5000) return;
    seen.add(id);
    const d = objs.get(id)?.dict;
    if (!d) return;
    const res = deref(entry(d, "Resources"), objs) ?? inherited;
    if (/\/Type\s*\/Pages\b/.test(d)) { for (const k of refs(entry(d, "Kids") ?? "")) walk(k, res, seen); return; }
    if (/\/Type\s*\/Page\b/.test(d)) {
      const c = entry(d, "Contents") ?? "";
      const list = c.startsWith("[") ? refs(c) : (deref(c, objs)?.trim().startsWith("[") ? refs(deref(c, objs)!) : refs(c));
      pages.push({ contents: list, resources: res });
    }
  };
  const root = [...objs.values()].find((o) => /\/Type\s*\/Catalog\b/.test(o.dict));
  const top = refs(entry(root?.dict ?? "", "Pages") ?? "")[0];
  if (top !== undefined) walk(top, null, new Set());
  const texts: string[] = [];
  for (const p of pages) {
    const f = await fonts(p.resources, objs);
    let content = "";
    for (const c of p.contents) { const o = objs.get(c); const d = o ? await streamData(o).catch(() => null) : null; if (d) content += latin1(d) + "\n"; }
    texts.push(pageText(content, f).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim());
  }
  return texts.filter(Boolean).join("\n\n");
}
