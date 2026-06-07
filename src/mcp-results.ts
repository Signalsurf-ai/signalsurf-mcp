import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js"

import { errorToObject } from "./errors.js"

function asStructuredContent(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : { value }
}

export function jsonResult(value: unknown): CallToolResult {
  return {
    structuredContent: asStructuredContent(value),
    content: [
      {
        type: "text",
        text: JSON.stringify(value, null, 2),
      },
    ],
  }
}

export function jsonErrorResult(error: unknown): CallToolResult {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify(errorToObject(error), null, 2),
      },
    ],
  }
}

export async function runJsonTool(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return jsonResult({ ok: true, data: await fn() })
  } catch (error) {
    return jsonErrorResult(error)
  }
}

export function jsonResource(uri: string, value: unknown) {
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(value, null, 2),
      },
    ],
  }
}
