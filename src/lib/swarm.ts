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
}

const MAX_SECTIONS = 6, MAX_IMAGES = 6;
const ID = /^[a-z][a-z0-9-]{0,30}$/;
const COLOR = /^#[0-9a-f]{6}$/i;

const PLAN_PROMPT = `You plan a one-page website that several computers will build in parallel.
Reply with JSON only, no prose:
{"title":"…","style":{"bg":"#rrggbb","fg":"#rrggbb","accent":"#rrggbb","font":"a Google-safe font stack"},
 "sections":[{"id":"hero","title":"…","brief":"what this section says and shows"}],
 "images":[{"id":"…","prompt":"a photo or illustration prompt","section":"<section id>"}]}
Use 3 to ${MAX_SECTIONS} sections and 0 to ${MAX_IMAGES} images. Ids are lowercase words with dashes.`;

const SECTION_PROMPT = (p: Plan, s: Plan["sections"][number], imgs: string[]) => `Write the HTML for ONE section of the website "${p.title}".
Section "${s.title}": ${s.brief}
Return only a single <section id="${s.id}">…</section> element. Inline styles only, no <script>, no external links or fonts.
Colours: background ${p.style.bg}, text ${p.style.fg}, accent ${p.style.accent}.${imgs.length ? `\nPlace these images where they fit, exactly as written: ${imgs.map(i => `<img data-img="${i}" alt="">`).join(" ")}` : ""}`;

export function parsePlan(text: string): Plan {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("the plan was not JSON");
  const j = JSON.parse(m[0]);
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
  const body = p.sections.map(s => sections.get(s.id) ?? `<section id="${s.id}"><h2>${esc(s.title)}</h2></section>`).join("\n")
    .replace(/<img([^>]*?)data-img="([a-z0-9-]+)"([^>]*)>/g, (all, a, id, b) => {
      const im = images.get(id);
      return im && /^image\/(png|jpeg|webp)$/.test(im.mime) ? `<img${a}src="data:${im.mime};base64,${im.b64}"${b}>` : "";
    });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(p.title)}</title><style>body{margin:0;background:${p.style.bg};color:${p.style.fg};font-family:${p.style.font}}
section{padding:48px 20px;max-width:1040px;margin:0 auto}img{max-width:100%;height:auto;border-radius:12px}a{color:${p.style.accent}}</style></head>
<body>${body}</body></html>`;
}

/** Spread tasks over online devices that can do them; the Own1 decides when none can. */
export function routes(kind: "chat" | "image", n: number, workers: Worker[]): string[] {
  const able = workers.filter(w => w.online && w.caps.some(c => c.startsWith(kind === "chat" ? "chat:" : "image:")));
  const order = ["box", ...able.map(w => `device:${w.address}`)];
  return Array.from({ length: n }, (_, i) => order[i % order.length]);
}

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
    const planned = await step({ id: "plan", kind: "plan", label: "Plan the site", on: "box", state: "queued" },
      () => deps.chat({ model: "txt2txt", messages: [{ role: "system", content: PLAN_PROMPT }, { role: "user", content: prompt }], max_tokens: 1500 }, "box"));
    if (!planned) throw new Error("planning failed");
    const plan = parsePlan(planned.text);
    emit({ type: "plan", plan });

    const workers = await deps.workers().catch(() => [] as Worker[]);
    const chatRoutes = routes("chat", plan.sections.length, workers), imageRoutes = routes("image", plan.images.length, workers);
    const sections = new Map<string, string>(), images = new Map<string, { b64: string; mime: string }>();
    await Promise.all([
      ...plan.sections.map((s, i) => step({ id: `s-${s.id}`, kind: "chat", label: `${s.title} section`, on: chatRoutes[i], state: "queued" }, async () => {
        const imgs = plan.images.filter(im => im.section === s.id).map(im => im.id);
        const r = await deps.chat({ model: "txt2txt", messages: [{ role: "user", content: SECTION_PROMPT(plan, s, imgs) }], max_tokens: 2000 }, chatRoutes[i]);
        sections.set(s.id, clean(r.text, s.id));
        return r;
      })),
      ...plan.images.map((im, i) => step({ id: `i-${im.id}`, kind: "image", label: im.prompt.split(/[,.]/)[0].slice(0, 40), on: imageRoutes[i], state: "queued" }, async () => {
        const r = await deps.image({ model: "txt2img", prompt: im.prompt, size: "768x512", n: 1 }, imageRoutes[i]);
        images.set(im.id, { b64: r.b64, mime: r.mime });
        return r;
      })),
    ]);
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
