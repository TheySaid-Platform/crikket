import { useEffect, useState } from "react"
import {
  INSTANT_REPLAY_ENABLED_STORAGE_KEY,
  INSTANT_REPLAY_MESSAGE,
  INSTANT_REPLAY_VIDEO_STORAGE_KEY,
  type ReplayVideoSource,
  type ReplayVideoState,
} from "@/lib/instant-replay/protocol"

// Where the video of the replay comes from, as seen from the current tab.
export type ReplayVideoStatus = "this-tab" | "screen" | "other-tab" | "off"

export interface InstantReplayControls {
  isEnabled: boolean
  isSaving: boolean
  isStartingVideo: boolean
  videoStatus: ReplayVideoStatus
  error: string | null
  setEnabled: (value: boolean) => void
  startVideo: (source: ReplayVideoSource) => void
  stopVideo: () => void
  save: () => void
}

interface CommandResponse {
  ok?: boolean
  error?: string
}

async function sendCommand(message: object, fallbackError: string) {
  const response = (await chrome.runtime.sendMessage(message)) as
    | CommandResponse
    | undefined
  if (!response?.ok) {
    throw new Error(response?.error ?? fallbackError)
  }
}

async function getActiveTabId(): Promise<number | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return typeof tab?.id === "number" ? tab.id : null
}

function getVideoStatus(
  video: ReplayVideoState | null,
  activeTabId: number | null
): ReplayVideoStatus {
  if (!video) return "off"
  if (video.source === "display") return "screen"
  return video.tabId === activeTabId ? "this-tab" : "other-tab"
}

const toMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback

/** The instant replay setting, its video, and saving a replay of this tab. */
export function useInstantReplay(): InstantReplayControls {
  const [isEnabled, setIsEnabled] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isStartingVideo, setIsStartingVideo] = useState(false)
  const [video, setVideo] = useState<ReplayVideoState | null>(null)
  const [activeTabId, setActiveTabId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    chrome.storage.local
      .get(INSTANT_REPLAY_ENABLED_STORAGE_KEY)
      .then((result) => {
        setIsEnabled(result[INSTANT_REPLAY_ENABLED_STORAGE_KEY] === true)
      })
      .catch(() => undefined)
    chrome.storage.session
      .get(INSTANT_REPLAY_VIDEO_STORAGE_KEY)
      .then((result) => {
        setVideo(
          (result[INSTANT_REPLAY_VIDEO_STORAGE_KEY] as
            | ReplayVideoState
            | undefined) ?? null
        )
      })
      .catch(() => undefined)
    getActiveTabId()
      .then(setActiveTabId)
      .catch(() => undefined)

    const onChanged = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string
    ) => {
      const change = changes[INSTANT_REPLAY_VIDEO_STORAGE_KEY]
      if (areaName === "session" && change) {
        setVideo((change.newValue as ReplayVideoState | undefined) ?? null)
      }
    }
    chrome.storage.onChanged.addListener(onChanged)
    return () => chrome.storage.onChanged.removeListener(onChanged)
  }, [])

  const startVideo = async (source: ReplayVideoSource, isAutomatic = false) => {
    setIsStartingVideo(true)
    setError(null)
    try {
      await sendCommand(
        {
          type: INSTANT_REPLAY_MESSAGE.videoStart,
          source,
          tabId: await getActiveTabId(),
        },
        "Could not start the video."
      )
    } catch (startError) {
      // Turning instant replay on also tries this tab's video; a browser
      // page cannot have one, and the page replay still works there.
      if (!isAutomatic) {
        setError(toMessage(startError, "Could not start the video."))
      }
    } finally {
      setIsStartingVideo(false)
    }
  }

  const setEnabled = (value: boolean) => {
    setIsEnabled(value)
    setError(null)
    chrome.storage.local
      .set({ [INSTANT_REPLAY_ENABLED_STORAGE_KEY]: value })
      .then(() => (value ? startVideo("tab", true) : undefined))
      .catch(() => {
        setIsEnabled(!value)
        setError("Could not change the instant replay setting.")
      })
  }

  const save = async () => {
    setIsSaving(true)
    setError(null)
    try {
      await sendCommand(
        { type: INSTANT_REPLAY_MESSAGE.save, tabId: await getActiveTabId() },
        "Could not save the replay."
      )
      // The review opens over the page.
      window.close()
    } catch (saveError) {
      setError(toMessage(saveError, "Could not save the replay."))
      setIsSaving(false)
    }
  }

  const stopVideo = () => {
    setError(null)
    sendCommand(
      { type: INSTANT_REPLAY_MESSAGE.videoStop },
      "Could not stop the video."
    ).catch((stopError: unknown) => {
      setError(toMessage(stopError, "Could not stop the video."))
    })
  }

  return {
    isEnabled,
    isSaving,
    isStartingVideo,
    videoStatus: getVideoStatus(video, activeTabId),
    error,
    setEnabled,
    startVideo: (source) => {
      startVideo(source).catch(() => undefined)
    },
    stopVideo,
    save: () => {
      save().catch(() => undefined)
    },
  }
}
