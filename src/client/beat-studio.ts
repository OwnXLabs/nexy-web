import type { Artifact } from "./canvas";
import { themedHTML } from "./theme-apps";

// Iframe -> parent messages: { nexyToast: string } and { nexySave: { name, mime: "audio/wav", dataUrl } }.
// The parent acknowledges a save with { nexySaved: name } posted to the iframe; without it the button reads "Not saved".

export type BeatPreset = "gfunk" | "boombap" | "trap" | "house";

const PRESETS: [BeatPreset, RegExp][] = [
  ["trap", /trap|drill|808|atlanta|night drive/],
  ["house", /house|techno|edm|disco|dance|club|garage|sunset/],
  ["boombap", /boom ?bap|90s|nineties|east coast|hip ?hop|dilla|lo-?fi|jazz|dusty/],
  ["gfunk", /g-?funk|west coast|snoop|dre|low ?rider|funk/],
];

export function beatPreset(text = ""): BeatPreset {
  const s = text.toLowerCase();
  return PRESETS.find(([, re]) => re.test(s))?.[0] ?? "gfunk";
}

const TRACKS: [RegExp, number][] = [
  [/kick|bass ?drum|\bbd\b/, 0],
  [/snare|rim|\bsd\b/, 1],
  [/clap/, 2],
  [/open/, 4],
  [/hat|hh|cymbal|ride|shaker/, 3],
  [/bass|808|sub/, 5],
  [/lead|melody|synth|whistle|keys|piano/, 6],
  [/pad|chord|string/, 7],
];
const ACCENTED = new Set([0, 1, 2, 5]);

function toRows(steps: Record<string, number[]>): (number[] | null)[] {
  const rows: (number[] | null)[] = Array.from({ length: 8 }, () => null);
  for (const [key, hits] of Object.entries(steps)) {
    const name = key.toLowerCase().replace(/[_-]+/g, " ");
    const r = TRACKS.find(([re]) => re.test(name))?.[1];
    if (r === undefined || !Array.isArray(hits)) continue;
    const row = rows[r] ?? (rows[r] = Array<number>(16).fill(0));
    for (const n of hits) {
      if (!Number.isInteger(n) || n < 1 || n > 16) continue;
      row[n - 1] = ACCENTED.has(r) && (n - 1) % 4 === 0 ? 2 : 1;
    }
  }
  return rows;
}

const attr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const escText = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const NOTE =
  "Eight tracks, two patterns, presets, per-track sound shaping, master effects, WAV render. Everything synthesised on device.";

export function beatStudioArtifact(o: { title: string; bpm?: number; preset?: string; steps?: Record<string, number[]> }): Artifact {
  const bpm = Number.isFinite(o.bpm) ? Math.round(Math.min(200, Math.max(50, o.bpm!))) : 0;
  const seed = {
    preset: beatPreset(o.preset ?? o.title),
    bpm,
    steps: o.steps ? toRows(o.steps) : null,
  };
  const html = studioHTML(JSON.stringify(seed).replace(/</g, "\\u003c"));
  return {
    id: `audio:studio:${o.title}`,
    kind: "audio",
    title: o.title,
    meta: NOTE,
    render(host) {
      host.innerHTML =
        `<div class="frame tall studio"><iframe sandbox="allow-scripts allow-downloads" title="Beat studio" srcdoc="${attr(themedHTML(html))}"></iframe></div>` +
        `<div class="cvnote">${escText(NOTE)}</div>`;
    },
  };
}

