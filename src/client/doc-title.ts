// The name of a document an answer goes into, from the question: what it is about, cut on a word.
// "write a detailed 1500 word guide…" was titled "write a detailed 1500 word g" (QA 2026-11-12).
const ASKING = /^(?:(?:hey\s+)?nexy[,\s]+)?(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:(?:write|draft|create|make|give|prepare|produce|put together|compose|generate)\s+(?:me\s+|us\s+)?)?/i;
const SIZE = /^(?:(?:an?|the|some)\s+)?(?:(?:very|really|quite|short|long|detailed|full|complete|thorough|comprehensive|quick|brief|simple|in-depth|step-by-step|\d[\d,]*(?:\s*|-)(?:words?|pages?|paragraphs?)|one|two|three|four|five)[\s,]+)*/i;

export function slugOf(question: string, max = 28): string {
  const about = question.trim().replace(ASKING, "").replace(SIZE, "");
  const words = (about || question).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
  let out = "";
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > max) break;
    out = next;
  }
  // a name never ends on "a", "to" or "of"; a first word longer than the room is cut, rather than no name
  out = out.replace(/(?:-(?:a|an|the|to|of|for|and|or|on|in|at|with|my|our|your))+$/, "");
  return out || words[0]?.slice(0, max) || "answer";
}
