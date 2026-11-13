import { eventAsk } from "./connector-ask.ts";

// Whole-box features off for this visitor (src/lib/box.ts): what they hear instead, in plain words
export const ROUTINES_ELSEWHERE = "Routines need your own Nexy. Here I can help with things right now, but I can't set anything to run later or on its own.";
export const MEMORY_ELSEWHERE = "Seeing or clearing what Nexy remembers across chats needs your own Nexy.";

const SPAN = String.raw`(?:(?:every|each)\s+(?:day|morning|evening|night|weekday|weekend|week|month|hour|minute|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+\s+(?:minutes?|hours?|days?|weeks?))|daily|hourly|weekly|monthly)`;
const WHEN = new RegExp(String.raw`\b${SPAN}\b`, "i");
// the schedule leads ("every weekday at 7, …"), ends the ask ("… every morning") or names a time
const LEADS = new RegExp(String.raw`^(?:please\s+)?${SPAN}\b`, "i");
const TAIL = new RegExp(String.raw`\b${SPAN}(?:\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?)?\s*[.!?]?$|\b${SPAN}\s+at\s+\d`, "i");
const ASKS = /^(?:please\s+)?(?:(?:can|could|will|would) you\s+)?(?:remind|send|give|tell|email|text|message|check|summari[sz]e|run|post|notify|alert|ping|make|create|set|schedule|book)\b/i;

/** A request for something to run later: on a schedule, a reminder, or on an email or file arriving. */
export function routineAsk(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 400) return false;
  if (eventAsk(t)) return true;
  if (/^(?:please\s+)?(?:(?:can|could) you\s+)?(?:set up|create|make|add|schedule)\s+(?:me\s+)?(?:a|an|my)?\s*(?:routine|reminder)\b/i.test(t)) return true;
  if (/\bremind me\b/i.test(t) && (WHEN.test(t) || /\b(?:at \d|tomorrow|tonight|in \d+ (?:minutes?|hours?|days?))\b/i.test(t))) return true;
  return LEADS.test(t) || (TAIL.test(t) && ASKS.test(t));
}
