// Beta builds: a problem report the tester chooses to send to the Nexy team. The page posts here
// (it can't reach the report server itself in the desktop app); this adds the install key and
// forwards. The body is re-scrubbed, which changes nothing the preview already showed.
import * as os from "node:os";
import { bareUrl, scrub, scrubLog } from "./scrub";

export const isBeta = (): boolean => process.env.NEXY_BETA === "1";
const MAX_BODY = 2 * 1024 * 1024;

export class BetaRefused extends Error { constructor(msg: string, readonly status: number) { super(msg); } }

export type Hardware = Partial<{
  os: string; arch: string; cpu: string; ram_gb: number; gpu: string | null; gpu_cores: number | null; vram_gb: number | null;
  free_disk_gb: number; tier: string; model: string; tested: boolean; class: string;
}>;

const num = (v: unknown) => (typeof v === "number" && isFinite(v) && v >= 0 && v < 1e6 ? Math.round(v * 10) / 10 : null);
const name = (v: unknown, n: number) => (typeof v === "string" && v.trim() ? scrubLog(v.trim()).slice(0, n) : null);

// only these fields, whatever the app or NEXY_CAPS hold: no serial, host, user, path or address
export function hardwareOf(app: any, caps: any): Hardware {
  const a = app && typeof app === "object" ? app : {}, c = caps && typeof caps === "object" ? caps : {};
  const tier = [a.tier, c.tier].find((t) => t === "gpu" || t === "cpu");
  const h: Record<string, unknown> = {
    os: name(a.os, 60), arch: name(a.arch, 20), cpu: name(a.cpu, 80), ram_gb: num(a.ram_gb), gpu: name(a.gpu, 80),
    gpu_cores: Number.isInteger(a.gpu_cores) && a.gpu_cores > 0 && a.gpu_cores < 10000 ? a.gpu_cores : null, vram_gb: num(a.vram_gb),
    free_disk_gb: num(a.free_disk_gb), tier: tier ?? null,
    model: name(c.model, 80), tested: typeof c.tested === "boolean" ? c.tested : null, class: name(c.class, 20),
  };
  return Object.fromEntries(Object.entries(h).filter(([, v]) => v !== null)) as Hardware;
}

async function get(url: string, what: string): Promise<Response | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (r.ok) return r;
    console.error(`beta report: ${what} answered ${r.status}`);
  } catch (e) { console.error(`beta report: ${what} unavailable: ${(e as Error).message}`); }
  return null;
}

// what the page can't know itself: app and OS version, the app's own log tail and this computer
export async function context(): Promise<{ ready: boolean; version: string; os: string; logs: string; hardware: Hardware }> {
  const tail = process.env.NEXY_LOG_TAIL_URL;
  // an older app has no /hardware: the page then says what the browser knows
  const [lr, hr] = tail ? await Promise.all([get(tail, "log tail"), get(`${tail}/hardware`, "hardware")]) : [null, null];
  const logs = lr ? (await lr.text()).split("\n").slice(-200).join("\n") : "";
  const app = hr ? await hr.json().catch((e: Error) => { console.error(`beta report: hardware unreadable: ${e.message}`); return null; }) : null;
  let caps: unknown = null;
  try { caps = process.env.NEXY_CAPS ? JSON.parse(process.env.NEXY_CAPS) : null; } catch (e) { console.error(`beta report: NEXY_CAPS unreadable: ${(e as Error).message}`); }
  return {
    ready: !!(reportUrl() && process.env.NEXY_INSTALL_KEY),
    version: (process.env.NEXY_APP_VERSION ?? "").slice(0, 40),
    os: `${os.type()} ${os.release()} ${os.arch()}`.slice(0, 80),
    logs: scrubLog(logs),
    hardware: hardwareOf(app, caps),
  };
}

// HTTPS only; plain http only to this machine (a stand-in server in tests)
function reportUrl(): string | null {
  const u = process.env.NEXY_BETA_REPORT_URL;
  if (!u) return null;
  try {
    const p = new URL(u);
    if (p.protocol === "https:" || (p.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(p.hostname))) return u;
  } catch { /* refused below */ }
  console.error("beta report: NEXY_BETA_REPORT_URL is not an https address; reports are off");
  return null;
}

const str = (v: unknown, n: number) => (typeof v === "string" ? scrub(v).slice(0, n) : "");
const log = (v: unknown, n: number) => (typeof v === "string" ? scrubLog(v).slice(0, n) : "");

// the fields the report server keeps, every string scrubbed; the shape matches what the page built
export function tidy(b: any): Record<string, unknown> {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new BetaRefused("body must be a JSON object", 400);
  const out: Record<string, unknown> = {
    kind: ["bug", "looks", "idea"].includes(b.kind) ? b.kind : "bug",
    text: str(b.text, 5000), app: str(b.app, 20), version: str(b.version, 40), os: str(b.os, 80),
    errors: Array.isArray(b.errors) ? b.errors.slice(0, 30).map((e: any) => ({ at: Number(e?.at) || 0, msg: log(e?.msg, 300) })) : [],
    requests: Array.isArray(b.requests) ? b.requests.slice(0, 30).map((r: any) => ({
      at: Number(r?.at) || 0, method: str(r?.method, 10), url: bareUrl(String(r?.url ?? "")).slice(0, 200), status: Number(r?.status) || 0, ms: Number(r?.ms) || 0,
    })) : [],
    logs: log(b.logs, 100_000),
  };
  if (typeof b.email === "string" && b.email.trim()) out.email = b.email.trim().slice(0, 254);
  if (Array.isArray(b.conversation)) out.conversation = b.conversation.slice(0, 20).map((t: any) => ({ role: str(t?.role, 20), text: log(t?.text, 2000) }));
  if (typeof b.screenshot === "string" && /^data:image\/(jpeg|png);base64,/.test(b.screenshot)) out.screenshot = b.screenshot;
  if (!out.text && !out.screenshot) throw new BetaRefused("say what happened, or add a screenshot", 400);
  return out;
}

export async function forward(body: Record<string, unknown>): Promise<string> {
  const url = reportUrl(), key = process.env.NEXY_INSTALL_KEY;
  if (!url || !key) throw new BetaRefused("sending reports is not set up in this build", 503);
  const raw = JSON.stringify(body);
  if (Buffer.byteLength(raw) > MAX_BODY) throw new BetaRefused("the report is too large to send; remove a screenshot and try again", 413);
  let r: Response;
  try {
    r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-install": key }, body: raw, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    console.error(`beta report: send failed: ${(e as Error).message}`);
    throw new BetaRefused("the Nexy team's server could not be reached; check the connection and try again", 502);
  }
  const j: any = await r.json().catch((e: Error) => { console.error(`beta report: unreadable answer (${r.status}): ${e.message}`); return {}; });
  if (r.status === 201 && typeof j.ref === "string") return j.ref.slice(0, 20);
  console.error(`beta report: the team's server answered ${r.status}`);
  throw new BetaRefused(typeof j.error === "string" ? j.error.slice(0, 200) : "the Nexy team's server did not take the report; try again later", r.status === 429 || r.status === 413 ? r.status : 502);
}
