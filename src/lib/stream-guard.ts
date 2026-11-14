import { guardIdentity } from "./engine/identity-guard";

// What of a reply still being written may be shown: finished sentences after the identity guard,
// plus the sentence in progress only while it holds nothing the guard might rewrite. An engine that
// speaks as itself (self) is shown as written; its failures are held back like any other's.
const RISKY = /hermes|nous|router|llama|swap|agent-browser|api_server|soul|\/p\/|127\.0\.0\.1|localhost|[a-z]_[a-z]|\[|https?:|\/var\/|qwen|gemma|mistral|mixtral|deepseek|phi-?\d|openvino|openclaw|ironclaw|langchain|gpt-|claude|system prompt|environment block|config|provider/i;
const FAULT = "API call failed";
// how an engine words its own failure as a reply; the turn's end decides, so show nothing meanwhile
const FAULTISH = /\/retry\b|\/model\b|rate.?limit|\b429\b|too many requests|provider (?:error|authentication)|upstream (?:failed|error)/i;

// a whole reply that is an engine's failure ("API call failed after 3 retries: …", "⚠ Provider
// authentication failed: /var/lib/…"): never shown, whichever engine wrote it
export const faultReply = (reply: string): boolean => /^\s*⚠/.test(reply) || /^\s*API call failed after \d+ retr/.test(reply);

// engines word their failures as short replies, so a reply shows once it is longer than one
const HOLD = 160;

export function visible(raw: string, self = false): string {
  if (raw.length < HOLD) return "";
  const head = raw.trimStart();
  if (head.startsWith("⚠") || head.startsWith(FAULT) || FAULTISH.test(raw)) return "";
  if (self) return raw;
  let cut = -1;
  for (const m of raw.matchAll(/[.!?](?=\s)|\n/g)) cut = m.index! + 1;
  const done = cut > 0 ? guardIdentity(raw.slice(0, cut)).reply : "";
  const tail = raw.slice(Math.max(cut, 0));
  return RISKY.test(tail) ? done : done + tail;
}