function studioHTML(seed: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
:root{--bg:#0d0d12;--p:#15151d;--p2:#1c1c26;--line:#262633;--fg:#e8e8f0;--fg2:#9a9ab0;--fg3:#6b6b80;--acc:#7C5CFF;--warm:#FF8C68}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--fg);font:12px/1.4 -apple-system,Inter,system-ui,sans-serif;user-select:none;container-type:inline-size;display:flex;flex-direction:column;min-height:100%;overflow:auto}
button,input,select{font:inherit;color:inherit}
button{background:none;border:0;cursor:pointer}
.hdr{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--line);flex-wrap:wrap;flex:none}
.play{width:40px;height:40px;border-radius:50%;background:var(--acc);color:#fff;display:grid;place-items:center;flex:none}
.play.on{background:var(--warm)}
.play svg{width:16px;height:16px;fill:currentColor}
.title{font-weight:600;font-size:14px;margin-right:4px}
.pos{font-variant-numeric:tabular-nums;color:var(--fg2);background:var(--p);padding:5px 9px;border-radius:7px;min-width:64px;text-align:center}
.fld{display:flex;align-items:center;gap:6px;background:var(--p);padding:4px 6px 4px 9px;border-radius:8px;color:var(--fg2)}
.fld input[type=number]{width:52px;background:var(--bg);border:1px solid var(--line);color:var(--fg);border-radius:6px;padding:4px 6px;outline:0}
.fld input[type=range]{width:80px}
.sp{flex:1}
.pre{display:flex;gap:4px;background:var(--p);padding:3px;border-radius:8px}
.pre button{padding:5px 9px;border-radius:6px;color:var(--fg2)}.pre button:hover{color:#fff}.pre button.on{background:var(--p2);color:#fff}
.btn{height:30px;padding:0 11px;border-radius:8px;background:var(--p);color:var(--fg);display:inline-flex;align-items:center;gap:6px}
.btn:hover{background:var(--p2)}.btn.acc{background:var(--acc);color:#fff}.btn.acc:hover{background:#8f74ff}
.btn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.main{display:grid;grid-template-columns:1fr 300px;gap:10px;padding:10px 12px;flex:1;min-height:0;align-content:start}
@container (max-width:760px){.main{grid-template-columns:1fr}.side{grid-template-columns:1fr 1fr}}
@container (max-width:480px){.side{grid-template-columns:1fr}.tr .nm span{display:none}.tr,.bar{grid-template-columns:34px repeat(16,minmax(18px,1fr)) 30px}.gw{overflow-x:auto;padding-bottom:4px}}
.seq{background:var(--p);border-radius:12px;padding:10px;min-width:0}
.gw{min-width:0}
.bar{display:grid;grid-template-columns:104px repeat(16,minmax(18px,1fr)) 30px;gap:3px;margin:0 0 6px;align-items:center}
.bar b{font-size:10px;color:var(--fg3);text-align:center;font-weight:500}.bar b:nth-child(4n+2){color:var(--fg2)}
.tr{display:grid;grid-template-columns:104px repeat(16,minmax(18px,1fr)) 30px;gap:3px;align-items:center;margin-bottom:4px}
.tr .nm{display:flex;align-items:center;gap:6px;height:100%;padding:0 6px;border-radius:7px;cursor:pointer;min-width:0;white-space:nowrap;overflow:hidden}
.tr .nm i{width:9px;height:9px;border-radius:50%;background:var(--c);flex:none}
.tr .nm span{overflow:hidden;text-overflow:ellipsis}
.tr.sel .nm{background:var(--p2);color:#fff}
.st{aspect-ratio:1;min-width:0;border-radius:5px;background:#1a1a24;border:1px solid transparent;position:relative}
.st:nth-child(4n+2){background:#20202c}
.st.on{background:var(--c)}
.st.acc::after{content:"";position:absolute;left:3px;right:3px;bottom:3px;height:2px;background:#fff;border-radius:2px;opacity:.8}
.st.cur{border-color:#fff}
.tr.muted .st.on{opacity:.3;box-shadow:none}
.ms{display:flex;flex-direction:column;gap:2px}
.ms button{width:100%;height:12px;font-size:9px;border-radius:3px;background:#1a1a24;color:var(--fg3);line-height:12px;padding:0}
.ms button.on{background:var(--warm);color:#1a0c08}.ms button.s.on{background:#FFD166}
.side{display:grid;grid-template-columns:1fr;gap:10px;align-content:start;min-width:0}
.card{background:var(--p);border-radius:12px;padding:10px}
.card h4{margin:0 0 8px;font-size:11px;color:var(--fg3);font-weight:500;letter-spacing:.02em;display:flex;justify-content:space-between}
.card h4 b{color:#fff;font-weight:500}
.kn{display:grid;grid-template-columns:1fr 1fr;gap:8px 12px}
.kn label{display:block;font-size:11px;color:var(--fg2);margin-bottom:3px;display:flex;justify-content:space-between}
.kn label i{font-style:normal;color:var(--fg3);font-variant-numeric:tabular-nums}
input[type=range]{-webkit-appearance:none;width:100%;height:4px;background:#2a2a36;border-radius:2px;outline:0}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#fff;cursor:pointer}
.vis{height:74px;border-radius:8px;background:var(--bg);overflow:hidden;position:relative}
.vis canvas{width:100%;height:100%;display:block}
.foot{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.hint{color:var(--fg3);font-size:11px;padding:0 12px 10px}
</style></head><body>
<div class="hdr">
  <button class="play" id="play" title="Play, space"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>
  <span class="title" id="title">Low Rider Groove</span>
  <span class="pos" id="pos">1.1</span>
  <span class="fld">BPM <input id="bpm" type="number" value="92" min="50" max="200"></span>
  <span class="fld">Swing <input id="swing" type="range" min="0" max="60" value="18"></span>
  <span class="fld">Master <input id="master" type="range" min="0" max="1" step="0.01" value="0.85"></span>
  <span class="sp"></span>
  <div class="pre" id="pat"><button class="on" data-p="A">A</button><button data-p="B">B</button><button data-p="chain" title="Play A then B">A+B</button></div>
  <div class="pre" id="presets"><button class="on" data-pre="gfunk">G-funk</button><button data-pre="boombap">Boom bap</button><button data-pre="trap">Trap</button><button data-pre="house">House</button></div>
  <button class="btn" id="clear" title="Clear pattern"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>Clear</button>
  <button class="btn" id="rnd" title="Randomise hats and lead"><svg viewBox="0 0 24 24"><path d="M4 7h4l8 10h4M4 17h4l2-2.5M14 7h6"/></svg>Vary</button>
  <button class="btn" id="wav" title="Render two bars to WAV"><svg viewBox="0 0 24 24"><path d="M12 4v11m0 0 4-4m-4 4-4-4M5 19h14"/></svg>WAV</button>
  <button class="btn acc" id="save">Save to project</button>
</div>
<div class="main">
  <div class="seq">
    <div class="gw"><div class="bar" id="barhead"></div>
    <div id="grid"></div></div>
    <div class="hint">Click a step to add it, click again to accent, a third click clears. Click a track name to shape its sound. M mutes, S solos.</div>
  </div>
  <div class="side">
    <div class="card"><h4><b id="selName">Kick</b><span>Sound</span></h4><div class="kn" id="knobs"></div></div>
    <div class="card"><h4><b>Master</b><span>Effects</span></h4><div class="kn">
      <div><label>Reverb <i id="v-rev">25%</i></label><input type="range" id="rev" min="0" max="1" step="0.01" value="0.25"></div>
      <div><label>Delay <i id="v-dly">15%</i></label><input type="range" id="dly" min="0" max="1" step="0.01" value="0.15"></div>
      <div><label>Filter <i id="v-flt">open</i></label><input type="range" id="flt" min="200" max="18000" step="10" value="18000"></div>
      <div><label>Drive <i id="v-drv">10%</i></label><input type="range" id="drv" min="0" max="1" step="0.01" value="0.1"></div>
    </div></div>
    <div class="card"><h4><b>Output</b><span id="vismode">waveform</span></h4><div class="vis"><canvas id="vis" width="600" height="148"></canvas></div></div>
  </div>
</div>
<script>
var SEED=${seed};
var T=[
 {n:'Kick',c:'#FF8C68',k:'kick',p:{decay:0.35,tone:150,pitch:0},A:[2,0,0,0,0,0,1,0,0,0,2,0,0,0,0,0],B:[2,0,0,0,0,0,1,0,0,0,2,0,0,1,0,0]},
 {n:'Snare',c:'#FFD166',k:'snare',p:{decay:0.18,tone:1500,pitch:0},A:[0,0,0,0,2,0,0,0,0,0,0,0,2,0,0,1],B:[0,0,0,0,2,0,0,1,0,0,0,0,2,0,1,0]},
 {n:'Clap',c:'#F49AD3',k:'clap',p:{decay:0.22,tone:1200,pitch:0},A:[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],B:[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0]},
 {n:'Hat',c:'#3BD1C4',k:'hat',p:{decay:0.05,tone:7000,pitch:0},A:[1,0,1,0,1,0,1,0,1,0,1,1,1,0,1,0],B:[1,0,1,0,1,0,1,1,1,0,1,0,1,0,1,1]},
 {n:'Open hat',c:'#8AF7C9',k:'ohat',p:{decay:0.25,tone:6000,pitch:0},A:[0,0,0,0,0,0,0,1,0,0,0,0,0,0,0,1],B:[0,0,0,1,0,0,0,0,0,0,0,1,0,0,0,0]},
 {n:'Bass',c:'#7C5CFF',k:'bass',p:{decay:0.3,tone:600,pitch:0},A:[2,0,0,1,0,0,1,0,0,0,2,0,0,1,0,0],B:[2,0,0,0,1,0,0,1,0,0,2,0,0,0,1,0]},
 {n:'Lead',c:'#FF3D81',k:'lead',p:{decay:0.35,tone:1800,pitch:0},A:[0,0,1,0,0,0,0,1,0,0,1,0,0,0,1,0],B:[0,0,0,1,0,0,1,0,0,0,0,1,0,0,0,1]},
 {n:'Pad',c:'#9999FF',k:'pad',p:{decay:1.2,tone:900,pitch:0},A:[1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0],B:[1,0,0,0,0,0,0,0,0,0,0,0,1,0,0,0]}
];
var bassN=[55,55,65.4,55,49,55,65.4,55,55,55,73.4,55,55,65.4,55,49],leadN=[440,0,523,0,0,0,0,587,0,0,659,0,0,0,523,0],padN=[[220,261.6,329.6],[196,246.9,293.7]];
var PRE={
 gfunk:{bpm:92,sw:18,title:'Low Rider Groove',pat:T.map(function(t){return t.A.slice()}),patB:T.map(function(t){return t.B.slice()})},
 boombap:{bpm:88,sw:30,title:'Dusty Corner',pat:[[2,0,0,0,0,0,2,0,0,1,0,0,0,0,0,0],[0,0,0,0,2,0,0,0,0,0,0,0,2,0,0,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],[1,0,1,0,1,0,1,0,1,0,1,0,1,0,1,0],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],[2,0,0,0,0,0,1,0,0,1,0,0,0,0,1,0],[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]},
 trap:{bpm:140,sw:0,title:'Night Drive',pat:[[2,0,0,0,0,0,0,1,0,0,1,0,0,0,0,0],[0,0,0,0,2,0,0,0,0,0,0,0,2,0,0,0],[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],[1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],[0,0,0,0,0,0,0,0,0,0,0,0,0,0,1,0],[2,0,0,0,0,0,0,1,0,0,2,0,0,0,0,0],[0,0,0,1,0,0,0,0,0,0,1,0,0,0,0,0],[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]},
 house:{bpm:124,sw:8,title:'Sunset Terrace',pat:[[2,0,0,0,2,0,0,0,2,0,0,0,2,0,0,0],[0,0,0,0,1,0,0,0,0,0,0,0,1,0,0,0],[0,0,0,0,2,0,0,0,0,0,0,0,2,0,0,0],[0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],[0,0,1,0,0,0,1,0,0,0,1,0,0,0,1,0],[1,0,0,1,0,0,1,0,1,0,0,1,0,0,1,0],[0,0,0,0,0,0,0,0,1,0,0,1,0,0,0,0],[1,0,0,0,0,0,0,0,1,0,0,0,0,0,0,0]]}
};
var cur='A',chain=false,sel=0,vols=T.map(function(){return 0.8}),mute=T.map(function(){return false}),solo=T.map(function(){return false});
var $=function(s){return document.querySelector(s)},$$=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))};
function pat(t){return cur==='B'?t.B:t.A}
function toast(text){parent.postMessage({nexyToast:text},'*')}
/* ---------- grid ---------- */
var head=$('#barhead');head.innerHTML='<span></span>'+Array.apply(null,Array(16)).map(function(_,i){return '<b>'+(i%4===0?(i/4+1):'·')+'</b>'}).join('')+'<span></span>';
function buildGrid(){var g=$('#grid');g.innerHTML='';T.forEach(function(t,r){var row=document.createElement('div');row.className='tr'+(r===sel?' sel':'')+(isMuted(r)?' muted':'');row.style.setProperty('--c',t.c);
  var nm=document.createElement('div');nm.className='nm';nm.innerHTML='<i></i><span>'+t.n+'</span>';nm.onclick=function(){sel=r;buildGrid();buildKnobs()};row.appendChild(nm);
  var p=pat(t);for(var i=0;i<16;i++){var s=document.createElement('button');s.className='st'+(p[i]?' on':'')+(p[i]===2?' acc':'');s.dataset.r=r;s.dataset.i=i;s.onclick=function(){var P=pat(T[this.dataset.r]);P[this.dataset.i]=(P[this.dataset.i]+1)%3;buildGrid()};row.appendChild(s)}
  var ms=document.createElement('div');ms.className='ms';ms.innerHTML='<button class="m'+(mute[r]?' on':'')+'" title="Mute">M</button><button class="s'+(solo[r]?' on':'')+'" title="Solo">S</button>';ms.children[0].onclick=function(){mute[r]=!mute[r];buildGrid()};ms.children[1].onclick=function(){solo[r]=!solo[r];buildGrid()};row.appendChild(ms);g.appendChild(row)})}
function isMuted(r){var anySolo=solo.some(function(x){return x});return mute[r]||(anySolo&&!solo[r])}
function buildKnobs(){var t=T[sel];$('#selName').textContent=t.n;var k=$('#knobs');k.innerHTML='';
  [['Volume','vol',0,1,0.01,vols[sel],function(v){vols[sel]=v}],['Decay','decay',0.03,2,0.01,t.p.decay,function(v){t.p.decay=v}],['Tone','tone',60,12000,10,t.p.tone,function(v){t.p.tone=v}],['Pitch','pitch',-12,12,1,t.p.pitch,function(v){t.p.pitch=v}]].forEach(function(d){var w=document.createElement('div');w.innerHTML='<label>'+d[0]+' <i>'+fmt(d[1],d[5])+'</i></label><input type="range" min="'+d[2]+'" max="'+d[3]+'" step="'+d[4]+'" value="'+d[5]+'">';var inp=w.querySelector('input');inp.oninput=function(){d[6](+inp.value);w.querySelector('i').textContent=fmt(d[1],+inp.value)};k.appendChild(w)})}
function fmt(k,v){return k==='vol'?Math.round(v*100)+'%':k==='decay'?v.toFixed(2)+'s':k==='tone'?Math.round(v)+' Hz':(v>0?'+':'')+v+' st'}
/* ---------- audio ---------- */
var A=null,master,an,revG,dly,dlyG,flt,drive,BUS,step=0,next=0,on=false,timer=null,bar=0;
function mkImpulse(ctx,sec,decay){var len=ctx.sampleRate*sec,b=ctx.createBuffer(2,len,ctx.sampleRate);for(var c=0;c<2;c++){var d=b.getChannelData(c);for(var i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,decay)}return b}
function graph(ctx){var g={};g.master=ctx.createGain();g.master.gain.value=+$('#master').value;g.flt=ctx.createBiquadFilter();g.flt.type='lowpass';g.flt.frequency.value=+$('#flt').value;g.drive=ctx.createWaveShaper();setDrive(g.drive,+$('#drv').value);
  g.rev=ctx.createConvolver();g.rev.buffer=mkImpulse(ctx,1.8,3);g.revG=ctx.createGain();g.revG.gain.value=+$('#rev').value;g.dly=ctx.createDelay(1);g.dly.delayTime.value=60/(+$('#bpm').value||92)*0.75;g.dlyG=ctx.createGain();g.dlyG.gain.value=+$('#dly').value;g.dlyFb=ctx.createGain();g.dlyFb.gain.value=0.35;
  g.bus=ctx.createGain();g.bus.connect(g.drive);g.drive.connect(g.flt);g.flt.connect(g.master);g.bus.connect(g.revG);g.revG.connect(g.rev);g.rev.connect(g.master);g.bus.connect(g.dlyG);g.dlyG.connect(g.dly);g.dly.connect(g.dlyFb);g.dlyFb.connect(g.dly);g.dly.connect(g.master);return g}
function setDrive(ws,a){var n=256,c=new Float32Array(n),k=a*40;for(var i=0;i<n;i++){var x=i*2/n-1;c[i]=k?(1+k)*x/(1+k*Math.abs(x)):x}ws.curve=c}
function ctx(){if(A)return A;A=new (window.AudioContext||window.webkitAudioContext)();var g=graph(A);master=g.master;flt=g.flt;drive=g.drive;revG=g.revG;dly=g.dly;dlyG=g.dlyG;BUS=g.bus;an=A.createAnalyser();an.fftSize=1024;master.connect(an);an.connect(A.destination);return A}
function voice(ctx,bus,t,tm,i,acc,vol){var p=t.p,v=vol*(acc?1:0.72),pitch=Math.pow(2,p.pitch/12);
  if(t.k==='kick'){var o=ctx.createOscillator(),g=ctx.createGain();o.frequency.setValueAtTime(p.tone*pitch,tm);o.frequency.exponentialRampToValueAtTime(40*pitch,tm+p.decay*0.6);g.gain.setValueAtTime(v,tm);g.gain.exponentialRampToValueAtTime(0.001,tm+p.decay);o.connect(g);g.connect(bus);o.start(tm);o.stop(tm+p.decay+0.05);var c=ctx.createOscillator(),cg=ctx.createGain();c.frequency.value=1200;cg.gain.setValueAtTime(v*0.3,tm);cg.gain.exponentialRampToValueAtTime(0.001,tm+0.02);c.connect(cg);cg.connect(bus);c.start(tm);c.stop(tm+0.03)}
  else if(t.k==='snare'||t.k==='clap'||t.k==='hat'||t.k==='ohat'){var len=t.k==='clap'?p.decay+0.06:p.decay,b=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*len),ctx.sampleRate),d=b.getChannelData(0);for(var j=0;j<d.length;j++)d[j]=Math.random()*2-1;var s=ctx.createBufferSource();s.buffer=b;var f=ctx.createBiquadFilter();f.type=t.k==='hat'||t.k==='ohat'?'highpass':'bandpass';f.frequency.value=p.tone*pitch;f.Q.value=t.k==='clap'?1.2:0.7;var g2=ctx.createGain();
    if(t.k==='clap'){g2.gain.setValueAtTime(0,tm);[0,0.01,0.02,0.03].forEach(function(o){g2.gain.setValueAtTime(v*0.8,tm+o);g2.gain.exponentialRampToValueAtTime(0.05,tm+o+0.009)});g2.gain.setValueAtTime(v*0.7,tm+0.035);g2.gain.exponentialRampToValueAtTime(0.001,tm+len)}else{g2.gain.setValueAtTime(v*(t.k==='snare'?0.9:0.5),tm);g2.gain.exponentialRampToValueAtTime(0.001,tm+len)}
    s.connect(f);f.connect(g2);g2.connect(bus);s.start(tm);if(t.k==='snare'){var o2=ctx.createOscillator(),g3=ctx.createGain();o2.frequency.value=190*pitch;g3.gain.setValueAtTime(v*0.5,tm);g3.gain.exponentialRampToValueAtTime(0.001,tm+0.1);o2.connect(g3);g3.connect(bus);o2.start(tm);o2.stop(tm+0.12)}}
  else if(t.k==='bass'){var o3=ctx.createOscillator(),g4=ctx.createGain(),f2=ctx.createBiquadFilter();o3.type='sawtooth';o3.frequency.value=bassN[i]*pitch;f2.type='lowpass';f2.frequency.setValueAtTime(p.tone,tm);f2.frequency.exponentialRampToValueAtTime(90,tm+p.decay);g4.gain.setValueAtTime(v*0.55,tm);g4.gain.exponentialRampToValueAtTime(0.001,tm+p.decay);o3.connect(f2);f2.connect(g4);g4.connect(bus);o3.start(tm);o3.stop(tm+p.decay+0.05)}
  else if(t.k==='lead'){var n=(leadN[i]||440)*pitch,o4=ctx.createOscillator(),o5=ctx.createOscillator(),g5=ctx.createGain(),f3=ctx.createBiquadFilter();o4.type='square';o5.type='square';o4.frequency.setValueAtTime(n*1.03,tm);o4.frequency.exponentialRampToValueAtTime(n,tm+0.06);o5.frequency.value=n*1.004;f3.type='lowpass';f3.frequency.value=p.tone;g5.gain.setValueAtTime(0.0001,tm);g5.gain.exponentialRampToValueAtTime(v*0.16,tm+0.02);g5.gain.exponentialRampToValueAtTime(0.001,tm+p.decay);o4.connect(f3);o5.connect(f3);f3.connect(g5);g5.connect(bus);o4.start(tm);o5.start(tm);o4.stop(tm+p.decay+0.05);o5.stop(tm+p.decay+0.05)}
  else if(t.k==='pad'){padN[(i>=8)?1:0].forEach(function(fq){var o6=ctx.createOscillator(),g6=ctx.createGain(),f4=ctx.createBiquadFilter();o6.type='triangle';o6.frequency.value=fq*pitch;o6.detune.value=(Math.random()-0.5)*14;f4.type='lowpass';f4.frequency.value=p.tone;g6.gain.setValueAtTime(0.0001,tm);g6.gain.exponentialRampToValueAtTime(v*0.07,tm+0.12);g6.gain.exponentialRampToValueAtTime(0.001,tm+p.decay);o6.connect(f4);f4.connect(g6);g6.connect(bus);o6.start(tm);o6.stop(tm+p.decay+0.1)})}
}
function sched(){var bpm=+$('#bpm').value||92,sw=(+$('#swing').value)/100,spb=60/bpm/4;while(next<A.currentTime+0.12){var tm=next+((step%2)?spb*sw*0.5:0);T.forEach(function(t,r){var p=pat(t);if(!p[step]||isMuted(r))return;voice(A,BUS,t,tm,step,p[step]===2,vols[r])});
  (function(s,b){setTimeout(function(){if(!on)return;$$('.st.cur').forEach(function(e){e.classList.remove('cur')});$$('.st[data-i="'+s+'"]').forEach(function(e){e.classList.add('cur')});$('#pos').textContent=(b+1)+'.'+(Math.floor(s/4)+1)},Math.max(0,(tm-A.currentTime)*1000))})(step,bar);
  step++;if(step>=16){step=0;bar++;if(chain){cur=cur==='A'?'B':'A';syncPat();buildGrid()}}next+=spb}}
var PLAY='<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',PAUSE='<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
function toggle(){ctx();if(A.state==='suspended')A.resume().catch(function(e){toast('Audio could not start: '+e.message)});on=!on;$('#play').classList.toggle('on',on);$('#play').innerHTML=on?PAUSE:PLAY;if(on){step=0;bar=0;next=A.currentTime+0.05;timer=setInterval(sched,25);return}clearInterval(timer);$$('.st.cur').forEach(function(e){e.classList.remove('cur')})}
$('#play').onclick=toggle;addEventListener('keydown',function(e){if(e.code==='Space'&&!/INPUT/.test(document.activeElement.tagName)){e.preventDefault();toggle()}});
/* ---------- controls ---------- */
['rev','dly','flt','drv','master'].forEach(function(id){$('#'+id).oninput=function(){var v=+this.value;if(id==='rev'){$('#v-rev').textContent=Math.round(v*100)+'%';if(revG)revG.gain.value=v}if(id==='dly'){$('#v-dly').textContent=Math.round(v*100)+'%';if(dlyG)dlyG.gain.value=v}if(id==='flt'){$('#v-flt').textContent=v>=17000?'open':Math.round(v)+' Hz';if(flt)flt.frequency.value=v}if(id==='drv'){$('#v-drv').textContent=Math.round(v*100)+'%';if(drive)setDrive(drive,v)}if(id==='master'&&master)master.gain.value=v}});
$('#bpm').onchange=function(){if(dly)dly.delayTime.value=60/(+this.value||92)*0.75};
function syncPat(){$$('#pat button').forEach(function(b){b.classList.toggle('on',b.dataset.p==='chain'?chain:b.dataset.p===cur)})}
$$('#pat button').forEach(function(b){b.onclick=function(){if(b.dataset.p==='chain'){chain=!chain;syncPat();return}cur=b.dataset.p;syncPat();buildGrid()}});
function loadPreset(key){var p=PRE[key];if(!p)return;$$('#presets button').forEach(function(x){x.classList.toggle('on',x.dataset.pre===key)});$('#bpm').value=p.bpm;$('#swing').value=p.sw;$('#title').textContent=p.title;T.forEach(function(t,r){t.A=p.pat[r].slice();t.B=p.patB?p.patB[r].slice():p.pat[r].map(function(x,i){return i%4===3?0:x})});cur='A';syncPat();if(dly)dly.delayTime.value=60/p.bpm*0.75}
$$('#presets button').forEach(function(b){b.onclick=function(){loadPreset(b.dataset.pre);buildGrid()}});
$('#clear').onclick=function(){T.forEach(function(t){var p=pat(t);for(var i=0;i<16;i++)p[i]=0});buildGrid()};
$('#rnd').onclick=function(){T.forEach(function(t){if(t.k!=='hat'&&t.k!=='lead'&&t.k!=='ohat')return;var p=pat(t);for(var i=0;i<16;i++){if(t.k==='hat')p[i]=Math.random()<0.7?1:0;else if(t.k==='ohat')p[i]=Math.random()<0.1?1:0;else p[i]=Math.random()<0.28?1:0}});buildGrid()};
/* ---------- seed ---------- */
loadPreset(SEED.preset);
if(SEED.bpm){$('#bpm').value=SEED.bpm}
if(SEED.steps)SEED.steps.forEach(function(row,r){if(!row)return;T[r].A=row.slice();T[r].B=row.slice()});
buildGrid();buildKnobs();
/* ---------- render to wav ---------- */
function fileName(){return ($('#title').textContent.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'beat')+'.wav'}
function render(){var bpm=+$('#bpm').value||92,spb=60/bpm/4,dur=spb*32+1.5,sr=44100,oc=new OfflineAudioContext(2,Math.ceil(sr*dur),sr),g=graph(oc);g.master.connect(oc.destination);var sw=(+$('#swing').value)/100,t=0.05;
  for(var s=0;s<32;s++){var i=s%16,tm=t+((s%2)?spb*sw*0.5:0);T.forEach(function(tr,r){var p=pat(tr);if(!p[i]||isMuted(r))return;voice(oc,g.bus,tr,tm,i,p[i]===2,vols[r])});t+=spb}
  return oc.startRendering().then(toWav)}
function toWav(b){var n=b.length,ch=b.numberOfChannels,sr=b.sampleRate,out=new ArrayBuffer(44+n*ch*2),v=new DataView(out),p=0;function w(s){for(var i=0;i<s.length;i++)v.setUint8(p++,s.charCodeAt(i))}function u32(x){v.setUint32(p,x,true);p+=4}function u16(x){v.setUint16(p,x,true);p+=2}w('RIFF');u32(36+n*ch*2);w('WAVE');w('fmt ');u32(16);u16(1);u16(ch);u32(sr);u32(sr*ch*2);u16(ch*2);u16(16);w('data');u32(n*ch*2);var d=[];for(var c=0;c<ch;c++)d.push(b.getChannelData(c));for(var i=0;i<n;i++)for(var c2=0;c2<ch;c2++){var s=Math.max(-1,Math.min(1,d[c2][i]));v.setInt16(p,s<0?s*32768:s*32767,true);p+=2}return out}
function busy(b,text){b.disabled=true;b.dataset.label=b.dataset.label||b.innerHTML;b.textContent=text}
function idle(b,text){b.textContent=text;setTimeout(function(){b.innerHTML=b.dataset.label;b.disabled=false},1600)}
$('#wav').onclick=function(){var b=this;if(b.disabled)return;busy(b,'Rendering');render().then(function(wav){var name=fileName(),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([wav],{type:'audio/wav'}));a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(a.href)},10000);idle(b,'Done');toast('Downloaded '+name)},function(e){idle(b,'Failed');toast('Could not render the WAV: '+e.message)})};
var saving=null,saveTimer=null;
$('#save').onclick=function(){var b=this;if(b.disabled)return;busy(b,'Saving');render().then(function(wav){var r=new FileReader();r.onload=function(){saving=fileName();parent.postMessage({nexySave:{name:saving,mime:'audio/wav',dataUrl:r.result}},'*');saveTimer=setTimeout(function(){saving=null;idle(b,'Not saved');toast('Nexy did not confirm the save')},5000)};r.onerror=function(){idle(b,'Not saved')};r.readAsDataURL(new Blob([wav],{type:'audio/wav'}))},function(e){idle(b,'Not saved');toast('Could not render the beat: '+e.message)})};
addEventListener('message',function(e){if(e.source!==parent||!e.data||!saving||e.data.nexySaved!==saving)return;clearTimeout(saveTimer);saving=null;idle($('#save'),'Saved')});
/* ---------- visualiser ---------- */
var vc=$('#vis'),vx=vc.getContext('2d'),mode='wave';$('#vismode').onclick=function(){mode=mode==='wave'?'bars':'wave';this.textContent=mode==='wave'?'waveform':'spectrum'};
(function draw(){vx.fillStyle='#0d0d12';vx.fillRect(0,0,600,148);if(an){if(mode==='wave'){var d=new Uint8Array(an.fftSize);an.getByteTimeDomainData(d);vx.strokeStyle='#7C5CFF';vx.lineWidth=2;vx.beginPath();for(var i=0;i<600;i++){var v=d[Math.floor(i/600*d.length)]/128-1,y=74+v*64;i?vx.lineTo(i,y):vx.moveTo(i,y)}vx.stroke()}else{var f=new Uint8Array(an.frequencyBinCount);an.getByteFrequencyData(f);var bw=600/48;for(var k=0;k<48;k++){var h=f[Math.floor(Math.pow(k/48,1.6)*f.length*0.6)]/255*140;vx.fillStyle=k<16?'#7C5CFF':k<32?'#FF8C68':'#3BD1C4';vx.fillRect(k*bw+1,148-h,bw-2,h)}}}else{vx.strokeStyle='#262633';vx.beginPath();vx.moveTo(0,74);vx.lineTo(600,74);vx.stroke()}requestAnimationFrame(draw)})();
<\/script></body></html>
`;
}
