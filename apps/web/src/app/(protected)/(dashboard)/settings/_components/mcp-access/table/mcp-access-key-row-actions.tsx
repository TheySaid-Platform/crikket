"use client"

import { ConfirmationDialog } from "@crikket/ui/components/dialogs/confirmation-dialog"
import { Button } from "@crikket/ui/components/ui/button"
import { ShieldOff } from "lucide-react"
import { useState } from "react"

import type { McpAccessKeyItem } from "../types"

interface McpAccessKeyRowActionsProps {
  isRevoking: boolean
  item: McpAccessKeyItem
  onRevoke: (input: { keyId: string }) => Promise<void>
}

export function McpAccessKeyRowActions({
  isRevoking,
  item,
  onRevoke,
}: McpAccessKeyRowActionsProps) {
  const [isRevokeDialogOpen, setIsRevokeDialogOpen] = useState(false)

  return (
    <>
      <Button
        aria-label={`Revoke ${item.name}`}
        disabled={isRevoking}
        onClick={() => setIsRevokeDialogOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <ShieldOff />
        {isRevoking ? "Revoking..." : "Revoke"}
      </Button>

      <ConfirmationDialog
        confirmText="Revoke key"
        description="Any AI tool using this key stops working immediately. This cannot be undone."
        isLoading={isRevoking}
        onConfirm={async () => {
          await onRevoke({ keyId: item.id })
        }}
        onOpenChange={setIsRevokeDialogOpen}
        open={isRevokeDialogOpen}
        title={`Revoke "${item.name}"?`}
        variant="destructive"
      />
    </>
  )
}
