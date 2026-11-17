// Refuses to start when a trusted identity header could come from any local process. Both flags
// need serve.mjs on NEXY_SOCKET, a socket only the proxy can open; entry.mjs alone listens on TCP.
// NEXY_INSECURE_TRUST_ON_TCP=1 skips this, for tests only.
const flag = ["NEXY_TRUST_XNODE_AUTH", "NEXY_TRUST_GATE_USER"].find((f) => process.env[f] === "1");
const onSocket = !!process.env.NEXY_SOCKET && process.env.ASTRO_NODE_AUTOSTART === "disabled";
if (flag && !onSocket && process.env.NEXY_INSECURE_TRUST_ON_TCP !== "1") {
  console.error(`[nexy] refusing to start: ${flag}=1 needs NEXY_SOCKET. On TCP any local process can claim an identity; start dist/server/serve.mjs with NEXY_SOCKET.`);
  process.exit(1);
}
