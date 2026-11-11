import { httpMsg } from "./http.ts";
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const hhmm = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export interface PermSpec {
  title: string;
  why?: string;
  rows: [string, string][];
  ok: string;
  deny: string;
}

export interface Outcome {
  ok: boolean;
  right: string;
  note: string;
  authorizeUrl?: string;
  // the sign-in finishes in the browser: resolves with the result, or null if it never did
  wait?: () => Promise<Outcome | null>;
}

export function permMarkup(spec: PermSpec, right = "needs you"): string {
  return (
    `<div class="bh"><span class="led warn"></span>${esc(spec.title)}<span class="r">${esc(right)}</span></div>` +
    (spec.why ? `<div class="why">${esc(spec.why)}</div>` : "") +
    spec.rows
      .map(
        ([label, value]) =>
          `<div class="row"><span class="led off"></span><span>${esc(label)}</span><span class="v">${esc(value)}</span></div>`,
      )
      .join("") +
    `<div class="ba">` +
    `<button class="btn" type="button" data-a="deny">${esc(spec.deny)}</button>` +
    `<button class="btn primary" type="button" data-a="ok">${esc(spec.ok)}</button>` +
    `</div>`
  );
}

export const decidedMarkup = (note: string, at: string = hhmm()) =>
  `<span class="done">${esc(note)} at ${esc(at)}</span>`;

export function permBlock(spec: PermSpec, onDecide: (approved: boolean) => Promise<Outcome> | Outcome): HTMLElement {
  const root = document.createElement("div");
  root.className = "block perm";
  root.innerHTML = permMarkup(spec);

  const decide = async (approved: boolean) => {
    const ba = root.querySelector(".ba");
    if (ba) ba.innerHTML = `<span class="done">${esc(approved ? "Asking the registry…" : "Declining…")}</span>`;
    const out = await onDecide(approved);
    settle(root, out);
    const done = await out.wait?.();
    if (done) settle(root, done);
  };

  root.querySelector<HTMLElement>('[data-a="ok"]')?.addEventListener("click", () => void decide(true));
  root.querySelector<HTMLElement>('[data-a="deny"]')?.addEventListener("click", () => void decide(false));
  return root;
}

export function settle(root: HTMLElement, outcome: Outcome): void {
  const r = root.querySelector(".bh .r");
  if (r) r.textContent = outcome.right;
  const ba = root.querySelector(".ba");
  if (!ba) return;
  ba.innerHTML = decidedMarkup(outcome.note);
  if (outcome.authorizeUrl) {
    const a = document.createElement("a");
    a.className = "btn primary";
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.href = outcome.authorizeUrl;
    a.textContent = "Open the consent page";
    ba.appendChild(a);
  }
}

export const APP = "nexy";

export const HUB = "/api/apps/hub/registry";
const as = (path: string) => `${HUB}${path}${path.includes("?") ? "&" : "?"}as=${APP}`;

export interface CatalogEntry {
  id: string;
  label: string;
  transport: string;
  url?: string;
  external?: boolean;
  enabled: boolean;
  scopes?: string[];
  egress?: string[];
  hubSupported?: boolean;
  oauth?: { authorizationEndpoint?: string; tokenEndpoint?: string; clientId?: string };
  auth: { type: string; credentialStored?: boolean; grantedScopes?: string[]; expiresAt?: string | null };
}

export type Fetch = typeof fetch;

const readJson = async (res: Response) => {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { error: text.slice(0, 200) };
  }
};

export async function loadCatalog(f: Fetch = fetch): Promise<CatalogEntry[]> {
  const res = await f(`${HUB}/catalog`);
  const body = await readJson(res);
  if (!res.ok) throw new Error(body?.error ?? httpMsg(res.status));
  if (!Array.isArray(body?.entries)) throw new Error("the connector registry returned no catalogue");
  return body.entries as CatalogEntry[];
}

export const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);

export function matchEntry(entries: CatalogEntry[], service: string): CatalogEntry | undefined {
  const want = slug(service);
  return (
    entries.find((e) => slug(e.id) === want) ??
    entries.find((e) => slug(e.label) === want) ??
    entries.find((e) => slug(e.label).startsWith(want) || want.startsWith(slug(e.id)))
  );
}

export interface ConnectIntent {
  kind: "connect" | "disconnect";
  service: string;
}

const NOISE = /\b(account|connector|integration|app|to my|to the|my|the)\b/gi;
const PURPOSE = /(?:\s+(?:so\s+(?:that\s+)?|to\s+(?!my\b|the\b)|for\s+|because\s+)|\s*,).*$/i;
const serviceOf = (raw: string) => raw.replace(PURPOSE, "").replace(NOISE, "").replace(/\s+/g, " ").trim();

