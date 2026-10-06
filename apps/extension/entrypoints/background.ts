import { reportNonFatalError } from "@crikket/shared/lib/errors"
import { registerDebuggerBackgroundListeners } from "@/lib/bug-report-debugger/engine/background"
import {
  RECORDER_TAB_ID_STORAGE_KEY,
  setRecordingBadge,
} from "@/lib/capture-context"
import { handleRecorderHotkeyCommand } from "@/lib/recorder-hotkey-commands"

export default defineBackground(() => {
  registerDebuggerBackgroundListeners()

  chrome.commands.onCommand.addListener((command) => {
    handleRecorderHotkeyCommand(command).catch(async (error: unknown) => {
      reportNonFatalError("Failed to execute recorder hotkey command", error)
      try {
        await chrome.action.openPopup()
      } catch (openPopupError) {
        reportNonFatalError(
          "Failed to open popup after hotkey failure",
          openPopupError
        )
      }
    })
  })

  // A recorder tab closed mid-recording cannot clear its own badge.
  chrome.tabs.onRemoved.addListener(async (tabId) => {
    try {
      const stored = await chrome.storage.local.get(RECORDER_TAB_ID_STORAGE_KEY)
      if (stored[RECORDER_TAB_ID_STORAGE_KEY] === tabId) {
        await setRecordingBadge(null)
      }
    } catch (error: unknown) {
      reportNonFatalError("Failed to clear recording badge", error)
    }
  })
})
