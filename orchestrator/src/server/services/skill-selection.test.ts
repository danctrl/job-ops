import type { JobBrief } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  collectBriefTerms,
  enforceSkillGuardrails,
  type SkillItem,
  type TailoredSkillGroup,
} from "./skill-selection";

function makeItem(name: string, keywords: string[]): SkillItem {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
    description: "",
    level: 3,
    keywords,
    visible: true,
  };
}

function total(groups: TailoredSkillGroup[]): number {
  return groups.reduce((n, g) => n + g.keywords.length, 0);
}

function allKeywords(groups: TailoredSkillGroup[]): string[] {
  return groups.flatMap((g) => g.keywords);
}

const MASTER: SkillItem[] = [
  makeItem("Programming", ["Python", "JavaScript", "TypeScript", "HTML5"]),
  makeItem("DevOps", ["Docker", "Podman", "CI/CD"]),
  makeItem("Business", ["Strategy & Management", "Account Management"]),
];

describe("collectBriefTerms", () => {
  it("merges, normalizes and dedupes the three brief lists", () => {
    const brief: JobBrief = {
      role_summary: "",
      skills_and_domain_highlights: ["Kubernetes", "  CI/CD "],
      tools_mentioned: ["kubernetes", "Terraform"],
      they_want: ["CI/CD"],
      company_offers: [],
      missing_or_unclear: [],
    };
    expect(collectBriefTerms(brief)).toEqual([
      "kubernetes",
      "ci/cd",
      "terraform",
    ]);
  });
});

describe("enforceSkillGuardrails", () => {
  it("drops keywords the LLM invented (not in the master)", () => {
    const llm: TailoredSkillGroup[] = [
      { name: "Programming", keywords: ["Python", "Rust"] },
    ];
    const result = enforceSkillGuardrails(llm, MASTER, {
      minTotal: 1,
      maxTotal: 50,
    });
    expect(allKeywords(result)).toContain("Python");
    expect(allKeywords(result)).not.toContain("Rust");
  });

  it("keeps a wording variant of a real skill (HTML ~ HTML5)", () => {
    const llm: TailoredSkillGroup[] = [
      { name: "Programming", keywords: ["HTML"] },
    ];
    const result = enforceSkillGuardrails(llm, MASTER, {
      minTotal: 1,
      maxTotal: 50,
    });
    expect(allKeywords(result)).toContain("HTML");
  });

  it("keeps an ATS dual-term that embeds a real skill (Docker (containers))", () => {
    const llm: TailoredSkillGroup[] = [
      { name: "DevOps", keywords: ["Docker (containers)"] },
    ];
    const result = enforceSkillGuardrails(llm, MASTER, {
      minTotal: 1,
      maxTotal: 50,
    });
    expect(allKeywords(result)).toContain("Docker (containers)");
  });

  it("dedupes keywords across groups", () => {
    const llm: TailoredSkillGroup[] = [
      { name: "A", keywords: ["Python"] },
      { name: "B", keywords: ["python"] },
    ];
    const result = enforceSkillGuardrails(llm, MASTER, {
      minTotal: 1,
      maxTotal: 50,
      minPerGroup: 0,
    });
    expect(total(result)).toBe(1);
  });

  it("caps the total number of keywords", () => {
    const llm: TailoredSkillGroup[] = [
      {
        name: "Programming",
        keywords: ["Python", "JavaScript", "TypeScript", "HTML5"],
      },
    ];
    const result = enforceSkillGuardrails(llm, MASTER, {
      minTotal: 1,
      maxTotal: 2,
      minPerGroup: 0,
    });
    expect(total(result)).toBe(2);
  });

  it("backfills from the master when the LLM returns too few (never sparse)", () => {
    const llm: TailoredSkillGroup[] = [
      { name: "Programming", keywords: ["Python"] },
    ];
    const result = enforceSkillGuardrails(llm, MASTER, {
      minTotal: 5,
      maxTotal: 50,
    });
    expect(total(result)).toBeGreaterThanOrEqual(5);
    expect(allKeywords(result)).toContain("Python");
  });

  it("never returns empty when the master has skills, even if the LLM gave nothing", () => {
    expect(
      total(enforceSkillGuardrails([], MASTER, { minTotal: 6 })).valueOf(),
    ).toBeGreaterThanOrEqual(6);
    expect(
      total(enforceSkillGuardrails(null, MASTER, { minTotal: 6 })),
    ).toBeGreaterThanOrEqual(6);
  });

  it("forces LOCKED ('Always') groups to appear even if the LLM omitted them", () => {
    const llm: TailoredSkillGroup[] = [
      { name: "DevOps", keywords: ["Docker", "Podman", "CI/CD"] },
    ];
    const result = enforceSkillGuardrails(llm, MASTER, {
      minTotal: 1,
      maxTotal: 50,
      lockedGroupIds: ["programming", "business"],
    });
    const names = result.map((g) => g.name);
    expect(names).toContain("Programming");
    expect(names).toContain("Business");
  });

  it("does NOT force-inject groups that are only AI-selectable (default)", () => {
    const llm: TailoredSkillGroup[] = [
      { name: "DevOps", keywords: ["Docker", "Podman", "CI/CD"] },
    ];
    const result = enforceSkillGuardrails(llm, MASTER, {
      minTotal: 1,
      maxTotal: 50,
    });
    expect(result.map((g) => g.name)).toEqual(["DevOps"]);
  });

  it("drops EXCLUDED ('Don't select') groups even if the LLM returns them", () => {
    const llm: TailoredSkillGroup[] = [
      { name: "DevOps", keywords: ["Docker"] },
      { name: "Business", keywords: ["Strategy & Management"] },
    ];
    const result = enforceSkillGuardrails(llm, MASTER, {
      minTotal: 1,
      maxTotal: 50,
      excludedGroupIds: ["business"],
    });
    expect(result.map((g) => g.name)).not.toContain("Business");
  });

  it("keeps LOCKED groups represented even under a tight cap", () => {
    const llm: TailoredSkillGroup[] = [
      {
        name: "Programming",
        keywords: ["Python", "JavaScript", "TypeScript", "HTML5"],
      },
      { name: "DevOps", keywords: ["Docker", "Podman", "CI/CD"] },
    ];
    const result = enforceSkillGuardrails(llm, MASTER, {
      minTotal: 1,
      maxTotal: MASTER.length,
      lockedGroupIds: MASTER.map((m) => m.id),
    });
    expect(result.map((g) => g.name).sort()).toEqual(
      MASTER.map((m) => m.name).sort(),
    );
    for (const g of result) expect(g.keywords.length).toBeGreaterThanOrEqual(1);
  });

  it("returns empty only when the master itself is empty", () => {
    expect(
      enforceSkillGuardrails([{ name: "X", keywords: ["Y"] }], []),
    ).toEqual([]);
  });
});
