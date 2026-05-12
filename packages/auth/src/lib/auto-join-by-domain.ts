import { assertOrganizationCanAddMembers } from "@crikket/billing/service/entitlements/organization-entitlements"
import { db } from "@crikket/db"
import { member, organization, user } from "@crikket/db/schema/auth"
import { isPublicEmailDomain } from "@crikket/shared/constants/public-email-domains"
import { and, eq } from "drizzle-orm"
import { nanoid } from "nanoid"

export function extractEmailDomain(email: string): string {
  return (email.split("@")[1] ?? "").toLowerCase().trim()
}

export async function tryAutoJoinByDomain(input: {
  userId: string
  email: string
  emailVerified: boolean
}): Promise<void> {
  if (!input.emailVerified) {
    return
  }

  const domain = extractEmailDomain(input.email)
  if (!domain || isPublicEmailDomain(domain)) {
    return
  }

  const [matchingOrg] = await db
    .select({ id: organization.id })
    .from(organization)
    .where(eq(organization.verifiedDomain, domain))
    .limit(1)

  if (!matchingOrg) {
    return
  }

  const [existingMembership] = await db
    .select({ id: member.id })
    .from(member)
    .where(
      and(
        eq(member.organizationId, matchingOrg.id),
        eq(member.userId, input.userId)
      )
    )
    .limit(1)

  if (existingMembership) {
    return
  }

  try {
    await assertOrganizationCanAddMembers(matchingOrg.id)
  } catch (error) {
    console.warn(
      `[auto-join] skipping org ${matchingOrg.id} for user ${input.userId}: seat limit reached`,
      error
    )
    return
  }

  await db.insert(member).values({
    id: nanoid(21),
    organizationId: matchingOrg.id,
    userId: input.userId,
    role: "member",
    createdAt: new Date(),
  })
}

export async function tryAutoJoinForUserId(userId: string): Promise<void> {
  const [row] = await db
    .select({ email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1)

  if (!row) {
    return
  }

  await tryAutoJoinByDomain({
    userId,
    email: row.email,
    emailVerified: row.emailVerified,
  })
}
