# Chrome Web Store listing — Crikket

Copy/paste these fields into the Chrome Web Store dev console when creating
the listing. Designed for an **Unlisted** internal listing scoped to
`@theysaid.io` users.

The built zip is at `apps/extension/.output/extension-<version>-chrome.zip`
(e.g. `extension-0.1.0-chrome.zip`).

---

## Store listing tab

**Name** (max 75 chars)

```
Crikket — TheySaid bug reports
```

**Summary** (max 132 chars)

```
One-click bug reports with screen recording, console logs, and replay context for the TheySaid team.
```

**Description** (2–3 paragraphs)

```
Crikket is the internal bug-reporting tool for TheySaid. It captures the
context an engineer actually needs to reproduce a bug — a screen recording
of the active tab with mic narration, the most recent console errors, and
the network activity that led up to the issue — and sends them all to your
team's Crikket workspace in one click.

Click the toolbar icon to start a recording or grab a screenshot. The
extension records the active tab (with optional microphone narration),
captures the surrounding browser context (console logs, network requests,
URL, viewport size), and uploads everything to crikket.dev.theysaid.io.
You can review, comment on, and resolve reports from there.

Crikket is internal to TheySaid and only sends data to
crikket.dev.theysaid.io. It does not work with other dashboards.
```

**Category**

```
Developer Tools
```

**Language**

```
English (United States)
```

**Icon** (128×128) — already in repo:

```
apps/extension/public/icon/128.png
```

**Screenshots** — at least one at 1280×800. Recommended captures:
1. The popup open over a real-looking app, "Start recording" visible.
2. The recorder tab showing the live capture with countdown / controls.
3. The Crikket dashboard at `crikket.dev.theysaid.io` showing a finished
   report with playback + console logs.

(You'll need to take these manually — the dev console rejects screenshots
that aren't exactly 1280×800 or 640×400.)

---

## Privacy tab

**Single purpose**

```
Capture screenshots and screen recordings of the active browser tab on user
request, along with the surrounding browser context (console logs, network
activity, URL, viewport), and submit them as bug reports to the user's
Crikket workspace at crikket.dev.theysaid.io.
```

**Permission justifications** — fill all of these:

| Permission | Justification |
|---|---|
| `tabCapture` | Required to record video of the active tab when the user explicitly starts a recording from the extension popup. |
| `activeTab` | Required to identify which tab the user is viewing so we can capture the correct surface. |
| `scripting` | Required to inject the recording overlay UI and the context collector (console / network listeners) into the active tab during a capture. |
| `storage` | Required to persist the user's Crikket session, the in-progress capture state, and the recording countdown across the popup, recorder tab, and background service worker. |
| `tabs` | Required to open the recorder tab when a capture begins and to return focus to the source tab after the capture finishes. |

**Host permissions justification** (if asked — covers `<all_urls>` from the
debugger / content scripts):

```
The extension can capture and inject the recording overlay into any page the
user explicitly targets. We do not read or transmit page contents except
during an active, user-initiated capture; we only send the captured frames,
console output, and network log entries that the user chose to record.
```

**Data usage disclosure**

| Data type | Collected? |
|---|---|
| Personally identifiable information (email of the authenticated user) | Yes |
| Authentication information | Yes (Crikket session token) |
| Website content (the captured tab) | Yes — only during a user-initiated capture |
| User activity (console logs, network requests during capture) | Yes |
| Health, financial, location, personal communications, web history | No |

**Selling user data to third parties** → **No**
**Using/transferring data for purposes unrelated to the item's single purpose** → **No**
**Using/transferring data to determine creditworthiness or for lending purposes** → **No**

**Privacy policy URL**

You'll need a public URL — required even for unlisted listings. Suggested:

```
https://theysaid.io/legal/crikket-privacy
```

(Make sure something actually exists at that URL before submitting; the
review will fail if the link 404s. A one-pager noting "internal-use only,
data goes to crikket.dev.theysaid.io, no third-party sharing" is enough.)

---

## Distribution tab

- **Visibility**: **Unlisted**
- **Distribution regions**: United States is fine for internal use; you can
  pick all regions if you want broader access for remote teammates.
- **Pricing**: Free
- **Mature content**: No

---

## Submit

Click **Submit for review**. First review is typically 1–3 business days.
After approval you'll get a permanent URL like:

```
https://chromewebstore.google.com/detail/crikket/<extension-id>
```

Copy that `<extension-id>` into `apps/extension/.env` as
`CHROME_EXTENSION_ID` so future releases can be published via
`bun run publish:chrome`.
