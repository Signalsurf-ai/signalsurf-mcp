import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const packageDirectory = resolve(process.cwd(), "packages/mcp-contract")

describe("MCP contract consumer entrypoints", () => {
  it("keeps the NodeNext barrel explicit and publishes typed subpaths", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(packageDirectory, "package.json"), "utf8")
    ) as { exports?: Record<string, string> }
    expect(packageJson.exports).toMatchObject({
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
      },
      "./access-token": {
        types: "./dist/access-token.d.ts",
        import: "./dist/access-token.js",
      },
      "./project-tools": {
        types: "./dist/project-tools.d.ts",
        import: "./dist/project-tools.js",
      },
      "./scopes": {
        types: "./dist/scopes.d.ts",
        import: "./dist/scopes.js",
      },
    })

    const barrel = readFileSync(
      resolve(packageDirectory, "src/index.ts"),
      "utf8"
    )
    expect(barrel).toBe(
      [
        'export * from "./access-token.js"',
        'export * from "./project-tools.js"',
        'export * from "./scopes.js"',
        "",
      ].join("\n")
    )

  })
})
