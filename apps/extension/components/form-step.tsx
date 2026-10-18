import {
  PRIORITY_OPTIONS,
  type Priority,
} from "@crikket/shared/constants/priorities"
import { Button } from "@crikket/ui/components/ui/button"
import { Field, FieldError, FieldLabel } from "@crikket/ui/components/ui/field"
import { Input } from "@crikket/ui/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@crikket/ui/components/ui/select"
import { Textarea } from "@crikket/ui/components/ui/textarea"
import { cn } from "@crikket/ui/lib/utils"
import { useForm } from "@tanstack/react-form"
import { AlertTriangle, Globe, MousePointerClick, Terminal } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import * as z from "zod"
import { DiscardConfirm } from "@/components/close-review-button"
import { BRAND_BUTTON_CLASS } from "@/lib/brand"

const priorityValues = Object.values(PRIORITY_OPTIONS) as [
  Priority,
  ...Priority[],
]

const formSchema = z.object({
  title: z.string().max(200, "Title must be at most 200 characters."),
  description: z
    .string()
    .max(3000, "Description must be at most 3000 characters."),
  priority: z.enum(priorityValues),
})

interface DebuggerSummary {
  actions: number
  logs: number
  networkRequests: number
}

interface FormStepProps {
  // The capture with its trim bar or edit button, shown above the form.
  preview: ReactNode
  // What is being reported, for the discard question: "recording" or "screenshot".
  captureLabel: string
  initialTitle: string
  isSubmitting: boolean
  submitError: string | null
  preSubmitWarnings: string[]
  debuggerSummary: DebuggerSummary
  onSubmit: (values: {
    title: string
    description: string
    priority: Priority
  }) => void
  onCancel: () => void
}

interface FormValues {
  title: string
  description: string
  priority: Priority
}

export function FormStep({
  preview,
  captureLabel,
  initialTitle,
  isSubmitting,
  submitError,
  preSubmitWarnings,
  debuggerSummary,
  onSubmit,
  onCancel,
}: FormStepProps) {
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false)
  const defaultValues: FormValues = {
    title: initialTitle,
    description: "",
    priority: PRIORITY_OPTIONS.none,
  }

  const form = useForm({
    defaultValues,
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit({
        title: value.title,
        description: value.description,
        priority: value.priority,
      })
    },
  })

  const isBusy = isSubmitting || form.state.isSubmitting

  // The suggested title improves once the recording's logs are read; follow it
  // until the user types their own.
  const appliedTitleRef = useRef(initialTitle)
  useEffect(() => {
    const currentTitle = form.state.values.title
    if (
      initialTitle &&
      (!currentTitle || currentTitle === appliedTitleRef.current)
    ) {
      form.setFieldValue("title", initialTitle)
      appliedTitleRef.current = initialTitle
    }
  }, [form, initialTitle])

  const fieldError = (meta: { isTouched: boolean; errors: unknown[] }) =>
    meta.isTouched && meta.errors.length > 0

  return (
    <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col p-5 lg:min-h-0 lg:px-6">
        {preview}
      </div>

      <form
        className="flex flex-col gap-4 border-t p-5 lg:overflow-y-auto lg:border-t-0 lg:border-l lg:px-6"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          form.handleSubmit()
        }}
      >
        <form.Field name="title">
          {(field) => {
            const isInvalid = fieldError(field.state.meta)
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Title</FieldLabel>
                <Input
                  aria-invalid={isInvalid}
                  className="h-9"
                  id={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="What went wrong?"
                  value={field.state.value}
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        <form.Field name="description">
          {(field) => {
            const isInvalid = fieldError(field.state.meta)
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>
                  Description
                  <span className="font-normal text-muted-foreground/70">
                    optional
                  </span>
                </FieldLabel>
                <Textarea
                  aria-invalid={isInvalid}
                  className="min-h-[88px] resize-none"
                  id={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Steps, what you expected, anything that helps..."
                  rows={4}
                  value={field.state.value}
                />
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        <form.Field name="priority">
          {(field) => {
            const isInvalid = fieldError(field.state.meta)
            return (
              <Field data-invalid={isInvalid}>
                <FieldLabel htmlFor={field.name}>Priority</FieldLabel>
                <Select
                  onValueChange={(value) => {
                    if (value) {
                      field.handleChange(value as Priority)
                    }
                  }}
                  value={field.state.value}
                >
                  <SelectTrigger
                    aria-invalid={isInvalid}
                    className="h-9 w-full"
                    id={field.name}
                  >
                    <SelectValue className="capitalize" />
                  </SelectTrigger>
                  <SelectContent>
                    {priorityValues.map((priority) => (
                      <SelectItem key={priority} value={priority}>
                        {formatPriorityLabel(priority)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {isInvalid && <FieldError errors={field.state.meta.errors} />}
              </Field>
            )
          }}
        </form.Field>

        <CapturedDataSummary summary={debuggerSummary} />

        {preSubmitWarnings.length > 0 ? (
          <div className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-amber-800 text-xs leading-relaxed">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="space-y-1">
              {preSubmitWarnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          </div>
        ) : null}

        {submitError ? (
          <div
            className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2"
            role="alert"
          >
            <p className="text-red-800 text-xs leading-relaxed">
              {submitError}
            </p>
          </div>
        ) : null}

        <div className="relative flex flex-col gap-1 pt-1">
          <Button
            className={cn("h-10 w-full", BRAND_BUTTON_CLASS)}
            disabled={isBusy}
            type="submit"
          >
            {isBusy ? "Creating report..." : "Create bug report"}
          </Button>
          <Button
            className="w-full text-muted-foreground"
            disabled={isBusy}
            onClick={() => setIsConfirmingCancel(true)}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          {isConfirmingCancel ? (
            <DiscardConfirm
              captureLabel={captureLabel}
              className="right-0 bottom-full left-0 mx-auto mb-2"
              onDiscard={() => {
                form.reset()
                onCancel()
              }}
              onKeep={() => setIsConfirmingCancel(false)}
            />
          ) : null}
        </div>
      </form>
    </div>
  )
}

const CAPTURED_DATA_STATS: {
  key: keyof DebuggerSummary
  one: string
  many: string
  icon: typeof Terminal
}[] = [
  { key: "actions", one: "action", many: "actions", icon: MousePointerClick },
  { key: "logs", one: "log", many: "logs", icon: Terminal },
  { key: "networkRequests", one: "request", many: "requests", icon: Globe },
]

// What the report carries besides the capture: steps, console and network.
// Only what was captured; the warning says what is missing.
function CapturedDataSummary({ summary }: { summary: DebuggerSummary }) {
  const captured = CAPTURED_DATA_STATS.filter(({ key }) => summary[key] > 0)
  if (captured.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="font-medium text-sm">Attached</p>
      <div className="flex flex-wrap gap-1.5">
        {captured.map(({ key, one, many, icon: Icon }) => (
          <span
            className="inline-flex h-[26px] items-center gap-1.5 rounded-md border px-2 text-[11.5px] text-muted-foreground"
            key={key}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className="font-semibold text-foreground tabular-nums">
              {summary[key]}
            </span>
            {summary[key] === 1 ? one : many}
          </span>
        ))}
      </div>
    </div>
  )
}

function formatPriorityLabel(priority: Priority): string {
  return `${priority.charAt(0).toUpperCase()}${priority.slice(1)}`
}
