// Which chat messages ask to read the owner's own connected app, and the words to search it for.
// Pure, so the browser uses it too: an explicit ask of a connected app is not switched to
// ultra-private, which turns connected apps off.
export interface ConnectorAsk { id: "gmail" | "drive"; ids: readonly string[]; label: string; tool: string; args: { query: string } }

const APPS = [
  { id: "gmail", ids: ["gmail", "gmail-imap"], label: "Gmail", tool: "gmail_search", re: /\b(?:in\s+|from\s+|on\s+|through\s+)?(?:my\s+)?(?:g-?mail|inbox|e-?mails?|mail(?:box)?)\b/gi, mine: /\b(?:my\s+(?:(?:latest|newest|last|recent|new|unread)\s+)?(?:g-?mail|inbox|e-?mails?|mail(?:box)?)|g-?mail|(?:any|new|unread)\s+e-?mails?)\b/i },
  { id: "drive", ids: ["drive"], label: "Google Drive", tool: "drive_search", re: /\b(?:in\s+|from\s+|on\s+|through\s+)?(?:my\s+)?(?:google\s+)?drive\b/gi, mine: /\b(?:my\s+(?:google\s+)?drive|google\s+drive)\b/i },
] as const;
// asking to write, send or (dis)connect is not reading; a lookup says so
const LOOKUP = /\b(?:search|find|look|check|show|list|read|summari[sz]e|any|anything|latest|newest|recent|unread|is there|are there|what(?:'s|s| is| are)?\s+(?:in|new|on)|do i have|did i get|have i got)\b/i;
const NOT_READING = /^\s*(?:please\s+)?(?:write|draft|compose|send|reply|forward|connect|disconnect|link|unlink|revoke|remove|delete)\b/i;
// "when a new email arrives from Acme, summarise it" asks for a routine on that event, not a lookup now
const ON_EVENT = /^\s*(?:please\s+)?(?:when|whenever|each time|every time)\b.*\b(?:arrives?|comes? in|lands?|(?:is|gets?) (?:added|saved|uploaded|dropped)|e-?mails? me|sends? me)\b/i;
// words of the request, not of what to find: the hub looks for every word it is sent
const FILLER = /\b(?:please|can|could|would|will|you|search|find|look|through|up|check|show|list|get|read|open|summari[sz]e|tell|what(?:'s|s)?|when|where|which|that|this|it|there|is|are|was|were|any|anything|do|did|does|i|have|has|had|got|me|the|a|an|my|all|latest|newest|recent|new|unread|last|emails?|e-mails?|mails?|mailbox|inbox|g-?mail|messages?|files?|docs?|documents?|for|about|mentioning|called|named|titled|regarding|in|on|from|to|with|of|and|or|then|also|say|says|said|saying|sent|wrote|his|her|their|one)\b/gi;

export function connectorAsk(text: string): ConnectorAsk | null {
  const s = text.trim();
  if (!s || s.length > 300 || NOT_READING.test(s) || ON_EVENT.test(s) || !LOOKUP.test(s)) return null;
  const app = APPS.find((a) => a.mine.test(s));
  if (!app) return null;
  const query = s.replace(app.re, " ").replace(/['’]s\b/gi, "").replace(/[?!.,;:"“”'’…]/g, " ").replace(FILLER, " ").replace(/\s+/g, " ").trim().slice(0, 120);
  return { id: app.id, ids: app.ids, label: app.label, tool: app.tool, args: { query } };
}
