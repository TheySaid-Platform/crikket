import { db } from "@crikket/db"
import { member, organization } from "@crikket/db/schema/auth"
import { ORPCError } from "@orpc/server"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { protectedProcedure } from "./context"

const inputSchema = z.object({
  organizationId: z.string().min(1),
})

export const clearOrganizationVerifiedDomain = protectedProcedure
  .input(inputSchema)
  .handler(async ({ context, input }) => {
    const userId = context.session.user.id
    const { organizationId } = input

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
        message: "Only organization owners can clear the verified domain.",
      })
    }

    await db
      .update(organization)
      .set({
        verifiedDomain: null,
        verifiedDomainAt: null,
      })
      .where(eq(organization.id, organizationId))

    return { ok: true }
  })
