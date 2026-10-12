"use client"

import type { ColumnDef } from "@tanstack/react-table"

import type { McpAccessKeyItem } from "../types"
import { formatKeyDate } from "../utils"
import { McpAccessKeyRowActions } from "./mcp-access-key-row-actions"

interface CreateMcpAccessKeysTableColumnsInput {
  revokingKeyId: string | null
  onRevoke: (input: { keyId: string }) => Promise<void>
}

export function createMcpAccessKeysTableColumns({
  revokingKeyId,
  onRevoke,
}: CreateMcpAccessKeysTableColumnsInput): ColumnDef<McpAccessKeyItem>[] {
  return [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div className="space-y-1">
          <p className="font-medium text-sm">{row.original.name}</p>
          <code className="font-mono text-muted-foreground text-xs">
            {row.original.start ? `${row.original.start}…` : "—"}
          </code>
        </div>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Created",
      cell: ({ row }) => formatKeyDate(row.original.createdAt, "—"),
    },
    {
      accessorKey: "lastUsedAt",
      header: "Last used",
      cell: ({ row }) => formatKeyDate(row.original.lastUsedAt, "Never"),
    },
    {
      accessorKey: "expiresAt",
      header: "Expires",
      cell: ({ row }) => formatKeyDate(row.original.expiresAt, "Never"),
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <McpAccessKeyRowActions
            isRevoking={revokingKeyId === row.original.id}
            item={row.original}
            onRevoke={onRevoke}
          />
        </div>
      ),
      enableSorting: false,
    },
  ]
}
