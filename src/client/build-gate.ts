// Before a page built on this computer is shown: run it unseen in the same sandbox the canvas
// uses and refuse it if it reaches for the network, logs an error, freezes or shows nothing.
import { STORAGE_SHIM } from "./content-view";

const PROBE = `<script>${STORAGE_SHIM}(function(){var E=[],B=[];function add(a,m){if(a.length<5)a.push(String(m).slice(0,200))}` +
  `var ce=console.error;console.error=function(){add(E,[].map.call(arguments,String).join(" "));return ce.apply(console,arguments)};` +
  `addEventListener("error",function(e){add(E,e.message||e.error||("could not load "+(e.target&&e.target.tagName||"a file")))},true);` +
  `addEventListener("unhandledrejection",function(e){add(E,e.reason&&e.reason.message||e.reason)});` +
  `document.addEventListener("securitypolicyviolation",function(e){add(B,e.blockedURI||e.violatedDirective)});` +
  // text boxes that sit on top of each other (a nav drawn over a heading)
  `function overlaps(){var els=[].filter.call(document.querySelectorAll("body *"),function(el){if(el.closest("svg"))return false;` +
  `for(var n=el.firstChild;n;n=n.nextSibling)if(n.nodeType===3&&n.textContent.trim())return true;return false}).slice(0,400);` +
  `var r=els.map(function(el){return el.getBoundingClientRect()}),k=0;for(var i=0;i<els.length;i++)for(var j=i+1;j<els.length;j++){` +
  `var a=r[i],b=r[j];if(!a.width||!b.width||els[i].contains(els[j])||els[j].contains(els[i]))continue;` +
  `var w=Math.min(a.right,b.right)-Math.max(a.left,b.left),h=Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top);` +
  `if(w>4&&h>4&&w*h>0.3*Math.min(a.width*a.height,b.width*b.height))k++}return k}` +
  `addEventListener("message",function(e){var q=e.data&&e.data.nexyGateAsk;if(!q)return;var b=document.body;` +
  `parent.postMessage({nexyGate:q,errors:E,blocked:B,text:b?b.innerText.trim().length:0,drawn:document.querySelectorAll("canvas,svg").length,overlaps:overlaps()},"*")})})()</script>`;

export interface GateResult { ok: boolean; why: string; overlaps: number }

const SETTLE_MS = 2500, ANSWER_MS = 2000, LOAD_MS = 15_000;

// the probe goes right after the page's no-network policy, before any of its own scripts
export function withGate(html: string): string {
  const m = /<meta http-equiv="Content-Security-Policy"[^>]*>/i.exec(html) ?? /<head[^>]*>/i.exec(html) ?? /<html[^>]*>/i.exec(html);
  return m ? html.slice(0, m.index + m[0].length) + PROBE + html.slice(m.index + m[0].length) : PROBE + html;
}

export function renderGate(html: string): Promise<GateResult> {
  return new Promise((done) => {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts allow-forms");
    f.setAttribute("aria-hidden", "true");
    f.tabIndex = -1;
    // on screen but unseen, so its timers and animation frames run as they will in the canvas
    f.style.cssText = "position:fixed;left:0;top:0;width:1024px;height:768px;opacity:0;pointer-events:none;z-index:-1;border:0";
    const ask = `g${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
    let settled = false;
    const finish = (r: GateResult) => {
      if (settled) return;
      settled = true;
      removeEventListener("message", onMsg);
      clearTimeout(noLoad);
      f.remove();
      done(r);
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (e.source !== f.contentWindow || d?.nexyGate !== ask) return;
      const overlaps = Number(d.overlaps) || 0;
      if (d.blocked?.length) return finish({ ok: false, why: `it tried to load something from outside the page (${String(d.blocked[0]).slice(0, 80)})`, overlaps });
      if (d.errors?.length) return finish({ ok: false, why: `it throws an error when it runs: ${String(d.errors[0]).slice(0, 160)}`, overlaps });
      if (d.text < 20 && !d.drawn) return finish({ ok: false, why: "it shows nothing when it runs", overlaps });
      finish({ ok: true, why: "", overlaps });
    };
    addEventListener("message", onMsg);
    const noLoad = setTimeout(() => finish({ ok: false, why: "it did not finish loading", overlaps: 0 }), LOAD_MS);
    f.addEventListener("load", () => {
      clearTimeout(noLoad);
      setTimeout(() => {
        f.contentWindow?.postMessage({ nexyGateAsk: ask }, "*");
        setTimeout(() => finish({ ok: false, why: "it froze when it ran", overlaps: 0 }), ANSWER_MS);
      }, SETTLE_MS);
    }, { once: true });
    f.srcdoc = withGate(html);
    document.body.append(f);
  });
}
