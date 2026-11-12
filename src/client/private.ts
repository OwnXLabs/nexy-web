import { connectorAsk } from "../lib/connector-ask.ts";

export type SensitiveKind = "tax" | "medical" | "financial" | "legal" | "identity";

const PERSONAL =
  /\b(my|mine|our|i['’]?m|i am|i have|i've|me\b|us\b|attached|this (?:document|file|statement|letter|report|form))\b/i;

const RULES: Array<{ kind: SensitiveKind; noun: RegExp; cue?: RegExp }> = [
  {
    kind: "tax",
    noun: /\b(tax(?:es|ation)?|1040|schedule c|w-?2|1099|vat return|self[- ]assessment|hmrc|irs)\b/i,
    cue: /\b(fil(?:e|ing)|prepar|return|deduct|write[- ]?off|submit|owe|refund|liability|my|our)\b/i,
  },
  {
    kind: "medical",
    noun: /\b(medical|health|clinical|lab (?:results?|report)|blood (?:test|work)|diagnos\w+|prescription|medication|symptom|x-?ray|mri|ct scan|biopsy|discharge summary|after[- ]visit)\b/i,
    cue: PERSONAL,
  },
  {
    kind: "financial",
    noun: /\b(bank statement|payslip|pay ?stub|salary|net pay|take[- ]home|mortgage|loan|overdraft|credit card|account balance|savings|pension|401\(?k\)?|invoice)\b/i,
    cue: PERSONAL,
  },
  {
    kind: "legal",
    noun: /\b(contract|tenancy|lease|nda|non[- ]disclosure|settlement|divorce|custody|will and testament|power of attorney|dispute|solicitor|attorney)\b/i,
    cue: PERSONAL,
  },
  {
    kind: "identity",
    noun: /\b(passport number|social security|ssn\b|national insurance number|driver'?s licen[cs]e|date of birth|dob\b|iban\b|sort code|routing number)\b/i,
  },
];

const SAYS: Record<SensitiveKind, string> = {
  tax: "tax paperwork",
  medical: "health information",
  financial: "financial details",
  legal: "a legal document",
  identity: "personal identifiers",
};

export interface SensitiveHit {
  kind: SensitiveKind;
  reason: string;
}

export function detectSensitive(text: string): SensitiveHit | null {
  const t = (text ?? "").trim();
  if (t.length < 8) return null;
  for (const r of RULES) {
    if (!r.noun.test(t)) continue;
    if (r.cue && !r.cue.test(t)) continue;
    return {
      kind: r.kind,
      reason:
        `That looks like ${SAYS[r.kind]}, so I have switched this chat to ` +
        `ultra-private: it stays in memory on this machine, nothing is written ` +
        `to disk, and nothing leaves the box. To keep a normal conversation, ` +
        `start a new chat from New chat.`,
    };
  }
  return null;
}

export const BANNER = "Ultra-private. Held in memory on this device only: no cloud, no outside apps, nothing published, nothing written to disk.";

export const ENDED = "Ultra-private session ended — everything it held in memory is gone.";


export const WIPE_URL = "/api/v1/private/forget";

export function beaconBody(): Blob {
  return new Blob(["{}"], { type: "application/json" });
}

export interface Beacon {
  (url: string, body: Blob): boolean;
}

const defaultBeacon: Beacon = (url, body) => {
  const nav = (globalThis as { navigator?: Navigator }).navigator;
  if (nav?.sendBeacon) return nav.sendBeacon(url, body);
  void fetch(url, {
    method: "POST",
    keepalive: true,
    headers: { "content-type": "application/json" },
    body: "{}",
  }).catch(() => {});
  return true;
};

export function wipePrivate(beacon: Beacon = defaultBeacon): void {
  try {
    beacon(WIPE_URL, beaconBody());
  } catch (e) {
    console.error("[nexy] ultra-private wipe failed:", e);
  }
}

export interface Turn {
  role: "user" | "assistant";
  content: string;
}

export interface PrivateHooks {
  history?: Turn[];
  say?: (text: string) => void;
  toast?: (text: string) => void;
}

let priv = false;
let hooks: PrivateHooks = {};

let buffer: Turn[] = [];

let privateConv: string | null = null;
export const privateConversationId = (): string | null => privateConv;

let ephemeralDocs: string[] = [];
export const noteEphemeralDoc = (filename: string): void => { ephemeralDocs.push(filename); };
export const ephemeralDocNames = (): string[] => [...ephemeralDocs];

function confirmExit(): boolean {
  const names = ephemeralDocNames();
  if (!names.length) return true;
  const list = names.length === 1 ? names[0] : `${names.length} documents`;
  return globalThis.confirm(
    `Leaving ultra-private mode deletes ${list}.\n\n` +
    `Files uploaded in ultra-private mode are held in memory only and are never written to disk, ` +
    `so there is no copy to restore. Leave anyway?`,
  );
}

export const isPrivate = (): boolean => priv;

export function endPrivate(): boolean {
  if (!priv || !confirmExit()) return !priv;
  setPrivate(false);
  return true;
}

export function conversation(nowPrivate: boolean): Turn[] {
  return nowPrivate ? buffer : (hooks.history ?? []);
}

export const heldTurns = (): Turn[] => [...buffer];

function removePrivateMessages(): void {
  if (typeof document === "undefined") return;
  document.querySelectorAll('#thread [data-private="1"]').forEach((n) => n.remove());
}

export function setPrivate(on: boolean, announce = true): boolean {
  const changed = on !== priv;
  if (on && changed) privateConv = `nexy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  priv = on;
  buffer = [];
  if (hooks.history) hooks.history.length = 0;
  if (!on) {
    wipePrivate();
    if (changed) removePrivateMessages();
    ephemeralDocs = [];
    privateConv = null;
    if (changed && announce) {
      hooks.say?.(ENDED);
      hooks.toast?.(ENDED);
    }
  }
  paint();
  if (changed && typeof window !== "undefined") window.dispatchEvent(new CustomEvent("nexy:private"));
  return priv;
}

// An explicit ask to read the owner's own connected app ("find the latest invoice in my email") is
// not switched to ultra-private: that would turn the app off and answer "I don't have access to
// your email" (QA 2026-11-12). The app runs on this device through the owner's own sign-in.
// Ultra-private the owner chose still keeps connected apps off.
export const autoPrivate = (text: string): SensitiveHit | null => connectorAsk(text) ? null : detectSensitive(text);

export function guard(text: string): { nowPrivate: boolean; hit: SensitiveHit | null } {
  const hit = priv ? null : autoPrivate(text);
  const nowPrivate = priv || !!hit;
  if (hit) {
    setPrivate(true, false);
    hooks.say?.(hit.reason);
  }
  return { nowPrivate, hit };
}

const el = (id: string) => document.getElementById(id);

function paint(): void {
  if (typeof document === "undefined") return;
  const banner = el("nexyPrivBanner");
  if (banner) banner.hidden = !priv;
  const lock = el("privBtn");
  if (lock) { lock.setAttribute("aria-pressed", String(priv)); lock.classList.toggle("on", priv); }
}

export function initPrivate(h: PrivateHooks = {}): void {
  hooks = h;
  if (typeof document === "undefined") return;

  const view = document.querySelector('section.view[data-view="chat"]');
  const thread = document.getElementById("thread");
  if (view && thread && !el("nexyPrivBanner")) {
    const b = document.createElement("div");
    b.id = "nexyPrivBanner";
    b.className = "encbanner";
    b.hidden = true;
    b.setAttribute("data-testid", "nexy-private-banner");
    b.innerHTML =
      '<svg class="i" viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>' +
      `<span>${BANNER}</span><button class="x" type="button" title="Hide">×</button>`;
    view.insertBefore(b, thread);
    b.querySelector(".x")?.addEventListener("click", () => { b.hidden = true; });
  }

  window.addEventListener("pagehide", () => {
    if (priv) wipePrivate();
  });

  paint();
}
