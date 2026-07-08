import { beforeEach, describe, expect, it, vi } from "vitest";

const { callJsonMock, createConfiguredLlmServiceMock, resolveLlmModelMock } =
  vi.hoisted(() => ({
    callJsonMock: vi.fn(),
    createConfiguredLlmServiceMock: vi.fn(),
    resolveLlmModelMock: vi.fn(),
  }));

vi.mock("@infra/logger", () => ({
  logger: {
    warn: vi.fn(),
  },
}));

vi.mock("./modelSelection", () => ({
  createConfiguredLlmService: createConfiguredLlmServiceMock,
  resolveLlmModel: resolveLlmModelMock,
}));

import { logger } from "@infra/logger";
import { generateJobBrief } from "./job-brief";

describe("generateJobBrief", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveLlmModelMock.mockResolvedValue("gemini-flash");
    createConfiguredLlmServiceMock.mockResolvedValue({
      callJson: callJsonMock,
    });
  });

  it("extracts and serializes a UI-ready job brief", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        role_summary: "Build internal platform tools.",
        skills_and_domain_highlights: [
          "React",
          "Node.js",
          "PostgreSQL",
          "Terraform",
        ],
        tools_mentioned: ["Terraform"],
        they_want: ["TypeScript", "React"],
        company_offers: ["Mentorship"],
        missing_or_unclear: ["Sponsorship not stated"],
      },
    });

    const result = await generateJobBrief("We need React and Node.js.", {
      jobId: "job-1",
    });

    expect(resolveLlmModelMock).toHaveBeenCalledWith("scoring");
    expect(callJsonMock).toHaveBeenCalledWith(
      expect.objectContaining({
        model: "gemini-flash",
        jobId: "job-1",
        messages: [
          expect.objectContaining({
            role: "system",
            content: expect.stringContaining("Your job is NOT to judge"),
          }),
          expect.objectContaining({
            role: "user",
            content: expect.stringContaining("We need React and Node.js."),
          }),
        ],
      }),
    );
    expect(result).toBeTruthy();
    expect(JSON.parse(result as string)).toEqual({
      role_summary: "Build internal platform tools.",
      // Terraform is a named tool, so it is dropped from the skill highlights.
      skills_and_domain_highlights: ["React", "Node.js", "PostgreSQL"],
      tools_mentioned: ["Terraform"],
      they_want: ["TypeScript", "React"],
      company_offers: ["Mentorship"],
      // The brief now carries only content gaps; structural gaps are derived
      // from the canonical job row on the client (computeStructuralGaps).
      missing_or_unclear: ["Sponsorship not stated"],
    });
  });

  it("keeps only content gaps and drops LLM structural duplicates", async () => {
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        structured: {
          company_name: "Acme GmbH",
          location: "Berlin, Germany",
          work_mode: "hybrid",
          contract_type: "full-time",
          seniority_level: "senior",
          salary_range: "", // still unknown → keeps the salary label
        },
        role_summary: "Operate platform infrastructure.",
        skills_and_domain_highlights: ["Kubernetes"],
        tools_mentioned: [],
        they_want: ["Go"],
        company_offers: ["Remote budget"],
        missing_or_unclear: [
          "Salary not disclosed", // structural dup → filtered out
          "Reporting line unclear", // real content gap → kept
        ],
      },
    });

    const result = await generateJobBrief("JD", { jobId: "job-2" });

    // Structural restatements are dropped; only genuine content gaps remain.
    expect(JSON.parse(result as string).missing_or_unclear).toEqual([
      "Reporting line unclear",
    ]);
  });

  it("returns null when the model call fails", async () => {
    callJsonMock.mockResolvedValue({
      success: false,
      error: "nope",
    });

    await expect(
      generateJobBrief("JD", { jobId: "job-1" }),
    ).resolves.toBeNull();
    expect(logger.warn).toHaveBeenCalledWith(
      "Job extraction failed",
      expect.objectContaining({ jobId: "job-1", error: "nope" }),
    );
  });

  it("returns null for missing descriptions without calling the model", async () => {
    await expect(generateJobBrief("   ")).resolves.toBeNull();
    expect(callJsonMock).not.toHaveBeenCalled();
  });
});
