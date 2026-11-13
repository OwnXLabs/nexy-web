// Files read on a computer without Own Docs: text as it is, a PDF's text layer, images and the rest refused plainly.
// node --experimental-strip-types --test tests/file-text.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";

const { readLocally, pdfText, LOCAL_READ_MAX, LOCAL_TEXT_MAX } = await import("../src/lib/file-text.ts");
const enc = (s: string) => new TextEncoder().encode(s);

// a PDF built by hand: objects in order, an xref good enough to look like one
function pdf(objs: (string | { dict: string; data: Buffer })[], first = 1): Uint8Array {
  const parts: Buffer[] = [Buffer.from("%PDF-1.5\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  objs.forEach((o, i) => {
    if (typeof o === "string") parts.push(Buffer.from(`${i + first} 0 obj\n${o}\nendobj\n`, "latin1"));
    else parts.push(Buffer.from(`${i + first} 0 obj\n<< ${o.dict} /Length ${o.data.length} >>\nstream\n`, "latin1"), o.data, Buffer.from("\nendstream\nendobj\n"));
  });
  parts.push(Buffer.from("trailer\n<< /Root 1 0 R >>\n%%EOF\n"));
  return new Uint8Array(Buffer.concat(parts));
}

test("a plain PDF: strings, kerned arrays, escapes and lines, pages in order", async () => {
  const page1 = "BT /F1 12 Tf 72 720 Td (Weekly report) Tj 0 -14 Td [(Reve) 20 (nue was 4,210) -300 (dollars.)] TJ T* (The caf\\351 \\(downtown\\) opens.) Tj ET";
  const doc = pdf([
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>",
    { dict: "", data: Buffer.from(page1, "latin1") },
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Page /Parent 2 0 R /Contents [7 0 R] >>",
    { dict: "/Filter /FlateDecode", data: zlib.deflateSync(Buffer.from("BT /F1 12 Tf 72 720 Td (Page two: Dana signs off.) Tj ET")) },
  ]);
  assert.equal(await pdfText(doc), "Weekly report\nRevenue was 4,210 dollars.\nThe café (downtown) opens.\n\nPage two: Dana signs off.");
});

test("a PDF with its objects in a compressed object stream and a two-byte font with a ToUnicode map", async () => {
  const cmap = "begincmap\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n2 beginbfchar\n<0003> <0020>\n<0010> <00E9>\nendbfchar\n1 beginbfrange\n<0024> <003D> <0041>\nendbfrange\nendcmap";
  // "HI" then a space, then an é: H = 0x24 + 7, I = 0x24 + 8
  const content = "BT /F9 10 Tf 1 0 0 1 50 700 Tm <002B002C00030010> Tj ET";
  const inner = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /Resources << /Font << /F9 6 0 R >> >> /Contents 4 0 R >>"];
  let head = "", body = "";
  inner.forEach((o, i) => { head += `${i + 1} ${body.length} `; body += o + "\n"; });
  // objects 1 to 3 are only in the object stream
  const doc = pdf([
    { dict: "/Filter /FlateDecode", data: zlib.deflateSync(Buffer.from(content)) },
    { dict: `/Type /ObjStm /N 3 /First ${head.length} /Filter /FlateDecode`, data: zlib.deflateSync(Buffer.from(head + body)) },
    "<< /Type /Font /Subtype /Type0 /Encoding /Identity-H /ToUnicode 7 0 R >>",
    { dict: "/Filter /FlateDecode", data: zlib.deflateSync(Buffer.from(cmap)) },
  ], 4);
  assert.equal(await pdfText(doc), "HI é");
});

test("text, Markdown and CSV are read as they are; a PDF with no text, images and other files are said plainly", async () => {
  assert.deepEqual(await readLocally("memo.txt", "text/plain", enc("﻿Weekly report\n")), { kind: "text", text: "Weekly report" });
  assert.deepEqual(await readLocally("notes.md", "", enc("# Notes")), { kind: "text", text: "# Notes" });
  assert.deepEqual(await readLocally("sales.csv", "text/csv", enc("a,b\n1,2")), { kind: "text", text: "a,b\n1,2" });
  assert.equal(((await readLocally("big.txt", "text/plain", enc("x".repeat(LOCAL_TEXT_MAX + 50)))) as { text: string }).text.length, LOCAL_TEXT_MAX);
  assert.deepEqual(await readLocally("photo.png", "image/png", enc("x")), { kind: "image" });
  assert.deepEqual(await readLocally("IMG_1.HEIC", "", enc("x")), { kind: "image" });
  assert.deepEqual(await readLocally("empty.txt", "text/plain", enc("  ")), { kind: "unreadable", why: "the file is empty" });
  assert.match(((await readLocally("scan.pdf", "application/pdf", pdf(["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [] /Count 0 >>"]))) as { why: string }).why, /no text to read/);
  assert.match(((await readLocally("not-a.pdf", "application/pdf", enc("hello"))) as { why: string }).why, /no text to read/);
  assert.match(((await readLocally("deck.key", "", enc("x"))) as { why: string }).why, /only text, Markdown, CSV and PDF/);
  assert.match(((await readLocally("huge.txt", "text/plain", new Uint8Array(LOCAL_READ_MAX + 1))) as { why: string }).why, /too large to read here/);
});
