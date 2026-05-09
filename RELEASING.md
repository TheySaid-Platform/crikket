# Releasing the Crikket Chrome extension

This doc covers publishing the extension to the Chrome Web Store as an
**Unlisted** internal listing for `@theysaid.io` users. The dashboard is
hosted at `https://crikket.dev.theysaid.io`.

The extension lives at `apps/extension/`. Build tooling is [WXT](https://wxt.dev).

---

## One-time setup

1. **Create the dev console account** (already done).
   Sign in at https://chrome.google.com/webstore/devconsole with a generic
   `@theysaid.io` Workspace account (e.g. `developers@theysaid.io`) so
   ownership doesn't bind to one person. Pay the $5 registration fee.
   Recommended: **Account → Group publisher** to tie ownership to the
   Workspace group.

2. **Create the listing** (first publish only). See
   [`apps/extension/CHROME_LISTING.md`](apps/extension/CHROME_LISTING.md)
   for the exact copy/paste fields (name, summary, description, permission
   justifications, privacy answers).

   - Build the zip locally first: `cd apps/extension && bun run zip`
   - In the dev console: **+ New item** → upload
     `apps/extension/.output/extension-<version>-chrome.zip`
   - Fill the listing tabs from `CHROME_LISTING.md`
   - **Distribution → Visibility = Unlisted**
   - **Submit for review** (1–3 business days for first review)

3. **After first approval**, copy the extension ID from the published URL
   (`https://chromewebstore.google.com/detail/crikket/<extension-id>`) into
   `apps/extension/.env` as `CHROME_EXTENSION_ID`.

4. **Get OAuth credentials** for automated re-publishing. Detailed
   walkthrough: <https://github.com/fregante/chrome-webstore-upload-cli#how-to-get-an-access-token>.
   Quick version:

   1. Go to <https://console.cloud.google.com/apis/credentials> and pick
      (or create) the project tied to your publisher account.
   2. Enable the **Chrome Web Store API**.
   3. Create an **OAuth 2.0 Client ID** of type **Desktop app**. Save the
      client ID + secret.
   4. Authorize once and exchange the code for a refresh token (see CLI
      docs above for the exact `curl`).
   5. Paste all four values into `apps/extension/.env`:
      ```
      CHROME_EXTENSION_ID=...
      CHROME_CLIENT_ID=...
      CHROME_CLIENT_SECRET=...
      CHROME_REFRESH_TOKEN=...
      ```

5. **Pin the extension key** (recommended). After first publish, in the
   dev console open the **Package** tab, copy the public key, and paste
   into `apps/extension/wxt.config.ts`:
   ```ts
   manifest: {
     name: "Crikket",
     key: "<base64 public key from dev console>",
     // ...
   }
   ```
   This keeps the extension ID stable when developers load the unpacked
   build locally.

---

## Cutting a new release

```bash
# 1. Bump the version
#    apps/extension/package.json → "version"
#    (and apps/extension/wxt.config.ts manifest.version if pinned there)

# 2. Build + upload + auto-publish
cd apps/extension
bun run publish:chrome
```

`bun run publish:chrome` runs `scripts/publish.sh`, which:

1. Loads `apps/extension/.env`.
2. Runs `bun run zip` (which calls `wxt zip`) to produce
   `.output/extension-<version>-chrome.zip`.
3. Uploads via `chrome-webstore-upload-cli` and submits with
   `--auto-publish`.

Reviews after the first one are usually under 24 hours. Once approved,
existing users auto-update within ~5 hours.

---

## Verifying a build before publish

Always smoke test the unpacked build before pushing to the Web Store:

```bash
cd apps/extension
bun run build          # produces .output/chrome-mv3/
```

In Chrome → `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → point at `apps/extension/.output/chrome-mv3/`. Then:

- Open a tab playing audio (e.g. a YouTube video).
- Click the Crikket popup → start a recording.
- Confirm the recorder tab opens **focused** and Chrome prompts for
  microphone access on first run.
- Speak into the mic during recording; confirm the source tab's audio is
  still audible (loopback).
- Stop and play back the resulting WebM — you should hear both mic and
  tab audio.
- Take a screenshot via the popup to regression-check that path.

---

## Rolling back

The Chrome Web Store doesn't support arbitrary version downgrades, but you
can publish a new version with the previous build's contents and a bumped
version number:

```bash
cd apps/extension
git checkout <previous-good-sha> -- .
# bump package.json version above the broken release
bun run publish:chrome
```

---

## File map

| Path | What it is |
|---|---|
| `apps/extension/.env` | Local-only. Holds `VITE_*` URLs and `CHROME_*` publish credentials. **Gitignored.** |
| `apps/extension/.env.example` | Template for `.env`. Safe to commit. |
| `apps/extension/scripts/publish.sh` | Build + upload + publish script invoked by `bun run publish:chrome`. |
| `apps/extension/CHROME_LISTING.md` | Exact copy/paste fields for the dev console listing. |
| `apps/extension/wxt.config.ts` | WXT config — manifest, permissions, optional `key` pin. |
| `apps/extension/.output/extension-<v>-chrome.zip` | Build artifact. The thing you upload. |
