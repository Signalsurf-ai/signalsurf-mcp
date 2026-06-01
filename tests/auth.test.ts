import { describe, expect, it } from "vitest"

import {
  assertCanWrite,
  resolveStdioContext,
  resolveTokenContext,
  sha256Hex,
} from "../src/auth.js"
import type { AppConfig } from "../src/config.js"
import { UserFacingError } from "../src/errors.js"

describe("auth", () => {
  it("resolves hashed bearer tokens to a product context", () => {
    const context = resolveTokenContext(
      {
        authDisabled: false,
        directContext: undefined,
        tokenEntries: [
          {
            name: "agent",
            tokenSha256: sha256Hex("secret-token"),
            productId: "00000000-0000-4000-8000-000000000001",
            userId: "00000000-0000-4000-8000-000000000002",
            role: "editor",
          },
        ],
      },
      "secret-token"
    )

    expect(context).toEqual({
      productId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      role: "editor",
      tokenName: "agent",
    })
  })

  it("rejects invalid tokens", () => {
    expect(() =>
      resolveTokenContext(
        {
          authDisabled: false,
          directContext: undefined,
          tokenEntries: [
            {
              tokenSha256: sha256Hex("secret-token"),
              productId: "00000000-0000-4000-8000-000000000001",
              role: "viewer",
            },
          ],
        },
        "wrong"
      )
    ).toThrow(UserFacingError)
  })

  it("prevents viewer tokens from writing", () => {
    expect(() =>
      assertCanWrite({
        productId: "00000000-0000-4000-8000-000000000001",
        role: "viewer",
      })
    ).toThrow("write access")
  })

  it("uses SIGNALSURF_MCP_TOKEN before direct stdio context", () => {
    const config: AppConfig = {
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-role",
      transport: "stdio",
      authMode: "env",
      trustProxy: false,
      host: "127.0.0.1",
      port: 3333,
      path: "/mcp",
      allowedHosts: ["127.0.0.1"],
      authDisabled: false,
      stdioToken: "token-context",
      directContext: {
        productId: "00000000-0000-4000-8000-000000000099",
        role: "owner",
      },
      tokenEntries: [
        {
          name: "stdio-token",
          tokenSha256: sha256Hex("token-context"),
          productId: "00000000-0000-4000-8000-000000000001",
          role: "viewer",
        },
      ],
    }

    expect(resolveStdioContext(config)).toMatchObject({
      productId: "00000000-0000-4000-8000-000000000001",
      role: "viewer",
      tokenName: "stdio-token",
    })
  })

  it("falls back to direct context for stdio when no token is configured", () => {
    const config: AppConfig = {
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-role",
      transport: "stdio",
      authMode: "env",
      trustProxy: false,
      host: "127.0.0.1",
      port: 3333,
      path: "/mcp",
      allowedHosts: ["127.0.0.1"],
      authDisabled: false,
      directContext: {
        productId: "00000000-0000-4000-8000-000000000001",
        role: "editor",
      },
      tokenEntries: [],
    }

    expect(resolveStdioContext(config)).toEqual(config.directContext)
  })

  it("rejects auth-disabled mode without direct product context", () => {
    const config: AppConfig = {
      supabaseUrl: "https://example.supabase.co",
      supabaseServiceRoleKey: "service-role",
      transport: "stdio",
      authMode: "env",
      trustProxy: false,
      host: "127.0.0.1",
      port: 3333,
      path: "/mcp",
      allowedHosts: ["127.0.0.1"],
      authDisabled: true,
      tokenEntries: [],
    }

    expect(() => resolveStdioContext(config)).toThrow(
      "SIGNALSURF_MCP_AUTH_DISABLED requires SIGNALSURF_MCP_PRODUCT_ID"
    )
  })
})
