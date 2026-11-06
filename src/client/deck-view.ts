import type { Artifact } from "./canvas";
import type { Slide } from "./deck";

const CSS = `.deckapp{height:100%;min-height:520px;display:grid;grid-template-rows:48px minmax(0,1fr);background:#080d12;border:1px solid var(--line);border-radius:12px;overflow:hidden;color:#edf8fb}
.deckapp:focus{outline:0}
.deckbar{display:flex;align-items:center;gap:8px;padding:0 12px;border-bottom:1px solid #20313a;background:#0b1218}.deckbar b{font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.deckbar .sp{flex:1}.deckcount{font:11px ui-monospace,Menlo,monospace;color:#78909b;white-space:nowrap}.deckdl{height:29px;padding:0 11px;border:1px solid #29434d;border-radius:7px;color:#dffbff;font-size:11px;background:#101b22;white-space:nowrap}.deckdl.primary{background:#4DE6C1;color:#04110d;border-color:#4DE6C1;font-weight:700}
.deckbody{min-height:0;display:grid;grid-template-columns:148px minmax(0,1fr)}.deckthumbs{overflow:auto;padding:10px;background:#070b0f;border-right:1px solid #1b2a32}.deckthumb{width:100%;display:grid;grid-template-columns:23px 1fr;gap:7px;text-align:left;color:#71858e;padding:8px 7px;margin-bottom:5px;border:1px solid transparent;border-radius:8px;font-size:9.5px;line-height:1.3}.deckthumb i{font:9px ui-monospace,Menlo,monospace;color:#4DE6C1;font-style:normal}.deckthumb.on{color:#eafcff;background:#111b21;border-color:#31505a}.deckstage{min-width:0;min-height:0;display:grid;place-items:center;padding:22px;overflow:auto;background:radial-gradient(circle at 50% 0,#17313a 0,#080d12 52%)}.deckstage:focus{outline:0}
.dslide{position:relative;width:min(100%,960px);aspect-ratio:16/9;overflow:hidden;border-radius:9px;background:linear-gradient(145deg,#07141a,#0c1f27);box-shadow:0 24px 70px #000b;border:1px solid #24404a;padding:7% 7.5%;display:flex;flex-direction:column;justify-content:safe center}.dslide:before{content:"";position:absolute;width:52%;aspect-ratio:1;right:-18%;top:-34%;border:1px solid #4de6c13b;border-radius:50%;box-shadow:0 0 0 42px #4de6c10b,0 0 0 84px #4de6c108}.dslide:after{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:linear-gradient(#4DE6C1,#35AFFF)}.dlogo{position:absolute;left:7.5%;top:7%;font:800 12px ui-monospace,Menlo,monospace;letter-spacing:.16em;color:#4DE6C1}.dpage{position:absolute;right:5%;bottom:5%;font:11px ui-monospace,Menlo,monospace;color:#617985}.dkicker{position:relative;z-index:1;font:700 12px ui-monospace,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:#4DE6C1;margin-bottom:2.2%}.dslide h1{position:relative;z-index:1;max-width:82%;font-size:62px;line-height:.98;letter-spacing:-.045em;margin:0 0 2.5%;font-weight:720}.dslide>p{position:relative;z-index:1;max-width:72%;color:#91aab4;font-size:20px;line-height:1.45;margin:0}.dstats{position:relative;z-index:1;display:grid;grid-template-columns:repeat(3,1fr);gap:2%;margin-top:5%}.dstat{padding:10% 9%;border:1px solid #26434d;background:#0d2027b8;border-radius:9px}.dstat b{display:block;color:#4DE6C1;font-size:34px;line-height:1}.dstat span{display:block;color:#8ca3ad;font-size:14px;margin-top:7%;line-height:1.3}.dnote{position:absolute;left:7.5%;bottom:5%;font-size:10px;color:#526a74;max-width:70%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dframe{position:relative;flex:none}.dframe>.dslide{position:absolute;left:0;top:0;width:960px;height:540px;transform-origin:0 0;padding:67px 72px}.dslide>h1,.dslide>p,.dlist,.dstats{zoom:var(--k,1)}
.dslide.cover h1{font-size:72px}
.dlist{position:relative;z-index:1;list-style:none;margin:3.5% 0 0;padding:0;display:flex;flex-direction:column;gap:14px;max-width:86%}.dlist li{position:relative;padding-left:22px;color:#cfe4ea;font-size:22px;line-height:1.35}.dlist li:before{content:"";position:absolute;left:0;top:.5em;width:8px;height:8px;border-radius:50%;background:#4DE6C1}.dlist li b{color:#4DE6C1;font-weight:700}
.dsrc{display:block;margin-top:.35em;font:12px ui-monospace,Menlo,monospace;color:#617985;letter-spacing:.02em}
.dslide.dense h1{font-size:46px}.dslide.dense .dlist{gap:10px}.dslide.dense .dlist li{font-size:18px}
.cvnote{font-size:11.5px;color:var(--fg3);margin-top:8px;line-height:1.5}
.canvas.narrow .deckbody{grid-template-columns:1fr;grid-template-rows:auto 1fr}.canvas.narrow .deckthumbs{display:flex;gap:5px;overflow-x:auto;border-right:0;border-bottom:1px solid #1b2a32}.canvas.narrow .deckthumb{min-width:118px;margin:0}.canvas.narrow .deckstage{padding:10px}.canvas.narrow .deckbar b{display:none}@media(max-width:620px){.deckbody{grid-template-columns:1fr;grid-template-rows:auto 1fr}.deckthumbs{display:flex;gap:5px;overflow-x:auto;border-right:0;border-bottom:1px solid #1b2a32}.deckthumb{min-width:118px;margin:0}.deckstage{padding:9px}.deckbar b{display:none}}`;

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const say = (msg: string) => window.dispatchEvent(new CustomEvent("nexy:toast", { detail: msg }));
const pad = (n: number) => String(n).padStart(2, "0");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "deck";

