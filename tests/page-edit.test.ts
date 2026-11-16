// Changing a built page: thinking is off on the servers Nexy meets, so a thinking model's answer
// is not spent on thinking, and a change the model says it made but that is not on the page is
// reported, not called done. The model is a stand-in that behaves as Ollama does: it ignores
// chat_template_kwargs and thinks until the budget runs out unless reasoning_effort is "none".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const PAGE = `<!doctype html><html><head><title>Sunrise Bakery</title><style>body{background:#fffaf2;color:#3b2a1a}</style></head><body>
<header><h1>Sunrise Bakery</h1><p>Fresh bread every morning.</p></header>
<section id="visit"><h2>Visit us</h2><p>12 Harbour Road. Come in for a warm loaf and a coffee.</p></section>
<footer><p>Sunrise Bakery</p></footer></body></html>`;
const CHANGE = "Make the background dark navy and add a section with our opening hours: Monday to Friday, 7am to 6pm.";
const plan = (o: object) => JSON.stringify(o);
// a small model's answer as seen in the capability test: a style for a section it never added
const CLAIMED = plan({ edits: [], css: "body{background:#0b1a3a !important;color:#f5efe6 !important} section#hours{padding:24px}", say: "Background changed to dark navy and opening hours section added." });
const DONE = plan({
  edits: [{ find: `<footer><p>Sunrise Bakery</p></footer>`, replace: `<section id="hours"><h2>Opening hours</h2><p>Monday to Friday, 7am to 6pm</p></section><footer><p>Sunrise Bakery</p></footer>` }],
  css: "body{background:#0b1a3a !important;color:#f5efe6 !important}", say: "Made the background dark navy and added the opening hours.",
});

let mode: "ollama" | "refuses" | "thinks" = "ollama", answer = DONE;
const asked: any[] = [];
const srv = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    const b = JSON.parse(body);
    asked.push(b);
    res.setHeader("content-type", "application/json");
    if (mode === "refuses" && "reasoning_effort" in b) { res.statusCode = 400; return res.end(JSON.stringify({ error: { message: "unknown field reasoning_effort" } })); }
    const off = mode === "refuses" ? b.chat_template_kwargs?.enable_thinking === false : mode === "ollama" && b.reasoning_effort === "none";
    if (!off) return res.end(JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "", reasoning: "Okay, let me think about the page. ".repeat(190) } }] }));
    res.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: answer } }] }));
  });
});
let revise: typeof import("../src/lib/revise.ts").revise, unmet: typeof import("../src/lib/revise.ts").unmet;
before(async () => {
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  process.env.NEXY_LLM_URL = `http://127.0.0.1:${(srv.address() as any).port}`;
  ({ revise, unmet } = await import("../src/lib/revise.ts"));
});
after(() => srv.close());

test("thinking is off for Ollama: reasoning_effort none, and the change comes back", async () => {
  mode = "ollama"; answer = DONE; asked.length = 0;
  const r = await revise(PAGE, CHANGE);
  assert.equal(asked.length, 1);
  assert.equal(asked[0].reasoning_effort, "none");
  assert.deepEqual(asked[0].chat_template_kwargs, { enable_thinking: false });
  assert.equal(asked[0].max_tokens, 1500);
  assert.match(r.html, /Monday to Friday, 7am to 6pm/);
  assert.deepEqual(r.unmet, []);
});

test("a server that refuses reasoning_effort is asked again without it", async () => {
  mode = "refuses"; answer = DONE; asked.length = 0;
  const r = await revise(PAGE, CHANGE);
  assert.equal(asked.length, 2);
  assert.equal("reasoning_effort" in asked[1], false);
  assert.deepEqual(asked[1].chat_template_kwargs, { enable_thinking: false });
  assert.match(r.html, /opening hours/i);
});

test("a server that thinks anyway: once more with qwen3's own switch and room to answer, then a plain error", async () => {
  mode = "thinks"; answer = DONE; asked.length = 0;
  await assert.rejects(revise(PAGE, CHANGE), /spent its whole answer thinking and wrote no change/);
  assert.equal(asked.length, 2);
  assert.equal(asked[1].max_tokens, 4000);
  assert.match(asked[1].messages.at(-1).content, /\/no_think$/);
});

test("the model says it added the hours but only added a style: what is missing comes back", async () => {
  mode = "ollama"; answer = CLAIMED;
  const r = await revise(PAGE, CHANGE);
  assert.equal(r.applied, 1);
  assert.deepEqual(r.unmet, ["7am", "6pm", "Monday", "Friday"]);
});