export function connectIntent(text: string): ConnectIntent | null {
  const s = text.trim();
  const off = /^\s*(?:please\s+)?(?:dis-?connect|unlink|revoke|remove)\s+(?:my\s+|the\s+)?(.+?)\s*$/i.exec(s);
  // "remove" and "link" are page edits too ("remove the footer"); they count only with "my" or "account"
  const ACCOUNT = /\bmy\b|\b(?:account|connector|integration|connection)s?\s*$/i;
  if (off && /^\s*(?:please\s+)?remove\b/i.test(s) && !ACCOUNT.test(s)) return null;
  if (off) {
    const service = serviceOf(off[1]);
    return service ? { kind: "disconnect", service } : null;
  }
  const on = /^\s*(?:please\s+)?(?:connect|link|hook\s+up)\s+(?:to\s+)?(?:my\s+|the\s+)?(.+?)\s*$/i.exec(s);
  if (on && /^\s*(?:please\s+)?link\b/i.test(s) && !ACCOUNT.test(s)) return null;
  if (on) {
    const service = serviceOf(on[1]);
    return service ? { kind: "connect", service } : null;
  }
  return null;
}

const hostOf = (u?: string) => {
  if (!u) return "";
  try {
    return new URL(u).hostname;
  } catch {
    return u;
  }
};

// what a scope lets Nexy do, in words, with the scope itself after it
const SCOPES: Record<string, string> = {
  "https://www.googleapis.com/auth/gmail.readonly": "read your email, read-only; cannot send, change or delete",
  "https://www.googleapis.com/auth/drive.readonly": "read your Drive files, read-only; cannot change or delete",
};
const scopeText = (s: string) => (SCOPES[s] ? `${SCOPES[s]} (${s.split("/").pop()})` : s);

export function consentRows(entry: CatalogEntry): [string, string][] {
  // a connector served on this machine may still reach a provider: its egress says where
  const reaches = entry.egress?.length ? entry.egress.join(", ") : entry.external ? hostOf(entry.url) : "";
  const rows: [string, string][] = [
    ["Connector", reaches ? `${entry.label}, ${reaches}` : entry.url ? `${entry.label}, ${hostOf(entry.url)}` : entry.label],
    ["Scopes", entry.scopes?.length ? entry.scopes.map(scopeText).join("; ") : "none declared in this machine's catalogue"],
    ["Leaves this machine", reaches ? `requests to ${reaches}` : "nothing — this connector runs on this machine"],
    ["Apps that inherit this", "Nexy only. Connectors are machine-level, permissions are per-app."],
    ["Sign-in", entry.auth.type === "oauth" ? "OAuth in your browser; the token is stored here at 0600" : entry.auth.type === "api_key" ? "an API key, stored here at 0600" : "none needed"],
    ["Credential now", entry.auth.credentialStored ? `stored${entry.auth.expiresAt ? `, expires ${entry.auth.expiresAt}` : ""}` : "none stored"],
  ];
  if (!entry.enabled) rows.push(["Status", "disabled in the catalogue — it will serve nothing until an operator enables it"]);
  return rows;
}

const MESSAGING = /^(telegram|whatsapp|signal|discord|matrix|imessage|sms)\b/i;

export function unknownRows(service: string, entries: CatalogEntry[]): [string, string][] {
  if (MESSAGING.test(service)) {
    return [
      ["What it is", "a messaging channel for the agent, not a connector"],
      ["How it connects", "the agent talks to it directly, with a bot token and a one-time pairing of your own account"],
      ["On this machine", "not set up yet — there is nowhere to enter a bot token from Nexy"],
      ["Nothing leaves", "until it is set up and you pair your account"],
    ];
  }
  return [
    ["In this machine's catalogue", "no"],
    ["What is catalogued", entries.map((e) => e.label).join(", ") || "nothing"],
    ["To add it", `register ${service} with own-agent-mcp: its MCP URL, egress host, scopes and OAuth client`],
    ["If you approve", "Nexy will ask the registry anyway, and show you exactly what it says"],
  ];
}

async function grantedNow(id: string, f: Fetch): Promise<boolean> {
  try {
    const res = await f(`${HUB}/grants/${encodeURIComponent(APP)}`);
    const body = await readJson(res);
    return Array.isArray(body?.entries) && body.entries.includes(id);
  } catch (e) {
    console.warn("[nexy] grants unavailable", e);
    return false;
  }
}

