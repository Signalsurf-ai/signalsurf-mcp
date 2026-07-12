import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { DEEPLINE_TOOL_IDS } from "./deepline.js";

type PromptArgs = { databaseId?: string; productId?: string };

function productLine(args: PromptArgs): string {
  return args.productId
    ? `Use productId ${args.productId} on every product-scoped call.`
    : "If get_context reports multiple products, pass the chosen productId on every call.";
}

export function buildEnrichTablePrompt(args: PromptArgs): string {
  const dbLine = args.databaseId
    ? `Target databaseId: ${args.databaseId} (already resolved — skip discovery).`
    : "No databaseId given yet — resolve it first.";

  return `You are operating SignalSurf to enrich a whole table. The SignalSurf brain fills each cell server-side; your job is to set up, trigger, and poll — not to fill cells by hand.

${dbLine}
${productLine(args)}

Follow these steps in order:
1. Call get_context. ${
    args.productId ? "" : "Pick the productId if multiple are returned. "
  }${
    args.databaseId
      ? ""
      : "Then call list_tables and choose the target table's databaseId."
  }
2. Call get_enrichment_context(databaseId${
    args.databaseId ? `="${args.databaseId}"` : ""
  }) to load brand context, the table schema, popular existing values, and field conventions.
3. For each column you want to enrich: call enable_quick_surf(databaseId, fieldKey, whatToDo). Write whatToDo using the brand context and schema from step 2, and follow the field conventions (e.g. reuse popular values; lowercase-dash-singular for tag arrays). Optionally set runCondition to only fill rows that meet a gate.
4. Call run_quick_surf(databaseId, fieldKey, scope="all") for each enabled column to backfill missing cells among the newest 1000 rows. Populated cells and already-running jobs are skipped by default. Pass overwriteExisting=true only when the user explicitly asks to refresh existing values; for tables over 1000 rows, page read_table and run explicit entryIds for older rows.
5. Poll with wait_for_surf_job / list_surf_jobs until jobs finish, then report which columns were filled and any skipped rows.

Never pass a null or guessed id — always resolve real ids in steps 1–2 first.`;
}

export function buildSetUpSurfPointPrompt(args: PromptArgs): string {
  return `You are setting up a new SignalSurf surf point (playbook). A surf point watches one or more signal sources and the server brain routes matches into target tables; your job is to create and configure it, then trigger a first run.

${productLine(args)}

A surf point is a node graph (Flow V2): trigger → rule/agent/action/wait nodes, with branching edges. Simple ones can stay as a scoring rubric + surf prompt; multi-step or branching ones use the flow graph.

Follow these steps in order:
1. Call get_context${
    args.productId ? "" : " and pick the productId if multiple are returned"
  }.
2. Decide the target table(s): call list_tables and pick the databaseId(s) this surf point should write into (use create_table first if the table does not exist yet).
3. Call create_surf_point({ name, databaseIds }) to create the playbook. Keep the returned surfPointId.
4. Attach a signal source: call create_signal({ surfPointId, type, ... }). Choose the type that matches the source (platform, custom-pull, rss, webhook, web-monitor, github, etc.). A webhook signal returns a callable webhookUrl.
5. Simple surf point: tune behavior with update_surf_point — set scoring_rubric and surf_prompt, and attach product tools via toolConfigPatch.auto_tool_ids (ids from list_product_tools).
6. Multi-step / branching surf point: call describe_node_types to learn the node types and legal edge conditions, then build the graph with update_surf_point_flow (whole graph) or apply_flow_edits (incremental, atomic). Before mapping a create_row/object_sink node's fields, call get_node_upstream_context so the keys are real columns. For a contact-list email drip, use create_campaign instead of hand-wiring a sequence.
7. Trigger a first run with run_surf_point({ surfPointId }), then poll with wait_for_surf_job / list_surf_jobs and report the result.

Never pass a null or guessed id — resolve productId, databaseId, surfPointId, and node ids from the calls above before using them.`;
}

