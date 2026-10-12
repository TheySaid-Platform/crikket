import { auth } from "@crikket/auth"
import { db } from "@crikket/db"
import { apikey, member } from "@crikket/db/schema/auth"
import {
  MCP_ACCESS_KEY_EXPIRY_OPTIONS,
  MCP_ACCESS_KEY_MAX_PER_ORGANIZATION,
  MCP_ACCESS_KEY_PERMISSIONS,
  type McpAccessKeyExpiry,
} from "@crikket/shared/constants/mcp"
import { ORPCError } from "@orpc/server"
import { and, desc, eq } from "drizzle-orm"

import { isOverAccessKeyCap } from "./access-key-cap"
import { readAccessKeyOrganizationId } from "./access-key-metadata"

const SECONDS_PER_DAY = 24 * 60 * 60

export interface McpAccessKeyListItem {
  id: string
  name: string
  start: string | null
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
}

export interface CreatedMcpAccessKey extends McpAccessKeyListItem {
  /** The full key. It is returned once and never stored in plain text. */
  key: string
}

async function findUserKeysInOrganization(input: {
  organizationId: string
  userId: string
}) {
  const rows = await db
    .select({
      id: apikey.id,
      name: apikey.name,
      start: apikey.start,
      metadata: apikey.metadata,
      createdAt: apikey.createdAt,
      expiresAt: apikey.expiresAt,
      lastRequest: apikey.lastRequest,
    })
    .from(apikey)
    .where(eq(apikey.referenceId, input.userId))
    .orderBy(desc(apikey.createdAt))

  return rows.filter(
    (row) => readAccessKeyOrganizationId(row.metadata) === input.organizationId
  )
}

function toListItem(row: {
  id: string
  name: string | null
  start: string | null
  createdAt: Date
  expiresAt: Date | null
  lastRequest: Date | null
}): McpAccessKeyListItem {
  return {
    id: row.id,
    name: row.name ?? "Unnamed key",
    start: row.start,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    lastUsedAt: row.lastRequest?.toISOString() ?? null,
  }
}

function isExpired(expiresAt: Date | null, now: Date): boolean {
  return Boolean(expiresAt && expiresAt.getTime() <= now.getTime())
}

async function findActiveUserKeysInOrganization(input: {
  organizationId: string
  userId: string
}) {
  const now = new Date()
  const rows = await findUserKeysInOrganization(input)
  return rows.filter((row) => !isExpired(row.expiresAt, now))
}

export async function listMcpAccessKeys(input: {
  organizationId: string
  userId: string
}): Promise<McpAccessKeyListItem[]> {
  const rows = await findActiveUserKeysInOrganization(input)
  return rows.map(toListItem)
}

function tooManyKeysError(): ORPCError<"BAD_REQUEST", unknown> {
  return new ORPCError("BAD_REQUEST", {
    message: `You already have ${MCP_ACCESS_KEY_MAX_PER_ORGANIZATION} access keys for this organization. Revoke one first.`,
  })
}

async function assertMembership(input: {
  organizationId: string
  userId: string
}): Promise<void> {
  const membership = await db.query.member.findFirst({
    where: and(
      eq(member.organizationId, input.organizationId),
      eq(member.userId, input.userId)
    ),
    columns: { id: true },
  })

  if (!membership) {
    throw new ORPCError("FORBIDDEN", {
      message: "You are not a member of this organization.",
    })
  }
}

export async function createMcpAccessKey(input: {
  expiry: McpAccessKeyExpiry
  name: string
  organizationId: string
  userId: string
}): Promise<CreatedMcpAccessKey> {
  await assertMembership(input)

  const activeKeys = await findActiveUserKeysInOrganization(input)
  if (activeKeys.length >= MCP_ACCESS_KEY_MAX_PER_ORGANIZATION) {
    throw tooManyKeysError()
  }

  // Called without request headers, so the plugin treats this as a trusted
  // server call: it accepts userId and permissions from us, not a client.
  const created = await auth.api.createApiKey({
    body: {
      userId: input.userId,
      name: input.name,
      expiresIn: MCP_ACCESS_KEY_EXPIRY_OPTIONS[input.expiry] * SECONDS_PER_DAY,
      metadata: { organizationId: input.organizationId },
      permissions: {
        mcp: [...MCP_ACCESS_KEY_PERMISSIONS.mcp],
      },
    },
  })

  // The check above can race with another create. Count again now that the
  // key exists, and back out if this one landed over the cap.
  const keysAfterCreate = await findActiveUserKeysInOrganization(input)
  if (
    isOverAccessKeyCap({
      cap: MCP_ACCESS_KEY_MAX_PER_ORGANIZATION,
      keyId: created.id,
      keys: keysAfterCreate,
    })
  ) {
    await db
      .delete(apikey)
      .where(
        and(eq(apikey.id, created.id), eq(apikey.referenceId, input.userId))
      )
    throw tooManyKeysError()
  }

  return {
    ...toListItem({
      id: created.id,
      name: created.name,
      start: created.start,
      createdAt: new Date(created.createdAt),
      expiresAt: created.expiresAt ? new Date(created.expiresAt) : null,
      lastRequest: null,
    }),
    key: created.key,
  }
}

export async function revokeMcpAccessKey(input: {
  keyId: string
  organizationId: string
  userId: string
}): Promise<{ id: string }> {
  const [row] = await db
    .select({ id: apikey.id, metadata: apikey.metadata })
    .from(apikey)
    .where(
      and(eq(apikey.id, input.keyId), eq(apikey.referenceId, input.userId))
    )
    .limit(1)

  if (
    !row ||
    readAccessKeyOrganizationId(row.metadata) !== input.organizationId
  ) {
    throw new ORPCError("NOT_FOUND", { message: "Access key not found" })
  }

  await db
    .delete(apikey)
    .where(and(eq(apikey.id, row.id), eq(apikey.referenceId, input.userId)))

  return { id: row.id }
}
