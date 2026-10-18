"use client"

import type { McpAccessKeyExpiry } from "@crikket/shared/constants/mcp"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"

import { client, queryClient } from "@/utils/orpc"

export function useMcpAccessKeyActions() {
  const createMutation = useMutation({
    mutationFn: async (input: { name: string; expiry: McpAccessKeyExpiry }) =>
      client.mcpAccessKey.create(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      toast.success("Access key created")
    },
    onError: (error) => {
      toast.error(error.message || "Failed to create access key")
    },
  })

  const revokeMutation = useMutation({
    mutationFn: async (input: { keyId: string }) =>
      client.mcpAccessKey.revoke(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      toast.success("Access key revoked")
    },
    onError: (error) => {
      toast.error(error.message || "Failed to revoke access key")
    },
  })

  return {
    createMutation,
    revokeMutation,
  }
}
