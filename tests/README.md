Conversation isolation checks
=============================

Run `node --test tests/chat-storage.cjs` from `nexy/` after installing the app's dependencies.
This exercises real JSON storage in a temporary directory: output persistence, owner
separation, legacy chats, URL validation and the output size limit.

Build with `npm run build`, then serve `HOST=127.0.0.1 PORT=4389 node dist/server/entry.mjs`.
Run `NEXY_BASE=http://127.0.0.1:4389 PLAYWRIGHT_MODULE=/path/to/playwright node tests/conversation-isolation.cjs`.
`tests/buttons.cjs` runs the same way. It clicks every visible button, plus each button a menu
or dialog reveals, at desktop and phone width. Each click must change the page, make a request
or download, and throw nothing. Sign out and delete are skipped.
Playwright can also be installed normally and the module override omitted. All app/model
API responses are simulated; these tests use no GPU and do not touch a real owner's data.

The browser checks select saved chats, isolate Files/Apps/output tabs, complete a build
in the background, queue a prompt in another chat and leave both for a third, reload
completed output history, start a fresh chat, fail a background generation, and end an
ultra-private session without persisting its outputs. Browser errors fail the suite.

For comparison, `NEXY_CLIENT_BUNDLE=/path/to/before.js` replaces the browser bundle.
The pre-fix client fails the selected-chat output check.

Existing chats without output IDs recover only explicit preview links found in their
own transcript. They never inherit the machine-wide recent feed. Closing/reloading the
page during an unfinished generation is not a job-resumption mechanism; the switching
checks keep the page open while changing conversations.

Conversation deployment checks
==============================

`node --test tests/publishing.cjs tests/chat-storage.cjs` runs the actual Nexy
publishing handlers against temporary saved chats and the private Python publisher
with a loopback Own Build fixture. It checks owner/chat/output scoping, same-origin
mutations, name conflicts, saved output edits, restart persistence, independent
unpublishing, compatibility with the standalone page, and unconfigured instances.
Set `NEXY_PUBLISHER_SCRIPT` if the private publisher copy is elsewhere (default:
`../publisher.py` from tests/).
Requires Python 3 and permission to bind loopback test ports; no Own1 services used.

After a production build, serve it locally and run
`NEXY_BASE=http://127.0.0.1:4389 PLAYWRIGHT_MODULE=/path/to/playwright node tests/publishing-browser.cjs`.
This uses simulated API responses to check publishing inside right-panel Share
(and the absence of a separate Deploy button/modal), input
validation, selected-chat/output binding, links, unpublish, switching while a
publish is pending, Escape dismissal without closing the canvas, and reload.

Production publishing is opt-in with `NEXY_PUBLISHER_URL`, pointing to a trusted
loopback publisher. Private deployment uses its existing authenticated publisher.
Own1 demo opts into `deploy/demo-publishing.nix` from its wrapper, also setting
`NEXY_PUBLISH_SESSION_URL` to validate the active desktop session and
`NEXY_PUBLISH_ORIGIN` for the externally visible Nexy HTTPS origin. Its small
publisher requires owner-scoped requests and serves saved snapshots only.
The integration test covers session rejection/acceptance, configured origins,
cross-owner status/unpublish rejection and successful owner unpublishing, as well
as compatibility with the separate private publisher.

Network fault checks
====================

After `npm run build`, `PLAYWRIGHT_MODULE=/path/to/playwright node --test tests/network-faults.cjs`
drives the real page and server through a TCP fault proxy: 300 ms latency, a dropped stream, the
box offline for 8 s, a 20 s stall, a connection that goes silent for good, a model silent for 50 s,
a server restart mid-reply and two quick drops. Each checks what the person sees and that the
model was asked once. About 2.5 minutes; `CASES=2,4b` runs some.

Routine approval checks
=======================

`node --test tests/routine-approval.cjs` (after `npm run build`) serves the build against a
stand-in agent. A routine the agent made while outside content was in its context is listed
as pending with its prompt, schedule and source; Confirm and Discard in the Routines view and
the routines API reach the agent; and chat vouches for a clean context only when no file,
mail or page is in the system message. `SHOTS_DIR` saves a screenshot of the pending routine.
