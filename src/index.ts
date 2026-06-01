#!/usr/bin/env node

import { loadConfig } from "./config.js"
import { errorToObject } from "./errors.js"
import { startHttpServer } from "./http.js"
import { startStdioServer } from "./stdio.js"

async function main() {
  const config = loadConfig()
  if (config.transport === "http") {
    await startHttpServer(config)
    return
  }
  await startStdioServer(config)
}

main().catch((error) => {
  console.error(JSON.stringify(errorToObject(error), null, 2))
  process.exitCode = 1
})
