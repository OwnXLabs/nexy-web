import { cleanOutputs, type ChatOutput } from "./chat-output";
import { promises as fs, constants } from "node:fs";
import * as path from "node:path";

const DIR = process.env.NEXY_DATA_DIR ? path.join(process.env.NEXY_DATA_DIR, "chats") : "/var/lib/nexy/chats";
const ID = /^c[a-z0-9]{4,24}$/;
const PID = /^[\w:-]{1,64}$/;
const MAX_HTML = 2_000_000;

export interface Turn { role: "user" | "assistant"; content: string }
export interface SavedChat { id: string; pid: string; title: string; ts: number; html: string; history: Turn[]; outputs?: ChatOutput[]; activeOutput?: string; projectId?: string; open?: { kind: string; title: string; href: string; project?: unknown; ex?: string; needs?: string } }
export type ChatMeta = Omit<SavedChat, "html" | "history" | "outputs">;

const dirOf = (owner: string) => path.join(DIR, owner);
const fileOf = (owner: string, id: string) => path.join(dirOf(owner), `${id}.json`);

export function clean(raw: any): SavedChat | null {
  if (!raw || !ID.test(String(raw.id)) || !PID.test(String(raw.pid))) return null;
  const html = String(raw.html ?? "");
  if (html.length > MAX_HTML || JSON.stringify(raw.outputs ?? []).length > 8_000_000) return null;
  const history = (Array.isArray(raw.history) ? raw.history : [])
    .filter((t: any) => t && (t.role === "user" || t.role === "assistant") && typeof t.content === "string")
    .slice(-200)
    .map((t: any) => ({ role: t.role, content: t.content.slice(0, 16_000) }));
  return { id: raw.id, pid: raw.pid, title: String(raw.title ?? "Chat").slice(0, 80), ts: Date.now(), html, history, outputs: cleanOutputs(raw.outputs), projectId: typeof raw.projectId === "string" && PID.test(raw.projectId) ? raw.projectId : undefined, activeOutput: typeof raw.activeOutput === "string" ? raw.activeOutput.slice(0, 240) : undefined };
}

export async function list(owner: string): Promise<ChatMeta[]> {
  const names = await fs.readdir(dirOf(owner)).catch((e) => { if (e.code !== "ENOENT") throw e; return [] as string[]; });
  const out: ChatMeta[] = [];
  for (const n of names.filter((x) => x.endsWith(".json"))) {
    try {
      const c = JSON.parse(await fs.readFile(path.join(dirOf(owner), n), "utf8")) as SavedChat;
      out.push({ id: c.id, pid: c.pid, title: c.title, ts: c.ts });
    } catch (e) {
      console.warn(`[nexy] chat ${n} unreadable: ${(e as Error).message}`);
    }
  }
  return out.sort((a, b) => b.ts - a.ts).slice(0, 200);
}

export async function get(owner: string, id: string): Promise<SavedChat | null> {
  if (!ID.test(id)) return null;
  try { return JSON.parse(await fs.readFile(fileOf(owner, id), "utf8")) as SavedChat; }
  catch (e: any) { if (e?.code === "ENOENT") return null; throw e; }
}

// A save says which version it was made from (`base`: the saved ts, 0 for a new chat).
// A device holding an older copy is refused, so it cannot overwrite turns another
// device added since (a phone left open erased the Mac's answer, 2026-11-12).
export class Conflict extends Error { constructor(readonly current: number) { super("this chat changed on another device"); } }
// Saved chats per owner stop at NEXY_CHAT_STORAGE_MB (default 512): a save that grows past it is
// refused; one that shrinks a chat always goes through, so a full owner can still tidy up.
export class StorageFull extends Error { constructor() { super("Your saved chats are full. Delete some older chats, then try again."); } }
const storageCap = () => (Number(process.env.NEXY_CHAT_STORAGE_MB) || 512) * 1024 * 1024;
async function sizes(owner: string, file: string): Promise<{ total: number; mine: number }> {
  const names = await fs.readdir(dirOf(owner)).catch((e) => { if (e.code !== "ENOENT") throw e; return [] as string[]; });
  let total = 0, mine = 0;
  for (const f of names.filter((x) => x.endsWith(".json"))) {
    const full = path.join(dirOf(owner), f);
    const n = await fs.stat(full).then((s) => s.size, (e) => { if (e.code !== "ENOENT") throw e; return 0; });
    total += n;
    if (full === file) mine = n;
  }
  return { total, mine };
}
const locks = new Map<string, Promise<unknown>>();
export function put(owner: string, c: SavedChat, base?: number): Promise<void> {
  const file = fileOf(owner, c.id);
  const run = (locks.get(file) ?? Promise.resolve()).catch(() => {}).then(async () => {
    const now = await get(owner, c.id);
    if (base !== undefined && (now?.ts ?? 0) !== base) throw new Conflict(now?.ts ?? 0);
    if (now && c.ts <= now.ts) c.ts = now.ts + 1;
    const text = JSON.stringify(c);
    const { total, mine } = await sizes(owner, file), size = Buffer.byteLength(text);
    if (size > mine && total - mine + size > storageCap()) throw new StorageFull();
    await fs.mkdir(dirOf(owner), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, text, { mode: 0o600 });
    await fs.rename(tmp, file);
  });
  locks.set(file, run);
  void run.finally(() => { if (locks.get(file) === run) locks.delete(file); }).catch(() => {});
  return run;
}

