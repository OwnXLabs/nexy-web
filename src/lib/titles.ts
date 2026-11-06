import { promises as fs } from "node:fs";
import * as path from "node:path";
import { guardIdentity } from "./engine/identity-guard";

const LLM = (process.env.NEXY_LLM_URL ?? "http://127.0.0.1:8080").replace(/\/+$/, "");
const MODEL = process.env.NEXY_MODEL ?? "txt2txt";
const FILE = process.env.NEXY_DATA_DIR ? path.join(process.env.NEXY_DATA_DIR, "titles.json") : "/var/lib/nexy/titles.json";

const SYSTEM =
  "Name the thing described in 2 to 5 words, the way a chat app titles a conversation. " +
  "If a brand or product name is given, lead with it. Title Case, no quotes, no trailing punctuation. Reply with the name only.";

// a short title from the local model, or null if it is busy or says nothing useful
export async function shortTitle(text: string): Promise<string | null> {
  const res = await fetch(`${LLM}/v1/chat/completions`, {
    method: "POST", signal: AbortSignal.timeout(60_000), headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL, max_tokens: 24, temperature: 0.2, chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: text.slice(0, 1200) }],
    }),
  });
  if (!res.ok) return null;
  const out = String((await res.json())?.choices?.[0]?.message?.content ?? "")
    .replace(/<think>[\s\S]*?<\/think>/g, "").split("\n")[0].replace(/^["'“”\s]+|["'“”.\s]+$/g, "").trim();
  // a title is shown in the sidebar: the same rule as a reply
  const safe = guardIdentity(out).reply;
  return safe && safe.length <= 48 && safe.split(/\s+/).length <= 7 ? safe : null;
}

let cache: Record<string, string> | null = null;
async function load(): Promise<Record<string, string>> {
  if (cache) return cache;
  try { cache = JSON.parse(await fs.readFile(FILE, "utf8")); }
  catch (e: any) { if (e?.code !== "ENOENT") console.warn(`[nexy] titles unreadable: ${e?.message ?? e}`); cache = {}; }
  return cache!;
}

export async function cachedTitles(): Promise<Record<string, string>> {
  return { ...(await load()) };
}

// Builds are named once, in the background, one at a time: Files never waits on the model.
const pending = new Set<string>();
let chain: Promise<void> = Promise.resolve();
export function nameLater(key: string, describe: () => Promise<string>): void {
  if (pending.has(key)) return;
  pending.add(key);
  chain = chain.then(async () => {
    const c = await load();
    if (c[key]) return;
    const t = await shortTitle(await describe());
    if (!t) return;
    c[key] = t;
    await fs.mkdir(path.dirname(FILE), { recursive: true });
    await fs.writeFile(`${FILE}.tmp`, JSON.stringify(c));
    await fs.rename(`${FILE}.tmp`, FILE);
  }).catch((e) => console.warn(`[nexy] could not name ${key}: ${e?.message ?? e}`)).finally(() => pending.delete(key));
}
