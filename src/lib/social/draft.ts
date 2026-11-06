import { SPECS, fit, type Fitted } from "./networks.ts";
import type { Draft, Network } from "./types.ts";

export type Complete = (req: { system: string; user: string; maxTokens: number }) => Promise<string>;

const id = (net: Network, n: number) =>
  `d_${net}_${Date.now().toString(36)}_${n.toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function clean(raw: string): string {
  let t = String(raw ?? "").trim();
  const fence = /^```[a-z]*\n([\s\S]*?)\n?```$/i.exec(t);
  if (fence) t = fence[1].trim();
  t = t.replace(
    /^(?:sure|certainly|of course|absolutely)?[,!.]?\s*(?:here(?:'s| is| are)|below is)[^\n:]{0,80}:\s*/i,
    "",
  );
  t = t.replace(/^(?:post|caption|draft|tweet|linkedin post|instagram caption)\s*[:\-–]\s*/i, "");
  if (/^["“](.|\n)*["”]$/.test(t) && !t.slice(1, -1).includes('"')) t = t.slice(1, -1).trim();
  return t;
}

function system(net: Network): string {
  const s = SPECS[net];
  return [
    `You write social posts for ${s.label}. You are running on the author's own machine.`,
    s.voice,
    `Hard limit: ${s.limit} characters. Aim for about ${s.comfortable}.`,
    "Return the post text and nothing else. No preamble, no explanation, no markdown fence,",
    "no surrounding quotes, no alternative versions.",
    "Do not invent prices, dates, customer names, or numbers that were not in the brief.",
  ].join("\n");
}

export interface DraftRequest {
  brief: string;
  pillars?: string[];
  networks: Network[];
  perNetwork?: number;
}

export async function draftPosts(req: DraftRequest, complete: Complete): Promise<Draft[]> {
  const per = Math.max(1, Math.min(4, Math.floor(req.perNetwork ?? 2)));
  const brief = String(req.brief ?? "").trim();
  if (!brief) throw new Error("a brief is required");
  if (!req.networks.length) throw new Error("at least one network is required");

  const out: Draft[] = [];
  for (const net of req.networks) {
    for (let i = 0; i < per; i++) {
      const angle =
        per === 1
          ? ""
          : `\n\nThis is post ${i + 1} of ${per} for ${SPECS[net].label}. Take a different angle from the others; do not repeat their opening line.`;
      const raw = await complete({
        system: system(net),
        user: `Brief: ${brief}${req.pillars?.length ? `\nContent pillars to stay within: ${req.pillars.join("; ")}` : ""}${angle}`,
        maxTokens: Math.max(1024, Math.ceil(SPECS[net].limit / 2)),
      });
      const text = clean(raw);
      if (!text) throw new Error(`the model returned nothing for ${SPECS[net].label}`);
      const f: Fitted = fit(net, text);
      const now = Date.now();
      out.push({
        id: id(net, out.length),
        net,
        brief,
        text: f.text,
        ...(f.trimmedFrom ? { trimmedFrom: f.trimmedFrom } : {}),
        off: false,
        createdAt: now,
        updatedAt: now,
        by: "model",
      });
    }
  }
  return out;
}

export async function rewriteDraft(
  draft: Draft,
  instruction: string,
  complete: Complete,
): Promise<Draft> {
  const instr = String(instruction ?? "").trim();
  if (!instr) throw new Error("say what to change");
  const raw = await complete({
    system: system(draft.net),
    user:
      `Rewrite this ${SPECS[draft.net].label} post. Keep the same subject and the same facts; ` +
      `change only what the instruction asks for.\n\n` +
      `Instruction: ${instr}\n\nOriginal post:\n${draft.text}`,
    maxTokens: Math.max(1024, Math.ceil(SPECS[draft.net].limit / 2)),
  });
  const text = clean(raw);
  if (!text) throw new Error("the model returned nothing");
  const f = fit(draft.net, text);
  return {
    ...draft,
    text: f.text,
    trimmedFrom: f.trimmedFrom,
    updatedAt: Date.now(),
    by: "model:rewrite",
  };
}

export function pickDraft(drafts: Draft[], net: Network, draftId?: string): Draft | null {
  if (draftId) return drafts.find((d) => d.id === draftId) ?? null;
  const mine = drafts.filter((d) => d.net === net);
  if (!mine.length) return null;
  return mine.reduce((a, b) => (b.updatedAt > a.updatedAt ? b : a));
}
