// Set once the user has answered Chrome's microphone prompt on the microphone
// page, whatever the answer.
const MICROPHONE_ASKED_STORAGE_KEY = "microphoneAsked"

// Why recordings will have no voice: "off" after "Allow this time" or a closed
// prompt, "blocked" after "Never allow", which only Chrome's settings undo.
export type MicrophoneProblem = "off" | "blocked"

// Null when the browser cannot tell.
async function readMicrophoneState(): Promise<PermissionState | null> {
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    })
    return status.state
  } catch {
    return null
  }
}

async function hasAskedForMicrophone(): Promise<boolean> {
  const stored = await chrome.storage.local.get(MICROPHONE_ASKED_STORAGE_KEY)
  return stored[MICROPHONE_ASKED_STORAGE_KEY] === true
}

// True before Chrome has asked for the microphone, or again after "Allow this
// time". Chrome only asks on a visible page (see openMicrophonePage).
export async function isMicrophonePermissionUndecided(): Promise<boolean> {
  return (await readMicrophoneState()) === "prompt"
}

export async function markMicrophoneAsked(): Promise<void> {
  await chrome.storage.local.set({ [MICROPHONE_ASKED_STORAGE_KEY]: true })
}

// Sends the user to the microphone page only before they have answered once,
// so "Allow this time" or a closed prompt cannot loop them back there.
export async function shouldAskForMicrophone(): Promise<boolean> {
  return (
    (await isMicrophonePermissionUndecided()) &&
    !(await hasAskedForMicrophone())
  )
}

export async function getMicrophoneProblem(): Promise<MicrophoneProblem | null> {
  const state = await readMicrophoneState()
  if (state === "denied") return "blocked"
  if (state === "prompt" && (await hasAskedForMicrophone())) return "off"
  return null
}

// Asks for the microphone once, like Jam, so every recording can start on
// the user's own tab. The page goes back to the opener tab and closes itself
// once the user answers.
export async function openMicrophonePage(openerTabId?: number): Promise<void> {
  await chrome.tabs.create({
    url: chrome.runtime.getURL("/microphone.html"),
    active: true,
    openerTabId,
  })
}

// Crikket's own page in Chrome's site settings, where "Never allow" can be
// set back to Allow.
export async function openMicrophoneSettings(): Promise<void> {
  const origin = new URL(chrome.runtime.getURL("/")).origin
  await chrome.tabs.create({
    url: `chrome://settings/content/siteDetails?site=${encodeURIComponent(origin)}`,
  })
}
