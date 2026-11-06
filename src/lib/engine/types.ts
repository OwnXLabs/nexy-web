export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResult {
  reply: string;
  via: string;
  grounded: boolean;
}

export interface MemoryItem { id: string; title: string; source: string; startedAt: number | null; messages: number }
export interface Routine {
  id: string; name: string; schedule: string; prompt: string; enabled: boolean;
  nextRunAt: string | null; lastRunAt: string | null; lastStatus: string | null; lastResult?: string;
}

export interface NexyEngine {
  readonly id: string;
  available(): boolean;
  // session: a stable id per chat, so the agent keeps one browser (and its own history) across turns
  chat(message: string, history: ChatTurn[], system: string, signal?: AbortSignal, session?: string): Promise<ChatResult>;
  // whether the agent has used its browser in this session since `since` (ms): the agent's screen
  // is shown only then, never on a guess from the person's wording
  browsed?(session: string, since: number): Promise<boolean>;
  memory?: {
    list(): Promise<MemoryItem[]>;
    export(): Promise<Array<{ id: string; title: string; messages: unknown[] }>>;
    forget(id?: string): Promise<number>;
  };
  routines?: {
    list(): Promise<Routine[]>;
    create(r: { name: string; schedule: string; prompt: string }): Promise<Routine>;
    remove(id: string): Promise<void>;
  };
}
