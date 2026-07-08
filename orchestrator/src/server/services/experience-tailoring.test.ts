import { describe, expect, it } from "vitest";
import {
  enforceExperienceGuardrails,
  extractExperienceBullets,
  type MasterExperienceItem,
} from "./experience-tailoring";

const MASTER: MasterExperienceItem[] = [
  {
    company: "Apple Retail Germany",
    summary:
      "Reduced wait times by 45% across 10-15 cases per shift.\nBuilt CI/CD pipelines.",
  },
];

describe("extractExperienceBullets", () => {
  it("splits newline bullets and strips HTML lists", () => {
    expect(extractExperienceBullets("a\nb")).toEqual(["a", "b"]);
    expect(
      extractExperienceBullets("<ul><li>one</li><li>two</li></ul>"),
    ).toEqual(["one", "two"]);
  });
});

describe("enforceExperienceGuardrails", () => {
  it("keeps rephrased bullets that preserve the original numbers (matched by company)", () => {
    const result = enforceExperienceGuardrails(
      [
        {
          company: "Apple Retail Germany",
          bullets: [
            "Cut wait times 45% while resolving 10-15 cases per shift.",
            "Automated delivery with CI/CD pipelines.",
          ],
        },
      ],
      MASTER,
    );
    expect(result).toHaveLength(1);
    expect(result[0].bullets[0]).toContain("45%");
  });

  it("matches company case-insensitively / with loose whitespace", () => {
    const result = enforceExperienceGuardrails(
      [{ company: "  apple   retail germany ", bullets: ["Built CI/CD."] }],
      MASTER,
    );
    expect(result).toHaveLength(1);
  });

  it("falls back to the original bullets when a number was fabricated", () => {
    const result = enforceExperienceGuardrails(
      [
        {
          company: "Apple Retail Germany",
          bullets: ["Boosted revenue by 90% single-handedly."],
        },
      ],
      MASTER,
    );
    expect(result[0].bullets).toEqual(
      extractExperienceBullets(MASTER[0].summary),
    );
  });

  it("caps the bullet count to the original", () => {
    const result = enforceExperienceGuardrails(
      [{ company: "Apple Retail Germany", bullets: ["a", "b", "c", "d"] }],
      MASTER,
    );
    expect(result[0].bullets).toHaveLength(2);
  });

  it("drops entries whose company has no master match (no invented experience)", () => {
    const result = enforceExperienceGuardrails(
      [{ company: "Ghost Corp", bullets: ["Invented job."] }],
      MASTER,
    );
    expect(result).toEqual([]);
  });

  it("falls back when a tailored bullet is much longer than the original (keeps one-line)", () => {
    const longBullet = `Reduced wait times ${"and improved operations ".repeat(8)}per shift.`;
    const result = enforceExperienceGuardrails(
      [
        {
          company: "Apple Retail Germany",
          bullets: [longBullet, "Built CI/CD."],
        },
      ],
      MASTER,
    );
    expect(result[0].bullets).toEqual(
      extractExperienceBullets(MASTER[0].summary),
    );
  });

  it("falls back when a bullet is unrelated to the original (anti-invention)", () => {
    const result = enforceExperienceGuardrails(
      [
        {
          company: "Apple Retail Germany",
          bullets: ["Orchestrated blockchain synergy paradigms globally."],
        },
      ],
      MASTER,
    );
    expect(result[0].bullets).toEqual(
      extractExperienceBullets(MASTER[0].summary),
    );
  });

  it("returns [] for empty input", () => {
    expect(enforceExperienceGuardrails(null, MASTER)).toEqual([]);
    expect(enforceExperienceGuardrails([], MASTER)).toEqual([]);
  });
});
