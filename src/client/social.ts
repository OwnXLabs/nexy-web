import type { Artifact } from "./canvas";
import { SPECS, NOT_CONNECTED, parseNetwork } from "../lib/social/networks.ts";
import type { Draft, Network, Slot, SocialState } from "../lib/social/types.ts";
import { httpMsg, errText } from "./http";

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

export interface SocialUI {
  push: (who: "me" | "ai", html: string) => HTMLElement;
  showArtifact: (a: Artifact) => void;
  project?: string;
  block?: (title: string, right: string, rows: { k: string; v: string; off?: boolean }[]) => void;
}

export interface Envelope {
  state: SocialState;
  connectors: { net: Network; label: string; connected: false; why: string }[];
  publishes: boolean;
  notice: string;
  runner: string;
  store: { path: string; error: string | null };
  error?: string;
}

let env: Envelope | null = null;

const EVAL = typeof location !== "undefined" && new URLSearchParams(location.search).get("eval") === "1";

async function call(path: string, body?: unknown): Promise<Envelope> {
  const r = await fetch(`/api/v1/social/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", accept: "application/json", ...(EVAL ? { "x-nexy-eval": "1" } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const j = (await r.json().catch(() => null)) as Envelope | null;
  if (!r.ok || !j) throw new Error(j?.error ?? httpMsg(r.status));
  env = j;
  return j;
}

const refresh = () => call("state");

if (typeof window !== "undefined") void refresh().catch(() => undefined);

export const socialInUse = (): boolean =>
  !!env && (env.state.drafts.length > 0 || env.state.schedule.length > 0);

export const _test = {
  setEnv(e: Envelope | null) { env = e; },
  getEnv() { return env; },
  reset() { env = null; awaitingBrief = false; },
};

type View = "overview" | "connections" | "strategy" | "drafts" | "calendar" | "rules" | "activity";

const VIEWS: [View, string][] = [
  ["overview", "Overview"], ["connections", "Accounts"], ["strategy", "Strategy"], ["drafts", "Content"],
  ["calendar", "Calendar"], ["rules", "Rules"], ["activity", "Activity"],
];

const fmtTime = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString([], { weekday: "short", day: "numeric" });

export const banner = (e: Envelope) =>
  `<div class="scard" style="margin-bottom:12px">` +
  `<div class="srow2" style="border:0;padding:0">` +
  `<span class="led off"></span><b>Nothing publishes</b>` +
  `<span class="faint">no network is connected</span></div>` +
  `<div class="faint" style="font-size:11.5px;line-height:1.5;margin-top:6px">` +
  `${esc(e.notice.replace(/^Nothing publishes\. /, ""))} ` +
  `There is also no scheduler running on this machine: these times are when a post <i>would</i> go out.` +
  `</div></div>`;

function strategy(e: Envelope): string {
  const s = e.state;
  return `<h3>Strategy</h3><div class="sgrid"><div class="scard"><h4>Pillars</h4>` +
    (s.pillars.map((p, i) => `<div class="srow2"><span class="led"></span>${esc(p)}<button class="btn small ghost" type="button" data-unpillar="${i}" style="margin-left:auto">×</button></div>`).join("") || `<div class="faint">None yet. Drafts follow the brief alone.</div>`) +
    (s.pillars.length < 6 ? `<input class="rename" data-pillar placeholder="Add a pillar and press Enter" style="margin-top:8px;width:100%">` : "") +
    `</div><div class="scard"><h4>Cadence per week</h4>` +
    (["instagram", "linkedin", "x"] as Network[]).map((n) => `<div class="srow2"><b>${esc(SPECS[n].label)}</b><span class="cad"><button type="button" data-cad="${n}" data-d="-1">−</button><span>${s.cadence[n]}</span><button type="button" data-cad="${n}" data-d="1">+</button></span></div>`).join("") +
    `<div class="faint" style="margin-top:8px;font-size:11.5px">Scheduling spaces each network's posts by this.</div></div></div>`;
}

function rules(e: Envelope): string {
  const s = e.state;
  const row = (l: string, c: string) => `<div class="crow2"><b>${l}</b><span class="sp"></span>${c}</div>`;
  return `<h3>Rules</h3>` +
    row("Post automatically", `<button type="button" class="sw${s.paused ? "" : " on"}" data-act="pause" role="switch" aria-checked="${!s.paused}"><i></i></button>`) +
    row("Posting window", `<input class="rename" data-win="from" value="${esc(s.window.from)}" style="width:64px"> to <input class="rename" data-win="to" value="${esc(s.window.to)}" style="width:64px">`) +
    row("Leaves the device", `<span class="faint">nothing yet: no network is connected</span>`) +
    row("Replies and DMs", `<span class="faint">never read, never answered</span>`);
}

export function overview(e: Envelope): string {
  const s = e.state;
  const next = [...s.schedule].sort((a, b) => a.at - b.at)[0];
  const live = s.drafts.filter((d) => !d.off);
  return (
    `<h3>Overview</h3>` +
    `<div class="sgrid">` +
    `<div class="scard"><h4>Queue</h4>` +
    ([...s.schedule].sort((a, b) => a.at - b.at).slice(0, 6)
      .map(
        (x) =>
          `<div class="srow2"><span class="led${x.state === "held" ? " off" : ""}"></span>` +
          `<b>${esc(SPECS[x.net].label)}</b>` +
          `<span class="faint">${esc(fmtDay(x.at))} ${esc(fmtTime(x.at))}${x.state === "held" ? ", held" : ""}</span></div>`,
      )
      .join("") || `<div class="faint" style="font-size:12px">Nothing queued.</div>`) +
    `</div>` +
    `<div class="scard"><h4>State</h4>` +
    `<div class="big">${s.schedule.length ? `${s.schedule.length} scheduled` : "Nothing scheduled"}</div>` +
    `<div class="faint" style="font-size:11.5px">${next ? `First slot ${esc(fmtDay(next.at))} ${esc(fmtTime(next.at))}. ` : ""}It will not publish.</div>` +
    `<div class="srow2" style="margin-top:10px"><b>Drafts</b><span class="faint">${live.length} live${s.drafts.length - live.length ? `, ${s.drafts.length - live.length} dropped` : ""}</span></div>` +
    `<div class="srow2"><b>Autopilot</b><span class="faint">${s.paused ? "paused" : "not paused"}</span></div>` +
    `<div class="srow2"><b>Left the device</b><span class="faint">nothing, and nothing can</span></div>` +
    `<button class="btn" type="button" style="margin-top:10px" data-act="pause">` +
    `${s.paused ? "Resume autopilot" : "Pause autopilot"}</button>` +
    `<div class="faint" style="font-size:11px;margin-top:6px">${s.paused
      ? "Paused is recorded on disk and survives a restart. Nothing was running to stop."
      : "Pausing records your answer on disk. There is no runner to stop today."}</div>` +
    `</div></div>`
  );
}

function draftCard(d: Draft, i: number): string {
  const spec = SPECS[d.net];
  const over = d.text.length > spec.limit;
  return (
    `<div class="post ${esc(d.net)}">` +
    `<div class="ph"><span class="av">${esc(spec.label[0])}</span><b>Draft</b>` +
    `<span class="faint">${esc(spec.label)}</span></div>` +
    `<div class="pt">${esc(d.text)}</div>` +
    `<div class="pf"><span class="faint">${d.text.length} / ${spec.limit}${over ? " OVER" : ""}` +
    `${d.trimmedFrom ? ` · trimmed from ${d.trimmedFrom}` : ""}` +
    `${d.by === "model:rewrite" ? " · rewritten" : ""}</span>` +
    `<button class="btn small" type="button" data-edit="${i}">Edit</button></div></div>`
  );
}

export function drafts(e: Envelope): string {
  const s = e.state;
  if (!s.drafts.length) {
    return `<h3>Drafts</h3><div class="empty">No drafts yet. Ask in chat for posts about something and the model on this machine writes one per network.</div>`;
  }
  return (
    `<h3>Drafts, per network</h3>` +
    `<p class="sp">Written by the model on this machine, each inside its network's character limit. ` +
    `Edit one by saying “Rewrite the LinkedIn draft to …”. They are files here; posting them is manual.</p>` +
    `<div class="posts">${s.drafts.map(draftCard).join("")}</div>`
  );
}

export function calendar(e: Envelope): string {
  const s = e.state;
  const base = new Date();
  const cells: string[] = [];
  for (let i = 0; i < 14; i++) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i);
    const end = day.getTime() + 86_400_000;
    const items = s.schedule
      .filter((x: Slot) => x.at >= day.getTime() && x.at < end)
      .sort((a, b) => a.at - b.at);
    cells.push(
      `<div class="cd"><div class="cdh">${esc(day.toLocaleDateString([], { weekday: "short", day: "numeric" }))}</div>` +
      items
        .map(
          (x) =>
            `<div class="ci ${esc(x.net)}" title="Scheduled${x.state === "held" ? ", held" : ""} — will not publish, no network is connected">` +
            `<b>${esc(SPECS[x.net].label[0])}</b>${esc(fmtTime(x.at))}${x.state === "held" ? " held" : ""}</div>`,
        )
        .join("") +
      `</div>`,
    );
  }
  return (
    `<h3>Calendar</h3>` +
    `<p class="sp">The next two weeks. ${s.schedule.length
      ? `${s.schedule.length} slot${s.schedule.length === 1 ? "" : "s"}, none of which will fire — there is no scheduler on this machine and no network to send to.`
      : "Nothing scheduled yet. Say “schedule them” once the drafts look right."}</p>` +
    `<div class="cal">${cells.join("")}</div>`
  );
}

