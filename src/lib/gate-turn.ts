// Nexy Cloud's GPU credits: the gate puts each chat turn in a lane, "paid" while the person has credits, and
// gives it a ticket that goes untouched with the turn to the engine, which passes it to the model network.
// Read only behind the trusted gate (NEXY_TRUST_GATE_USER, as x-nexy-user in owner.ts), which drops any copy a
// visitor sends.
const TRUST_GATE_USER = process.env.NEXY_TRUST_GATE_USER === "1";

export function gateLane(request: Request): "paid" | "free" | null {
  const l = TRUST_GATE_USER ? request.headers.get("x-nexy-lane") : null;
  return l === "paid" || l === "free" ? l : null;
}

export function gateTicket(request: Request): string | null {
  const t = TRUST_GATE_USER ? request.headers.get("x-nexy-ticket") : null;
  return t && /^[A-Za-z0-9_.-]{1,512}$/.test(t) ? t : null;
}
