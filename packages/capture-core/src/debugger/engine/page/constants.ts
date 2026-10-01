export const PAGE_SOURCE = "CRIKKET_DEBUGGER_PAGE_BRIDGE"
// Messages from the extension bridge to this page script.
export const PAGE_CONTROL_SOURCE = "CRIKKET_DEBUGGER_PAGE_CONTROL"
// DOM event that carries page events to the extension bridge. Unlike
// postMessage it is delivered right away, so events flushed while the page
// unloads are not lost.
export const PAGE_EVENTS_EVENT = "crikket-debugger-page-events"
export const INSTALL_FLAG = "__crikketDebuggerPageScriptInstalled"

export const MAX_TEXT_LENGTH = 2000
export const MAX_BODY_LENGTH = 4000
export const MAX_HEADER_NAME_LENGTH = 120
export const MAX_HEADER_VALUE_LENGTH = 500

export const MAX_BATCH_SIZE = 40
export const FLUSH_INTERVAL_MS = 120

export const MAX_SERIALIZE_DEPTH = 4
export const MAX_SERIALIZE_KEYS = 30
export const MAX_SERIALIZE_ARRAY_ITEMS = 30
