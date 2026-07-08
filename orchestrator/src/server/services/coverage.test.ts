import type { JobBrief } from "@shared/types";
import { describe, expect, it } from "vitest";
import { computeCoverage } from "./coverage";

function brief(overrides: Partial<JobBrief> = {}): JobBrief {
  return {
    role_summary: "",
    skills_and_domain_highlights: [],
    tools_mentioned: [],
    they_want: [],
    company_offers: [],
    missing_or_unclear: [],
    ...overrides,
  };
}

describe("computeCoverage", () => {
  it("scores the fraction of brief terms present in the CV", () => {
    const b = brief({
      skills_and_domain_highlights: ["Kubernetes", "Terraform"],
      tools_mentioned: ["Docker"],
    });
    const result = computeCoverage(b, {
      headline: "Platform Engineer",
      summary: "I work with Kubernetes and Docker daily.",
      skills: [{ name: "Ops", keywords: ["Docker"] }],
      experienceBullets: [],
    });
    // Kubernetes + Docker present, Terraform missing -> 2/3
    expect(result.covered).toBe(2);
    expect(result.total).toBe(3);
    expect(result.score).toBe(67);
    expect(result.missing).toContain("terraform");
  });

  it("counts terms found in experience bullets", () => {
    const b = brief({ skills_and_domain_highlights: ["Ansible"] });
    const result = computeCoverage(b, {
      headline: "",
      summary: "",
      skills: [],
      experienceBullets: ["Automated servers with Ansible playbooks."],
    });
    expect(result.score).toBe(100);
  });

  it("matches case-insensitively and as whole words", () => {
    const b = brief({ tools_mentioned: ["CI/CD"] });
    const result = computeCoverage(b, {
      summary: "Built ci/cd pipelines.",
      skills: [],
    });
    expect(result.score).toBe(100);
  });

  it("covers a multi-word term when most of its tokens appear separately", () => {
    const b = brief({ they_want: ["customer support triage"] });
    const result = computeCoverage(b, {
      summary: "Handled support cases and issue triage for customers.",
      skills: [],
    });
    expect(result.score).toBe(100);
  });

  it("returns null score when the brief has no terms", () => {
    const result = computeCoverage(brief(), { summary: "anything" });
    expect(result.score).toBeNull();
    expect(result.total).toBe(0);
  });
});
