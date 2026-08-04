#!/usr/bin/env bash
# Build and publish the Crikket Chrome extension to the Chrome Web Store.
#
# Required env vars (loaded from apps/extension/.env if present):
#   CHROME_EXTENSION_ID    The published extension's ID.
#   CHROME_CLIENT_ID       OAuth 2.0 client ID for the Chrome Web Store API.
#   CHROME_CLIENT_SECRET   OAuth 2.0 client secret.
#   CHROME_REFRESH_TOKEN   OAuth 2.0 refresh token authorized for the publisher account.
#
# Optional env vars:
#   CHROME_AUTO_PUBLISH    When "true", automatically submit the uploaded draft
#                          for Chrome Web Store review instead of leaving it as a
#                          draft. NOTE: this does not skip Google's review; it
#                          only removes the manual "Publish" click in the dev
#                          console. The item still goes live only after review.
#   CHROME_TRUSTED_TESTERS When "true", publish to trusted testers (private)
#                          rather than to everyone. Only used when
#                          CHROME_AUTO_PUBLISH=true. Defaults to false.
#   CHROME_PUBLISHER_ID    Numeric publisher ID of the Chrome Web Store developer
#                          account (visible in the dev console URL:
#                          https://chrome.google.com/webstore/devconsole/<PUBLISHER_ID>).
#                          When set, an ITEM_NOT_UPDATABLE error caused by a
#                          previous submission stuck "in review" is handled
#                          automatically: the pending review is cancelled via the
#                          Chrome Web Store API v2 (publishers.items.cancelSubmission)
#                          and the upload is retried. Without it, the script falls
#                          back to a no-op and the release must be unblocked
#                          manually in the dev console.
#
# See https://github.com/fregante/chrome-webstore-upload-cli for how to obtain
# the OAuth keys, and
# https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/cancelSubmission
# for the cancel-review API.

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

# Cancel a pending review via the Chrome Web Store API v2 so a new version can be
# uploaded. Returns 0 on success. Requires CHROME_PUBLISHER_ID.
#
# Implemented with `bun` (native fetch) because the CI image ships neither curl
# nor python3.
cancel_pending_review() {
  if [ -z "${CHROME_PUBLISHER_ID:-}" ]; then
    return 1
  fi
  CHROME_CLIENT_ID="$CHROME_CLIENT_ID" \
  CHROME_CLIENT_SECRET="$CHROME_CLIENT_SECRET" \
  CHROME_REFRESH_TOKEN="$CHROME_REFRESH_TOKEN" \
  CHROME_PUBLISHER_ID="$CHROME_PUBLISHER_ID" \
  CHROME_EXTENSION_ID="$CHROME_EXTENSION_ID" \
  bun run "$SCRIPT_DIR/cancel-review.ts"
}

# Upload the built zip. Echoes CLI output to stdout and to $UPLOAD_OUTPUT;
# sets UPLOAD_STATUS to the CLI exit code.
UPLOAD_OUTPUT="$(mktemp)"
trap 'rm -f "$UPLOAD_OUTPUT"' EXIT
do_upload() {
  echo "==> Uploading $ZIP to extension $CHROME_EXTENSION_ID"
  set +e
  bunx --bun chrome-webstore-upload-cli@3 upload \
    --source "$ZIP" \
    --extension-id "$CHROME_EXTENSION_ID" \
    --client-id "$CHROME_CLIENT_ID" \
    --client-secret "$CHROME_CLIENT_SECRET" \
    --refresh-token "$CHROME_REFRESH_TOKEN" 2>&1 | tee "$UPLOAD_OUTPUT"
  UPLOAD_STATUS=${PIPESTATUS[0]}
  set -e
}

do_upload

if [ "$UPLOAD_STATUS" -ne 0 ]; then
  if grep -q "ITEM_NOT_UPDATABLE" "$UPLOAD_OUTPUT"; then
    echo "==> Upload blocked (ITEM_NOT_UPDATABLE): a previous submission is in review / ready to publish."
    if cancel_pending_review; then
      echo "==> Cancelled the pending review; retrying upload."
      do_upload
      if [ "$UPLOAD_STATUS" -ne 0 ]; then
        echo "ERROR: upload still failed after cancelling the pending review." >&2
        exit "$UPLOAD_STATUS"
      fi
    else
      echo "==> Could not auto-cancel the pending review (set CHROME_PUBLISHER_ID to enable this)."
      echo "    Cancel or publish the existing submission at https://chrome.google.com/webstore/devconsole"
      exit 0
    fi
  else
    exit "$UPLOAD_STATUS"
  fi
fi

if [ "${CHROME_AUTO_PUBLISH:-false}" != "true" ]; then
  echo "==> Uploaded as draft. Publish from https://chrome.google.com/webstore/devconsole"
  echo "    (set CHROME_AUTO_PUBLISH=true to auto-submit for review from CI)"
  exit 0
fi

PUBLISH_ARGS=(
  publish
  --extension-id "$CHROME_EXTENSION_ID"
  --client-id "$CHROME_CLIENT_ID"
  --client-secret "$CHROME_CLIENT_SECRET"
  --refresh-token "$CHROME_REFRESH_TOKEN"
)
if [ "${CHROME_TRUSTED_TESTERS:-false}" = "true" ]; then
  echo "==> Submitting for review (trusted testers / private)"
  PUBLISH_ARGS+=(--trusted-testers)
else
  echo "==> Submitting for review (default / everyone)"
fi

bunx --bun chrome-webstore-upload-cli@3 "${PUBLISH_ARGS[@]}"

echo "==> Submitted for review. It goes live automatically once Google approves."
