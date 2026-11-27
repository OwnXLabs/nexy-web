// Nexy Cloud usage: today's free messages and GPU credits (the gate's /_auth/me), shown under the composer
// and at the moments that matter: few free messages left, the free limit, the free queue, credits running low.
// Buying is not open yet, so its buttons are shown greyed out with "Coming soon" (purchases false).
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

type Free = { used: number; cap: number; reset_at: number };
type Credits = { balance: number; welcome: number; fast: boolean; purchases: boolean };
// credits for answers from the home network (the gate's home_credits): spent from the first message where `first`,
// otherwise once the day's free messages are used
type Home = { balance: number; first: boolean };
export type Usage = { free?: Free; credits?: Credits; home?: Home };

export const PLANS = "/_auth/plans";
export const USAGE = "/_auth/usage";
const WARN_FREE = 5;   // free messages left: a word about it, once a day
const LOW_FREE = 10;   // the pill turns amber
const LOW_CREDITS = 30;
const onCloud = () => document.documentElement.dataset.place === "cloud";
const store = {
  get: (k: string) => { try { return localStorage.getItem(`nexy.usage.${k}`); } catch (e) { console.warn("[nexy] usage note not read", e); return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(`nexy.usage.${k}`, v); } catch (e) { console.warn("[nexy] usage note not kept", e); } },
};

let now: Usage | null = null;
// GPU credits a fast-lane message has cost on this device (the last few), for "about N messages left"
const costs: number[] = (store.get("costs") ?? "").split(",").map(Number).filter((n) => n > 0).slice(-8);

