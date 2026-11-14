// Tables, lists and emails are answers in the chat, not projects, however long the ask.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientModule } from "./client-module.ts";

const { classify } = await clientModule("src/client/intent.ts");

test("a long ask for two tables is a chat answer", () => {
  const ask = "Make two small tables for my sari-sari store: table 1 = this week's costs with rent, power, stock and wages, with a total at the bottom; table 2 = the selling prices of my five best items and the margin on each one, please";
  assert.ok(ask.split(/\s+/).length > 30);
  assert.equal(classify(ask).kind, "chat");
  assert.equal(classify("Write an email to my supplier asking for a better price on rice and cooking oil for next month, polite but firm, and mention we have ordered every week for a year").kind, "chat");
});

test("projects and sites still go where they did", () => {
  assert.equal(classify("start a project to launch my bakery online").kind, "build");
  assert.equal(classify("make a website for my bakery").kind, "make");
});