export async function approveConnector(
  entry: CatalogEntry | null,
  service: string,
  f: Fetch = fetch,
): Promise<Outcome> {
  const id = entry?.id ?? slug(service);

  if (entry && entry.auth.type === "none") {
    const res = await f(as(`/grants/${encodeURIComponent(APP)}/${encodeURIComponent(id)}`), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const body = await readJson(res);
    if (!res.ok) return { ok: false, right: "not granted", note: `Not granted — ${body?.error ?? httpMsg(res.status)}` };
    if (!(await grantedNow(id, f))) {
      return { ok: false, right: "not granted", note: `The registry accepted the grant but does not list it. ${entry.label} is not available to Nexy.` };
    }
    return { ok: true, right: "granted", note: `Granted ${entry.label} to Nexy, confirmed by reading the registry back` };
  }

  const res = await f(as(`/oauth/${encodeURIComponent(id)}/authorize`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scopes: entry?.scopes ?? [] }),
  });
  const body = await readJson(res);

  if (!res.ok) {
    const why = body?.missing?.[0] ?? body?.error ?? httpMsg(res.status);
    const extra = entry?.auth.type === "api_key" ? " Nexy has nowhere to put an API key yet." : "";
    return { ok: false, right: "not connected", note: `Not connected — ${why}.${extra} Nothing was granted and nothing left this machine` };
  }

  const label = entry?.label ?? service;
  return {
    ok: false,
    right: "waiting on you",
    note: `Not connected yet. ${hostOf(body?.authorizeUrl) || "the provider"} must confirm the scopes in your browser; no token is stored here until it does`,
    authorizeUrl: String(body?.authorizeUrl ?? ""),
    wait: () => connectedSoon(id, label, f),
  };
}

// the registry is the only witness: connected once it reports a credential and Nexy's grant
async function connectedSoon(id: string, label: string, f: Fetch, ms = 600_000, every = 2000): Promise<Outcome | null> {
  for (const end = Date.now() + ms; Date.now() < end;) {
    await new Promise((r) => setTimeout(r, every));
    try {
      const res = await f(`${HUB}/catalog/${encodeURIComponent(id)}`);
      const e = (await readJson(res)) as CatalogEntry | null;
      if (res.ok && e?.auth?.credentialStored && (await grantedNow(id, f))) {
        return { ok: true, right: "connected", note: `Connected ${label} to Nexy, confirmed by reading the registry back` };
      }
    } catch (err) {
      console.warn("[nexy] connector status unavailable", err);
    }
  }
  return null;
}

// the connectors Nexy may use now; throws when the registry can't say
export async function loadGrants(f: Fetch = fetch): Promise<string[]> {
  const res = await f(`${HUB}/grants/${encodeURIComponent(APP)}`);
  const body = await readJson(res);
  if (!res.ok) throw new Error(body?.error ?? httpMsg(res.status));
  if (!Array.isArray(body?.entries)) throw new Error("the connector registry returned no grants");
  return body.entries.map(String);
}

// Pause drops only Nexy's grant: the sign-in stays, and the hub refuses Nexy on the next call.
export async function pauseConnector(entry: CatalogEntry, f: Fetch = fetch): Promise<Outcome> {
  const res = await f(as(`/grants/${encodeURIComponent(APP)}/${encodeURIComponent(entry.id)}`), { method: "DELETE", headers: { "content-type": "application/json" } });
  const body = await readJson(res);
  if (!res.ok) return { ok: false, right: "still connected", note: `Not paused — ${body?.error ?? httpMsg(res.status)}` };
  if (await grantedNow(entry.id, f)) return { ok: false, right: "still connected", note: `The registry still lists ${entry.label} for Nexy. It is not paused.` };
  return { ok: true, right: "paused", note: `Paused ${entry.label}. Nexy can't read it until you resume it` };
}

