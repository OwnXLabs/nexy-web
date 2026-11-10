// Swarm build: one request becomes a plan, the plan's sections and images run in parallel on the
// owner's devices (through the Own1's job routing), and the pieces are stitched into one page.
// Dependencies are passed in, so the same code runs against the box or against test doubles.

export interface Worker { address: string; name: string; caps: string[]; online: boolean; busy?: boolean }
export interface Plan {
  title: string;
  style: { bg: string; fg: string; accent: string; font: string };
  sections: { id: string; title: string; brief: string }[];
  images: { id: string; prompt: string; section: string }[];
}
export interface Task { id: string; kind: "plan" | "chat" | "image" | "stitch"; label: string; on?: string; state: "queued" | "running" | "done" | "failed"; ms?: number; error?: string }
export type Event =
  | { type: "plan"; plan: Plan }
  | { type: "task"; task: Task }
  | { type: "done"; html: string; url?: string; tasks: Task[] }
  | { type: "failed"; error: string };

export interface Deps {
  /** One completion; route is "auto", "box" or "device:0x…". Returns text and where it ran. */
  chat(body: object, route: string): Promise<{ text: string; ranOn: string }>;
  /** One image as base64 (any image type) with its mime type. */
  image(body: object, route: string): Promise<{ b64: string; mime: string; ranOn: string }>;
  workers(): Promise<Worker[]>;
  publish?(name: string, html: string): Promise<string>;
  /** Waits between retries; tests pass a short one. */
  sleep?(ms: number): Promise<void>;
}

const MAX_SECTIONS = 6, MAX_IMAGES = 6;
// answers without visible thinking, on servers that support the switch; others ignore it
const QUIET = { chat_template_kwargs: { enable_thinking: false }, reasoning_effort: "low" };
const ID = /^[a-z][a-z0-9-]{0,30}$/;
const COLOR = /^#[0-9a-f]{6}$/i;

const PLAN_PROMPT = `/no_think
You plan a one-page website that several computers will build in parallel.
Reply with JSON only, no prose:
{"title":"…","style":{"bg":"#rrggbb","fg":"#rrggbb","accent":"#rrggbb","font":"a Google-safe font stack"},
 "sections":[{"id":"hero","title":"…","brief":"what this section says and shows"}],
 "images":[{"id":"…","prompt":"a photo or illustration prompt","section":"<section id>"}]}
Use 3 to ${MAX_SECTIONS} sections and 0 to ${MAX_IMAGES} images. Ids are lowercase words with dashes.`;

const SECTION_PROMPT = (p: Plan, s: Plan["sections"][number], imgs: string[]) => `Write the HTML for ONE section of the website "${p.title}".
Section "${s.title}": ${s.brief}
Return only a single <section id="${s.id}">…</section> element. Inline styles only, no <script>, no external links or fonts.
Colours: background ${p.style.bg}, text ${p.style.fg}, accent ${p.style.accent}.
No maps, videos, iframes or forms that need a server. Don't add any other <img> tags.${imgs.length ? `\nPlace each of these images once, exactly as written, and make the first one large (width:100%): ${imgs.map(i => `<img data-img="${i}" alt="">`).join(" ")}` : ""}`;

