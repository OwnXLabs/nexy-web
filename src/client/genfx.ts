type Ctx = CanvasRenderingContext2D;
type Draw = (x: Ctx, W: number, H: number, t: number, p: number) => void;

const TS = 26;

function materialise(cyber: boolean, W0: number, H0: number): Draw {
  let tiles: { x: number; y: number; d: number; f: number }[] = [];
  let lastW = 0;
  const mkTiles = (W: number, H: number) => {
    tiles = [];
    const cols = Math.ceil(W / TS) + 1, rows = Math.ceil(H / TS) + 1;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      tiles.push({ x: k * TS, y: r * TS, d: k / cols * 0.6 + r / rows * 0.4 + (Math.random() - 0.5) * 0.12, f: Math.random() });
    }
    lastW = W;
  };
  mkTiles(W0, H0);
  const blobs = cyber
    ? [{ h: "0,229,255", r: .5, sx: .25, sy: .35, vx: .12, vy: .08 }, { h: "255,47,214", r: .55, sx: .75, sy: .6, vx: -.09, vy: .1 }]
    : [{ h: "255,170,130", r: .55, sx: .2, sy: .3, vx: .13, vy: .09 }, { h: "124,92,255", r: .6, sx: .75, sy: .55, vx: -.1, vy: .12 }, { h: "255,246,236", r: .35, sx: .5, sy: .85, vx: .07, vy: -.11 }];
  const motes = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: Math.random() * 1.4 + .4, v: Math.random() * .25 + .08, o: Math.random() }));
  const tile = cyber ? "0,229,255" : "255,240,230";
  const edge = cyber ? "255,47,214" : "255,255,255";
  const mote = cyber ? "0,229,255" : "255,246,236";

  return (x, W, H, t, p) => {
    if (W !== lastW) mkTiles(W, H);
    x.save();
    x.globalCompositeOperation = "lighter";
    for (const b of blobs) {
      const bx = (b.sx + Math.sin(t * b.vx * 3) * .18) * W, by = (b.sy + Math.cos(t * b.vy * 3) * .16) * H, rr = Math.max(W, H) * b.r;
      const g = x.createRadialGradient(bx, by, 0, bx, by, rr);
      g.addColorStop(0, `rgba(${b.h},${cyber ? .16 : .14})`);
      g.addColorStop(.5, `rgba(${b.h},.05)`);
      g.addColorStop(1, `rgba(${b.h},0)`);
      x.fillStyle = g;
      x.fillRect(0, 0, W, H);
    }
    x.restore();

    for (const tl of tiles) {
      const res = Math.max(0, Math.min(1, (p * 1.15 - tl.d) * 6));
      const flick = res < 1 ? 0.04 + 0.12 * Math.abs(Math.sin(t * (14 + tl.f * 20) + tl.f * 40)) : 0;
      const a = flick * (1 - res) + res * 0.045;
      if (a < 0.005) continue;
      x.fillStyle = `rgba(${tile},${a})`;
      x.fillRect(tl.x + 1, tl.y + 1, TS - 2, TS - 2);
      if (res > 0 && res < 1) {
        x.strokeStyle = `rgba(${edge},${(cyber ? .5 : .45) * (1 - res)})`;
        x.lineWidth = 1;
        x.strokeRect(tl.x + 1.5, tl.y + 1.5, TS - 3, TS - 3);
      }
    }

    const fx = W * (p * 1.15 - 0.05);
    const g2 = x.createLinearGradient(fx - 160, 0, fx + 40, 0);
    g2.addColorStop(0, "rgba(255,255,255,0)");
    g2.addColorStop(.85, cyber ? "rgba(0,229,255,.16)" : "rgba(255,246,236,.14)");
    g2.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g2;
    x.save();
    x.transform(1, 0, -0.35, 1, 0, 0);
    x.fillRect(fx - 160 + H * 0.35, 0, 220, H);
    x.restore();

    for (const m of motes) {
      const my = ((m.y - t * m.v * 0.12) % 1 + 1) % 1, mx = (m.x + Math.sin(t * 0.6 + m.o * 9) * 0.01) % 1;
      x.fillStyle = `rgba(${mote},${(cyber ? .25 : .2) + (cyber ? .45 : .5) * Math.abs(Math.sin(t * 2 + m.o * 10))})`;
      x.beginPath();
      x.arc(mx * W, my * H, m.s, 0, 6.28);
      x.fill();
    }

    x.fillStyle = cyber ? "rgba(255,47,214,.08)" : "rgba(255,255,255,.05)";
    for (let s = 0; s < 3; s++) x.fillRect(0, (t * 0.08 + s / 3) % 1 * H, W, 1);
  };
}

