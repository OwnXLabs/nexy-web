export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResult {
  reply: string;
  via: string;
  grounded: boolean;
  // the model stopped at its length limit, not because it had finished
  cut?: boolean;
  // the tools and sources the engine says it used this turn; absent where it does not say
  tools?: string[];
  sources?: string[];
}

export interface MemoryItem { id: string; title: string; source: string; startedAt: number | null; messages: number }
export interface Routine {
  id: string; name: string; schedule: string; prompt: string; enabled: boolean;
  nextRunAt: string | null; lastRunAt: string | null; lastStatus: string | null; lastResult?: string;
  // made while outside content was in the agent's context: it waits for the owner's confirm
  pending?: boolean; origin?: string | null;
  // the zone its clock times are read in (IANA name); absent when the agent reads them in UTC
  tz?: string | null;
  // runs when this event arrives instead of on a schedule ("mail from=a@example.com"); each run
  // holds the event as outside content, so it can read but not write or send
  trigger?: string | null;
}

// a new routine: schedule in the owner's zone (tz); utcSchedule is the same in UTC, for agents without zones
export interface NewRoutine { name: string; schedule: string; prompt: string; tz?: string; utcSchedule?: string }

// outside: the system message holds content from outside (files, mail, pages), not only Nexy's own text
// tz: the owner's zone (IANA name), so "8 am" in a routine the agent makes means 8 am there
// user: the person a gate signed in, sent as x-nexy-user so the engine keeps each one's sessions apart
export interface ChatOpts { outside?: boolean; tz?: string; user?: string }

export interface NexyEngine {
  readonly id: string;
  // where a turn goes and what keeps it, said in a reply's `upstream`
  readonly upstream?: string;
  // the longest it may stay silent before the plain model answers instead; the agent default otherwise
  readonly quietMs?: number;
  // shown while a turn has no words yet, after a few seconds: a slow first turn is not a stuck one
  readonly waitNote?: string;
  available(): boolean;
  // session: a stable id per chat, so the agent keeps one browser (and its own history) across turns
  chat(message: string, history: ChatTurn[], system: string, signal?: AbortSignal, session?: string, onText?: (delta: string) => void, opts?: ChatOpts): Promise<ChatResult>;
  // whether the agent has used its browser in this session since `since` (ms): the agent's screen
  // is shown only then, never on a guess from the person's wording
  browsed?(session: string, since: number): Promise<boolean>;
  // the tools the agent ran in this session since `since` (ms), from its own record; null where it has none
  toolsSince?(session: string, since: number): Promise<string[] | null>;
  // speaks as itself: no Nexy persona or naming rules in its prompt, no identity guard on its replies
  readonly ownIdentity?: boolean;
  memory?: {
    list(): Promise<MemoryItem[]>;
    export(): Promise<Array<{ id: string; title: string; messages: unknown[] }>>;
    forget(id?: string): Promise<number>;
  };
  routines?: {
    list(): Promise<Routine[]>;
    create(r: NewRoutine): Promise<Routine>;
    remove(id: string): Promise<void>;
    // the owner's answer to a pending routine
    // tz: the confirming owner's zone, which the routine then runs in
    confirm?(id: string, tz?: string): Promise<{ nextRunAt: string | null; tz?: string | null }>;
    discard?(id: string): Promise<void>;
    // the owner's pause: no runs on the clock or on events; resume counts the next run from now
    setPaused?(id: string, paused: boolean): Promise<{ enabled: boolean; nextRunAt: string | null }>;
    // one run now, the agent's own run of the routine (never a chat turn about it): its result
    runNow?(id: string): Promise<{ reply: string }>;
  };
}
