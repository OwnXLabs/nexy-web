// A routine's trigger in plain words: what starts it ("When an email arrives from …") and its
// short chip ("Email from Acme"). Read the way the agent reads triggers; anything else is quoted
// as it is, for the page to escape.
// node --experimental-strip-types --test tests/trigger-words.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientModule } from "./client-module.ts";

const { parseTrigger, triggerText, triggerChip, senderName } = await clientModule("src/client/triggers.ts");
const { scheduleChip } = await clientModule("src/client/memory.ts");

test("mail and file triggers read as plain words", () => {
  const cases: [string, string, string][] = [
    ["mail from=billing@acme.example", "an email arrives from billing@acme.example", "Email from Acme"],
    ["Mail From=Billing@Acme.co.uk", "an email arrives from Billing@Acme.co.uk", "Email from Acme"],
    ['mail subject="Invoice due"', "an email arrives with the subject “Invoice due”", "Email “Invoice due”"],
    ['mail from=sam@gmail.example subject="Lunch"', "an email arrives from sam@gmail.example with the subject “Lunch”", "Email from sam@gmail.example"],
    ["mail", "an email arrives", "Any email"],
    ['file folder="Invoices 2026"', "a file is added to the “Invoices 2026” folder", "File in Invoices 2026"],
    ['file folder=Receipts name=a.pdf', "a file named “a.pdf” is added to the “Receipts” folder", "File in Receipts"],
    ["mail from=a@b.com label=urgent", "an email arrives from a@b.com where label is “urgent”", "Email from B"],
    ["calendar title=standup", "an event arrives from “calendar” where title is “standup”", "Event from calendar"],
  ];
  for (const [spec, text, chip] of cases) {
    assert.equal(triggerText(spec), text, spec);
    assert.equal(triggerChip(spec), chip, spec);
  }
});

test("what the agent would refuse is quoted as it is, never read as fields", () => {
  for (const spec of ['mail from="open', "Mail!! from=x", "mail from=", "mail =x", ""]) assert.equal(parseTrigger(spec), null, spec);
  assert.equal(triggerText('mail from="<b>x'), "this event arrives: “mail from=\"<b>x”");
  assert.equal(triggerChip('mail from="<b>x'), "Event");
  // markup stays in the words: the page escapes it, these functions never build HTML
  assert.equal(triggerText("mail from=<img/src=x>"), "an email arrives from <img/src=x>");
  assert.equal(senderName("<img/src=x>"), "<img/src=x>");
  assert.equal(triggerChip(`file folder="${"x".repeat(60)}"`), `File in ${"x".repeat(39)}…`);
});

test("schedules as chips", () => {
  assert.equal(scheduleChip("30 7 * * 1-5"), "Weekdays 7:30 am");
  assert.equal(scheduleChip("0 18 * * *"), "Daily 6:00 pm");
  assert.equal(scheduleChip("daily 08:00"), "Daily 8:00 am");
  assert.equal(scheduleChip("every 2h"), "Every 2 hours");
  assert.equal(scheduleChip("0 9 1 * *"), "0 9 1 * *");
});