// Resume restores the grant; the owner consented at connect, and this click is the consent again.
export async function resumeConnector(entry: CatalogEntry, f: Fetch = fetch): Promise<Outcome> {
  const res = await f(as(`/grants/${encodeURIComponent(APP)}/${encodeURIComponent(entry.id)}`), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const body = await readJson(res);
  if (!res.ok) return { ok: false, right: "paused", note: `Not resumed — ${body?.error ?? httpMsg(res.status)}` };
  if (!(await grantedNow(entry.id, f))) return { ok: false, right: "paused", note: `The registry accepted it but does not list ${entry.label} for Nexy. It is still paused.` };
  return { ok: true, right: "connected", note: `Resumed ${entry.label}. Nexy can read it again` };
}

export async function revokeConnector(entry: CatalogEntry, f: Fetch = fetch): Promise<Outcome> {
  const id = entry.id;
  const g = await f(as(`/grants/${encodeURIComponent(APP)}/${encodeURIComponent(id)}`), { method: "DELETE", headers: { "content-type": "application/json" } });
  const gBody = await readJson(g);
  if (!g.ok) return { ok: false, right: "still connected", note: `Not revoked — ${gBody?.error ?? httpMsg(g.status)}` };

  const c = await f(as(`/oauth/${encodeURIComponent(id)}/revoke`), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const cBody = await readJson(c);
  // the grant is gone, but a credential the registry did not delete must not read as deleted
  if (!c.ok) return { ok: false, right: "grant revoked", note: `Nexy's grant is revoked, but the stored credential was not deleted — ${cBody?.error ?? httpMsg(c.status)}` };
  const stillGranted = await grantedNow(id, f);
  if (stillGranted) return { ok: false, right: "still connected", note: `The registry still lists ${entry.label} for Nexy. Nothing was revoked.` };

  const pending = cBody?.providerRevocationPending
    ? `. ${hostOf(entry.url) || "the provider"} still holds its side of the token — this machine cannot revoke it there yet`
    : "";
  return {
    ok: true,
    right: "revoked",
    note: `Revoked ${entry.label} for Nexy and deleted the stored credential${pending}`,
  };
}

export interface ConnectUI {
  block: (el: HTMLElement) => HTMLElement;
  say: (html: string) => void;
}

/** How a computer's hub keeps Google sign-ins (null on an Own1, whose hub has no such route). */
export async function signInStorage(f: Fetch = fetch): Promise<{ sealed: boolean; keychainAsks: boolean } | null> {
  try {
    const r = await f(`${HUB.replace(/\/registry$/, "")}/connectors/google`);
    if (!r.ok) return null;
    const j = await r.json();
    return { sealed: j?.sealed === true, keychainAsks: j?.keychainAsks === true };
  } catch (e) {
    console.warn("[nexy] sign-in storage unknown", e);
    return null;
  }
}

/** The consent rows, told how this computer keeps the sign-in. */
export function storageRows(rows: [string, string][], s: { sealed: boolean; keychainAsks: boolean } | null): [string, string][] {
  if (!s) return rows;
  const out = rows.map(([k, v]): [string, string] => (k === "Sign-in" && s.sealed ? [k, "Google in your browser; the token is stored here encrypted, with its key in your Keychain"] : [k, v]));
  if (s.keychainAsks) out.push(["After each Nexy update", "Your Mac asks for your password once, so Nexy can open your saved sign-ins. Choose Always Allow."]);
  return out;
}

export async function playConnect(intent: ConnectIntent, ui: ConnectUI, f: Fetch = fetch): Promise<void> {
  let entries: CatalogEntry[];
  try {
    entries = await loadCatalog(f);
  } catch (e) {
    ui.say(
      `I could not read this machine's connector registry, so I do not know what it can reach: <code>${esc((e as Error).message)}</code>`,
    );
    return;
  }

  const entry = matchEntry(entries, intent.service) ?? null;

  if (intent.kind === "disconnect") {
    if (!entry) {
      ui.say(`There is no connector called ${esc(intent.service)} on this machine, so there is nothing to disconnect.`);
      return;
    }
    ui.block(
      permBlock(
        {
          title: `Disconnect ${entry.label}`,
          why: "Revoking drops Nexy's grant and deletes the credential stored on this machine.",
          rows: consentRows(entry),
          ok: `Disconnect ${entry.label}`,
          deny: "Keep it",
        },
        async (approved) =>
          approved
            ? await revokeConnector(entry, f)
            : { ok: false, right: "unchanged", note: `Left ${entry.label} as it was` },
      ),
    );
    return;
  }

  const spec: PermSpec = entry
    ? {
        title: `Connect ${entry.label}`,
        why:
          entry.external || entry.egress?.length
            ? "This connector reaches off this machine, so I ask first. Every row below is read from this machine's connector catalogue, not written for the occasion."
            : "This connector runs on this machine. The grant below is what lets Nexy use it, and nothing wider.",
        rows: entry.auth.type === "oauth" ? storageRows(consentRows(entry), await signInStorage(f)) : consentRows(entry),
        ok: `Connect ${entry.label}`,
        deny: "Not now",
      }
    : {
        title: `Connect ${intent.service}`,
        why: `${intent.service} is not in this machine's connector catalogue, so I have no scopes to show you and nothing to consent to. Approving asks the registry anyway and shows you its answer.`,
        rows: unknownRows(intent.service, entries),
        ok: "Ask the registry anyway",
        deny: "Not now",
      };

  ui.block(
    permBlock(spec, async (approved) =>
      approved
        ? await approveConnector(entry, intent.service, f)
        : { ok: false, right: "denied", note: "Denied. Nothing was granted and nothing left this machine" },
    ),
  );
}
