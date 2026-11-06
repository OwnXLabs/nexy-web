import { visibleChat } from "./chat-scope";
import { wasEdited } from "./edit-loop";

export interface Deployable { chat: string; output: string; title: string; kind: string }
interface Hooks { current: () => Deployable | null; isPrivate: () => boolean; save: () => Promise<void> }
interface Publication { name: string; url: string; expiresAt?: number }
// the last address used for an output, so republishing after expiry keeps its link
const nameKey = (t: Deployable) => `nexy.publish.name.${t.chat}.${t.output}`;
const lastName = (t: Deployable) => { try { return localStorage.getItem(nameKey(t)) ?? ""; } catch { return ""; } };
const keepName = (t: Deployable, name: string) => { try { localStorage.setItem(nameKey(t), name); } catch { /* storage off: the field just starts empty */ } };
const until = (ms?: number) => ms ? ` It is removed at ${new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}.` : "";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
let hooks: Hooks;
let generation = 0;

async function call(target: Deployable, action?: string, name?: string) {
  const query = new URLSearchParams({ chat: target.chat, output: target.output });
  const response = await fetch(`/api/v1/publish${action ? "" : `?${query}`}`, action ? {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat: target.chat, output: target.output, action, name }),
  } : {});
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Publishing could not be completed.");
  return data as { enabled: boolean; servesBuild?: boolean; publications: Publication[] };
}

export function cancelPublishing(): void { ++generation; }

// Mount into Share's Publishing section. There is no separate deployment modal.
export function mountPublishing(body: HTMLElement): void {
  const candidate = hooks.current();
  if (!candidate || hooks.isPrivate()) return;
  const target: Deployable = candidate;
  const token = ++generation;
  const active = () => generation === token && visibleChat() === target.chat && body.isConnected;
  body.innerHTML = `<p role="status">Checking publishing status…</p>`;
  if (!["html", "game"].includes(target.kind) || !/^build:[A-Za-z0-9_-]+$/.test(target.output)) {
    body.innerHTML = `<p>This output is not a saved website build. Select a generated website or game to publish it.</p>`;
    return;
  }
  function render(data: { enabled: boolean; servesBuild?: boolean; publications: Publication[] }, error = "", previousName = lastName(target)) {
    if (!active()) return;
    const pubs = data.publications ?? [];
    if (pubs[0]?.name) keepName(target, pubs[0].name);
    body.innerHTML = (!data.enabled ? `<p>Website publishing is not configured on this Nexy instance.</p>` :
      `<div class="srow"><div><b>${pubs.length ? "Public" : "Not published"}</b><div class="ss">${pubs.length ? `Anyone with a link can open this website.${until(pubs[0].expiresAt)} To publish later edits, unpublish and publish again.` : "Publishing makes this website publicly accessible."}</div></div><button type="button" class="btn small${pubs.length ? "" : " primary"}" id="deployToggle" role="switch" aria-checked="${pubs.length > 0}" aria-label="Public website">${pubs.length ? "Unpublish" : "Publish website"}</button></div>` +
      (pubs.length ? pubs.map((p) => `<p><a style="color:inherit;overflow-wrap:anywhere" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.url)}</a></p>`).join("") :
        `<label class="sl" for="deployName">Website address name (optional)</label><input id="deployName" class="inp" style="width:100%;box-sizing:border-box;margin-top:8px" maxlength="41" placeholder="my-website" value="${esc(previousName)}"><p class="faint">Use 2–41 letters, numbers or hyphens. Leave blank for an automatic address.</p>`)) +
      // the demo publishes what Own Build made, never the browser's copy (hardening, 2026-10-19)
      (data.enabled && data.servesBuild && wasEdited(target.output) ? `<p class="faint">On this demo, publishing uses the website as Own Build made it. The changes you made here are not included.</p>` : "") +
      `<p role="alert" style="color:var(--red,#ff8888)">${esc(error)}</p>`;
    body.querySelector<HTMLButtonElement>("#deployToggle")?.addEventListener("click", async () => {
      if (!active() || hooks.isPrivate()) return;
      const name = body.querySelector<HTMLInputElement>("#deployName")?.value ?? "";
      if (!pubs.length && name && !/^[a-z0-9][a-z0-9-]{1,40}$/.test(name.trim().toLowerCase())) {
        render(data, "Use 2–41 letters, numbers or hyphens.", name); return;
      }
      const button = body.querySelector<HTMLButtonElement>("#deployToggle")!;
      button.disabled = true; button.textContent = pubs.length ? "Unpublishing…" : "Publishing…";
      try { render(await call(target, pubs.length ? "unpublish" : "publish", name)); }
      catch (e) {
        // Refresh after an ambiguous network failure: a public write may have
        // succeeded even when its response was lost.
        try { render(await call(target), (e as Error).message, name); }
        catch { render(data, (e as Error).message, name); }
      }
    });
  }
  void hooks.save().then(() => call(target)).then((data) => render(data), (e: Error) => {
    if (active()) body.innerHTML = `<p role="alert">${esc(e.message)}</p><button class="btn small" type="button" id="deployRetry">Retry</button>`;
    body.querySelector("#deployRetry")?.addEventListener("click", () => mountPublishing(body));
  });
}

export function initPublishing(h: Hooks): void {
  hooks = h;
}
