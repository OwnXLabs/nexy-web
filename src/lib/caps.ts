// The desktop app's verdicts for its model on this computer (NEXY_CAPS, from the capability file it ships).
// The page holds a job back before it runs; a build that reaches the server anyway is refused here too.

// "a ping pong ball business" is a shop, not a game; no lookbehind, which Safari before 16.4 cannot parse
const GAME_WORD = /\b(?:game|pong|snake|tetris|breakout|asteroids|platformer|arcade|flappy)\b/i;
export const gameBrief = (t: string) => GAME_WORD.test(t.replace(/\bping[\s-]pong\b/gi, " "));

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
