// Starts Nexy on a unix socket (NEXY_SOCKET, mode 0660, group NEXY_SOCKET_GROUP if set) or, without
// one, on HOST:PORT.
// Copied to dist/server/serve.mjs at build; run it in place of entry.mjs.
// A socket lets the host decide who may connect (its group, e.g. nginx): on loopback TCP any local
// process can reach Nexy and send the identity header that NEXY_TRUST_XNODE_AUTH trusts.
import fs from "node:fs";
import http from "node:http";

const sock = process.env.NEXY_SOCKET;
// a group name or number; the service must be a member (SupplementaryGroups)
const groupId = (g) => {
  if (/^\d+$/.test(g)) return Number(g);
  const line = fs.readFileSync("/etc/group", "utf8").split("\n").find((l) => l.split(":")[0] === g);
  if (!line) throw new Error(`no group ${g}`);
  return Number(line.split(":")[2]);
};

process.env.ASTRO_NODE_AUTOSTART = "disabled";
const { handler } = await import("./entry.mjs");
const server = http.createServer(handler);
server.on("error", (e) => { console.error(`[nexy] ${e.message}`); process.exit(1); });

if (sock) {
  // a socket left by a crash is replaced; any other file there is not
  const old = fs.lstatSync(sock, { throwIfNoEntry: false });
  if (old && !old.isSocket()) { console.error(`[nexy] ${sock} exists and is not a socket`); process.exit(1); }
  if (old) fs.unlinkSync(sock);
  const mask = process.umask(0o117); // created 0660, never briefly wider
  server.listen(sock, () => {
    process.umask(mask);
    try {
      if (process.env.NEXY_SOCKET_GROUP) fs.chownSync(sock, process.getuid(), groupId(process.env.NEXY_SOCKET_GROUP));
      fs.chmodSync(sock, 0o660);
    } catch (e) {
      // a socket nginx can't open would only fail later, request by request
      console.error(`[nexy] ${sock}: ${e.message}`);
      fs.rmSync(sock, { force: true });
      process.exit(1);
    }
    console.log(`[nexy] listening on ${sock}`);
  });
  for (const s of ["SIGTERM", "SIGINT"]) process.on(s, () => { fs.rmSync(sock, { force: true }); process.exit(0); });
} else {
  const host = process.env.HOST || "127.0.0.1", port = Number(process.env.PORT || 4321);
  server.listen(port, host, () => console.log(`[nexy] listening on http://${host}:${port}`));
}
