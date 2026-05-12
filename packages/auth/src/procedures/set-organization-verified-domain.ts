import { db } from "@crikket/db"
import { member, organization } from "@crikket/db/schema/auth"
import { isPublicEmailDomain } from "@crikket/shared/constants/public-email-domains"
import { ORPCError } from "@orpc/server"
import { and, eq, ne } from "drizzle-orm"
import { z } from "zod"

import { protectedProcedure } from "./context"

const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?<!-)(?:\.[a-z0-9-]{1,63})+$/i

const inputSchema = z.object({
  organizationId: z.string().min(1),
  domain: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(253)
    .regex(DOMAIN_PATTERN, "Enter a valid domain like acme.com"),
})

export const setOrganizationVerifiedDomain = protectedProcedure
  .input(inputSchema)
  .handler(async ({ context, input }) => {
    const userId = context.session.user.id
    const { organizationId, domain } = input

    if (isPublicEmailDomain(domain)) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Public email providers (gmail.com, outlook.com, etc.) cannot be used as a verified domain.",
      })
    }

    const [membership] = await db
      .select({ role: member.role })
      .from(member)
      .where(
        and(
          eq(member.organizationId, organizationId),
          eq(member.userId, userId)
        )
      )
      .limit(1)

    if (!membership) {
      throw new ORPCError("FORBIDDEN", {
        message: "You do not have access to this organization.",
      })
    }

    if (membership.role !== "owner") {
      throw new ORPCError("FORBIDDEN", {
        message: "Only organization owners can set the verified domain.",
      })
    }

    const [conflict] = await db
      .select({ id: organization.id })
      .from(organization)
      .where(
        and(
          eq(organization.verifiedDomain, domain),
          ne(organization.id, organizationId)
        )
      )
      .limit(1)

    if (conflict) {
      throw new ORPCError("CONFLICT", {
        message: `The domain ${domain} is already claimed by another organization.`,
      })
    }

    await db
      .update(organization)
      .set({
        verifiedDomain: domain,
        verifiedDomainAt: new Date(),
      })
      .where(eq(organization.id, organizationId))

    return { domain }
  })
