import { chatScope, bindChat } from "./chat-scope";
import { show } from "./canvas";
import { imageArtifact } from "./image-tools";
import type { Artifact } from "./canvas";
import { httpMsg } from "./http";

type Tool = "brush" | "line" | "rect" | "ellipse" | "fill" | "eraser";

const TOOLS: [Tool, string, string][] = [
  ["brush", "Brush", "✎"], ["line", "Line", "╱"], ["rect", "Rectangle", "▭"],
  ["ellipse", "Ellipse", "◯"], ["fill", "Fill", "◧"], ["eraser", "Eraser", "◻"],
];
const COLOURS = ["#1D1C22", "#FF3D81", "#FF8C68", "#FFD166", "#3BD1C4", "#7C5CFF", "#3D5CFF", "#2F8F5B", "#FFFFFF"];
const HISTORY = 30;
const TOLERANCE = 40;

const CSS =
  `.np-frame{background:#0d0d12}` +
  `.np{flex:1;min-height:0;display:grid;grid-template-rows:auto 1fr;background:#0d0d12;color:#e8e8f0;` +
  `font-family:-apple-system,Inter,system-ui,sans-serif;font-size:12px;line-height:normal;user-select:none;-webkit-font-smoothing:auto}` +
  `.np-bar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid #1e1e28;background:#111118;min-height:46px;box-sizing:border-box}` +
  `.np-t{width:32px;height:32px;border-radius:8px;border:1px solid transparent;background:#1a1a24;color:#e8e8f0;cursor:pointer;display:grid;place-items:center;font:13px Arial,sans-serif;padding:0;box-sizing:border-box}` +
  `.np-t.on{border-color:#fff;background:#2a2a36}.np-t.np-save{width:auto;padding:0 10px}` +
  `.np-c{display:inline-block;width:22px;height:22px;border-radius:50%;border:2px solid transparent;cursor:pointer;vertical-align:middle;box-sizing:content-box}.np-c.on{border-color:#fff}` +
  `.np-sz{width:110px}.np-sp{flex:1}.np-gap{width:10px}` +
  `.np-wrap{position:relative;background:#1a1a24;overflow:hidden;min-height:0}` +
  `.np-wrap canvas{position:absolute;left:0;top:0;background:#fff;cursor:crosshair;touch-action:none}`;

let saved = 0;

const toast = (text: string) => window.dispatchEvent(new CustomEvent("nexy:toast", { detail: text }));

