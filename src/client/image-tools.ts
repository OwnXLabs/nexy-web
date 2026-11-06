import { show, type Artifact } from "./canvas";
import { httpMsg } from "./http";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const say = (msg: string) =>
  window.dispatchEvent(new CustomEvent("nexy:toast", { detail: msg }));

type Brand = "crop" | "instagram" | "linkedin" | "x" | "facebook" | "pinterest";
const CROPS: [string, string | null, Brand][] = [
  ["Original", null, "crop"],
  ["Instagram square", "1:1", "instagram"],
  ["Instagram story", "9:16", "instagram"],
  ["LinkedIn", "1.91:1", "linkedin"],
  ["X", "16:9", "x"],
  ["Facebook cover", "2.63:1", "facebook"],
  ["Pinterest", "2:3", "pinterest"],
];

const LOGOS: Record<Brand, string> = {
  instagram: `<svg viewBox="0 0 24 24"><defs><linearGradient id="ig" x1="1" y1="23" x2="23" y2="1"><stop stop-color="#ffb000"/><stop offset=".45" stop-color="#e1306c"/><stop offset="1" stop-color="#833ab4"/></linearGradient></defs><rect x="1" y="1" width="22" height="22" rx="6" fill="url(#ig)"/><circle cx="12" cy="12" r="4.4" fill="none" stroke="#fff" stroke-width="2"/><circle cx="18" cy="6" r="1.3" fill="#fff"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="3" fill="#0A66C2"/><circle cx="6.8" cy="7" r="1.6" fill="#fff"/><path d="M5.3 10h3v9h-3zm4.8 0H13v1.25c.8-1.05 1.85-1.55 3.15-1.55 2.45 0 3.55 1.55 3.55 4.3v5h-3v-4.45c0-1.4-.48-2.2-1.63-2.2-1.28 0-1.97.88-1.97 2.55V19h-3z" fill="#fff"/></svg>`,
  x: `<svg viewBox="0 0 24 24"><rect x="1" y="1" width="22" height="22" rx="5" fill="#090909"/><path d="M6 5h3.8l3.1 4.2L16.5 5H19l-5 5.9L19.4 19h-3.8l-3.7-5.1L7.5 19H5l5.7-6.8z" fill="#fff"/></svg>`,
  facebook: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#1877F2"/><path d="M13.7 20v-7h2.35l.35-2.75h-2.7V8.5c0-.8.22-1.34 1.36-1.34h1.45V4.7a19 19 0 0 0-2.12-.11c-2.1 0-3.54 1.28-3.54 3.64v2.02H8.48V13h2.37v7z" fill="#fff"/></svg>`,
  pinterest: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" fill="#E60023"/><path d="M12.2 5.2c-4.05 0-6.2 2.9-6.2 5.3 0 1.8.68 3.4 2.14 4 .24.1.45 0 .52-.27l.2-.82c.07-.27.04-.36-.15-.58-.42-.5-.7-1.15-.7-2.07 0-2.66 2-5.08 5.18-5.08 2.83 0 4.38 1.73 4.38 4.03 0 3.04-1.34 5.6-3.34 5.6-1.1 0-1.93-.91-1.66-2.03.32-1.34.93-2.78.93-3.75 0-.86-.46-1.58-1.42-1.58-1.12 0-2.02 1.16-2.02 2.72 0 .99.34 1.66.34 1.66l-1.35 5.7c-.4 1.7-.06 3.78-.03 4 .02.13.18.16.25.06.1-.13 1.4-1.73 1.84-3.33.12-.45.7-2.73.7-2.73.35.66 1.36 1.24 2.44 1.24 3.21 0 5.39-2.93 5.39-6.85 0-2.96-2.51-5.72-6.33-5.72z" fill="#fff"/></svg>`,
  crop: `<svg viewBox="0 0 24 24"><path d="M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M8 21H4a1 1 0 0 1-1-1v-4m13 5h4a1 1 0 0 0 1-1v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
};

const logo = (k: Brand) => `<span class="cropbrand ${k === "instagram" ? "ig" : k}" aria-hidden="true">${LOGOS[k]}</span>`;

interface Edit {
  b: number; c: number; s: number; blur: number;
  crop: string | null;
  pos: { x: number; y: number } | null;
  rot: number;
  flip: boolean;
}

const fresh = (): Edit => ({ b: 100, c: 100, s: 100, blur: 0, crop: null, pos: null, rot: 0, flip: false });
const ratio = (c: string) => { const [w, h] = c.split(":").map(Number); return w / h; };
const cropName = (c: string | null) => CROPS.find((k) => k[1] === c)?.[0] ?? "Original";

// Largest box of the wanted aspect that fits in w×h.
function fit(w: number, h: number, want: number): [number, number] {
  return w / h > want ? [h * want, h] : [w, w / want];
}

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((ok, fail) => {
    const im = new Image();
    im.onload = () => ok(im);
    im.onerror = () => fail(new Error("the image could not be read back for editing"));
    im.src = src;
  });
}

// Filters and rotation first, then the crop, so the file matches the frame on screen.
async function render(src: string, e: Edit, scale: number): Promise<HTMLCanvasElement> {
  const im = await load(src);
  const W = im.naturalWidth, H = im.naturalHeight;
  if (!W || !H) throw new Error("the image has no size");
  const turned = e.rot % 180 !== 0;
  const tw = turned ? H : W, th = turned ? W : H;

  const full = document.createElement("canvas");
  full.width = Math.round(tw * scale);
  full.height = Math.round(th * scale);
  const fx = full.getContext("2d");
  if (!fx) throw new Error("this browser gave no 2D canvas");
  fx.imageSmoothingEnabled = true;
  fx.imageSmoothingQuality = "high";
  fx.filter = `brightness(${e.b}%) contrast(${e.c}%) saturate(${e.s}%) blur(${e.blur * scale}px)`;
  fx.translate(full.width / 2, full.height / 2);
  fx.rotate((e.rot * Math.PI) / 180);
  if (e.flip) fx.scale(-1, 1);
  fx.drawImage(im, (-W * scale) / 2, (-H * scale) / 2, W * scale, H * scale);
  if (!e.crop) return full;

  const [cw, ch] = fit(full.width, full.height, ratio(e.crop)).map(Math.round);
  const cx = e.pos ? e.pos.x * full.width : (full.width - cw) / 2;
  const cy = e.pos ? e.pos.y * full.height : (full.height - ch) / 2;
  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  const ox = out.getContext("2d");
  if (!ox) throw new Error("this browser gave no 2D canvas");
  ox.drawImage(full, Math.max(0, Math.min(full.width - cw, cx)), Math.max(0, Math.min(full.height - ch, cy)), cw, ch, 0, 0, cw, ch);
  return out;
}

const toBlob = (cv: HTMLCanvasElement) =>
  new Promise<Blob>((ok, fail) =>
    cv.toBlob((b) => (b ? ok(b) : fail(new Error("the canvas would not encode a PNG"))), "image/png"));

async function upscaled(cv: HTMLCanvasElement): Promise<{ blob: Blob; w: number; h: number }> {
  const r = await fetch("/api/apps/images/api/upscale", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: cv.toDataURL("image/png"), scale: 2 }) });
  const d = await r.json() as { image?: string; error?: string };
  if (!r.ok || !d.image) throw new Error(d.error ?? httpMsg(r.status));
  const blob = await (await fetch(d.image)).blob();
  const bmp = await createImageBitmap(blob);
  const size = { w: bmp.width, h: bmp.height };
  bmp.close();
  return { blob, ...size };
}

async function exportFile(o: { title: string; src: string }, e: Edit, scale: number): Promise<void> {
  let cv = await render(o.src, e, 1);
  let blob: Blob | null = null, how = "edited on this machine";
  if (scale > 1) {
    say("Upscaling with Real-ESRGAN on this machine…");
    try {
      const up = await upscaled(cv);
      blob = up.blob;
      how = `${up.w}×${up.h}, upscaled 2× with Real-ESRGAN on this machine`;
    } catch (err) {
      cv = await render(o.src, e, 2);
      how = `${cv.width}×${cv.height}, resampled 2× (the upscaler did not answer: ${(err as Error).message})`;
    }
  }
  if (!blob) blob = await toBlob(cv);
  const url = URL.createObjectURL(blob);
  const stem = o.title.replace(/\.[a-z0-9]+$/i, "");
  const tag = e.crop ? `-${cropName(e.crop).toLowerCase().replace(/[^a-z0-9]+/g, "-")}` : "";
  const name = `${stem}${tag}${scale > 1 ? "-2x" : "-edit"}.png`;

  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();

  const note = [
    scale > 1 ? "" : `${cv.width}×${cv.height}`,
    e.crop ? `cropped for ${cropName(e.crop)}` : "",
    how,
  ].filter(Boolean).join(", ");
  show(imageArtifact({ id: `img:${name}:${Date.now()}`, title: name, src: url, meta: note, href: url }));
  say(`Saved ${name}, ${how}`);
}

export function imageArtifact(o: { id: string; title: string; src: string; meta?: string; href?: string }): Artifact {
  return {
    id: o.id,
    kind: "image",
    title: o.title,
    meta: o.meta,
    href: o.href ?? o.src,
    render: (host) => mount(host, o),
  };
}

function mount(host: HTMLElement, o: { title: string; src: string; meta?: string }): void {
  host.innerHTML =
    `<div class="img" style="position:relative"><img src="${esc(o.src)}" alt="${esc(o.title)}" draggable="false" style="display:block;width:100%;height:auto">` +
    `<div class="crop" hidden style="pointer-events:auto;cursor:move"></div></div>` +
    `<div class="zoombar"><button type="button" data-z="-1" title="Zoom out">−</button><span id="zoomv">100%</span>` +
    `<button type="button" data-z="1" title="Zoom in">+</button><button type="button" data-z="0" title="Fit">Fit</button>` +
    `<span class="faint" style="margin-left:8px">Scroll to zoom, drag to pan; drag the white frame to place the crop</span></div>` +
    (o.meta ? `<div class="cvnote">${esc(o.meta)}</div>` : "") +
    `<div class="imgtools"><div class="crops">` +
    CROPS.map((c, i) => `<button type="button" class="chipx${i === 0 ? " on" : ""}" data-c="${c[1] ?? ""}">${logo(c[2])}${c[0]}</button>`).join("") +
    `</div><div class="edits">` +
    `<label>Brightness<input type="range" min="40" max="160" value="100" data-f="b"></label>` +
    `<label>Contrast<input type="range" min="40" max="160" value="100" data-f="c"></label>` +
    `<label>Saturation<input type="range" min="0" max="200" value="100" data-f="s"></label>` +
    `<label>Blur<input type="range" min="0" max="8" value="0" data-f="blur"></label>` +
    `<button class="btn small" type="button" data-e="rot"><svg class="i" viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/></svg>Rotate</button>` +
    `<button class="btn small" type="button" data-e="flip">Flip</button>` +
    `<button class="btn small" type="button" data-e="reset">Reset</button><span class="sp"></span>` +
    `<button class="btn small" type="button" data-e="up" title="Real-ESRGAN on this machine">Upscale 2×</button>` +
    `<button class="btn small primary" type="button" data-e="export">Export as new file</button></div></div>`;

  const box = host.querySelector<HTMLElement>(".img")!;
  const pic = box.querySelector<HTMLImageElement>("img")!;
  const frame = box.querySelector<HTMLElement>(".crop")!;
  const zv = host.querySelector<HTMLElement>("#zoomv")!;
  const tools = host.querySelector<HTMLElement>(".imgtools")!;
  let e = fresh();
  let z = { s: 1, x: 0, y: 0 };
  let busy = false;

  const paint = () => {
    pic.style.filter = `brightness(${e.b}%) contrast(${e.c}%) saturate(${e.s}%) blur(${e.blur}px)`;
    pic.style.transformOrigin = "center";
    pic.style.transform = `translate(${z.x}px,${z.y}px) scale(${z.s}) rotate(${e.rot}deg)${e.flip ? " scaleX(-1)" : ""}`;
    zv.textContent = `${Math.round(z.s * 100)}%`;
  };

  const place = () => {
    if (!e.crop) { frame.hidden = true; return; }
    const w = box.clientWidth, h = box.clientHeight;
    const [cw, ch] = fit(w, h, ratio(e.crop));
    const x = e.pos ? Math.min(w - cw, e.pos.x * w) : (w - cw) / 2;
    const y = e.pos ? Math.min(h - ch, e.pos.y * h) : (h - ch) / 2;
    frame.hidden = false;
    Object.assign(frame.style, { width: `${cw}px`, height: `${ch}px`, left: `${x}px`, top: `${y}px` });
  };

  const zoom = (dir: number, px?: number, py?: number) => {
    const ns = Math.max(0.25, Math.min(6, z.s * (dir > 0 ? 1.2 : 1 / 1.2)));
    if (px !== undefined && py !== undefined) {
      const r = box.getBoundingClientRect();
      const dx = px - r.left - r.width / 2, dy = py - r.top - r.height / 2;
      z.x = dx - (dx - z.x) * (ns / z.s);
      z.y = dy - (dy - z.y) * (ns / z.s);
    }
    z.s = ns;
    paint();
  };

  host.querySelectorAll<HTMLElement>("[data-z]").forEach((b) => b.addEventListener("click", () => {
    const d = Number(b.dataset.z);
    if (d) { zoom(d); return; }
    z = { s: 1, x: 0, y: 0 };
    paint();
  }));
  box.addEventListener("wheel", (ev) => { ev.preventDefault(); zoom(ev.deltaY < 0 ? 1 : -1, ev.clientX, ev.clientY); }, { passive: false });

  let pan: { x: number; y: number } | null = null;
  box.addEventListener("pointerdown", (ev) => {
    if ((ev.target as HTMLElement).closest(".crop")) return;
    pan = { x: ev.clientX - z.x, y: ev.clientY - z.y };
    box.setPointerCapture(ev.pointerId);
    box.style.cursor = "grabbing";
  });
  box.addEventListener("pointermove", (ev) => {
    if (!pan) return;
    z.x = ev.clientX - pan.x;
    z.y = ev.clientY - pan.y;
    paint();
  });
  const endPan = () => { pan = null; box.style.cursor = ""; };
  box.addEventListener("pointerup", endPan);
  box.addEventListener("pointercancel", endPan);

  let grab: { x: number; y: number } | null = null;
  frame.addEventListener("pointerdown", (ev) => {
    ev.stopPropagation();
    grab = { x: ev.clientX - frame.offsetLeft, y: ev.clientY - frame.offsetTop };
    frame.setPointerCapture(ev.pointerId);
  });
  frame.addEventListener("pointermove", (ev) => {
    if (!grab) return;
    const w = box.clientWidth, h = box.clientHeight;
    const nx = Math.max(0, Math.min(w - frame.offsetWidth, ev.clientX - grab.x));
    const ny = Math.max(0, Math.min(h - frame.offsetHeight, ev.clientY - grab.y));
    frame.style.left = `${nx}px`;
    frame.style.top = `${ny}px`;
    e.pos = { x: nx / w, y: ny / h };
  });
  frame.addEventListener("pointerup", () => { grab = null; });

  const chips = [...tools.querySelectorAll<HTMLElement>(".chipx")];
  chips.forEach((b) => b.addEventListener("click", () => {
    chips.forEach((x) => x.classList.toggle("on", x === b));
    e.crop = b.dataset.c || null;
    e.pos = null;
    place();
  }));

  const sliders = [...tools.querySelectorAll<HTMLInputElement>("[data-f]")];
  sliders.forEach((i) => i.addEventListener("input", () => {
    const k = i.dataset.f as "b" | "c" | "s" | "blur";
    e[k] = Number(i.value);
    paint();
  }));

  tools.querySelectorAll<HTMLButtonElement>("[data-e]").forEach((b) => b.addEventListener("click", () => {
    const act = b.dataset.e;
    if (act === "rot") { e.rot = (e.rot + 90) % 360; paint(); return; }
    if (act === "flip") { e.flip = !e.flip; paint(); return; }
    if (act === "reset") {
      e = fresh();
      z = { s: 1, x: 0, y: 0 };
      sliders.forEach((i) => { i.value = i.dataset.f === "blur" ? "0" : "100"; });
      chips.forEach((x, k) => x.classList.toggle("on", k === 0));
      paint();
      place();
      return;
    }
    if (busy) return;
    busy = true;
    b.disabled = true;
    exportFile(o, { ...e }, act === "up" ? 2 : 1)
      .catch((err: Error) => {
        console.warn("[nexy] image export failed", err);
        say(`Could not export: ${err.message}`);
      })
      .finally(() => { busy = false; b.disabled = false; });
  }));

  new ResizeObserver(place).observe(box);
  paint();
}
