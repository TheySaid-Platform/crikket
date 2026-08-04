// Cancel the current pending Chrome Web Store review so a new version can be
// uploaded, via the Web Store API v2 publishers.items.cancelSubmission.
// See https://developer.chrome.com/docs/webstore/api/reference/rest/v2/publishers.items/cancelSubmission
//
// Run with bun. Reads credentials from the environment. Exits 0 on success.
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
  CHROME_PUBLISHER_ID,
  CHROME_EXTENSION_ID,
} = process.env

function required(name: string, value: string | undefined): string {
  if (!value) {
    console.error(`cancel-review: missing required env var ${name}`)
    process.exit(1)
  }
  return value
}

const clientId = required("CHROME_CLIENT_ID", CHROME_CLIENT_ID)
const clientSecret = required("CHROME_CLIENT_SECRET", CHROME_CLIENT_SECRET)
const refreshToken = required("CHROME_REFRESH_TOKEN", CHROME_REFRESH_TOKEN)
const publisherId = required("CHROME_PUBLISHER_ID", CHROME_PUBLISHER_ID)
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
  if (!res.ok || !json.access_token) {
    console.error(`cancel-review: token request failed (${res.status}): ${JSON.stringify(json)}`)
    process.exit(1)
  }
  return json.access_token
}

const token = await getAccessToken()
const url = `https://chromewebstore.googleapis.com/v2/publishers/${publisherId}/items/${extensionId}:cancelSubmission`
const res = await fetch(url, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Length": "0" },
})
const text = await res.text()

if (res.ok) {
  console.log("cancel-review: pending review cancelled")
  process.exit(0)
}

console.error(`cancel-review: cancelSubmission failed (${res.status}): ${text}`)
process.exit(1)