function injectCss(): void {
  if (document.getElementById("nexy-deck-css")) return;
  const st = document.createElement("style");
  st.id = "nexy-deck-css";
  st.textContent = CSS;
  document.head.appendChild(st);
}

const FIGURE = /[$€£¥]?\d(?:[\d,]*\d)?(?:\.\d+)?\s?(?:%|[kKmMbB]n?\b|x\b|×)?/g;
const figureOf = (t: string): string | null =>
  [...t.matchAll(FIGURE)].map((m) => m[0].trim()).find((f) => f.replace(/\D/g, "").length > 1 || /[%$€£¥]/.test(f)) ?? null;

function slideHtml(s: Slide, i: number, n: number, deck: string): string {
  const figs = s.bullets.map((b) => figureOf(b.text));
  const stats = s.bullets.length > 0 && s.bullets.length <= 3 && figs.every(Boolean) && s.bullets.every((b) => b.text.length <= 110);
  const long = s.bullets.reduce((a, b) => a + b.text.length, 0);
  const cls = ["dslide", i === 0 && !s.bullets.length ? "cover" : "", !stats && (s.bullets.length > 4 || long > 380) ? "dense" : ""].filter(Boolean).join(" ");
  const src = (b: Slide["bullets"][number]) => (b.source ? `<small class="dsrc">from ${esc(b.source)}</small>` : "");
  const body = !s.bullets.length ? ""
    : stats
      ? `<div class="dstats">${s.bullets.map((b, j) => `<div class="dstat"><b>${esc(figs[j])}</b><span>${esc(b.text)}${src(b)}</span></div>`).join("")}</div>`
      : `<ul class="dlist">${s.bullets.map((b, j) => {
        const f = figs[j];
        const k = f ? b.text.indexOf(f) : -1;
        const t = k < 0 ? esc(b.text) : `${esc(b.text.slice(0, k))}<b>${esc(f)}</b>${esc(b.text.slice(k + f!.length))}`;
        return `<li>${t}${src(b)}</li>`;
      }).join("")}</ul>`;
  const para = s.note && !s.bullets.length ? `<p>${esc(s.note)}</p>` : "";
  const foot = s.note && s.bullets.length ? s.note : "";
  return `<article class="${cls}"><span class="dlogo">NEXY</span><span class="dkicker">${esc(i === 0 ? deck : `${pad(i)} · ${deck}`)}</span>` +
    `<h1>${esc(s.title)}</h1>${para}${body}${foot ? `<span class="dnote">${esc(foot)}</span>` : ""}` +
    `<span class="dpage">${pad(i + 1)} / ${pad(n)}</span></article>`;
}