export function connections(e: Envelope): string {
  return (
    `<h3>Connections</h3>` +
    `<p class="sp">None. This is not a setting you can switch on here: the code to talk to these ` +
    `networks does not exist in this app yet.</p>` +
    e.connectors
      .map(
        (c) =>
          `<div class="scard" style="margin-bottom:8px">` +
          `<div class="srow2" style="border:0;padding:0"><span class="led off"></span><b>${esc(c.label)}</b>` +
          `<span class="faint">not connected</span></div>` +
          `<div class="faint" style="font-size:11.5px;line-height:1.5;margin-top:5px">${esc(c.why)}</div></div>`,
      )
      .join("")
  );
}

export function activity(e: Envelope): string {
  const rows = [...e.state.log].reverse().slice(0, 40);
  return (
    `<h3>Activity</h3>` +
    `<p class="sp">Everything this app has done. It is a short list because it does few things: ` +
    `write text, and remember when you said you wanted it out.</p>` +
    (rows
      .map(
        (l) =>
          `<div class="srow2"><span class="led ok"></span><span>${esc(l.msg)}</span>` +
          `<span class="faint">${esc(new Date(l.ts).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }))}</span></div>`,
      )
      .join("") || `<div class="empty">Nothing yet.</div>`) +
    `<div class="faint" style="font-size:11px;margin-top:10px">Stored at <code>${esc(e.store.path)}</code>` +
    `${e.store.error ? ` — <b>write failed:</b> ${esc(e.store.error)}` : ""}</div>`
  );
}

