#!/usr/bin/env bash
# Every self-contained Nexy web check, one command, plain report. No model, GPU or Own 1 needed:
# models, the Own 1's job route and devices are stand-ins. Needs Node 22+ and Playwright.
#   tests/run.sh            all checks
#   tests/run.sh swarm      only the checks whose name contains "swarm"
# PLAYWRIGHT_MODULE overrides where Playwright is found.
set -uo pipefail
# the suite runs as an eval server: tests use the shared test engine and files (src/lib/eval.ts)
export NEXY_EVAL=1
cd "$(dirname "$0")/.."
only=${1:-}
export PLAYWRIGHT_MODULE=${PLAYWRIGHT_MODULE:-$(node -e 'try{console.log(require.resolve("playwright"))}catch{}' 2>/dev/null)}
[ -n "$PLAYWRIGHT_MODULE" ] || export PLAYWRIGHT_MODULE=$HOME/Code/gcp/node_modules/playwright
export NODE_PATH=${NODE_PATH:-$(dirname "$PLAYWRIGHT_MODULE")}
pass=0; fail=0; failed=()
check() { # name, command…
  local name=$1; shift
  [[ -n $only && $name != *"$only"* ]] && return
  if out=$("$@" 2>&1); then echo "PASS  $name"; pass=$((pass+1))
  else echo "FAIL  $name"; echo "$out" | grep -E "not ok|Error|expected|actual|✖" | head -8 | sed 's/^/      /'; fail=$((fail+1)); failed+=("$name"); fi
}

echo "Building…"
npm run build >/tmp/nexy-web-build.log 2>&1 || { echo "FAIL  build (see /tmp/nexy-web-build.log)"; exit 1; }
echo "PASS  build"
check "built CSS has no range syntax (Safari before 16.4)" node --test tests/css-range.test.mjs

