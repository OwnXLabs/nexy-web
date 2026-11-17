// A researched answer is only as good as the search behind it. Small models answered "who won…"
// without searching, made up the winner and a link, and one said "I searched the web" (capability
// matrix, 2026-11-16). Here a reply is checked against the tool calls that really ran this turn:
// links that no search or page gave are taken out, and an answer with no search behind it says so.

export interface ToolCall { name: string; text: string }

// asks for something only a search can answer well: these get a search, and are told when none ran
const SEARCH_ASK = /\b(?:search|research|look(?:ing)? (?:it |this |that )?up|google|latest|news|this week|current(?:ly)?|recent(?:ly)?|right now|sources?|links?|urls?|cite|citations?|who won|prices? of|how much (?:is|does|are))\b/i;
export function asksToSearch(said: string, history: { role: string; content: string }[] = []): boolean {
  if (SEARCH_ASK.test(said)) return true;
  // "yes" to "Want me to search for that?"
  if (said.trim().length > 20 || /^\s*continue\b/i.test(said)) return false;
  const offer = [...history].reverse().find((t) => t.role === "assistant")?.content ?? "";
  return /\b(?:search|look (?:it |that )?up)\b/i.test(offer) && /\?\s*$/.test(offer.trim());
}

const SEARCHES = /search/i;
const READS = /^(?:read_page|web_extract|web_fetch|fetch|browser_navigate|browser_open)$/i;
const FAILED = (t: string) => !t.trim() || /^\s*(?:error\b|no results\b)|"result"\s*:\s*"(?:error\b|no results\b)/i.test(t);
const LINK = /https?:\/\/[^\s<>"'`)\]]+/g;

// one form for a link wherever it was seen: no "www.", no fragment, no trailing slash or full stop
function norm(u: string): { host: string; path: string } | null {
  try {
    const x = new URL(u.replace(/[.,;:!?]+$/, ""));
    return { host: x.hostname.toLowerCase().replace(/^www\./, ""), path: (x.pathname.replace(/\/+$/, "") + x.search).toLowerCase() };
  } catch { return null; }
}

export interface Grounding { reply: string; searched: boolean; found: boolean; removed: number; noted: boolean }

// calls: this turn's tool calls; seen: what the person and earlier turns already gave (their links stand);
// canSearch: false for the model alone with no search tool, which is not offered a search it cannot run
export function ground(reply: string, calls: ToolCall[], asked: boolean, seen: string[] = [], canSearch = true): Grounding {
  const searches = calls.filter((c) => SEARCHES.test(c.name)), reads = calls.filter((c) => READS.test(c.name));
  const searched = searches.length > 0;
  const good = [...searches, ...reads].filter((c) => !FAILED(c.text));
  const known = [...good.map((c) => c.text), ...seen].flatMap((t) => t.match(LINK) ?? []).map(norm).filter((x) => !!x);
  // a link counts when a search or page gave it, or it is the start of one ("nobelprize.org" for a page on it)
  const real = (u: string) => {
    const n = norm(u);
    return !!n && known.some((k) => k!.host === n.host && (k!.path === n.path || k!.path.startsWith(`${n.path}/`) || n.path === ""));
  };
  let removed = 0;
  let out = reply
    .replace(/\[([^\]\n]*)\]\((https?:\/\/[^\s)]+)\)/g, (m, text: string, url: string) => (real(url) ? m : (removed++, text)))
    .replace(LINK, (url) => (real(url) ? url : (removed++, "")));
  const found = good.length > 0;
  // no search ran, or it found nothing: a sentence saying it searched is not true
  if (!found) out = out.split("\n").map((line) => line.split(/(?<=[.!?])\s+/).filter((x) => !CLAIMS.test(x)).join(" ")).join("\n");
  // what a taken-out link leaves: an empty bullet, a bare "Sources:", "()"
  out = out.replace(/^[ \t]*[-*•][ \t]*$/gm, "").replace(/[ \t]*\((?:\s*(?:source|link)s?:?\s*)?\)/gi, "")
    .replace(/^[ \t]*(?:sources?|links?)[ \t]*:?[ \t]*$(?![\s\S]*?^[ \t]*[-*•]?[ \t]*\S)/gim, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const noted = asked && !found;
  if (!noted && !removed && out === reply.trim()) return { reply, searched, found, removed, noted };
  const why = !searched ? "I didn't search the web for this"
    : searches.some((c) => /no results/i.test(c.text)) ? "The web search found nothing for this" : "The web search didn't work this time";
  const head = !noted ? "" : !canSearch
    ? (out ? "I can't search the web from here, so this is from what I already know, not checked against any source, and may be wrong or out of date."
      : "I can't search the web from here, so I have no checked answer.")
    : out
    ? `${why}, so this is not checked against any source and may be wrong or out of date. Want me to try the search again?`
    : `${why}, so I have no checked answer. Want me to try the search again?`;
  const tail = removed ? `I took out ${removed === 1 ? "a link" : `${removed} links`} that did not come from a search.` : "";
  return { reply: [head, out, tail].filter(Boolean).join("\n\n"), searched, found, removed, noted };
}

// "I searched the web", "according to my search", "I looked it up": said only after a search found something
export const claimsSearch = (reply: string): boolean => CLAIMS.test(reply);
const CLAIMS = /\b(?:I(?:'ve| have)?\s+(?:just\s+)?(?:searched|googled|looked\s+(?:it\s+|this\s+|that\s+)?up|browsed|checked\s+(?:online|the\s+web|the\s+internet))|(?:according\s+to|based\s+on|from)\s+(?:my|the)\s+(?:web\s+)?(?:search(?:es)?|research)|(?:my|a\s+quick)\s+(?:web\s+)?search\s+(?:shows|found|turned\s+up|returned))\b/i;
