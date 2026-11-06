export interface Progress {
  note(text: string): void;
  done(html: string): void;
  fail(html: string): void;
}

const mmss = (ms: number) => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
};

export function startProgress(host: HTMLElement, label: string, typical: number): Progress {
  const t0 = Date.now();
  let text = label;
  let timer = 0;

  const paint = () => {
    const el = Date.now() - t0;
    const tail = el > typical * 1.5
      ? `— longer than the usual ${mmss(typical)}, still going`
      : `— usually about ${mmss(typical)}`;
    host.innerHTML =
      `<span class="spin" aria-hidden="true"></span> ${text} ` +
      `<span class="faint">${mmss(el)} ${tail}</span>`;
  };

  paint();
  timer = window.setInterval(paint, 1000);
  const stop = () => window.clearInterval(timer);

  return {
    note(t) { text = t; paint(); },
    done(html) { stop(); host.innerHTML = html; },
    fail(html) { stop(); host.innerHTML = html; },
  };
}
