// How requests are routed: a build, which kind of build, or chat. 350 requests in three sets:
// "matrix" (written beside the classifier), "blind-1" and "blind-2" (written without seeing it;
// blind-2 was scored once, after the rules were final). The floors are the scores at that point:
// a change may raise them, never lower them.
//   node --experimental-strip-types --test tests/intent-requests.test.ts   (REPORT=1 lists misses)
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clientModule } from "./client-module.ts";

const I = await clientModule("src/client/intent.ts");
const { gameBrief, buildKind } = await clientModule("src/client/capability.ts");
type Case = { set: string; text: string; want: string; page_open?: boolean; indirect?: boolean };
const CASES: Case[] = JSON.parse(readFileSync(new URL("./fixtures/intent-requests.json", import.meta.url), "utf8"));
const CHATLIKE = new Set(["chat", "research", "summarise", "routine"]);

// what the page would run, as nexy.ts routes it (an edit first when a page is open)
function category(text: string, pageOpen = false): string {
  const i = I.classify(text);
  if (pageOpen && (i.kind === "edit" || I.asksToChangePage(text, i.kind))) return "edit";
  if (i.kind === "make") return i.deliverable === "diagram" ? "diagram" : gameBrief(i.brief) ? "game" : "website";
  return ({ build: "project", generate: "image", customRebuild: "website", chat: "chat" } as Record<string, string>)[i.kind] ?? `app:${i.kind}`;
}

function score(set: string) {
  const s = { right: 0, all: 0, builds: 0, found: 0, routed: 0, routedRight: 0, misses: [] as string[] };
  for (const c of CASES.filter((x) => x.set === set)) {
    const want = CHATLIKE.has(c.want) ? "chat" : c.want, got = category(c.text, c.page_open);
    const isBuild = want === "website" || want === "game", gotBuild = got === "website" || got === "game";
    s.all++; s.right += +(got === want);
    if (isBuild) { s.builds++; s.found += +gotBuild; }
    if (gotBuild) { s.routed++; s.routedRight += +isBuild; }
    if (got !== want) s.misses.push(`${want} -> ${got}: ${c.text}`);
  }
  if (process.env.REPORT) console.log(`${set}: ${s.right}/${s.all} right, builds found ${s.found}/${s.builds}, builds routed right ${s.routedRight}/${s.routed}\n  ${s.misses.join("\n  ")}`);
  return s;
}

const FLOORS: Record<string, { right: number; found: number; wrongBuilds: number }> = {
  "matrix": { right: 129, found: 54, wrongBuilds: 1 },
  "blind-1": { right: 94, found: 49, wrongBuilds: 1 },
  "blind-2": { right: 74, found: 30, wrongBuilds: 1 },
};
for (const [set, f] of Object.entries(FLOORS)) {
  test(`${set}: at least ${f.right} routed right, ${f.found} builds found, at most ${f.wrongBuilds} non-build built`, () => {
    const s = score(set);
    assert.ok(s.right >= f.right, `${s.right} right:\n${s.misses.join("\n")}`);
    assert.ok(s.found >= f.found, `${s.found} builds found`);
    assert.ok(s.routed - s.routedRight <= f.wrongBuilds, `${s.routed - s.routedRight} non-builds built:\n${s.misses.join("\n")}`);
  });
}

test("a game asked for by name or kind is built as a game", () => {
  for (const t of ["make street fighter", "build a zombie shooter", "sudoku please", "make an endless runner like subway surfers", "chess i can play against the computer"]) {
    assert.equal(category(t), "game", t);
  }
});

test("a site about games is a site, on the card and in the check alike", () => {
  for (const t of ["Build a simple landing website for a game developer", "build a website for a game studio", "a game developer's website", "landing page for my new game", "an online store selling board games"]) {
    assert.equal(buildKind(t), "site", t);
    assert.equal(gameBrief(t), false, t);
  }
  assert.equal(buildKind("make a quiz game"), "game");
  assert.equal(buildKind("build an app for chess clubs"), "app");
});

test("talk about games, shops and sites stays chat", () => {
  for (const t of ["chess openings for beginners", "street fighter characters", "my snake is sick what do I do", "I sold my shop for a profit",
    "remember my online shop is called Bloom", "give me tips to get better at chess", "list 10 game ideas for a game jam", "who invented tetris?",
    "set up a routine that summarises my inbox every evening", "explain what a flowchart is used for"]) {
    assert.equal(category(t), "chat", t);
  }
});