const perMessage = () => costs.length ? Math.max(1, Math.round(costs.reduce((a, b) => a + b, 0) / costs.length)) : 0;
// the next message goes to the fast lane: GPU credits, and (once a message has cost some) enough for one more
const fastNow = (u: Usage | null) => !!u?.credits?.fast && (u.credits.balance ?? 0) > 0 && u.credits.balance >= perMessage();
const freeLeft = (u: Usage | null) => u?.free ? Math.max(0, u.free.cap - u.free.used) : undefined;
const resetsAt = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const resetsIn = (ms: number) => {
  const m = Math.max(1, Math.round((ms - Date.now()) / 60_000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};
// what buying will look like: greyed out until checkout opens
const buyButtons = (purchases: boolean) => purchases
  ? `<a class="btn small primary" href="${PLANS}">Get GPU credits</a>`
  : `<button type="button" class="btn small" disabled title="Coming soon">Monthly · $15</button><button type="button" class="btn small" disabled title="Coming soon">GPU credits · from $5</button><span class="usoon">Coming soon</span>`;

export async function readUsage(): Promise<Usage | null> {
  if (!onCloud()) return null;
  try {
    const r = await fetch("/_auth/me", { cache: "no-store", credentials: "same-origin" });
    if (!r.ok) return now;
    const j = await r.json() as Usage;
    const n = (x: unknown) => Math.max(0, Math.floor(Number(x) || 0));
    const hb = Number((j as { home_credits?: { balance?: unknown } }).home_credits?.balance) || 0;
    now = {
      home: hb > 0 ? { balance: hb, first: (j as { home_credits?: { first?: unknown } }).home_credits?.first === true } : undefined,
      free: j.free ? { used: n(j.free.used), cap: n(j.free.cap), reset_at: n(j.free.reset_at) } : undefined,
      credits: j.credits ? { balance: n(j.credits.balance), welcome: n(j.credits.welcome), fast: j.credits.fast === true, purchases: j.credits.purchases === true } : undefined,
    };
    renderPill();
    return now;
  } catch (e) {
    console.warn("[nexy] usage not read", e);
    return now;
  }
}

// the line under the composer: which lane the next message goes to, and what is left
function renderPill(): void {
  const comp = document.querySelector<HTMLElement>(".composer");
  if (!comp || !now || (!now.free && !now.credits && !now.home)) return;
  let el = comp.querySelector<HTMLElement>("#usage");
  if (!el) {
    el = document.createElement("div"); el.id = "usage"; el.className = "usage";
    comp.append(el);
  }
  const c = now.credits, left = freeLeft(now), h = now.home;
  // two places, never more: a balance is cut, not rounded up
  const some = (b: number) => (Math.floor(b * 100) / 100).toFixed(2);
  let text: string, tone = "", paying = fastNow(now);
  if (fastNow(now)) {
    const n = perMessage(), about = n ? ` · about ${Math.floor(c!.balance / n)} fast messages` : "";
    text = `<b>Fast lane</b> · ${c!.balance} GPU credits${about}`;
    if (c!.balance <= LOW_CREDITS) tone = "low";
  } else if (h && (h.first || left === 0 || left === undefined)) {
    // the next message is paid from this account's credits
    text = `<b>Credits</b> · ${some(h.balance)} left`; paying = true;
  } else if (left !== undefined) {
    if (left === 0) { text = `<b>No free messages left today</b> · resets in ${resetsIn(now.free!.reset_at)}`; tone = "out"; }
    else { text = `<b>Free tier</b> · ${left} of ${now.free!.cap} messages left today${h ? ` · then ${some(h.balance)} credits` : ""}`; if (left <= LOW_FREE && !h) tone = "low"; }
  } else return;
  el.dataset.tone = tone;
  el.innerHTML = `<span class="ut">${text}</span><a class="ulink" href="${paying ? USAGE : PLANS}">${paying ? "Usage" : "Skip the queue"} &rarr;</a>`;
}

// One-time welcome: the credits that came with the account, and what they do
export function welcomeNote(): string | null {
  const c = now?.credits;
  if (!c || !c.fast || !c.welcome || c.balance <= 0 || store.get("welcomed")) return null;
  store.set("welcomed", "1");
  return `<div class="feednote unote" data-usage="welcome"><b>You have ${c.balance} welcome GPU credits.</b> Your messages go to the fast lane, with no queue, until they're used up. Then you're on the free tier: ${now?.free?.cap ?? 50} messages a day. <a href="${PLANS}">See plans</a></div>`;
}

// After a reply: what it cost, and a word when credits or free messages are running out
export async function afterTurn(holder: HTMLElement, before: Usage | null): Promise<void> {
  const wasFast = fastNow(before);
  const after = await readUsage();
  if (!after || !before) return;
  const b = before.credits?.balance ?? 0, a = after.credits?.balance ?? 0;
  const bub = holder.querySelector(".bub");
  if (b > a) {
    costs.push(b - a); while (costs.length > 8) costs.shift();
    store.set("costs", costs.join(","));
    const line = holder.querySelector<HTMLElement>("[data-answered-on]");
    const said = `Fast lane, no queue · ${b - a} GPU credits`;
    if (line) line.textContent = said;
    else bub?.insertAdjacentHTML("afterend", `<div class="faint" data-answered-on style="font-size:12px;margin:4px 0 0">${esc(said)}</div>`);
    renderPill();
  }
  // under the reply (and its answered-on line), not in it: the reply is still being typed out
  const say = (html: string, kind: string) => (holder.querySelector("[data-answered-on]") ?? bub)?.insertAdjacentHTML("afterend", `<div class="feednote unote" data-usage="${kind}">${html}</div>`);
  const n = perMessage();
  if (wasFast && !fastNow(after)) {
    // the fast lane is over: back on the free tier
    say(`<b>Your GPU credits are used up.</b> From here you're on the free tier: ${after.free ? `${freeLeft(after)} of ${after.free.cap} messages left today, ` : ""}in the queue at busy times.<div class="uacts"><a class="btn small" href="${PLANS}">See plans</a>${buyButtons(!!after.credits?.purchases)}</div>`, "credits-out");
  } else if (fastNow(after) && b > LOW_CREDITS && a <= LOW_CREDITS) {
    say(`<b>${a} GPU credits left</b>${n ? `, about ${Math.floor(a / n)} fast messages` : ""}. After that you're on the free tier's queue.<div class="uacts"><a class="btn small" href="${PLANS}">See plans</a>${buyButtons(!!after.credits?.purchases)}</div>`, "credits-low");
  }
  const left = freeLeft(after), day = new Date().toISOString().slice(0, 10);
  if (!fastNow(after) && left !== undefined && left > 0 && left <= WARN_FREE && store.get("warned") !== day) {
    store.set("warned", day);
    say(`<b>${left} free message${left === 1 ? "" : "s"} left today.</b> They reset at ${resetsAt(after.free!.reset_at)}. Monthly has no daily limit and no queue.<div class="uacts"><a class="btn small" href="${PLANS}">See plans</a>${buyButtons(!!after.credits?.purchases)}</div>`, "free-low");
  }
}

// The free limit, in place of the reply: when it resets, counted down, and what to do meanwhile
export function capCard(resetAt: number, fallback: string, purchases = false): string {
  readUsage().catch((e) => console.warn("[nexy] usage not read", e));
  const cap = now?.free?.cap;
  const when = resetAt > Date.now()
    ? `They reset at ${esc(resetsAt(resetAt))}, in <span data-reset-in="${resetAt}">${esc(resetsIn(resetAt))}</span>.`
    : esc(fallback);
  return `<div class="feednote ucap" data-free-cap="1"><b>You've used today's ${cap ? `${cap} ` : ""}free messages.</b><p>${when}</p>`
    + `<div class="uacts"><a class="btn small" href="${PLANS}">See plans</a>${buyButtons(purchases || !!now?.credits?.purchases)}</div>`
    + `<p class="faint">Monthly: no daily limit and no queue. GPU credits: pay as you go, only for fast-lane messages.</p></div>`;
}

// While a free-tier reply waits its turn: the way past the queue
export function queueSkip(holder: HTMLElement): void {
  if (fastNow(now) || holder.querySelector("[data-usage=queue]")) return;
  holder.querySelector(".bub")?.insertAdjacentHTML("afterend",
    `<div class="faint" data-usage="queue" style="font-size:12px;margin:4px 0 0">Paid plans skip the free queue. <a href="${PLANS}">See plans</a><br>The free tier runs on computers people share. More of them means a shorter wait. <a href="/about#network" target="_blank" rel="noopener">How sharing works</a></div>`);
}
export const unqueueSkip = (holder: HTMLElement) => holder.querySelector("[data-usage=queue]")?.remove();

export const usageNow = () => now;

setInterval(() => {
  document.querySelectorAll<HTMLElement>("[data-reset-in]").forEach((el) => { el.textContent = resetsIn(Number(el.dataset.resetIn)); });
  if (now && freeLeft(now) === 0) renderPill();
}, 30_000);
