// The check a page built on this computer passes before it is shown, run on pages known to work
// and pages known not to, the kinds the capability test found shown as "Done… it runs": a
// tester's black screen with one button, games with no loop or no script, a website of one line.
// The check is bundled from src/client/build-gate.ts and run in Chromium, as in the app.
//   PLAYWRIGHT_MODULE=<path to playwright> node --test tests/build-gate.cjs
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSync } = require('esbuild');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const GATE = buildSync({ entryPoints: [path.join(__dirname, '..', 'src', 'client', 'build-gate.ts')], bundle: true, write: false, format: 'iife', globalName: 'NexyGate', target: ['chrome91', 'safari15'], minify: true }).outputFiles[0].text;
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">`;
const page = (body, script = '', style = '') => `<!doctype html><html><head>${CSP}<style>body{margin:0;font-family:sans-serif}${style}</style></head><body>${body}<script>${script}</script></body></html>`;
const WORDS = '<p>Fresh sourdough, rye and pastries are baked here every morning before the sun is up. Come in for a warm loaf and a coffee, order a cake for a birthday, or ask us about bread for your cafe.</p>';

const BROKEN = {
  // a tester saw this: a black screen with one button that does nothing
  'a black screen with one button': ['game', page('<button>Start</button><canvas id="c" width="900" height="600"></canvas>', 'var x=document.getElementById("c").getContext("2d");x.fillStyle="#000";x.fillRect(0,0,900,600);', 'body{background:#000}')],
  // as a 1.7B model wrote it: key labels and no script
  'a game with no script': ['game', page('<h1>Street Fighter Game</h1><div id="game"><div class="key">W</div><div class="key">A</div><div class="key">D</div><div class="key">Space</div></div>', '',
    'body{background:#222;color:#fff}#game{height:100vh;background:#111;display:flex;gap:10px;align-items:center;justify-content:center}.key{background:#333;padding:10px 15px}')],
  'a game drawn once that never moves': ['game', page('<canvas id="c" width="800" height="500"></canvas>',
    'var x=document.getElementById("c").getContext("2d");x.fillStyle="#123";x.fillRect(0,0,800,500);x.fillStyle="#e33";x.fillRect(100,300,60,120);x.fillStyle="#39f";x.fillRect(600,300,60,120);x.fillStyle="#2a5";x.fillRect(0,420,800,80);')],
  'a website of one line': ['site', page('<h1>Sunrise Bakery</h1><p>Fresh bread daily.</p>')],
  'a website that throws': ['site', page('<h1>Sunrise Bakery</h1>' + WORDS, 'document.querySelector("#menu").addEventListener("click",function(){})')],
};
const GOOD = {
  'a canvas game that plays': ['game', page('<canvas id="c" width="800" height="500"></canvas>',
    'var c=document.getElementById("c"),x=c.getContext("2d"),p=100,t=0,k={};addEventListener("keydown",function(e){k[e.key]=true});addEventListener("keyup",function(e){k[e.key]=false});' +
    'function f(){t++;if(k.ArrowRight||k.d)p+=6;x.fillStyle="#123";x.fillRect(0,0,800,500);x.fillStyle="#2a5";x.fillRect(0,420,800,80);x.fillStyle="#e33";x.fillRect(p,300+Math.sin(t/5)*4,60,120);x.fillStyle="#39f";x.fillRect(600,300,60,120);x.fillStyle="#fd0";x.fillRect(20,20,300,24);x.fillRect(480,20,300,24);requestAnimationFrame(f)}f();')],
  // after a Start button, fighters made of boxes, moved by keyCode as older code does
  'a page game with a Start button': ['game', page('<div id="menu"><h1>Street Fighter</h1><button id="go">Start game</button></div><div id="arena" hidden><div id="p1" class="f"></div><div id="p2" class="f"></div><div id="hp"></div></div>',
    'var x=80;document.getElementById("go").onclick=function(){document.getElementById("menu").hidden=true;document.getElementById("arena").hidden=false};' +
    'document.addEventListener("keydown",function(e){if(e.keyCode===39)x+=8;if(e.keyCode===37)x-=8;document.getElementById("p1").style.left=x+"px"});',
    'body{background:#101018;color:#fff}#arena{position:relative;height:600px;background:#2b3a55}.f{position:absolute;top:300px;width:70px;height:160px}#p1{left:80px;background:#e33}#p2{left:700px;background:#39f}#hp{position:absolute;left:20px;top:20px;width:400px;height:24px;background:#fd0}')],
  'a website with real words': ['site', page('<h1>Sunrise Bakery</h1><h2>Our bread</h2>' + WORDS)],
  'a small app with a button': ['app', page('<h1>Timer</h1><button>Start</button>')],
};

let b, pg;
test.before(async () => {
  b = await chromium.launch();
  pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await pg.setContent('<!doctype html><html><body></body></html>');
  await pg.addScriptTag({ content: GATE });
});
test.after(() => b && b.close());
const gate = (html, kind) => pg.evaluate(([h, k]) => window.NexyGate.renderGate(h, k), [html, kind]);

for (const [name, [kind, html]] of Object.entries(BROKEN)) {
  test(`kept back: ${name}`, async () => {
    const r = await gate(html, kind);
    assert.equal(r.ok, false, `passed: ${JSON.stringify(r)}`);
    assert.ok(r.why.length > 10);
  });
}
for (const [name, [kind, html]] of Object.entries(GOOD)) {
  test(`shown: ${name}`, async () => {
    const r = await gate(html, kind);
    assert.equal(r.ok, true, r.why);
  });
}

test('the reasons are plain and say what to fix', async () => {
  assert.match((await gate(BROKEN['a website of one line'][1], 'site')).why, /^the website has almost no words on it: \d+ characters/);
  assert.match((await gate(BROKEN['a game with no script'][1], 'game')).why, /^nothing moves or changes in the game after Start/);
  assert.match((await gate(BROKEN['a black screen with one button'][1], 'game')).why, /^the game (?:opens on a blank screen|shows almost nothing to play)/);
  assert.equal((await gate(BROKEN['a website that throws'][1], 'site')).idle, undefined);
  assert.equal((await gate(BROKEN['a website of one line'][1], 'site')).idle, true);
});
