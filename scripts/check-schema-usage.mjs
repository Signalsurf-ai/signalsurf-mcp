#!/usr/bin/env node
// SIG-2672: every table, column, and RPC argument this server names must exist
// in production. FakeSupabase answers any name, so the suite stayed green while
// the SIG-2318 renames broke every tool-mode call. This reads the committed
// production snapshot instead.
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const snapshot = JSON.parse(
  readFileSync(path.join(root, "schema/public-snapshot.json"), "utf8")
)

/** PostgREST column filters that take a column name as their first argument. */
const COLUMN_FILTERS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "contains",
  "containedBy",
  "overlaps",
  "order",
  "filter",
]

const problems = []

function knownColumn(table, column) {
  const columns = snapshot.tables[table]
  return Array.isArray(columns) && columns.includes(column)
}

/**
 * `.select()` accepts embedded resources, aliases, casts, and json paths. Only
 * plain leading identifiers name a column of this table; everything else is
 * checked where it is defined, or not at all.
 */
function selectedColumns(select) {
  if (select.includes("(")) return []
  return select
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part && part !== "*" && !part.includes("->"))
    .map((part) => (part.includes(":") ? part.split(":")[1].trim() : part))
    .map((part) => part.split("::")[0].trim())
    .filter((part) => /^[a-z_][a-z0-9_]*$/.test(part))
}

/** Keys of an object literal written inline in an insert/update/upsert call. */
function payloadKeys(source, openIndex) {
  let depth = 0
  let index = openIndex
  for (; index < source.length; index += 1) {
    const character = source[index]
    if (character === "{") depth += 1
    else if (character === "}") {
      depth -= 1
      if (depth === 0) break
    }
  }
  const body = source.slice(openIndex, index + 1)
  const keys = []
  let nesting = 0
  for (const match of body.matchAll(
    /[{}]|(^|[,{])\s*([a-z_][a-z0-9_]*)\s*:/gm
  )) {
    if (match[0] === "{") nesting += 1
    else if (match[0] === "}") nesting -= 1
    else if (nesting === 1 && match[2]) keys.push(match[2])
  }
  return keys
}

/** The chained statement that follows one `.from("table")` call. */
function statementAfter(source, index) {
  const next = source.indexOf('.from("', index + 1)
  const end = next === -1 ? source.length : next
  return source.slice(index, end)
}

/**
 * Column lists live in `const X = ["a", "b"].join(", ")` constants, so a
 * `.select(X)` hides every name from a literal-only scan. That blind spot let
 * `workflows.project_id` survive the SIG-2672 port.
 */
function columnConstants(source) {
  const constants = new Map()
  for (const match of source.matchAll(
    /const ([A-Z][A-Z0-9_]*) = \[([^\]]*)\]\s*\.join\(/g
  )) {
    const columns = [...match[2].matchAll(/"([^"]+)"/g)].map((entry) => entry[1])
    if (columns.length > 0) constants.set(match[1], columns.join(", "))
  }
  return constants
}

function checkFile(file, source) {
  const constants = columnConstants(source)
  for (const match of source.matchAll(/\.from\("([a-z_]+)"\)/g)) {
    const table = match[1]
    const where = `${file}: ${table}`
    if (!snapshot.tables[table]) {
      problems.push(`${where} — table does not exist in production`)
      continue
    }
    const statement = statementAfter(source, match.index)
    const selects = [
      ...[...statement.matchAll(/\.select\(\s*"([^"]*)"/g)].map((m) => m[1]),
      ...[...statement.matchAll(/\.select\(\s*([A-Z][A-Z0-9_]*)\s*[,)]/g)]
        .map((m) => constants.get(m[1]))
        .filter(Boolean),
    ]
    for (const select of selects) {
      for (const column of selectedColumns(select)) {
        if (!knownColumn(table, column)) {
          problems.push(`${where}.select — no column "${column}"`)
        }
      }
    }
    const filters = new RegExp(
      `\\.(${COLUMN_FILTERS.join("|")})\\(\\s*"([a-z_][a-z0-9_]*)"`,
      "g"
    )
    for (const filter of statement.matchAll(filters)) {
      if (!knownColumn(table, filter[2])) {
        problems.push(`${where}.${filter[1]} — no column "${filter[2]}"`)
      }
    }
    for (const write of statement.matchAll(
      /\.(insert|update|upsert)\(\s*\{/g
    )) {
      const open = statement.indexOf("{", write.index)
      for (const key of payloadKeys(statement, open)) {
        if (!knownColumn(table, key)) {
          problems.push(`${where}.${write[1]} — no column "${key}"`)
        }
      }
    }
  }

  for (const call of source.matchAll(/\.rpc\(\s*"([a-z_]+)"\s*,\s*\{/g)) {
    const name = call[1]
    const signatures = snapshot.functions[name]
    if (!signatures) {
      problems.push(`${file}: rpc ${name} — function does not exist`)
      continue
    }
    const accepted = new Set(
      signatures
        .join(", ")
        .split(",")
        .map((argument) => argument.trim().split(/\s+/)[0])
        .filter(Boolean)
    )
    const open = source.indexOf("{", call.index)
    for (const key of payloadKeys(source, open)) {
      if (!accepted.has(key)) {
        problems.push(`${file}: rpc ${name} — no argument "${key}"`)
      }
    }
  }
}

const sourceDir = path.join(root, "src")
for (const entry of readdirSync(sourceDir)) {
  if (!entry.endsWith(".ts")) continue
  checkFile(entry, readFileSync(path.join(sourceDir, entry), "utf8"))
}

if (problems.length > 0) {
  console.error(
    `Schema usage does not match production (${problems.length} problems):`
  )
  for (const problem of problems) console.error(`  ${problem}`)
  console.error(
    "\nUpdate the code, or refresh schema/public-snapshot.json when production changed."
  )
  process.exit(1)
}

const tables = Object.keys(snapshot.tables).length
const functions = Object.keys(snapshot.functions).length
console.log(
  `Schema usage OK: ${tables} tables and ${functions} RPCs checked against production.`
)
