import type { Artifact } from "./canvas";
import { themedHTML } from "./theme-apps";

export interface ReportRow { ts: number; app: string; what: string; secs: number; project?: string }

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

export function reportArtifact(days: number, rows: ReportRow[], projects: number): Artifact {
  const since = Date.now() - days * 86_400_000;
  const dayKey = (t: number) => new Date(t).toLocaleDateString([], { month: "short", day: "numeric" });
  const labels: string[] = [];
  for (let i = days - 1; i >= 0; i--) labels.push(dayKey(Date.now() - i * 86_400_000));
  const data = rows.filter((r) => r.ts >= since).map((r) => [dayKey(r.ts), r.project ?? "", r.app, r.what, +(r.secs / 3600).toFixed(2), r.ts]);
  const span = days === 1 ? "today" : `last ${days} days`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#0d0d12;color:#e8e8f0;font:12px/1.4 -apple-system,Inter,system-ui,sans-serif}.top{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #1e1e28;flex-wrap:wrap}.top b{font-size:14px}.seg{display:flex;background:#15151d;border-radius:8px;padding:3px;margin-left:auto}.seg button{border:0;background:none;color:#9a9ab0;padding:5px 10px;border-radius:6px;cursor:pointer;font:inherit}.seg button.on{background:#2a2a36;color:#fff}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;padding:12px 14px 0}.k{background:#15151d;border-radius:10px;padding:10px 12px}.k .l{color:#8a8aa0;font-size:11px}.k .v{font-size:18px;font-weight:600;margin-top:2px}.k .d{font-size:11px;color:#4ADE80}
.grid{display:grid;grid-template-columns:1.6fr 1fr;gap:10px;padding:12px 14px}.card{background:#15151d;border-radius:10px;padding:10px 12px;min-width:0}.card h4{margin:0 0 6px;font-size:11px;color:#8a8aa0;font-weight:500}svg{width:100%;height:auto;display:block}#c2{max-width:380px}
.tbl{padding:0 14px 14px}.tools{display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap}.tools input,.tools select{background:#15151d;border:1px solid #262633;color:#fff;border-radius:7px;padding:6px 9px;outline:0;font:inherit}.tools .cnt{color:#8a8aa0;margin-left:auto}.tools button{background:#15151d;border:1px solid #262633;color:#fff;border-radius:7px;padding:6px 10px;cursor:pointer;font:inherit}
table{width:100%;border-collapse:collapse;font-size:12px}th{text-align:left;color:#8a8aa0;font-weight:500;font-size:11px;padding:8px;border-bottom:1px solid #262633;cursor:pointer;white-space:nowrap;position:sticky;top:0;background:#0d0d12}th.s::after{content:" ↓"}td{padding:7px 8px;border-bottom:1px solid #1e1e28;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}tr:hover td{background:#15151d}.num{text-align:right;font-variant-numeric:tabular-nums}.note{color:#8a8aa0;padding:0 14px 14px}
.tip{position:fixed;pointer-events:none;background:#1a1a24;border:1px solid #2a2a36;border-radius:8px;padding:7px 9px;font-size:11.5px;display:none}
@media(max-width:700px){.kpis{grid-template-columns:repeat(2,1fr)}.grid{grid-template-columns:1fr}}</style></head><body>
<div class="top"><b>Work and compute, ${esc(span)}</b><span style="color:#8a8aa0">Own 1, this machine</span><div class="seg" id="metric"><button class="on" data-m="h">Compute hours</button><button data-m="n">Items</button></div></div>
<div class="kpis" id="kpis"></div><div class="grid"><div class="card"><h4 id="cht"></h4><svg id="c1" viewBox="0 0 640 220"></svg></div><div class="card"><h4>By app</h4><svg id="c2" viewBox="0 0 320 220"></svg></div></div>
<div class="tbl"><div class="tools"><input id="q" placeholder="Filter by project, app or item"><select id="fa"><option value="">All apps</option></select><span class="cnt" id="cnt"></span><button id="csv">Export CSV</button></div><div style="max-height:360px;overflow:auto"><table><thead><tr><th data-k="0">Day</th><th data-k="1">Project</th><th data-k="2">App</th><th data-k="3">Item</th><th data-k="4" class="num">Compute h</th></tr></thead><tbody id="tb"></tbody></table></div></div>
<div class="note">Compute is the time builds held the model on this machine, from Own Build's run records. Chat and studio time is not metered yet, so it is not counted.</div><div class="tip" id="tip"></div>
<script>var D=${JSON.stringify({ days: labels, rows: data, projects }).replace(/</g, "\\u003c")};var rows=D.rows,metric="h",sortK=0,sortD=-1,tip=document.getElementById("tip");
var apps=[];rows.forEach(function(r){if(apps.indexOf(r[2])<0)apps.push(r[2])});apps.sort().forEach(function(a){var o=document.createElement("option");o.textContent=a;document.getElementById("fa").appendChild(o)});
function val(r){return metric=="h"?r[4]:1}
function kpis(){var h=0,b=0;rows.forEach(function(r){h+=r[4];if(r[4]>0)b++});document.getElementById("kpis").innerHTML=[["Items",rows.length,"across "+D.projects+" projects"],["Builds",b,"with compute recorded"],["Compute hours",h.toFixed(1),"on this machine"],["Ran on device","100%","nothing went to a cloud"]].map(function(k){return "<div class=k><div class=l>"+k[0]+"</div><div class=v>"+k[1]+"</div><div class=d>"+k[2]+"</div></div>"}).join("")}
function c1(){var s=document.getElementById("c1"),per={};D.days.forEach(function(d){per[d]=0});rows.forEach(function(r){if(r[0] in per)per[r[0]]+=val(r)});var vals=D.days.map(function(d){return per[d]}),max=Math.max.apply(null,vals.concat([0]))*1.15||1,W=640,H=220,L=40,B=30,bw=(W-L-10)/D.days.length,out="";for(var g=0;g<=3;g++){var y=10+(H-10-B)*(1-g/3);out+="<line x1="+L+" x2="+(W-10)+" y1="+y+" y2="+y+" stroke=#1e1e28 /><text x="+(L-6)+" y="+(y+4)+" text-anchor=end fill=#6f6f80 font-size=10>"+(max*g/3).toFixed(metric=="n"?0:1)+"</text>"}var step=Math.max(1,Math.round(D.days.length/6));D.days.forEach(function(d,i){var v=per[d],x=L+i*bw,h=(H-10-B)*v/max;out+="<rect class=b data-i="+i+" x="+(x+1)+" y="+(H-B-h)+" width="+Math.max(1,bw-2)+" height="+h+" rx=2 fill=#7C5CFF />";if(i%step==0)out+="<text x="+(x+bw/2)+" y="+(H-B+14)+" text-anchor=middle fill=#8a8aa0 font-size=10>"+d+"</text>"});s.innerHTML=out;document.getElementById("cht").textContent=(metric=="h"?"Compute hours":"Items")+" per day, on this machine";s.querySelectorAll(".b").forEach(function(b){b.onmousemove=function(e){var d=D.days[+b.dataset.i];tip.style.display="block";tip.style.left=(e.clientX+10)+"px";tip.style.top=(e.clientY-8)+"px";tip.innerHTML="<b>"+d+"</b><br>"+per[d].toFixed(metric=="n"?0:2)};b.onmouseleave=function(){tip.style.display="none"}})}
function c2(){var s=document.getElementById("c2"),by={};rows.forEach(function(r){by[r[2]]=(by[r[2]]||0)+val(r)});var ks=Object.keys(by).sort(function(a,b){return by[b]-by[a]}),max=by[ks[0]]||1,out="";ks.forEach(function(k,i){var y=8+i*23,w=(320-175)*by[k]/max;out+="<text x=0 y="+(y+11)+" fill=#cfcfe0 font-size=11>"+k+"</text><rect x=120 y="+y+" width="+w+" height=14 rx=3 fill="+(i==0?"#FF8C68":"#7C5CFF")+" opacity=.9 /><text x="+(124+w)+" y="+(y+11)+" fill=#8a8aa0 font-size=10>"+by[k].toFixed(metric=="n"?0:1)+"</text>"});s.setAttribute("viewBox","0 0 320 "+(ks.length*23+10));s.innerHTML=out||"<text x=0 y=14 fill=#8a8aa0 font-size=11>Nothing recorded</text>"}
function esc(t){return String(t).replace(/[&<>]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;"}[c]})}
function table(){var q=document.getElementById("q").value.toLowerCase(),fa=document.getElementById("fa").value;var rs=rows.filter(function(r){return (!q||(r[1]+" "+r[2]+" "+r[3]).toLowerCase().indexOf(q)>-1)&&(!fa||r[2]==fa)});rs=rs.slice().sort(function(a,b){var k=sortK==0?5:sortK,x=a[k],y=b[k];return (x>y?1:x<y?-1:0)*sortD});document.getElementById("tb").innerHTML=rs.slice(0,300).map(function(r){return "<tr><td>"+esc(r[0])+"</td><td>"+esc(r[1])+"</td><td>"+esc(r[2])+"</td><td>"+esc(r[3])+"</td><td class=num>"+(r[4]?r[4].toFixed(2):"—")+"</td></tr>"}).join("");document.getElementById("cnt").textContent=rs.length+" of "+rows.length+" items";document.querySelectorAll("th").forEach(function(t){t.classList.toggle("s",+t.dataset.k==sortK)})}
document.querySelectorAll("th").forEach(function(t){t.onclick=function(){var k=+t.dataset.k;if(k==sortK)sortD*=-1;else{sortK=k;sortD=1}table()}});["q","fa"].forEach(function(id){document.getElementById(id).oninput=table;document.getElementById(id).onchange=table});
document.querySelectorAll("#metric button").forEach(function(b){b.onclick=function(){metric=b.dataset.m;document.querySelectorAll("#metric button").forEach(function(x){x.classList.remove("on")});b.classList.add("on");c1();c2()}});
document.getElementById("csv").onclick=function(){var q=function(v){v=String(v);return /[",\\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};var csv="day,project,app,item,compute_hours\\n"+rows.map(function(r){return r.slice(0,5).map(q).join(",")}).join("\\n");var a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download="nexy-work-${days}-days.csv";a.click()};
kpis();c1();c2();table();<\/script></body></html>`;
  return {
    id: `report-${days}`,
    kind: "table",
    title: `work-and-compute-${days}-days.report`,
    meta: "from this machine's records",
    render: (host) => {
      const f = document.createElement("iframe");
      f.setAttribute("sandbox", "allow-scripts allow-downloads");
      f.style.cssText = "width:100%;height:100%;min-height:640px;border:0;border-radius:12px;background:#0d0d12";
      f.srcdoc = themedHTML(html);
      host.replaceChildren(f);
    },
  };
}
