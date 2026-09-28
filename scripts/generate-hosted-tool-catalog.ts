import { existsSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

import { buildHostedToolCatalog } from "../src/hosted-tool-catalog.js"

const outputCandidates = [
  resolve(process.cwd(), "packages/mcp-contract/src/hosted-tool-catalog.json"),
  resolve(process.cwd(), "../mcp-contract/src/hosted-tool-catalog.json"),
]
const output = outputCandidates.find((candidate) =>
  existsSync(resolve(candidate, ".."))
)
if (!output) {
  throw new Error("Could not find the portable MCP contract package.")
}
writeFileSync(output, `${JSON.stringify(buildHostedToolCatalog(), null, 2)}\n`)
