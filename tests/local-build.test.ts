// The checks a page built on this computer must pass before it is shown.
// node --experimental-strip-types --test tests/local-build.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { checkPage, names, offline, pageFrom, promptFor, topicWords } from "../src/lib/local-build.ts";

const page = (body: string) => `<!doctype html><html><head><title>x</title></head><body>${body}</body></html>`;

test("names come from the brief as written", () => {
  assert.deepEqual(names("build me a website for a flower shop called Petal & Stem"), ["Petal & Stem"]);
  assert.deepEqual(names("make a website for my bakery called Crumb & Co."), ["Crumb & Co"]);
  assert.deepEqual(names('a landing page named "Bean Box" for coffee'), ["Bean Box"]);
  assert.deepEqual(names("build me a todo app"), []);
});

test("the subject skips filler words", () => {
  assert.deepEqual(topicWords("build me a website for a ping pong ball business"), ["ping", "pong", "ball"]);
  assert.deepEqual(topicWords("build me a pricing page with three plans"), ["pricing", "plans"]);
  assert.deepEqual(topicWords("make me a pong game"), ["pong"]);
});

test("a page that leaves out the name, or the subject, or calls out, is refused", () => {
  const generic = page("<h1>Trusted by forward-thinking teams</h1><p>CTO, Nexus Dynamics</p>".repeat(3));
  assert.match(checkPage(generic, "build me a website for a flower shop called Petal & Stem"), /left out the name "Petal & Stem"/);
  assert.equal(checkPage(page("<h1>Petal &amp; Stem</h1><p>Hand-tied bouquets.</p>".repeat(3)), "build me a website for a flower shop called Petal & Stem"), "");
  assert.match(checkPage(generic, "build me a website for a ping pong ball business"), /not about ping pong ball/);
  assert.equal(checkPage(page("<h1>Spin Balls</h1><p>Table tennis balls, 3-star ping pong grade.</p>".repeat(3)), "build me a website for a ping pong ball business"), "");
  assert.match(checkPage(page('<img src="https://cdn.example.com/a.png"><h1>Pong</h1>'.repeat(5)), "make me a pong game"), /outside the page/);
  assert.match(checkPage(page('<link rel="stylesheet" href="style.css"><h1>Pong</h1>'.repeat(5)), "make me a pong game"), /outside the page/);
  assert.equal(checkPage(page('<a href="https://example.com">Pong</a><img src="data:image/png;base64,AA">'.repeat(5)), "make me a pong game"), "");
  assert.match(checkPage("ok", "make me a pong game"), /wrote no page/);
});

test("the page is the last .html the model wrote, and it cannot load anything", () => {
  const rec = (path: string, content: string, result = `wrote ${path}`) => ({ role: "tool", tool_name: "write_file", content: JSON.stringify({ args: { path, content }, result }) });
  assert.equal(pageFrom([rec("index.html", "A"), rec("notes.txt", "B"), rec("index.html", "C"), rec("x.html", "D", "error: denied")], ""), "C");
  assert.equal(pageFrom([], "Here:\n```html\n<!doctype html><html></html>\n```"), "<!doctype html><html></html>");
  assert.match(offline("<html><head><title>t</title></head></html>"), /<head><meta http-equiv="Content-Security-Policy" content="default-src 'none'/);
});

test("the prompt carries the names, the fix and the file", () => {
  const p = promptFor("build me a website for a flower shop called Petal & Stem", 'it left out the name "Petal & Stem"');
  assert.match(p, /"Petal & Stem" written as given/);
  assert.match(p, /did not pass a check: it left out the name/);
  assert.match(p, /Save it as index\.html\.$/);
  assert.match(promptFor("make me a pong game"), /start screen/);
  assert.match(p, /Never invent an address, phone number[^.]*years in business, awards[^.]*claims; [^.]*\[Your address\]/, "no made-up facts");
  assert.doesNotMatch(promptFor("build me a website for a ping pong ball business"), /start screen/);
});
