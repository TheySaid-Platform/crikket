import {
  createMcpAccessKeyProcedure,
  listMcpAccessKeysProcedure,
  revokeMcpAccessKeyProcedure,
} from "@crikket/mcp/procedures/access-keys"

/**
 * MCP Access Key Router
 * All logic lives in the @crikket/mcp package
 */
export const mcpAccessKeyRouter = {
  list: listMcpAccessKeysProcedure,
  create: createMcpAccessKeyProcedure,
  revoke: revokeMcpAccessKeyProcedure,
}
