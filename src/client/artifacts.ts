import type { Artifact, ArtifactKind } from "./canvas";
import { imageArtifact } from "./image-tools";
import { httpMsg, errText } from "./http";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export interface FeedLike {
  kind: string;
  title: string;
  appLabel: string;
  app: string;
  ts: number;
  href?: string;
}

export function kindOf(f: FeedLike): ArtifactKind {
  if (f.kind === "project") return "plan";
  if (f.kind === "doc") return "doc";
  if (f.kind === "site" || f.kind === "html") return "html";
  if (f.kind === "image") return "image";
  if (f.kind === "audio") return "audio";
  if (f.kind === "table" || f.kind === "sheet") return "table";
  if (f.kind === "diagram" || f.kind === "flowchart") return "diagram";
  if (f.kind === "game") return "game";
  if (f.kind === "code") return "code";
  return "text";
}

const when = (ts: number) =>
  new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

function unfetchable(f: FeedLike, medium: string): (host: HTMLElement) => void {
  return (host) => {
    host.innerHTML =
      `<div class="pad"><div class="empty" style="text-align:left">` +
      `<b>${esc(f.title)}</b><br><span class="faint">` +
      `${esc(f.appLabel)} holds this ${esc(medium)}, made ${esc(when(f.ts))}. ` +
      `It cannot be shown here yet: the app lists what it has but does not serve the file ` +
      `over a URL, so there is nothing for this pane to load. Use the button above to open ` +
      `${esc(f.appLabel)}.</span></div></div>`;
  };
}

export function artifactFor(f: FeedLike): Artifact {
  const kind = kindOf(f);
  const base = {
    id: `${f.app}:${f.title}`,
    kind,
    title: f.title,
    meta: `${f.appLabel} · ${when(f.ts)} · on device`,
    href: f.href,
  };

  if (f.href && kind === "image") return imageArtifact({ id: base.id, title: f.title, src: f.href, meta: base.meta, href: f.href });
  if (f.href && kind === "audio") return { ...base, render: (h) => player(h, f.href!) };
  if (f.href && (kind === "html" || kind === "game")) {
    return { ...base, render: (h) => {
      h.innerHTML = `<div class="frame${kind === "game" ? " game" : " tall"}">` +
        `<iframe src="${esc(f.href)}" sandbox="allow-scripts allow-forms"></iframe></div>`;
    } };
  }

  if (f.href && kind === "doc") {
    return { ...base, render: (h) => {
      h.innerHTML = `<div class="doc"><p class="faint">Opening ${esc(f.title)}…</p></div>`;
      fetch(f.href!).then(async (r) => {
        const d = await r.json() as { text?: string; error?: string };
        if (!r.ok || typeof d.text !== "string") throw new Error(d.error ?? httpMsg(r.status));
        const doc = h.querySelector(".doc");
        if (doc) doc.innerHTML = `<h1>${esc(f.title)}</h1>` + d.text.split(/\n{2,}/).map((p) => `<p>${esc(p)}</p>`).join("");
      }).catch((e: Error) => {
        const doc = h.querySelector(".doc");
        if (doc) doc.innerHTML = `<p>${esc(f.appLabel)} did not return ${esc(f.title)}: ${esc(errText(e))}</p>`;
      });
    } };
  }

  const medium =
    kind === "image" ? "image" : kind === "audio" ? "audio track"
    : kind === "html" ? "site" : kind === "doc" ? "document"
    : kind === "table" ? "spreadsheet" : kind === "diagram" ? "diagram"
    : kind === "game" ? "game" : kind === "code" ? "file of code" : "file";
  return { ...base, render: unfetchable(f, medium) };
}

const N = 64;
const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function player(host: HTMLElement, src: string): void {
  host.innerHTML =
    `<div class="pad"><div class="player"><button class="key" type="button" aria-label="Play"><svg class="i" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></button>` +
    `<div class="bars">${Array.from({ length: N }, () => `<i style="height:20%"></i>`).join("")}</div><span class="faint">0:00</span></div></div>`;
  const audio = new Audio(src);
  audio.preload = "metadata";
  const key = host.querySelector<HTMLButtonElement>(".key")!;
  const bars = [...host.querySelectorAll<HTMLElement>(".bars i")];
  const time = host.querySelector<HTMLElement>(".player .faint")!;
  const paint = () => {
    const d = audio.duration || 0, at = d ? audio.currentTime / d : 0;
    bars.forEach((b, k) => { b.style.opacity = k / N < at ? "1" : ".35"; });
    time.textContent = d ? `${mmss(audio.currentTime)} / ${mmss(d)}` : mmss(audio.currentTime);
  };
  const icon = (playing: boolean) => { key.innerHTML = playing ? `<svg class="i" viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>` : `<svg class="i" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`; };
  key.addEventListener("click", () => { if (audio.paused) void audio.play().catch((e: Error) => { time.textContent = `Could not play: ${e.message}`; }); else audio.pause(); });
  audio.addEventListener("play", () => icon(true));
  audio.addEventListener("pause", () => icon(false));
  audio.addEventListener("ended", () => { icon(false); paint(); });
  audio.addEventListener("timeupdate", paint);
  audio.addEventListener("loadedmetadata", paint);
  host.querySelector<HTMLElement>(".bars")!.addEventListener("click", (e) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    if (audio.duration) audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
  });
  fetch(src)
    .then((r) => { if (!r.ok) throw new Error(httpMsg(r.status)); return r.arrayBuffer(); })
    .then((buf) => { const ctx = new AudioContext(); return ctx.decodeAudioData(buf).finally(() => void ctx.close()); })
    .then((ab) => {
      const ch = ab.getChannelData(0), step = Math.max(1, Math.floor(ch.length / N));
      const peaks = bars.map((_, k) => { let m = 0; for (let x = k * step; x < Math.min(ch.length, (k + 1) * step); x += 64) m = Math.max(m, Math.abs(ch[x])); return m; });
      const top = Math.max(...peaks) || 1;
      bars.forEach((b, k) => { b.style.height = `${Math.max(6, Math.round((peaks[k] / top) * 100))}%`; });
    })
    .catch((e: Error) => console.warn("[nexy] waveform unavailable", e.message));
}
