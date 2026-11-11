export interface AppTarget {
  id: string;
  label: string;
  base: string;
  history?: string;
  kind?: "image" | "audio" | "voice" | "site" | "doc" | "project";
  cookie?: string;
}

const env = (k: string, d: string) => process.env[k] ?? d;

// a computer without an Own1 has only the studios the app started there, each named by its NEXY_*_URL:
// "not here", never "not answering"
const COMPUTER = process.env.NEXY_STUDIOS === "off";
const here = (a: AppTarget & { env: string }): boolean => !COMPUTER || !!process.env[a.env];

const ALL: (AppTarget & { env: string })[] = [
  { id: "qiki",     label: "Qiki",              env: "NEXY_QIKI_URL",    base: env("NEXY_QIKI_URL",    "http://127.0.0.1:4331"),
    history: "/api/v1/director/runs?limit=200", kind: "site" },
  { id: "images",   label: "Own Image Studio",  env: "NEXY_IMAGES_URL",  base: env("NEXY_IMAGES_URL",  "http://127.0.0.1:4335"),
    history: "/api/history", kind: "image" },
  { id: "beat",     label: "Own Beat Studio",   env: "NEXY_BEAT_URL",    base: env("NEXY_BEAT_URL",    "http://127.0.0.1:4340"),
    history: "/api/history", kind: "audio" },
  { id: "voice",    label: "Own Voice Studio",  env: "NEXY_VOICE_URL",   base: env("NEXY_VOICE_URL",   "http://127.0.0.1:4345"),
    history: "/api/history", kind: "voice" },
  { id: "docs",     label: "Own Docs",          env: "NEXY_DOCS_URL",    base: env("NEXY_DOCS_URL",    "http://127.0.0.1:4360"),
    history: "/api/v1/documents", kind: "doc", cookie: "owndocs_owner" },
  { id: "startup",  label: "Own Startup",       env: "NEXY_STARTUP_URL", base: env("NEXY_STARTUP_URL", "http://127.0.0.1:4371"),
    history: "/api/pm/projects", kind: "project" },
  { id: "build",    label: "Own Build",         env: "NEXY_BUILD_URL",   base: env("NEXY_BUILD_URL",   "http://127.0.0.1:4372"),
    history: "/api/director/runs?limit=200", kind: "site" },
  { id: "hub",      label: "Connector registry", env: "NEXY_HUB_URL",    base: env("NEXY_HUB_URL",     "http://127.0.0.1:4365") },
];

export const APPS: AppTarget[] = ALL.filter(here).map(({ env: _, ...a }) => a);

export const byId = (id: string): AppTarget | undefined =>
  APPS.find((a) => a.id === id);

export const withHistory = (): AppTarget[] => APPS.filter((a) => a.history);
