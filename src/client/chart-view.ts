import type { Artifact } from "./canvas";
import { themedHTML } from "./theme-apps";

export interface ChartData {
  query: string; title: string; unit: string; kind: "bar" | "line" | "table";
  points: { label: string; value: number; unit: string; source: { title: string; url: string }; quote: string }[];
  dropped: number; sources: { title: string; url: string }[];
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "chart";

const CSS = `[hidden]{display:none!important}body{margin:0;background:#0d0d12;color:#e8e8f0;font:12px/1.4 -apple-system,Inter,system-ui,sans-serif}
.top{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid #1e1e28;flex-wrap:wrap}.top b{font-size:14px;margin-right:6px}
.seg{display:flex;background:#15151d;border-radius:8px;padding:3px}.seg button{border:0;background:none;color:#9a9ab0;padding:5px 10px;border-radius:6px;cursor:pointer;font:inherit}.seg button.on{background:#2a2a36;color:#fff}
.leg{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}.leg button{border:0;background:none;color:#cfcfe0;display:flex;align-items:center;gap:6px;cursor:pointer;font:inherit;padding:2px 0}.leg button.off{opacity:.35}.leg i{width:10px;height:10px;border-radius:3px;display:inline-block}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:12px 14px 8px}.k{background:#15151d;border-radius:10px;padding:10px 12px;min-width:0}.k .l{color:#8a8aa0;font-size:11px}.k .v{font-size:18px;font-weight:600;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.k .d{font-size:11px;color:#8a8aa0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.k .d.up{color:#4ADE80}.k .d.dn{color:#FF8C68}
.wrap{padding:10px 14px}svg{width:100%;height:auto;display:block}.m{cursor:default;transition:opacity .12s}.m.hi{stroke:#fff;stroke-width:1.5}
.tip{position:fixed;pointer-events:none;background:#1a1a24;border:1px solid #2a2a36;border-radius:8px;padding:8px 10px;font-size:11.5px;display:none;box-shadow:0 10px 30px rgba(0,0,0,.5);max-width:320px}.tip b{display:block;margin-bottom:3px}.tip .tv{font-size:14px;font-weight:600;margin-bottom:5px}.tip q{display:block;color:#cfcfe0;font-style:italic;quotes:none;margin-bottom:5px}.tip .ts{color:#8a8aa0}
.tbl{padding:4px 14px 8px}.tools{display:flex;gap:8px;align-items:center;margin-bottom:8px}.tools h4{margin:0;font-size:11px;color:#8a8aa0;font-weight:500}.tools .cnt{color:#6f6f80;margin-left:auto}.tools button{background:#15151d;border:1px solid #262633;color:#fff;border-radius:7px;padding:6px 10px;cursor:pointer;font:inherit}
table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;color:#8a8aa0;font-weight:500;font-size:11px;padding:8px;border-bottom:1px solid #262633;white-space:nowrap}td{padding:8px;border-bottom:1px solid #1e1e28;vertical-align:top}tr:hover td{background:#15151d}tr.off td{opacity:.4}
td.f{color:#cfcfe0;white-space:nowrap}td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-weight:600}td.q{color:#cfcfe0;font-style:italic;min-width:220px}td.s a{color:#9d87ff;text-decoration:none}td.s a:hover{text-decoration:underline}td.s .h{display:block;color:#6f6f80;font-size:11px}td.s i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px}
.src{padding:6px 14px 14px;color:#6f6f80;font-size:11px;line-height:1.5}.src b{color:#9a9ab0;font-weight:500}
@media(max-width:700px){.kpis{grid-template-columns:repeat(2,1fr)}.leg{margin-left:0}}`;

const SCRIPT = `var P=D.points,tip=el("tip"),view=D.kind==="line"?"line":"bar",C=["#7C5CFF","#3BD1C4","#FF8C68","#FFD166","#5CA8FF","#F472B6","#A3E635","#C084FC"];
function el(i){return document.getElementById(i)}
function esc(t){return String(t==null?"":t).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
function safe(u){return /^https?:\\/\\//i.test(u)?u:""}
function host(u){return String(u).replace(/^[a-z]+:\\/\\/(www\\.)?/i,"").split(/[\\/?#]/)[0]}
function fmt(v){return Number(v).toLocaleString("en",{maximumFractionDigits:2})}
function wu(v,u){return u?(/^%/.test(u)?fmt(v)+u:fmt(v)+" "+u):fmt(v)}
function nice(r){var p=Math.pow(10,Math.floor(Math.log10(r))),m=r/p;return (m<=1?1:m<=2?2:m<=2.5?2.5:m<=5?5:10)*p}
function pct(v){return fmt(Math.abs(v)>=10?Math.round(v):+v.toFixed(1))}
function cut(s,n){s=String(s);return s.length>n?s.slice(0,Math.max(1,n-1))+"\\u2026":s}
var S={},SK=[];P.forEach(function(p){if(!(p.su in S)){S[p.su]={t:p.st||host(p.su),c:C[SK.length%C.length],on:true};SK.push(p.su)}});
var G=[],GI={};P.forEach(function(p,i){var u=p.unit||"";if(!(u in GI)){GI[u]=G.length;G.push({u:u,ix:[]})}G[GI[u]].ix.push(i)});G.sort(function(a,b){return b.ix.length-a.ix.length});var g=0;
function kpi(l,v,d,cl){return "<div class=k><div class=l>"+esc(l)+"</div><div class=v title=\\""+esc(v)+"\\">"+esc(v)+"</div><div class=\\"d "+(cl||"")+"\\" title=\\""+esc(d)+"\\">"+esc(d)+"</div></div>"}
function legend(){var box=el("leg");if(!box)return;var seen={};box.innerHTML="";G[g].ix.forEach(function(i){var k=P[i].su;if(seen[k])return;seen[k]=1;var b=document.createElement("button");b.type="button";b.className=S[k].on?"":"off";b.title="Show or hide the figures from "+S[k].t;b.innerHTML="<i style=\\"background:"+S[k].c+"\\"></i>"+esc(cut(S[k].t,28));b.onclick=function(){S[k].on=!S[k].on;b.classList.toggle("off",!S[k].on);draw();rows()};box.appendChild(b)})}
function segs(){var su=el("unit");if(su){su.innerHTML=G.map(function(x,i){return "<button type=button data-i="+i+(i===g?" class=on":"")+">"+esc(x.u||"Value")+" \\u00b7 "+x.ix.length+"</button>"}).join("");su.querySelectorAll("button").forEach(function(b){b.onclick=function(){g=+b.dataset.i;segs();legend();draw()}})}
var sv=el("view");if(sv){sv.hidden=G[g].ix.length<2;sv.querySelectorAll("button").forEach(function(b){b.classList.toggle("on",b.dataset.v===view);b.onclick=function(){view=b.dataset.v;segs();draw()}})}}
function kpis(pts,u){var box=el("kpis");if(!pts.length){box.innerHTML="";return}var n=pts.length,a=pts[0],z=pts[n-1],big=pts.reduce(function(m,p){return p.value>m.value?p:m},a),src={};pts.forEach(function(p){src[p.su]=1});var ns=Object.keys(src).length;
var ch=kpi("Figures",String(n),"each quoted from a source");if(n>1&&D.kind==="line"){var dv=z.value-a.value,sg=dv>0?"+":dv<0?"\\u2212":"";ch=kpi("Change, first to last",sg+wu(Math.abs(dv),u),(a.value?sg+pct(Math.abs(dv/a.value*100))+"% since ":"since ")+a.label,dv>0?"up":dv<0?"dn":"")}
box.innerHTML=kpi("Last figure",wu(z.value,u),z.label)+ch+kpi("Largest",wu(big.value,u),big.label)+kpi("Sources",String(ns),ns===1?"page quoted":"pages quoted")}
function draw(){var svg=el("ch");if(!svg)return;var u=G[g].u,pts=G[g].ix.map(function(i){return P[i]}).filter(function(p){return S[p.su].on});kpis(pts,u);
if(!pts.length){svg.setAttribute("viewBox","0 0 860 120");svg.innerHTML="<text x=430 y=64 text-anchor=middle fill=#8a8aa0 font-size=13>Every source is hidden. Click one above to show its figures again.</text>";return}
var W=860,H=330,L=64,R=16,T=22,B=46,n=pts.length,vs=pts.map(function(p){return p.value}),hi=Math.max(0,Math.max.apply(null,vs)),lo=Math.min(0,Math.min.apply(null,vs));hi=hi+(hi-lo)*0.08||1;var st=nice((hi-lo)/4);hi=Math.ceil(hi/st)*st;lo=Math.floor(lo/st)*st;var nt=Math.round((hi-lo)/st);
var y=function(v){return T+(H-T-B)*(hi-v)/(hi-lo)},bw=(W-L-R)/n,x=function(i){return L+(i+0.5)*bw},w=Math.min(64,bw*0.62),out="";svg.setAttribute("viewBox","0 0 "+W+" "+H);
for(var k=0;k<=nt;k++){var v=+(lo+st*k).toPrecision(12),yy=y(v);out+="<line x1="+L+" x2="+(W-R)+" y1="+yy+" y2="+yy+" stroke=#1e1e28 /><text x="+(L-8)+" y="+(yy+4)+" text-anchor=end fill=#6f6f80 font-size=10>"+esc(fmt(v))+"</text>"}
if(lo<0)out+="<line x1="+L+" x2="+(W-R)+" y1="+y(0)+" y2="+y(0)+" stroke=#3a3a48 />";
if(view==="line"&&n>1)out+="<polyline points=\\""+pts.map(function(p,i){return x(i)+","+y(p.value)}).join(" ")+"\\" fill=none stroke=#cfcfe0 stroke-width=1.5 opacity=.55 />";
var step=Math.ceil(n/12),chars=Math.max(4,Math.floor(bw*step/6.4));
pts.forEach(function(p,i){var c=S[p.su].c,top=y(Math.max(0,p.value)),h=Math.abs(y(p.value)-y(0));
out+=view==="line"?"<circle class=m data-i="+i+" cx="+x(i)+" cy="+y(p.value)+" r=5.5 fill="+c+" />":"<rect class=m data-i="+i+" x="+(x(i)-w/2)+" y="+top+" width="+w+" height="+Math.max(1,h)+" rx=3 fill="+c+" opacity=.9 />";
if(n<=14)out+="<text x="+x(i)+" y="+(p.value<0&&view!=="line"?y(p.value)+14:y(p.value)-9)+" text-anchor=middle fill=#e8e8f0 font-size=11>"+esc(fmt(p.value))+"</text>";
if(i%step===0)out+="<text x="+x(i)+" y="+(H-B+17)+" text-anchor=middle fill=#8a8aa0 font-size=10>"+esc(cut(p.label,chars))+"</text>";
out+="<rect class=hit data-i="+i+" x="+(L+i*bw)+" y="+T+" width="+bw+" height="+(H-T-B)+" fill=transparent />"});
out+="<text x=14 y="+(T+(H-T-B)/2)+" fill=#6f6f80 font-size=10 text-anchor=middle transform=\\"rotate(-90 14 "+(T+(H-T-B)/2)+")\\">"+esc(u||"value")+"</text>";
svg.innerHTML=out;svg.querySelectorAll(".hit").forEach(function(r){var i=+r.dataset.i,p=pts[i],m=svg.querySelector(".m[data-i=\\""+i+"\\"]");
r.onmousemove=function(e){m.classList.add("hi");tip.innerHTML="<b>"+esc(p.label)+"</b><div class=tv>"+esc(wu(p.value,p.unit))+"</div><q>\\u201c"+esc(p.quote)+"\\u201d</q><span class=ts>"+esc(S[p.su].t)+(p.su?" \\u00b7 "+esc(host(p.su)):"")+"</span>";tip.style.display="block";var tw=tip.offsetWidth,th=tip.offsetHeight,lx=e.clientX+14,ty=e.clientY-10;if(lx+tw>innerWidth-8)lx=e.clientX-tw-14;if(ty+th>innerHeight-8)ty=innerHeight-th-8;tip.style.left=Math.max(8,lx)+"px";tip.style.top=Math.max(8,ty)+"px"};
r.onmouseleave=function(){m.classList.remove("hi");tip.style.display="none"}})}
function rows(){el("tb").innerHTML=P.map(function(p){var s=S[p.su],a=safe(p.su);return "<tr"+(s.on?"":" class=off")+"><td class=f>"+esc(p.label)+"</td><td class=num>"+esc(wu(p.value,p.unit))+"</td><td class=q>\\u201c"+esc(p.quote)+"\\u201d</td><td class=s><i style=\\"background:"+s.c+"\\"></i>"+(a?"<a href=\\""+esc(a)+"\\" target=_blank rel=\\"noopener noreferrer\\">"+esc(s.t)+"</a>":esc(s.t))+"<span class=h>"+esc(host(p.su))+"</span></td></tr>"}).join("");el("cnt").textContent=P.length+(P.length===1?" figure from ":" figures from ")+SK.length+(SK.length===1?" source":" sources")}
el("csv").onclick=function(){var q=function(v){v=String(v==null?"":v);if(/^[=+@\\t\\r-]/.test(v)&&isNaN(+v))v="'"+v;return /[",\\n\\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};var csv="label,value,unit,quote,source_title,source_url\\n"+P.map(function(p){return [p.label,p.value,p.unit,p.quote,p.st,p.su].map(q).join(",")}).join("\\n")+"\\n";var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=D.name+".csv";document.body.appendChild(a);a.click();a.remove()};
if(D.kind==="table"){var us={};P.forEach(function(p){us[p.unit||""]=1});var nu=Object.keys(us).length;el("kpis").innerHTML=kpi("Figures",String(P.length),"each quoted from a source")+kpi("Sources",String(SK.length),SK.length===1?"page quoted":"pages quoted")+kpi("Measures",String(nu),nu===1?"one unit":"different units, so not charted")+kpi("Left out",String(D.dropped),D.dropped?"not found in any source":"nothing unsourced was offered")}else{segs();legend();draw()}
rows();`;

function pageHtml(c: ChartData): string {
  const name = slug(c.title);
  const data = JSON.stringify({
    kind: c.kind,
    dropped: c.dropped,
    name,
    points: c.points.map((p) => ({
      label: p.label, value: p.value, unit: p.unit || c.unit, quote: p.quote, st: p.source.title, su: p.source.url,
    })),
  }).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const table = c.kind === "table";
  const n = new Set(c.points.map((p) => p.source.url)).size;
  const units = new Set(c.points.map((p) => p.unit || c.unit)).size;
  const controls = table ? "" :
    (units > 1 ? `<div class="seg" id="unit" title="Figures in different units are never drawn on one axis"></div>` : "") +
    `<div class="seg" id="view"><button type="button" data-v="bar">Bars</button><button type="button" data-v="line">Line</button></div><div class="leg" id="leg"></div>`;
  const note =
    `<b>Method.</b> Every figure was found in a search result and is quoted with its source. ` +
    `Searched on this machine for “${esc(c.query)}”.` +
    (table ? " These figures measure different things, so they are listed rather than drawn on one chart." : "") +
    (units > 1 && !table ? " Figures in different units are kept on separate charts; switch between them at the top." : "") +
    (c.dropped ? ` ${c.dropped} value${c.dropped === 1 ? "" : "s"} the model offered could not be found in any result and ${c.dropped === 1 ? "was" : "were"} left out.` : "") +
    ` <b>Sources:</b> ${n} page${n === 1 ? "" : "s"}, linked in the table above.`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.title)}</title><style>${CSS}</style></head><body>
