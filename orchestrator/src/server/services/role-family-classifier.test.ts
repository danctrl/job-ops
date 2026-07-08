import { describe, expect, it } from "vitest";
import {
  buildRoleFamilyPrompt,
  type ClassifiableJob,
  chunk,
  cleanRoleFamily,
  mapClassifications,
} from "./role-family-classifier";

const jobs: ClassifiableJob[] = [
  { id: "a", title: "Senior DevOps Engineer", employer: "Acme" },
  { id: "b", title: "Product Manager", employer: null },
];

describe("chunk", () => {
  it("splits into fixed-size batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunk([], 3)).toEqual([]);
  });
});

describe("cleanRoleFamily", () => {
  it("normalizes whitespace and caps length", () => {
    expect(cleanRoleFamily("  DevOps   Engineer  ")).toBe("DevOps Engineer");
    expect(cleanRoleFamily("x".repeat(80)).length).toBe(60);
  });
});

describe("buildRoleFamilyPrompt", () => {
  it("includes each job id/title and the known families", () => {
    const prompt = buildRoleFamilyPrompt(jobs);
    expect(prompt).toContain("a | Senior DevOps Engineer | Acme");
    expect(prompt).toContain("b | Product Manager");
    expect(prompt).not.toContain("b | Product Manager |"); // no trailing employer
    expect(prompt).toContain("DevOps Engineer"); // from known families list
  });
});

describe("mapClassifications", () => {
  it("keeps valid ids, drops unknown ids and empty families", () => {
    const mapped = mapClassifications(jobs, [
      { jobId: "a", roleFamily: "DevOps Engineer" },
      { jobId: "b", roleFamily: "  " },
      { jobId: "ghost", roleFamily: "Hallucinated" },
    ]);
    expect(mapped.get("a")).toBe("DevOps Engineer");
    expect(mapped.has("b")).toBe(false);
    expect(mapped.has("ghost")).toBe(false);
  });
});
