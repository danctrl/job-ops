import type { Job, ResumeProfile } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const callJsonMock = vi.fn();
const getProviderMock = vi.fn();
const getBaseUrlMock = vi.fn();

const settingsMocks = vi.hoisted(() => ({
  getSetting: vi.fn(),
  getEffectiveSettings: vi.fn(),
}));
const jobsRepoMocks = vi.hoisted(() => ({
  getJobById: vi.fn(),
  setJobCoverLetter: vi.fn(),
}));
const profileMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
}));
const rendererMocks = vi.hoisted(() => ({
  renderCoverLetterPdf: vi.fn(),
}));

vi.mock("../repositories/settings", () => settingsMocks);
vi.mock("@server/repositories/settings", () => settingsMocks);
vi.mock("@server/services/settings", () => ({
  getEffectiveSettings: settingsMocks.getEffectiveSettings,
}));
vi.mock("@server/repositories/jobs", () => jobsRepoMocks);
vi.mock("./profile", () => profileMocks);
vi.mock("./resume-renderer/cover-letter", () => rendererMocks);
vi.mock("./pdf-storage", () => ({
  getTenantCoverLetterPdfPath: (jobId: string) =>
    `/tmp/cover_letter_${jobId}.pdf`,
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, mkdir: vi.fn() };
});

vi.mock("./llm/service", () => ({
  LlmService: class {
    callJson = callJsonMock;
    getProvider = getProviderMock;
    getBaseUrl = getBaseUrlMock;
  },
}));

vi.mock("./writing-style", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./writing-style")>();
  return { ...actual, getWritingStyle: vi.fn() };
});

import {
  formatBasicsLocation,
  generateCoverLetter,
  rerenderCoverLetter,
} from "./cover-letter";
import { getWritingStyle } from "./writing-style";

describe("formatBasicsLocation", () => {
  it("returns a plain string location as-is", () => {
    expect(formatBasicsLocation("Berlin, Germany")).toBe("Berlin, Germany");
  });

  it("composes City, Region from a structured location object", () => {
    expect(formatBasicsLocation({ city: "Berlin", region: "Germany" })).toBe(
      "Berlin, Germany",
    );
  });

  it("falls back to country / countryCode / address", () => {
    expect(formatBasicsLocation({ city: "Berlin", country: "Germany" })).toBe(
      "Berlin, Germany",
    );
    expect(formatBasicsLocation({ city: "Berlin", countryCode: "DE" })).toBe(
      "Berlin, DE",
    );
    expect(formatBasicsLocation({ address: "Berlin, DE" })).toBe("Berlin, DE");
  });

  it("returns null for empty/missing location", () => {
    expect(formatBasicsLocation(null)).toBeNull();
    expect(formatBasicsLocation({})).toBeNull();
    expect(formatBasicsLocation("  ")).toBeNull();
  });
});

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: "job-1",
    title: "Platform Engineer",
    employer: "Acme GmbH",
    location: "Berlin",
    jobDescription: "We run Podman in production and value automation.",
    tailoredSummary: "Infra engineer focused on automation.",
    coverLetterPath: null,
    ...overrides,
  } as Job;
}

const profile: ResumeProfile = {
  basics: {
    name: "Daniel Guntermann",
    email: "dan@example.com",
    phone: "+49 123",
    url: "https://example.com",
    summary: "Existing summary",
  },
  sections: {
    experience: {
      items: [
        {
          id: "e1",
          company: "Prev Co",
          position: "DevOps Engineer",
          location: "Berlin",
          date: "2023",
          summary: "Automated CI with GitHub Actions.",
          visible: true,
        },
      ],
    },
  },
};