const radar: Draw = (x, W, H, t, p) => {
  const cx = W / 2, cy = H / 2, R = Math.min(W, H) * .42, ang = t * 1.6;
  x.strokeStyle = "rgba(140,255,154,.07)";
  x.lineWidth = 1;
  for (let gx = 0; gx < W; gx += 32) { x.beginPath(); x.moveTo(gx, 0); x.lineTo(gx, H); x.stroke(); }
  for (let gy = 0; gy < H; gy += 32) { x.beginPath(); x.moveTo(0, gy); x.lineTo(W, gy); x.stroke(); }
  x.strokeStyle = "rgba(140,255,154,.18)";
  for (const f of [0.35, 0.7, 1]) { x.beginPath(); x.arc(cx, cy, R * f, 0, 6.28); x.stroke(); }
  x.strokeStyle = "rgba(140,255,154,.14)";
  x.beginPath(); x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.moveTo(cx, cy - R); x.lineTo(cx, cy + R); x.stroke();
  for (let i = 0; i < 36; i++) {
    const a = i / 36 * 6.28, l = i % 9 === 0 ? 12 : 6;
    x.strokeStyle = `rgba(140,255,154,${i % 9 === 0 ? .5 : .25})`;
    x.beginPath(); x.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R); x.lineTo(cx + Math.cos(a) * (R - l), cy + Math.sin(a) * (R - l)); x.stroke();
  }
  const g = x.createConicGradient(ang, cx, cy);
  g.addColorStop(0, "rgba(140,255,154,.35)");
  g.addColorStop(.12, "rgba(140,255,154,0)");
  g.addColorStop(1, "rgba(140,255,154,0)");
  x.fillStyle = g;
  x.beginPath(); x.moveTo(cx, cy); x.arc(cx, cy, R, 0, 6.28); x.fill();
  x.strokeStyle = "rgba(183,255,192,.9)";
  x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(cx, cy); x.lineTo(cx + Math.cos(ang) * R, cy + Math.sin(ang) * R); x.stroke();
  x.font = "10px monospace";
  [[0.6, 1.1], [0.3, 3.9], [0.85, 2.4]].forEach(([r, ba], i) => {
    const br = R * r, d = ((ang - ba) % 6.28 + 6.28) % 6.28, al = Math.max(0, 1 - d / 2.5);
    x.fillStyle = `rgba(183,255,192,${al})`;
    x.fillRect(cx + Math.cos(ba) * br - 2, cy + Math.sin(ba) * br - 2, 4, 4);
    x.fillStyle = `rgba(140,255,154,${al * .8})`;
    x.fillText(`TGT-0${i + 1}`, cx + Math.cos(ba) * br + 6, cy + Math.sin(ba) * br - 4);
  });
  x.fillStyle = "rgba(140,255,154,.6)";
  x.fillText("SYS  NOMINAL", 12, H - 12);
  x.fillText(`T+${t.toFixed(1)}s`, W - 70, H - 12);
  x.fillText(`SCAN ${Math.round(p * 100)}%`, 12, 18);
};

export function startFx(host: HTMLElement, progress: () => number): () => void {
  const theme = document.body.dataset.theme || "default";
  host.classList.add(`fx-${theme}`);
  if (!["default", "cyberpunk", "topgun"].includes(theme)) return () => {};
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {};

  const c = document.createElement("canvas");
  c.className = "genfx";
  host.prepend(c);
  const x = c.getContext("2d");
  if (!x) return () => c.remove();
  const size = () => { c.width = host.clientWidth; c.height = host.clientHeight; };
  size();
  const ro = new ResizeObserver(size);
  ro.observe(host);

  const draw = theme === "topgun" ? radar : materialise(theme === "cyberpunk", c.width, c.height);
  const t0 = performance.now();
  let raf = 0;
  const frame = () => {
    if (!c.isConnected) { ro.disconnect(); return; }
    x.clearRect(0, 0, c.width, c.height);
    draw(x, c.width, c.height, (performance.now() - t0) / 1000, progress());
    raf = requestAnimationFrame(frame);
  };
  frame();
  return () => { cancelAnimationFrame(raf); ro.disconnect(); c.remove(); };
}
