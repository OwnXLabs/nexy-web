# nexy-web

The Nexy web app: the chat, research, projects, files and routines interface, and the server behind it (Astro, Node). It talks to an agent engine through one harness (`src/lib/engine`) and works with any OpenAI-compatible model server.

nexy-web runs in every Nexy deployment:

| Deployment | How it runs nexy-web |
|---|---|
| Own1 | Behind the box's sign-in, beside the Own studios |
| Nexy app (Mac, Windows, Android) | Bundled and started on loopback by the app |
| Docker edition | As a container next to the engine and search |
| Nexy Cloud | Hosted, one engine per user |

## Run

```sh
npm ci
npm run build
NEXY_ENGINE=gateway NEXY_AGENT_URL=http://127.0.0.1:8650 NEXY_AGENT_KEY_FILE=./engine.key \
NEXY_DATA_DIR=./data node dist/server/serve.mjs
```

Start `dist/server/serve.mjs`: it listens on `127.0.0.1:4321`, or on a unix socket with `NEXY_SOCKET`. `dist/server/entry.mjs` also works for local use, but it cannot listen on a socket.

| Setting | Meaning |
|---|---|
| `NEXY_ENGINE` | `gateway` (an agent engine such as Nexy Engine) or `local` (plain chat with no tools) |
| `NEXY_AGENT_URL`, `NEXY_AGENT_KEY_FILE` or `NEXY_AGENT_KEY` | The engine's address and key. Prefer the file: an environment variable is visible to anything that can read the process environment |
| `NEXY_LLM_URL`, `NEXY_MODEL` | Model server and model, for `local` and direct calls |
| `NEXY_SEARXNG_URL` | Search backend |
| `NEXY_DATA_DIR` | Where chats, projects and settings are stored |
| `NEXY_BETA` | `1` on beta builds: a BETA badge, and "Report a problem" can also send to the Nexy team |
| `NEXY_BETA_REPORT_URL`, `NEXY_INSTALL_KEY` | Where beta reports go, and this install's random key (sent as `X-Install`) |
| `NEXY_LOG_TAIL_URL` | Optional: where the app's own scrubbed log tail is fetched for a beta report |
| `NEXY_APP_VERSION` | App version shown in beta reports |
| `NEXY_MODEL_STATUS` | Optional file the host app writes while it downloads the model (`{"model", "completed", "total"}`); the chat home shows the download and holds jobs until it is done |
| `HOST`, `PORT` | Listen address (default `127.0.0.1:4321`; bind wider only behind an authenticating proxy) |
| `NEXY_HOSTS` | Names served besides loopback, comma separated (e.g. `nexy.example.com,my.example.com`; no port means any port). Any other `Host` gets `421`, which stops DNS rebinding. Loopback (`127.0.0.1`, `localhost`, `[::1]`) passes only on `PORT` |
| `NEXY_SOCKET` | With `node dist/server/serve.mjs`: listen on this unix socket (mode 0660, group `NEXY_SOCKET_GROUP` if set; the service must be a member) instead of TCP, so only that group (e.g. nginx) can connect. Required by `NEXY_TRUST_XNODE_AUTH=1` and `NEXY_TRUST_GATE_USER=1` (unless `NEXY_DOOR=desktop`): without it Nexy refuses to start |
| `NEXY_CHAT_STORAGE_MB` | Saved chats per owner (default 512). A save past it gets `507` |
| `NEXY_STUDIOS` | `off` on a machine without the Own studios (the Nexy app, Nexy Cloud): chat only, and the page offers nothing it lacks |
| `NEXY_QIKI_URL`, `NEXY_IMAGES_URL`, `NEXY_BEAT_URL`, `NEXY_VOICE_URL`, `NEXY_DOCS_URL`, `NEXY_STARTUP_URL`, `NEXY_BUILD_URL`, `NEXY_HUB_URL` | Where each Own studio and the connector hub answer (default loopback `127.0.0.1:4331`–`4372`). The browser reaches them only through Nexy's server (`/api/apps/<id>/…`, the feed, chat's connector step) |
| `NEXY_<STUDIO>_TOKEN_FILE` (`QIKI`, `IMAGES`, `BEAT`, `VOICE`, `DOCS`, `STARTUP`, `BUILD`, `HUB`) | Optional: a file holding that studio's service token, for a studio in its own container. Its trimmed contents go as `Authorization: Bearer …` on every server-side call to that studio and no other; never to the browser or a log. Read again every few seconds, so a rotated token needs no restart. A studio that answers `401` gets a plain "its service key is missing or out of date". Unset: no header |
| `OWN_BUILD_TOKEN_FILE` | The same for `deploy/demo-publisher.py`'s calls to Own Build (`OWN_BUILD_URL`). With it set, the publisher follows no redirects |
| `NEXY_OWN1_GUEST` | `1` from the Nexy app while it uses a shared Own 1 through a guest code (Community AI). That box takes text only from a guest and answers `503` while its AI is down. The page then offers no image attachments, and those answers become "This shared Own 1 takes text only; describe the image in words." and "The shared Own 1's AI is offline right now. Try again in a few minutes.", logged as `guest-text-only` and `guest-offline`, not as failed turns. The first is said with or without the flag |
| `NEXY_CAPS` | With `NEXY_STUDIOS=off`: what the app's model can do on this computer (JSON from the Nexy app's capability file: `tasks` maps `chat`, `research`, `summarise`, `routine`, `build_site`, `build_game`, `diagram`, `edit_page` to `allow`, `warn` or `block`). A blocked job shows one card and never runs; `warn` says so first. Unset, nothing is held back |
| `NEXY_PLACE` | `cloud` for Nexy Cloud: the page, the prompt and Nexy's own identity say Nexy Cloud, hosted by OwnX |
| `NEXY_SCREEN` | `none` where there is no agent browser: nothing is opened on a screen and no step is handed over |
| `NEXY_TRUST_XNODE_AUTH` | `1` behind Own1's xnode-auth: the signed-in identity is the owner, so their data follows them across devices. Needs `NEXY_SOCKET` |
| `NEXY_TRUST_GATE_USER` | `1` behind Nexy Cloud's gate, which names each signed-in person in `x-nexy-user`: each one's chats and engine pick are their own, sent on to the engine as `x-nexy-user`, and none of them gets the box's own features. Needs `NEXY_SOCKET`, with the gate as the socket's only client |
| `NEXY_DOOR` | `desktop` for a wrapper that imports `dist/server/entry.mjs` with `ASTRO_NODE_AUTOSTART=disabled`, is the only listener, checks its own key and sets the identity header itself (the Nexy app's `desktop.mjs`). It lets `NEXY_TRUST_XNODE_AUTH=1` run without `NEXY_SOCKET`. Not for `serve.mjs` |
| `NEXY_INSECURE_TRUST_ON_TCP` | `1` lets a trust flag run without `NEXY_SOCKET`. For tests only |
| `NEXY_ENGINES`, `NEXY_ENGINE_<ID>_URL`, `_KEY` or `_KEY_FILE` | More agent engines, each picked per owner in Settings, each with its own key. `_LABEL` and `_NOTE` name one in Settings. The pick applies to new chats: each chat keeps the engine it started on, and moves to another only through Continue, which asks first and makes a new linked chat |
| `NEXY_DEFAULT_ENGINE` | The engine for anyone who has not picked one, and for paths with no owner (e.g. `nexy-engine`). Unset, or naming an engine not listed, it is the `NEXY_AGENT_URL` engine as before. Settings marks it as the default. Ignored with `NEXY_STUDIOS=off` outside Nexy Cloud: the Nexy app runs only the engine it starts |
| Who speaks | Nexy Engine speaks as Nexy: its prompt holds Nexy's persona and naming rules, and its replies pass the identity guard. Hermes (`hermes`, `hermes-*`) and OpenClaw speak as themselves to anyone who may pick engines: their prompt holds only the context (date, place, apps, search, the screen hand-over) and their replies are not rewritten. A visitor without the picker always meets Nexy. Engine failures are plain words on every engine |
| `NEXY_ENGINE_OPENCLAW_AGENT`, `NEXY_ENGINE_OPENCLAW_BUDGET_MS` | OpenClaw's agent target (`openclaw/default`, or `openclaw/<agentId>`), and how long it may stay silent before the plain model answers (120000). OpenClaw speaks the OpenAI chat API only, so memory and routines are not offered while it is picked |
| `NEXY_ENGINE_<ID>_USER_URLS`, `_USER_KEYS` | Behind the gate: a person's own copy of an engine (`u01=http://…,u02=…`) and its key (`u01:<key>,…`). Anyone without both uses the shared one |

**NixOS:** the flake's module sets these through `services.nexy.*`. Give the engine key as `agentKeyFile` (a systemd credential); `agentKey` is written to the Nix store, where every local user can read it.

**Limits:** request bodies are capped at 1 MB (`413`), with larger caps only where a route takes more: studio uploads 48 MB, voice 26 MB, saved chats 16 MB, chat 8 MB, page edits 6 MB, problem reports 4 MB, beta reports 3 MB (`src/lib/gate.ts`). Problem reports stop at 500 per folder.

**Security:** nexy-web has no sign-in of its own. Run it on loopback, or behind an authenticating proxy (Own1's xnode-auth, Nexy Cloud's gate, or the Nexy app's local gate).

## Layout

- `src/pages`: pages and the `/api/v1` routes
- `src/lib/engine`: the engine harness, with one adapter per engine
- `src/client`: browser code
- `tests`: one-command checks
- `deploy`: the Own1 demo publishing integration

## License

MIT. See [LICENSE](LICENSE).
