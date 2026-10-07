import { cn } from "@crikket/ui/lib/utils"
import {
  type CSSProperties,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { AnnotationTextInput } from "@/components/annotation-text-input"
import { AnnotationToolbar } from "@/components/annotation-toolbar"
import { EditorFooter } from "@/components/editor-footer"
import { PageCutStrip } from "@/components/page-cut-strip"
import { useAnnotationDrawing } from "@/hooks/use-annotation-drawing"
import { useUndoable } from "@/hooks/use-undoable"
import {
  type AnnotationTool,
  DEFAULT_ANNOTATION_COLOR,
  fontSizeFor,
  type Point,
} from "@/lib/annotations"
import type { PixelRect } from "@/lib/pixelate"
import {
  EMPTY_SCREENSHOT_EDITS,
  exportScreenshot,
  renderScreenshot,
  type ScreenshotEdits,
} from "@/lib/screenshot-annotations"

const SCREENSHOT_TOOLS: AnnotationTool[] = [
  "pen",
  "line",
  "arrow",
  "rect",
  "marker",
  "text",
  "blur",
  "crop",
]
const MIN_SHAPE_PX = 4
// Taller than this (height / width), a screenshot is shown at full width and
// scrolls, instead of being shrunk to a strip too thin to draw on.
const TALL_RATIO = 1.5

const TOOL_HINTS: Partial<Record<AnnotationTool, string>> = {
  crop: "Drag to choose the area to keep.",
  blur: "Drag over anything private (emails, tokens, customer data).",
  text: "Click where the text should go, type it, then press Enter.",
  marker: "Drag over something to highlight it.",
}
const DEFAULT_HINT =
  "Drag on the screenshot to draw. Tip: each tool has a letter shortcut."

// A long screenshot scrolls in a fixed-height view with the cut strip beside
// it. A capture of a wide panel can be long without being tall.
function isTallImage(
  image: ImageBitmap | null,
  isLongScreenshot: boolean
): boolean {
  if (!image) return false
  return isLongScreenshot || image.height > image.width * TALL_RATIO
}

// A long screenshot shows at the size it had on the page. Stretched to the
// editor's width, a narrow panel (like a ClickUp chat) looks zoomed in.
function getCanvasStyle(
  isTall: boolean,
  image: ImageBitmap | null,
  pixelRatio: number | undefined
): CSSProperties | undefined {
  if (!(isTall && image)) return undefined
  const ratio = pixelRatio ?? window.devicePixelRatio
  return { width: `${image.width / ratio}px` }
}

interface ScreenshotEditorProps {
  sourceBlob: Blob
  // Image pixels per CSS pixel of the page, so a long screenshot shows at the
  // size it had on the page. Defaults to the screen's pixel ratio.
  pixelRatio?: number
  isLongScreenshot?: boolean
  initialEdits: ScreenshotEdits | null
  onApply: (result: { blob: Blob; edits: ScreenshotEdits } | null) => void
  onCancel: () => void
}

export function ScreenshotEditor({
  sourceBlob,
  pixelRatio,
  isLongScreenshot = false,
  initialEdits,
  onApply,
  onCancel,
}: ScreenshotEditorProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  // The crop a cut-strip handle would make while it is being dragged
  // (null keeps the whole page); undefined when no handle is moving.
  const [cutPreview, setCutPreview] = useState<PixelRect | null | undefined>(
    undefined
  )
  const sourceUrl = useMemo(() => URL.createObjectURL(sourceBlob), [sourceBlob])
  useEffect(() => () => URL.revokeObjectURL(sourceUrl), [sourceUrl])
  const [image, setImage] = useState<ImageBitmap | null>(null)
  const [tool, setTool] = useState<AnnotationTool>("arrow")
  const [color, setColor] = useState(DEFAULT_ANNOTATION_COLOR)
  const edits = useUndoable<ScreenshotEdits>(
    initialEdits ?? EMPTY_SCREENSHOT_EDITS
  )
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { annotations, crop } = edits.value

  useEffect(() => {
    let cancelled = false
    createImageBitmap(sourceBlob)
      .then((bitmap) => {
        if (cancelled) bitmap.close()
        else setImage(bitmap)
      })
      .catch(() => setError("Could not open the screenshot for editing."))
    return () => {
      cancelled = true
    }
  }, [sourceBlob])

  const toImagePoint = (event: PointerEvent<HTMLElement>): Point => {
    const box = event.currentTarget.getBoundingClientRect()
    const canvas = canvasRef.current
    return [
      ((event.clientX - box.left) / box.width) * (canvas?.width ?? 0),
      ((event.clientY - box.top) / box.height) * (canvas?.height ?? 0),
    ]
  }

  const drawing = useAnnotationDrawing({
    tool,
    color,
    disabled: !image || isSaving,
    minSize: MIN_SHAPE_PX,
    toPoint: toImagePoint,
    onCommit: (annotation) =>
      edits.update((current) => ({
        ...current,
        annotations: [...current.annotations, annotation],
      })),
    onCrop: (rect) => edits.update((current) => ({ ...current, crop: rect })),
  })

  useEffect(() => {
    const canvas = canvasRef.current
    if (!(canvas && image)) return
    canvas.width = image.width
    canvas.height = image.height
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    renderScreenshot(
      ctx,
      image,
      drawing.draft ? [...annotations, drawing.draft] : annotations,
      {
        crop:
          drawing.cropDraft ?? (cutPreview === undefined ? crop : cutPreview),
        preview: true,
      }
    )
  }, [annotations, crop, cutPreview, drawing.cropDraft, drawing.draft, image])

  const hasEdits = annotations.length > 0 || crop !== null
  const isTall = isTallImage(image, isLongScreenshot)

  const handleApply = async () => {
    if (!image) return
    if (!hasEdits) {
      onApply(null)
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const blob = await exportScreenshot(image, edits.value)
      onApply({ blob, edits: edits.value })
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save the screenshot."
      )
      setIsSaving(false)
    }
  }

  const canvasCssWidth = canvasRef.current?.getBoundingClientRect().width ?? 0
  const textFontCssPx =
    image && canvasCssWidth > 0
      ? (fontSizeFor(image.width) * canvasCssWidth) / image.width
      : 16

  return (
    <div className="space-y-4">
      <AnnotationToolbar
        canRedo={edits.canRedo}
        canUndo={edits.canUndo}
        color={color}
        onColorChange={setColor}
        onRedo={edits.redo}
        onToolChange={setTool}
        onUndo={edits.undo}
        tool={tool}
        tools={SCREENSHOT_TOOLS}
      >
        {crop ? (
          <button
            className="ml-1 rounded-lg px-2.5 py-1.5 font-medium text-white/80 text-xs transition-colors hover:bg-white/10 hover:text-white"
            onClick={() =>
              edits.update((current) => ({ ...current, crop: null }))
            }
            type="button"
          >
            Remove crop
          </button>
        ) : null}
      </AnnotationToolbar>

      {/* A long screenshot gets a fixed height: the preview scrolls inside it
          and the cut strip beside it is exactly as tall, so both handles and
          the preview stay in view together. */}
      <div className={cn("flex gap-3", isTall && "h-[60vh]")}>
        <div
          className={cn(
            "flex min-w-0 flex-1 justify-center rounded-2xl bg-[length:16px_16px] bg-[radial-gradient(rgba(255,255,255,0.08)_1px,transparent_1px)] bg-zinc-950 p-3 ring-1 ring-border",
            isTall ? "h-full overflow-y-auto" : "overflow-hidden"
          )}
          ref={stageRef}
        >
          <div
            className={cn(
              "relative",
              isTall ? "min-w-0 max-w-full" : "inline-block"
            )}
          >
            <canvas
              className={cn(
                "block cursor-crosshair touch-none rounded-md shadow-2xl",
                isTall ? "h-auto max-w-full" : "max-h-[480px] max-w-full"
              )}
              ref={canvasRef}
              style={getCanvasStyle(isTall, image, pixelRatio)}
              {...drawing.handlers}
            />
            {drawing.pendingText ? (
              <AnnotationTextInput
                color={color}
                fontSize={textFontCssPx}
                onCancel={drawing.cancelText}
                onChange={drawing.setPendingTextValue}
                onCommit={drawing.commitText}
                pending={drawing.pendingText}
              />
            ) : null}
          </div>
        </div>
        {isTall && image ? (
          <PageCutStrip
            // Follows the handle while it is dragged.
            crop={cutPreview === undefined ? crop : cutPreview}
            imageSize={{ width: image.width, height: image.height }}
            imageUrl={sourceUrl}
            onCommit={(next) => {
              setCutPreview(undefined)
              edits.update((current) => ({ ...current, crop: next }))
            }}
            onPreview={setCutPreview}
            onScrollTo={(fraction) => {
              const stage = stageRef.current
              if (stage) {
                stage.scrollTop =
                  fraction * stage.scrollHeight - stage.clientHeight / 2
              }
            }}
          />
        ) : null}
      </div>

      <p className="text-muted-foreground text-xs">
        {isTall
          ? "Drag the green handles on the right to keep only part of the page. "
          : null}
        {TOOL_HINTS[tool] ?? DEFAULT_HINT}
      </p>

      {error ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
          <p className="text-red-500 text-sm">{error}</p>
        </div>
      ) : null}

      <EditorFooter
        applyDisabled={!image}
        applyLabel="Apply edits"
        canClear={hasEdits}
        isBusy={isSaving}
        onApply={handleApply}
        onCancel={onCancel}
        onClear={() => edits.update(() => EMPTY_SCREENSHOT_EDITS)}
      />
    </div>
  )
}
