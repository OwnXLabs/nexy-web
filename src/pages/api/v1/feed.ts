import type { APIRoute } from "astro";
import { withHistory, type AppTarget } from "../../../lib/apps";
import { COOKIE, owner } from "../../../lib/owner";
import { cachedTitles, nameLater } from "../../../lib/titles";

export const prerender = false;

export interface FeedItem {
  app: string;
  appLabel: string;
  kind: string;
  id: string;
  title: string;
  ts: number;
  href: string | null;
}

const short = (t: string) => {
  const s = String(t).replace(/\s+/g, " ").trim();
  return s.length > 60 ? `${s.slice(0, 57).replace(/\s\S*$/, "")}…` : s;
};

// what the person asked for: diagram runs store own-build's instruction around it
function requestOf(prompt: string): string {
  const asked = /INLINE SVG:\s*(.+?)\.\s*Hard requirements/i.exec(prompt)?.[1] ?? prompt;
  const t = asked.split(". ")[0].trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function normalise(app: AppTarget, body: any): FeedItem[] {
  const base = { app: app.id, appLabel: app.label, kind: app.kind ?? "item" };
  const href = (id: string) => `/api/apps/${app.id}${app.history}/${encodeURIComponent(id)}`;

  if (Array.isArray(body?.entries))            // own-images, own-voice, own-beat
    return body.entries.map((e: any) => ({
      ...base, id: String(e.id), title: e.prompt ?? e.title ?? String(e.id),
      ts: Number(e.ts) || 0, href: href(String(e.id)),
    }));

  if (Array.isArray(body?.docs))               // own-docs
    return body.docs.map((d: any) => ({
      ...base, id: String(d.id), title: d.filename ?? String(d.id),
      ts: Date.parse(d.created_at ?? "") || 0, href: `/api/apps/${app.id}/api/v1/document?id=${encodeURIComponent(String(d.id))}`,
    }));

  if (Array.isArray(body?.projects))           // own-startup
    return body.projects.map((p: any) => ({
      ...base, id: String(p.id), title: p.title ?? String(p.id),
      ts: Number(p.updatedAt ?? p.createdAt) || 0, href: null,
    }));

  if (app.id === "build" && Array.isArray(body?.runs))     // own-build: only runs that made a page
    return body.runs.filter((r: any) => r.kind && !r.private).map((r: any) => ({
      ...base, kind: r.kind === "game" ? "game" : "html", id: String(r.id),
      title: short(requestOf(String(r.prompt ?? r.id))),
      ts: Number(r.startedAt) || 0, href: `/api/apps/build/api/director/runs/${encodeURIComponent(String(r.id))}/preview`,
    }));

  if (Array.isArray(body?.runs) || Array.isArray(body)) {   // own-qiki director runs
    const runs = Array.isArray(body) ? body : body.runs;
    return runs.map((r: any) => ({
      ...base, id: String(r.id),
      title: short(r.project?.name ?? requestOf(String(r.prompt ?? r.id))),
      ts: Number(r.startedAt) || 0, href: `/api/apps/${app.id}/runs/${encodeURIComponent(String(r.id))}/preview`,
    }));
  }
  return [];
}

export const GET: APIRoute = async (ctx) => {
  const { url } = ctx;
  const who = owner(ctx);
  const limit = Math.min(Number(url.searchParams.get("limit")) || 40, 200);
  const only = url.searchParams.get("app");

  const targets = withHistory().filter((a) => !only || a.id === only);

  const settled = await Promise.allSettled(
    targets.map(async (app) => {
      const res = await fetch(`${app.base}${app.history}`, {
        signal: AbortSignal.timeout(8000),
        headers: { accept: "application/json", cookie: `${COOKIE}=${who}` },
      });
      if (res.status === 404) return { silent: true as const, app: { id: app.id, label: app.label } };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { items: normalise(app, await res.json()) };
    }),
  );

  const items: FeedItem[] = [];
  const silent: Array<{ id: string; label: string }> = [];
  const degraded: Array<{ app: string; label: string; error: string }> = [];
  settled.forEach((r, i) => {
    if (r.status === "rejected") {
      degraded.push({ app: targets[i].id, label: targets[i].label, error: String(r.reason?.message ?? r.reason).slice(0, 120) });
    } else if (r.value.silent === true) {
      silent.push(r.value.app);
    } else {
      items.push(...r.value.items);
    }
  });

  items.sort((a, b) => b.ts - a.ts);
  const shown = items.slice(0, limit);

  // builds get a short name, like a chat app titles a conversation; named once, cached
  const names = await cachedTitles();
  for (const it of shown) {
    if (it.app !== "build" && it.app !== "qiki") continue;
    const key = `${it.app}:${it.id}`;
    if (names[key]) { it.title = names[key]; continue; }
    const app = targets.find((a) => a.id === it.app);
    if (!app || !it.href) continue;
    const asked = it.title;
    nameLater(key, async () => {
      const page = await fetch(app.base + it.href!.replace(`/api/apps/${app.id}`, ""), { signal: AbortSignal.timeout(15000) }).then((r) => r.text());
      const own = /<title>([^<]{1,80})<\/title>/i.exec(page)?.[1]?.trim() ?? "";
      return `A ${it.kind === "game" ? "game" : "web page"}.${own ? ` Its own title: "${own}".` : ""} What was asked: "${asked}".`;
    });
  }

  return new Response(
    JSON.stringify({ items: shown, silent, degraded, apps: targets.length }),
    { headers: { "content-type": "application/json", "cache-control": "no-store" } },
  );
};
