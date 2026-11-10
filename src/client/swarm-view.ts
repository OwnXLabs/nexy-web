// A website built across the owner's devices: live progress per piece, then the page itself.
// Returns false when this Own 1 can't build across devices, so the caller uses the normal builder.

type Task = { id: string; kind: string; label: string; on?: string; state: string; ms?: number; error?: string };

const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

export function where(on?: string, names: Record<string, string> = {}): string {
  if (!on || on === "box" || on === "auto") return "your Own 1";
  const dev = on.replace(/^device:/, "");
  const name = names[dev] ?? (/^Nexy on /.test(dev) ? dev.slice(8) : dev.startsWith("0x") ? `device ${dev.slice(0, 6)}…` : dev);
  return name.replace(/^Nexy on /, "");
}

export function row(t: Task, names: Record<string, string> = {}): string {
  const st = t.state === "done" ? `done${t.ms ? ` · ${Math.round(t.ms / 1000)} s` : ""}` : t.state === "failed" ? "didn't finish" : t.state;
  return `<li data-state="${esc(t.state)}"><span class="sw-dot"></span><span class="sw-what">${esc(t.label)}</span><span class="sw-on">${esc(where(t.on, names))}</span><span class="sw-st">${esc(st)}</span></li>`;
}

export async function playSwarm(brief: string, pushBlock: (el: HTMLElement) => HTMLElement): Promise<boolean> {
  const r = await fetch("/api/v1/swarm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: brief }) }).catch(() => null);
  if (!r || r.status === 404 || r.status === 401) return false;
  const j = await r.json().catch(() => ({}));
  const box = document.createElement("div");
  box.className = "swarm";
  box.innerHTML = `<p class="sw-head">Building it across your devices</p><ul class="sw-list" aria-live="polite"></ul><p class="sw-foot"></p>`;
  pushBlock(box);
  const list = box.querySelector(".sw-list")!, foot = box.querySelector(".sw-foot")!;
  if (!r.ok || !j.id) { foot.textContent = j.error ?? "It couldn't start this time."; return true; }
  const tasks = new Map<string, Task>();
  const draw = () => { list.innerHTML = [...tasks.values()].map(t => row(t)).join(""); };
  await new Promise<void>(resolve => {
    let tries = 0;
    const open = () => {
      const es = new EventSource(`/api/v1/swarm?id=${encodeURIComponent(j.id)}`);
      es.onmessage = (m) => {
        let e: any; try { e = JSON.parse(m.data); } catch { return; }
        if (e.type === "task") { tasks.set(e.task.id, e.task); draw(); }
        else if (e.type === "plan") foot.textContent = `${e.plan.sections.length} sections and ${e.plan.images.length} images, in parallel.`;
        else if (e.type === "failed") { foot.textContent = `It stopped: ${e.error}`; es.close(); resolve(); }
        else if (e.type === "done") {
          es.close();
          const devices = new Set([...tasks.values()].filter(t => t.state === "done").map(t => where(t.on)));
          foot.textContent = `Made on ${[...devices].join(", ")}.`;
          const f = document.createElement("iframe");
          f.className = "sw-page";
          f.setAttribute("sandbox", ""); // the page is model-written: no scripts, no same-origin access
          f.title = "The finished site";
          f.src = `/api/v1/swarm?id=${encodeURIComponent(j.id)}&page=1`;
          box.appendChild(f);
          resolve();
        }
      };
      // a dropped stream picks up again: the server replays what happened so far
      es.onerror = () => { es.close(); if (++tries > 20) { foot.textContent = "Lost touch with your Own 1."; resolve(); } else setTimeout(open, Math.min(1000 * tries, 8000)); };
    };
    open();
  });
  return true;
}
