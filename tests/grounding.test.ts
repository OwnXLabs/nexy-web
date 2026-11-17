// Research answers against the searches that really ran (src/lib/grounding.ts). Stand-in replies
// shaped like the capability matrix's: a small model that names a winner and a link with no search,
// one that says "I searched the web" without searching, and a real search answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { ground, asksToSearch } from "../src/lib/grounding.ts";

const RESULT = JSON.stringify({ args: { query: "nobel prize literature 2025" }, result:
  "Nobel Prize in Literature 2025 - NobelPrize.org\nhttps://www.nobelprize.org/prizes/literature/2025/summary/\nLászló Krasznahorkai was awarded the 2025 Nobel Prize in Literature." });
const SEARCH = { name: "web_search", text: RESULT };
const ASK = "Who won the 2025 Nobel Prize in Literature? Search the web and give the link to your source.";

test("a made-up winner and link with no search: link out, said plainly, offered again", () => {
  const g = ground("The 2025 Nobel Prize in Literature went to Haruki Murakami. Source: https://www.nobelprize.org/prizes/literature/2025/murakami-facts", [], true);
  assert.equal(g.searched, false);
  assert.equal(g.removed, 1);
  assert.doesNotMatch(g.reply, /https?:/);
  assert.match(g.reply, /^I didn't search the web for this, so this is not checked against any source/);
  assert.match(g.reply, /try the search again\?/);
  assert.match(g.reply, /took out a link that did not come from a search/);
});

test("\"I searched the web\" with no search is taken out", () => {
  const g = ground("I searched the web and here is what I found. The winner was Jon Fosse. [Nobel site](https://nobel.example/2025)", [], true);
  assert.doesNotMatch(g.reply, /I searched/);
  assert.doesNotMatch(g.reply, /nobel\.example/);
  assert.match(g.reply, /Nobel site/);
  assert.match(g.reply, /I didn't search the web/);
});

test("a real search answer passes as it is", () => {
  const reply = "László Krasznahorkai won the 2025 Nobel Prize in Literature. I searched the web: https://www.nobelprize.org/prizes/literature/2025/summary/";
  const g = ground(reply, [SEARCH], true);
  assert.equal(g.reply, reply);
  assert.equal(g.found, true);
  assert.equal(g.removed, 0);
  // the site's own address, a page it gave, stands too
  assert.equal(ground("See https://nobelprize.org.", [SEARCH], true).removed, 0);
});

test("a searched answer with one invented link keeps the real one", () => {
  const g = ground("Krasznahorkai won.\n\nSources:\n- https://www.nobelprize.org/prizes/literature/2025/summary/\n- https://made-up.example/nobel", [SEARCH], true);
  assert.equal(g.removed, 1);
  assert.match(g.reply, /nobelprize\.org\/prizes\/literature\/2025\/summary/);
  assert.doesNotMatch(g.reply, /made-up/);
  assert.doesNotMatch(g.reply, /didn't search/);
  assert.doesNotMatch(g.reply, /^\s*-\s*$/m, "no empty bullet left behind");
});

test("a search that found nothing, or failed, is said so", () => {
  const none = ground("It was Jon Fosse.", [{ name: "web_search", text: JSON.stringify({ args: {}, result: "no results" }) }], true);
  assert.match(none.reply, /^The web search found nothing for this/);
  const broke = ground("It was Jon Fosse.", [{ name: "web_search", text: JSON.stringify({ args: {}, result: "error: search failed: timeout" }) }], true);
  assert.match(broke.reply, /^The web search didn't work this time/);
  // a page read counts as a source
  const page = ground("It says Krasznahorkai. https://a.example/x", [{ name: "read_page", text: JSON.stringify({ args: { url: "https://a.example/x" }, result: "Krasznahorkai…" }) }], true);
  assert.equal(page.reply, "It says Krasznahorkai. https://a.example/x");
});

test("links the person gave stand; an answer that was not asked to search is left alone", () => {
  assert.equal(ground("That page is https://my.example/menu", [], false, ["read https://my.example/menu"]).removed, 0);
  const plain = "A mortgage is a loan secured on a home.";
  assert.equal(ground(plain, [], false).reply, plain);
  // with nothing left once the false claim goes, it says there is no checked answer
  assert.match(ground("I searched the web and Jon Fosse won.", [], true).reply, /^I didn't search the web for this, so I have no checked answer/);
});

test("the model alone, with no search tool, says it can't search and offers none", () => {
  const g = ground("ownx.co sells home servers.", [], true, [], false);
  assert.match(g.reply, /^I can't search the web from here, so this is from what I already know/);
  assert.doesNotMatch(g.reply, /try the search again/);
});

test("which questions ask for a search", () => {
  assert.equal(asksToSearch(ASK), true);
  assert.equal(asksToSearch("what's the latest news on the peso?"), true);
  assert.equal(asksToSearch("explain how a mortgage works"), false);
  assert.equal(asksToSearch("what should I cook tonight?"), false);
  assert.equal(asksToSearch("yes", [{ role: "assistant", content: "Want me to search the web for that?" }]), true);
  assert.equal(asksToSearch("continue", [{ role: "assistant", content: "Want me to search the web for that?" }]), false);
});
