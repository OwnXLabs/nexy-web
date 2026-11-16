// The desktop app's verdicts for its model on this computer (NEXY_CAPS, from the capability file it ships).
// The page holds a job back before it runs; a build that reaches the server anyway is refused here too.

// "a ping pong ball business" is a shop, not a game; no lookbehind, which Safari before 16.4 cannot parse
const GAME_WORD = /\b(?:game|pong|snake|tetris|breakout|asteroids|platformer|arcade|flappy)\b/i;
export const gameBrief = (t: string) => GAME_WORD.test(t.replace(/\bping[\s-]pong\b/gi, " "));

// What a build is checked as before it is shown: a website needs real words on it, a game must
// draw, move and answer the keys, a small app only has to show something. A website is the
// default ("something for my bakery"); naming a site wins over an app word ("a website with a
// booking form"), and over a game named after it ("a landing page for a game developer").
const SITE_WORD = /\b(?:web ?site|site|landing page|home ?page|web ?page|one[- ]pager)\b/i;
const APP_WORD = /\b(?:app|application|tool|calculator|converter|timer|tracker|to-?do|planner|dashboard|editor|widget|quiz|generator|counter|clock|stopwatch|form)\b/i;
export function buildKind(t: string): "game" | "site" | "app" {
  const plain = t.replace(/\bping[\s-]pong\b/gi, " ").replace(/\bweb ?apps?\b/gi, " app ");
  const site = SITE_WORD.exec(plain)?.index ?? -1, game = GAME_WORD.exec(plain)?.index ?? -1;
  if (game >= 0 && (site < 0 || game < site)) return "game";
  if (site >= 0) return "site";
  return APP_WORD.test(plain) ? "app" : "site";
}

export const BUILD_REFUSED = "Building websites and games needs a bigger AI than this computer can run.";

export function buildBlocked(brief: string, raw = process.env.NEXY_CAPS): boolean {
  if (!raw) return false;
  try {
    const t = (JSON.parse(raw) as { tasks?: Record<string, string> }).tasks ?? {};
    return t[gameBrief(brief) ? "build_game" : "build_site"] === "block";
  } catch (e) {
    console.warn("[nexy] NEXY_CAPS unreadable; builds not held back", e);
    return false;
  }
}
