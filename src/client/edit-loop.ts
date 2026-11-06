export type EditIntent =
  | { kind: "headline"; text: string }
  | { kind: "button"; label: string; target?: string }
  | { kind: "accent"; colour: string; asked: string }
  | { kind: "copy"; text: string; what: string }
  | { kind: "undo" };

export const EDITABLE_KINDS = ["html", "site", "game"] as const;

export type EditStatus =
  | "changed"
  | "already"
  | "missing"
  | "unsupported";

export interface EditResult {
  status: EditStatus;
  html: string;
  say: string;
}

const UNDO = /^\s*(?:undo|undo that|revert|revert that|put it back|change it back|go back)\s*[.!]?\s*$/i;

const HEADLINE: RegExp[] = [
  /\b(?:change|set|update|rewrite|edit|make)\s+(?:the\s+)?(?:page\s+|hero\s+|main\s+)?(?:headline|heading|title|h1)\s*(?:to|say|read|:)\s+(.+)$/i,
  /\bheadline\s+to\s+(.+)$/i,
];

const BUTTON: RegExp[] = [
  /\b(?:change|set|update|rename|make)\s+(?:the\s+)?["'“‘](.+?)["'”’]\s+(?:button|link|cta)\s*(?:'s\s*)?(?:label|text|copy)?\s*(?:to|say|read|:)\s+(.+)$/i,
  /\b(?:change|set|update|rename|make)\s+(?:the\s+)?(?:button|cta|call to action)\s*(?:'s\s*)?(?:label|text|copy)?\s*(?:to|say|read|:)\s+(.+)$/i,
];

const ACCENT: RegExp[] = [
  /\b(?:change|set|update|switch|turn|make)\s+(?:the\s+)?accent\s*(?:colou?r)?\s*(?:to|:)?\s+(.+)$/i,
  /\b(?:change|set|update|switch|turn|make)\s+(?:the\s+)?(?:brand|primary|main|button|link)?\s*colou?r\s*(?:to|:)?\s+(.+)$/i,
  /\b(?:accent|colou?r)\s+to\s+(.+)$/i,
];

const COPY: RegExp[] = [
  /\b(?:change|set|update|rewrite|make)\s+(?:the\s+)?(sub(?:head(?:ing|line)?|title)|body copy|paragraph|intro|blurb|description|strapline)\s*(?:to|say|read|:)\s+(.+)$/i,
];

function tidy(s: string): string {
  let t = s.trim();
  t = t.replace(/^["'“‘]+/, "").replace(/["'”’]+$/, "").trim();
  t = t.replace(/\.$/, "").trim();
  return t;
}

const NAMED: Record<string, string> = {
  violet: "#7C5CFF", purple: "#7C5CFF", indigo: "#6C63FF",
  coral: "#FF8C68", orange: "#FF8C68", peach: "#FFB59B",
  blue: "#4D8DFF", navy: "#1B2A6B", cyan: "#00E5FF", teal: "#7FD9CF",
  green: "#3DBE7A", mint: "#8CFF9A", lime: "#B7FF7A",
  red: "#FF5A5F", crimson: "#D7263D", pink: "#F28CB8", magenta: "#FF2FD6",
  gold: "#E7B84B", amber: "#E7B84B", yellow: "#F2D27A",
  white: "#FFFFFF", black: "#111111",
  grey: "#8A8A90", gray: "#8A8A90", silver: "#C0C0C0",
};

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC = /^(?:rgba?|hsla?|color|oklch|lab)\([^()]*\)$/i;

export function resolveColour(word: string): string | null {
  const w = word.trim().replace(/[.,;]+$/, "");
  if (HEX.test(w)) return w;
  if (FUNC.test(w.replace(/\s+/g, " "))) return w.replace(/\s+/g, " ");
  const key = w.toLowerCase().replace(/\s+/g, "");
  return NAMED[key] ?? null;
}

export function classifyEdit(text: string): EditIntent | null {
  const s = text.trim();
  if (!s) return null;
  if (UNDO.test(s)) return { kind: "undo" };

  for (const re of HEADLINE) {
    const m = re.exec(s);
    if (m) {
      const t = tidy(m[1]);
      if (t) return { kind: "headline", text: t };
    }
  }

  for (const re of BUTTON) {
    const m = re.exec(s);
    if (m) {
      const label = tidy(m[m.length - 1]);
      const target = m.length > 2 ? tidy(m[1]) : undefined;
      if (label) return { kind: "button", label, target };
    }
  }

  for (const re of ACCENT) {
    const m = re.exec(s);
    if (m) {
      const asked = tidy(m[1]);
      if (!asked) continue;
      const colour = resolveColour(asked);
      if (!colour && asked.split(/\s+/).length > 3) return null;
      return { kind: "accent", colour: colour ?? "", asked };
    }
  }

  for (const re of COPY) {
    const m = re.exec(s);
    if (m) {
      const t = tidy(m[2]);
      if (t) return { kind: "copy", text: t, what: m[1].toLowerCase() };
    }
  }

  return null;
}

export type ParseHTML = (html: string) => Document;

export const domParse: ParseHTML = (html) =>
  new DOMParser().parseFromString(html, "text/html");

const isFullDoc = (src: string) => /<html[\s>]/i.test(src);

function parseDoc(src: string, parse: ParseHTML): { doc: Document; full: boolean } {
  const full = isFullDoc(src);
  const doc = parse(full ? src : `<!doctype html><html><head></head><body>${src}</body></html>`);
  return { doc, full };
}

function serialise(doc: Document, full: boolean): string {
  if (!full) return doc.body ? doc.body.innerHTML : "";
  const dt = doc.doctype ? `<!doctype ${doc.doctype.name}>` : "";
  return dt + (doc.documentElement ? doc.documentElement.outerHTML : "");
}

function pick(doc: Document, selectors: string[]): Element | null {
  for (const sel of selectors) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  return null;
}

const HEAD_SELECTORS = ["[data-headline]", ".headline", ".hero h1", "header h1", "h1", ".hero h2", "h2"];

const BTN_SELECTORS = [
  "[data-cta]", "a.btn", "button.btn", ".btn", ".cta", "a.button", "button",
  "[role=button]", "input[type=submit]",
];

const CLICKABLE = "a, button, [role=button], input[type=submit], .btn, .cta, .ghost, [data-cta]";

const COPY_SELECTORS = ["[data-sub]", ".sub", ".subhead", ".hero p", "header p", "main p", "p"];

const ACCENT_VARS = [
  "--accent", "--accent-color", "--accent-colour", "--color-accent",
  "--brand", "--brand-color", "--primary", "--primary-color", "--app-primary",
];

const label = (el: Element) =>
  (el.tagName === "INPUT" ? (el.getAttribute("value") ?? "") : (el.textContent ?? "")).trim();

function setText(el: Element, next: string): EditStatus {
  if (label(el) === next) return "already";
  if (el.tagName === "INPUT") el.setAttribute("value", next);
  else el.textContent = next;
  return "changed";
}

function rewriteAccent(doc: Document, colour: string): { status: EditStatus; prop?: string; from?: string } {
  const styles = Array.from(doc.querySelectorAll("style"));
  const roots = Array.from(doc.querySelectorAll("[style]"));

  for (const prop of ACCENT_VARS) {
    const decl = new RegExp(`(${prop}\\s*:\\s*)([^;}\\n]+)`, "gi");
    let found = false;
    let already = true;
    let from = "";

    for (const s of styles) {
      const css = s.textContent ?? "";
      if (!decl.test(css)) { decl.lastIndex = 0; continue; }
      decl.lastIndex = 0;
      const next = css.replace(decl, (_m, head: string, val: string) => {
        found = true;
        if (!from) from = val.trim();
        if (val.trim() !== colour) already = false;
        return head + colour;
      });
      if (next !== css) s.textContent = next;
    }

    for (const el of roots) {
      const css = el.getAttribute("style") ?? "";
      decl.lastIndex = 0;
      if (!decl.test(css)) { decl.lastIndex = 0; continue; }
      decl.lastIndex = 0;
      const next = css.replace(decl, (_m, head: string, val: string) => {
        found = true;
        if (!from) from = val.trim();
        if (val.trim() !== colour) already = false;
        return head + colour;
      });
      if (next !== css) el.setAttribute("style", next);
    }

    if (found) return { status: already ? "already" : "changed", prop, from };
  }

  return rewriteDominant(styles, roots, colour);
}

const HEX_IN_CSS = /#(?:[0-9a-f]{6}|[0-9a-f]{3})\b/gi;

function chromatic(hex: string): boolean {
  const h = hex.length === 4 ? hex.slice(1).split("").map((c) => c + c).join("") : hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min || l < 0.15 || l > 0.9) return false;
  return (max - min) / (1 - Math.abs(2 * l - 1)) > 0.3;
}

function rewriteDominant(styles: Element[], roots: Element[], colour: string): { status: EditStatus; prop?: string; from?: string } {
  const texts = [...styles.map((s) => s.textContent ?? ""), ...roots.map((el) => el.getAttribute("style") ?? "")];
  const counts = new Map<string, number>();
  for (const t of texts) for (const m of t.match(HEX_IN_CSS) ?? []) {
    const k = m.toLowerCase();
    if (chromatic(k)) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const [from, n] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  if (n < 2) return { status: "unsupported" };
  if (from === colour.toLowerCase()) return { status: "already", prop: "the brand colour", from };

  const swap = (t: string) => t.replace(HEX_IN_CSS, (m) => (m.toLowerCase() === from ? colour : m));
  for (const s of styles) s.textContent = swap(s.textContent ?? "");
  for (const el of roots) el.setAttribute("style", swap(el.getAttribute("style") ?? ""));
  return { status: "changed", prop: "the brand colour", from };
}

export function applyEdit(src: string, intent: EditIntent, parse: ParseHTML = domParse): EditResult {
  const no = (status: EditStatus, say: string): EditResult => ({ status, html: src, say });

  if (intent.kind === "undo") {
    return no("unsupported", "Undo is handled by the pane, not by the page.");
  }

  let doc: Document;
  let full: boolean;
  try {
    ({ doc, full } = parseDoc(src, parse));
  } catch (e) {
    return no("unsupported", `That page could not be parsed, so nothing was changed (${(e as Error).message}).`);
  }

  let status: EditStatus;
  let say: string;

  if (intent.kind === "headline") {
    const el = pick(doc, HEAD_SELECTORS);
    if (!el) {
      return no("missing", "That page has no heading — no h1, no h2, nothing marked as a headline — so there was nothing to change.");
    }
    const before = label(el);
    status = setText(el, intent.text);
    say = status === "already"
      ? `The headline was already “${intent.text}”, so nothing changed.`
      : `Headline changed from “${before}” to “${intent.text}”.`;
  } else if (intent.kind === "button") {
    const all = Array.from(doc.querySelectorAll(CLICKABLE)).filter((b) => label(b));
    if (!all.length) {
      return no("missing", "That page has no button or call-to-action link, so there was nothing to relabel.");
    }
    let el: Element | undefined;
    if (intent.target) {
      const want = intent.target.toLowerCase();
      el = all.find((b) => label(b).toLowerCase() === want) ?? all.find((b) => label(b).toLowerCase().includes(want));
      if (!el) {
        const shown = all.slice(0, 6).map((b) => `“${label(b)}”`).join(", ");
        return no(
          "missing",
          `No button on that page says “${intent.target}”. It has ${all.length === 1 ? "one" : all.length}: ` +
            `${shown}${all.length > 6 ? ", …" : ""}. Nothing was changed.`,
        );
      }
    } else {
      el = pick(doc, BTN_SELECTORS) ?? all[0];
    }
    const before = label(el);
    status = setText(el, intent.label);
    say = status === "already"
      ? `That button already said “${intent.label}”, so nothing changed.`
      : `Button relabelled from “${before}” to “${intent.label}”.`;
  } else if (intent.kind === "accent") {
    if (!intent.colour) {
      return no("unsupported", `I do not know what colour “${intent.asked}” is. Give me a name like coral or violet, or a hex value like #FF8C68.`);
    }
    const r = rewriteAccent(doc, intent.colour);
    if (r.status === "unsupported") {
      return no(
        "unsupported",
        `That page has no accent variable and no brand colour used more than once, so there is nothing to recolour consistently. Nothing was changed.`,
      );
    }
    status = r.status;
    say = status === "already"
      ? `${r.prop} was already ${intent.colour}, so nothing changed.`
      : `Accent changed: ${r.prop} rewritten from ${r.from} to ${intent.colour}${intent.asked.toLowerCase() === intent.colour.toLowerCase() ? "" : ` (${intent.asked})`}.`;
  } else {
    const el = pick(doc, COPY_SELECTORS);
    if (!el) {
      return no("missing", `That page has no paragraph to use as its ${intent.what}, so there was nothing to change.`);
    }
    const before = label(el);
    status = setText(el, intent.text);
    say = status === "already"
      ? `The ${intent.what} already read that way, so nothing changed.`
      : `Changed the ${intent.what} from “${before.length > 60 ? `${before.slice(0, 57)}…` : before}” to “${intent.text}”.`;
  }

  const out = serialise(doc, full);
  if (status === "changed" && out === src) {
    return no(
      "unsupported",
      "I made that change in the parsed page and it came back identical, which means it did not take. Nothing was saved. This is a bug worth reporting, not a page that resisted editing.",
    );
  }
  if (status !== "changed" && out !== src) {
    return no(status, say);
  }
  return { status, html: out, say };
}

export interface OpenDoc {
  id: string;
  title: string;
  kind: string;
  source?: string;
  update?: (html: string) => void;
}

let current: OpenDoc | null = null;
// pages changed in place this session; the demo publisher serves Own Build's original
const edited = new Set<string>();
export const wasEdited = (id: string): boolean => edited.has(id);
const history: { id: string; source: string; what: string }[] = [];

export function trackOpen(a: { id: string; title: string; kind: string }): void {
  if (current && current.id === a.id) {
    current.title = a.title;
    current.kind = a.kind;
    return;
  }
  current = { id: a.id, title: a.title, kind: a.kind };
  history.length = 0;
}

export function openEditable(d: OpenDoc): void {
  if (!current || current.id !== d.id) history.length = 0;
  current = d;
}

export function trackClosed(): void {
  current = null;
  history.length = 0;
}

export function openDoc(): OpenDoc | null {
  return current;
}

export function canUndo(): boolean {
  return history.length > 0;
}

export function undo(): { ok: boolean; say: string } {
  const last = history.pop();
  if (!last) return { ok: false, say: "There is nothing to undo — no edit has been made to what is open." };
  if (!current || current.id !== last.id || !current.update) {
    return { ok: false, say: "The page that edit belonged to is no longer open, so there is nothing to put back." };
  }
  const now = current.source;
  if (now === last.source) {
    return { ok: false, say: "The page already matches the version before that edit, so undo would change nothing." };
  }
  current.source = last.source;
  current.update(last.source);
  return { ok: true, say: `Undone — ${last.what} put back.` };
}

export function handleEdit(text: string): { say: string } | null {
  const intent = classifyEdit(text);
  if (!intent) return null;

  if (intent.kind === "undo") return { say: undo().say };

  if (!current) {
    return {
      say:
        "There is nothing open on the right to edit. Open a page or build one first, " +
        "then I can change its headline, a button label, a paragraph, or its accent colour.",
    };
  }

  if (!current.source || !current.update) {
    const kindWord =
      current.kind === "image" ? "an image" :
      current.kind === "audio" ? "an audio track" :
      current.kind === "plan" ? "a plan" :
      current.kind === "doc" ? "a document" :
      current.kind === "table" ? "a table" : `a ${current.kind}`;
    return {
      say:
        `“${current.title}” is ${kindWord}, and this pane does not hold its source, so I cannot edit it here. ` +
        `Text edits work on the kinds whose page we hold: ${EDITABLE_KINDS.join(" and ")}. Nothing was changed.`,
    };
  }

  const before = current.source;
  const r = applyEdit(before, intent);

  if (r.status !== "changed") return { say: r.say };

  if (r.html === before) {
    return { say: "That came back identical to what is already on the right, so I have not reported it as a change." };
  }

  history.push({ id: current.id, source: before, what: describe(intent) });
  while (history.length > 8) history.shift();
  current.source = r.html;
  current.update(r.html);
  edited.add(current.id);
  return { say: r.say };
}

// The page open on the right, when it is one Nexy can change in place.
export function editablePage(): { id: string; title: string; kind: string; source: string } | null {
  return current && current.source && current.update && (EDITABLE_KINDS as readonly string[]).includes(current.kind)
    ? { id: current.id, title: current.title, kind: current.kind, source: current.source }
    : null;
}

// A change made elsewhere (the model) lands here so "undo" puts it back like any other edit.
// `id` guards against the person switching pages while the model was working.
export function applyRevision(id: string, html: string, what: string): boolean {
  if (!current || current.id !== id || !current.source || !current.update || html === current.source) return false;
  history.push({ id: current.id, source: current.source, what });
  while (history.length > 8) history.shift();
  current.source = html;
  current.update(html);
  edited.add(id);
  return true;
}

function describe(i: EditIntent): string {
  return i.kind === "headline" ? "the headline"
    : i.kind === "button" ? "the button label"
    : i.kind === "accent" ? "the accent colour"
    : i.kind === "copy" ? `the ${i.what}`
    : "that";
}
