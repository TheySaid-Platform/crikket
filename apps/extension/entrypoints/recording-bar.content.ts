import { defineContentScript } from "wxt/utils/define-content-script"
import { startRecordingBar } from "@/lib/recording-bar"

export default defineContentScript({
  matches: ["<all_urls>"],
  // Start with the page instead of after it finishes loading, so the floating
  // bar shows at once on heavy pages and right after every navigation.
  runAt: "document_start",
  main() {
    startRecordingBar()
  },
})