export function socialArtifact(initial: View = "overview"): Artifact {
  let view: View = initial;

  return {
    id: "social:autopilot",
    kind: "text",
    title: "social-autopilot.app",
    meta: "on device · nothing publishes",
    render(host) {
      const draw = () => {
        const e = env;
        if (!e) {
          host.innerHTML = `<div class="pad"><div class="empty">Reading the autopilot from disk…</div></div>`;
          return;
        }
        const nav = VIEWS.map(
          ([k, label]) =>
            `<button type="button" class="subtab${k === view ? " active" : ""}" data-v="${k}">${label}</button>`,
        ).join("");
        const body =
          view === "overview" ? overview(e)
          : view === "drafts" ? drafts(e)
          : view === "calendar" ? calendar(e)
          : view === "connections" ? connections(e)
          : view === "strategy" ? strategy(e)
          : view === "rules" ? rules(e)
          : activity(e);
        host.innerHTML =
          `<div class="nav">${nav}</div>` +
          `<div class="pad"><div class="soc">${banner(e)}<div class="sbody">${body}</div></div></div>`;

        host.querySelectorAll<HTMLElement>(".subtab").forEach((b) =>
          b.addEventListener("click", () => { view = b.dataset.v as View; draw(); }),
        );

        host.querySelectorAll<HTMLElement>("[data-edit]").forEach((b) =>
          b.addEventListener("click", () => {
            const d = e.state.drafts[Number(b.dataset.edit)];
            if (!d) return;
            const inp = document.querySelector<HTMLTextAreaElement>("#input");
            if (!inp) return;
            inp.value = `Rewrite the ${SPECS[d.net].label} draft to `;
            inp.focus();
            inp.style.height = "auto";
            inp.style.height = `${inp.scrollHeight}px`;
          }),
        );

        const save = async (body: unknown) => {
          try { await call("strategy", body); }
          catch (err) { window.dispatchEvent(new CustomEvent("nexy:toast", { detail: `Not saved: ${errText(err)}` })); }
          await refresh().catch((err) => console.warn("[nexy] social refresh failed", err));
          draw();
        };
        host.querySelectorAll<HTMLElement>("[data-cad]").forEach((b) => b.addEventListener("click", () => {
          const n = b.dataset.cad as Network;
          void save({ cadence: { [n]: Math.max(0, Math.min(7, e.state.cadence[n] + Number(b.dataset.d))) } });
        }));
        host.querySelectorAll<HTMLElement>("[data-unpillar]").forEach((b) => b.addEventListener("click", () =>
          void save({ pillars: e.state.pillars.filter((_, i) => i !== Number(b.dataset.unpillar)) })));
        host.querySelector<HTMLInputElement>("[data-pillar]")?.addEventListener("keydown", (ev) => {
          const t = ev.target as HTMLInputElement;
          if (ev.key === "Enter" && t.value.trim()) void save({ pillars: [...e.state.pillars, t.value.trim()] });
        });
        host.querySelectorAll<HTMLInputElement>("[data-win]").forEach((i) => i.addEventListener("change", () => {
          const from = host.querySelector<HTMLInputElement>('[data-win="from"]')?.value ?? "", to = host.querySelector<HTMLInputElement>('[data-win="to"]')?.value ?? "";
          void save({ window: { from, to } });
        }));

        const pause = host.querySelector<HTMLElement>('[data-act="pause"]');
        if (pause) {
          pause.addEventListener("click", async () => {
            const want = !e.state.paused;
            (pause as HTMLButtonElement).disabled = true;
            try {
              await call("pause", { paused: want });
            } catch (err) {
              window.dispatchEvent(
                new CustomEvent("nexy:toast", { detail: `Not saved: ${errText(err)}` }),
              );
              await refresh().catch((err) => console.warn("[nexy] social refresh failed", err));
            }
            window.dispatchEvent(
              new CustomEvent("nexy:toast", {
                detail: env?.state.paused
                  ? "Paused, and written to disk. Nothing was running to stop."
                  : "Resumed, and written to disk. Nothing runs until a connector exists.",
              }),
            );
            draw();
          });
        }
      };
      draw();
    },
  };
}

