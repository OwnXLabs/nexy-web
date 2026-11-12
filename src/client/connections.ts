import type { Artifact } from "./canvas";
import { errText } from "./http";
import { loadCatalog } from "./perm";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const LOCAL = ["Qiki", "Own Image Studio", "Own Beat Studio", "Own Voice Studio", "Own Docs", "Own Startup"];

const row = (led: string, name: string, note: string, act = "") =>
  `<div class="crow2"><span class="led${led}"></span><b>${esc(name)}</b><span class="faint">${esc(note)}</span>${act}</div>`;

export function connectionsArtifact(connect: (name: string) => void): Artifact {
  return {
    id: "connections",
    kind: "doc",
    title: "Connections",
    meta: "What Nexy can reach · on device",
    render: (host) => {
      host.innerHTML = `<div class="cm"><h3>Everything Nexy can reach</h3><p class="sp">Local apps stay on this machine; outside apps are the only things that can carry data out, and only within their scope.</p><div class="faint">Checking…</div></div>`;
      void fill(host, connect);
    },
  };
}

async function fill(host: HTMLElement, connect: (name: string) => void): Promise<void> {
  const cm = host.querySelector(".cm");
  if (!cm) return;
  let down = new Set<string>();
  let feedNote = "";
  try {
    const r = await fetch("/api/v1/feed?limit=1");
    const d = (await r.json()) as { silent?: { label: string }[]; degraded?: { label: string }[] };
    down = new Set([...(d.silent ?? []), ...(d.degraded ?? [])].map((x) => x.label));
  } catch (e) {
    feedNote = `<p class="faint">Could not check the apps: ${esc(errText(e))}</p>`;
  }
  let outside = "";
  try {
    const cat = await loadCatalog();
    outside = cat.length
      ? cat.map((c) => {
        const on = !!c.auth?.credentialStored;
        return row(on ? " ok" : " off", c.label, on ? `${(c.auth?.grantedScopes ?? c.scopes ?? []).join(", ") || "as granted"}` : "not connected",
          on ? "" : `<button class="btn small" type="button" data-conn="${esc(c.label)}">Connect</button>`);
      }).join("")
      : row(" off", "Catalogue", "empty");
  } catch (e) {
    outside = row(" warn", "Catalogue", `not answering: ${errText(e)}`);
  }
  cm.innerHTML =
    `<h3>Everything Nexy can reach</h3><p class="sp">Local apps stay on this machine; outside apps are the only things that can carry data out, and only within their scope.</p>` +
    feedNote +
    `<h4>Local apps</h4>` + LOCAL.map((a) => row(down.has(a) ? " warn" : "", a, down.has(a) ? "not answering" : "read, on device")).join("") +
    row(" off", "Desktop", "no control over windows yet") +
    `<h4>Outside apps</h4>` + outside +
    `<h4>APIs and models</h4>` +
    row(" off", "Hosted frontier APIs", "none configured") +
    row(" off", "Cloud GPU boost", "available on this box; Nexy does not use it") +
    row(" off", "OwnXCloud", "not connected") +
    row("", "Local models", "resident on this machine");
  cm.querySelectorAll<HTMLElement>("[data-conn]").forEach((b) => b.addEventListener("click", () => connect(b.dataset.conn!)));
}
