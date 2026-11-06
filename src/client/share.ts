import { mountPublishing, cancelPublishing } from "./publish";
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const ICON = `<svg class="i" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.6l6.8-4M8.6 13.4l6.8 4"/></svg>`;
const LOCK = `<svg class="i" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>`;

export interface Shareable { title: string; kind: string; project: string; text?: () => string; download?: () => void }

interface ShareHooks { current: () => Shareable | null; isPrivate: () => boolean; toast: (t: string) => void }
let H: ShareHooks;
let mode: "public" | "private" = "public";
function closeShare(): void { cancelPublishing(); document.getElementById("ovShare")?.classList.remove("open"); }

function modal(): HTMLElement {
  let ov = document.getElementById("ovShare");
  if (ov) return ov;
  ov = document.createElement("div");
  ov.className = "ov";
  ov.id = "ovShare";
  ov.innerHTML = `<div class="modal share" role="dialog" aria-modal="true" aria-label="Share"><div class="mh">Share<button class="x" type="button" data-close aria-label="Close Share">×</button></div><div class="mb" id="shareBody"></div></div>`;
  document.body.appendChild(ov);
  const o = ov;
  o.querySelector("[data-close]")?.addEventListener("click", closeShare);
  o.addEventListener("click", (e) => { if (e.target === o) closeShare(); });
  return o;
}

function render(s: Shareable): void {
  cancelPublishing();
  const ov = modal();
  const body = ov.querySelector<HTMLElement>("#shareBody");
  if (!body) return;
  const type = { html: "website", game: "game", image: "image", audio: "audio", doc: "document", table: "sheet", diagram: "diagram", plan: "project plan" }[s.kind] ?? "file";
  body.innerHTML =
    `<div class="sharetop"><div class="sharemark">${ICON}</div><div class="sharehead"><b>${esc(s.title)}</b><span class="faint">${esc(type)} · ${esc(s.project)}</span></div></div><div class="shareinner">` +
    `<h4 style="margin-top:0">Choose access</h4><div class="sharetypes">` +
    `<div class="sharetype${mode === "public" ? " sel" : ""}" data-mode="public"><span class="radio"></span><div><b>Public link</b><small>Anyone with the link can view it.</small></div></div>` +
    `<div class="sharetype${mode === "private" ? " sel" : ""}" data-mode="private"><span class="radio"></span><div><b>Private link</b><small>Private sharing links are not available yet.</small></div></div></div>` +
    `<div class="shareprivacy">${LOCK} Only this ${esc(type)} would be shared. Your chats, memory, project files and machine stay private.</div>` +
    `<h4>Publishing</h4><div id="deployBody">${mode === "private" ? "Private links are not available yet. You can download this output and share it yourself." : ""}</div>` +
    `<div class="sharefoot"><span class="safe">${LOCK} Your conversation stays private</span><div class="sbtns">` +
    (s.text ? `<button class="btn small" type="button" data-sh="copy">Copy</button>` : "") +
    (s.download ? `<button class="btn small" type="button" data-sh="download">Download</button>` : "") +
    `</div></div></div>`;
  if (mode === "public") mountPublishing(body.querySelector<HTMLElement>("#deployBody")!);
  body.querySelectorAll<HTMLElement>("[data-mode]").forEach((o) => o.addEventListener("click", () => { mode = o.dataset.mode as typeof mode; render(s); }));
  body.querySelector('[data-sh="copy"]')?.addEventListener("click", () => {
    navigator.clipboard.writeText(s.text!()).then(() => H.toast("Copied"), (e: Error) => H.toast(`Could not copy: ${e.message}`));
  });
  body.querySelector('[data-sh="download"]')?.addEventListener("click", () => { s.download!(); closeShare(); });
}

export function openShare(s: Shareable | null): void {
  if (!s) { H.toast("Open something first"); return; }
  if (H.isPrivate()) { H.toast("Sharing is off in an ultra-private chat"); return; }
  modal().classList.add("open");
  mode = "public";
  render(s);
}

export function initShare(hooks: ShareHooks): void {
  H = hooks;
  const close = document.getElementById("cvClose");
  if (!close || document.getElementById("cvShare")) return;
  const b = document.createElement("button");
  b.className = "btn small ghost";
  b.id = "cvShare";
  b.title = "Share";
  b.innerHTML = `${ICON}<span class="txt">Share</span>`;
  close.parentNode?.insertBefore(b, close);
  b.addEventListener("click", () => openShare(H.current()));
  for (const event of ["nexy:chat-selected", "nexy:canvas-selected", "nexy:private"]) window.addEventListener(event, closeShare);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("ovShare")?.classList.contains("open")) {
      e.preventDefault(); e.stopPropagation(); closeShare();
    }
  }, true);
}
