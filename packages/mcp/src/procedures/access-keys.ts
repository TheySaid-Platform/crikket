import { requireActiveOrgId } from "@crikket/bug-reports/procedures/helpers"
import {
  DEFAULT_MCP_ACCESS_KEY_EXPIRY,
  MCP_ACCESS_KEY_EXPIRY_OPTIONS,
  MCP_ACCESS_KEY_NAME_MAX_LENGTH,
  type McpAccessKeyExpiry,
} from "@crikket/shared/constants/mcp"
import { createSessionProcedures } from "@crikket/shared/lib/server/orpc-auth"
import { z } from "zod"

import {
  createMcpAccessKey,
  listMcpAccessKeys,
  revokeMcpAccessKey,
} from "../access-keys"
import type { SessionContext } from "../types"

const { protectedProcedure } = createSessionProcedures<SessionContext>({
  isAuthorized: (session) => Boolean(session?.user),
})

const expiryValues = Object.keys(MCP_ACCESS_KEY_EXPIRY_OPTIONS) as [
  McpAccessKeyExpiry,
  ...McpAccessKeyExpiry[],
]

const createMcpAccessKeyInputSchema = z.object({
  name: z.string().trim().min(1).max(MCP_ACCESS_KEY_NAME_MAX_LENGTH),
  expiry: z.enum(expiryValues).default(DEFAULT_MCP_ACCESS_KEY_EXPIRY),
})

const mcpAccessKeyIdSchema = z.object({
  keyId: z.string().min(1),
})

export const listMcpAccessKeysProcedure = protectedProcedure.handler(
  ({ context }) =>
    listMcpAccessKeys({
      organizationId: requireActiveOrgId(context.session),
      userId: context.session.user.id,
    })
)

export const createMcpAccessKeyProcedure = protectedProcedure
  .input(createMcpAccessKeyInputSchema)
  .handler(({ context, input }) =>
    createMcpAccessKey({
      expiry: input.expiry,
      name: input.name,
      organizationId: requireActiveOrgId(context.session),
      userId: context.session.user.id,
    })
  )

export const revokeMcpAccessKeyProcedure = protectedProcedure
  .input(mcpAccessKeyIdSchema)
  .handler(({ context, input }) =>
    revokeMcpAccessKey({
      keyId: input.keyId,
      organizationId: requireActiveOrgId(context.session),
      userId: context.session.user.id,
    })
  )
