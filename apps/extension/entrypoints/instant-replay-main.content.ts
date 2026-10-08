import { defineContentScript } from "wxt/utils/define-content-script"
import { startReplayRecorder } from "@/lib/instant-replay/page-recorder"

// Registered by the background only while instant replay is on.
export default defineContentScript({
  matches: ["<all_urls>"],
  world: "MAIN",
  registration: "runtime",
  main() {
    startReplayRecorder()
  },
})