/** The JSON object in a model reply: thinking, code fences and prose around it are dropped. */
export function jsonIn(text: string): any {
  const t = text.replace(/<think>[\s\S]*?(<\/think>|$)/gi, "").replace(/```(?:json)?/gi, "");
  for (let start = t.indexOf("{"); start >= 0; start = t.indexOf("{", start + 1)) {
    let depth = 0, inStr = false, esc = false;
    for (let i = start; i < t.length; i++) {
      const c = t[i];
      if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
      if (c === '"') inStr = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try { return JSON.parse(t.slice(start, i + 1)); } catch { break; }
      }
    }
  }
  throw new Error("the plan was not JSON");
}

export function parsePlan(text: string): Plan {
  const j = jsonIn(text);
  const sections = (Array.isArray(j.sections) ? j.sections : [])
    .filter((s: any) => ID.test(String(s?.id)) && s?.title && s?.brief).slice(0, MAX_SECTIONS)
    .map((s: any) => ({ id: String(s.id), title: String(s.title).slice(0, 80), brief: String(s.brief).slice(0, 600) }));
  if (sections.length < 1) throw new Error("the plan has no sections");
  const ids = new Set(sections.map((s: any) => s.id));
  const images = (Array.isArray(j.images) ? j.images : [])
    .filter((i: any) => ID.test(String(i?.id)) && i?.prompt && ids.has(String(i.section))).slice(0, MAX_IMAGES)
    .map((i: any) => ({ id: String(i.id), prompt: String(i.prompt).slice(0, 400), section: String(i.section) }));
  const st = j.style ?? {};
  const style = {
    bg: COLOR.test(st.bg) ? st.bg : "#0f0f14", fg: COLOR.test(st.fg) ? st.fg : "#f5f5f7",
    accent: COLOR.test(st.accent) ? st.accent : "#ff9a7a", font: String(st.font ?? "system-ui, sans-serif").replace(/[;{}<>"]/g, "").slice(0, 80),
  };
  return { title: String(j.title ?? "Website").slice(0, 80), style, sections, images };
}

/** Generated HTML is shown as a static page: drop scripts, event handlers and anything that loads from elsewhere. */
export function clean(html: string, id: string): string {
  const m = html.match(/<section[\s\S]*<\/section>/i);
  let h = m ? m[0] : `<section id="${id}">${html.replace(/<[^>]+>/g, "")}</section>`;
  h = h.replace(/<(script|iframe|object|embed|link|meta|base|form)[\s\S]*?(<\/\1>|\/?>)/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src|action)\s*=\s*("|')\s*(javascript|data|https?):[^"']*\2/gi, "$1=$2#$2")
    .replace(/url\(\s*['"]?\s*(https?|javascript|data):[^)]*\)/gi, "none");
  return h;
}

export function stitch(p: Plan, sections: Map<string, string>, images: Map<string, { b64: string; mime: string }>): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
  const ok = (id: string) => { const im = images.get(id); return im && /^image\/(png|jpeg|webp)$/.test(im.mime) ? im : undefined; };
  const placed = new Set<string>();
  const body = p.sections.map(s => {
    let h = (sections.get(s.id) ?? `<section id="${s.id}"><h2>${esc(s.title)}</h2></section>`)
      // each made image once, with its own data; any src the model wrote is dropped
      .replace(/<img([^>]*?)data-img="([a-z0-9-]+)"([^>]*)>/g, (_all, a: string, id: string, b: string) => {
        const im = ok(id);
        if (!im || placed.has(id)) return "";
        placed.add(id);
        const attrs = (a + " " + b).replace(/\ssrc\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "").replace(/\s*\/\s*$/, "");
        return `<img${attrs} src="data:${im.mime};base64,${im.b64}">`;
      })
      // other images can't load here (no outside requests): drop them rather than show a broken box
      .replace(/<img(?![^>]*src="data:)[^>]*>/gi, "");
    // a made image the section forgot to place goes at its end
    const left = p.images.filter(im => im.section === s.id && !placed.has(im.id) && ok(im.id));
    if (left.length) {
      h = h.replace(/<\/section>\s*$/i, left.map(im => { placed.add(im.id); const m = ok(im.id)!; return `<img alt="" src="data:${m.mime};base64,${m.b64}">`; }).join("") + "</section>");
    }
    return h;
  }).join("\n");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)}</title><style>body{margin:0;background:${p.style.bg};color:${p.style.fg};font-family:${p.style.font}}
section{padding:48px 20px;max-width:1040px;margin:0 auto}img{max-width:100%;height:auto;border-radius:12px}a{color:${p.style.accent}}</style></head>
<body>${body}</body></html>`;
}

export interface Lane { route: string; can: Set<"chat" | "image">; prefers: "chat" | "image" }

/** Who can take pieces: the Own1 and each online device, one piece at a time each. Devices with a
 *  graphics card take images first, the Own1 takes writing first. */
export function lanes(workers: Worker[]): Lane[] {
  const out: Lane[] = [{ route: "box", can: new Set(["chat", "image"]), prefers: "chat" }];
  for (const w of workers) {
    if (!w.online || !/^0x[0-9a-fA-F]{40}$/.test(w.address)) continue;
    const can = new Set<"chat" | "image">();
    if (w.caps.some(c => c.startsWith("chat:"))) can.add("chat");
    if (w.caps.some(c => c.startsWith("image:"))) can.add("image");
    if (can.size) out.push({ route: `device:${w.address}`, can, prefers: can.has("image") ? "image" : "chat" });
  }
  return out;
}

const RETRYABLE = /busy|answered 5\d\d|didn't pick it up|fetch failed|timeout/i;

export async function run(prompt: string, deps: Deps, emit: (e: Event) => void): Promise<string> {
  const tasks: Task[] = [];
  const update = (t: Task) => emit({ type: "task", task: { ...t } });
  const step = async <T>(t: Task, f: () => Promise<T & { ranOn?: string }>): Promise<T | undefined> => {
    tasks.push(t); t.state = "running"; update(t);
    const t0 = Date.now();
    try {
      const r = await f();
      Object.assign(t, { state: "done", ms: Date.now() - t0, on: r.ranOn ?? t.on }); update(t);
      return r;
    } catch (e) {
      Object.assign(t, { state: "failed", ms: Date.now() - t0, error: String((e as Error)?.message ?? e).slice(0, 200) }); update(t);
      return undefined;
    }
  };
  try {
    let plan: Plan | undefined, lastText = "";
    const sleep = deps.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
    for (let attempt = 1; attempt <= 3 && !plan; attempt++) {
      if (attempt > 1) await sleep(4000);
      const planned = await step({ id: attempt === 1 ? "plan" : `plan-${attempt}`, kind: "plan", label: attempt === 1 ? "Plan the site" : "Plan the site, again", on: "box", state: "queued" },
        () => deps.chat({ ...QUIET, model: "txt2txt", messages: [{ role: "system", content: PLAN_PROMPT }, { role: "user", content: prompt }], max_tokens: 3000 }, "box"));
      if (!planned) continue;
      lastText = planned.text;
      try { plan = parsePlan(planned.text); }
      catch { console.warn(`[swarm] plan reply was not usable (${planned.text.length} chars): ${planned.text.slice(0, 300).replace(/\s+/g, " ")}`); }
    }
    if (!plan) throw new Error(lastText ? "the plan was not JSON" : "planning failed");
    emit({ type: "plan", plan });

    const workers = await deps.workers().catch(() => [] as Worker[]);
    const p = plan;
    const sections = new Map<string, string>(), images = new Map<string, { b64: string; mime: string }>();
    type Piece = { task: Task; kind: "chat" | "image"; go(route: string): Promise<{ ranOn?: string }> };
    const pieces: Piece[] = [
      ...p.sections.map((s): Piece => ({ kind: "chat", task: { id: `s-${s.id}`, kind: "chat", label: `${s.title} section`, state: "queued" },
        async go(route) {
          const imgs = p.images.filter(im => im.section === s.id).map(im => im.id);
          const r = await deps.chat({ ...QUIET, model: "txt2txt", messages: [{ role: "user", content: SECTION_PROMPT(p, s, imgs) }], max_tokens: 3000 }, route);
          sections.set(s.id, clean(r.text, s.id));
          return r;
        } })),
      ...p.images.map((im): Piece => ({ kind: "image", task: { id: `i-${im.id}`, kind: "image", label: im.prompt.split(/[,.]/)[0].slice(0, 40), state: "queued" },
        async go(route) {
          const r = await deps.image({ model: "txt2img", prompt: im.prompt, size: "768x512", n: 1 }, route);
          images.set(im.id, { b64: r.b64, mime: r.mime });
          return r;
        } })),
    ];
    for (const pc of pieces) { tasks.push(pc.task); update(pc.task); }
    const queue = [...pieces];
    const take = (l: Lane) => {
      let k = queue.findIndex(pc => pc.kind === l.prefers);
      if (k < 0) k = queue.findIndex(pc => l.can.has(pc.kind));
      return k < 0 ? undefined : queue.splice(k, 1)[0];
    };
    // each lane takes one piece at a time and the next when it's done, so a busy Own1 never refuses a crowd
    await Promise.all(lanes(workers).map(async (l) => {
      for (let pc = take(l); pc; pc = take(l)) {
        const t = pc.task;
        Object.assign(t, { state: "running", on: l.route }); update(t);
        const t0 = Date.now();
        for (let attempt = 1; ; attempt++) {
          try {
            const r = await pc.go(l.route);
            Object.assign(t, { state: "done", ms: Date.now() - t0, on: r.ranOn ?? l.route, error: undefined }); update(t);
            break;
          } catch (e) {
            const msg = String((e as Error)?.message ?? e).slice(0, 200);
            if (attempt < 3 && RETRYABLE.test(msg)) { await sleep(4000); continue; }
            Object.assign(t, { state: "failed", ms: Date.now() - t0, error: msg }); update(t);
            break;
          }
        }
      }
    }));
    if (!sections.size) throw new Error("no section was built");
    const html = stitch(plan, sections, images);
    let url: string | undefined;
    if (deps.publish) {
      const name = plan.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "site";
      url = await step({ id: "publish", kind: "stitch", label: "Stitch and publish", on: "box", state: "queued" },
        async () => ({ url: await deps.publish!(name, html) } as any)).then((r: any) => r?.url);
    }
    emit({ type: "done", html, url, tasks });
    return html;
  } catch (e) {
    emit({ type: "failed", error: String((e as Error)?.message ?? e) });
    throw e;
  }
}
