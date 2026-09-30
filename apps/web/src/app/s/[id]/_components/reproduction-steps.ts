import type { DebuggerAction, DebuggerTimelineEntry } from "./types"
import { formatOffset } from "./utils"

const INPUT_ACTION_TYPE = "input"
const TAB_SWITCH_ACTION_TYPE = "tab-switch"

export interface ReproductionStepItem {
  actionIds: string[]
  id: string
  sequence: number
  summary: string | null
  timeLabel: string | null
  title: string
  selectedEntry: DebuggerTimelineEntry
  targetLabel: string | null
}

export function buildReproductionSteps(input: {
  actions: DebuggerAction[]
  entries: DebuggerTimelineEntry[]
}): ReproductionStepItem[] {
  const entriesById = new Map(
    input.entries.map((entry) => {
      return [entry.id, entry] as const
    })
  )
  const groups = groupActions(input.actions)

  return groups.flatMap((group, index) => {
    const firstAction = group[0]
    const lastAction = group.at(-1)
    if (!(firstAction && lastAction)) {
      return []
    }

    const selectedEntry =
      entriesById.get(lastAction.id) ?? entriesById.get(firstAction.id)
    if (!selectedEntry) {
      return []
    }

    const previousNavigationAction = findPreviousNavigationAction(groups, index)
    const title = formatActionTitle({
      action: firstAction,
      groupSize: group.length,
      previousNavigationAction,
    })
    const summary = formatActionSummary({
      action: firstAction,
      groupSize: group.length,
      lastAction,
      previousNavigationAction,
    })

    return [
      {
        actionIds: group.map((action) => action.id),
        id: firstAction.id,
        sequence: index + 1,
        summary,
        timeLabel: formatStepTimeLabel(group, entriesById),
        title,
        selectedEntry,
        targetLabel:
          firstAction.type === "navigation" ||
          firstAction.type === TAB_SWITCH_ACTION_TYPE
            ? null
            : (firstAction.target ?? null),
      },
    ]
  })
}

function groupActions(actions: DebuggerAction[]): DebuggerAction[][] {
  const groups: DebuggerAction[][] = []

  for (const action of actions) {
    const previousGroup = groups.at(-1)
    const previousAction = previousGroup?.at(-1)

    if (
      previousGroup &&
      previousAction &&
      shouldMergeIntoPreviousGroup(previousAction, action)
    ) {
      previousGroup.push(action)
      continue
    }

    groups.push([action])
  }

  return groups
}

function shouldMergeIntoPreviousGroup(
  previousAction: DebuggerAction,
  currentAction: DebuggerAction
): boolean {
  return (
    previousAction.type === INPUT_ACTION_TYPE &&
    currentAction.type === INPUT_ACTION_TYPE &&
    previousAction.target === currentAction.target
  )
}

function findPreviousNavigationAction(
  groups: DebuggerAction[][],
  currentIndex: number
): DebuggerAction | null {
  for (let index = currentIndex - 1; index >= 0; index -= 1) {
    const candidate = groups[index]?.[0]
    if (candidate?.type === "navigation") {
      return candidate
    }
  }

  return null
}

function formatActionTitle(input: {
  action: DebuggerAction
  groupSize: number
  previousNavigationAction: DebuggerAction | null
}): string {
  const targetKind = getTargetKind(input.action.target)

  switch (input.action.type) {
    case "click":
      return targetKind === "button" ? "Click button" : "Click element"
    case "input":
      return input.groupSize > 1 ? "Type into field" : "Enter text into field"
    case "change":
      return targetKind === "select" ? "Change selection" : "Change field"
    case "submit":
      return "Submit form"
    case "keydown":
      return "Use keyboard"
    case TAB_SWITCH_ACTION_TYPE:
      return "Switch tab"
    case "navigation": {
      if (
        isStateUpdateNavigation(input.action, input.previousNavigationAction)
      ) {
        return "Update page state"
      }

      const path = asNonEmptyString(input.action.metadata?.path)
      return path ? `Navigate to ${path}` : "Navigate to a new page"
    }
    default:
      return "Interact with page"
  }
}