ts() { node --experimental-strip-types --no-warnings --test --test-timeout=120000 "$@"; }
check "swarm: plan, parallel pieces across devices, stitch, cleaning" ts tests/swarm.test.ts
check "swarm: progress replays after a dropped connection, owner only" ts tests/swarm-api.test.ts
check "swarm: progress rows name the device and escape server text" ts tests/swarm-view.test.ts
check "the screen viewer loads its class from noVNC (Astro 7 bundling)" ts tests/rfb-class.test.ts
check "swarm: website request in the browser, built across a fake Own 1 and Gaming PC" node --test --test-timeout=180000 tests/swarm-browser.cjs
check "chat streams, resumes, hides engine faults" node --test --test-timeout=180000 tests/chat-stream.cjs
check "network faults: latency, drops, silence" node --test --test-timeout=180000 tests/network-faults.cjs
check "a hanging gateway and a lost question: every turn logged start to end, a question sent again joins its reply" node --test --test-timeout=180000 tests/gateway-stall.cjs
check "engine picker" node --test --test-timeout=180000 tests/engine-picker.cjs
check "OpenClaw engine: agent target, bearer from the key file, one safe session key per chat, whole and streamed, failures fall back" ts tests/openclaw.test.ts
check "OpenClaw in Settings and chat: three engines, the pick kept, via=openclaw, no memory controls, no session calls" node --test --test-timeout=180000 tests/openclaw-engine.cjs
check "one engine per chat: kept after the pick changes, a mismatched turn refused, Continue shares as a linked chat or starts fresh, never from ultra-private, fact questions searched on Hermes and OpenClaw, engine and tools in the turn line, no labels with one engine" node --test --test-timeout=180000 tests/per-chat-engine.cjs
check "Nexy Cloud: the gate names each person, their own engine and key, no box features, Nexy Cloud wording, no agent screen" node --test --test-timeout=180000 tests/cloud-mode.cjs
check "Nexy Cloud wording in the page and in who Nexy says it is" ts tests/cloud-place.test.ts
check "engine-neutral replies" node --test --test-timeout=180000 tests/engine-neutral.cjs
check "who speaks: Nexy Engine as Nexy, Hermes and OpenClaw as themselves, a visitor and the apps always Nexy, failures plain on every engine, the default engine from config" node --test --test-timeout=180000 tests/engine-identity.cjs
check "the default engine: NEXY_DEFAULT_ENGINE for no pick and no owner, a pick wins, missing or unset as before, one engine in the apps" ts tests/default-engine.test.ts
check "a computer without an Own1: no studio it lacks, no Own1 wording" node --test --test-timeout=180000 tests/local-mode.cjs
check "building on this computer: names, subject, no outside files" ts tests/local-build.test.ts
check "search for charts: results come through, no search said plainly" ts tests/research-search.test.ts
check "what this computer's model can do: requests sorted by kind of job, verdicts read from the app" ts tests/capability.test.ts
check "what this computer's model can do, in the browser: a chat-only model's build is one card and no build call, the app's buttons only in the app, a simple-only build says so first, an unstyled page is readable in the work pane, a build that does not work is never called done, a bare app says it came out thin, a page edit with thinking off and a change that did not land said plainly" node --test --test-timeout=240000 tests/capability-gating.cjs
check "the build check on pages known to work and known not to: a black screen with one button, a game with no script or no loop, a website of one line kept back; a game that plays and a website with words shown" node --test --test-timeout=120000 tests/build-gate.cjs
check "changing a page: thinking off on Ollama and llama-server, a server that refuses the switch asked again, a thinking-only answer said plainly, a claimed change not on the page reported" ts tests/page-edit.test.ts
check "building on this computer: engine builder, checks, one retry, plain no; Own1 still uses Own Build" node --test --test-timeout=180000 tests/local-build.cjs
check "build again: the last brief rerun with its error, only right after a build, asked what to build when there is none" ts tests/rebuild-intent.test.ts
check "build again in the browser: Own Build and the engine builder get the original brief and the run-check error, never \"again\"" node --test --test-timeout=180000 tests/rebuild-last-brief.cjs
check "a failed build in the turn log: id, kind, brief length, duration, error and line, no brief text" ts tests/build-failure-log.test.ts
check "speech on this computer: model fetch, transcripts, spoken replies" ts tests/voice.test.ts
check "hold to talk: live words one read at a time, skipped when busy, slow computers fall back" ts tests/voice-partials.test.ts
check "connected apps in chat: lookups and follow-ups recognised, only the words to find searched, granted tool read as data, missing or failing said plainly, an ask of one or a mail routine not switched to ultra-private" ts tests/connectors.test.ts
check "files read on this computer: text, Markdown, CSV, a PDF's text layer; images and others said plainly" ts tests/file-text.test.ts
check "attaching without Own Docs: read here and sent with the question, images refused, an Own1 still uses Own Docs" node --test --test-timeout=180000 tests/local-attach.cjs
check "document titles: cut on a word, without the request's own words" ts tests/doc-title.test.ts
check "eval mode only on a server started for evals; a request alone cannot switch it on" ts tests/eval-gate.test.ts
check "speech on this computer in the browser, missing speech still gated, Own1 unchanged" node --test --test-timeout=180000 tests/local-voice.cjs
check "hold to talk in Chromium and WebKit: words while held, checked before Send, Redo, Esc, quick tap, phone" node --test --test-timeout=180000 tests/voice-review.cjs
check "ultra-private speech: every speech request refused while private" ts tests/private-speech.test.ts
check "ultra-private on a computer: mic, Talk and voice tip hidden, no reply spoken, no speech call, a recording under way dropped, all back after" node --test --test-timeout=180000 tests/private-voice.cjs
check "status codes never reach the screen: httpMsg words in src/client" ts tests/status-codes.test.ts
check "chat storage and owner separation" node --test --test-timeout=180000 tests/chat-storage.cjs
check "routine approval: pending routines wait for Confirm or Discard, clean context vouched for" node --test --test-timeout=180000 tests/routine-approval.cjs
check "routine times: the device's zone reaches the agent, UTC fallback, local times in the view" node --test --test-timeout=180000 tests/routine-tz.cjs
check "one request, one routine: a reminder said in chat is made once, at the asked time, and its first run says that time" node --test --test-timeout=180000 tests/one-routine.cjs
check "routines on events: trigger words and chips, domains and subject words, unknown ones quoted as they are" ts tests/trigger-words.test.ts
check "routines on events in the browser: plain card, read-only line, waits for Turn on, one list with chips, results, Pause and Resume, hostile text stays text" node --test --test-timeout=180000 tests/trigger-routines.cjs
check "what leaves in a report: keys, tokens, passwords, cookies and wallets everywhere; emails, phones, home folders, IP and MAC addresses in logs and chats" ts tests/scrub.test.ts
check "beta reports: the preview is the body, each switch changes both, hardware without identifiers, Report this chat sends that thread only, choices kept but never the chat, a kept draft, five screenshots by paste or drop within the limits, private sends nothing, https only, no badge off beta" node --test --test-timeout=240000 tests/beta-report.cjs
check "a computer that stops answering: plain words, no countdown, never the browser's wording" node --test --test-timeout=180000 tests/computer-away.cjs
check "two devices on one chat: an older copy never saves over newer turns" node --test --test-timeout=180000 tests/chat-two-devices.cjs
check "tables, lists and emails are chat answers, not projects" ts tests/intent-text-answers.test.ts
check "assigning a task to me or to the name set in Settings goes to the owner" ts tests/assign-owner.test.ts
check "Continue is never taken as a search" ts tests/continue-not-search.test.ts
check "the model dies mid-answer: words kept, Continue" node --test --test-timeout=180000 tests/model-dies.cjs
check "killed mid-answer: question and partial answer kept, marked interrupted, asked again once" node --test --test-timeout=180000 tests/interrupted-chat.cjs
check "long answers: room for 4096 tokens, a cut reply says so and continues" node --test --test-timeout=180000 tests/long-answers.cjs
check "old browsers: nothing in the built client that Android WebView 91 or Safari 15 lacks" ts tests/old-browsers.test.ts
check "old browsers: chat on a phone web view without the newer APIs reaches the model" node --test --test-timeout=180000 tests/old-engine.cjs
check "answer budget: a reply still being written runs past 90 s, silence is stopped with its words kept and Continue" node --test --test-timeout=240000 tests/answer-budget.cjs
check "table totals: checked within one table only, unclear shapes left alone" ts tests/table-totals.test.ts
check "markdown in replies: rendered, checklists as boxes, no HTML, links only http(s)" ts tests/markdown.test.ts
check "answer documents: Continue grows the same one under the question's name, the note fits a phone" node --test --test-timeout=180000 tests/answer-documents.cjs
check "work pane Open: shown only when it opens that exact item; a chat document goes to Own Docs once and opens as ?doc=<id>; no button leads to a dead end" node --test --test-timeout=300000 tests/open-in.cjs
check "an untouched New chat leaves the list when another chat is opened" node --test --test-timeout=180000 tests/empty-new-chat.cjs
check "Nexy Cloud is coming soon: never offered as where something works today" ts tests/coming-soon.test.ts
check "chat prompt: a failed search is said plainly, nothing invented, no made-up past" node --test --test-timeout=180000 tests/prompt-rules.cjs
check "the owner's own mail never searched on the web: paused, missing or failing Gmail said plainly with no agent or model, the invoice starter and its follow-ups read it, 'open it' shows the email, ultra-private keeps it off" node --test --test-timeout=180000 tests/mail-privacy.cjs
check "Gmail with an app password in WebKit: three steps, sent once to the hub, kept nowhere in the browser, pause, resume, disconnect says revoke at Google, a refusal stays on the card" node --test --test-timeout=180000 tests/gmail-app-password.cjs
check "settings in WebKit: engine names only with a real choice, search only where there is one, panel hides the chat" node --test --test-timeout=180000 tests/settings-wording.cjs
check "phone in the Android app: the last message ends above the floating Nexy button" node --test --test-timeout=180000 tests/phone-layout.cjs
check "before routing: a foreign Host gets 421, an oversized body 413, full chat storage 507, NEXY_SOCKET answers on the socket only, a trust flag without it refuses to start" node --test --test-timeout=120000 tests/request-gate.cjs
check "chat home: greeting, Get started, model download, computer-only offers" node --test --test-timeout=180000 tests/landing.cjs
check "box features: shown only where the server allows them, no button leads to a refusal, a routine ask said plainly" node --test --test-timeout=180000 tests/box-features.cjs
check "what counts as a routine ask" ts tests/routine-ask.test.ts
check "an engine failure is said plainly" ts tests/engine-plain-error.test.ts
# browser checks against a served build (empty screen dir, throwaway data and reports)
tmp=$(mktemp -d)
mkdir -p "$tmp/screen" "$tmp/reports" "$tmp/data"
# the version the desktop app gives its server: problem reports must carry it
export NEXY_APP_VERSION=0.0.0-test
# a single-user install: routines and memory are offered (tests/box-features.cjs covers them off)
NEXY_BOX_FEATURES=open HOST=127.0.0.1 PORT=4389 NEXY_SCREEN_DIR="$tmp/screen" NEXY_DATA_DIR="$tmp/data" \
  node dist/server/entry.mjs >"$tmp/server.log" 2>&1 &
srv=$!
trap 'kill $srv 2>/dev/null; rm -rf "$tmp"' EXIT
for _ in $(seq 1 60); do curl -fs -o /dev/null http://127.0.0.1:4389/api/v1/health && break; sleep 0.25; done
export NEXY_BASE=http://127.0.0.1:4389 REPORTS_DIR="$tmp/data/reports"
check "screen control" node tests/screen.cjs
check "routines" node tests/routines.cjs
check "problem reports" node tests/problem-report.cjs
check "each chat keeps its own files, builds and replies" node tests/conversation-isolation.cjs
check "publishing from Share: the right chat and output, unpublish, reload, a failed save and Retry" node tests/publishing-browser.cjs
check "every visible button does something, at desktop and phone width" node tests/buttons.cjs

echo
echo "$pass passed, $fail failed"
[ $fail -eq 0 ] || { printf '  failed: %s\n' "${failed[@]}"; exit 1; }
