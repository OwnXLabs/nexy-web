#!/usr/bin/env bash
# Every self-contained Nexy web check, one command, plain report. No model, GPU or Own 1 needed:
# models, the Own 1's job route and devices are stand-ins. Needs Node 22+ and Playwright.
#   tests/run.sh            all checks
#   tests/run.sh swarm      only the checks whose name contains "swarm"
# PLAYWRIGHT_MODULE overrides where Playwright is found.
set -uo pipefail
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

ts() { node --experimental-strip-types --no-warnings --test "$@"; }
check "swarm: plan, parallel pieces across devices, stitch, cleaning" ts tests/swarm.test.ts
check "swarm: progress replays after a dropped connection, owner only" ts tests/swarm-api.test.ts
check "swarm: progress rows name the device and escape server text" ts tests/swarm-view.test.ts
check "swarm: website request in the browser, built across a fake Own 1 and Gaming PC" node --test tests/swarm-browser.cjs
check "chat streams, resumes, hides engine faults" node --test tests/chat-stream.cjs
check "network faults: latency, drops, silence" node --test tests/network-faults.cjs
check "engine picker" node --test tests/engine-picker.cjs
check "engine-neutral replies" node --test tests/engine-neutral.cjs
check "chat storage and owner separation" node --test tests/chat-storage.cjs
check "screen control" node --test tests/screen.cjs
check "routines" node --test tests/routines.cjs
check "problem reports" node --test tests/problem-report.cjs

echo
echo "$pass passed, $fail failed"
[ $fail -eq 0 ] || { printf '  failed: %s\n' "${failed[@]}"; exit 1; }
