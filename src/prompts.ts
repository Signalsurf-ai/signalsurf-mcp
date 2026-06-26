import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"

type PromptArgs = { databaseId?: string; productId?: string }

function productLine(args: PromptArgs): string {
  return args.productId
    ? `Use productId ${args.productId} on every product-scoped call.`
    : "If get_context reports multiple products, pass the chosen productId on every call."
}

export function buildEnrichTablePrompt(args: PromptArgs): string {
  const dbLine = args.databaseId
    ? `Target databaseId: ${args.databaseId} (already resolved — skip discovery).`
    : "No databaseId given yet — resolve it first."

  return `You are operating SignalSurf to enrich a whole table. The SignalSurf brain fills each cell server-side; your job is to set up, trigger, and poll — not to fill cells by hand.

${dbLine}
${productLine(args)}

Follow these steps in order:
1. Call get_context. ${args.productId ? "" : "Pick the productId if multiple are returned. "}${args.databaseId ? "" : "Then call list_tables and choose the target table's databaseId."}
2. Call get_enrichment_context(databaseId${args.databaseId ? `="${args.databaseId}"` : ""}) to load brand context, the table schema, popular existing values, and field conventions.
3. For each column you want to enrich: call enable_quick_surf(databaseId, fieldKey, whatToDo). Write whatToDo using the brand context and schema from step 2, and follow the field conventions (e.g. reuse popular values; lowercase-dash-singular for tag arrays). Optionally set runCondition to only fill rows that meet a gate.
4. Call run_quick_surf(databaseId, fieldKey, scope="all") for each enabled column to backfill every row (capped at 1000).
5. Poll with wait_for_surf_job / list_surf_jobs until jobs finish, then report which columns were filled and any skipped rows.

Never pass a null or guessed id — always resolve real ids in steps 1–2 first.`
}

export function buildSetUpSurfPointPrompt(args: PromptArgs): string {
  return `You are setting up a new SignalSurf surf point (playbook). A surf point watches one or more signal sources and the server brain routes matches into target tables; your job is to create and configure it, then trigger a first run.

${productLine(args)}

Follow these steps in order:
1. Call get_context${args.productId ? "" : " and pick the productId if multiple are returned"}.
2. Decide the target table(s): call list_tables and pick the databaseId(s) this surf point should write into (use create_table first if the table does not exist yet).
3. Call create_surf_point({ name, databaseIds }) to create the playbook. Keep the returned surfPointId.
4. Attach a signal source: call create_signal({ surfPointId, type, ... }). Choose the type that matches the source (platform, custom-pull, rss, webhook, web-monitor, github, etc.). A webhook signal returns a callable webhookUrl.
5. (Optional) Tune behavior with update_surf_point: set scoring_rubric and surf_prompt, and attach product tools via toolConfigPatch.auto_tool_ids (discover ids with list_product_tools).
6. Trigger a first run with run_surf_point({ surfPointId }), then poll with wait_for_surf_job / list_surf_jobs and report the result.

Never pass a null or guessed id — resolve productId, databaseId, and surfPointId from the calls above before using them.`
}

export function buildBuildLeadListPrompt(args: PromptArgs): string {
  const dbLine = args.databaseId
    ? `Write leads into databaseId: ${args.databaseId} (already resolved).`
    : "No target databaseId given yet — resolve or create one first."

  return `You are building a lead list in SignalSurf using Deepline. Deepline search and enrichment require a Deepline integration key on the product, and enrichment spends credits only on a hit.

${dbLine}
${productLine(args)}

Follow these steps in order:
1. Call get_context${args.productId ? "" : " and pick the productId if multiple are returned"}. Confirm the product has a Deepline integration key (the deepline_* tools fail without one).
2. Choose the target table for leads (list_tables, or create_table), then call get_enrichment_context(databaseId${args.databaseId ? `="${args.databaseId}"` : ""}) to learn its schema so you map fields correctly.
3. Find prospects: call deepline_search_people (or deepline_search_companies) with Apollo-shaped filters (e.g. person_titles, person_seniorities, person_locations, organization_num_employees_ranges as ["11,50"]). These return preview rows + match counts; emails are NOT included here.
4. For each prospect, call create_table_row mapping the preview fields onto the schema from step 2 (follow the field conventions).
5. Find emails: call deepline_enrich_contact({ firstName, lastName, domain|companyName }) per lead. Credits are spent only on a hit; misses are free.
6. Write each found email back with update_table_row, then report how many leads were created and enriched.

Never pass a null or guessed id — resolve productId and databaseId from the calls above first.`
}

type PromptDefinition = {
  name: string
  title: string
  description: string
  build: (args: PromptArgs) => string
}

const PROMPTS: PromptDefinition[] = [
  {
    name: "enrich_table",
    title: "Enrich a table (Quick Surf)",
    description:
      "Guided workflow to enrich an entire SignalSurf table column-by-column using Quick Surf, with the server brain filling each cell.",
    build: buildEnrichTablePrompt,
  },
  {
    name: "set_up_surf_point",
    title: "Set up a surf point (playbook)",
    description:
      "Guided workflow to create a SignalSurf surf point, attach a signal source, configure scoring/tools, and trigger a first run.",
    build: buildSetUpSurfPointPrompt,
  },
  {
    name: "build_lead_list",
    title: "Build a lead list (Deepline)",
    description:
      "Guided workflow to find prospects with Deepline, write them into a table, and enrich verified emails.",
    build: buildBuildLeadListPrompt,
  },
]

export const PROMPT_CATALOG = PROMPTS.map(({ name, title, description }) => ({
  name,
  title,
  description,
}))

export function registerPrompts(server: McpServer): void {
  for (const prompt of PROMPTS) {
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema: {
          databaseId: z.string().optional(),
          productId: z.string().optional(),
        },
      },
      (args) => ({
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text: prompt.build(args) },
          },
        ],
      })
    )
  }
}
