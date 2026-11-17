// Refuses to start when a trusted identity header could come from any local process. Both flags
// need serve.mjs on NEXY_SOCKET, a socket only the proxy can open; entry.mjs alone listens on TCP.
// NEXY_DOOR=desktop is the other accepted door: a wrapper (the Nexy app's desktop.mjs) that is the
// only listener, checks its own token and sets the identity header itself. Both need autostart off.
// NEXY_INSECURE_TRUST_ON_TCP=1 skips this, for tests only.
const flag = ["NEXY_TRUST_XNODE_AUTH", "NEXY_TRUST_GATE_USER"].find((f) => process.env[f] === "1");
const wrapped = process.env.ASTRO_NODE_AUTOSTART === "disabled";
const door = wrapped && (!!process.env.NEXY_SOCKET || process.env.NEXY_DOOR === "desktop");
if (flag && !door && process.env.NEXY_INSECURE_TRUST_ON_TCP !== "1") {
  console.error(`[nexy] refusing to start: ${flag}=1 needs NEXY_SOCKET. On TCP any local process can claim an identity; start dist/server/serve.mjs with NEXY_SOCKET.`);
  process.exit(1);
}
