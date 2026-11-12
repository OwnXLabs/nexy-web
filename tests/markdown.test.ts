// Markdown in chat bubbles and documents: rendered, and safe. 0.2.8 showed "[Title](url)", "###" and
// ">" raw in chat. Nothing a reply (or a page it quotes) writes may become HTML, a script or a
// link that is not http(s).
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderMd, inline } from "../src/client/md.ts";

test("what models write renders: headings, lists, emphasis, links, quotes, code, tables", () => {
  const h = renderMd([
    "### Sources",
    "- [PhilNews – USD to PHP](https://philnews.ph/2026/11/11/usd?a=1&b=2)",
    "- **bold**, *italic*, `code`, ~~gone~~",
    "",
    "> Profit = Selling Price − Total Cost",
    ">",
    "> Profit = ₱6.00",
    "",
    "1. one",
    "",
    "2. two",
    "",
    "| Item | Cost |",
    "|---|---:|",
    "| Rent | 100 |",
    "",
    "```js",
    "if (a < b) x();",
    "```",
  ].join("\n"));
  assert.match(h, /<h4>Sources<\/h4>/);
  assert.match(renderMd("## Big"), /<h3>Big<\/h3>/);
  assert.match(h, /<ul><li><a href="https:\/\/philnews\.ph\/2026\/11\/11\/usd\?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">PhilNews – USD to PHP<\/a><\/li>/);
  assert.match(h, /<b>bold<\/b>, <i>italic<\/i>, <code>code<\/code>, <s>gone<\/s>/);
  assert.match(h, /<blockquote><p>Profit = Selling Price − Total Cost<\/p><p>Profit = ₱6\.00<\/p><\/blockquote>/);
  assert.match(h, /<ol><li>one<\/li><\/ol><ol start="2"><li>two<\/li><\/ol>/, "a list split by blank lines keeps counting");
  assert.match(h, /<table><thead><tr><th>Item<\/th><th>Cost<\/th><\/tr><\/thead><tbody><tr><td>Rent<\/td><td>100<\/td><\/tr><\/tbody><\/table>/);
  assert.match(h, /<pre class="code">if \(a &lt; b\) x\(\);<\/pre>/);
  assert.doesNotMatch(h.replace(/<pre[\s\S]*?<\/pre>/g, ""), /\n/, "no newlines for the bubble's pre-wrap");
  assert.doesNotMatch(h, /\[PhilNews|###|^&gt;/);
});

test("documents keep their h1 title and h2 sections", () => {
  assert.equal(renderMd("# Guide\n\n## Step one\ntext", "doc"), "<h1>Guide</h1><h2>Step one</h2><p>text</p>");
});

test("snake_case and sums are not emphasis", () => {
  assert.equal(inline("my_file_name and 2*3*4"), "my_file_name and 2*3*4");
});

const XSS = [
  "<script>alert(1)</script>",
  "<img src=x onerror=alert(1)>",
  '<a href="javascript:alert(1)">x</a>',
  "[click](javascript:alert(1))",
  "[click](JaVaScRiPt:alert(1))",
  "[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)",
  "[click](vbscript:msgbox(1))",
  '[click](https://ok.example/"onmouseover="alert(1))',
  "[click](https://ok.example/ \"t\" onclick=alert(1))",
  "[<img src=x onerror=alert(1)>](https://ok.example)",
  "`<script>alert(1)</script>`",
  "| <b onclick=alert(1)>a</b> | b |\n|---|---|\n| <svg onload=alert(1)> | c |",
  "> <iframe src=javascript:alert(1)>",
  "**<style>body{display:none}</style>**",
  "\u00000\u0000 [x](https://a.example)",
];

test("no HTML, script or non-http link gets through", () => {
  for (const x of XSS) {
    const h = renderMd(x);
    // the only tags are the renderer's own
    for (const tag of h.match(/<\/?([a-z0-9]+)/gi) ?? [])
      assert.match(tag, /^<\/?(p|br|b|i|s|code|a|ul|ol|li|h3|h4|blockquote|div|table|thead|tbody|tr|th|td|pre|hr)$/i, `${x} -> ${h}`);
    // every attribute is one the renderer writes, with a safe value
    for (const [, name, value] of h.matchAll(/\s([a-z-]+)="([^"]*)"/gi)) {
      assert.match(name, /^(href|target|rel|class|start)$/, `${x} -> ${h}`);
      if (name === "href") assert.match(value, /^https?:\/\//i, `${x} -> ${h}`);
    }
    for (const tag of h.match(/<[^>]+>/g) ?? []) assert.doesNotMatch(tag, /\son\w+=|javascript:|data:/i, `${x} -> ${h}`);
  }
});
