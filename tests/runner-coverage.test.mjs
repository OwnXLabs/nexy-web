// Every test file in tests/ runs in tests/run.sh, or is listed here with the reason it does not.
// A file that no runner runs passes nothing and fails nothing, and nobody notices.
// node --test tests/runner-coverage.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
// file: why run.sh does not run it
const NOT_RUN = {};

const runner = readFileSync(join(DIR, "run.sh"), "utf8").split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
const isTest = (f) => /\.(cjs|mjs)$/.test(f) || f.endsWith(".test.ts");
const files = readdirSync(DIR).filter(isTest);
const runs = (f) => new RegExp(`tests/${f.replace(/[.]/g, "\\.")}\\b`).test(runner);

test("every test file is run by tests/run.sh or listed with a reason", () => {
  const missing = files.filter((f) => !runs(f) && !NOT_RUN[f]);
  assert.deepEqual(missing, [], `never run: ${missing.join(", ")}. Add each to tests/run.sh, or to NOT_RUN with why`);
});

test("the list of files not run is current: each exists, has a reason and is still not run", () => {
  for (const [f, why] of Object.entries(NOT_RUN)) {
    assert.ok(files.includes(f), `${f} is listed but does not exist`);
    assert.ok(String(why).trim().length > 10, `${f} needs a reason`);
    assert.ok(!runs(f), `${f} is run now; take it off the list`);
  }
});

test("the check sees a file only in a comment as not run (it is not passing vacuously)", () => {
  assert.equal(new RegExp("tests/x\\.cjs\\b").test("# tests/x.cjs".split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")), false);
  assert.ok(files.length > 50, `only ${files.length} test files found`);
});
