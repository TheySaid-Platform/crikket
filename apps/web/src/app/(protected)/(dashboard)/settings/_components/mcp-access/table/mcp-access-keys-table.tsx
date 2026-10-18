"use client"

import { paginationConfig } from "@crikket/shared/config/pagination"
import { DataTable } from "@crikket/ui/components/data-table/data-table"
import {
  getCoreRowModel,
  getPaginationRowModel,
  type PaginationState,
  type Updater,
  useReactTable,
} from "@tanstack/react-table"
import { parseAsInteger, useQueryStates } from "nuqs"
import * as React from "react"

import type { McpAccessKeyItem } from "../types"
import { createMcpAccessKeysTableColumns } from "./mcp-access-keys-table-columns"

interface McpAccessKeysTableProps {
  items: McpAccessKeyItem[]
  onRevoke: (input: { keyId: string }) => Promise<void>
  revokingKeyId: string | null
}

export function McpAccessKeysTable({
  items,
  onRevoke,
  revokingKeyId,
}: McpAccessKeysTableProps) {
  const [{ page, perPage }, setPaginationQuery] = useQueryStates(
    {
      page: parseAsInteger.withDefault(paginationConfig.defaultPage),
      perPage: parseAsInteger.withDefault(paginationConfig.defaultPageSize),
    },
    {
      history: "replace",
      shallow: false,
    }
  )

  const columns = React.useMemo(
    () => createMcpAccessKeysTableColumns({ onRevoke, revokingKeyId }),
    [onRevoke, revokingKeyId]
  )

  const pagination = React.useMemo<PaginationState>(
    () => ({
      pageIndex: Math.max(0, page - 1),
      pageSize: perPage,
    }),
    [page, perPage]
  )

  const table = useReactTable({
    columns,
    data: items,
    getCoreRowModel: getCoreRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onPaginationChange: (updaterOrValue: Updater<PaginationState>) => {
      const nextPagination =
        typeof updaterOrValue === "function"
          ? updaterOrValue(pagination)
          : updaterOrValue

      setPaginationQuery({
        page: nextPagination.pageIndex + 1,
        perPage: nextPagination.pageSize,
      }).catch(() => undefined)
    },
    state: {
      pagination,
    },
  })

  return <DataTable hideSelectedRowsLabel table={table} />
}