function download(blob: Blob, name: string): void {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}

const ASCII: Record<string, string> = { "‘": "'", "’": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", "•": "-", "×": "x", "€": "EUR ", "£": "GBP ", " ": " " };
const ascii = (s: string) => s.replace(/[‘’“”–—…•×€£ ]/g, (c) => ASCII[c]).normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7E]/g, "-");
const pdfEsc = (s: string) => ascii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
function wrap(s: string, n: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of ascii(s).split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + w).length > n) { out.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}

export function deckPdfBlob(title: string, slides: Slide[]): Blob {
  const enc = new TextEncoder();
  const objs: string[] = [];
  const pages: string[] = [];
  slides.forEach((s, i) => {
    const pn = 5 + i * 2, cn = pn + 1;
    pages.push(`${pn} 0 R`);
    const cmd = ["q", "0.027 0.075 0.102 rg", "0 0 720 405 re f", "0.302 0.902 0.757 rg", "0 0 6 405 re f", "Q"];
    const text = (font: string, size: number, rgb: string, x: number, y: number, t: string) =>
      cmd.push("BT", `/${font} ${size} Tf`, `${rgb} rg`, `1 0 0 1 ${x} ${y} Tm`, `(${pdfEsc(t)}) Tj`, "ET");
    text("F1", 9, "0.302 0.902 0.757", 54, 366, "NEXY");
    text("F1", 8, "0.302 0.902 0.757", 54, 336, (i === 0 ? title : `${pad(i)} - ${title}`).toUpperCase());
    let y = 300;
    for (const l of wrap(s.title, 40).slice(0, 2)) { text("F1", 26, "0.92 0.98 1", 54, y, l); y -= 30; }
    y -= 8;
    const lines: [string, number, string, string, number][] = [];
    if (!s.bullets.length && s.note) for (const l of wrap(s.note, 84)) lines.push(["F2", 12, "0.58 0.69 0.73", l, 54]);
    for (const b of s.bullets) {
      wrap(b.text, 92).forEach((l, j) => lines.push(["F2", 11, "0.86 0.93 0.95", (j ? "  " : "- ") + l, 54]));
      if (b.source) lines.push(["F2", 7.5, "0.38 0.49 0.53", `from ${b.source}`, 63]);
    }
    for (const [f, size, rgb, t, x] of lines) {
      if (y < 48) break;
      text(f, size, rgb, x, y, t);
      y -= size + (size < 8 ? 10 : 5);
    }
    if (s.note && s.bullets.length) text("F2", 7, "0.32 0.42 0.45", 54, 22, s.note.slice(0, 140));
    text("F2", 8, "0.38 0.49 0.53", 650, 22, `${pad(i + 1)} / ${pad(slides.length)}`);
    const stream = cmd.join("\n");
    objs[pn] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 405] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${cn} 0 R >>`;
    objs[cn] = `<< /Length ${enc.encode(stream).length} >>\nstream\n${stream}\nendstream`;
  });
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = `<< /Type /Pages /Kids [${pages.join(" ")}] /Count ${pages.length} >>`;
  objs[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  const max = 4 + slides.length * 2;
  const parts = ["%PDF-1.4\n"];
  const offset = [0];
  let len = parts[0].length;
  for (let i = 1; i <= max; i++) {
    offset[i] = len;
    const z = `${i} 0 obj\n${objs[i]}\nendobj\n`;
    parts.push(z);
    len += enc.encode(z).length;
  }
  let tail = `xref\n0 ${max + 1}\n0000000000 65535 f \n`;
  for (let k = 1; k <= max; k++) tail += `${String(offset[k]).padStart(10, "0")} 00000 n \n`;
  tail += `trailer\n<< /Size ${max + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(tail);
  return new Blob(parts, { type: "application/pdf" });
}

const xml = (s: string) => s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
const u16 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255]);
const u32 = (n: number) => new Uint8Array([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]);

