// "assign it to me" goes to the owner; a name is the owner's only when it is the one set in Settings.
import { test } from "node:test";
import assert from "node:assert/strict";
import { clientModule } from "./client-module.ts";

const { meansOwner } = await clientModule("src/client/intent.ts");

test("me, myself and you are the owner", () => {
  for (const t of ["me", "Myself", " you "]) assert.equal(meansOwner(t, ""), true);
});

test("the owner's configured name, full or first, is the owner", () => {
  assert.equal(meansOwner("Maria", "Maria Santos"), true);
  assert.equal(meansOwner("maria santos", "Maria  Santos"), true);
});

test("any other name is a role, with or without a configured name", () => {
  assert.equal(meansOwner("john", ""), false);
  assert.equal(meansOwner("john", "Maria Santos"), false);
  assert.equal(meansOwner("designer", "Maria"), false);
});
