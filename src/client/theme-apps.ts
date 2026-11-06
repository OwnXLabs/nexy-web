interface AppTheme { bg: string; bg2: string; panel: string; panel2: string; line: string; line2: string; text: string; muted: string; muted2: string; accent: string; warm: string; info: string; danger: string; pink: string; teal: string; yellow: string; radius: string; font: string }

const THEMES: Record<string, AppTheme> = {
  topgun: { bg: "#010403", bg2: "#040907", panel: "#07100C", panel2: "#0A1711", line: "#12301C", line2: "#2E6B40", text: "#F4FFF6", muted: "#8CA398", muted2: "#B9CFBF", accent: "#8CFF9A", warm: "#FFB84D", info: "#56C7FF", danger: "#FF5A64", pink: "#B7FFC0", teal: "#56C7FF", yellow: "#FFB84D", radius: "3px", font: '"Geist",-apple-system,Inter,system-ui,sans-serif' },
  standard: { bg: "#0d0d0f", bg2: "#111113", panel: "#141416", panel2: "#1a1a1d", line: "#232326", line2: "#2f2f33", text: "#ececef", muted: "#8a8a90", muted2: "#b5b5bb", accent: "#d6d6de", warm: "#f0a37a", info: "#8ab4f8", danger: "#ff6b6b", pink: "#f28cb8", teal: "#7fd9cf", yellow: "#f2d27a", radius: "10px", font: "-apple-system,Inter,system-ui,sans-serif" },
  cyberpunk: { bg: "#05050f", bg2: "#07071a", panel: "#0a0a1e", panel2: "#101030", line: "#13304a", line2: "#1f5a80", text: "#e8f8ff", muted: "#6fa8b8", muted2: "#a8dbe8", accent: "#00E5FF", warm: "#FF2FD6", info: "#00E5FF", danger: "#ff3b5c", pink: "#FF2FD6", teal: "#00E5FF", yellow: "#ffe66d", radius: "4px", font: "-apple-system,Inter,system-ui,sans-serif" },
  win95: { bg: "#c0c0c0", bg2: "#c0c0c0", panel: "#dfdfdf", panel2: "#e8e8e8", line: "#808080", line2: "#404040", text: "#000000", muted: "#333333", muted2: "#222222", accent: "#000080", warm: "#800000", info: "#000080", danger: "#800000", pink: "#800080", teal: "#008080", yellow: "#808000", radius: "0px", font: 'Tahoma,"MS Sans Serif",Verdana,sans-serif' },
  lcars: { bg: "#000000", bg2: "#000000", panel: "#111111", panel2: "#1a1a1a", line: "#333333", line2: "#FF9966", text: "#FFCC99", muted: "#CC99CC", muted2: "#FFCC99", accent: "#FF9966", warm: "#9999FF", info: "#9999FF", danger: "#CC6666", pink: "#CC99CC", teal: "#99CCFF", yellow: "#FFCC99", radius: "12px", font: '"Antonio","Helvetica Neue Condensed","Arial Narrow",Arial,sans-serif' },
};

const BASE: Record<string, string[]> = {
  bg: ["#0d0d12", "#07070b", "#0b0710", "#0a0a14", "#000", "#000000"], bg2: ["#111118", "#0f0f15", "#0d0d12"],
  panel: ["#15151d", "#1a1a24", "#161826", "#15151b"], panel2: ["#1c1c26", "#2a2a36", "#20202c", "#2a2a33", "#1a1a1d", "#241a2c"],
  line: ["#1e1e28", "#262633", "#1c1c22", "#22222a", "#2a2d3a"], line2: ["#3a3a45", "#33333d", "#3a2f44", "#2a2a36"],
  text: ["#e8e8f0", "#cfcfe0", "#fff", "#ffffff", "#e8e8ee", "#cfd3ff"],
  muted: ["#8a8aa0", "#9a9ab0", "#8b90a3", "#6b6b80", "#6f6f80", "#6f667c", "#9c93a8", "#8a8a96", "#b3b8c8", "#b3b3bd", "#9a9aa5", "#6d7386"],
  accent: ["#7C5CFF", "#7c5cff", "#3d5cff", "#5B32E6"], warm: ["#FF8C68", "#ff8c68", "#ff7a3d", "#F49AD3"],
  pink: ["#FF3D81", "#ff3d81", "#f58529", "#dd2a7b", "#8134af"], teal: ["#3BD1C4", "#3bd1c4", "#00c2ff", "#8AF7C9"], yellow: ["#FFD166", "#ffd166", "#ffd98a"],
};

const EXTRA: Record<string, string> = {
  topgun: '*{border-radius:3px!important}button,input,select,.st,.k,.card,.tile,.post,.c,.kc,.pill{border-radius:3px!important}h1,h2,h3,.title,.top b,.nav b{font-family:"Antonio","Arial Narrow",sans-serif;letter-spacing:.06em;text-transform:uppercase}.pos,.k .v,.kpis .v,td.num,th,.fld,.tag,.l,.hud,.src,.pill,.seg button,.bar b{font-family:"JetBrains Mono",Menlo,Consolas,monospace}button{letter-spacing:.03em}::-webkit-scrollbar{width:6px;height:6px}::-webkit-scrollbar-thumb{background:#194D2A}::-webkit-scrollbar-track{background:#010403}',
  win95: "*{border-radius:0!important}button,.btn,.play,.t{box-shadow:inset -1px -1px #404040,inset 1px 1px #fff!important;background:#c0c0c0!important;color:#000!important}",
  lcars: "button,.btn{border-radius:999px!important;font-weight:700}",
};

const rgb = (h: string) => {
  let x = h.replace("#", "");
  if (x.length === 3) x = x.split("").map((c) => c + c).join("");
  return `${parseInt(x.slice(0, 2), 16)},${parseInt(x.slice(2, 4), 16)},${parseInt(x.slice(4, 6), 16)}`;
};

export function themedHTML(html: string): string {
  const th = document.body.dataset.theme || "default";
  const T = THEMES[th];
  if (!T) return html;
  let out = html;
  for (const [k, hexes] of Object.entries(BASE)) {
    const to = (T as unknown as Record<string, string>)[k] ?? T.text;
    for (const hex of hexes) out = out.replace(new RegExp(`${hex.replace("#", "\\#")}(?![0-9a-fA-F])`, "g"), to);
  }
  out = out
    .replace(/rgba\(255,\s*255,\s*255,/g, `rgba(${rgb(T.text)},`)
    .replace(/rgba\(124,\s*92,\s*255,/g, `rgba(${rgb(T.accent)},`)
    .replace(/rgba\(255,\s*140,\s*104,/g, `rgba(${rgb(T.warm)},`)
    .replace(/rgba\(0,\s*0,\s*0,/g, th === "win95" ? "rgba(255,255,255," : "rgba(0,0,0,");
  const vars = `:root{--app-bg:${T.bg};--app-surface:${T.panel};--app-surface-hover:${T.panel2};--app-border:${T.line};--app-border-active:${T.line2};--app-text:${T.text};--app-muted:${T.muted};--app-primary:${T.accent};--app-info:${T.info};--app-warning:${T.warm};--app-danger:${T.danger};--app-radius:${T.radius}}`;
  const style = `<style id="nexy-theme">${vars}body{background:${T.bg}!important;color:${T.text}!important;font-family:${T.font}!important}${EXTRA[th] ?? ""}</style>`;
  return /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${style}</head>`) : style + out;
}