export type SocialCmd =
  | { kind: "setup"; brief: string | null }
  | { kind: "brief"; brief: string }
  | { kind: "open"; view: View }
  | { kind: "schedule" }
  | { kind: "pause"; paused: boolean }
  | { kind: "rewrite"; net: Network; instruction: string }
  | { kind: "connect"; net: Network | null };

let awaitingBrief = false;

function subjectOf(text: string): string | null {
  const m =
    /\babout\s+(.+)$/i.exec(text) ??
    /\bpromoting\s+(.+)$/i.exec(text) ??
    /\bposts?\s+for\s+(.+)$/i.exec(text);
  const s = m?.[1]?.trim().replace(/[.!?]+$/, "");
  return s && s.length > 2 ? s : null;
}

export function matchSocial(text: string): SocialCmd | null {
  const s = text.trim();
  const l = s.toLowerCase();

  const rw =
    /\brewrite\s+(?:the\s+)?(instagram|linkedin|twitter|x)\s*(?:post|draft|caption|tweet)?\s*(?:to|so that|so it is|and make it|making it)?\s*(.*)$/i.exec(s);
  if (rw) {
    const net = parseNetwork(rw[1]);
    if (net) return { kind: "rewrite", net, instruction: rw[2].trim() || "improve it" };
  }

  if (/^(?:please\s+)?(pause|stop|hold)\b.*\b(posting|autopilot|social|schedule|posts|queue)\b/i.test(l))
    return { kind: "pause", paused: true };
  if (/^(?:please\s+)?(resume|unpause|restart|continue)\b.*\b(posting|autopilot|social|schedule|posts|queue)\b/i.test(l))
    return { kind: "pause", paused: false };

  if (/^(?:ok(?:ay)?,?\s*)?(schedule|queue)\s+(them|these|it|the\s+(posts|drafts))\b/i.test(l))
    return { kind: "schedule" };

  // A short command to look at a view, not any sentence containing "open": a request like "create a
  // blog ... research 3 posts on the latest open source AI models" opened the drafts (2026-10-23).
  const nav = /^(?:please\s+)?(?:can you\s+|could you\s+)?(?:show|open|go to|take me to)\b/i.test(l)
    && l.split(/\s+/).length <= 12 && !/\bopen[- ]source\b/i.test(l);
  if (nav && !/\b(project|plan|board|tasks?|agents?|files?)\b/i.test(l)) {
    const w = /\b(calendar|overview|drafts?|queue|posts?|connections?|activity|schedule)\b/i.exec(l)?.[1];
    if (w) {
      const view: View =
        /calendar|schedule/.test(w) ? "calendar"
        : /draft|post/.test(w) ? "drafts"
        : /connection/.test(w) ? "connections"
        : /activity/.test(w) ? "activity"
        : "overview";
      const contested = view === "overview" || view === "activity";
      // "show me all the connections" means the machine's connected apps; only
      // social words make it the social accounts view
      const social = /\b(social|posting|posts?|instagram|linkedin|twitter|x)\b/i.test(l);
      if (view === "connections" ? social : !contested || socialInUse()) return { kind: "open", view };
    }
  }

  const conn = /^(?:please\s+)?connect\s+(?:my\s+|our\s+|the\s+)?(instagram|linkedin|twitter|x)\b/i.exec(l);
  if (conn) return { kind: "connect", net: parseNetwork(conn[1]) };

  if (/(social|instagram|linkedin|twitter|\bx\b)/i.test(l) && /(schedul|auto ?-? ?post|posting|campaign|content plan|content calendar)/i.test(l)) {
    return { kind: "setup", brief: subjectOf(s) };
  }

  if (awaitingBrief && s) {
    if (/^(never ?mind|cancel|stop|forget it|no)\b/i.test(l)) { awaitingBrief = false; return null; }
    if (/^(show|open|go to|add task|mark|assign|build|create|make|generate|draw|what|who|when|why|how)\b/i.test(l)) return null;
    return { kind: "brief", brief: s };
  }

  return null;
}

