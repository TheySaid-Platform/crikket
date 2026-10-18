"use client"

import {
  DEFAULT_MCP_ACCESS_KEY_EXPIRY,
  MCP_ACCESS_KEY_NAME_MAX_LENGTH,
  type McpAccessKeyExpiry,
} from "@crikket/shared/constants/mcp"
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
import { useForm } from "@tanstack/react-form"

import { mcpAccessKeyCreateFormSchema } from "@/lib/schema/settings"

type Expiry = McpAccessKeyExpiry

const EXPIRY_LABELS: Record<Expiry, string> = {
  "30d": "30 days",
  "90d": "90 days",
  "365d": "1 year",
}

interface McpAccessKeyCreateFormProps {
  isPending: boolean
  onSubmit: (input: { name: string; expiry: Expiry }) => Promise<void>
}

export function McpAccessKeyCreateForm({
  isPending,
  onSubmit,
}: McpAccessKeyCreateFormProps) {
  const form = useForm({
    defaultValues: {
      name: "",
      expiry: DEFAULT_MCP_ACCESS_KEY_EXPIRY as Expiry,
    },
    validators: {
      onChange: mcpAccessKeyCreateFormSchema,
    },
    onSubmit: async ({ value }) => {
      await onSubmit({ name: value.name.trim(), expiry: value.expiry })
    },
  })

  return (
    <form
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        form.handleSubmit()
      }}
    >
      <form.Field name="name">
        {(field) => {
          const isInvalid =
            field.state.meta.isTouched && field.state.meta.errors.length > 0

          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>Name</FieldLabel>
              <Input
                aria-invalid={isInvalid}
                autoComplete="off"
                id={field.name}
                maxLength={MCP_ACCESS_KEY_NAME_MAX_LENGTH}
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.target.value)}
                placeholder="claude-code-laptop"
                value={field.state.value}
              />
              {isInvalid ? (
                <FieldError errors={field.state.meta.errors} />
              ) : null}
              <p className="text-muted-foreground text-xs">
                A name to recognise where this key is used.
              </p>
            </Field>
          )
        }}
      </form.Field>

      <form.Field name="expiry">
        {(field) => (
          <Field>
            <FieldLabel htmlFor={field.name}>Expires after</FieldLabel>
            <Select
              onValueChange={(value) => field.handleChange(value as Expiry)}
              value={field.state.value}
            >
              <SelectTrigger id={field.name}>
                <SelectValue>{EXPIRY_LABELS[field.state.value]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(EXPIRY_LABELS) as Expiry[]).map((expiry) => (
                  <SelectItem key={expiry} value={expiry}>
                    {EXPIRY_LABELS[expiry]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </form.Field>

      <div className="flex justify-end">
        <Button disabled={isPending || form.state.isSubmitting} type="submit">
          {isPending || form.state.isSubmitting ? "Creating..." : "Create key"}
        </Button>
      </div>
    </form>
  )
}
