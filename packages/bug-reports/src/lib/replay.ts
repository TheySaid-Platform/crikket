import { ORPCError } from "@orpc/server"
import type { StorageProvider } from "./storage"

// A 6-minute replay is a few MB gzipped. A bigger file is refused instead of
// being read into memory.
export const MAX_REPLAY_BYTES = 32 * 1024 * 1024

/**
 * The stored replay of a report, as it was uploaded (gzipped JSON). The
 * server never unpacks it: the browser does, so a file that unpacks to
 * something huge cannot tie up the server.
 */
export async function readReplayFile(
  report: { attachmentType: string | null; captureKey: string | null } | null,
  storage: Pick<StorageProvider, "size" | "read">
): Promise<File> {
  if (!(report?.attachmentType === "replay" && report.captureKey)) {
    throw new ORPCError("NOT_FOUND", { message: "Replay not found" })
  }

  const size = await storage.size(report.captureKey)
  if (size === null) {
    throw new ORPCError("NOT_FOUND", { message: "Replay not found" })
  }
  if (size > MAX_REPLAY_BYTES) {
    throw new ORPCError("PAYLOAD_TOO_LARGE", {
      message: "This replay is too large to show.",
    })
  }

  const stored = await storage.read(report.captureKey)
  return new File([new Uint8Array(stored)], "replay.json.gz", {
    type: "application/gzip",
  })
}