const bub = (el: HTMLElement, html: string) => {
  const b = el.querySelector(".bub");
  if (b) b.innerHTML = html;
};

const fail = (el: HTMLElement, what: string, e: unknown) =>
  bub(
    el,
    `${esc(what)}: <code>${esc(errText(e))}</code>` +
      `<div class="feednote bad" style="margin-top:8px">This all runs on this machine, so this is a local fault.</div>`,
  );

async function playSetup(brief: string, ui: SocialUI, keepListening = false): Promise<void> {
  awaitingBrief = keepListening;
  const rows: [string, string, boolean?][] = [
    ["Write 6 posts: 2 each for Instagram, LinkedIn and X", "Copywriter"],
    ["Lay them over the next two weeks", "Scheduler"],
    ["Pause or resume the queue", "You"],
    ["Publish to the networks", "off: no connector here", true],
  ];
  const plan = ui.push(
    "ai",
    `Here is how I would run it. Say the word and I start; the drafts are about ${esc(brief)}, and you decide whether they are good and when they go out.` +
      `<div class="block" style="margin-top:12px"><div class="bh">Plan: Social autopilot<span class="r">${rows.length} tasks, on device</span></div>` +
      rows.map(([t, who, off]) => `<div class="row"><span class="led${off ? " off" : ""}"></span><span>${esc(t)}</span><span class="v">${esc(who)}</span></div>`).join("") +
      `<div class="ba"><button class="btn" type="button" data-a="adjust">Adjust</button><button class="btn primary" type="button" data-a="start">Start</button></div></div>`,
  );
  plan.querySelector<HTMLElement>('[data-a="adjust"]')?.addEventListener("click", () => {
    const inp = document.querySelector<HTMLTextAreaElement>("#input");
    if (inp) { inp.value = "Write the posts about "; inp.dispatchEvent(new Event("input")); inp.focus(); }
  });
  const start = plan.querySelector<HTMLButtonElement>('[data-a="start"]');
  start?.addEventListener("click", () => {
    start.disabled = true;
    void draft(brief, ui);
  }, { once: true });
}

async function draft(brief: string, ui: SocialUI): Promise<void> {
  const holder = ui.push(
    "ai",
    `Started. Writing six posts about ${esc(brief)}, two each for Instagram, LinkedIn and X, in each one's length. ` +
      `The model does this on this machine, one at a time, so give it a few minutes.` +
      `<div class="feednote" style="margin-top:8px">Drafting…</div>`,
  );
  try {
    const e = await call("draft", { brief, networks: ["instagram", "linkedin", "x"], perNetwork: 2 });
    ui.showArtifact(socialArtifact("drafts"));
    bub(
      holder,
      `${e.state.drafts.length} draft${e.state.drafts.length === 1 ? "" : "s"} on the right, one set per network. ` +
        `They stay on this machine: there is no Instagram, LinkedIn or X connector here, so nothing can be posted yet. ` +
        `Say <b>schedule them</b> and I will lay them over the next two weeks.`,
    );
  } catch (e) {
    fail(holder, "The drafts did not get written", e);
  }
}

