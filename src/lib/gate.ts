// Checks every request meets before routing: the Host it names, and the size of its body.

// The server's own port: PORT, else the Node adapter's default.
const ownPort = (): string => process.env.PORT || "4321";

// Names this Nexy answers to besides loopback, e.g. "nexy.example.com,my.example.com" (NEXY_HOSTS).
// An entry without a port matches that name on any port; one with a port matches only that.
const listed = (): string[] =>
  (process.env.NEXY_HOSTS ?? "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

// A rebound name (DNS rebinding) reaches this server with its own Host, so anything but loopback on
// this port or a listed name is refused (421), as the engine does.
export function hostAllowed(header: string | null): boolean {
  const h = (header ?? "").trim().toLowerCase();
  if (!h) return false;
  const m = /^(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(h);
  if (!m) return false;
  const [, name, port] = m;
  if (listed().some((e) => e === h || e === name)) return true;
  return ["127.0.0.1", "localhost", "[::1]"].includes(name) && (port ?? "80") === ownPort();
}

const MB = 1024 * 1024;
export const DEFAULT_CAP = MB;
// Routes that take more than the default, each sized to what it accepts itself.
const CAPS: [RegExp, number][] = [
  [/^\/api\/apps\//, 48 * MB],              // studios: Own Docs uploads up to 40 MB
  [/^\/api\/v1\/voice\//, 26 * MB],         // recordings up to 25 MB
  [/^\/api\/v1\/chats\/?$/, 16 * MB],       // a saved chat: page, outputs and history
  [/^\/api\/v1\/chat\/?$/, 8 * MB],         // a conversation with its attached files' text
  [/^\/api\/v1\/revise\/?$/, 6 * MB],       // a page of up to 2 MB, JSON-escaped
  [/^\/api\/v1\/problem-report\/?$/, 4 * MB], // a 3 MB screenshot
  [/^\/api\/v1\/beta-report\/?$/, 3 * MB],  // 2 MB report
];
export const LARGEST_CAP = Math.max(...CAPS.map(([, n]) => n));

export const capFor = (pathname: string): number => CAPS.find(([re]) => re.test(pathname))?.[1] ?? DEFAULT_CAP;

// True when the body is over `cap`. A declared length is checked as is; a chunked body is counted
// on a copy, stopping just past the cap, so the route still reads the original.
export async function overCap(req: Request, cap: number): Promise<boolean> {
  if (req.method === "GET" || req.method === "HEAD") return false;
  const len = req.headers.get("content-length");
  if (len !== null) return Number(len) > cap;
  if (!req.body) return false;
  const r = req.clone().body!.getReader();
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) return false;
    n += value.byteLength;
    // not awaited: a cancelled tee branch settles only once the other one is cancelled too
    if (n > cap) { r.cancel().catch(() => {}); return true; }
  }
}

export const tooLarge = (cap: number): Response =>
  new Response(JSON.stringify({ error: `That is too large to send to Nexy. The limit here is ${Math.round(cap / MB)} MB.` }), {
    // close: the rest of the body is never read
    status: 413, headers: { "content-type": "application/json", "cache-control": "no-store", connection: "close" },
  });

export const misdirected = (): Response =>
  new Response("This Nexy answers only at its own address.\n", { status: 421, headers: { "content-type": "text/plain" } });