<div class="top"><b>${esc(c.title)}</b>${controls}</div>
<div class="kpis" id="kpis"></div>${table ? "" : `<div class="wrap"><svg id="ch" viewBox="0 0 860 330" role="img" aria-label="${esc(c.title)}"></svg></div>`}<div class="tip" id="tip"></div>
<div class="tbl"><div class="tools"><h4>${table ? "Figures, each with its source" : "Sources"}</h4><span class="cnt" id="cnt"></span><button type="button" id="csv">Export CSV</button></div>
<table><thead><tr><th>Figure</th><th class="num" style="text-align:right">Value</th><th>Quote</th><th>Source</th></tr></thead><tbody id="tb"></tbody></table></div>
<div class="src">${note}</div>
<script>var D=${data};${SCRIPT}<\/script></body></html>`;
}

export function chartArtifact(c: ChartData): Artifact {
  const name = slug(c.title);
  const n = new Set(c.points.map((p) => p.source.url)).size;
  const html = pageHtml(c);
  return {
    id: `chart:${name}`,
    kind: "table",
    title: `${name}.chart`,
    meta: `Web · ${n} source${n === 1 ? "" : "s"} · on device`,
    render(host) {
      const f = document.createElement("iframe");
      f.setAttribute("sandbox", "allow-scripts allow-downloads allow-popups allow-popups-to-escape-sandbox");
      f.title = c.title;
      f.srcdoc = themedHTML(html);
      const frame = document.createElement("div");
      frame.className = "frame";
      frame.appendChild(f);
      const note = document.createElement("div");
      note.className = "cvnote";
      note.textContent = c.kind === "table"
        ? `${c.points.length} figures that measure different things, listed with their sources. Searched on this machine; nothing was modelled or filled in.`
        : "Interactive chart. Hover a figure for its exact quote and source; switch view at the top, or click a source to hide its figures. Nothing was modelled or filled in.";
      host.replaceChildren(frame, note);
    },
  };
}
