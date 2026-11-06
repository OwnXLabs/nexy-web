export type Network = "instagram" | "linkedin" | "x";

export const NETWORKS: Network[] = ["instagram", "linkedin", "x"];

export type SlotState = "scheduled" | "held";

export interface Draft {
  id: string;
  net: Network;
  brief: string;
  text: string;
  trimmedFrom?: number;
  off?: boolean;
  createdAt: number;
  updatedAt: number;
  by: string;
}

export interface Slot {
  id: string;
  draftId: string;
  net: Network;
  at: number;
  state: SlotState;
}

export interface LogLine {
  ts: number;
  msg: string;
}

export interface SocialState {
  version: 1;
  paused: boolean;
  drafts: Draft[];
  schedule: Slot[];
  log: LogLine[];
  window: { from: string; to: string };
  pillars: string[];
  cadence: Record<Network, number>;
  createdAt: number;
  updatedAt: number;
}

export const emptyState = (now = Date.now()): SocialState => ({
  version: 1,
  paused: false,
  drafts: [],
  schedule: [],
  log: [],
  window: { from: "09:00", to: "18:00" },
  pillars: [],
  cadence: { instagram: 3, linkedin: 2, x: 3 },
  createdAt: now,
  updatedAt: now,
});
