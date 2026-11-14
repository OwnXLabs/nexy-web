export interface ChatOutput {
  id: string;
  kind: string;
  title: string;
  meta?: string;
  href?: string;
  source?: string;
  markup?: string;
}
const KINDS = new Set(["plan", "image", "audio", "html", "doc", "table", "text", "code", "diagram", "game"]);
export function cleanOutputs(raw: unknown): ChatOutput[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 100).flatMap((o): ChatOutput[] => {
    if (!o || typeof o !== "object" || typeof o.id !== "string" || !KINDS.has(o.kind) || typeof o.title !== "string") return [];
    const href = typeof o.href === "string" && (/^\/(?!\/)/.test(o.href) || /^data:image\/(png|jpeg|webp);base64,/.test(o.href)) ? o.href : undefined;
    return [{ id: o.id.slice(0, 240), kind: o.kind, title: o.title.slice(0, 120),
      meta: typeof o.meta === "string" ? o.meta.slice(0, 240) : undefined, href,
      source: typeof o.source === "string" ? o.source.slice(0, 2_000_000) : undefined,
      markup: typeof o.markup === "string" ? o.markup.slice(0, 2_000_000) : undefined }];
  });
}

// Own Build ends an error with the line and its code: "(line 214: `const n = obstacles.length;`)".
// The builder gets all of it; the chat and the turn log only the line number.
export const ERROR_MAX = 600;
export const plainError = (error: string): string => error.replace(/\(line (\d+): `[^`]*`?\)?/g, "(line $1)");

// The chat's last build, so "build again" reruns what was asked rather than the words "again".
// next: another turn came after it
export interface LastBuild {
  brief: string;
  deliverable: "web_app" | "diagram";
  id?: string;
  outcome: "running" | "done" | "failed";
  error?: string;
  next?: boolean;
}
export function cleanLastBuild(raw: any): LastBuild | undefined {
  if (!raw || typeof raw.brief !== "string" || !raw.brief.trim()) return undefined;
  return {
    brief: raw.brief.slice(0, 4000),
    deliverable: raw.deliverable === "diagram" ? "diagram" : "web_app",
    id: typeof raw.id === "string" ? raw.id.slice(0, 120) : undefined,
    outcome: raw.outcome === "done" || raw.outcome === "failed" ? raw.outcome : "running",
    error: typeof raw.error === "string" ? raw.error.slice(0, ERROR_MAX) : undefined,
    next: raw.next === true || undefined,
  };
}
