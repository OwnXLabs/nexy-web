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
check "building on this computer: engine builder, checks, one retry, plain no; Own1 still uses Own Build" node --test --test-timeout=180000 tests/local-build.cjs
check "speech on this computer: model fetch, transcripts, spoken replies" ts tests/voice.test.ts
check "connected apps in chat: lookups recognised, granted tool read as data, missing or failing said plainly" ts tests/connectors.test.ts
check "eval mode only on a server started for evals; a request alone cannot switch it on" ts tests/eval-gate.test.ts
check "speech on this computer in the browser, missing speech still gated, Own1 unchanged" node --test --test-timeout=180000 tests/local-voice.cjs
check "chat storage and owner separation" node --test --test-timeout=180000 tests/chat-storage.cjs
check "routine approval: pending routines wait for Confirm or Discard, clean context vouched for" node --test --test-timeout=180000 tests/routine-approval.cjs
check "routine times: the device's zone reaches the agent, UTC fallback, local times in the view" node --test --test-timeout=180000 tests/routine-tz.cjs
check "beta reports: preview is what is sent, secrets removed, private sends nothing, no badge off beta" node --test --test-timeout=180000 tests/beta-report.cjs
check "a computer that stops answering: plain words, no countdown, never the browser's wording" node --test --test-timeout=180000 tests/computer-away.cjs
check "killed mid-answer: question and partial answer kept, marked interrupted, asked again once" node --test --test-timeout=180000 tests/interrupted-chat.cjs
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
