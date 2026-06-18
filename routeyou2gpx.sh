#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 <routeyou-url> [output.gpx]"
  echo ""
  echo "Examples:"
  echo "  $0 https://www.routeyou.com/fr-be/route/view/10401893"
  echo "  $0 https://www.routeyou.com/fr-be/route/view/10401893 my-route.gpx"
  exit 1
}

[[ $# -lt 1 ]] && usage

URL="$1"
OUTPUT="${2:-}"

ROUTE_ID=$(echo "$URL" | grep -oP '(?<=/view/)\d+')
LANG=$(echo "$URL" | grep -oP '(?<=\.com/)[a-z]+(?=-)')
LANG="${LANG:-fr}"

if [[ -z "$ROUTE_ID" ]]; then
  echo "Error: Could not extract route ID from URL: $URL" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMPFILE=$(mktemp /tmp/routeyou-XXXXXX.json)
trap 'rm -f "$TMPFILE"' EXIT

echo "Fetching page key for route $ROUTE_ID..." >&2
PAGE_HTML=$(curl -s -H 'User-Agent: Mozilla/5.0' "$URL")
API_KEY=$(echo "$PAGE_HTML" | grep -oP '"key":"\K[a-f0-9]+')

if [[ -z "$API_KEY" ]]; then
  echo "Error: Could not extract API key from page." >&2
  exit 1
fi

echo "Fetching route data (lang=$LANG, key=$API_KEY)..." >&2

curl -s 'https://api.routeyou.com/2.0/json/Route/main' \
  --compressed \
  -X POST \
  -H 'Content-Type: text/plain; charset=UTF-8' \
  -H "Referer: $URL" \
  -H 'Origin: https://www.routeyou.com' \
  --data-raw "{\"jsonrpc\":\"2.0\",\"id\":\"1\",\"authorization\":\"Key $API_KEY\",\"method\":\"getForRouteViewer\",\"params\":[$ROUTE_ID,\"$LANG\",{\"accessCode.verify\":null,\"addLanguage\":\"$LANG\",\"fullSegments\":false,\"editing\":false,\"newInstructionFormat\":true,\"add\":{\"roadCondition\":true}}]}" \
  -o "$TMPFILE"

if ! node -e "
  const d = require('$TMPFILE');
  if (d.error) { console.error('API error:', JSON.stringify(d.error)); process.exit(1); }
  if (!d.result) { console.error('Unexpected response:', JSON.stringify(d).slice(0,200)); process.exit(1); }
" 2>&1; then
  exit 1
fi

if [[ -z "$OUTPUT" ]]; then
  ROUTE_NAME=$(node -e "
    const d = require('$TMPFILE');
    const name = d.result.name;
    console.log(name['$LANG'] || Object.values(name)[0] || 'route');
  ")
  OUTPUT=$(echo "$ROUTE_NAME" | tr '/' '-' | tr -cd '[:alnum:] ._-' | tr ' ' '_').gpx
fi

node "$SCRIPT_DIR/togpx.js" "$TMPFILE" > "$OUTPUT"
echo "Saved to $OUTPUT" >&2
