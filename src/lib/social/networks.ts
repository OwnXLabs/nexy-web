import type { Network } from "./types.ts";

export interface NetworkSpec {
  id: Network;
  label: string;
  limit: number;
  comfortable: number;
  voice: string;
}

export const SPECS: Record<Network, NetworkSpec> = {
  instagram: {
    id: "instagram",
    label: "Instagram",
    limit: 2200,
    comfortable: 300,
    voice: "A caption. Warm, concrete, one idea. A few hashtags at the end, no more than five.",
  },
  linkedin: {
    id: "linkedin",
    label: "LinkedIn",
    limit: 3000,
    comfortable: 900,
    voice: "Plain and professional. Two or three short paragraphs. No hashtags, no emoji, no exclamation marks.",
  },
  x: {
    id: "x",
    label: "X",
    limit: 280,
    comfortable: 240,
    voice: "One post, under 280 characters including spaces. Flat and declarative. At most one hashtag.",
  },
};

export const isNetwork = (s: unknown): s is Network =>
  s === "instagram" || s === "linkedin" || s === "x";

export function parseNetwork(s: unknown): Network | null {
  const v = String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (v === "instagram" || v === "ig" || v === "insta") return "instagram";
  if (v === "linkedin" || v === "li") return "linkedin";
  if (v === "x" || v === "twitter" || v === "tweet") return "x";
  return null;
}

export interface Fitted {
  text: string;
  trimmedFrom?: number;
}

export function fit(net: Network, raw: string): Fitted {
  const limit = SPECS[net].limit;
  const text = raw.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trim();
  if (text.length <= limit) return { text };

  const head = text.slice(0, limit);
  const sentence = Math.max(head.lastIndexOf(". "), head.lastIndexOf(".\n"), head.lastIndexOf("!\n"));
  const cut =
    sentence > limit * 0.66 ? sentence + 1
    : head.lastIndexOf(" ") > limit * 0.5 ? head.lastIndexOf(" ")
    : limit;
  return { text: head.slice(0, cut).trim(), trimmedFrom: text.length };
}

export interface ConnectorStatus {
  net: Network;
  label: string;
  connected: false;
  why: string;
}

export function connectors(): ConnectorStatus[] {
  return [
    {
      net: "instagram",
      label: "Instagram",
      connected: false,
      why: "No Instagram connector is installed. Publishing needs a Meta app, a Business account linked to a Page, and a long-lived token; none of that exists on this machine.",
    },
    {
      net: "linkedin",
      label: "LinkedIn",
      connected: false,
      why: "No LinkedIn connector is installed. Publishing needs a LinkedIn app with the w_organization_social scope and an approved company page; none of that exists on this machine.",
    },
    {
      net: "x",
      label: "X",
      connected: false,
      why: "No X connector is installed. Publishing needs an X developer project with write access and a paid tier; none of that exists on this machine.",
    },
  ];
}

export const anyConnected = (): boolean => connectors().some((c) => c.connected);

export const NOT_CONNECTED =
  "Nothing publishes. No network is connected, so these are scheduled drafts and will stay on this machine until a connector exists.";