function zip(files: [string, string][]): Blob {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nb = enc.encode(name), db = enc.encode(data), crc = crc32(db);
    const lh = [u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(db.length), u32(db.length), u16(nb.length), u16(0), nb, db];
    locals.push(...lh);
    centrals.push(u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0x21), u32(crc), u32(db.length), u32(db.length), u16(nb.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nb);
    offset += lh.reduce((a, b) => a + b.length, 0);
  }
  const csize = centrals.reduce((a, b) => a + b.length, 0);
  const all = [...locals, ...centrals, u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length), u32(csize), u32(offset), u16(0)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let p = 0;
  for (const b of all) { out.set(b, p); p += b.length; }
  return new Blob([out], { type: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
}

interface Run { text: string; size: number; color: string; bold?: boolean; indent?: boolean }
function shape(id: number, name: string, x: number, y: number, w: number, h: number, runs: Run[]): string {
  const paras = runs.map((r) =>
    `<a:p>${r.indent ? '<a:pPr marL="228600"/>' : ""}<a:r><a:rPr lang="en-US" sz="${r.size}"${r.bold ? ' b="1"' : ""} dirty="0"><a:solidFill><a:srgbClr val="${r.color}"/></a:solidFill></a:rPr><a:t>${xml(r.text)}</a:t></a:r></a:p>`).join("");
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${xml(name)}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${x}" y="${y}"/><a:ext cx="${w}" cy="${h}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="square" rtlCol="0"><a:normAutofit/></a:bodyPr><a:lstStyle/>${paras}</p:txBody></p:sp>`;
}

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const ROOT = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
const rels = (items: [string, string][]) =>
  `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items.map(([t, target], i) => `<Relationship Id="rId${i + 1}" Type="${t}" Target="${target}"/>`).join("")}</Relationships>`;

const THEME = `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Nexy"><a:themeElements><a:clrScheme name="Nexy"><a:dk1><a:srgbClr val="07131A"/></a:dk1><a:lt1><a:srgbClr val="F0FBFF"/></a:lt1><a:dk2><a:srgbClr val="102630"/></a:dk2><a:lt2><a:srgbClr val="91AAB4"/></a:lt2><a:accent1><a:srgbClr val="4DE6C1"/></a:accent1><a:accent2><a:srgbClr val="35AFFF"/></a:accent2><a:accent3><a:srgbClr val="A78BFA"/></a:accent3><a:accent4><a:srgbClr val="FFD166"/></a:accent4><a:accent5><a:srgbClr val="FF6F91"/></a:accent5><a:accent6><a:srgbClr val="5DE2E7"/></a:accent6><a:hlink><a:srgbClr val="35AFFF"/></a:hlink><a:folHlink><a:srgbClr val="A78BFA"/></a:folHlink></a:clrScheme><a:fontScheme name="Nexy"><a:majorFont><a:latin typeface="Aptos Display"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Nexy"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

export function deckPptxBlob(title: string, slides: Slide[]): Blob {
  const n = slides.length;
  const CT = "application/vnd.openxmlformats-officedocument.";
  const F: [string, string][] = [];
  F.push(["[Content_Types].xml", `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/ppt/presentation.xml" ContentType="${CT}presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="${CT}presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="${CT}presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="${CT}theme+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="${CT}extended-properties+xml"/>` +
    slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="${CT}presentationml.slide+xml"/>`).join("") + "</Types>"]);
  F.push(["_rels/.rels", rels([[`${REL}/officeDocument`, "ppt/presentation.xml"], ["http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", "docProps/core.xml"], [`${REL}/extended-properties`, "docProps/app.xml"]])]);
  F.push(["ppt/presentation.xml", `${HEAD}<p:presentation ${NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 3}"/>`).join("")}</p:sldIdLst><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`]);
  F.push(["ppt/_rels/presentation.xml.rels", rels([[`${REL}/slideMaster`, "slideMasters/slideMaster1.xml"], [`${REL}/theme`, "theme/theme1.xml"], ...slides.map((_, i): [string, string] => [`${REL}/slide`, `slides/slide${i + 1}.xml`])])]);
  F.push(["ppt/slideMasters/slideMaster1.xml", `${HEAD}<p:sldMaster ${NS}><p:cSld><p:spTree>${ROOT}</p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`]);
  F.push(["ppt/slideMasters/_rels/slideMaster1.xml.rels", rels([[`${REL}/slideLayout`, "../slideLayouts/slideLayout1.xml"], [`${REL}/theme`, "../theme/theme1.xml"]])]);
  F.push(["ppt/slideLayouts/slideLayout1.xml", `${HEAD}<p:sldLayout ${NS} type="blank" preserve="1"><p:cSld name="Blank"><p:spTree>${ROOT}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`]);
  F.push(["ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels([[`${REL}/slideMaster`, "../slideMasters/slideMaster1.xml"]])]);
  F.push(["ppt/theme/theme1.xml", THEME]);
  slides.forEach((s, i) => {
    const body: Run[] = !s.bullets.length && s.note
      ? [{ text: s.note, size: 1600, color: "91AAB4" }]
      : s.bullets.flatMap((b): Run[] => [{ text: `•  ${b.text}`, size: 1600, color: "DCEEF2" }, ...(b.source ? [{ text: `from ${b.source}`, size: 1000, color: "617985", indent: true }] : [])]);
    const foot = s.note && s.bullets.length ? s.note : "";
    const sp = ROOT +
      shape(2, "Brand", 700000, 410000, 3000000, 300000, [{ text: "NEXY", size: 1000, color: "4DE6C1", bold: true }]) +
      shape(3, "Kicker", 700000, 900000, 10400000, 350000, [{ text: (i === 0 ? title : `${pad(i)} · ${title}`).toUpperCase(), size: 900, color: "4DE6C1", bold: true }]) +
      shape(4, "Title", 700000, 1300000, 10400000, 1300000, [{ text: s.title, size: i === 0 && !s.bullets.length ? 4400 : 3400, color: "EDF8FB", bold: true }]) +
      (body.length ? shape(5, "Body", 700000, 2700000, 10600000, 3300000, body) : "") +
      (foot ? shape(6, "Note", 700000, 6150000, 9000000, 300000, [{ text: foot, size: 800, color: "526A74" }]) : "") +
      shape(7, "Page", 10900000, 6150000, 800000, 300000, [{ text: `${pad(i + 1)} / ${pad(n)}`, size: 800, color: "617985" }]);
    const bg = '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="07131A"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
    F.push([`ppt/slides/slide${i + 1}.xml`, `${HEAD}<p:sld ${NS}><p:cSld>${bg}<p:spTree>${sp}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`]);
    F.push([`ppt/slides/_rels/slide${i + 1}.xml.rels`, rels([[`${REL}/slideLayout`, "../slideLayouts/slideLayout1.xml"]])]);
  });
  F.push(["docProps/core.xml", `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(title)}</dc:title><dc:creator>Nexy</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</dcterms:created></cp:coreProperties>`]);
  F.push(["docProps/app.xml", `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Nexy</Application><Slides>${n}</Slides><PresentationFormat>Widescreen</PresentationFormat></Properties>`]);
  return zip(F);
}

export function deckArtifact(o: { title: string; slides: Slide[]; meta?: string }): Artifact {
  const { title, slides } = o;
  const n = slides.length;
  return {
    id: `deck:${title}`,
    kind: "html",
    title,
    meta: o.meta,
    render(host) {
      injectCss();
      if (!n) {
        host.innerHTML = `<div class="empty"><b>Nothing to show.</b><br>This deck arrived with no slides.</div>`;
        return;
      }
      host.innerHTML =
        `<div class="deckapp" tabindex="-1"><div class="deckbar"><b>${esc(title)}</b><span class="deckcount"></span><span class="sp"></span>` +
        `<button class="deckdl" data-dl="pdf" type="button">Download PDF</button><button class="deckdl primary" data-dl="pptx" type="button">Download PPTX</button></div>` +
        `<div class="deckbody"><nav class="deckthumbs">${slides.map((s, i) =>
          `<button class="deckthumb${i ? "" : " on"}" type="button" data-slide="${i}"><i>${pad(i + 1)}</i><span>${esc(s.title)}</span></button>`).join("")}</nav>` +
        `<div class="deckstage" tabindex="0"></div></div></div>` +
        (o.meta ? `<div class="cvnote">${esc(o.meta)}</div>` : "");
      const app = host.querySelector<HTMLElement>(".deckapp")!;
      const stage = app.querySelector<HTMLElement>(".deckstage")!;
      const count = app.querySelector<HTMLElement>(".deckcount")!;
      const thumbs = [...app.querySelectorAll<HTMLButtonElement>(".deckthumb")];
      let at = 0;
      const fit = () => {
        const frame = stage.firstElementChild as HTMLElement | null;
        const art = frame?.firstElementChild as HTMLElement | null;
        if (!frame || !art) return;
        const cs = getComputedStyle(stage);
        const w = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        const h = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
        const k = Math.max(0.1, Math.min(w / 960, h > 60 ? h / 540 : w / 960));
        art.style.transform = `scale(${k})`;
        frame.style.width = `${960 * k}px`;
        frame.style.height = `${540 * k}px`;
        for (let z = 1; z > 0.55 && art.scrollHeight > art.clientHeight + 1; z -= 0.05) art.style.setProperty("--k", z.toFixed(2));
      };
      const ro = new ResizeObserver(() => { if (!app.isConnected) { ro.disconnect(); return; } fit(); });
      ro.observe(stage);
      const go = (i: number) => {
        at = Math.max(0, Math.min(n - 1, i));
        stage.innerHTML = `<div class="dframe">${slideHtml(slides[at], at, n, title)}</div>`;
        fit();
        count.textContent = `${at + 1} / ${n}`;
        thumbs.forEach((b, j) => b.classList.toggle("on", j === at));
        thumbs[at]?.scrollIntoView({ block: "nearest", inline: "nearest" });
      };
      go(0);
      thumbs.forEach((b, j) => b.addEventListener("click", () => go(j)));
      app.addEventListener("keydown", (e) => {
        const step = { ArrowRight: 1, ArrowDown: 1, PageDown: 1, ArrowLeft: -1, ArrowUp: -1, PageUp: -1 }[e.key];
        if (e.key === "Home") go(0);
        else if (e.key === "End") go(n - 1);
        else if (step) go(at + step);
        else return;
        e.preventDefault();
        if (thumbs.includes(document.activeElement as HTMLButtonElement)) thumbs[at].focus();
      });
      const name = slug(title);
      app.querySelector('[data-dl="pdf"]')!.addEventListener("click", () => {
        download(deckPdfBlob(title, slides), `${name}.pdf`);
        say(`Downloaded PDF, ${n} slide${n === 1 ? "" : "s"}`);
      });
      app.querySelector('[data-dl="pptx"]')!.addEventListener("click", () => {
        download(deckPptxBlob(title, slides), `${name}.pptx`);
        say(`Downloaded editable PowerPoint, ${n} slide${n === 1 ? "" : "s"}`);
      });
    },
  };
}
