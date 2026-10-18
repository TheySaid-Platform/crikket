"use client"

import { Button } from "@crikket/ui/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@crikket/ui/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@crikket/ui/components/ui/dialog"
import { Plus } from "lucide-react"
import * as React from "react"

import { CreatedKeyPanel } from "./components/created-key-panel"
import { SnippetBlock } from "./components/snippet-block"
import { McpAccessKeyCreateForm } from "./forms/mcp-access-key-create-form"
import { useMcpAccessKeyActions } from "./hooks/use-mcp-access-key-actions"
import { useMcpAccessKeysData } from "./hooks/use-mcp-access-keys-data"
import { McpAccessKeysTable } from "./table/mcp-access-keys-table"
import type { CreatedMcpAccessKey, McpAccessKeysSnapshot } from "./types"
import {
  buildClaudeCodeCommand,
  formatKeyDate,
  MCP_ACCESS_KEY_PLACEHOLDER,
} from "./utils"

interface McpAccessManagementProps {
  endpointUrl: string
  initialKeys: McpAccessKeysSnapshot
  organizationName: string
}

export function McpAccessManagement({
  endpointUrl,
  initialKeys,
  organizationName,
}: McpAccessManagementProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = React.useState(false)
  const [createdKey, setCreatedKey] =
    React.useState<CreatedMcpAccessKey | null>(null)
  const keysQuery = useMcpAccessKeysData(initialKeys)
  const { createMutation, revokeMutation } = useMcpAccessKeyActions()

  const keys = keysQuery.data ?? []
  const closeCreateDialog = () => {
    setIsCreateDialogOpen(false)
    setCreatedKey(null)
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>Access keys</CardTitle>
            <CardDescription>
              Each key is yours and works only for {organizationName}. It can
              read the bug reports you can read, nothing more, and cannot change
              anything.
            </CardDescription>
          </div>
          <Button onClick={() => setIsCreateDialogOpen(true)} type="button">
            <Plus />
            Create key
          </Button>
        </CardHeader>
        <CardContent>
          {keys.length > 0 ? (
            <McpAccessKeysTable
              items={keys}
              onRevoke={async (input) => {
                // Failures are already shown as a toast by the mutation.
                await revokeMutation.mutateAsync(input).catch(() => undefined)
              }}
              revokingKeyId={
                revokeMutation.isPending
                  ? (revokeMutation.variables?.keyId ?? null)
                  : null
              }
            />
          ) : (
            <div className="text-muted-foreground text-sm">
              No access keys yet. Create one to connect Claude Code, Cursor or
              another MCP client.
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Connect an AI tool</CardTitle>
          <CardDescription>
            Add Crikket as a remote MCP server, then paste a bug report link
            into your AI chat and ask it to debug.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <SnippetBlock
            copyLabel="Copy MCP server URL"
            label="MCP server URL"
            value={endpointUrl}
          />
          <SnippetBlock
            copyLabel="Copy Claude Code command"
            label="Claude Code"
            value={buildClaudeCodeCommand(
              endpointUrl,
              MCP_ACCESS_KEY_PLACEHOLDER
            )}
          />
        </CardContent>
      </Card>

      <Dialog
        onOpenChange={(open) => {
          if (open) {
            setIsCreateDialogOpen(true)
          } else {
            closeCreateDialog()
          }
        }}
        open={isCreateDialogOpen}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {createdKey ? "Access key created" : "Create access key"}
            </DialogTitle>
            <DialogDescription>
              {createdKey
                ? `"${createdKey.name}" can read bug reports in ${organizationName} until ${formatKeyDate(createdKey.expiresAt, "it is revoked")}.`
                : `The key will only work for ${organizationName}.`}
            </DialogDescription>
          </DialogHeader>
          {createdKey ? (
            <CreatedKeyPanel
              createdKey={createdKey}
              endpointUrl={endpointUrl}
              onDone={closeCreateDialog}
            />
          ) : (
            <McpAccessKeyCreateForm
              isPending={createMutation.isPending}
              onSubmit={async (input) => {
                // Failures are already shown as a toast by the mutation.
                const created = await createMutation
                  .mutateAsync(input)
                  .catch(() => null)
                if (created) {
                  setCreatedKey(created)
                }
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
