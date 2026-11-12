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

ts() { node --experimental-strip-types --no-warnings --test --test-timeout=120000 "$@"; }
check "swarm: plan, parallel pieces across devices, stitch, cleaning" ts tests/swarm.test.ts
check "swarm: progress replays after a dropped connection, owner only" ts tests/swarm-api.test.ts
check "swarm: progress rows name the device and escape server text" ts tests/swarm-view.test.ts
check "swarm: website request in the browser, built across a fake Own 1 and Gaming PC" node --test --test-timeout=180000 tests/swarm-browser.cjs
check "chat streams, resumes, hides engine faults" node --test --test-timeout=180000 tests/chat-stream.cjs
check "network faults: latency, drops, silence" node --test --test-timeout=180000 tests/network-faults.cjs
check "engine picker" node --test --test-timeout=180000 tests/engine-picker.cjs
check "engine-neutral replies" node --test --test-timeout=180000 tests/engine-neutral.cjs
check "a computer without an Own1: no studio it lacks, no Own1 wording" node --test --test-timeout=180000 tests/local-mode.cjs
check "building on this computer: names, subject, no outside files" ts tests/local-build.test.ts
check "search for charts: results come through, no search said plainly" ts tests/research-search.test.ts
check "building on this computer: engine builder, checks, one retry, plain no; Own1 still uses Own Build" node --test --test-timeout=180000 tests/local-build.cjs
check "speech on this computer: model fetch, transcripts, spoken replies" ts tests/voice.test.ts
check "hold to talk: live words one read at a time, skipped when busy, slow computers fall back" ts tests/voice-partials.test.ts
check "connected apps in chat: lookups recognised, granted tool read as data, missing or failing said plainly" ts tests/connectors.test.ts
check "eval mode only on a server started for evals; a request alone cannot switch it on" ts tests/eval-gate.test.ts
check "speech on this computer in the browser, missing speech still gated, Own1 unchanged" node --test --test-timeout=180000 tests/local-voice.cjs
check "hold to talk in Chromium and WebKit: words while held, checked before Send, Redo, Esc, quick tap, phone" node --test --test-timeout=180000 tests/voice-review.cjs
check "chat storage and owner separation" node --test --test-timeout=180000 tests/chat-storage.cjs
check "routine approval: pending routines wait for Confirm or Discard, clean context vouched for" node --test --test-timeout=180000 tests/routine-approval.cjs
check "routine times: the device's zone reaches the agent, UTC fallback, local times in the view" node --test --test-timeout=180000 tests/routine-tz.cjs
check "one request, one routine: a reminder said in chat is made once, at the asked time, and its first run says that time" node --test --test-timeout=180000 tests/one-routine.cjs
check "routines on events: trigger words and chips, domains and subject words, unknown ones quoted as they are" ts tests/trigger-words.test.ts
check "routines on events in the browser: plain card, read-only line, waits for Turn on, one list with chips, results, Pause and Resume, hostile text stays text" node --test --test-timeout=180000 tests/trigger-routines.cjs
check "beta reports: preview is what is sent, secrets removed, private sends nothing, no badge off beta" node --test --test-timeout=180000 tests/beta-report.cjs
check "a computer that stops answering: plain words, no countdown, never the browser's wording" node --test --test-timeout=180000 tests/computer-away.cjs
check "two devices on one chat: an older copy never saves over newer turns" node --test --test-timeout=180000 tests/chat-two-devices.cjs
check "tables, lists and emails are chat answers, not projects" ts tests/intent-text-answers.test.ts
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
check "an untouched New chat leaves the list when another chat is opened" node --test --test-timeout=180000 tests/empty-new-chat.cjs
check "Nexy Cloud is coming soon: never offered as where something works today" ts tests/coming-soon.test.ts
check "chat prompt: a failed search is said plainly, nothing invented, no made-up past" node --test --test-timeout=180000 tests/prompt-rules.cjs
check "Gmail with an app password in WebKit: three steps, sent once to the hub, kept nowhere in the browser, pause, resume, disconnect says revoke at Google" node --test --test-timeout=180000 tests/gmail-app-password.cjs
check "settings in WebKit: engine names only with a real choice, search only where there is one, panel hides the chat" node --test --test-timeout=180000 tests/settings-wording.cjs
check "phone in the Android app: the last message ends above the floating Nexy button" node --test --test-timeout=180000 tests/phone-layout.cjs
check "chat home: greeting, Get started, model download, computer-only offers" node --test --test-timeout=180000 tests/landing.cjs
# browser checks against a served build (empty screen dir, throwaway data and reports)
tmp=$(mktemp -d)
mkdir -p "$tmp/screen" "$tmp/reports" "$tmp/data"
HOST=127.0.0.1 PORT=4389 NEXY_SCREEN_DIR="$tmp/screen" NEXY_DATA_DIR="$tmp/data" \
  node dist/server/entry.mjs >"$tmp/server.log" 2>&1 &
srv=$!
trap 'kill $srv 2>/dev/null; rm -rf "$tmp"' EXIT
for _ in $(seq 1 60); do curl -fs -o /dev/null http://127.0.0.1:4389/api/v1/health && break; sleep 0.25; done
export NEXY_BASE=http://127.0.0.1:4389 REPORTS_DIR="$tmp/data/reports"
check "screen control" node tests/screen.cjs
check "routines" node tests/routines.cjs
check "problem reports" node tests/problem-report.cjs

echo
echo "$pass passed, $fail failed"
[ $fail -eq 0 ] || { printf '  failed: %s\n' "${failed[@]}"; exit 1; }
