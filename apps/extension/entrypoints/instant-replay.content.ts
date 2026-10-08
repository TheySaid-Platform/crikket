import { defineContentScript } from "wxt/utils/define-content-script"
import { startReplayBridge } from "@/lib/instant-replay/page-bridge"

// Registered by the background only while instant replay is on.
export default defineContentScript({
  matches: ["<all_urls>"],
  registration: "runtime",
  main() {
    startReplayBridge()
  },
})
