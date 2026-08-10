import { lstatSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"

const root = path.resolve(__dirname, "..")
const excluded = new Set([".git", "docs/superpowers", "node_modules"])
const retiredPattern = new RegExp(`${"quick"}[ _-]?${"surf"}`, "i")

function repositoryPath(filePath: string) {
  return path.relative(root, filePath).replaceAll(path.sep, "/")
}

function isExcluded(filePath: string) {
  const relative = repositoryPath(filePath)
  return [...excluded].some(
    (entry) => relative === entry || relative.startsWith(`${entry}/`)
  )
}

function collectFiles(directory: string, files: string[] = []): string[] {
  if (isExcluded(directory)) return files
  for (const name of readdirSync(directory)) {
    const child = path.join(directory, name)
    if (isExcluded(child)) continue
    const stat = lstatSync(child)
    if (stat.isDirectory()) collectFiles(child, files)
    else if (stat.isFile()) files.push(child)
  }
  return files
}

describe("Enrich vocabulary hard cut", () => {
  it("keeps the retired name out of every current hosted MCP path and source", () => {
    const violations: string[] = []
    for (const filePath of collectFiles(root)) {
      const relative = repositoryPath(filePath)
      if (retiredPattern.test(relative)) violations.push(relative)
      const contents = readFileSync(filePath)
      if (!contents.includes(0) && retiredPattern.test(contents.toString())) {
        violations.push(relative)
      }
    }

    expect([...new Set(violations)].sort()).toEqual([])
  })
})
