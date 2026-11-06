// The demo publisher, run for real against a stand-in Own Build. Anyone with the
// demo code can publish, so the page must be what Own Build generated (never what
// the browser sent) and it must expire.
//   node --test tests/demo-publisher.cjs
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const BUILT = "<!doctype html><title>coffee</title><h1>Built by Own Build</h1>";
const OWNER = "o_test_0123456789abcdef";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function start(ttlHours) {
  const build = http.createServer((req, res) => {
    if (req.url === "/api/director/runs/os-good/preview") { res.end(BUILT); return; }
    res.statusCode = 404; res.end("no such run");
  });
  await new Promise((r) => build.listen(0, "127.0.0.1", r));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-pub-"));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn("python3", [process.env.DEMO_PUBLISHER ?? path.join(__dirname, "../deploy/demo-publisher.py")], {
    env: { ...process.env, SITES_DIR: dir, SITES_URL: "https://sites.example", PORT: String(port),
      OWN_BUILD_URL: `http://127.0.0.1:${build.address().port}`, PUBLISH_TTL_HOURS: String(ttlHours) },
    stdio: "inherit",
  });
  const call = async (p, body, owner = OWNER) => {
    for (let i = 0; i < 50; i++) {
      try {
        const r = await fetch(`http://127.0.0.1:${port}/publish/api/${p}`, {
          method: body ? "POST" : "GET",
          headers: { "x-nexy-owner": owner, "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: r.status, body: await r.json() };
      } catch { await sleep(100); }
    }
    throw new Error("publisher did not start");
  };
  const stop = () => { proc.kill(); build.close(); fs.rmSync(dir, { recursive: true, force: true }); };
  return { dir, call, stop };
}

test("publishes Own Build's page, never the browser's", async () => {
  const s = await start(6);
  try {
    const r = await s.call("publish", { run: "os-good", name: "coffee", html: "<form action=https://evil.example>password</form>" });
    assert.equal(r.status, 200);
    assert.equal(fs.readFileSync(path.join(s.dir, "coffee.html"), "utf8"), BUILT);
    assert.ok(r.body.expiresAt > Date.now() + 5.9 * 3600_000, "expires in about 6 hours");
  } finally { s.stop(); }
});

test("refuses a build Own Build does not have", async () => {
  const s = await start(6);
  try {
    const r = await s.call("publish", { run: "os-made-up", name: "fake", html: "<h1>anything</h1>" });
    assert.equal(r.status, 422);
    assert.equal(fs.existsSync(path.join(s.dir, "fake.html")), false);
  } finally { s.stop(); }
});

test("an expired page disappears from status and from disk", async () => {
  const s = await start(1 / 3600); // one second
  try {
    assert.equal((await s.call("publish", { run: "os-good", name: "brief" })).status, 200);
    await sleep(1500);
    assert.deepEqual((await s.call("status?run=os-good")).body.publications, [], "hidden once expired");
    for (let i = 0; i < 70 && fs.existsSync(path.join(s.dir, "brief.html")); i++) await sleep(1000);
    assert.equal(fs.existsSync(path.join(s.dir, "brief.html")), false, "swept from disk");
  } finally { s.stop(); }
});

test("one owner cannot see or unpublish another's page", async () => {
  const s = await start(6);
  try {
    await s.call("publish", { run: "os-good", name: "mine" });
    const other = "o_test_fedcba9876543210";
    assert.deepEqual((await s.call("status?run=os-good", null, other)).body.publications, []);
    assert.equal((await s.call("unpublish", { run: "os-good", name: "mine" }, other)).status, 404);
    assert.ok(fs.existsSync(path.join(s.dir, "mine.html")));
  } finally { s.stop(); }
});

test("an owner gets at most 3 live pages; an expired one does not count", async () => {
  const s = await start(6);
  try {
    const seed = (name, hoursLeft) => fs.writeFileSync(path.join(s.dir, `${name}.json`),
      JSON.stringify({ owner: OWNER, run: name, name, expires: Date.now() / 1000 + hoursLeft * 3600 }));
    seed("a1", 1); seed("a2", 1); seed("old", -1);
    assert.equal((await s.call("publish", { run: "os-good", name: "third" })).status, 200, "two live + one expired: room for a third");
    const r = await s.call("publish", { run: "os-good", name: "fourth" });
    assert.equal(r.status, 200, "same run is already published: returns the existing page");
    seed("a3", 1);
    const other = await s.call("publish", { run: "os-good", name: "fifth" }, "o_test_00000000000000ff");
    assert.equal(other.status, 200, "another owner is not limited by this one");
    fs.unlinkSync(path.join(s.dir, "third.json")); fs.unlinkSync(path.join(s.dir, "third.html"));
    seed("a4", 1);
    const full = await s.call("publish", { run: "os-good", name: "sixth" });
    assert.equal(full.status, 429);
    assert.match(full.body.error, /3 public websites/);
  } finally { s.stop(); }
});