export function buildBuildLeadListPrompt(args: PromptArgs): string {
  const dbLine = args.databaseId
    ? `Existing databaseId: ${args.databaseId}. Inspect its schema first. Use it for the account phase if it is an outbound account table, or for the people phase if it is a contacts table; create only the missing companion table. If it matches neither phase, ask before creating a replacement.`
    : "No target databaseId given yet — resolve or create one first.";

  return `You are building a lead list in SignalSurf using Deepline. Deepline search and enrichment require a Deepline integration key on the product, and enrichment spends credits only on a hit.

${dbLine}
${productLine(args)}

Follow these steps in order:
1. Call get_context${
    args.productId ? "" : " and pick the productId if multiple are returned"
  }. Confirm the product has a Deepline integration key (the deepline_* tools fail without one).
2. Route the source before searching. If the request names a concrete URL, directory, portfolio, ecosystem, customer list, or other bounded corpus, use the client's web research capability first and preserve source URLs. If it asks for a broad TAM or provider-filterable company segment, call deepline_search_companies. If it explicitly asks for people or titles, qualify the account set first, then call deepline_search_people only for those companies.
3. Keep accounts and people separate. Inspect a matching account table first. If it is a compatible outbound account table below schema_version 3, upgrade it in place with update_table({ databaseId, template: "outbound_accounts" }); this applies the canonical v3 field types while preserving additive custom fields. Create a new v3 account table with create_table({ name: "Outbound Accounts", template: "outbound_accounts" }) only when no matching table exists or the supplied table is genuinely incompatible. Create a separate people table with create_table({ name: "Outbound Contacts", template: "contacts" }); then call create_relation_field({ databaseId: <contacts databaseId>, key: "account", targetDatabaseId: <account databaseId> }). Template schemas are canonical baselines: add request-specific fields such as is_yc, but do not downgrade email, URL, lifecycle, or relation field types. If a databaseId was provided, inspect it and use it only for the matching phase.
4. Call get_enrichment_context for the active table to learn its schema before mapping rows.
5. Dispatch the selected search with a bounded 5-10 row limit unless the user explicitly requests another size. Managed Deepline uses Crustdata V3 by default; Apollo is only a deployment-level BYOC override. Paid searches return APPROVAL_REQUIRED before dispatch; the approval request is the confirmation boundary and must show the filters and bounded limit. After approval, repeat the exact call with approvalRequestId. Search returns preview rows and match counts; emails are not included. Map returned hiring.openings_count to the account table's numeric active_job_count field.
6. If and only if the user explicitly asks to return each company's technology stack, keep the account batch at 10 or fewer. Before any paid confirmation, call read_table on the account table, normalize stored and selected domains, and remove existing domains from the paid set. Then call deepline_execute_tool with toolId ${DEEPLINE_TOOL_IDS.technographics()} and payload { company_domain: <domain> } once per remaining new account. Each exact paid call currently has its own approval boundary; tell the user before starting this temporary hosted-MCP flow. Materialize unique technology names into tech_stack as an array; do not flatten it into prose or replace it with a fixed enum. Skip generic TAM mapping.
7. Call create_table_row for each selected prospect, mapping fields onto the active table schema and preserving source evidence. Do not overwrite populated provider values through Quick Surf unless the user explicitly asks for a refresh.
8. Only after accounts are qualified, find contacts and call deepline_enrich_contact({ firstName, lastName, domain|companyName }) when email is needed. It uses the same one-time approval flow. Credits are spent only on a hit; misses are free.
9. Write found emails back to the contacts table with one update_table_rows call, then report account and contact counts separately.

Never pass a null or guessed id — resolve productId and databaseId from the calls above first.`;
}

type PromptDefinition = {
  name: string;
  title: string;
  description: string;
  build: (args: PromptArgs) => string;
};

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
];

export const PROMPT_CATALOG = PROMPTS.map(({ name, title, description }) => ({
  name,
  title,
  description,
}));

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
    );
  }
}