// A device's earlier chats (kept under its browser owner) join the signed-in owner once.
// Copies only: nothing is moved or deleted, and chats already there win.
export async function adopt(from: string, to: string): Promise<number> {
  if (from === to) return 0;
  const mark = path.join(dirOf(to), `.adopted-${from.replace(/[^\w-]/g, "_")}`);
  if (await fs.stat(mark).then(() => true, () => false)) return 0;
  const names = await fs.readdir(dirOf(from)).catch((e) => { if (e.code !== "ENOENT") throw e; return [] as string[]; });
  await fs.mkdir(dirOf(to), { recursive: true, mode: 0o700 });
  let n = 0;
  for (const name of names.filter((x) => x.endsWith(".json"))) {
    try { await fs.copyFile(path.join(dirOf(from), name), path.join(dirOf(to), name), constants.COPYFILE_EXCL); n++; }
    catch (e: any) { if (e?.code !== "EEXIST") throw e; }
  }
  await fs.writeFile(mark, String(n), { mode: 0o600 });
  return n;
}

export async function remove(owner: string, id: string): Promise<void> {
  if (!ID.test(id)) return;
  await fs.rm(fileOf(owner, id), { force: true });
}

// Examples every visitor sees: real conversations curated on the box, read-only here,
// then the set shipped with the code (nexy/examples, results in public/examples).
const EXAMPLES = path.join(DIR, "..", "examples");
const SHIPPED = Object.values(import.meta.glob<SavedChat>("../../examples/*.json", { eager: true, import: "default" }));

// An image result kept inline (a data: URI) made the example list 600 KB, so the sidebar
// stayed empty for 6 s (2026-10-20). The list carries a link; the image loads on open.
// A plan example carries a snapshot of its project, for machines that never had it; that stays
// out of the list too, and is read with the example when opened.
const lean = (c: SavedChat): SavedChat["open"] => {
  if (!c.open) return c.open;
  if (c.open.href.startsWith("data:")) return { ...c.open, href: `/api/v1/chats?id=${encodeURIComponent(c.id)}&asset=open` };
  if (c.open.project) { const { project: _snapshot, ...rest } = c.open; return { ...rest, ex: c.id }; }
  return c.open;
};

export async function exampleAsset(id: string): Promise<{ type: string; bytes: Buffer } | null> {
  const m = /^data:([\w/+.-]+);base64,(.*)$/s.exec((await example(id))?.open?.href ?? "");
  return m ? { type: m[1], bytes: Buffer.from(m[2], "base64") } : null;
}

export async function examples(): Promise<(ChatMeta & { open?: SavedChat["open"] })[]> {
  const names = await fs.readdir(EXAMPLES).catch((e) => { if (e.code !== "ENOENT") throw e; return [] as string[]; });
  const out: (ChatMeta & { open?: SavedChat["open"] })[] = [];
  for (const n of names.filter((x) => x.endsWith(".json")).sort()) {
    try {
      const c = JSON.parse(await fs.readFile(path.join(EXAMPLES, n), "utf8")) as SavedChat;
      out.push({ id: c.id, pid: "_examples", title: c.title, ts: c.ts, open: lean(c) });
    } catch (e) {
      console.warn(`[nexy] example ${n} unreadable: ${(e as Error).message}`);
    }
  }
  for (const c of SHIPPED) if (!out.some((o) => o.id === c.id)) out.push({ id: c.id, pid: "_examples", title: c.title, ts: c.ts, open: lean(c) });
  return out;
}

export async function example(id: string): Promise<SavedChat | null> {
  if (!ID.test(id)) return null;
  try { return JSON.parse(await fs.readFile(path.join(EXAMPLES, `${id}.json`), "utf8")) as SavedChat; }
  catch (e: any) { if (e?.code === "ENOENT") return SHIPPED.find((c) => c.id === id) ?? null; throw e; }
}
