#!/usr/bin/env bash
# Sends a signed deploy hook the same way examples/deploy.yml does.
#
#   HOOK_URL=http://dockyard.localhost:8080/api/hooks/<app-id> HOOK_SECRET=dys_... \
#     scripts/test-hook.sh <image> [digest] [commit]
#
# Set HOOK_TS to override the timestamp (e.g. to test that stale requests are rejected).
# Prints the response body and HTTP status; exits non-zero unless the status is 2xx.
set -euo pipefail

: "${HOOK_URL:?Set HOOK_URL to the app's hook URL}"
: "${HOOK_SECRET:?Set HOOK_SECRET to the app's signing secret}"
IMAGE=${1:?Usage: test-hook.sh <image> [digest] [commit]}
DIGEST=${2:-}
COMMIT=${3:-}

BODY=$(jq -nc --arg image "$IMAGE" --arg digest "$DIGEST" --arg commit "$COMMIT" \
  '{image: $image} + (if $digest != "" then {digest: $digest} else {} end) + (if $commit != "" then {commit: $commit} else {} end)')
TS=${HOOK_TS:-$(date +%s)}
SIG=$(printf '%s.%s' "$TS" "$BODY" | openssl dgst -sha256 -hmac "$HOOK_SECRET" -hex | sed 's/^.* //')

OUT=$(curl -sS -w '\n%{http_code}' -X POST "$HOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-Dockyard-Timestamp: $TS" \
  -H "X-Dockyard-Signature: sha256=$SIG" \
  -d "$BODY")
STATUS=${OUT##*$'\n'}
echo "${OUT%$'\n'*}"
echo "HTTP $STATUS"
[[ $STATUS == 2* ]]
