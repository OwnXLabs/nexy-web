// Where routines are off for a visitor (src/lib/box.ts), an ask for something to run later is
// answered with a plain sentence. What counts as one, and what is an ordinary question.
// node --experimental-strip-types --test tests/routine-ask.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { routineAsk } from "../src/lib/routine-ask.ts";

test("asks for something to run later", () => {
  for (const t of ["remind me every day at 8 to count the stock", "Give me a news brief every morning", "Send me a summary on Telegram every morning",
    "Every weekday at 7am, give me a morning brief of coffee news", "Email me the sales every Monday at 9", "when an email arrives from acme.com, summarise it",
    "Set up a reminder for my dentist", "remind me to call mum tomorrow", "daily at 6pm check the shop orders"])
    assert.equal(routineAsk(t), true, t);
});

test("ordinary questions that only mention a day or a habit", () => {
  for (const t of ["Tell me about the daily standup format", "Tell me what to do every day to stay fit", "What happens every day at the market?",
    "How do I take vitamins daily", "Research my top 5 competitors", "what do you remember", ""])
    assert.equal(routineAsk(t), false, t);
});
