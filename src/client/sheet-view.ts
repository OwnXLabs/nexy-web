import type { Artifact } from "./canvas";

type Raw = string | number | null;
type Val = number | string | { err: string };

class FormulaError extends Error {
  constructor(readonly code: string) { super(code); }
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const isErr = (v: Val): v is { err: string } => typeof v === "object";
const isFormula = (v: Raw): v is string => typeof v === "string" && v.startsWith("=");
const isTotal = (row: Raw[]) => typeof row[0] === "string" && /^total/i.test(row[0]);

const colName = (i: number): string => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

const refOf = (s: string): { r: number; c: number } => {
  const m = /^([A-Z]+)(\d+)$/.exec(s);
  if (!m) throw new FormulaError("#REF");
  const c = [...m[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1;
  return { r: Number(m[2]) - 1, c };
};

const parseInput = (s: string): Raw => {
  const t = s.trim();
  if (!t) return "";
  if (t.startsWith("=")) return t;
  return /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i.test(t) ? Number(t) : s;
};

const tidy = (n: number) => Math.round(n * 1e10) / 1e10;

const show = (v: Val): string => {
  if (isErr(v)) return v.err;
  if (typeof v === "number") return v.toLocaleString(undefined, { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  return v;
};

function csvParse(text: string): Raw[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
      continue;
    }
    if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => r.map(parseInput));
}

const csvCell = (v: Val): string => {
  if (isErr(v)) return v.err;
  if (typeof v === "number") return String(tidy(v));
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const CSS = `
.xs{display:flex;flex-direction:column;height:calc(100% - 26px);min-height:440px;border-radius:12px;overflow:hidden;border:1px solid var(--line,#1e1e28);background:#0d0d12;color:#e8e8f0;font:12.5px/1.4 var(--font,-apple-system,Inter,system-ui,sans-serif)}
.xs .xs-bar{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid #1e1e28;background:#111118;flex-wrap:wrap}
.xs .xs-bar b{margin-right:8px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
.xs .xs-bar .xs-lock{display:inline-flex;align-items:center;gap:5px;color:#9a9ab0;font-size:11px;margin-right:auto}
.xs .xs-t{height:28px;padding:0 10px;border-radius:7px;background:#1a1a24;color:#e8e8f0;border:0;cursor:pointer;font:inherit;white-space:nowrap}
.xs .xs-t:hover{background:#2a2a36}.xs .xs-t.xs-on{background:#7C5CFF;color:#fff}
.xs .xs-fx{display:flex;align-items:center;gap:8px;padding:6px 10px;border-bottom:1px solid #1e1e28;background:#0f0f15}
.xs .xs-fx .xs-ref{font-family:ui-monospace,Menlo,monospace;color:#9a9ab0;width:54px}
.xs .xs-fx input{flex:1;min-width:0;background:#15151d;border:1px solid #262633;color:#fff;border-radius:6px;padding:5px 8px;outline:0;font-family:ui-monospace,Menlo,monospace;font-size:12px}
.xs .xs-wrap{flex:1;overflow:auto;outline:0}
.xs table{border-collapse:collapse}
.xs th,.xs td{border:1px solid #1e1e28;padding:0;height:26px}
.xs th{background:#15151d;color:#9a9ab0;font-weight:500;font-size:11px;text-align:center;min-width:44px;position:sticky;top:0;z-index:2;cursor:pointer;user-select:none}
.xs th.xs-rh{position:sticky;left:0;z-index:3;min-width:34px;cursor:default}
.xs thead th.xs-rh{z-index:4}.xs tbody th.xs-rh{top:auto;z-index:1}
.xs th[data-c]:hover{color:#fff}.xs th .xs-s{color:#7C5CFF;margin-left:3px}
.xs td{min-width:110px;background:#0d0d12;cursor:cell}
.xs td .xs-c{display:block;padding:4px 8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.xs td.xs-num .xs-c{text-align:right;font-variant-numeric:tabular-nums}
.xs td.xs-hdr{background:#15151d}.xs td.xs-hdr .xs-c{font-weight:600;color:#fff}
.xs td.xs-sel{outline:2px solid #7C5CFF;outline-offset:-2px}
.xs td.xs-f .xs-c{color:#3BD1C4}.xs td.xs-err .xs-c{color:#FF8C68}
.xs td.xs-tot{background:#141420}.xs td.xs-tot .xs-c{font-weight:600;color:#fff}
.xs td input{width:100%;height:26px;background:#1a1a24;border:0;color:#fff;padding:0 8px;outline:2px solid #7C5CFF;font:inherit;box-sizing:border-box}
.xs tfoot td,.xs tfoot th{position:sticky;top:auto;bottom:0;z-index:2;background:#141420;cursor:default}
.xs tfoot th.xs-rh{z-index:4;color:#7C5CFF;font-size:13px}
.xs tfoot td .xs-c{font-weight:600;color:#fff}
.xs .xs-status{display:flex;gap:16px;padding:6px 10px;border-top:1px solid #1e1e28;background:#111118;font-size:11.5px;color:#9a9ab0;align-items:flex-end}
.xs .xs-status b{color:#fff;font-weight:600}
.xs .xs-status>span{white-space:nowrap}.xs .xs-status .xs-hint{margin-left:auto;min-width:0;white-space:normal;text-align:right}
`;

function injectCss(): void {
  if (document.getElementById("nexy-sheet-css")) return;
  const s = document.createElement("style");
  s.id = "nexy-sheet-css";
  s.textContent = CSS;
  document.head.appendChild(s);
}

const ADDS_UP = /\b(amounts?|totals?|sums?|costs?|spend|spent|revenue|sales|income|expenses?|qty|quantity|units|count|hours|budget|fees?|paid|balance|subtotal)\b/i;

export function sheetArtifact(m: { title: string; rows: (string | number | null)[][]; meta?: string }): Artifact {
  let grid: Raw[][] = m.rows.length ? m.rows.map((r) => r.map((v) => (v === undefined ? null : v))) : [["", "", ""], ["", "", ""]];
  let sel = { r: 1, c: 0 };
  // a total row only where adding up means something: a stock's open, close, high and low were
  // summed to 922.75 (2026-10-28). The button still turns it on.
  let sortCol = -1, sortDir = 1, totals = grid[0]?.some((h, c) =>
    typeof h === "string" && ADDS_UP.test(h) && grid.slice(1).some((r) => typeof r[c] === "number")) ?? false;

  const cols = () => Math.max(1, ...grid.map((r) => r.length));

  const evaluate = (): ((r: number, c: number) => Val) => {
    const memo = new Map<string, Val>();
    const stack = new Set<string>();

    const cell = (r: number, c: number): Val => {
      const raw = grid[r]?.[c] ?? "";
      if (typeof raw === "string" && raw.startsWith("'")) return raw.slice(1);
      if (!isFormula(raw)) return raw;
      const key = `${r},${c}`;
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      if (stack.has(key)) return { err: "#CYCLE" };
      stack.add(key);
      let out: Val;
      try {
        out = formula(raw.slice(1).toUpperCase());
      } catch (e) {
        if (!(e instanceof FormulaError)) throw e;
        out = { err: e.code };
      }
      stack.delete(key);
      memo.set(key, out);
      return out;
    };

    const at = (ref: string) => {
      const p = refOf(ref);
      if (p.r < 0 || p.r >= grid.length || p.c < 0 || p.c >= cols()) throw new FormulaError("#REF");
      return p;
    };

    const numAt = (ref: string): number => {
      const { r, c } = at(ref);
      const v = cell(r, c);
      if (isErr(v)) throw new FormulaError(v.err);
      if (typeof v === "number") return v;
      if (v === "") return 0;
      throw new FormulaError("#VALUE");
    };

    const range = (a: string, b: string): number[] => {
      const A = at(a), B = at(b), out: number[] = [];
      for (let r = Math.min(A.r, B.r); r <= Math.max(A.r, B.r); r++)
        for (let c = Math.min(A.c, B.c); c <= Math.max(A.c, B.c); c++) {
          const v = cell(r, c);
          if (isErr(v)) throw new FormulaError(v.err);
          if (typeof v === "number") out.push(v);
        }
      return out;
    };

    const FN: Record<string, (v: number[]) => number> = {
      SUM: (v) => v.reduce((a, b) => a + b, 0),
      AVERAGE: (v) => (v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0),
      MIN: (v) => (v.length ? Math.min(...v) : 0),
      MAX: (v) => (v.length ? Math.max(...v) : 0),
      COUNT: (v) => v.length,
    };

    const formula = (src: string): Val => {
      const toks = src.match(/\d+\.?\d*|\.\d+|[A-Z]+\d*|[-+*/(),:]|\S/g) ?? [];
      if (toks.length === 1 && /^[A-Z]+\d+$/.test(toks[0])) {
        const { r, c } = at(toks[0]);
        const v = cell(r, c);
        if (isErr(v)) throw new FormulaError(v.err);
        return v === "" ? 0 : v;
      }
      let i = 0;
      const peek = () => toks[i];
      const take = (t?: string) => {
        const k = toks[i++];
        if (t !== undefined && k !== t) throw new FormulaError("#ERR");
        return k;
      };

      const primary = (): number => {
        const t = take();
        if (t === undefined) throw new FormulaError("#ERR");
        if (t === "(") { const v = expr(); take(")"); return v; }
        if (/^[\d.]/.test(t)) return Number(t);
        if (/^[A-Z]+$/.test(t)) {
          const fn = FN[t];
          if (!fn) throw new FormulaError("#NAME");
          take("(");
          const vals: number[] = [];
          while (peek() !== ")") {
            if (/^[A-Z]+\d+$/.test(peek() ?? "") && toks[i + 1] === ":") {
              const a = take(); take(":");
              vals.push(...range(a, take()));
            } else vals.push(expr());
            if (peek() === ",") take();
            else if (peek() !== ")") throw new FormulaError("#ERR");
          }
          take(")");
          return fn(vals);
        }
        if (/^[A-Z]+\d+$/.test(t)) return numAt(t);
        throw new FormulaError("#ERR");
      };
      const unary = (): number => {
        if (peek() === "-") { take(); return -unary(); }
        if (peek() === "+") { take(); return unary(); }
        return primary();
      };
      const term = (): number => {
        let v = unary();
        while (peek() === "*" || peek() === "/") {
          const op = take(), r = unary();
          if (op === "/" && r === 0) throw new FormulaError("#DIV/0");
          v = op === "*" ? v * r : v / r;
        }
        return v;
      };
      const expr = (): number => {
        let v = term();
        while (peek() === "+" || peek() === "-") v = take() === "+" ? v + term() : v - term();
        return v;
      };

      const v = expr();
      if (i !== toks.length || !isFinite(v)) throw new FormulaError("#ERR");
      return v;
    };

    return cell;
  };

  const toCsv = (): string => {
    const val = evaluate(), n = cols();
    return grid.map((row, r) => Array.from({ length: n }, (_, c) => csvCell(val(r, c))).join(",")).join("\n");
  };

  const columnNums = (val: (r: number, c: number) => Val, c: number): number[] => {
    const out: number[] = [];
    grid.forEach((row, r) => {
      if (r === 0 || isTotal(row)) return;
      const v = val(r, c);
      if (typeof v === "number") out.push(v);
    });
    return out;
  };

  const sortBy = (c: number, dir: number) => {
    const val = evaluate();
    const keyed = grid.slice(1).map((row, k) => ({ row, v: val(k + 1, c) }));
    const body = keyed.filter((x) => !isTotal(x.row));
    const tot = keyed.filter((x) => isTotal(x.row));
    const blank = (v: Val) => v === "" || v === null;
    body.sort((a, b) => {
      if (blank(a.v) !== blank(b.v)) return blank(a.v) ? 1 : -1;
      if (typeof a.v === "number" && typeof b.v === "number") return (a.v - b.v) * dir;
      if (typeof a.v === "number") return -dir;
      if (typeof b.v === "number") return dir;
      return show(a.v).localeCompare(show(b.v), undefined, { numeric: true }) * dir;
    });
    grid = [grid[0], ...body.map((x) => x.row), ...tot.map((x) => x.row)];
    sortCol = c;
    sortDir = dir;
  };

  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toCsv()], { type: "text/csv" }));
    a.download = /\.csv$/i.test(m.title) ? m.title : `${m.title.replace(/\.[a-z0-9]+$/i, "") || "sheet"}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  return {
    id: `table:${m.title}`,
    kind: "table",
    title: m.title,
    meta: m.meta ?? `${Math.max(0, m.rows.length - 1)} rows · on device`,
    source: {
      get: toCsv,
      set(csv: string) {
        const rows = csvParse(csv);
        if (!rows.length) return;
        grid = rows;
        sortCol = -1;
        sel = { r: Math.min(sel.r, rows.length - 1), c: 0 };
      },
    },
    render(host) {
      injectCss();
      host.innerHTML =
        `<div class="xs"><div class="xs-bar"><b>${esc(m.title)}</b>` +
        `<span class="xs-lock">&#128274; On device, edits kept in this tab</span>` +
        `<button class="xs-t" data-a="row">+ Row</button><button class="xs-t" data-a="col">+ Column</button>` +
        `<button class="xs-t" data-a="asc" title="Sort the selected column ascending">Sort A→Z</button>` +
        `<button class="xs-t" data-a="desc" title="Sort the selected column descending">Sort Z→A</button>` +
        `<button class="xs-t" data-a="sum" title="Show a total row for numeric columns">Σ Totals</button>` +
        `<button class="xs-t" data-a="csv">Export CSV</button></div>` +
        `<div class="xs-fx"><span class="xs-ref"></span><input placeholder="Type a value or a formula, e.g. =SUM(B2:B6) or =B2*0.3" spellcheck="false"></div>` +
        `<div class="xs-wrap" tabindex="0"><table></table></div>` +
        `<div class="xs-status"><span>Selected <b data-s="sel"></b></span><span>Sum <b data-s="sum"></b></span>` +
        `<span>Average <b data-s="avg"></b></span><span>Count <b data-s="cnt"></b></span>` +
        `<span class="xs-hint">Formulas: SUM, AVERAGE, MIN, MAX, COUNT, + − × ÷, cell references</span></div></div>` +
        `<div class="cvnote">Click a cell to edit; start with = for a formula. Click a column letter to sort. ` +
        `Download and copy use the edited values.</div>`;

      const root = host.querySelector<HTMLElement>(".xs")!;
      const table = root.querySelector("table")!;
      const wrap = root.querySelector<HTMLElement>(".xs-wrap")!;
      const fx = root.querySelector<HTMLInputElement>(".xs-fx input")!;
      const stat = (k: string, v: string) => { root.querySelector(`[data-s="${k}"]`)!.textContent = v; };

      const commit = (r: number, c: number, text: string) => {
        while (grid.length <= r) grid.push([]);
        const row = grid[r];
        while (row.length < c) row.push("");
        row[c] = parseInput(text);
        if (c === sortCol) sortCol = -1;
      };

      const draw = () => {
        const val = evaluate(), n = cols();
        sel = { r: Math.max(0, Math.min(sel.r, grid.length - 1)), c: Math.max(0, Math.min(sel.c, n - 1)) };
        let h = `<thead><tr><th class="xs-rh"></th>`;
        for (let c = 0; c < n; c++) {
          const arrow = c === sortCol ? `<span class="xs-s">${sortDir > 0 ? "▲" : "▼"}</span>` : "";
          h += `<th data-c="${c}" title="Sort by column ${colName(c)}">${colName(c)}${arrow}</th>`;
        }
        h += `</tr></thead><tbody>`;
        grid.forEach((row, r) => {
          const tot = isTotal(row);
          h += `<tr><th class="xs-rh">${r + 1}</th>`;
          for (let c = 0; c < n; c++) {
            const raw = row[c] ?? "", v = val(r, c);
            const cls = [
              r === 0 && "xs-hdr", typeof v === "number" && "xs-num", isFormula(raw) && "xs-f",
              isErr(v) && "xs-err", tot && "xs-tot", sel.r === r && sel.c === c && "xs-sel",
            ].filter(Boolean).join(" ");
            h += `<td class="${cls}" data-r="${r}" data-c="${c}"><span class="xs-c">${esc(show(v))}</span></td>`;
          }
          h += `</tr>`;
        });
        h += `</tbody>`;
        if (totals) {
          h += `<tfoot><tr><th class="xs-rh" title="Totals of numeric cells">Σ</th>`;
          for (let c = 0; c < n; c++) {
            const nums = columnNums(val, c);
            const s = nums.length ? show(nums.reduce((a, b) => a + b, 0)) : "";
            h += `<td class="${nums.length ? "xs-num" : ""}" data-t="${c}"><span class="xs-c">${esc(s)}</span></td>`;
          }
          h += `</tr></tfoot>`;
        }
        table.innerHTML = h;

        const raw = grid[sel.r]?.[sel.c];
        root.querySelector(".xs-fx .xs-ref")!.textContent = colName(sel.c) + (sel.r + 1);
        fx.value = raw == null ? "" : String(raw);
        const nums = columnNums(val, sel.c);
        const sum = nums.reduce((a, b) => a + b, 0);
        stat("sel", colName(sel.c) + (sel.r + 1));
        stat("sum", nums.length ? show(sum) : "—");
        stat("avg", nums.length ? show(sum / nums.length) : "—");
        stat("cnt", nums.length ? String(nums.length) : "—");
        root.querySelector('[data-a="sum"]')!.classList.toggle("xs-on", totals);
      };

      const edit = (r: number, c: number) => {
        sel = { r, c };
        draw();
        const td = table.querySelector<HTMLElement>(`td[data-r="${r}"][data-c="${c}"]`);
        if (!td) return;
        const inp = document.createElement("input");
        const raw = grid[r]?.[c];
        inp.value = raw == null ? "" : String(raw);
        td.replaceChildren(inp);
        inp.focus();
        inp.select();
        let done = false;
        const finish = (save: boolean, move?: { dr: number; dc: number }) => {
          if (done) return;
          done = true;
          if (save) commit(r, c, inp.value);
          if (move) sel = { r: r + move.dr, c: c + move.dc };
          draw();
          wrap.focus({ preventScroll: true });
        };
        inp.addEventListener("blur", () => finish(true));
        inp.addEventListener("keydown", (e) => {
          if (e.key === "Enter") { e.preventDefault(); finish(true, { dr: 1, dc: 0 }); }
          else if (e.key === "Tab") { e.preventDefault(); finish(true, { dr: 0, dc: e.shiftKey ? -1 : 1 }); }
          else if (e.key === "Escape") { e.preventDefault(); finish(false); }
        });
      };

      table.addEventListener("click", (e) => {
        const t = e.target as HTMLElement;
        if (t.closest("input")) return;
        const th = t.closest<HTMLElement>("th[data-c]");
        if (th) {
          const c = Number(th.dataset.c);
          sel = { r: sel.r, c };
          sortBy(c, c === sortCol ? -sortDir : 1);
          draw();
          return;
        }
        const td = t.closest<HTMLElement>("td[data-r]");
        if (!td) return;
        edit(Number(td.dataset.r), Number(td.dataset.c));
      });

      fx.addEventListener("keydown", (e) => {
        if (e.key !== "Enter") return;
        commit(sel.r, sel.c, fx.value);
        draw();
      });

      wrap.addEventListener("keydown", (e) => {
        if (e.target !== wrap) return;
        const mv: Record<string, [number, number]> = { ArrowDown: [1, 0], ArrowUp: [-1, 0], ArrowRight: [0, 1], ArrowLeft: [0, -1] };
        const d = mv[e.key];
        if (d) { e.preventDefault(); sel = { r: sel.r + d[0], c: sel.c + d[1] }; draw(); return; }
        if (e.key === "Enter") { e.preventDefault(); edit(sel.r, sel.c); return; }
        if (e.key === "Delete" || e.key === "Backspace") { commit(sel.r, sel.c, ""); draw(); }
      });

      root.querySelector(".xs-bar")!.addEventListener("click", (e) => {
        const a = (e.target as HTMLElement).closest<HTMLElement>("[data-a]")?.dataset.a;
        if (!a) return;
        if (a === "row") { grid.push(Array.from({ length: cols() }, () => "")); sel = { r: grid.length - 1, c: 0 }; }
        else if (a === "col") { const n = cols(); while (grid[0].length < n) grid[0].push(""); grid[0].push(`Column ${colName(n)}`); sel = { r: 0, c: n }; }
        else if (a === "asc" || a === "desc") sortBy(sel.c, a === "asc" ? 1 : -1);
        else if (a === "sum") totals = !totals;
        else if (a === "csv") { download(); return; }
        draw();
      });

      draw();
    },
  };
}
