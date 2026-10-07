const PREFERRED_MIME_TYPES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm;codecs=opus",
  "video/webm",
]

export const createWebmRecorder = (stream: MediaStream): MediaRecorder => {
  const mimeType =
    PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ??
    ""
  return new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
}
