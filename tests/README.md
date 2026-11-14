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
An older client bundle fails the selected-chat output check.

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

`node --test tests/one-routine.cjs` (after `npm run build`): "Every weekday at 7:30 am, remind
me to …" said in chat makes one routine, weekdays at 7:30 in the device's zone. Its first run,
and "run it now" after, tell the agent the routine is already set, so a stand-in agent that
makes a routine of its own when told nothing makes none, and the chat names no other time.

Routines on events
==================

A routine can run when an email or a file arrives instead of on a schedule. `tests/trigger-words.test.ts`
checks the plain words for a trigger ("an email arrives from billing@acme.example") and its chip
("Email from Acme"), anyone at a domain ("from anyone at acme.com", "Email from acme.com") and words in
a subject ("with “invoice” in the subject"), and that a trigger the agent would refuse (an empty,
wildcard-only or overlong pattern, a contains on an address) is quoted as it is.
`node --test tests/trigger-routines.cjs` (after `npm run build`) drives the page against a stand-in
agent: the card that follows the agent's reply reads When / Does / Can (read only) / Limit, waits
until Turn on, and shows a hostile trigger, name and prompt as text; the Routines list holds
scheduled and triggered routines with a chip each, the last run and how it went, the latest result
under its row, Pause / Resume (the row says paused; a waiting routine cannot be resumed) and Delete; a saved chat's cards and list work again when it is reopened; and the
agent is told how to make one; a routine whose task names an invoice and an amount still makes
its card, not an ultra-private chat. `SHOTS_DIR` saves the card and the list, wide and phone.

Connected apps and the owner's own mail
=======================================

`tests/connectors.test.ts` checks which messages ask to read Gmail or Drive, that only the words
to find are searched for ("inbox", "and what it says" are not), what the model is handed when the
app is read, the plain reply when it is paused, not connected or failing, and that an explicit ask
of a connected app is not switched to ultra-private. A follow-up about mail this chat just read
("the Invoice 4471 email", "the full text", "open it") is a mail read too: the best match is opened
in full with gmail_read where the hub has it; the same words in a chat that read no mail are not.
"Open it" alone is answered with the email itself, with no model, and a tool call a model writes as
text ("[[open-url: …]]", 'open_url("…")') is never shown in chat.
A follow-up and a routine on an email ("when an email arrives from X, tell me the invoice number")
are checked before sensitive words switch the chat to ultra-private. `node --test tests/mail-privacy.cjs` (after
`npm run build`) serves the build against a stand-in hub, agent and model: with Gmail paused,
missing or failing, "search my email for Acme Billing" gets a plain reply and reaches neither the
agent nor the model, so nothing can search the web for it; a chart search about the mail is
refused; an ultra-private chat keeps connected apps off; and in WebKit the starter "Find the latest
invoice in my email" reads the mail through the hub in a regular chat, its follow-ups open the
message in full there, answered by the model alone, and an email routine with money words reaches
the agent. `tests/doc-title.test.ts`
checks that the document an answer goes into is named on a word boundary, without the request's
own words.

Old browsers and long answers
=============================

The phone app runs in Android WebView 91 and older Macs in Safari 15. `astro.config.mjs` builds
for them, which lowers syntax only. After `npm run build`, `tests/old-browsers.test.ts` scans the
built client for APIs and CSS those engines lack (`Array.prototype.at`, `AbortSignal.timeout`,
regex lookbehind, `:has()`, range media queries and others; `NEXY_DIST` scans another build), and
`tests/old-engine.cjs` deletes those APIs from a real page before a chat. `tests/answer-budget.cjs`
checks that a reply still being written runs past 90 s (it streams for 150 s), that an engine
silent past `NEXY_AGENT_BUDGET_MS` is stopped with its words kept, and that a length stop offers
Continue. About 2.5 minutes, the three side by side.

Work pane Open button
=====================

`tests/open-in.cjs` (in `tests/run.sh`) restores a chat holding every kind of output and checks
that Open shows only when the click opens that exact item: a page or game in a new tab, a
document in Own Docs as `?doc=<id>`. A stand-in Own Docs advertises `"features": ["doc-link"]`
in its health; without it, no Open in Docs shows. A document written in chat is uploaded once,
however many times Open is clicked, and the tab opens after indexing. A refused upload is said
plainly and the document stays. Every visible work-pane button is clicked and none may lead to
a "cannot" or "not yet" message.
