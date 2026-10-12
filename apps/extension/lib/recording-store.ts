import type {
  DebuggerSessionSnapshot,
  RecordingPause,
} from "@crikket/capture-core/debugger/types"
import type { CaptureContext } from "@/lib/capture-context"
import type { FullPageEnding } from "@/lib/full-page-screenshot"
import type { ScreenshotEdits } from "@/lib/screenshot-annotations"
import type { VideoEdits } from "@/lib/video-edit"

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

// Kept next to a capture under its session id plus one of these.
const LOGS_SUFFIX = ":logs"
const EDITS_SUFFIX = ":edits"
const CONTEXT_SUFFIX = ":context"
const EXTRA_SUFFIXES = [LOGS_SUFFIX, EDITS_SUFFIX, CONTEXT_SUFFIX]

function putExtra(sessionId: string, suffix: string, value: unknown) {
  return runTransaction("readwrite", (store) =>
    store.put(value, `${sessionId}${suffix}`)
  )
}

async function getExtra<T>(sessionId: string, suffix: string) {
  const value = await runTransaction<T>("readonly", (store) =>
    store.get(`${sessionId}${suffix}`)
  )
  return value ?? null
}

// A copy of the capture's logs, in case the worker loses the live session.
// Saved after the capture, because saving a capture clears the store.
export async function saveLogsBackup(
  sessionId: string,
  snapshot: DebuggerSessionSnapshot
): Promise<void> {
  await putExtra(sessionId, LOGS_SUFFIX, snapshot)
}

export function loadLogsBackup(
  sessionId: string
): Promise<DebuggerSessionSnapshot | null> {
  return getExtra<DebuggerSessionSnapshot>(sessionId, LOGS_SUFFIX)
}

/** The edits made in a review, so a review opened again keeps them. */
export interface SavedCaptureEdits {
  videoEdits: VideoEdits | null
  screenshotEdits: ScreenshotEdits | null
  editedScreenshot: Blob | null
}

export async function saveCaptureEdits(
  sessionId: string,
  edits: SavedCaptureEdits | null
): Promise<void> {
  const key = `${sessionId}${EDITS_SUFFIX}`
  await runTransaction("readwrite", (store) => {
    if (edits) store.put(edits, key)
    else store.delete(key)
    return undefined
  })
}

export function loadCaptureEdits(
  sessionId: string
): Promise<SavedCaptureEdits | null> {
  return getExtra<SavedCaptureEdits>(sessionId, EDITS_SUFFIX)
}

// The page the capture was taken on. The review reads it once from
// chrome.storage, so a review opened again finds it here.
export async function saveCaptureContext(
  sessionId: string,
  context: CaptureContext
): Promise<void> {
  await putExtra(sessionId, CONTEXT_SUFFIX, context)
}

export function loadCaptureContext(
  sessionId: string
): Promise<CaptureContext | null> {
  return getExtra<CaptureContext>(sessionId, CONTEXT_SUFFIX)
}

/** The debugger session ids that have anything stored. */
export async function listStoredCaptureIds(): Promise<string[]> {
  const keys = await runTransaction<IDBValidKey[]>("readonly", (store) =>
    store.getAllKeys()
  )
  const ids = new Set<string>()
  for (const key of keys ?? []) {
    if (typeof key !== "string") continue
    const suffix = EXTRA_SUFFIXES.find((extra) => key.endsWith(extra))
    ids.add(suffix ? key.slice(0, -suffix.length) : key)
  }
  return [...ids]
}

/** Removes a capture and all kept with it once its report is sent or dropped. */
export async function deleteRecording(sessionId: string): Promise<void> {
  await runTransaction("readwrite", (store) => {
    for (const suffix of EXTRA_SUFFIXES) {
      store.delete(`${sessionId}${suffix}`)
    }
    return store.delete(sessionId)
  })
}
