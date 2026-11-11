// Beta builds: a problem report the tester chooses to send to the Nexy team. The page posts here
// (it can't reach the report server itself in the desktop app); this adds the install key and
// forwards. The body is re-scrubbed, which changes nothing the preview already showed.
import * as os from "node:os";
import { bareUrl, scrub } from "./scrub";

export const isBeta = (): boolean => process.env.NEXY_BETA === "1";
const MAX_BODY = 2 * 1024 * 1024;

export class BetaRefused extends Error { constructor(msg: string, readonly status: number) { super(msg); } }

// what the page can't know itself: app and OS version, and the app's own log tail
export async function context(): Promise<{ ready: boolean; version: string; os: string; logs: string }> {
  let logs = "";
  const tail = process.env.NEXY_LOG_TAIL_URL;
  if (tail) {
    try {
      const r = await fetch(tail, { signal: AbortSignal.timeout(3000) });
      if (r.ok) logs = (await r.text()).split("\n").slice(-200).join("\n");
      else console.error(`beta report: log tail answered ${r.status}`);
    } catch (e) { console.error(`beta report: log tail unavailable: ${(e as Error).message}`); }
  }
  return {
    ready: !!(process.env.NEXY_BETA_REPORT_URL && process.env.NEXY_INSTALL_KEY),
    version: (process.env.NEXY_APP_VERSION ?? "").slice(0, 40),
    os: `${os.type()} ${os.release()} ${os.arch()}`.slice(0, 80),
    logs: scrub(logs),
  };
}

const str = (v: unknown, n: number) => (typeof v === "string" ? scrub(v).slice(0, n) : "");

// the fields the report server keeps, every string scrubbed; the shape matches what the page built
export function tidy(b: any): Record<string, unknown> {
  if (!b || typeof b !== "object" || Array.isArray(b)) throw new BetaRefused("body must be a JSON object", 400);
  const out: Record<string, unknown> = {
    kind: ["bug", "looks", "idea"].includes(b.kind) ? b.kind : "bug",
    text: str(b.text, 5000), app: str(b.app, 20), version: str(b.version, 40), os: str(b.os, 80),
    errors: Array.isArray(b.errors) ? b.errors.slice(0, 30).map((e: any) => ({ at: Number(e?.at) || 0, msg: str(e?.msg, 300) })) : [],
    requests: Array.isArray(b.requests) ? b.requests.slice(0, 30).map((r: any) => ({
      at: Number(r?.at) || 0, method: str(r?.method, 10), url: bareUrl(String(r?.url ?? "")).slice(0, 200), status: Number(r?.status) || 0, ms: Number(r?.ms) || 0,
    })) : [],
    logs: str(b.logs, 100_000),
  };
  if (typeof b.email === "string" && b.email.trim()) out.email = b.email.trim().slice(0, 254);
  if (Array.isArray(b.conversation)) out.conversation = b.conversation.slice(0, 20).map((t: any) => ({ role: str(t?.role, 20), text: str(t?.text, 2000) }));
  if (typeof b.screenshot === "string" && /^data:image\/(jpeg|png);base64,/.test(b.screenshot)) out.screenshot = b.screenshot;
  if (!out.text && !out.screenshot) throw new BetaRefused("say what happened, or add a screenshot", 400);
  return out;
}

export async function forward(body: Record<string, unknown>): Promise<string> {
  const url = process.env.NEXY_BETA_REPORT_URL, key = process.env.NEXY_INSTALL_KEY;
  if (!url || !key) throw new BetaRefused("sending reports is not set up in this build", 503);
  const raw = JSON.stringify(body);
  if (Buffer.byteLength(raw) > MAX_BODY) throw new BetaRefused("the report is too large to send; remove the screenshot and try again", 413);
  let r: Response;
  try {
    r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-install": key }, body: raw, signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    console.error(`beta report: send failed: ${(e as Error).message}`);
    throw new BetaRefused("the Nexy team's server could not be reached; check the connection and try again", 502);
  }
  const j: any = await r.json().catch((e: Error) => { console.error(`beta report: unreadable answer (${r.status}): ${e.message}`); return {}; });
  if (r.status === 201 && typeof j.ref === "string") return j.ref.slice(0, 20);
  throw new BetaRefused(typeof j.error === "string" ? j.error.slice(0, 200) : `the team's server answered ${r.status}`, r.status === 429 || r.status === 413 ? r.status : 502);
}
