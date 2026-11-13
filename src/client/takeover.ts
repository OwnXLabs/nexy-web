// The agent asks the person for one step (a password, a code, a CAPTCHA) by ending its reply with
// [[take-control: what they need to do]]. The marker never reaches the screen: the reply shows
// without it and the step becomes a Take control button.
import { dropPseudoCalls } from "../lib/pseudo-calls.ts";

// a reply cut off mid-marker ends without the closing brackets; it is still the marker
const MARK = /\[\[take-control:\s*([^\]\n]+)(?:\]\]|\s*$)/i;
const ALL = /\s*\[\[take-control:[^\]\n]*(?:\]\]|\s*$)/gi;

export function takeoverAsk(raw: string): { answer: string; ask?: string } {
  // any other tool call written as text goes, so a reply of only that is no answer
  const said = dropPseudoCalls(raw);
  // an empty marker still means the agent needs the person, just without saying for what
  const marked = /\[\[take-control:/i.test(said);
  const step = MARK.exec(said)?.[1]?.trim().slice(0, 200);
  // a model that echoes the instruction's own wording asked for "what they need to do": say it plainly
  const ask = (step && !/^what (they|you) need to do\.?$/i.test(step) ? step : undefined) || (marked ? "do the step shown on the agent's screen" : undefined);
  // never an empty reply: that reads as the model failing. The step itself is on the Take control
  // card under the reply, so the reply does not repeat it.
  const answer = said.replace(ALL, "").trim() || (ask ? "I need you for one step on my screen." : said.trim());
  return ask ? { answer, ask } : { answer };
}
