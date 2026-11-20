// Nexy Cloud's GPU credits: the balance in the sidebar, Top up (only while Buy works: the gate says so), the
// plan in Settings, and the free lane's daily limit. Nothing here outside Nexy Cloud.
import { inCloud } from "./place";

export interface Credits {
  available: boolean;
  balance?: number;
  buy: boolean;
  top_up?: { credits: number; usd: number };
  free?: { used: number; cap: number };
}

// the daily limit's refusal: shown as it is, never retried
export class FreeCapError extends Error {
  constructor(message: string, readonly topUp: boolean) { super(message); }
}

let last: Credits | null = null;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const n = (x: number) => x.toLocaleString("en-US");

export async function loadCredits(): Promise<Credits | null> {
  if (!inCloud) return null;
  try {
    const r = await fetch("/api/credits", { cache: "no-store" });
    last = r.ok ? await r.json() as Credits : null;
  } catch (e) {
    console.warn("[nexy] GPU credits unavailable", e);
    last = null;
  }
  renderChip();
  return last;
}

export const canBuy = (): boolean => !!last?.available && last.buy;

function chipText(c: Credits): string {
  if (c.balance) return `${n(c.balance)} GPU credits`;
  if (c.free?.cap) return `Free · ${n(Math.max(0, c.free.cap - c.free.used))} of ${n(c.free.cap)} left today`;
  return "Free plan";
}

function renderChip(): void {
  const wrap = document.querySelector(".userwrap");
  let el = document.getElementById("credits");
  if (!last?.available || !wrap) { el?.remove(); return; }
  if (!el) {
    el = document.createElement("div");
    el.id = "credits";
    el.className = "credits";
    wrap.before(el);
  }
  el.innerHTML = `<span class="cr-n" data-credits-balance>${esc(chipText(last))}</span>` +
    (canBuy() ? `<button type="button" class="btn small" data-topup>Top up</button>` : "");
  el.querySelector("[data-topup]")?.addEventListener("click", openTopUp);
}

// the purchase page in an overlay; it tells Nexy the new balance when the payment lands
export function openTopUp(): void {
  if (!canBuy()) return;
  let ov = document.getElementById("ovTopUp");
  if (!ov) {
    ov = document.createElement("div");
    ov.className = "ov";
    ov.id = "ovTopUp";
    ov.innerHTML = `<div class="modal topup"><div class="mh">Top up GPU credits<button class="x" type="button" data-close aria-label="Close">×</button></div><iframe title="Top up GPU credits" src="/_auth/top-up"></iframe></div>`;
    document.body.append(ov);
    const close = () => { ov!.classList.remove("open"); ov!.querySelector("iframe")!.src = "about:blank"; void loadCredits(); };
    ov.querySelector("[data-close]")!.addEventListener("click", close);
    ov.addEventListener("click", (e) => { if (e.target === ov) close(); });
  } else {
    ov.querySelector("iframe")!.src = "/_auth/top-up";
  }
  ov.classList.add("open");
}

window.addEventListener("message", (e) => {
  if (e.origin === location.origin && (e.data as { type?: string })?.type === "nexy-credits") void loadCredits();
});

// Settings, Nexy Cloud: the plan, the balance, Top up and the account page
export async function planRows(row: (l: string, c: string | null, sub?: string) => string): Promise<string> {
  const c = await loadCredits();
  if (!c?.available) return row("Plan", `<span class="faint">Free</span>`, "GPU credits aren't available right now");
  const free = c.free?.cap ? `${n(c.free.cap)} messages a day on Nexy Cloud's own computers, best effort` : "Nexy Cloud's own computers, best effort";
  return row("Plan", `<span class="faint">${c.balance ? "GPU credits" : "Free"}</span>`, c.balance ? "Your messages are answered on fast GPU clouds while you have credits" : free) +
    row("GPU credits", canBuy() ? `<button type="button" class="btn small" data-topup>Top up</button>` : `<span class="faint">${n(c.balance ?? 0)}</span>`,
      `${n(c.balance ?? 0)} credits. 1 credit is about 1,000 tokens${c.top_up ? `; ${n(c.top_up.credits)} for $${c.top_up.usd}, never expire` : ""}`) +
    (c.free?.cap ? row("Free messages today", `<span class="faint">${n(Math.min(c.free.used, c.free.cap))} of ${n(c.free.cap)}</span>`, "Used when you have no credits; they come back at midnight UTC") : "") +
    row("Account", `<a class="btn small" href="/_auth/account">Manage account</a>`, "Passkeys, your Nexy apps and a linked wallet");
}

// the free limit's refusal in a chat: its words, and Top up when Buy works
export function freeCapNote(e: FreeCapError): string {
  return `<div class="feednote" data-free-cap="1">${esc(e.message)}${e.topUp && canBuy() ? ` <button type="button" class="btn small" data-topup>Top up</button>` : ""}</div>`;
}

export function initCredits(): void {
  if (!inCloud) return;
  void loadCredits();
  document.addEventListener("click", (e) => {
    const b = (e.target as HTMLElement).closest?.("[data-topup]");
    if (b && !b.closest("#credits")) openTopUp();
  });
}