export async function playSocial(cmd: SocialCmd, ui: SocialUI): Promise<void> {
  if (cmd.kind === "setup") {
    if (!cmd.brief && ui.project) {
      awaitingBrief = true;
      ui.push("ai", `No subject given, so I am writing them about your open project, <b>${esc(ui.project)}</b>. ` +
        `Tell me a different subject any time and I will rewrite them.`);
      return playSetup(ui.project, ui, true);
    }
    if (!cmd.brief) {
      awaitingBrief = true;
      ui.push(
        "ai",
        `I can do most of that on this machine: write the posts, keep them, and hold a schedule. ` +
          `I cannot post them — there is no Instagram, LinkedIn or X connector here, so nothing can leave ` +
          `the machine yet.<br><br>What should the posts be about?`,
      );
      return;
    }
    return playSetup(cmd.brief, ui);
  }

  if (cmd.kind === "brief") {
    return playSetup(cmd.brief, ui);
  }

  if (cmd.kind === "open") {
    try {
      await refresh();
    } catch (e) {
      console.warn("[nexy] social refresh failed", e);
    }
    ui.showArtifact(socialArtifact(cmd.view));
    const label = VIEWS.find(([k]) => k === cmd.view)?.[1] ?? "It";
    ui.push("ai", `Opened ${esc(label)} on the right. Nothing on it publishes — no network is connected.`);
    return;
  }

  if (cmd.kind === "schedule") {
    const holder = ui.push("ai", `Laying them out…`);
    try {
      const e = await call("schedule", {});
      ui.showArtifact(socialArtifact("calendar"));
      bub(
        holder,
        `${e.state.schedule.length} post${e.state.schedule.length === 1 ? "" : "s"} scheduled over the next two weeks; the calendar is on the right.<br><br>` +
          `<b>Not connected, so nothing will publish.</b> The times are stored on this machine and will ` +
          `still be here after a restart. There is also no scheduler process — when a connector exists, ` +
          `something has to be built to read this queue and act on it.`,
      );
    } catch (e) {
      if (/no drafts/i.test((e as Error).message)) bub(holder, `There are no drafts to schedule yet. Tell me what the posts should be about and I will write them first.`);
      else fail(holder, "Nothing was scheduled", e);
    }
    return;
  }

  if (cmd.kind === "pause") {
    const holder = ui.push("ai", cmd.paused ? `Pausing…` : `Resuming…`);
    try {
      const e = await call("pause", { paused: cmd.paused });
      ui.showArtifact(socialArtifact("overview"));
      bub(
        holder,
        cmd.paused
          ? `Paused, and written to disk — it will still be paused after a restart.<br><br>` +
            `To be exact about what that did: nothing was running. There is no scheduler and no connector, ` +
            `so no post was ever going to go out. What is recorded is your answer, and ${e.state.schedule.length} ` +
            `queued slot${e.state.schedule.length === 1 ? " is" : "s are"} now marked held.`
          : `Resumed, and written to disk. Still nothing publishes: no network is connected.`,
      );
    } catch (e) {
      fail(holder, cmd.paused ? "That pause was not saved" : "That was not saved", e);
    }
    return;
  }

  if (cmd.kind === "rewrite") {
    const label = SPECS[cmd.net].label;
    const holder = ui.push("ai", `Rewriting the ${esc(label)} draft…`);
    try {
      const e = await call("rewrite", { network: cmd.net, instruction: cmd.instruction });
      ui.showArtifact(socialArtifact("drafts"));
      const d = e.state.drafts.find((x) => x.id === (e as any).rewrote);
      bub(
        holder,
        `Rewritten. The ${esc(label)} draft is updated on the right` +
          `${d ? `, now ${d.text.length} of ${SPECS[cmd.net].limit} characters` : ""}. The others are untouched.`,
      );
    } catch (e) {
      fail(holder, `The ${label} draft did not change`, e);
    }
    return;
  }

  if (cmd.kind === "connect") {
    const label = cmd.net ? SPECS[cmd.net].label : "that network";
    const c = env?.connectors.find((x) => x.net === cmd.net);
    ui.push(
      "ai",
      `I cannot connect ${esc(label)}. This is not a permission you can grant me — the connector does not ` +
        `exist in this app.<br><br>${esc(c?.why ?? NOT_CONNECTED)}<br><br>` +
        `Until one is built I can write the posts and hold the schedule, and you post them by hand.`,
    );
    ui.showArtifact(socialArtifact("connections"));
  }
}
