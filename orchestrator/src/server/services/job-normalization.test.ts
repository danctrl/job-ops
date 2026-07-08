import type { CreateJobInput } from "@shared/types/jobs";
import { describe, expect, it } from "vitest";
import { normalizeJobDescription, validateJobInput } from "./job-normalization";

const baseJob: CreateJobInput = {
  source: "linkedin",
  title: "DevOps Engineer",
  employer: "ACME",
  jobUrl: "https://example.com/jobs/1",
};

describe("normalizeJobDescription", () => {
  it("converts HTML (hiringcafe-style) to Markdown", () => {
    const html =
      "<h2>About the role</h2><p>We build <strong>reliable</strong> systems.</p><ul><li>Kubernetes</li><li>Terraform</li></ul>";
    const md = normalizeJobDescription(html) ?? "";
    expect(md).not.toContain("<");
    expect(md).toContain("## About the role");
    expect(md).toContain("**reliable**");
    expect(md).toMatch(/[-*]\s+Kubernetes/);
    expect(md).toMatch(/[-*]\s+Terraform/);
  });

  it("decodes HTML entities during conversion", () => {
    expect(normalizeJobDescription("<p>R&amp;D &amp; DevOps</p>")).toBe(
      "R&D & DevOps",
    );
  });

  it("passes through existing Markdown untouched (LinkedIn-style)", () => {
    const markdown = "We are a **top** team\n\n- Ship code\n- Own systems";
    expect(normalizeJobDescription(markdown)).toBe(markdown);
  });

  it("keeps escaped-Markdown artifacts as valid Markdown", () => {
    // JobSpy emits escaped hyphens; these render fine in a Markdown renderer.
    expect(normalizeJobDescription("Top\\-Adressen in der IT")).toBe(
      "Top\\-Adressen in der IT",
    );
  });

  it("passes through plain text (startupjobs-style)", () => {
    expect(normalizeJobDescription("Join our mission to build things.")).toBe(
      "Join our mission to build things.",
    );
  });

  it("collapses excess blank lines and trims", () => {
    expect(normalizeJobDescription("  A\n\n\n\nB  ")).toBe("A\n\nB");
  });

  it("returns null for null/empty", () => {
    expect(normalizeJobDescription(null)).toBeNull();
    expect(normalizeJobDescription("   ")).toBeNull();
  });
});

describe("validateJobInput", () => {
  it("accepts a well-formed job", () => {
    expect(validateJobInput(baseJob)).toEqual({ ok: true });
  });

  it("rejects empty/whitespace title", () => {
    const result = validateJobInput({ ...baseJob, title: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("title");
  });

  it("rejects empty employer", () => {
    const result = validateJobInput({ ...baseJob, employer: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("employer");
  });

  it("rejects a malformed jobUrl", () => {
    const result = validateJobInput({ ...baseJob, jobUrl: "not-a-url" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("jobUrl");
  });
});
