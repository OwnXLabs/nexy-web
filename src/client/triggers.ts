// Event triggers ("mail from=billing@acme.example", 'file folder="Invoices 2026"') in plain words.
// Read the way the agent reads them: a source, then conditions that must all hold. Returns plain
// text; the caller escapes it.

// "=" is equal, "=@acme.com" is anyone at that domain, "~" is contains, as the agent reads them.
export type Op = "is" | "domain" | "has";
export interface Trigger { source: string; when: [string, string, Op][] }

const WORD = /^[a-z0-9_-]{1,64}$/;
const ADDRESS = ["from", "to", "cc", "reply_to"];
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i;
const isDomain = (d: string) => d.length <= 253 && d.indexOf(".") > 0 && d.split(".").every((l) => LABEL.test(l));

export function parseTrigger(spec: string): Trigger | null {
  let rest = String(spec ?? "").trim();
  const sp = rest.indexOf(" ");
  const source = (sp < 0 ? rest : rest.slice(0, sp)).toLowerCase();
  if (!WORD.test(source)) return null;
  rest = sp < 0 ? "" : rest.slice(sp + 1).trimStart();
  const when: [string, string, Op][] = [];
  while (rest) {
    const at = rest.search(/[=~]/);
    if (at < 0) return null;
    const k = rest.slice(0, at).toLowerCase(), has = rest.charAt(at) === "~";
    if (!WORD.test(k)) return null;
    let v = rest.slice(at + 1), after = "";
    if (v.startsWith('"')) {
      const q = v.indexOf('"', 1);
      if (q < 0) return null;
      after = v.slice(q + 1); v = v.slice(1, q);
    } else {
      const s = v.indexOf(" ");
      if (s >= 0) { after = v.slice(s + 1); v = v.slice(0, s); }
    }
    v = v.trim();
    if (!v || v.length > 500 || v.includes('"') || !/[\p{L}\p{N}]/u.test(v)) return null;
    const address = ADDRESS.includes(k);
    let op: Op = "is";
    if (has) {
      if (address || v.length > 100 || v.includes("*")) return null;
      op = "has";
    } else if (v.startsWith("@")) {
      if (!isDomain(v.slice(1))) return null;
      op = "domain"; v = v.slice(1);
    } else if (address && v.includes("*")) return null;
    when.push([k, v, op]);
    rest = after.trimStart();
  }
  return when.length > 8 ? null : { source, when };
}

const short = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const cond = (k: string, v: string, op: Op) => (op === "domain" ? ` where ${k} is anyone at ${v}` : op === "has" ? ` where ${k} has “${v}” in it` : ` where ${k} is “${v}”`);
const others = (when: [string, string, Op][], known: string[]) =>
  when.filter(([k]) => !known.includes(k)).map(([k, v, op]) => cond(k, v, op)).join("");

/** What starts it, after "When": "an email arrives from billing@acme.example". */
export function triggerText(spec: string): string {
  const t = parseTrigger(spec);
  if (!t) return `this event arrives: “${String(spec ?? "").trim()}”`;
  const get = (k: string) => t.when.find(([x]) => x === k);
  const who = (c: [string, string, Op] | undefined, word: string) => (!c ? "" : c[2] === "domain" ? ` ${word} anyone at ${c[1]}` : ` ${word} ${c[1]}`);
  if (t.source === "mail") {
    const subject = get("subject");
    const about = !subject ? "" : subject[2] === "has" ? ` with “${subject[1]}” in the subject` : ` with the subject “${subject[1]}”`;
    return `an email arrives${who(get("from"), "from")}${who(get("to"), "to")}${about}${others(t.when, ["from", "to", "subject"])}`;
  }
  if (t.source === "file") {
    const folder = get("folder"), name = get("name");
    const named = !name ? "" : name[2] === "has" ? ` with “${name[1]}” in its name` : ` named “${name[1]}”`;
    const into = !folder ? "" : folder[2] === "has" ? ` to a folder with “${folder[1]}” in its name` : ` to the “${folder[1]}” folder`;
    return `a file${named} is added${into}${others(t.when, ["folder", "name"])}`;
  }
  return `an event arrives from “${t.source}”${others(t.when, [])}`;
}

// addresses at these say nothing about who sent them, so the address itself is shown
const PERSONAL = ["gmail", "googlemail", "outlook", "hotmail", "live", "yahoo", "icloud", "me", "aol", "proton", "protonmail", "gmx", "mail", "zoho"];

/** "billing@acme.example" → "Acme"; a personal address stays as it is. */
export function senderName(addr: string): string {
  const m = /^[^@\s]+@([a-z0-9.-]+\.[a-z]{2,})$/i.exec(addr.trim());
  if (!m) return addr;
  const parts = m[1].toLowerCase().split(".");
  // acme.co.uk: the name is before the two-part ending
  let name = parts[parts.length - 2];
  if (parts.length >= 3 && name.length <= 3 && ["co", "com", "org", "net", "ac", "gov"].includes(name)) name = parts[parts.length - 3];
  if (PERSONAL.includes(name)) return addr;
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/** The short label on a routine's chip: "Email from Acme", "File in Invoices 2026". */
export function triggerChip(spec: string): string {
  const t = parseTrigger(spec);
  if (!t) return "Event";
  const get = (k: string) => t.when.find(([x]) => x === k);
  if (t.source === "mail") {
    const from = get("from"), subject = get("subject");
    if (from) return `Email from ${short(from[2] === "domain" ? from[1] : senderName(from[1]))}`;
    if (subject) return subject[2] === "has" ? `Email with “${short(subject[1])}”` : `Email “${short(subject[1])}”`;
    return "Any email";
  }
  if (t.source === "file") {
    const folder = get("folder");
    return folder ? `File in ${short(folder[1])}` : "Any new file";
  }
  return `Event from ${short(t.source)}`;
}
