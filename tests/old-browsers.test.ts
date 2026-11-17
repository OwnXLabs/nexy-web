// What the browser gets runs on the oldest engines Nexy meets: Android WebView 91 (the phone app)
// and Safari 15. The build lowers syntax for them; an API they lack throws at run time, so the
// built client is scanned for each one (Array.prototype.at, for one).
// Run after `npm run build`. NEXY_DIST points at another build (default dist).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// a use that is fine where it stands: (text, index of the match) => true
type Ok = (text: string, at: number) => boolean;
// noVNC's decoders read Uint8Array.at; src/client/compat.ts supplies it on typed arrays
const noVncTyped: Ok = (t, at) => /rQpeekBytes\([^)]*\)(?:\.at\(|;[^;]{0,60}$)/.test(t.slice(Math.max(0, at - 80), at + 4));
// a declaration with its own fallback just before it ("height:100%;height:100dvh")
const withFallback: Ok = (t, at) => {
  const decl = /([a-z-]+):[^;{}]*$/.exec(t.slice(Math.max(0, at - 200), at));
  return !!decl && new RegExp(`[;{]\\s*${decl[1]}:[^;{}]*;\\s*${decl[1]}:[^;{}]*$`).test(t.slice(Math.max(0, at - 300), at)) &&
    !/[dsl]v[hw]/.test(/([^;{}]*);[^;{}]*$/.exec(t.slice(Math.max(0, at - 300), at))?.[1] ?? "x");
};

// [what, first Chrome / Safari with it, pattern in minified code, fine where]
export const BANNED: [string, string, RegExp, Ok?][] = [
  ["Array/String.prototype.at", "Chrome 92, Safari 15.4", /\.at\(/, noVncTyped],
  ["findLast / findLastIndex", "Chrome 97, Safari 15.4", /\.findLast(?:Index)?\(/],
  ["toSorted / toReversed / toSpliced", "Chrome 110, Safari 16", /\.to(?:Sorted|Reversed|Spliced)\(/],
  ["Array.prototype.with", "Chrome 110, Safari 16", /\.with\(/],
  ["structuredClone", "Chrome 98, Safari 15.4", /\bstructuredClone\(/],
  ["Object.hasOwn", "Chrome 93, Safari 15.4", /\bObject\.hasOwn\(/],
  ["Object/Map.groupBy, Array group", "Chrome 117, Safari 17.4", /\b(?:Object|Map)\.groupBy\(|\.group(?:ToMap|By)?\(/],
  ["AbortSignal.timeout / any", "Chrome 103 / 116, Safari 16", /\bAbortSignal\.(?:timeout|any)\(/],
  ["Promise.withResolvers", "Chrome 119, Safari 17.4", /\bPromise\.withResolvers\(/],
  ["Array.fromAsync", "Chrome 121, Safari 16.4", /\bArray\.fromAsync\(/],
  ["URL.canParse / URL.parse", "Chrome 120, Safari 17", /\bURL\.(?:canParse|parse)\(/],
  ["isWellFormed / toWellFormed", "Chrome 111, Safari 16.4", /\.(?:isWellFormed|toWellFormed)\(/],
  ["Set methods", "Chrome 122, Safari 17", /\.(?:union|intersection|symmetricDifference|isSubsetOf|isSupersetOf|isDisjointFrom)\(/],
  ["crypto.randomUUID", "Chrome 92, Safari 15.4", /\brandomUUID\(/],
  ["AbortSignal.throwIfAborted", "Chrome 100, Safari 15.4", /\.throwIfAborted\(/],
  ["iterator helpers", "Chrome 122, Safari 18.4", /\bIterator\.from\(|\.(?:values|keys|entries)\(\)\.(?:map|filter|take|drop|flatMap|reduce|toArray|forEach|some|every|find)\(/],
  ["regex lookbehind (a parse error: the whole file fails)", "Safari 16.4", /\(\?<[=!]/],
  ["popover", "Chrome 114, Safari 17", /\.(?:showPopover|togglePopover|hidePopover)\(/],
  ["checkVisibility", "Chrome 105, Safari 17.4", /\.checkVisibility\(/],
  ["requestIdleCallback", "never in Safari 15", /\brequestIdleCallback\(/],
  ["CSS :has()", "Chrome 105, Safari 15.4", /:has\(/],
  ["CSS container queries", "Chrome 105, Safari 16", /@container\b/],
  ["CSS color-mix()", "Chrome 111, Safari 16.2", /\bcolor-mix\(/],
  ["CSS @layer", "Chrome 99, Safari 15.4", /@layer\b/],
  // (width<=820px): the macOS 13 web view drops the whole rule (vite cssTarget keeps esbuild from writing it)
  ["CSS range media queries", "Chrome 104, Safari 16.4", /@media[^{]*(?:\b(?:width|height|aspect-ratio)\s*[<>]|[<>]=?\s*(?:width|height|aspect-ratio)\b)/],
  // var(--vh, 100dvh): --vh is set from script, so the fallback is never needed
  ["CSS dvh/svh/lvh units", "Chrome 108, Safari 15.4", /(?<!var\(--vh,)\b\d+(?:\.\d+)?[dsl]v[hw]\b/, withFallback],
];

/** Every banned use in a text: name, browsers, and the code around it. */
export function scan(text: string): { what: string; since: string; near: string }[] {
  const out: { what: string; since: string; near: string }[] = [];
  for (const [what, since, re, ok] of BANNED) {
    const g = new RegExp(re.source, "g");
    for (const m of text.matchAll(g)) if (!ok?.(text, m.index!)) out.push({ what, since, near: text.slice(Math.max(0, m.index! - 40), m.index! + 40).replace(/\s+/g, " ") });
  }
  return out;
}

const DIST = path.resolve(process.env.NEXY_DIST ?? path.join(import.meta.dirname, "..", "dist"), "client");
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
  e.isDirectory() ? files(path.join(dir, e.name)) : /\.(?:m?js|css|html)$/.test(e.name) ? [path.join(dir, e.name)] : []);

test("the scanner finds what it is for, and not ordinary code", () => {
  assert.equal(scan("const l=r.at(-1);").length, 1);
  assert.equal(scan("fetch(u,{signal:AbortSignal.timeout(5e3)})").length, 1);
  assert.equal(scan("/(?<!ping )pong/").length, 1);
  assert.equal(scan(".a:has(+ .b){}").length, 1);
  assert.equal(scan("height:calc(var(--vh,100dvh) - 52px)").length, 0);
  assert.equal(scan("height:100dvh").length, 1);
  assert.equal(scan(".a{height:100%;height:100dvh}").length, 0, "with a fallback");
  assert.equal(scan(".a{width:1px;height:100dvh}").length, 1, "another property is no fallback");
  assert.equal(scan(".a{height:100svh;height:100dvh}").length, 2, "nor is another new unit");
  assert.equal(scan("var _=a.rQpeekBytes(c).at(-1);").length, 0, "noVNC, supplied by compat.ts");
  assert.equal(scan("var a=e.rQpeekBytes(r-2+i,!1);if(a.at(-2)===255&&a.at(-1)!==0)").length, 0);
  assert.equal(scan("@media (width<=820px){.a{b:c}}").length, 1);
  assert.equal(scan("@media (500px<=width<=900px){.a{b:c}}").length, 1);
  assert.equal(scan("@media (max-width:820px){.a{b:c}}").length, 0);
  assert.deepEqual(scan("const x=a[a.length-1];s.replaceAll('a','b');el.replaceChildren();/(?<name>x)/"), []);
});

test("the built client uses nothing Android WebView 91 or Safari 15 lacks", () => {
  assert(fs.existsSync(DIST), `build first: npm run build (no ${DIST})`);
  const found = files(DIST).flatMap((f) => scan(fs.readFileSync(f, "utf8")).map((h) => `${path.relative(DIST, f)}: ${h.what} (${h.since}) near «${h.near}»`));
  assert.deepEqual(found, [], `too new for the phone app or Safari 15:\n${found.join("\n")}`);
});
