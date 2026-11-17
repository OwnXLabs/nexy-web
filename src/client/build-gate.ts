// Before a page built on this computer is shown: run it unseen in the same sandbox the canvas
// uses and refuse it if it reaches for the network, logs an error, freezes, or does not work:
// a website with next to no words, a game that stays blank, never moves or ignores the keys.
// The capability test grades builds from screenshots the same way (the old check,
// "some text or any button", passed 49 of 78 builds and 38 of those did not work).
import { STORAGE_SHIM } from "./content-view";

export type BuildKind = "site" | "game" | "app";

// Runs inside the built page, before its own scripts. Self-contained (it is sent as text) and
// plain ES5, so the build has no reason to add helpers it would not find there.
function probe(): void {
  var E: string[] = [], B: string[] = [];
  function add(a: string[], m: unknown) { if (a.length < 5) a.push(String(m).slice(0, 200)); }
  var ce = console.error;
  console.error = function () { add(E, [].map.call(arguments, String).join(" ")); return ce.apply(console, arguments as any); };
  addEventListener("error", function (e: any) {
    add(E, e.message ? e.message + (e.lineno ? " (line " + e.lineno + (e.colno ? ":" + e.colno : "") + ")" : "") : e.error || ("could not load " + (e.target && e.target.tagName || "a file")));
  }, true);
  addEventListener("unhandledrejection", function (e: any) { add(E, e.reason && e.reason.message || e.reason); });
  document.addEventListener("securitypolicyviolation", function (e: any) { add(B, e.blockedURI || e.violatedDirective); });

  // text boxes that sit on top of each other (a nav drawn over a heading)
  function overlaps(): number {
    var els = [].filter.call(document.querySelectorAll("body *"), function (el: Element) {
      if (el.closest("svg")) return false;
      for (var n = el.firstChild; n; n = n.nextSibling) if (n.nodeType === 3 && (n.textContent || "").trim()) return true;
      return false;
    }).slice(0, 400) as Element[];
    var r = els.map(function (el) { return el.getBoundingClientRect(); }), k = 0;
    for (var i = 0; i < els.length; i++) for (var j = i + 1; j < els.length; j++) {
      var a = r[i], b = r[j];
      if (!a.width || !b.width || els[i].contains(els[j]) || els[j].contains(els[i])) continue;
      var w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (w > 4 && h > 4 && w * h > 0.3 * Math.min(a.width * a.height, b.width * b.height)) k++;
    }
    return k;
  }

  // What the screen shows, read at a 64×48 grid of points as 4-bit colours: a glyph's colour
  // where text is, a canvas's own pixel, else the background behind the top element. A WebGL
  // canvas cannot be read back, so `gl` says the picture is unknown.
  var GW = 64, GH = 48;
  function key(c: string): number {
    var m = /rgba?\(([^)]+)\)/.exec(c || "");
    if (!m) return -1;
    var p = m[1].split(/[ ,\/]+/).filter(Boolean).map(Number);
    if (p.length > 3 && p[3] < 0.5) return -1;
    return (p[0] >> 4) << 8 | (p[1] >> 4) << 4 | (p[2] >> 4);
  }
  function behind(el: Element | null): number {
    for (var e = el; e; e = e.parentElement) {
      var s = getComputedStyle(e);
      if (s.backgroundImage && s.backgroundImage !== "none") return 0x2000 + s.backgroundImage.length % 4093;
      var k = key(s.backgroundColor);
      if (k >= 0) return k;
    }
    // past the page itself: the body's background fills the whole frame, as CSS paints it
    var root = key(getComputedStyle(document.documentElement).backgroundColor);
    if (root >= 0) return root;
    var body = document.body ? key(getComputedStyle(document.body).backgroundColor) : -1;
    return body >= 0 ? body : 0xfff; // else the frame's own white
  }
  function snap(): { cells: number[]; gl: boolean; sig: string } {
    var vw = innerWidth, vh = innerHeight, cells: number[] = [], gl = false, sig: string[] = [];
    var texts: number[][] = [], walker = document.createTreeWalker(document.body || document.documentElement, 4), n: Node | null, range = document.createRange();
    while ((n = walker.nextNode()) && texts.length < 2000) {
      if (!(n.textContent || "").trim() || !n.parentElement) continue;
      var ps = getComputedStyle(n.parentElement), tk = key(ps.color);
      if (tk < 0 || ps.visibility === "hidden" || Number(ps.opacity) < 0.2) continue;
      range.selectNodeContents(n);
      var rs = range.getClientRects();
      for (var i = 0; i < rs.length; i++) if (rs[i].width && rs[i].bottom > 0 && rs[i].top < vh) texts.push([rs[i].left, rs[i].top, rs[i].right, rs[i].bottom, tk]);
    }
    var cvs = [].slice.call(document.querySelectorAll("canvas")) as HTMLCanvasElement[], data: (ImageData | null)[] = [];
    for (var c = 0; c < cvs.length; c++) {
      var d: ImageData | null = null;
      try { var x = cvs[c].width && cvs[c].height ? cvs[c].getContext("2d") : null; if (x) d = x.getImageData(0, 0, cvs[c].width, cvs[c].height); } catch (_) { d = null; }
      data.push(d);
      // a fine sample of each readable canvas, so a small sprite moving shows up
      if (d) { var step = Math.max(1, Math.floor(d.data.length / 4 / 20000)) * 4, h = 0; for (var o = 0; o < d.data.length; o += step) h = (h * 31 + d.data[o] + d.data[o + 1] * 7 + d.data[o + 2] * 13) | 0; sig.push("c" + h); }
    }
    for (var gy = 0; gy < GH; gy++) for (var gx = 0; gx < GW; gx++) {
      var px = (gx + 0.5) * vw / GW, py = (gy + 0.5) * vh / GH, el = document.elementFromPoint(px, py), k = -1;
      for (var t = 0; t < texts.length && k < 0; t++) { var q = texts[t]; if (px >= q[0] && px < q[2] && py >= q[1] && py < q[3]) k = q[4]; }
      if (k < 0 && el && el.tagName === "CANVAS") {
        var cd = data[cvs.indexOf(el as HTMLCanvasElement)];
        if (!cd) gl = true;
        else {
          var br = el.getBoundingClientRect(), cx = Math.floor((px - br.left) * cd.width / br.width), cy = Math.floor((py - br.top) * cd.height / br.height), at = (cy * cd.width + cx) * 4;
          if (cd.data[at + 3] >= 128) k = (cd.data[at] >> 4) << 8 | (cd.data[at + 1] >> 4) << 4 | (cd.data[at + 2] >> 4);
        }
      }
      if (k < 0 && el && (/^(IMG|VIDEO)$/.test(el.tagName) || el.closest("svg"))) k = 0x3000 + gx * GH + gy; // a picture: varied
      if (k < 0) k = behind(el && el.tagName === "CANVAS" ? el.parentElement : el);
      cells.push(k);
    }
    // where each element sits and what it says: movement too small for the grid
    var els = document.querySelectorAll("body *");
    for (var e = 0; e < els.length && e < 600; e++) { var b = els[e].getBoundingClientRect(); if (b.width) sig.push(Math.round(b.left) + "," + Math.round(b.top) + "," + Math.round(b.width) + "," + Math.round(b.height)); }
    sig.push(document.body ? document.body.innerText : "");
    return { cells: cells, gl: gl, sig: sig.join("|") };
  }
  // share of the screen that is not its main colour (the capability test's "non-background")
  function shown(s: { cells: number[] }): number {
    var count: Record<number, number> = {}, top = 0;
    for (var i = 0; i < s.cells.length; i++) top = Math.max(top, count[s.cells[i]] = (count[s.cells[i]] || 0) + 1);
    return 1 - top / s.cells.length;
  }
  function changed(a: { cells: number[]; sig: string }, b: { cells: number[]; sig: string }): number {
    var n = 0;
    for (var i = 0; i < a.cells.length; i++) if (a.cells[i] !== b.cells[i]) n++;
    return n / a.cells.length || (a.sig !== b.sig ? 0.002 : 0);
  }
  var CODES: Record<string, number> = { Enter: 13, " ": 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, a: 65, d: 68, j: 74, k: 75, w: 87 };
  function press(type: string, k: string) {
    var code = k === " " ? "Space" : k.length === 1 ? "Key" + k.toUpperCase() : k;
    var ev = new KeyboardEvent(type, { key: k, code: code, bubbles: true, cancelable: true });
    try { Object.defineProperty(ev, "keyCode", { get: function () { return CODES[k] || 0; } }); Object.defineProperty(ev, "which", { get: function () { return CODES[k] || 0; } }); } catch (_) { /* key and code still say it */ }
    (document.activeElement || document.body || document).dispatchEvent(ev);
  }
  function tap(el: Element) {
    var r = el.getBoundingClientRect(), o = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach(function (t) {
      el.dispatchEvent(t.indexOf("pointer") === 0 && typeof PointerEvent === "function" ? new PointerEvent(t, o) : new MouseEvent(t, o));
    });
  }
  // as a player would: the Start button, a click on the play area, Enter and Space
  function start() {
    var btn = [].filter.call(document.querySelectorAll("button,a,[role=button],input[type=button],input[type=submit]"), function (b: HTMLElement) {
      return /start|play|begin|fight|new game|go\b/i.test(b.innerText || (b as HTMLInputElement).value || "") && b.getBoundingClientRect().width > 0;
    })[0] as HTMLElement | undefined;
    if (btn) tap(btn);
    var area = document.querySelector("canvas") || document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    if (area) tap(area);
    ["Enter", " "].forEach(function (k) { press("keydown", k); press("keyup", k); });
  }
  // a game, played for about three seconds: Start, then idle, then the keys
  function play(done: (s: Record<string, unknown>) => void) {
    var s0 = snap(), text0 = document.body ? document.body.innerText.trim().length : 0, a: any, b: any;
    try { start(); } catch (err: any) { add(E, err && err.message || err); }
    var taps = ["ArrowUp", "w", " ", "j", "k", "ArrowLeft", "a"], held = 0;
    function hold() {
      if (held++ < 10) { press("keydown", "ArrowRight"); press("keydown", "d"); return void setTimeout(hold, 50); }
      press("keyup", "ArrowRight"); press("keyup", "d");
      tapKeys(0);
    }
    function tapKeys(i: number) {
      if (i >= taps.length) {
        var c = snap();
        return done({ gl: s0.gl || a.gl || c.gl, text0: text0, start: shown(s0), drawn: Math.max(shown(a), shown(b), shown(c)),
          moved: Math.max(changed(s0, a), changed(a, b), changed(b, c)), keys: changed(b, c) });
      }
      press("keydown", taps[i]);
      setTimeout(function () { press("keyup", taps[i]); tapKeys(i + 1); }, 60);
    }
    setTimeout(function () { a = snap(); setTimeout(function () { b = snap(); hold(); }, 700); }, 700);
  }
  function page(): Record<string, unknown> {
    var body = document.body, cv = [].slice.call(document.querySelectorAll("canvas")) as HTMLCanvasElement[];
    // a canvas nothing was drawn on: every pixel the same (a WebGL one can't be read, so it counts as drawn)
    var blank = function (x: HTMLCanvasElement) {
      try {
        var g = x.getContext("2d");
        if (!g || !x.width || !x.height) return !g ? false : true;
        var d = g.getImageData(0, 0, Math.min(x.width, 800), Math.min(x.height, 600)).data;
        for (var i = 4; i < d.length; i += 4) if (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2] || d[i + 3] !== d[3]) return false;
        return true;
      } catch (_) { return false; }
    };
    return { text: body ? body.innerText.trim().length : 0, drawn: document.querySelectorAll("canvas,svg,img,input,button,textarea,select").length,
      shown: document.querySelectorAll("svg,img,input,button,textarea,select").length + cv.filter(function (x) { return !blank(x); }).length, canvases: cv.length };
  }
  addEventListener("message", function (e: MessageEvent) {
    var q = e.data && e.data.nexyGateAsk, kind = e.data && e.data.kind;
    if (!q) return;
    parent.postMessage({ nexyGate: q, working: true }, "*");
    function send(s: Record<string, unknown>) {
      var base = page();
      for (var k in base) if (!(k in s)) s[k] = base[k];
      s.nexyGate = q; s.errors = E; s.blocked = B; s.overlaps = overlaps();
      parent.postMessage(s, "*");
    }
    if (kind === "game") return play(send);
    var s = page();
    // an app waiting for its start: one key press and a click, then look again
    if (s.canvases && !s.shown) { try { start(); } catch (_) { /* logged */ } setTimeout(function () { send({}); }, 700); }
    else send(s);
  });
}

