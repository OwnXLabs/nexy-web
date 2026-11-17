const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export const IC = {
  pen: `<svg class="i" viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>`,
  trash: `<svg class="i" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>`,
  plus: `<svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>`,
  flag: `<svg class="i" viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>`,
  move: `<svg class="i" viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`,
};
export const DOTS = `<span class="dots" title="Options"><svg class="i" viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg></span>`;

export interface MenuItem { label: string; icon: string; danger?: boolean; run: () => void }

let menu: HTMLElement | null = null;
function ctx(): HTMLElement {
  if (menu) return menu;
  menu = document.createElement("div");
  menu.className = "ctx";
  menu.id = "ctx";
  document.body.appendChild(menu);
  addEventListener("click", () => menu?.classList.remove("open"));
  addEventListener("keydown", (e) => { if (e.key === "Escape") menu?.classList.remove("open"); });
  return menu;
}

export function openCtx(items: MenuItem[], x: number, y: number): void {
  const m = ctx();
  m.innerHTML = items.map((i, k) => `<button type="button" class="ci2${i.danger ? " danger" : ""}" data-k="${k}">${i.icon}<span>${esc(i.label)}</span></button>`).join("");
  m.classList.add("open");
  m.style.left = `${Math.min(x, innerWidth - 188)}px`;
  m.style.top = `${Math.min(y, innerHeight - items.length * 34 - 16)}px`;
  m.querySelectorAll<HTMLElement>(".ci2").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    m.classList.remove("open");
    items[Number(b.dataset.k)].run();
  }));
}

export function confirmDel(title: string, body: string, yes: () => void): void {
  let ov = document.getElementById("ovConfirm");
  if (!ov) {
    ov = document.createElement("div");
    ov.className = "ov";
    ov.id = "ovConfirm";
    ov.innerHTML = `<div class="modal" style="width:420px"><div class="mh" id="cfTitle"></div><div class="mb" id="cfBody"></div><div class="mf"><button class="btn" type="button" id="cfNo">Cancel</button><button class="btn danger" type="button" id="cfYes">Delete</button></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => { if (e.target === ov) ov!.classList.remove("open"); });
  }
  const o = ov;
  o.querySelector("#cfTitle")!.textContent = title;
  o.querySelector("#cfBody")!.innerHTML = body;
  o.classList.add("open");
  o.querySelector<HTMLButtonElement>("#cfYes")!.onclick = () => { o.classList.remove("open"); yes(); };
  o.querySelector<HTMLButtonElement>("#cfNo")!.onclick = () => o.classList.remove("open");
}

export function inlineRename(node: HTMLElement, value: string, done: (v: string | null) => void): void {
  const inp = document.createElement("input");
  inp.className = "rename";
  inp.value = value;
  node.replaceChildren(inp);
  inp.focus();
  inp.select();
  let fin = false;
  const finish = (ok: boolean) => {
    if (fin) return;
    fin = true;
    const v = inp.value.trim();
    done(ok && v && v !== value ? v : null);
  };
  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") finish(true); if (e.key === "Escape") finish(false); e.stopPropagation(); });
  inp.addEventListener("blur", () => finish(true));
  inp.addEventListener("click", (e) => e.stopPropagation());
}

