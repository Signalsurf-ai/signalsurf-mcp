#!/usr/bin/env node

import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { config as loadDotenv } from "dotenv"

import { loadConfig } from "./config.js"
import { errorToObject } from "./errors.js"
import { startHttpServer } from "./http.js"
import { startStdioServer } from "./stdio.js"

function loadEnvFiles() {
  const entryDir = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(entryDir, "..", ".env"),
  ]

  for (const path of [...new Set(candidates)]) {
    if (existsSync(path)) loadDotenv({ path, override: false })
  }
}

async function main() {
  loadEnvFiles()
  const config = loadConfig()
  if (config.transport === "http") {
    await startHttpServer(config)
    return
  }
  await startStdioServer(config)
}

main().catch((error) => {
  const details = errorToObject(error)
  console.error(
    `[signalsurf-mcp] Startup failed: ${details.code} - ${details.error}`
  )
  console.error(JSON.stringify(details))
  process.exitCode = 1
})
