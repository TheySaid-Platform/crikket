// True before Chrome has asked for the microphone. Mixing the mic with the
// tab's sound then needs a click, so the recording must start from one.
export async function isMicrophonePermissionUndecided(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({
      name: "microphone" as PermissionName,
    })
    return status.state === "prompt"
  } catch {
    // Unknown support: keep starting automatically, as before.
    return false
  }
}