const PROBE = `<script>${STORAGE_SHIM}(${probe.toString()})()</script>`;

// What the probe reports. Judged apart from the page so the rules can be tested on their own.
export interface Seen {
  errors?: string[]; blocked?: string[]; overlaps?: number;
  text: number; drawn: number; shown: number; canvases?: number;
  // a game's run: share of the screen drawn at the start and after Start, change over time and with the keys
  gl?: boolean; text0?: number; start?: number; moved?: number; keys?: number;
}
// thin: an app that runs but shows next to nothing (a heading alone).
// idle: it ran without an error but does not do the job (next to no words, a blank or still game)
export interface GateResult { ok: boolean; why: string; overlaps: number; thin?: boolean; idle?: boolean }

// the capability test's own thresholds (nexy-capability-matrix realgrade.mjs, site and game)
export const SITE_TEXT = 200;
const THIN_TEXT = 40, START_SHOWN = 0.01, PLAY_SHOWN = 0.03, CHANGE = 0.0015;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

export function judge(d: Seen, kind: BuildKind = "app"): GateResult {
  const overlaps = Number(d.overlaps) || 0;
  const no = (why: string, idle = false): GateResult => ({ ok: false, why, overlaps, ...(idle ? { idle } : {}) });
  if (d.blocked?.length) return no(`it tried to load something from outside the page (${String(d.blocked[0]).slice(0, 80)})`);
  if (d.errors?.length) return no(`it throws an error when it runs: ${String(d.errors[0]).slice(0, 160)}`);
  if (kind === "site") {
    if (d.text < SITE_TEXT) return no(`the website has almost no words on it: ${d.text} characters of text, where a real page has headings and paragraphs about the business, at least ${SITE_TEXT} characters`, true);
  } else if (kind === "game") {
    // a WebGL picture cannot be read back here; such a game is judged on errors alone
    if (!d.gl) {
      if ((d.start ?? 0) < START_SHOWN && (d.text0 ?? 0) < 20) return no("the game opens on a blank screen", true);
      if ((d.drawn ?? 0) < PLAY_SHOWN) return no(`the game shows almost nothing to play: after Start only ${pct(d.drawn ?? 0)} of the screen is drawn; draw the players, the arena and the score`, true);
      if ((d.moved ?? 0) < CHANGE) return no("nothing moves or changes in the game after Start; it needs a game loop that redraws", true);
      if ((d.keys ?? 0) < CHANGE) return no("the game does not react to the controls: the arrow keys, WASD and Space change nothing on screen", true);
    }
  } else if (d.text < 3 && !d.drawn) return no("it shows nothing when it runs", true); // a small app is a heading and a few controls
  return { ok: true, why: "", overlaps, thin: kind === "app" && d.text < THIN_TEXT && !d.shown };
}

