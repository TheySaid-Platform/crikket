"use client"

import { Button } from "@crikket/ui/components/ui/button"
import { Field, FieldError, FieldLabel } from "@crikket/ui/components/ui/field"
import { Input } from "@crikket/ui/components/ui/input"
import { useForm } from "@tanstack/react-form"
import { useRouter } from "nextjs-toploader/app"
import { toast } from "sonner"
import { z } from "zod"

import { client } from "@/utils/orpc"

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.[a-z0-9-]{1,63})+$/i

const formSchema = z.object({
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(3, "Enter a valid domain")
    .max(253)
    .regex(DOMAIN_PATTERN, "Enter a valid domain like acme.com"),
})

interface OrganizationVerifiedDomainFormProps {
  canManage: boolean
  initialDomain: string | null
  organizationId: string
}

export function OrganizationVerifiedDomainForm({
  canManage,
  initialDomain,
  organizationId,
}: OrganizationVerifiedDomainFormProps) {
  const router = useRouter()
  const form = useForm({
    defaultValues: {
      domain: initialDomain ?? "",
    },
    validators: {
      onChange: formSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        await client.organization.setVerifiedDomain({
          organizationId,
          domain: value.domain,
        })
        toast.success(`Verified domain set to ${value.domain}`)
        router.refresh()
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to set verified domain"
        toast.error(message)
      }
    },
  })

  const handleClear = async () => {
    try {
      await client.organization.clearVerifiedDomain({ organizationId })
      form.setFieldValue("domain", "")
      toast.success("Verified domain cleared")
      router.refresh()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to clear verified domain"
      toast.error(message)
    }
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        form.handleSubmit()
      }}
    >
      <form.Field name="domain">
        {(field) => {
          const isInvalid =
            field.state.meta.isTouched && field.state.meta.errors.length > 0

          return (
            <Field data-invalid={isInvalid}>
              <FieldLabel htmlFor={field.name}>Email domain</FieldLabel>
              <Input
                aria-invalid={isInvalid}
                autoComplete="off"
                disabled={!canManage}
                id={field.name}
                name={field.name}
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.target.value.toLowerCase())
                }
                placeholder="acme.com"
                value={field.state.value}
              />
              {isInvalid ? (
                <FieldError errors={field.state.meta.errors} />
              ) : null}
              <p className="text-muted-foreground text-xs">
                New sign-ins with emails on this domain join this organization
                automatically. Public providers (gmail.com, outlook.com, etc.)
                cannot be used.
              </p>
            </Field>
          )
        }}
      </form.Field>

      <div className="flex gap-2">
        <Button disabled={!canManage || form.state.isSubmitting} type="submit">
          {form.state.isSubmitting ? "Saving..." : "Save domain"}
        </Button>
        {initialDomain ? (
          <Button
            disabled={!canManage}
            onClick={handleClear}
            type="button"
            variant="outline"
          >
            Clear domain
          </Button>
        ) : null}
      </div>
    </form>
  )
}
