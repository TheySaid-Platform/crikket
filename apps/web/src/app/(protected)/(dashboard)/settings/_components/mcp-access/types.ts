import type { AppRouterClient } from "@crikket/api/routers/index"

export type McpAccessKeysSnapshot = Awaited<
  ReturnType<AppRouterClient["mcpAccessKey"]["list"]>
>

export type McpAccessKeyItem = McpAccessKeysSnapshot[number]

export type CreatedMcpAccessKey = Awaited<
  ReturnType<AppRouterClient["mcpAccessKey"]["create"]>
>
