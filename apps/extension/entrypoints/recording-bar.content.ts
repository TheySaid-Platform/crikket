import { defineContentScript } from "wxt/utils/define-content-script"
import { startRecordingBar } from "@/lib/recording-bar"

// Not in the manifest: the background injects it only into the pages that show
// the floating bar or the review (ensurePageScript in background.ts).
export default defineContentScript({
  matches: ["<all_urls>"],
  registration: "runtime",
  main() {
    startRecordingBar()
  },
})
