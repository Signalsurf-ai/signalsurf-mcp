#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const contractPath = path.join(repoRoot, "docs/surfer-mcp-parity.json");
const capabilitiesPath = path.join(repoRoot, "src/capabilities.ts");

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function sorted(values) {
  return [...values].sort((a, b) => a.localeCompare(b));
}

function parseJson(filePath) {
  const source = readText(filePath);
  assertNoDuplicateJsonKeys(source, filePath);
  return JSON.parse(source);
}

function assertNoDuplicateJsonKeys(source, filePath) {
  const duplicates = [];
  const stack = [];
  let i = 0;

  function skipWhitespace() {
    while (/\s/.test(source[i] ?? "")) i += 1;
  }

  function parseString() {
    let value = "";
    i += 1;
    while (i < source.length) {
      const char = source[i];
      if (char === "\\") {
        value += char + (source[i + 1] ?? "");
        i += 2;
        continue;
      }
      if (char === '"') {
        i += 1;
        return value;
      }
      value += char;
      i += 1;
    }
    return value;
  }

  while (i < source.length) {
    const char = source[i];
    if (char === "{") {
      stack.push(new Set());
      i += 1;
      continue;
    }
    if (char === "}") {
      stack.pop();
      i += 1;
      continue;
    }
    if (char === '"') {
      const key = parseString();
      skipWhitespace();
      if (source[i] === ":" && stack.length > 0) {
        const current = stack[stack.length - 1];
        if (current.has(key)) duplicates.push(key);
        current.add(key);
      }
      continue;
    }
    i += 1;
  }

  if (duplicates.length > 0) {
    throw new Error(
      `${filePath} has duplicate JSON keys: ${sorted(new Set(duplicates)).join(
        ", ",
      )}`,
    );
  }
}

function parsePublicMcpToolNames(filePath) {
  const source = readText(filePath);
  const match = source.match(
    /export const PUBLIC_MCP_TOOLS = \{([\s\S]*?)\n\} as const satisfies Record<PublicMcpToolName, PublicMcpToolDefinition>/,
  );
  if (!match) {
    throw new Error("Could not find PUBLIC_MCP_TOOLS in src/capabilities.ts");
  }

  const names = new Set();
  for (const entry of match[1].matchAll(/^\s*([A-Za-z0-9_]+):\s*\{/gm)) {
    names.add(entry[1]);
  }
  return names;
}

function mappedMcpTools(contract) {
  const names = new Set();
  for (const mapping of [
    contract.operationMappings ?? {},
    contract.standaloneMappings ?? {},
  ]) {
    for (const tools of Object.values(mapping)) {
      if (!Array.isArray(tools)) continue;
      for (const tool of tools) {
        names.add(tool);
      }
    }
  }
  return names;
}

function addFailure(failures, title, values) {
  if (values.length === 0) return;
  failures.push(
    `${title}:\n${values.map((value) => `  - ${value}`).join("\n")}`,
  );
}

const contract = parseJson(contractPath);
const registryTools = parsePublicMcpToolNames(capabilitiesPath);
const knownTools = new Set(contract.knownPublicMcpTools ?? []);
const mappedTools = mappedMcpTools(contract);
const failures = [];

addFailure(
  failures,
  "Parity contract maps to MCP tools missing from PUBLIC_MCP_TOOLS",
  sorted([...mappedTools].filter((name) => !registryTools.has(name))),
);
addFailure(
  failures,
  "Parity contract knownPublicMcpTools entries missing from PUBLIC_MCP_TOOLS",
  sorted([...knownTools].filter((name) => !registryTools.has(name))),
);
addFailure(
  failures,
  "PUBLIC_MCP_TOOLS entries missing from parity contract knownPublicMcpTools",
  sorted([...registryTools].filter((name) => !knownTools.has(name))),
);

if (failures.length > 0) {
  console.error("MCP Surfer parity registry check failed.");
  console.error("");
  console.error(failures.join("\n\n"));
  console.error("");
  console.error(
    "Update docs/surfer-mcp-parity.json when public MCP tools are added, removed, or renamed.",
  );
  process.exit(1);
}

console.log(
  `MCP Surfer parity registry OK: ${registryTools.size} public MCP tools and ${mappedTools.size} mapped tools checked.`,
);
