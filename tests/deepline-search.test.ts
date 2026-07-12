import { afterEach, describe, expect, it, vi } from "vitest";

import { buildDeeplineSearchPayload } from "../src/deepline-search.js";
import { DEEPLINE_TOOL_IDS } from "../src/deepline.js";

function leafConditions(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.flatMap(leafConditions);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (typeof record.field === "string") return [record];
  return Object.values(record).flatMap(leafConditions);
}

describe("Deepline managed search routing", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults company and people search to Crustdata V3", () => {
    expect(DEEPLINE_TOOL_IDS.searchPeople()).toBe("crustdata_v3_person_search");
    expect(DEEPLINE_TOOL_IDS.searchCompanies()).toBe(
      "crustdata_v3_company_search"
    );
  });

  it("translates company ICP filters to Crustdata V3", () => {
    const payload = buildDeeplineSearchPayload(
      "crustdata_v3_company_search",
      "companies",
      {
        q_organization_keyword_tags: ["B2B SaaS"],
        organization_locations: ["United States"],
        organization_num_employees_ranges: ["11,50"],
        funding_stages: ["Seed", "Series A"],
        technologies: ["HubSpot", "Salesforce"],
        activeJobCount: { min: 2, max: 20 },
      },
      5
    );

    expect(payload.limit).toBe(5);
    expect(payload.sorts).toEqual([
      { column: "headcount.total", order: "desc" },
    ]);
    expect(payload.fields).toContain("hiring.openings_count");
    expect(payload.fields).not.toContain("locations.country");
    expect(payload.fields).not.toContain("locations.headquarters");
    expect(leafConditions(payload.filters)).toEqual(
      expect.arrayContaining([
        { field: "locations.country", type: "in", value: ["USA"] },
        { field: "headcount.total", type: "=>", value: 11 },
        { field: "headcount.total", type: "=<", value: 50 },
        { field: "hiring.openings_count", type: "=>", value: 2 },
        { field: "hiring.openings_count", type: "=<", value: 20 },
        {
          field: "technographics.technologies.name",
          type: "in",
          value: ["HubSpot", "Salesforce"],
        },
        {
          field: "funding.last_round_type",
          type: "in",
          value: ["seed", "series_a"],
        },
      ])
    );
  });

  it("rejects people constraints on company search instead of silently broadening", () => {
    expect(() =>
      buildDeeplineSearchPayload(
        "crustdata_v3_company_search",
        "companies",
        {
          company: { locations: ["United States"] },
          people: { titles: ["VP Sales"] },
        },
        5
      )
    ).toThrow(/people/);
  });

  it("translates people filters to Crustdata V3", () => {
    const payload = buildDeeplineSearchPayload(
      "crustdata_v3_person_search",
      "people",
      { person_titles: ["VP of Sales"], person_seniorities: ["vp"] },
      3
    );

    expect(payload).toMatchObject({
      limit: 3,
      filters: {
        op: "and",
        conditions: expect.arrayContaining([
          {
            field: "experience.employment_details.current.seniority_level",
            type: "in",
            value: ["Vice President"],
          },
        ]),
      },
    });
  });

  it("preserves Apollo payloads only for an explicit override", () => {
    vi.stubEnv("DEEPLINE_PROSPECT_SEARCH_TOOL_ID", "apollo_search_people");
    const toolId = DEEPLINE_TOOL_IDS.searchPeople();
    expect(toolId).toBe("apollo_search_people");
    expect(
      buildDeeplineSearchPayload(
        toolId,
        "people",
        { person_titles: ["VP Sales"] },
        3
      )
    ).toEqual({ person_titles: ["VP Sales"], per_page: 3 });
  });

  it("preserves legacy name and keyword constraints", () => {
    expect(
      buildDeeplineSearchPayload(
        "crustdata_v3_company_search",
        "companies",
        { q_organization_name: "Acme" },
        5
      )
    ).toMatchObject({
      filters: {
        conditions: expect.arrayContaining([
          expect.objectContaining({
            conditions: [expect.objectContaining({ value: "Acme" })],
          }),
        ]),
      },
    });
    expect(
      buildDeeplineSearchPayload(
        "crustdata_v3_person_search",
        "people",
        { q_keywords: "revenue" },
        5
      )
    ).toMatchObject({
      filters: {
        conditions: expect.arrayContaining([
          expect.objectContaining({ op: "or" }),
        ]),
      },
    });
  });

  it("keeps multiple employee ranges as alternatives", () => {
    const payload = buildDeeplineSearchPayload(
      "crustdata_v3_company_search",
      "companies",
      { organization_num_employees_ranges: ["1,10", "51,100"] },
      5
    );
    expect(payload).toMatchObject({
      filters: {
        conditions: expect.arrayContaining([
          expect.objectContaining({
            op: "or",
            conditions: [
              expect.objectContaining({ op: "and" }),
              expect.objectContaining({ op: "and" }),
            ],
          }),
        ]),
      },
    });
  });

  it("accepts provider-neutral employeeRanges", () => {
    const payload = buildDeeplineSearchPayload(
      "crustdata_v3_company_search",
      "companies",
      {
        company: {
          employeeRanges: [
            { min: 1, max: 10 },
            { min: 51, max: 100 },
          ],
        },
      },
      5
    );
    expect(payload).toMatchObject({
      filters: {
        conditions: expect.arrayContaining([
          expect.objectContaining({
            op: "or",
            conditions: [
              expect.objectContaining({ op: "and" }),
              expect.objectContaining({ op: "and" }),
            ],
          }),
        ]),
      },
    });
  });

  it("rejects unsupported filters instead of broadening a paid search", () => {
    expect(() =>
      buildDeeplineSearchPayload(
        "crustdata_v3_company_search",
        "companies",
        { unsupported_filter: true },
        5
      )
    ).toThrow(/unsupported_filter/);
    expect(() =>
      buildDeeplineSearchPayload(
        "apollo_search_people",
        "people",
        { person_title: ["VP Sales"] },
        5
      )
    ).toThrow(/person_title/);
    expect(() =>
      buildDeeplineSearchPayload(
        "apollo_company_search",
        "companies",
        { activeJobCount: { min: 1 } },
        5
      )
    ).toThrow(/activeJobCount/);
  });
});
