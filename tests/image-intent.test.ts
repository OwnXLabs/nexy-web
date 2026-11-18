// When a message is an image request. With a verb ("make an image of…", "draw a cat") or "an image
// of…" it always is. A bare description ("a small red bicycle") is one only right after an image, or
// after Nexy asked what the image should show; anywhere else it stays a chat message. Held-out
// examples were written before the rule was run against them and are kept apart from the ones it was
// built from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientModule } from "./client-module.ts";

const { classify, describesImage, IMAGE_WHAT } = await clientModule("src/client/intent.ts");
const image = (t: string) => { const i = classify(t); return i.kind === "generate" && i.medium === "image" ? i.prompt : null; };

test("an image asked for with a verb or as 'an image of…' is an image, with its subject as the prompt", () => {
  assert.equal(image("Make an image of a small red bicycle"), "a small red bicycle");
  assert.equal(image("an image of a small red bicycle"), "a small red bicycle");
  assert.equal(image("A picture of a fox in the snow"), "a fox in the snow");
  assert.equal(image("draw me a cat wearing a hat"), "cat wearing a hat");
  assert.equal(image("Make a logo for my bakery"), "my bakery");
});

test("'make an image' with nothing to show asks what it should show", () => {
  for (const t of ["Make an image", "make a picture", "Create an image.", "generate an image for me"]) assert.equal(classify(t).kind, "imageWhat", t);
  assert.match(IMAGE_WHAT, /What should the image show\?/);
});

test("a bare description with no image just before is a chat message, never an image", () => {
  for (const t of ["a small red bicycle", "sunset over the mountains", "two cats on a sofa"]) assert.equal(classify(t).kind, "chat", t);
});

test("not over-triggered: diagrams, charts, pages and questions stay what they are", () => {
  assert.notEqual(classify("draw a flowchart of our signup").kind, "generate");
  assert.equal(classify("draw a chart of sales by month").kind, "chart");
  assert.notEqual(classify("make a website for my bakery").kind, "generate");
  assert.equal(image("what is a picture of health?"), null);
  assert.equal(image("picture this: we launch next week"), null);
});

const DESCRIPTIONS = ["a small red bicycle", "a lighthouse at dusk, watercolour", "two cats on a sofa", "red bicycle", "now a blue one", "sunset over the mountains"];
const NOT = ["thanks!", "ok", "what model made that?", "how do I save it?", "write a caption for it", "tell me about bicycles", "summarise my week", "no thanks", "make it bigger", "build a website for it"];

test("right after an image: a short description is the next image; replies, questions and other jobs are not", () => {
  for (const t of DESCRIPTIONS) assert.equal(describesImage(t), true, t);
  for (const t of NOT) assert.equal(describesImage(t), false, t);
});

// held out: written before the rule was run against them, not tuned to pass
const HELD_IN = ["a cosy cabin in a snowy forest", "golden retriever puppy on the beach", "an old map of a treasure island", "neon city street at night in the rain", "a bowl of ramen, top view", "minimalist mountain logo in green"];
const HELD_OUT = ["great, thank you", "can you make it brighter?", "why is it blurry", "send it to my email", "I like the second one", "that's perfect", "research bike shops near me", "translate this into French", "what's on my calendar tomorrow", "Write a short poem about autumn leaves"];

test("held-out examples: descriptions after an image are images, the rest are not", () => {
  const miss = HELD_IN.filter((t) => !describesImage(t)), over = HELD_OUT.filter((t) => describesImage(t));
  assert.deepEqual({ miss, over }, { miss: [], over: [] });
});

test("held-out examples with no image just before: never an image without a verb or 'image of'", () => {
  for (const t of [...HELD_IN, ...HELD_OUT]) assert.equal(image(t), null, t);
  for (const t of ["paint a cosy cabin in a snowy forest", "an illustration of a bowl of ramen", "generate a picture of a golden retriever puppy"]) assert.ok(image(t), t);
});
