import type { ReplayEvents } from "@crikket/ui/components/replay-player"

// A 6-minute replay unpacks to some tens of MB. A file that unpacks to much
// more is refused, so a crafted one cannot hang the page.
export const MAX_REPLAY_JSON_BYTES = 256 * 1024 * 1024

/** The events of a stored replay: gzipped JSON, unpacked in the browser. */
export async function readReplayFile(
  file: Blob,
  maxBytes = MAX_REPLAY_JSON_BYTES
): Promise<ReplayEvents> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer())
  const isGzip = head[0] === 0x1f && head[1] === 0x8b
  const stream = isGzip
    ? file.stream().pipeThrough(new DecompressionStream("gzip"))
    : file.stream()

  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let json = ""
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error("This replay is too large to show.")
    }
    json += decoder.decode(value, { stream: true })
  }
  return JSON.parse(json + decoder.decode()) as ReplayEvents
}
