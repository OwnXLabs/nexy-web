// A table's total is checked only against the rows of the same table, in its own column, just
// above it. 0.2.8 read two tables as one, "corrected" Total Cost from 9 to 24 by adding in the
// selling price, and told the person the model was wrong.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientModule } from "./client-module.ts";

const { checkTotals, fromReply } = await clientModule("src/client/content-view.ts");

// the reply QA saw: a cost table, then a worked example with the selling price above the costs
const QA = `### Step 2: Calculate the Total Cost per Pack

| Cost Component | Example Amount (₱) |
|---|---|
| Raw materials | 5.00 |
| Labor | 1.50 |
| Packaging | 1.00 |
| Overhead (utilities, rent, etc.) | 1.50 |
| **Total Cost** | **9.00** |

## Worked Example Summary Table

| Item | Amount (₱) |
|---|---|
| Selling Price | 15.00 |
| Raw Materials | 5.00 |
| Labor | 1.50 |
| Packaging | 1.00 |
| Overhead | 1.50 |
| **Total Cost** | **9.00** |
| Profit | 6.00 |
| Profit Margin | 40% |
`;

test("two tables in one reply: neither total is touched, and nothing is said", () => {
  const l = fromReply(QA, "explain step by step how to")!;
  assert.ok(l, "the tables go to the pane");
  assert.equal(l.note, "The tables are on the right.");
  assert.doesNotMatch(l.note, /corrected|rows add to/);
  // two tables are two tables: not joined into one sheet whose total adds both (QA 2026-11-12)
  assert.equal(l.artifact.kind, "doc");
});

test("a total under a run of the rows above it is right as written", () => {
  const rows = [["Item", "Amount"], ["Selling Price", 15], ["Raw", 5], ["Labor", 1.5], ["Packaging", 1], ["Overhead", 1.5], ["Total Cost", 9]];
  assert.deepEqual(checkTotals(rows).fixes, []);
  assert.equal(checkTotals(rows).rows[6][1], 9);
});

test("a wrong total, last in a plain table of numbers, is corrected and said", () => {
  const { rows, fixes } = checkTotals([["Item", "Cost"], ["Rent", 100], ["Power", 40], ["Total", 150]]);
  assert.equal(rows[3][1], 140);
  assert.deepEqual(fixes, ["Total: the model wrote 150, the rows add to 140"]);
});

test("unclear shapes are left alone", () => {
  // the total is not the last row
  assert.deepEqual(checkTotals([["Item", "Cost"], ["Rent", 100], ["Power", 40], ["Total", 150], ["Profit", 10]]).fixes, []);
  // two totals in one table
  assert.deepEqual(checkTotals([["Item", "Cost"], ["Rent", 100], ["Total rent", 99], ["Power", 40], ["Total", 150]]).fixes, []);
  // a blank or a word in the column above
  assert.deepEqual(checkTotals([["Item", "Cost"], ["Rent", 100], ["Power", ""], ["Water", 5], ["Total", 150]]).fixes, []);
  assert.deepEqual(checkTotals([["Item", "Share"], ["Rent", 100], ["Margin", "40%"], ["Total", 150]]).fixes, []);
});

test("a wrong total in the second of two tables is checked against its own rows only", () => {
  const reply = "| A | Cost |\n|---|---|\n| x | 1 |\n| y | 2 |\n| Total | 3 |\n\nThen:\n\n| B | Cost |\n|---|---|\n| p | 10 |\n| q | 20 |\n| Total | 35 |\n";
  const l = fromReply(reply, "costs")!;
  assert.match(l.note, /Check this total: Total: the model wrote 35, the rows add to 30\./);
});

test("one table still opens as a sheet", () => {
  const l = fromReply("| Item | Cost |\n|---|---|\n| Rent | 100 |\n| Power | 40 |\n", "costs")!;
  assert.equal(l.artifact.kind, "table");
});
