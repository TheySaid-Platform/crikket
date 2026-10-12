import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises"
import { join } from "node:path"

const REPORT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const FRAMES_INDEX = "frames.json"

interface MediaCacheOptions {
  rootDir: string
  maxBytes: number
  maxAgeMs: number
  now?: () => number
}

export interface CachedFrame {
  frameMs: number | null
}

/**
 * Per-pod temp-disk cache of downloaded videos and cut frames, so the AI
 * asking about the same report again in a session does not download or
 * decode it again. Entries are whole report folders; the least recently used
 * go first once the cache passes its size cap or age limit.
 */
export class MediaCache {
  private readonly locks = new Map<string, Promise<unknown>>()
  private readonly options: MediaCacheOptions

  constructor(options: MediaCacheOptions) {
    this.options = options
  }

  reportDir(reportId: string): string {
    if (!REPORT_ID_PATTERN.test(reportId)) {
      throw new Error("Invalid report id for media cache")
    }
    return join(this.options.rootDir, reportId)
  }

  /** Runs `task` with no other cache work for the same report in between. */
  withReportLock<T>(reportId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(reportId) ?? Promise.resolve()
    const run = previous.then(task, task)
    const settled = run.then(
      () => undefined,
      () => undefined
    )
    this.locks.set(reportId, settled)
    settled.then(() => {
      if (this.locks.get(reportId) === settled) {
        this.locks.delete(reportId)
      }
    })
    return run
  }

  async touch(reportId: string): Promise<void> {
    const dir = this.reportDir(reportId)
    await mkdir(dir, { recursive: true })
    const now = new Date(this.now())
    await utimes(dir, now, now)
  }

  async readFile(reportId: string, name: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(
        await readFile(join(this.reportDir(reportId), name))
      )
    } catch {
      return null
    }
  }

  async hasFile(reportId: string, name: string): Promise<boolean> {
    try {
      await stat(join(this.reportDir(reportId), name))
      return true
    } catch {
      return false
    }
  }

  /** Writes through a temp name so a crash never leaves half a file. */
  async writeFile(
    reportId: string,
    name: string,
    data: Uint8Array
  ): Promise<string> {
    const dir = this.reportDir(reportId)
    await mkdir(dir, { recursive: true })
    const path = join(dir, name)
    const temporary = `${path}.${process.pid}.partial`
    await writeFile(temporary, data)
    await rename(temporary, path)
    return path
  }

  async readFrameIndex(reportId: string): Promise<Record<string, CachedFrame>> {
    const data = await this.readFile(reportId, FRAMES_INDEX)
    if (!data) {
      return {}
    }
    try {
      return JSON.parse(new TextDecoder().decode(data)) as Record<
        string,
        CachedFrame
      >
    } catch {
      return {}
    }
  }

  async writeFrameIndex(
    reportId: string,
    index: Record<string, CachedFrame>
  ): Promise<void> {
    await this.writeFile(
      reportId,
      FRAMES_INDEX,
      new TextEncoder().encode(JSON.stringify(index))
    )
  }

  /** Drops folders past the age limit, then the oldest until under the cap. */
  async prune(keepReportId?: string): Promise<void> {
    let names: string[]
    try {
      names = await readdir(this.options.rootDir)
    } catch {
      return
    }

    const entries: { name: string; usedAt: number; bytes: number }[] = []
    for (const name of names) {
      const dir = join(this.options.rootDir, name)
      try {
        const info = await stat(dir)
        if (info.isDirectory()) {
          entries.push({
            name,
            usedAt: info.mtimeMs,
            bytes: await folderSize(dir),
          })
        }
      } catch {
        // Removed by another request in the meantime.
      }
    }

    const now = this.now()
    let totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
    const oldestFirst = entries.sort((a, b) => a.usedAt - b.usedAt)

    for (const entry of oldestFirst) {
      if (entry.name === keepReportId) {
        continue
      }
      const expired = now - entry.usedAt > this.options.maxAgeMs
      if (expired || totalBytes > this.options.maxBytes) {
        await rm(join(this.options.rootDir, entry.name), {
          recursive: true,
          force: true,
        })
        totalBytes -= entry.bytes
      }
    }
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}

async function folderSize(dir: string): Promise<number> {
  let total = 0
  for (const name of await readdir(dir)) {
    try {
      total += (await stat(join(dir, name))).size
    } catch {
      // Gone already.
    }
  }
  return total
}
