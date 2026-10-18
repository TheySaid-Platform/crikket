import { compactJson, formatOffset, truncateText } from "./format"
import type {
  BugReportDetails,
  BugReportListPage,
  DebuggerEvents,
  NetworkRequestItem,
} from "./reader"
import { buildShareUrl } from "./report-ref"

type DebuggerAction = DebuggerEvents["actions"][number]
type DebuggerLog = DebuggerEvents["logs"][number]
type BugReportListItem = BugReportListPage["items"][number]

const URL_MAX_CHARS = 500
const TARGET_MAX_CHARS = 300
const METADATA_MAX_CHARS = 500
const LOG_MESSAGE_MAX_CHARS = 2000
const LOG_METADATA_MAX_CHARS = 1500

export function toReportSummary(report: BugReportDetails, appOrigin: string) {
  return {
    id: report.id,
    shareUrl: buildShareUrl(appOrigin, report.id),
    title: report.title,
    description: report.description,
    status: report.status,
    priority: report.priority,
    tags: report.tags,
    visibility: report.visibility,
    pageUrl: report.url,
    pageTitle: readString(report.metadata, "pageTitle"),
    capture: {
      type: report.attachmentType,
      url: report.attachmentUrl,
      duration: readString(report.metadata, "duration"),
    },
    device: report.deviceInfo,
    tabs: readTabs(report.metadata),
    reporter: report.reporter?.name ?? null,
    organization: report.organization.name,
    submissionStatus: report.submissionStatus,
    debuggerStatus: report.debuggerIngestionStatus,
    debuggerError: report.debuggerIngestionError,
    createdAt: report.createdAt,
    updatedAt: report.updatedAt,
  }
}

export function toReportListItem(item: BugReportListItem, appOrigin: string) {
  return {
    id: item.id,
    shareUrl: buildShareUrl(appOrigin, item.id),
    title: item.title,
    status: item.status,
    priority: item.priority,
    tags: item.tags,
    visibility: item.visibility,
    pageUrl: item.url ?? null,
    captureType: item.attachmentType ?? null,
    duration: item.duration,
    reporter: item.uploader?.name ?? null,
    submissionStatus: item.submissionStatus,
    createdAt: item.createdAt,
  }
}

export function toStepItem(action: DebuggerAction, index: number) {
  return {
    step: index + 1,
    type: action.type,
    target: truncateText(action.target, TARGET_MAX_CHARS),
    offsetMs: action.offset,
    time: formatOffset(action.offset),
    pageUrl: truncateText(action.pageUrl, URL_MAX_CHARS),
    tabId: action.tabId,
    details: compactJson(action.metadata, METADATA_MAX_CHARS),
  }
}

export function toLogItem(
  log: DebuggerLog,
  options?: { messageMaxChars?: number; includeMetadata?: boolean }
) {
  return {
    level: log.level,
    message: truncateText(
      log.message,
      options?.messageMaxChars ?? LOG_MESSAGE_MAX_CHARS
    ),
    offsetMs: log.offset,
    time: formatOffset(log.offset),
    pageUrl: truncateText(log.pageUrl, URL_MAX_CHARS),
    tabId: log.tabId,
    ...(options?.includeMetadata === false
      ? {}
      : { details: compactJson(log.metadata, LOG_METADATA_MAX_CHARS) }),
  }
}

export function toNetworkItem(request: NetworkRequestItem) {
  return {
    id: request.id,
    method: request.method,
    url: truncateText(request.url, URL_MAX_CHARS),
    status: request.status,
    failure: request.failure,
    durationMs: request.duration,
    offsetMs: request.offset,
    time: formatOffset(request.offset),
    pageUrl: truncateText(request.pageUrl, URL_MAX_CHARS),
    tabId: request.tabId,
  }
}

function readString(metadata: unknown, key: string): string | null {
  if (!isRecord(metadata)) {
    return null
  }

  const value = metadata[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

function readTabs(metadata: unknown) {
  if (!(isRecord(metadata) && Array.isArray(metadata.tabs))) {
    return []
  }

  return metadata.tabs.filter(isRecord).map((tab) => ({
    tabId: typeof tab.tabId === "number" ? tab.tabId : null,
    url:
      typeof tab.url === "string" ? truncateText(tab.url, URL_MAX_CHARS) : null,
    title: typeof tab.title === "string" ? tab.title : null,
  }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