function injectCss(): void {
  if (document.getElementById("np-css")) return;
  const s = document.createElement("style");
  s.id = "np-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

const rgb = (h: string): [number, number, number] =>
  [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

function build(): HTMLElement {
  const frame = document.createElement("div");
  frame.className = "frame tall np-frame";
  frame.innerHTML =
    `<div class="np"><div class="np-bar">` +
    TOOLS.map(([t, label, glyph], i) => `<button type="button" class="np-t${i ? "" : " on"}" data-tool="${t}" title="${label}">${glyph}</button>`).join("") +
    `<span class="np-gap"></span><span class="np-cols">` +
    COLOURS.map((c, i) => `<span class="np-c${i ? "" : " on"}" data-col="${c}" title="${c}" style="background:${c}"></span>`).join("") +
    `</span><span class="np-gap"></span>Size <input class="np-sz" type="range" min="1" max="60" value="8" aria-label="Brush size">` +
    `<span class="np-sp"></span><button type="button" class="np-t" data-act="undo" title="Undo">↶</button>` +
    `<button type="button" class="np-t" data-act="clear" title="Clear">✕</button>` +
    `<button type="button" class="np-t np-save" data-act="save" title="Save to project">Save to project</button>` +
    `</div><div class="np-wrap"><canvas width="1" height="1"></canvas></div></div>`;

  const wrap = frame.querySelector<HTMLElement>(".np-wrap")!;
  const cv = frame.querySelector("canvas")!;
  const x = cv.getContext("2d", { willReadFrequently: true })!;
  const hist: ImageData[] = [];
  let tool: Tool = "brush", col = COLOURS[0], size = 8, down = false, sx = 0, sy = 0;
  let snap: ImageData | null = null;

  const white = () => { x.fillStyle = "#fff"; x.fillRect(0, 0, cv.width, cv.height); };
  const whole = () => x.getImageData(0, 0, cv.width, cv.height);
  white();

  // The backing canvas only grows; the pane crops it, so shrinking never loses pixels.
  const fit = () => {
    const w = Math.max(cv.width, Math.floor(wrap.clientWidth));
    const h = Math.max(cv.height, Math.floor(wrap.clientHeight));
    if (w === cv.width && h === cv.height) return;
    const keep = whole();
    cv.width = w;
    cv.height = h;
    cv.style.width = `${w}px`;
    cv.style.height = `${h}px`;
    white();
    x.putImageData(keep, 0, 0);
  };
  new ResizeObserver(fit).observe(wrap);

  const push = () => {
    hist.push(whole());
    if (hist.length > HISTORY) hist.shift();
  };

  const pick = (sel: string, el: Element) => {
    frame.querySelectorAll(sel).forEach((e) => e.classList.remove("on"));
    el.classList.add("on");
  };

  const fillAt = (px: number, py: number) => {
    const w = cv.width, h = cv.height;
    if (px < 0 || py < 0 || px >= w || py >= h) return;
    const im = whole(), d = im.data, nc = rgb(col), i0 = (py * w + px) * 4;
    const tc = [d[i0], d[i0 + 1], d[i0 + 2]];
    if (tc[0] === nc[0] && tc[1] === nc[1] && tc[2] === nc[2]) return;
    const seen = new Uint8Array(w * h);
    const stack = [py * w + px];
    while (stack.length) {
      const p = stack.pop()!;
      if (seen[p]) continue;
      seen[p] = 1;
      const j = p * 4;
      if (Math.abs(d[j] - tc[0]) + Math.abs(d[j + 1] - tc[1]) + Math.abs(d[j + 2] - tc[2]) > TOLERANCE) continue;
      d[j] = nc[0]; d[j + 1] = nc[1]; d[j + 2] = nc[2]; d[j + 3] = 255;
      const X = p % w;
      if (X + 1 < w) stack.push(p + 1);
      if (X > 0) stack.push(p - 1);
      if (p + w < w * h) stack.push(p + w);
      if (p >= w) stack.push(p - w);
    }
    x.putImageData(im, 0, 0);
  };

  const pos = (e: PointerEvent): [number, number] => {
    const r = cv.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  cv.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    cv.setPointerCapture(e.pointerId);
    push();
    [sx, sy] = pos(e);
    if (tool === "fill") { fillAt(Math.round(sx), Math.round(sy)); return; }
    down = true;
    snap = whole();
    x.lineCap = "round";
    x.lineJoin = "round";
    x.lineWidth = size;
    x.strokeStyle = tool === "eraser" ? "#fff" : col;
    if (tool !== "brush" && tool !== "eraser") return;
    x.beginPath();
    x.moveTo(sx, sy);
    x.lineTo(sx + 0.1, sy);
    x.stroke();
  });

  cv.addEventListener("pointermove", (e) => {
    if (!down) return;
    const [px, py] = pos(e);
    if (tool === "brush" || tool === "eraser") { x.lineTo(px, py); x.stroke(); return; }
    if (snap) x.putImageData(snap, 0, 0);
    x.beginPath();
    if (tool === "line") { x.moveTo(sx, sy); x.lineTo(px, py); x.stroke(); }
    if (tool === "rect") x.strokeRect(sx, sy, px - sx, py - sy);
    if (tool === "ellipse") {
      x.ellipse((sx + px) / 2, (sy + py) / 2, Math.abs(px - sx) / 2, Math.abs(py - sy) / 2, 0, 0, Math.PI * 2);
      x.stroke();
    }
  });

  const up = () => { down = false; snap = null; };
  cv.addEventListener("pointerup", up);
  cv.addEventListener("pointercancel", up);

  const owner = chatScope();
  const showSaved = bindChat(show, owner);
  const save = () => {
    const w = Math.min(cv.width, Math.floor(wrap.clientWidth)) || cv.width;
    const h = Math.min(cv.height, Math.floor(wrap.clientHeight)) || cv.height;
    const out = document.createElement("canvas");
    out.width = w;
    out.height = h;
    out.getContext("2d")!.drawImage(cv, 0, 0, w, h, 0, 0, w, h);
    out.toBlob((blob) => {
      if (!blob) { toast("Could not encode the drawing as PNG"); return; }
      const name = `painting-${++saved}`;
      fetch(`/api/apps/images/api/import?title=${encodeURIComponent(name)}`, { method: "POST", headers: { "content-type": "image/png" }, body: blob })
        .then(async (r) => {
          const d = await r.json() as { id?: string; error?: string };
          if (!r.ok || !d.id) throw new Error(d.error ?? httpMsg(r.status));
          toast(`Saved ${name} to Files, in Own Image Studio`);
          showSaved(imageArtifact({ id: `images:${d.id}`, title: `${name}.png`, src: `/api/apps/images/api/history/${encodeURIComponent(d.id)}`, meta: "Own Image Studio · saved drawing" }));
        })
        .catch((e: Error) => {
          download(blob, `${name}.png`);
          toast(`Own Image Studio did not take it (${e.message}), so it was downloaded instead`);
        });
    }, "image/png");
  };

  frame.querySelector(".np-bar")!.addEventListener("click", (e) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-tool],[data-col],[data-act]");
    if (!el) return;
    if (el.dataset.tool) { tool = el.dataset.tool as Tool; pick("[data-tool]", el); return; }
    if (el.dataset.col) { col = el.dataset.col; pick("[data-col]", el); return; }
    if (el.dataset.act === "undo") {
      const h = hist.pop();
      if (!h) return;
      white();
      x.putImageData(h, 0, 0);
      return;
    }
    if (el.dataset.act === "clear") { push(); white(); return; }
    if (el.dataset.act === "save") save();
  });
  frame.querySelector<HTMLInputElement>(".np-sz")!.addEventListener("input", (e) => {
    size = +(e.target as HTMLInputElement).value;
  });

  return frame;
}

export function paintArtifact(o?: { title?: string }): Artifact {
  const title = o?.title ?? "paint.app";
  let frame: HTMLElement | null = null;
  return {
    id: `image:${title}`,
    kind: "image",
    title,
    meta: "Nexy Paint, runs on this device",
    render(host) {
      injectCss();
      frame ??= build();
      host.appendChild(frame);
      const note = document.createElement("div");
      note.className = "cvnote";
      note.textContent = "Nexy Paint, built on device. Save writes a PNG into Files, through Own Image Studio.";
      host.appendChild(note);
    },
  };
}
