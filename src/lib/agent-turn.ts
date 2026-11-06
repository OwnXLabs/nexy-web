// How long the agent gets for a turn, and what of its reply reaches the person.
import { createHash } from "node:crypto";

// one agent session per chat, so its browser keeps the page between turns. The chat id comes
// from the browser and is guessable, so the key also binds the caller and their demo sign-in:
// nobody can name another visitor's chat and load its history.
export function agentSessionKey(who: string, sid: string | undefined, chat: unknown): string | undefined {
  if (typeof chat !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(chat)) return undefined;
  return createHash("sha256").update(`${who}\n${sid ?? ""}\n${chat}`).digest("hex").slice(0, 32);
}

// Research (search, read pages, cite sources) takes longer than a chat turn: at 90 s a "give me
// the links" follow-up timed out every time (2026-10-22).
const RESEARCH = /\b(search|research|look(?:ing)? up|google|latest|news|today|this week|current(?:ly)?|recent(?:ly)?|right now|sources?|links?|urls?|citations?|cite|internet|online|web|prices?|how much (?:is|does|are))\b/i;
// opening a page is the slowest thing the agent does
const BROWSING = /\b(open|pull (?:it |that |them )?up|browser|screen|web ?page|website|site|page|go to|visit|dig deeper|look into)\b/i;

// A short answer to an offer ("yes", "go on") carries the offer's weight: on 2026-10-28 "yes" to
// "Want me to pull up the Yahoo Finance page?" got the 90 s chat budget while the agent loaded it.
export function wantsResearch(said: string, history: { role: string; content: string }[]): boolean {
  if (RESEARCH.test(said) || BROWSING.test(said)) return true;
  if (said.trim().length > 40) return false;
  const offer = [...history].reverse().find((t) => t.role === "assistant")?.content ?? "";
  return RESEARCH.test(offer) || BROWSING.test(offer);
}

// The model answering alone, without tools, after the agent timed out. It was told not to deny
// its tools and on 2026-10-28 did anyway: "I cannot browse live internet data… the previous
// figures were illustrative sample data", about figures the agent had just found.
const DENIES = /\b(?:cannot|can ?not|can't|unable to|do not have|don't have|no)\b[^.\n]{0,40}\b(?:browse|browsing|internet|real-time|live data|web access|access to (?:the )?(?:web|internet))\b|\billustrative\b|\bsample data\b/i;
export const deniesTools = (reply: string): boolean => DENIES.test(reply);

// The agent sometimes pastes a screenshot into its reply as a base64 data: image. Typed out by a
// model it is thousands of characters of noise, never a picture (2026-10-28: the chat showed raw
// base64 and the long reply was moved into an empty document). The page is on its screen.
const INLINE_IMAGE = /!\[[^\]\n]*\]\(\s*data:[^)]*(?:\)|$)|data:image\/[a-z+]+;base64,[A-Za-z0-9+/=\s]{40,}/gi;
export function dropInlineImages(reply: string, browsed: boolean): string {
  const left = reply.replace(INLINE_IMAGE, "").replace(/\n{3,}/g, "\n\n").trim();
  if (left === reply.trim()) return reply;
  if (left) return left;
  return browsed
    ? "It's open on my screen, on the right, where you can watch it."
    : "I can't put pictures in the chat. Ask me to open the page and you can watch it on my screen.";
}
