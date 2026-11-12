// Event triggers ("mail from=billing@acme.example", 'file folder="Invoices 2026"') in plain words.
// Read the way the agent reads them: a source, then fields that must all be equal. Returns plain
// text; the caller escapes it.

export interface Trigger { source: string; when: [string, string][] }

const WORD = /^[a-z0-9_-]{1,64}$/;

export function parseTrigger(spec: string): Trigger | null {
  let rest = String(spec ?? "").trim();
  const sp = rest.indexOf(" ");
  const source = (sp < 0 ? rest : rest.slice(0, sp)).toLowerCase();
  if (!WORD.test(source)) return null;
  rest = sp < 0 ? "" : rest.slice(sp + 1).trimStart();
  const when: [string, string][] = [];
  while (rest) {
    const eq = rest.indexOf("=");
    if (eq < 0) return null;
    const k = rest.slice(0, eq).toLowerCase();
    if (!WORD.test(k)) return null;
    let v = rest.slice(eq + 1), after = "";
    if (v.startsWith('"')) {
      const q = v.indexOf('"', 1);
      if (q < 0) return null;
      after = v.slice(q + 1); v = v.slice(1, q);
    } else {
      const s = v.indexOf(" ");
      if (s >= 0) { after = v.slice(s + 1); v = v.slice(0, s); }
    }
    v = v.trim();
    if (!v || v.length > 500 || v.includes('"')) return null;
    when.push([k, v]);
    rest = after.trimStart();
  }
  return when.length > 8 ? null : { source, when };
}

const short = (s: string, n = 40) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const others = (when: [string, string][], known: string[]) =>
  when.filter(([k]) => !known.includes(k)).map(([k, v]) => ` where ${k} is “${v}”`).join("");

/** What starts it, after "When": "an email arrives from billing@acme.example". */
export function triggerText(spec: string): string {
  const t = parseTrigger(spec);
  if (!t) return `this event arrives: “${String(spec ?? "").trim()}”`;
  const get = (k: string) => t.when.find(([x]) => x === k)?.[1];
  if (t.source === "mail") {
    const from = get("from"), to = get("to"), subject = get("subject");
    return `an email arrives${from ? ` from ${from}` : ""}${to ? ` to ${to}` : ""}${subject ? ` with the subject “${subject}”` : ""}${others(t.when, ["from", "to", "subject"])}`;
  }
  if (t.source === "file") {
    const folder = get("folder"), name = get("name");
    return `a file${name ? ` named “${name}”` : ""} is added${folder ? ` to the “${folder}” folder` : ""}${others(t.when, ["folder", "name"])}`;
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
  const get = (k: string) => t.when.find(([x]) => x === k)?.[1];
  if (t.source === "mail") {
    const from = get("from"), subject = get("subject");
    return from ? `Email from ${short(senderName(from))}` : subject ? `Email “${short(subject)}”` : "Any email";
  }
  if (t.source === "file") {
    const folder = get("folder");
    return folder ? `File in ${short(folder)}` : "Any new file";
  }
  return `Event from ${short(t.source)}`;
}
