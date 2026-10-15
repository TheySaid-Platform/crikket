// Submit the uploaded draft for Chrome Web Store review via the Web Store API
// v1.1 items.publish, and print Google's full response when it is refused.
// See https://developer.chrome.com/docs/webstore/api/reference/rest/v1.1/items/publish
//
// Replaces `chrome-webstore-upload-cli publish`: its error handler logs the
// thrown Error instead of the response body, so CI only showed
// `error: [Object ...]` and never the reason Google refused the submission.
//
// Run with bun. Reads credentials from the environment. Exits 0 when the item
// is published or queued for review, 1 otherwise.
//
// A minimal `process` shim is declared locally so this build script typechecks
// without pulling in @types/node / @types/bun (it is only ever executed by bun
// in CI, where the real global exists).

export {}

declare const process: {
  env: Record<string, string | undefined>
  exit(code?: number): never
}

const {
  CHROME_CLIENT_ID,
  CHROME_CLIENT_SECRET,
  CHROME_REFRESH_TOKEN,
  CHROME_EXTENSION_ID,
  CHROME_TRUSTED_TESTERS,
} = process.env

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`publish: missing required env var ${name}`)
    process.exit(1)
  }
  return value
}

const clientId = required("CHROME_CLIENT_ID", CHROME_CLIENT_ID)
const clientSecret = required("CHROME_CLIENT_SECRET", CHROME_CLIENT_SECRET)
const refreshToken = required("CHROME_REFRESH_TOKEN", CHROME_REFRESH_TOKEN)
const extensionId = required("CHROME_EXTENSION_ID", CHROME_EXTENSION_ID)

async function getAccessToken(): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  })
  const json = (await res.json()) as { access_token?: string }
  if (!(res.ok && json.access_token)) {
    console.error(
      `publish: token request failed (${res.status}): ${JSON.stringify(json)}`
    )
    process.exit(1)
  }
  return json.access_token
}

// A 200 can still carry a refusal in `status`. Only OK and ITEM_PENDING_REVIEW
// mean the submission went through (the same rule the CLI used).
function firstStatus(body: string): string | undefined {
  try {
    return (JSON.parse(body) as { status?: string[] }).status?.[0]
  } catch {
    return undefined
  }
}

const target = CHROME_TRUSTED_TESTERS === "true" ? "trustedTesters" : "default"
const token = await getAccessToken()
const url = `https://www.googleapis.com/chromewebstore/v1.1/items/${extensionId}/publish?publishTarget=${target}`
const res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "x-goog-api-version": "2",
    "Content-Length": "0",
  },
})
const text = await res.text()
const status = firstStatus(text)

if (res.ok && (status === "OK" || status === "ITEM_PENDING_REVIEW")) {
  console.log(`publish: ${status} (target ${target})`)
  process.exit(0)
}

console.error(`publish: refused (${res.status}): ${text}`)
process.exit(1)
