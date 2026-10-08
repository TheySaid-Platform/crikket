import type {
  DebuggerSessionSnapshot,
  RecordingPause,
} from "@crikket/capture-core/debugger/types"
import type { FullPageEnding } from "@/lib/full-page-screenshot"

// Too large for chrome.storage. The offscreen recorder and the review share
// this database because they run on the same origin.
const DB_NAME = "crikket-recordings"
const STORE_NAME = "recordings"

export interface StoredRecording {
  blob: Blob
  durationMs: number
  startedAt: number
  stoppedAt: number
  pauses: RecordingPause[]
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function runTransaction<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T> | undefined
): Promise<T | undefined> {
  const db = await openDatabase()
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode)
      const request = run(transaction.objectStore(STORE_NAME))
      transaction.oncomplete = () => resolve(request?.result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } finally {
    db.close()
  }
}

/** Keeps only the newest recording, keyed by its debugger session id. */
export async function saveRecording(
  sessionId: string,
  recording: StoredRecording
): Promise<void> {
  await runTransaction("readwrite", (store) => {
    store.clear()
    return store.put(recording, sessionId)
  })
}

export async function loadRecording(
  sessionId: string
): Promise<StoredRecording | null> {
  const recording = await runTransaction<StoredRecording>("readonly", (store) =>
    store.get(sessionId)
  )
  return recording ?? null
}

/** How a full-page screenshot went, for its review. */
export interface FullPageDetails {
  screens: number
  ending: FullPageEnding
  // Image pixels per page pixel; missing in screenshots from older versions.
  scale?: number
}

export interface StoredScreenshot {
  image: Blob
  // Set for full-page screenshots.
  fullPage: FullPageDetails | null
}

/** Screenshots share the store: only the newest capture is kept. */
export async function saveScreenshot(
  sessionId: string,
  image: Blob,
  fullPage: FullPageDetails | null = null
): Promise<void> {
  await runTransaction("readwrite", (store) => {
    store.clear()
    return store.put({ image, fullPage }, sessionId)
  })
}

export async function loadScreenshot(
  sessionId: string
): Promise<StoredScreenshot | null> {
  const entry = await runTransaction<{ image?: unknown; fullPage?: unknown }>(
    "readonly",
    (store) => store.get(sessionId)
  )
  if (!(entry?.image instanceof Blob)) return null
  return {
    image: entry.image,
    fullPage: (entry.fullPage as FullPageDetails | null | undefined) ?? null,
  }
}

const LOGS_SUFFIX = ":logs"
const logsBackupKey = (sessionId: string) => `${sessionId}${LOGS_SUFFIX}`

// A copy of the capture's logs, in case the worker loses the live session.
// Saved after the capture, because saving a capture clears the store.
export async function saveLogsBackup(
  sessionId: string,
  snapshot: DebuggerSessionSnapshot
): Promise<void> {
  await runTransaction("readwrite", (store) =>
    store.put(snapshot, logsBackupKey(sessionId))
  )
}

export async function loadLogsBackup(
  sessionId: string
): Promise<DebuggerSessionSnapshot | null> {
  const snapshot = await runTransaction<DebuggerSessionSnapshot>(
    "readonly",
    (store) => store.get(logsBackupKey(sessionId))
  )
  return snapshot ?? null
}

/** The debugger session ids that have a capture or a logs copy stored. */
export async function listStoredCaptureIds(): Promise<string[]> {
  const keys = await runTransaction<IDBValidKey[]>("readonly", (store) =>
    store.getAllKeys()
  )
  const ids = new Set<string>()
  for (const key of keys ?? []) {
    if (typeof key === "string") {
      ids.add(
        key.endsWith(LOGS_SUFFIX) ? key.slice(0, -LOGS_SUFFIX.length) : key
      )
    }
  }
  return [...ids]
}

/** Removes a stored capture and its logs once its report is sent or dropped. */
export async function deleteRecording(sessionId: string): Promise<void> {
  await runTransaction("readwrite", (store) => {
    store.delete(logsBackupKey(sessionId))
    return store.delete(sessionId)
  })
}
