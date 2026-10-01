import { installDebuggerPageRuntime } from "@crikket/capture-core/debugger/engine/page"
import { defineContentScript } from "wxt/utils/define-content-script"

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  world: "MAIN",
  main() {
    installDebuggerPageRuntime()
  },
})
