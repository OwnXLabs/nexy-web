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
NEXY_ENGINE=gateway NEXY_AGENT_URL=http://127.0.0.1:8650 NEXY_AGENT_KEY=<engine key> \
NEXY_DATA_DIR=./data node dist/server/entry.mjs
```

| Setting | Meaning |
|---|---|
| `NEXY_ENGINE` | `gateway` (an agent engine such as Nexy Engine) or `local` (plain chat with no tools) |
| `NEXY_AGENT_URL`, `NEXY_AGENT_KEY` | The engine's address and key |
| `NEXY_LLM_URL`, `NEXY_MODEL` | Model server and model, for `local` and direct calls |
| `NEXY_SEARXNG_URL` | Search backend |
| `NEXY_DATA_DIR` | Where chats, projects and settings are stored |
| `HOST`, `PORT` | Listen address (default `0.0.0.0:4321`; bind to loopback unless it sits behind an authenticating proxy) |

**Security:** nexy-web has no sign-in of its own. Run it on loopback, or behind an authenticating proxy (Own1's xnode-auth, Nexy Cloud's gate, or the Nexy app's local gate).

## Layout

- `src/pages`: pages and the `/api/v1` routes
- `src/lib/engine`: the engine harness, with one adapter per engine
- `src/client`: browser code
- `tests`: one-command checks
- `deploy`: the Own1 demo publishing integration

## Status

Imported from the Own1 desktop repository at commit `6b605340` (2026-11-06), without its history. A license will be chosen before this repository is made public.
