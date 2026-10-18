"use client"

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@crikket/ui/components/ui/alert"
import { Button } from "@crikket/ui/components/ui/button"
import { TriangleAlert } from "lucide-react"

import type { CreatedMcpAccessKey } from "../types"
import {
  buildClaudeCodeCommand,
  buildCursorConfig,
  SHELL_HISTORY_WARNING,
} from "../utils"
import { SnippetBlock } from "./snippet-block"

interface CreatedKeyPanelProps {
  createdKey: CreatedMcpAccessKey
  endpointUrl: string
  onDone: () => void
}

export function CreatedKeyPanel({
  createdKey,
  endpointUrl,
  onDone,
}: CreatedKeyPanelProps) {
  return (
    <div className="grid min-w-0 gap-4">
      <Alert>
        <TriangleAlert />
        <AlertTitle>Copy this key now</AlertTitle>
        <AlertDescription>
          You will not be able to see it again. Anyone with this key can read
          the bug reports you can read in this organization.
        </AlertDescription>
      </Alert>

      <SnippetBlock
        copyLabel="Copy access key"
        label="Access key"
        value={createdKey.key}
      />
      <SnippetBlock
        copyLabel="Copy Claude Code command"
        label="Claude Code"
        note={SHELL_HISTORY_WARNING}
        value={buildClaudeCodeCommand(endpointUrl, createdKey.key)}
      />
      <SnippetBlock
        copyLabel="Copy Cursor config"
        label="Cursor (.cursor/mcp.json)"
        value={buildCursorConfig(endpointUrl, createdKey.key)}
      />

      <div className="flex justify-end">
        <Button onClick={onDone} type="button">
          Done
        </Button>
      </div>
    </div>
  )
}
