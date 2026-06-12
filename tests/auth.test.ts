import { describe, expect, it } from "vitest"

import {
  assertCanUseCapability,
  assertCanWrite,
  authorizedProducts,
  listContextCapabilities,
  resolveProductContext,
  resolveStdioContext,
  resolveTokenContext,
  sha256Hex,
} from "../src/auth.js"
import type { AppConfig } from "../src/config.js"
import { loadConfig } from "../src/config.js"
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

  it("prevents scoped tokens from using ungranted capabilities", () => {
    const context = {
      productId: "00000000-0000-4000-8000-000000000001",
      role: "editor" as const,
      scopes: ["mcp:tables.read", "mcp:tables.write"],
    }

    expect(() => assertCanUseCapability(context, "tables.write")).not.toThrow()
    expect(() => assertCanUseCapability(context, "tables.delete")).toThrow(
      "Token scope does not allow"
    )
    expect(() => assertCanUseCapability(context, "products.write")).toThrow(
      "Token scope does not allow"
    )
    expect(() => assertCanUseCapability(context, "surf_points.write")).toThrow(
      "Token scope does not allow"
    )
    expect(() =>
      assertCanUseCapability(context, "surf_points.execute")
    ).toThrow("Token scope does not allow")
    expect(() => assertCanUseCapability(context, "schemas.write")).toThrow(
      "Token scope does not allow"
    )
    expect(() => assertCanUseCapability(context, "sources.write")).toThrow(
      "Token scope does not allow"
    )
    expect(() =>
      assertCanUseCapability(context, "account_lists.write")
    ).toThrow("Token scope does not allow")
    expect(() =>
      assertCanUseCapability(context, "deepline.execute")
    ).toThrow("Token scope does not allow")
    expect(listContextCapabilities(context)).toEqual([
      "context.read",
      "tables.read",
      "tables.write",
    ])
  })

  it("grants Deepline read and execute through Deepline scopes", () => {
    const readContext = {
      productId: "00000000-0000-4000-8000-000000000001",
      role: "editor" as const,
      scopes: ["mcp:deepline.read"],
    }
    expect(listContextCapabilities(readContext)).toEqual([
      "context.read",
      "deepline.read",
    ])
    expect(() =>
      assertCanUseCapability(readContext, "deepline.execute")
    ).toThrow("Token scope does not allow")

    const writeContext = {
      ...readContext,
      scopes: ["mcp:deepline.write"],
    }
    expect(listContextCapabilities(writeContext)).toEqual([
      "context.read",
      "deepline.read",
      "deepline.enrich",
      "deepline.execute",
    ])
    expect(() =>
      assertCanUseCapability(writeContext, "deepline.execute")
    ).not.toThrow()
  })

  it("treats explicit empty scopes as no capability grant", () => {
    const context = {
      productId: "00000000-0000-4000-8000-000000000001",
      role: "editor" as const,
      scopes: [],
    }

    expect(() => assertCanUseCapability(context, "tables.read")).toThrow(
      "Token scope does not allow"
    )
    expect(listContextCapabilities(context)).toEqual([])
  })

  it("keeps unscoped editor tokens broad for manual-token compatibility", () => {
    expect(
      listContextCapabilities({
        productId: "00000000-0000-4000-8000-000000000001",
        role: "editor",
      })
    ).toEqual([
      "context.read",
      "products.write",
      "surf_points.read",
      "surf_points.write",
      "surf_points.execute",
      "surf_points.delete",
      "tables.read",
      "tables.write",
      "tables.delete",
      "schemas.read",
      "schemas.write",
      "sources.read",
      "sources.write",
      "account_lists.read",
      "account_lists.write",
      "deepline.read",
      "deepline.enrich",
      "deepline.execute",
    ])
  })

  it("requires explicit productId for multi-product contexts", () => {
    const context = {
      productId: "00000000-0000-4000-8000-000000000001",
      productIds: [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ],
      role: "editor" as const,
    }

    expect(() => resolveProductContext(context)).toThrow(
      "productId is required"
    )
    expect(
      resolveProductContext(context, "00000000-0000-4000-8000-000000000002")
    ).toMatchObject({
      productId: "00000000-0000-4000-8000-000000000002",
      productIds: context.productIds,
    })
    expect(() =>
      resolveProductContext(context, "00000000-0000-4000-8000-000000000099")
    ).toThrow("not authorized")
  })

  it("returns ordered authorized product metadata with id fallbacks", () => {
    expect(
      authorizedProducts({
        productId: "00000000-0000-4000-8000-000000000001",
        productIds: [
          "00000000-0000-4000-8000-000000000001",
          "00000000-0000-4000-8000-000000000002",
        ],
        products: [
          {
            productId: "00000000-0000-4000-8000-000000000002",
            name: "Second Product",
            organizationName: "Demo Workspace",
          },
        ],
        role: "editor",
      })
    ).toEqual([
      {
        productId: "00000000-0000-4000-8000-000000000001",
        name: "00000000-0000-4000-8000-000000000001",
        organizationId: null,
        organizationName: null,
      },
      {
        productId: "00000000-0000-4000-8000-000000000002",
        name: "Second Product",
        organizationId: null,
        organizationName: "Demo Workspace",
      },
    ])
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
      resourceUrl: "http://127.0.0.1:3333/mcp",
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
      resourceUrl: "http://127.0.0.1:3333/mcp",
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
      resourceUrl: "http://127.0.0.1:3333/mcp",
      allowedHosts: ["127.0.0.1"],
      authDisabled: true,
      tokenEntries: [],
    }

    expect(() => resolveStdioContext(config)).toThrow(
      "SIGNALSURF_MCP_AUTH_DISABLED requires SIGNALSURF_MCP_PRODUCT_ID"
    )
  })

  it("rejects static token config with an explicit empty scopes array", () => {
    expect(() =>
      loadConfig({
        SIGNALSURF_SUPABASE_URL: "https://example.supabase.co",
        SIGNALSURF_SUPABASE_SERVICE_ROLE_KEY: "service-role",
        SIGNALSURF_MCP_TOKENS: JSON.stringify([
          {
            tokenSha256: sha256Hex("token-context"),
            productId: "00000000-0000-4000-8000-000000000001",
            role: "editor",
            scopes: [],
          },
        ]),
      })
    ).toThrow(/too_small/i)
  })
})
