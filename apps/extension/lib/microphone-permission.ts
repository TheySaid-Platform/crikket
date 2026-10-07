/**
 * True when Chrome has not asked for the microphone yet. A page only gets to
 * mix the mic with the tab's sound if it was clicked, or if the mic was already
 * allowed when it loaded, so a recording that will trigger the prompt has to
 * start from a click.
 */
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