test("a part picked on the page: only the words after 'The change:' are looked for", async () => {
  mode = "ollama"; answer = DONE;
  const wrapped = `Change only this part of the page. The part (footer) is currently:\n<footer><p>Sunrise Bakery · open Saturday 9am</p></footer>\n\nThe change: ${CHANGE}`;
  assert.deepEqual((await revise(PAGE, wrapped)).unmet, []);
});

test("an edit left unclosed before css, with the css repeated to the limit: the edit is kept, the missing hours reported", async () => {
  mode = "ollama";
  answer = '{"edits":[{"find":"background:#fffaf2;color:#3b2a1a","replace":"background:#0b1a3a;color:#f5efe6","css":"' + "section{padding:24px}".repeat(150);
  const r = await revise(PAGE, CHANGE);
  assert.equal(r.applied, 1);
  assert.match(r.html, /background:#0b1a3a;color:#f5efe6/);
  assert.deepEqual(r.unmet, ["7am", "6pm", "Monday", "Friday"]);
});

test("what counts as missing, on known-good and known-broken changes", () => {
  const withHours = (p: string) => PAGE.replace("<footer>", `<section><h2>Opening hours</h2><p>${p}</p></section><footer>`);
  const navy = PAGE.replace("background:#fffaf2;color:#3b2a1a", "background:#0b1a3a;color:#f5efe6");
  // known-good: the hours are there, however they are written
  assert.deepEqual(unmet(PAGE, withHours("Monday to Friday, 7am to 6pm"), CHANGE), []);
  assert.deepEqual(unmet(PAGE, withHours("Mon–Fri: 7:00 AM – 6:00 PM"), CHANGE), []);
  assert.deepEqual(unmet(PAGE, withHours("Mon - Fri 07:00 - 18:00"), CHANGE), []);
  // known-broken: only the colour changed
  assert.deepEqual(unmet(PAGE, navy, CHANGE), ["7am", "6pm", "Monday", "Friday"]);
  assert.deepEqual(unmet(PAGE, withHours("Monday to Friday"), CHANGE), ["7am", "6pm"]);
  // the words arrived, but the text is now the colour of the new background (qwen3:1.7b, 2026-11-17)
  const dark = withHours("Monday to Friday, 7am to 6pm").replace("background:#fffaf2;color:#3b2a1a", "background:#0a0a0a;color:#000000");
  assert.deepEqual(unmet(PAGE, dark, CHANGE), ["readable text"]);
  assert.deepEqual(unmet(PAGE, dark.replace("</head>", "<style>body{color:#f5efe6 !important}</style></head>"), CHANGE), []);
  assert.deepEqual(unmet(PAGE, PAGE.replace("<body>", '<body style="background-color: #03055b; color: #03055b">'), "make the background navy"), ["readable text"]);
  // a heading colour that reads does not make the paragraphs readable; a paragraph colour that reads does
  const brown = PAGE.replace("background:#fffaf2;color:#3b2a1a", "background:#0a0a0a;color:#3b2a1a");
  assert.deepEqual(unmet(PAGE, brown.replace("</head>", "<style>h1{color:#a4441f}footer{color:#6b5440}</style></head>"), "make the background black"), ["readable text"]);
  assert.deepEqual(unmet(PAGE, brown.replace("</head>", "<style>header,p{color:#cde8f5}</style></head>"), "make the background black"), []);
  // a change of look only asks for no new words
  assert.deepEqual(unmet(PAGE, navy, "Make the background dark navy", "Changed the background to dark navy."), []);
  assert.deepEqual(unmet(PAGE, PAGE.replace("</style>", "button{box-shadow:0 2px 4px #0003}</style>"), "add a shadow to the buttons", "Added a shadow to the buttons."), []);
  // new words asked for or claimed, and none appeared
  assert.deepEqual(unmet(PAGE, navy, "add a testimonials section"), ["the new text"]);
  assert.deepEqual(unmet(PAGE, navy, "make it nicer", "Added a testimonials section."), ["the new text"]);
  assert.deepEqual(unmet(PAGE, PAGE.replace("Fresh bread every morning.", "Fresh bread every morning. Loved by locals."), "add a testimonials section"), []);
  // quoted words, a price, an email and a phone number already on the page are not asked for again
  assert.deepEqual(unmet(PAGE, navy, 'change the heading to "Sunrise Bakery"'), []);
  assert.deepEqual(unmet(PAGE, navy, 'add "Order online" and our email hello@sunrise.test, phone +63 912 345 6789, sourdough $6.50'),
    ["Order online", "$6.50", "hello@sunrise.test", "+63 912 345 6789"]);
});
