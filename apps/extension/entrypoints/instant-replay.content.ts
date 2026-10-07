import { defineContentScript } from "wxt/utils/define-content-script"
import { startInstantReplayBuffer } from "@/lib/instant-replay/page-buffer"

export default defineContentScript({
  matches: ["<all_urls>"],
  main() {
    startInstantReplayBuffer()
  },
})