function formatActionSummary(input: {
  action: DebuggerAction
  groupSize: number
  lastAction: DebuggerAction
  previousNavigationAction: DebuggerAction | null
}): string | null {
  switch (input.action.type) {
    case "navigation": {
      if (
        isStateUpdateNavigation(input.action, input.previousNavigationAction)
      ) {
        return formatStateUpdateSummary(
          input.action,
          input.previousNavigationAction
        )
      }

      const parts = [
        asNonEmptyString(input.lastAction.metadata?.title),
        formatNavigationMode(input.lastAction.metadata?.mode),
      ].filter(Boolean)

      return parts.length > 0 ? parts.join(" • ") : null
    }
    case TAB_SWITCH_ACTION_TYPE: {
      const parts = [
        asNonEmptyString(input.action.metadata?.title),
        asNonEmptyString(input.action.metadata?.url),
      ].filter(Boolean)

      return parts.length > 0 ? parts.join(" • ") : null
    }
    case "input": {
      const parts = [
        input.groupSize > 1 ? `${input.groupSize} input events` : null,
        formatValueLength(input.lastAction.metadata?.valueLength),
      ].filter(Boolean)

      return parts.length > 0 ? parts.join(" • ") : null
    }
    default:
      return input.action.target ?? null
  }
}

function formatStepTimeLabel(
  actions: DebuggerAction[],
  entriesById: Map<string, DebuggerTimelineEntry>
): string | null {
  const offsets = actions.flatMap((action) => {
    const offset = entriesById.get(action.id)?.offset
    return typeof offset === "number" ? [offset] : []
  })

  if (offsets.length === 0) {
    return null
  }

  const firstOffset = offsets[0]
  const lastOffset = offsets.at(-1)
  if (typeof firstOffset !== "number" || typeof lastOffset !== "number") {
    return null
  }

  if (firstOffset === lastOffset) {
    return formatOffset(firstOffset)
  }

  return `${formatOffset(firstOffset)} -> ${formatOffset(lastOffset)}`
}

function formatNavigationMode(value: unknown): string | null {
  const mode = asNonEmptyString(value)
  if (!mode) {
    return null
  }

  switch (mode) {
    case "pushState":
      return "via push state"
    case "replaceState":
      return "via replace state"
    case "popstate":
      return "via browser history"
    case "hashchange":
      return "via hash change"
    case "initial":
      return "initial page state"
    default:
      return `via ${mode}`
  }
}

function isStateUpdateNavigation(
  action: DebuggerAction,
  previousNavigationAction: DebuggerAction | null
): boolean {
  if (action.type !== "navigation") {
    return false
  }

  const mode = asNonEmptyString(action.metadata?.mode)
  const path = asNonEmptyString(action.metadata?.path)
  const previousPath =
    previousNavigationAction?.type === "navigation"
      ? asNonEmptyString(previousNavigationAction.metadata?.path)
      : null

  if (!(mode && path && previousPath)) {
    return false
  }

  if (path !== previousPath) {
    return false
  }

  return (
    mode === "pushState" || mode === "replaceState" || mode === "hashchange"
  )
}

function formatStateUpdateSummary(
  action: DebuggerAction,
  previousNavigationAction: DebuggerAction | null
): string | null {
  const path = asNonEmptyString(action.metadata?.path)
  const title = asNonEmptyString(action.metadata?.title)
  const mode = formatNavigationMode(action.metadata?.mode)
  const previousSearch =
    previousNavigationAction?.type === "navigation"
      ? asNonEmptyString(previousNavigationAction.metadata?.search)
      : null
  const currentSearch = asNonEmptyString(action.metadata?.search)
  const previousHash =
    previousNavigationAction?.type === "navigation"
      ? asNonEmptyString(previousNavigationAction.metadata?.hash)
      : null
  const currentHash = asNonEmptyString(action.metadata?.hash)
  const changeLabel = describeStateChange({
    currentHash,
    currentSearch,
    previousHash,
    previousSearch,
  })
  const parts = [title, path, changeLabel, mode].filter(Boolean)

  return parts.length > 0 ? parts.join(" • ") : null
}

function describeStateChange(input: {
  currentHash: string | null
  currentSearch: string | null
  previousHash: string | null
  previousSearch: string | null
}): string | null {
  const searchChanged = input.currentSearch !== input.previousSearch
  const hashChanged = input.currentHash !== input.previousHash

  if (searchChanged && hashChanged) {
    return "query and hash updated"
  }

  if (searchChanged) {
    return "query updated"
  }

  if (hashChanged) {
    return "hash updated"
  }

  return "history state updated"
}

function formatValueLength(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null
  }

  const normalizedValue = Math.floor(value)
  return normalizedValue === 1
    ? "field length 1 character"
    : `field length ${normalizedValue} characters`
}

function getTargetKind(target: string | null | undefined): string {
  if (!(target && target.length > 0)) {
    return "element"
  }

  if (target === "window") {
    return "page"
  }

  if (target.startsWith("#")) {
    return "field"
  }

  const [tagName] = target.split(".", 2)
  const normalizedTag = tagName?.trim().toLowerCase()

  switch (normalizedTag) {
    case "a":
      return "link"
    case "button":
      return "button"
    case "form":
      return "form"
    case "input":
    case "textarea":
      return "field"
    case "select":
      return "select"
    default:
      return "element"
  }
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null
}
