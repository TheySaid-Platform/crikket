"use client"

import { useQuery } from "@tanstack/react-query"

import { orpc } from "@/utils/orpc"
import type { McpAccessKeysSnapshot } from "../types"

export function useMcpAccessKeysData(initialKeys: McpAccessKeysSnapshot) {
  return useQuery({
    ...orpc.mcpAccessKey.list.queryOptions(),
    initialData: initialKeys,
  })
}