describe("generateCoverLetter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getProviderMock.mockReturnValue("openrouter");
    getBaseUrlMock.mockReturnValue("https://openrouter.ai");
    settingsMocks.getEffectiveSettings.mockResolvedValue({
      model: { value: "gpt-4o-mini" },
      llmProvider: { value: "openrouter" },
      llmBaseUrl: { value: null },
      llmPurposeOverrides: { value: {} },
      modelTailoring: { value: null },
    });
    settingsMocks.getSetting.mockResolvedValue(null);
    jobsRepoMocks.getJobById.mockResolvedValue(makeJob());
    jobsRepoMocks.setJobCoverLetter.mockResolvedValue(makeJob());
    profileMocks.getProfile.mockResolvedValue(profile);
    rendererMocks.renderCoverLetterPdf.mockResolvedValue(undefined);
    callJsonMock.mockResolvedValue({
      success: true,
      data: {
        body: "Para one about fit.\n\nPara two on experience.\n\nClose.",
      },
    });
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "confident",
      formality: "medium",
      constraints: "",
      doNotUse: "synergy",
      languageMode: "manual",
      manualLanguage: "english",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });
  });

  it("generates a cover letter, renders a PDF, and persists the path", async () => {
    const result = await generateCoverLetter("job-1");

    expect(result.success).toBe(true);
    expect(result.path).toBe("/tmp/cover_letter_job-1.pdf");
    expect(result.text).toBe(
      "Para one about fit.\n\nPara two on experience.\n\nClose.",
    );

    // prompt should carry concrete job + profile context
    const prompt = callJsonMock.mock.calls[0]?.[0]?.messages?.[0]?.content;
    expect(prompt).toContain("Platform Engineer");
    expect(prompt).toContain("Acme GmbH");
    expect(prompt).toContain("Podman");

    // renderer receives the split paragraphs
    const renderArgs = rendererMocks.renderCoverLetterPdf.mock.calls[0]?.[0];
    expect(renderArgs?.paragraphs).toHaveLength(3);
    expect(renderArgs?.name).toBe("Daniel Guntermann");
    // no stored settings -> registry defaults
    expect(renderArgs?.renderer).toBe("typst");
    expect(renderArgs?.theme).toBe("classic");

    expect(jobsRepoMocks.setJobCoverLetter).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "job-1",
        coverLetterPath: "/tmp/cover_letter_job-1.pdf",
        source: "generated",
      }),
    );
    // The generated body is persisted into the editable details blob.
    const savedDetails =
      jobsRepoMocks.setJobCoverLetter.mock.calls[0]?.[0]?.details;
    expect(savedDetails?.body).toContain("Para one about fit.");
  });

  it("passes the configured renderer + theme to the PDF renderer", async () => {
    settingsMocks.getSetting.mockImplementation((key: string) => {
      if (key === "coverLetterRenderer") return Promise.resolve("latex");
      if (key === "coverLetterTheme") return Promise.resolve("classic");
      return Promise.resolve(null);
    });

    const result = await generateCoverLetter("job-1");

    expect(result.success).toBe(true);
    const renderArgs = rendererMocks.renderCoverLetterPdf.mock.calls[0]?.[0];
    expect(renderArgs?.renderer).toBe("latex");
    expect(renderArgs?.theme).toBe("classic");
  });

  it("re-renders from saved details without calling the LLM", async () => {
    jobsRepoMocks.getJobById.mockResolvedValue(
      makeJob({
        coverLetterSource: "generated",
        coverLetterDetails: {
          body: "Edited body paragraph.",
          contactPerson: "Jane Doe",
        },
      }),
    );

    const result = await rerenderCoverLetter("job-1");

    expect(result.success).toBe(true);
    expect(callJsonMock).not.toHaveBeenCalled();
    const args = rendererMocks.renderCoverLetterPdf.mock.calls[0]?.[0];
    expect(args?.salutation).toBe("Dear Jane Doe,");
    expect(args?.paragraphs).toEqual(["Edited body paragraph."]);
  });

  it("renders round parentheses in the body as square brackets", async () => {
    jobsRepoMocks.getJobById.mockResolvedValue(
      makeJob({
        coverLetterSource: "generated",
        coverLetterDetails: {
          body: "I work with Infrastructure as Code (IaC) daily.",
          salutation: "Dear Team (Hiring),",
        },
      }),
    );

    const result = await rerenderCoverLetter("job-1");

    expect(result.success).toBe(true);
    const args = rendererMocks.renderCoverLetterPdf.mock.calls[0]?.[0];
    expect(args?.paragraphs).toEqual([
      "I work with Infrastructure as Code [IaC] daily.",
    ]);
    // Salutation is NOT passed through the transform.
    expect(args?.salutation).toBe("Dear Team (Hiring),");
  });

  it("localizes the letter envelope (date, salutation, closing) to German", async () => {
    vi.mocked(getWritingStyle).mockResolvedValue({
      tone: "confident",
      formality: "medium",
      constraints: "",
      doNotUse: "",
      languageMode: "manual",
      manualLanguage: "german",
      summaryMaxWords: null,
      maxKeywordsPerSkill: null,
    });
    jobsRepoMocks.getJobById.mockResolvedValue(
      makeJob({
        coverLetterSource: "generated",
        coverLetterDetails: { body: "Deutscher Absatz." },
      }),
    );

    const result = await rerenderCoverLetter("job-1");

    expect(result.success).toBe(true);
    const args = rendererMocks.renderCoverLetterPdf.mock.calls[0]?.[0];
    // No contact person -> generic German salutation, DIN closing (no comma).
    expect(args?.salutation).toBe("Sehr geehrte Damen und Herren,");
    expect(args?.closing).toBe("Mit freundlichen Grüßen");
    // German long date, e.g. "7. Juli 2026" (day-independent).
    expect(args?.date).toMatch(/^\d{1,2}\. \p{L}+ \d{4}$/u);
  });

  it("refuses to overwrite an uploaded cover letter", async () => {
    jobsRepoMocks.getJobById.mockResolvedValue(
      makeJob({ coverLetterSource: "uploaded" }),
    );

    const result = await generateCoverLetter("job-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Uploaded cover letter can't be overwritten. Delete it first to regenerate.",
    );
    expect(callJsonMock).not.toHaveBeenCalled();
    expect(rendererMocks.renderCoverLetterPdf).not.toHaveBeenCalled();
    expect(jobsRepoMocks.setJobCoverLetter).not.toHaveBeenCalled();
  });

  it("fails fast when the job does not exist", async () => {
    jobsRepoMocks.getJobById.mockResolvedValue(null);

    const result = await generateCoverLetter("missing");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Job not found");
    expect(callJsonMock).not.toHaveBeenCalled();
  });

  it("surfaces an error and skips rendering when the LLM call fails", async () => {
    callJsonMock.mockResolvedValue({ success: false, error: "rate limited" });

    const result = await generateCoverLetter("job-1");

    expect(result.success).toBe(false);
    expect(result.error).toContain("rate limited");
    expect(rendererMocks.renderCoverLetterPdf).not.toHaveBeenCalled();
    expect(jobsRepoMocks.setJobCoverLetter).not.toHaveBeenCalled();
  });

  it("fails when the generated body is empty", async () => {
    callJsonMock.mockResolvedValue({ success: true, data: { body: "   " } });

    const result = await generateCoverLetter("job-1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Cover letter body was empty");
    expect(rendererMocks.renderCoverLetterPdf).not.toHaveBeenCalled();
  });
});
