import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

export function buildEnrichTablePrompt(args: {
  databaseId?: string
  productId?: string
}): string {
  const dbLine = args.databaseId
    ? `Target databaseId: ${args.databaseId} (already resolved — skip discovery).`
    : "No databaseId given yet — resolve it first."
  const productLine = args.productId
    ? `Use productId ${args.productId} on every product-scoped call.`
    : "If get_context reports multiple products, pass the chosen productId on every call."

  return `You are operating SignalSurf to enrich a whole table. The SignalSurf brain fills each cell server-side; your job is to set up, trigger, and poll — not to fill cells by hand.

${dbLine}
${productLine}

Follow these steps in order:
1. Call get_context. ${args.productId ? "" : "Pick the productId if multiple are returned. "}${args.databaseId ? "" : "Then call list_tables and choose the target table's databaseId."}
2. Call get_enrichment_context(databaseId${args.databaseId ? `="${args.databaseId}"` : ""}) to load brand context, the table schema, popular existing values, and field conventions.
3. For each column you want to enrich: call enable_quick_surf(databaseId, fieldKey, whatToDo). Write whatToDo using the brand context and schema from step 2, and follow the field conventions (e.g. reuse popular values; lowercase-dash-singular for tag arrays). Optionally set runCondition to only fill rows that meet a gate.
4. Call run_quick_surf(databaseId, fieldKey, scope="all") for each enabled column to backfill every row (capped at 1000).
5. Poll with wait_for_surf_job / list_surf_jobs until jobs finish, then report which columns were filled and any skipped rows.

Never pass a null or guessed id — always resolve real ids in steps 1–2 first.`
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "enrich_table",
    {
      title: "Enrich a table (Quick Surf)",
      description:
        "Guided workflow to enrich an entire SignalSurf table column-by-column using Quick Surf, with the server brain filling each cell.",
      argsSchema: {
        databaseId: z.string().optional(),
        productId: z.string().optional(),
      },
    },
    (args) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: buildEnrichTablePrompt(args),
          },
        },
      ],
    })
  )
}
