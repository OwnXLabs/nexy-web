// The desktop app's verdicts for its model on this computer (NEXY_CAPS, from the capability file it ships).
// The page holds a job back before it runs; a build that reaches the server anyway is refused here too.

// A game asked for by name or kind, not only by the word: "make street fighter", "sudoku please",
// "an endless runner". Bare "fighting" or "racing" are left out: "an app for fighting procrastination".
const GAME_NAMES = String.raw`games?|pong|snake|tetris|breakout|asteroids|platformer|arcade|flappy(?: bird)?|pac-?man|space invaders|frogger|galaga|minesweeper|sudoku|chess|checkers|draughts|tic[- ]?tac[- ]?toe|noughts and crosses|connect (?:4|four)|hangman|wordle|2048|solitaire|pinball|whack-?a-?mole|mario|minecraft|zelda|tekken|street fighter|mortal kombat|angry birds|subway surfers|temple run|geometry dash|crossy road|candy crush|match-?3|shooter|shoot-?['e]?m-?up|beat-?['e]?m-?up|fighter|endless runner|side-?scroller|car racing|racing car|kart|tower defen[cs]e|roguelike|dungeon crawler|rpg|clicker|maze|memory (?:card )?match(?:ing)?|card matching`;
// how a game is described rather than named: "something I can play", "dodge the rocks", "high score"
const PLAY_CUE = String.raw`(?:i|we|you|kids?|they) (?:can|could) play|something to play|playable|play (?:it|against|vs)|high ?scores?|power-?ups?|arrow keys|wasd|\d+ lives|extra lives|score points|dodge`;
// a games business or event is about games, not one to play: "a website for a game studio"
const ABOUT_GAMES = /\bgames?\s+(?:studio|developer|dev|designer|company|shop|store|caf[eé]|club|night|show|review|blog|news|jam|bar)s?\b/gi;
const plainOf = (t: string) => t.replace(/\bping[\s-]pong\b/gi, " ").replace(ABOUT_GAMES, " ").replace(/\bweb ?apps?\b/gi, " app ");
export const GAME_TERM = new RegExp(String.raw`\b(?:${GAME_NAMES})\b`, "i");
export const PLAY = new RegExp(String.raw`\b(?:${PLAY_CUE})\b`, "i");

// What a build is checked as before it is shown: a website needs real words on it, a game must
// draw, move and answer the keys, a small app only has to show something. A website is the
// default ("something for my bakery"); naming a site wins over an app word ("a website with a
// booking form"), and over a game named after it ("a landing page for a game developer").
// A game named by kind loses to an app named before it ("an app for chess clubs"); the word
// "game", or how it plays, wins over app words ("a quiz I can play against the clock").
const SITE_WORD = /\b(?:web ?site|site|landing page|home ?page|web ?page|one[- ]pager|(?:web|online) ?(?:shop|store)|shop|store)\b/i;
const APP_WORD = /\b(?:app|application|tool|calculator|converter|timer|tracker|to-?do|planner|dashboard|editor|widget|quiz|generator|counter|clock|stopwatch|form)\b/i;
const at = (re: RegExp, t: string) => re.exec(t)?.index ?? -1;
// i comes before every other match there is
const first = (i: number, ...others: number[]) => i >= 0 && others.every((o) => o < 0 || i < o);
export function buildKind(t: string): "game" | "site" | "app" {
  const plain = plainOf(t);
  const site = at(SITE_WORD, plain), app = at(APP_WORD, plain);
  const named = at(GAME_TERM, plain), word = at(/\bgames?\b/i, plain), play = at(PLAY, plain);
  if (first(named, site, app) || first(word, site) || first(play, site)) return "game";
  if (site >= 0) return "site";
  return app >= 0 ? "app" : "site";
}
// a build shown and checked as a game: the same answer as buildKind, so the card and the check agree
export const gameBrief = (t: string) => buildKind(t) === "game";

export const BUILD_REFUSED = "Building websites and games needs a bigger AI than this computer can run.";

function tasksOf(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    return (JSON.parse(raw) as { tasks?: Record<string, string> }).tasks ?? {};
  } catch (e) {
    console.warn("[nexy] NEXY_CAPS unreadable; builds not held back", e);
    return {};
  }
}

export function buildBlocked(brief: string, raw = process.env.NEXY_CAPS): boolean {
  return tasksOf(raw)[gameBrief(brief) ? "build_game" : "build_site"] === "block";
}

// either kind of build held back on this computer: a chat turn is told so, and a page it writes anyway is not offered
export function anyBuildBlocked(raw = process.env.NEXY_CAPS): boolean {
  const t = tasksOf(raw);
  return t.build_site === "block" || t.build_game === "block";
}
