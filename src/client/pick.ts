// Click a part of the page on the right, then say what to change in it. The preview is a
// sandboxed iframe Nexy cannot reach into, so the page carries a small picker (PICK, injected
// with the run probe) and the two talk by messages: Select turns it on, a click sends back the
// part's label, path and markup, and the next message edits only that part.
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);

export interface Picked { artifact: string; label: string; path: string; html: string }

// runs inside the page: hover outlines a part, ↑ grows to its parent, click picks, Esc cancels;
// once loaded it also sends the page as drawn, since many pages draw their products by script
export const PICK = String.raw`<script>(function(){var on=false,box,cur;
var BLOCK=/^(SECTION|HEADER|FOOTER|NAV|MAIN|ARTICLE|ASIDE|FORM|LI|BUTTON|A|IMG|H1|H2|H3|H4|P|TABLE|FIGURE|UL|OL)$/;
function grow(el){var e=el;while(e&&e!==document.body){if(BLOCK.test(e.tagName))return e;e=e.parentElement;}return el;}
function lab(el){var t=el.tagName.toLowerCase(),h=el.querySelector&&el.querySelector("h1,h2,h3"),x=((h&&h.textContent)||el.getAttribute("alt")||el.textContent||"").replace(/\s+/g," ").trim().slice(0,48);
return t+(el.id?"#"+el.id:(el.classList&&el.classList[0]?"."+el.classList[0]:""))+(x?": "+x:"");}
function path(el){var p=[];while(el&&el.nodeType===1&&el!==document.body){var i=1,s=el;while((s=s.previousElementSibling))if(s.tagName===el.tagName)i++;
p.unshift(el.tagName.toLowerCase()+(el.id?"#"+el.id:"")+":nth-of-type("+i+")");el=el.parentElement;}return "body > "+p.join(" > ");}
function show(el){cur=el;if(!box){box=document.createElement("div");box.style.cssText="position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #8acab8;background:rgba(138,202,184,.14);border-radius:4px";
document.documentElement.appendChild(box);}var r=el.getBoundingClientRect();box.style.display="block";box.style.left=r.left+"px";box.style.top=r.top+"px";box.style.width=r.width+"px";box.style.height=r.height+"px";}
function off(){on=false;cur=null;if(box)box.style.display="none";document.documentElement.style.cursor="";}
addEventListener("message",function(e){if(e.data&&e.data.nexyPick!==undefined){if(e.data.nexyPick){on=true;document.documentElement.style.cursor="crosshair";}else off();}});
addEventListener("mouseover",function(e){if(on)show(grow(e.target));},true);
addEventListener("keydown",function(e){if(!on)return;if(e.key==="Escape"){off();parent.postMessage({nexyPickCancel:1},"*");}
else if(e.key==="ArrowUp"&&cur&&cur.parentElement&&cur.parentElement!==document.documentElement){e.preventDefault();show(cur.parentElement===document.body?cur:cur.parentElement);}},true);
addEventListener("click",function(e){if(!on)return;e.preventDefault();e.stopPropagation();var el=cur||grow(e.target),h=el.outerHTML;
parent.postMessage({nexyPicked:{label:lab(el),path:path(el),html:h.length>4000?h.slice(0,4000)+"…":h}},"*");off();},true);
addEventListener("load",function(){setTimeout(function(){var d=document.documentElement.cloneNode(true),x=d.querySelectorAll("script");for(var i=0;i<x.length;i++)x[i].remove();
parent.postMessage({nexyRendered:d.outerHTML.slice(0,300000)},"*");},1200);});})();</script>`;

let current: Picked | null = null;
let picking = false;
let openArtifact = "";
let rendered = "";

const frame = () => $<HTMLIFrameElement>("#cvBody iframe");
const button = () => $<HTMLButtonElement>("#cvPick");

function setPicking(on: boolean): void {
  picking = on;
  frame()?.contentWindow?.postMessage({ nexyPick: on }, "*");
  button()?.classList.toggle("on", on);
  const t = button()?.querySelector(".txt");
  if (t) t.textContent = on ? "Click a part" : "Select";
}

function chip(): void {
  const el = $("#pickChip");
  if (!el) return;
  el.hidden = !current;
  if (!current) return;
  el.innerHTML = `<span>Editing: <b></b></span><button type="button" aria-label="Stop editing this part">×</button>`;
  el.querySelector("b")!.textContent = current.label;
  el.querySelector("button")!.addEventListener("click", clearPick);
}

/** The part picked on the page that is open now, if any. */
export const pickedFor = (artifactId: string | undefined): Picked | null =>
  current && artifactId && current.artifact === artifactId ? current : null;

/** The open page as it was drawn, if it has reported in since it was painted. */
export const renderedFor = (artifactId: string | undefined): string =>
  artifactId && artifactId === openArtifact ? rendered : "";

export function clearPick(): void {
  current = null;
  if (picking) setPicking(false);
  chip();
  const inp = $<HTMLTextAreaElement>("#input");
  if (inp) inp.placeholder = "Talk to Nexy";
}

/** The canvas calls this as it paints: Select only for a page or game with a source to edit. */
export function pickFor(artifactId: string, editable: boolean): void {
  rendered = "";
  if (artifactId !== openArtifact) { openArtifact = artifactId; if (current && current.artifact !== artifactId) clearPick(); picking = false; }
  const b = button();
  if (!b) return;
  b.style.display = editable ? "" : "none";
  b.classList.toggle("on", picking);
  b.onclick = () => setPicking(!picking);
}

// guarded: content-view (and so this module) is imported by tests and tooling with no window
if (typeof window !== "undefined") window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== frame()?.contentWindow) return;
  if (e.data?.nexyPickCancel) { setPicking(false); return; }
  if (typeof e.data?.nexyRendered === "string") { rendered = e.data.nexyRendered; return; }
  const p = e.data?.nexyPicked;
  if (!p || typeof p.html !== "string") return;
  current = { artifact: openArtifact, label: String(p.label ?? "this part").slice(0, 80), path: String(p.path ?? "").slice(0, 400), html: p.html.slice(0, 4100) };
  picking = false;
  setPicking(false);
  chip();
  const inp = $<HTMLTextAreaElement>("#input");
  if (inp) { inp.placeholder = `Say what to change in ${current.label.split(":")[0]}`; inp.focus(); }
});
