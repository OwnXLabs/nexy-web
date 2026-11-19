import { IC, openCtx, type MenuItem } from "./menus";
import { engineLabel, loadEngines, manyEngines, otherEngines, pickedEngine } from "./engines";
import { continueOn, openChat, useEngine } from "./shell";
import { isPrivate } from "./private";
import { errText } from "./http";

// A chat's engine, shown where there is a choice of engines, and the one way a chat moves to
// another engine: Continue, which asks before anything is shared. Ultra-private chats never move.
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector<T>(s);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
let toast: (t: string) => void = () => {};

// the engine the open chat talks to: its own, or for an older chat the current pick
const openEngine = (): string | undefined => openChat()?.engine ?? pickedEngine();

export function renderEngineChip(): void {
  const chip = $<HTMLButtonElement>("#hdrEngine");
  if (!chip) return;
  const c = openChat();
  const show = manyEngines() && !isPrivate() && !!c && !c.example;
  chip.hidden = !show;
  if (!show) return;
  const label = engineLabel(openEngine());
  chip.textContent = label;
  chip.title = c!.started ? `This chat is with ${label}` : `New chats start with ${label}`;
}

// what the chat's menu offers: Continue on each other engine; before a chat has started, its engine is simply chosen
export function engineItems(): MenuItem[] {
  const c = openChat();
  if (!manyEngines() || isPrivate() || !c || c.example) return [];
  return otherEngines(openEngine()).map((e) => c.started
    ? { label: `Continue with ${e.label}…`, icon: IC.move, run: () => askContinue(e.id) }
    : { label: `Use ${e.label} for this chat`, icon: IC.move, run: () => useEngine(e.id) });
}

function sheet(): HTMLElement {
  let ov = document.getElementById("ovContinue");
  if (ov) return ov;
  ov = document.createElement("div");
  ov.className = "ov";
  ov.id = "ovContinue";
  ov.innerHTML = `<div class="modal" style="width:440px" role="dialog" aria-modal="true" aria-labelledby="ctTitle"><div class="mh" id="ctTitle"></div><div class="mb" id="ctBody"></div>` +
    `<div class="mf"><button class="btn" type="button" id="ctNo">Cancel</button><button class="btn" type="button" id="ctFresh">Start fresh</button><button class="btn primary" type="button" id="ctShare">Share</button></div></div>`;
  document.body.appendChild(ov);
  ov.addEventListener("click", (e) => { if (e.target === ov) ov!.classList.remove("open"); });
  return ov;
}

export function askContinue(engine: string): void {
  if (isPrivate()) return;
  const o = sheet(), name = engineLabel(engine);
  o.querySelector("#ctTitle")!.textContent = `Continue with ${name}`;
  o.querySelector("#ctBody")!.innerHTML = `Share this conversation with ${esc(name)}? It keeps its own copy and memory, which Nexy can't delete.` +
    `<div class="faint" style="margin-top:8px">This chat stays with ${esc(engineLabel(openEngine()))}. Start fresh opens an empty chat with ${esc(name)} instead.</div>`;
  o.classList.add("open");
  const go = (share: boolean) => {
    o.classList.remove("open");
    continueOn(engine, share).catch((e: Error) => toast(`This chat couldn't be continued: ${errText(e)}`));
  };
  o.querySelector<HTMLButtonElement>("#ctShare")!.onclick = () => go(true);
  o.querySelector<HTMLButtonElement>("#ctFresh")!.onclick = () => go(false);
  o.querySelector<HTMLButtonElement>("#ctNo")!.onclick = () => o.classList.remove("open");
}

export function initEngineChat(say: (t: string) => void): void {
  toast = say;
  const chip = $<HTMLButtonElement>("#hdrEngine");
  chip?.addEventListener("click", (e) => {
    e.stopPropagation();
    const items = engineItems();
    if (!items.length) return;
    const r = chip.getBoundingClientRect();
    openCtx(items, r.right - 188, r.bottom + 4);
  });
  for (const ev of ["nexy:engines", "nexy:chat-selected", "nexy:private"]) addEventListener(ev, renderEngineChip);
  void loadEngines();
}

// the meta line under an answer names the engine that wrote it, where there is a choice
export function labelReply(msg: HTMLElement, engine: string | undefined): void {
  const acts = msg.querySelector<HTMLElement>(".macts");
  if (!acts || !engine || !manyEngines() || acts.querySelector("[data-engine]")) return;
  acts.insertAdjacentHTML("afterbegin", `<span class="faint" data-engine="${esc(engine)}">${esc(engineLabel(engine))}</span>`);
}

// where the model network ran it, said under the answer: nothing when this machine's model did
const ANSWERED_ON: Record<string, string> = { boost: "Answered with cloud boost.", own1: "Answered on John's Own 1." };
export function answeredOn(msg: HTMLElement, on: string | undefined): void {
  const said = on ? ANSWERED_ON[on] : undefined;
  if (!said || msg.querySelector("[data-answered-on]")) return;
  msg.querySelector(".bub")?.insertAdjacentHTML("afterend", `<div class="faint" data-answered-on style="font-size:12px;margin:4px 0 0">${said}</div>`);
}