// a game's run takes about three seconds once the page has settled
const SETTLE_MS = 2500, ANSWER_MS = 2000, PLAY_MS = 8000, LOAD_MS = 15_000;

// the probe goes right after the page's no-network policy, before any of its own scripts
export function withGate(html: string): string {
  const m = /<meta http-equiv="Content-Security-Policy"[^>]*>/i.exec(html) ?? /<head[^>]*>/i.exec(html) ?? /<html[^>]*>/i.exec(html);
  return m ? html.slice(0, m.index + m[0].length) + PROBE + html.slice(m.index + m[0].length) : PROBE + html;
}

export function renderGate(html: string, kind: BuildKind = "app"): Promise<GateResult> {
  return new Promise((done) => {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts allow-forms");
    f.setAttribute("aria-hidden", "true");
    f.tabIndex = -1;
    // on screen but unseen, so its timers and animation frames run as they will in the canvas
    f.style.cssText = "position:fixed;left:0;top:0;width:1024px;height:768px;opacity:0;pointer-events:none;z-index:-1;border:0";
    const ask = `g${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    let settled = false, froze: ReturnType<typeof setTimeout> | undefined;
    const finish = (r: GateResult) => {
      if (settled) return;
      settled = true;
      removeEventListener("message", onMsg);
      clearTimeout(noLoad);
      clearTimeout(froze);
      f.remove();
      done(r);
    };
    const frozen = (ms: number) => { clearTimeout(froze); froze = setTimeout(() => finish({ ok: false, why: "it froze when it ran", overlaps: 0 }), ms); };
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (e.source !== f.contentWindow || d?.nexyGate !== ask) return;
      // the probe has started; a game takes longer to play than a page takes to read
      if (d.working) return void (kind === "game" && frozen(PLAY_MS));
      finish(judge(d, kind));
    };
    addEventListener("message", onMsg);
    const noLoad = setTimeout(() => finish({ ok: false, why: "it did not finish loading", overlaps: 0 }), LOAD_MS);
    f.addEventListener("load", () => {
      clearTimeout(noLoad);
      setTimeout(() => {
        f.contentWindow?.postMessage({ nexyGateAsk: ask, kind }, "*");
        frozen(ANSWER_MS);
      }, SETTLE_MS);
    }, { once: true });
    f.srcdoc = withGate(html);
    document.body.append(f);
  });
}
