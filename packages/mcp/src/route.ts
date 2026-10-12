import { auth } from "@crikket/auth"
import { getStorageProvider } from "@crikket/bug-reports/lib/storage"
import { db } from "@crikket/db"
import { member, user } from "@crikket/db/schema/auth"
import { MCP_ACCESS_KEY_PERMISSIONS } from "@crikket/shared/constants/mcp"
import { and, eq } from "drizzle-orm"

import { readAccessKeyOrganizationId } from "./access-key-metadata"
import { type AccessKeyVerification, createMcpAuthenticator } from "./auth"
import {
  createMcpRequestHandler,
  type McpRequestHandlerDependencies,
} from "./handler"
import { limitAccessKey } from "./key-rate-limit"
import { createVideoFrameService } from "./media/video-frames"
import { createProcedureReader } from "./reader"

/** The MCP endpoint wired to the real database and auth. */
export function createCrikketMcpRequestHandler(input: {
  appOrigin: string
  limitUser?: McpRequestHandlerDependencies["limitUser"]
}) {
  return createMcpRequestHandler({
    appOrigin: input.appOrigin,
    frames: createVideoFrameService({
      loadCapture: async (captureKey) =>
        new Uint8Array(await getStorageProvider().read(captureKey)),
    }),
    limitUser: input.limitUser,
    authenticate: createMcpAuthenticator({
      verifyAccessKey,
      limitKey: (keyId) => limitAccessKey(keyId),
      findUser: async (userId) =>
        (await db.query.user.findFirst({ where: eq(user.id, userId) })) ?? null,
      isMember: async ({ organizationId, userId }) => {
        const membership = await db.query.member.findFirst({
          where: and(
            eq(member.organizationId, organizationId),
            eq(member.userId, userId)
          ),
          columns: { id: true },
        })
        return Boolean(membership)
      },
    }),
    createReader: createProcedureReader,
  })
}

async function verifyAccessKey(key: string): Promise<AccessKeyVerification> {
  const result = await auth.api.verifyApiKey({
    body: {
      key,
      permissions: {
        mcp: [...MCP_ACCESS_KEY_PERMISSIONS.mcp],
      },
    },
  })

  if (result.valid && result.key) {
    return {
      valid: true,
      key: {
        id: result.key.id,
        userId: result.key.referenceId,
        organizationId: readAccessKeyOrganizationId(result.key.metadata),
        expiresAt: result.key.expiresAt ? new Date(result.key.expiresAt) : null,
      },
    }
  }

  return { valid: false }
}
