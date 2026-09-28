import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const packageDirectory = resolve(process.cwd(), "packages/mcp-contract")
describe("MCP contract consumer entrypoints", () => {
  it("publishes explicit NodeNext dist entrypoints", () => {
    const packageJson = JSON.parse(
      readFileSync(resolve(packageDirectory, "package.json"), "utf8")
    ) as {
      exports?: Record<string, { import: string; types: string }>
    }
    expect(packageJson.exports).toMatchObject({
      ".": { import: "./dist/index.js", types: "./dist/index.d.ts" },
      "./access-token": {
        import: "./dist/access-token.js",
        types: "./dist/access-token.d.ts",
      },
      "./registry": {
        import: "./dist/registry.js",
        types: "./dist/registry.d.ts",
      },
      "./web-tools": {
        import: "./dist/web-tools.js",
        types: "./dist/web-tools.d.ts",
      },
      "./scopes": {
        import: "./dist/scopes.js",
        types: "./dist/scopes.d.ts",
      },
    })

    const barrel = readFileSync(
      resolve(packageDirectory, "src/index.ts"),
      "utf8"
    )
    expect(barrel).toBe(
      [
        'export * from "./access-token.js"',
        'export * from "./registry.js"',
        'export * from "./web-tools.js"',
        'export * from "./scopes.js"',
        "",
      ].join("\n")
    )
  })
})
