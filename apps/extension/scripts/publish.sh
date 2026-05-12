#!/usr/bin/env bash
# Build and publish the Crikket Chrome extension to the Chrome Web Store.
#
# Required env vars (loaded from apps/extension/.env if present):
#   CHROME_EXTENSION_ID    The published extension's ID.
#   CHROME_CLIENT_ID       OAuth 2.0 client ID for the Chrome Web Store API.
#   CHROME_CLIENT_SECRET   OAuth 2.0 client secret.
#   CHROME_REFRESH_TOKEN   OAuth 2.0 refresh token authorized for the publisher account.
#
# See https://github.com/fregante/chrome-webstore-upload-cli for how to obtain these.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EXT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

ENV_FILE="$EXT_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

: "${CHROME_EXTENSION_ID:?CHROME_EXTENSION_ID is required (set in apps/extension/.env)}"
: "${CHROME_CLIENT_ID:?CHROME_CLIENT_ID is required (set in apps/extension/.env)}"
: "${CHROME_CLIENT_SECRET:?CHROME_CLIENT_SECRET is required (set in apps/extension/.env)}"
: "${CHROME_REFRESH_TOKEN:?CHROME_REFRESH_TOKEN is required (set in apps/extension/.env)}"

cd "$EXT_DIR"

echo "==> Building production zip via wxt zip"
bun run zip

ZIP=$(ls -t .output/*-chrome.zip 2>/dev/null | head -n 1 || true)
if [ -z "${ZIP:-}" ]; then
  echo "ERROR: no Chrome zip found in $EXT_DIR/.output/" >&2
  exit 1
fi

echo "==> Uploading $ZIP to extension $CHROME_EXTENSION_ID"
bunx --bun chrome-webstore-upload-cli@3 upload \
  --source "$ZIP" \
  --extension-id "$CHROME_EXTENSION_ID" \
  --client-id "$CHROME_CLIENT_ID" \
  --client-secret "$CHROME_CLIENT_SECRET" \
  --refresh-token "$CHROME_REFRESH_TOKEN"

echo "==> Uploaded as draft. Publish from https://chrome.google.com/webstore/devconsole"
