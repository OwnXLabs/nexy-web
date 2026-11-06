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
