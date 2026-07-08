import { describe, expect, it } from "vitest";
import { normalizeJobTitle } from "./string";

describe("normalizeJobTitle", () => {
  it("strips worded gender tags", () => {
    expect(normalizeJobTitle("Cloud DevOps Engineer (all genders)")).toBe(
      "Cloud DevOps Engineer",
    );
    expect(normalizeJobTitle("Cloud & DevOps Engineer (all gender)")).toBe(
      "Cloud & DevOps Engineer",
    );
    expect(normalizeJobTitle("Support Engineer (human)")).toBe(
      "Support Engineer",
    );
  });

  it("strips slash/pipe gender combos in any order", () => {
    for (const combo of [
      "m/w/d",
      "w/m/d",
      "d/m/w",
      "f/m/d",
      "m/f/d",
      "m/f/x",
      "d/f/m",
      "gn",
    ]) {
      expect(normalizeJobTitle(`DevOps Engineer (${combo})`)).toBe(
        "DevOps Engineer",
      );
    }
  });

  it("strips a trailing star after the tag", () => {
    expect(normalizeJobTitle("Datacenter Network Engineer (m/w/d)*")).toBe(
      "Datacenter Network Engineer",
    );
  });

  it("removes a gender tag then truncates the separator tail", () => {
    expect(
      normalizeJobTitle("DevOps Engineer (d/m/w) – Betrieb & Entwicklung"),
    ).toBe("DevOps Engineer");
    expect(normalizeJobTitle("Senior DevOps Engineer (gn) – Lead Role")).toBe(
      "DevOps Engineer",
    );
  });

  it("lifts a leading level and strips gender", () => {
    expect(normalizeJobTitle("(Junior) Cloud-Native Developer (f/m/d)")).toBe(
      "Cloud-Native Developer",
    );
  });

  it("strips tool/qualifier parentheticals", () => {
    expect(normalizeJobTitle("DevOps Engineer (remote, full-time)")).toBe(
      "DevOps Engineer",
    );
    expect(
      normalizeJobTitle("Infrastructure Software Engineer (Kubernetes)"),
    ).toBe("Infrastructure Software Engineer");
    expect(normalizeJobTitle("Cloud DevOps Engineer (D|XK)")).toBe(
      "Cloud DevOps Engineer",
    );
  });

  it("moves location fragments out of the title", () => {
    expect(normalizeJobTitle("DevOps Engineer (m/w/d) in Hamburg")).toBe(
      "DevOps Engineer",
    );
    expect(normalizeJobTitle("Senior Backend Engineer in München")).toBe(
      "Backend Engineer",
    );
    expect(normalizeJobTitle("Platform Engineer (Berlin)")).toBe(
      "Platform Engineer",
    );
    expect(
      normalizeJobTitle(
        "Senior Infrastructure DevOps Engineer (100% Remote Germany)",
      ),
    ).toBe("Infrastructure DevOps Engineer");
    expect(normalizeJobTitle("DevOps Engineer - Berlin")).toBe(
      "DevOps Engineer",
    );
    expect(normalizeJobTitle("Cloud Engineer (Munich, Germany)")).toBe(
      "Cloud Engineer",
    );
    expect(normalizeJobTitle("Fullstack Developer remote")).toBe(
      "Fullstack Developer",
    );
  });

  it("truncates a separator tail even when it mentions remote", () => {
    expect(normalizeJobTitle("Senior Backend Engineer - remote friendly")).toBe(
      "Backend Engineer",
    );
  });

  it("does not mistake a domain phrase for a location", () => {
    expect(normalizeJobTitle("Data Engineer in Finance")).toBe(
      "Data Engineer in Finance",
    );
    expect(normalizeJobTitle("Software Engineer in Fintech")).toBe(
      "Software Engineer in Fintech",
    );
  });

  it("strips every parenthetical and lifts the leading level", () => {
    expect(
      normalizeJobTitle("Mid-level / Senior Platform Engineer (SRE) (m/w/d)"),
    ).toBe("Senior Platform Engineer");
  });

  it("keeps internal slash role lists but truncates separator tails", () => {
    expect(
      normalizeJobTitle(
        "Site Reliability Engineer - Kubernetes / Cloud / DevOps (m/w/d)",
      ),
    ).toBe("Site Reliability Engineer");
    expect(
      normalizeJobTitle(
        "Senior DevOps/Cloud Engineer GCP (all genders) - 100 % Remote",
      ),
    ).toBe("DevOps/Cloud Engineer GCP");
  });

  it("strips a bare trailing combo without parentheses", () => {
    expect(normalizeJobTitle("Data Engineer - m/w/d")).toBe("Data Engineer");
    expect(normalizeJobTitle("Data Engineer m/f/d")).toBe("Data Engineer");
  });

  it("leaves clean level-free titles unchanged", () => {
    expect(normalizeJobTitle("Platform Engineer")).toBe("Platform Engineer");
    expect(normalizeJobTitle("DevOps Engineer Mobile")).toBe(
      "DevOps Engineer Mobile",
    );
  });

  it("strips newer diversity tokens and slash-joined word combos", () => {
    expect(
      normalizeJobTitle("DevSecOps/DevOps Engineer (all identities)"),
    ).toBe("DevSecOps/DevOps Engineer");
    expect(normalizeJobTitle("Engineer (all genders / all identities)")).toBe(
      "Engineer",
    );
    expect(normalizeJobTitle("Engineer (FLINTA*)")).toBe("Engineer");
    expect(normalizeJobTitle("Ingenieur (mensch)")).toBe("Ingenieur");
  });

  it("lifts abbreviated seniority out of the title", () => {
    expect(normalizeJobTitle("(Sr.) DevOps Engineer")).toBe("DevOps Engineer");
    expect(normalizeJobTitle("Jr. Data Engineer")).toBe("Data Engineer");
    expect(normalizeJobTitle("(Sr.) DevOps Engineer (m/w/d)")).toBe(
      "DevOps Engineer",
    );
    expect(normalizeJobTitle("  Senior   SRE  ")).toBe("SRE");
  });

  it("keeps a bare specialization with no separator", () => {
    expect(normalizeJobTitle("DevOps Engineer Mobile")).toBe(
      "DevOps Engineer Mobile",
    );
    expect(normalizeJobTitle("DevOps & Data Architecture Intern")).toBe(
      "DevOps & Data Architecture Intern",
    );
  });
});
