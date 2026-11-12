// Which chat messages ask to read the owner's own connected app, and the words to search it for.
// Pure, so the browser uses it too: an explicit ask of a connected app is not switched to
// ultra-private, which turns connected apps off.
// full: read the whole message (gmail_read) where the hub has it, not only the search rows
export interface ConnectorAsk { id: "gmail" | "drive"; ids: readonly string[]; label: string; tool: string; readTool: string; args: { query: string }; full?: boolean }
export interface AskTurn { role: string; content: string }

const APPS = [
  { id: "gmail", ids: ["gmail", "gmail-imap"], label: "Gmail", tool: "gmail_search", readTool: "gmail_read", re: /\b(?:in\s+|from\s+|on\s+|through\s+)?(?:my\s+)?(?:g-?mail|inbox|e-?mails?|mail(?:box)?)\b/gi, mine: /\b(?:my\s+(?:(?:latest|newest|last|recent|new|unread)\s+)?(?:g-?mail|inbox|e-?mails?|mail(?:box)?)|g-?mail|(?:any|new|unread)\s+e-?mails?)\b/i },
  { id: "drive", ids: ["drive"], label: "Google Drive", tool: "drive_search", readTool: "drive_read", re: /\b(?:in\s+|from\s+|on\s+|through\s+)?(?:my\s+)?(?:google\s+)?drive\b/gi, mine: /\b(?:my\s+(?:google\s+)?drive|google\s+drive)\b/i },
] as const;
// asking to write, send or (dis)connect is not reading; a lookup says so
const LOOKUP = /\b(?:search|find|look|check|show|list|read|summari[sz]e|any|anything|latest|newest|recent|unread|is there|are there|what(?:'s|s| is| are)?\s+(?:in|new|on)|do i have|did i get|have i got)\b/i;
const NOT_READING = /^\s*(?:please\s+)?(?:write|draft|compose|send|reply|forward|connect|disconnect|link|unlink|revoke|remove|delete)\b/i;
// "when a new email arrives from Acme, summarise it" asks for a routine on that event, not a lookup now
const ON_EVENT = /^\s*(?:please\s+)?(?:when|whenever|each time|every time)\b.*\b(?:arrives?|comes? in|lands?|(?:is|gets?) (?:added|saved|uploaded|dropped)|e-?mails? me|sends? me)\b/i;
// words of the request, not of what to find: the hub looks for every word it is sent
const FILLER = /\b(?:please|can|could|would|will|you|search|find|look|through|up|check|show|list|get|read|open|summari[sz]e|tell|what(?:'s|s)?|when|where|which|that|this|it|there|is|are|was|were|any|anything|do|did|does|i|have|has|had|got|me|the|a|an|my|all|latest|newest|recent|new|unread|last|emails?|e-mails?|mails?|mailbox|inbox|g-?mail|messages?|files?|docs?|documents?|for|about|mentioning|called|named|titled|regarding|in|on|from|to|with|of|and|or|then|also|say|says|said|saying|sent|wrote|his|her|their|one)\b/gi;

// a follow-up about mail just read: "that Acme email", "the Invoice 4471 email", "the full text", "open it"
const REFERS = /\b(?:th(?:at|is|e)\s+(?:[\p{L}\p{N}'’&-]+\s+){0,6}e-?mails?|(?:that|this|the)\s+(?:message|one)|full\s+(?:text|message|e-?mail|body|thing)|whole\s+(?:text|message|e-?mail|thing)|(?:open|read)\s+(?:me\s+)?(?:it|that|this)\b|what\s+(?:does|did)\s+(?:it|that|this)\s+say)/iu;
const FULL = /\b(?:full|whole|entire|complete)\s+(?:text|message|e-?mail|body|thing)\b/i;
// words of a follow-up that name no email
const FOLLOW = /\b(?:full|whole|entire|complete|text|body|contents?|exact|words?|now|please|again|thing)\b/gi;

const words = (s: string, app: (typeof APPS)[number]) =>
  s.replace(app.re, " ").replace(/['’]s\b/gi, "").replace(/[?!.,;:"“”'’…]/g, " ").replace(FILLER, " ").replace(FOLLOW, " ").replace(/\s+/g, " ").trim().slice(0, 120);
const askOf = (app: (typeof APPS)[number], query: string, full: boolean): ConnectorAsk =>
  ({ id: app.id, ids: app.ids, label: app.label, tool: app.tool, readTool: app.readTool, args: { query }, ...(full ? { full } : {}) });

function firstAsk(s: string): ConnectorAsk | null {
  if (!LOOKUP.test(s)) return null;
  const app = APPS.find((a) => a.mine.test(s));
  return app ? askOf(app, words(s, app), FULL.test(s)) : null;
}

/** A lookup in a connected app, or a follow-up about mail an earlier turn of this chat read. */
export function connectorAsk(text: string, history: readonly AskTurn[] = []): ConnectorAsk | null {
  const s = text.trim();
  if (!s || s.length > 300 || NOT_READING.test(s) || ON_EVENT.test(s)) return null;
  const ask = firstAsk(s);
  if (ask || !REFERS.test(s)) return ask;
  // the mail ask it follows: the owner's last messages, back to it, are all about that mail
  let prior: ConnectorAsk | null = null;
  for (const t of history.filter((t) => t.role === "user").slice(-4).reverse()) {
    const u = String(t.content ?? "").trim();
    if (!u || u.length > 300 || NOT_READING.test(u) || ON_EVENT.test(u)) return null;
    prior = firstAsk(u);
    if (prior || !REFERS.test(u)) break;
  }
  if (prior?.id !== "gmail") return null;
  return askOf(APPS[0], words(s, APPS[0]) || prior.args.query, true);
}

// "when an email arrives from X, <task>": a routine on that event, whatever the task asks for
const EVENT_SOURCE = /\b(?:e-?mails?|mail|inbox|g-?mail|messages?|files?|folders?|drive|documents?|docs?)\b/i;
export const eventAsk = (text: string): boolean => { const s = text.trim(); return s.length <= 400 && ON_EVENT.test(s) && EVENT_SOURCE.test(s); };
