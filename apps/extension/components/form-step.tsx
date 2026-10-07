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
import { type ReactNode, useEffect, useRef } from "react"
import * as z from "zod"
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
  initialTitle,
  isSubmitting,
  submitError,
  preSubmitWarnings,
  debuggerSummary,
  onSubmit,
  onCancel,
}: FormStepProps) {
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

  // Jam-style layout: the capture on the left, the report on the right.
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-8">
      <div className="min-w-0">{preview}</div>

      <form
        className="flex flex-col gap-5 rounded-2xl border border-border/60 bg-slate-50/80 p-4 lg:p-5"
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
                  className="h-10"
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
                  <span className="font-normal text-muted-foreground">
                    (optional)
                  </span>
                </FieldLabel>
                <Textarea
                  aria-invalid={isInvalid}
                  className="min-h-28 resize-none"
                  id={field.name}
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.target.value)}
                  placeholder="Steps, what you expected, anything that helps..."
                  rows={5}
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
                    className="h-10 w-full"
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
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="flex items-center gap-2 font-medium text-amber-800 text-sm">
              <AlertTriangle className="h-4 w-4" />
              Before you submit
            </p>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-amber-800 text-xs">
              {preSubmitWarnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {submitError ? (
          <div
            className="rounded-xl border border-destructive/30 bg-destructive/10 p-3"
            role="alert"
          >
            <p className="text-destructive text-sm">{submitError}</p>
          </div>
        ) : null}

        <div className="mt-auto flex flex-col gap-2 pt-1">
          <Button
            className={cn("w-full", BRAND_BUTTON_CLASS)}
            disabled={isBusy}
            size="lg"
            type="submit"
          >
            {isBusy ? "Creating report..." : "Create bug report"}
          </Button>
          <Button
            className="w-full text-muted-foreground"
            disabled={isBusy}
            onClick={() => {
              form.reset()
              onCancel()
            }}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}

const CAPTURED_DATA_STATS: {
  key: keyof DebuggerSummary
  label: string
  icon: typeof Terminal
  tone: string
}[] = [
  {
    key: "actions",
    label: "Actions",
    icon: MousePointerClick,
    tone: "bg-violet-100 text-violet-600",
  },
  {
    key: "logs",
    label: "Logs",
    icon: Terminal,
    tone: "bg-amber-100 text-amber-600",
  },
  {
    key: "networkRequests",
    label: "Requests",
    icon: Globe,
    tone: "bg-sky-100 text-sky-600",
  },
]

// What the report carries besides the capture: steps, console and network.
function CapturedDataSummary({ summary }: { summary: DebuggerSummary }) {
  return (
    <div className="rounded-xl border border-border/60 bg-background p-3 shadow-xs">
      <p className="mb-2 font-medium text-muted-foreground text-xs">
        Attached to this report
      </p>
      <div className="grid grid-cols-3 gap-2">
        {CAPTURED_DATA_STATS.map(({ key, label, icon: Icon, tone }) => (
          <div
            className="flex flex-col items-center gap-1 px-2 py-1 text-center"
            key={key}
          >
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg",
                tone
              )}
            >
              <Icon className="h-4 w-4" />
            </span>
            <p className="font-semibold text-sm tabular-nums">{summary[key]}</p>
            <p className="text-[11px] text-muted-foreground">{label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatPriorityLabel(priority: Priority): string {
  return `${priority.charAt(0).toUpperCase()}${priority.slice(1)}`
}
