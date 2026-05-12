import { db } from "@crikket/db"
import { member, organization } from "@crikket/db/schema/auth"
import { ORPCError } from "@orpc/server"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { protectedProcedure } from "./context"

const inputSchema = z.object({
  organizationId: z.string().min(1),
})

export const getOrganizationVerifiedDomain = protectedProcedure
  .input(inputSchema)
  .handler(async ({ context, input }) => {
    const userId = context.session.user.id
    const { organizationId } = input

    const [membership] = await db
      .select({ id: member.id })
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

    const [row] = await db
      .select({
        verifiedDomain: organization.verifiedDomain,
        verifiedDomainAt: organization.verifiedDomainAt,
      })
      .from(organization)
      .where(eq(organization.id, organizationId))
      .limit(1)

    return {
      verifiedDomain: row?.verifiedDomain ?? null,
      verifiedDomainAt: row?.verifiedDomainAt ?? null,
    }
  })
