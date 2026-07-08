import type { ChatStyleManualLanguage } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCallJson } = vi.hoisted(() => ({ mockCallJson: vi.fn() }));

vi.mock("@server/services/modelSelection", () => ({
  resolveLlmModel: vi.fn().mockResolvedValue("test-model"),
  createConfiguredLlmService: vi
    .fn()
    .mockResolvedValue({ callJson: mockCallJson }),
}));

// Keep renderPromptTemplate real so the mocked LLM can read the field list out
// of the rendered prompt and echo it back translated (order-independent).
vi.mock("@server/services/prompt-templates", async (importActual) => {
  const actual =
    await importActual<typeof import("@server/services/prompt-templates")>();
  return {
    ...actual,
    getEffectivePromptTemplate: vi.fn().mockResolvedValue("{{fieldsJson}}"),
  };
});

vi.mock("@shared/language-detection", () => ({
  detectReactiveResumeV5Language: vi.fn(),
}));

import { detectReactiveResumeV5Language } from "@shared/language-detection";
import {
  bracketizeResumeProse,
  localizeResumeStaticText,
  translateResumeBody,
} from "./resume-translation";

const mockDetect = vi.mocked(detectReactiveResumeV5Language);

function sampleResume(): Record<string, unknown> {
  return {
    basics: { name: "Jane Doe", headline: "Software Engineer" },
    summary: { content: "<p>Experienced engineer.</p>" },
    sections: {
      experience: {
        items: [
          {
            company: "Acme GmbH",
            position: "Software Engineer",
            date: "2020 - Present",
            description:
              "<ul><li>Built CI/CD pipelines with Kubernetes.</li></ul>",
          },
        ],
      },
      projects: {
        items: [{ name: "Homelab", description: "<p>Self-hosted stack.</p>" }],
      },
      skills: {
        items: [{ name: "DevOps", keywords: ["Podman", "Traefik"] }],
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default mocked LLM: echo each field back prefixed with "DE:".
  mockCallJson.mockImplementation(
    async ({ messages }: { messages: Array<{ content: string }> }) => {
      const fields = JSON.parse(messages[0].content) as Array<{
        key: string;
        text: string;
      }>;
      return {
        success: true,
        data: {
          translations: fields.map((f) => ({
            key: f.key,
            text: `DE:${f.text}`,
          })),
        },
      };
    },
  );
});

describe("translateResumeBody", () => {
  it("no-ops when resume is already in the target language", async () => {
    mockDetect.mockReturnValue("german" as ChatStyleManualLanguage);
    const resume = sampleResume();

    const result = await translateResumeBody(resume, "german");

    expect(result).toBe(resume);
    expect(mockCallJson).not.toHaveBeenCalled();
  });

  it("no-ops when the source language cannot be detected", async () => {
    mockDetect.mockReturnValue(null);
    const resume = sampleResume();

    const result = await translateResumeBody(resume, "german");

    expect(result).toBe(resume);
    expect(mockCallJson).not.toHaveBeenCalled();
  });

  it("translates prose but preserves proper nouns, skills, and headline", async () => {
    mockDetect.mockReturnValue("english" as ChatStyleManualLanguage);
    const resume = sampleResume();

    const result = await translateResumeBody(resume, "german", "job-1");

    expect(mockCallJson).toHaveBeenCalledTimes(1);
    // Returns a fresh object, original untouched.
    expect(result).not.toBe(resume);

    const sections = result.sections as Record<string, any>;
    const exp = sections.experience.items[0];
    // Translated free-text.
    expect(exp.position).toBe("DE:Software Engineer");
    expect(exp.description).toContain("DE:");
    expect(sections.projects.items[0].name).toBe("DE:Homelab");
    expect((result.summary as any).content).toBe(
      "DE:<p>Experienced engineer.</p>",
    );
    // Preserved verbatim.
    expect(exp.company).toBe("Acme GmbH");
    expect(exp.date).toBe("2020 - Present");
    expect(sections.skills.items[0].keywords).toEqual(["Podman", "Traefik"]);
    expect((result.basics as any).headline).toBe("Software Engineer");

    // Original object was not mutated.
    expect((resume.summary as any).content).toBe(
      "<p>Experienced engineer.</p>",
    );
  });

  it("returns the original resume when the LLM call fails", async () => {
    mockDetect.mockReturnValue("english" as ChatStyleManualLanguage);
    mockCallJson.mockResolvedValueOnce({ success: false, error: "boom" });
    const resume = sampleResume();

    const result = await translateResumeBody(resume, "german");

    expect(result).toBe(resume);
  });
});

describe("localizeResumeStaticText", () => {
  function resumeWithTitlesAndDates(): Record<string, unknown> {
    return {
      summary: { title: "Summary", content: "…" },
      sections: {
        experience: {
          title: "Experience",
          items: [{ company: "Acme", period: "Mar 2023 - Present" }],
        },
        education: {
          title: "Education",
          items: [{ school: "TU", period: "September 2019 - July 2022" }],
        },
        projects: {
          // Custom heading must survive.
          title: "Key Projects",
          items: [{ name: "X", period: "Jan 2024 - Current" }],
        },
      },
    };
  }

  it("no-ops for an English target", () => {
    const resume = resumeWithTitlesAndDates();
    expect(localizeResumeStaticText(resume, "english")).toBe(resume);
  });

  it("localizes default section titles and date tokens to German", () => {
    const result = localizeResumeStaticText(
      resumeWithTitlesAndDates(),
      "german",
    );
    const sections = result.sections as Record<string, any>;

    expect(sections.experience.title).toBe("Berufserfahrung");
    expect(sections.education.title).toBe("Ausbildung");
    expect((result.summary as any).title).toBe("Zusammenfassung");
    // Dates: months + "Present"/"Current" → German, years untouched.
    expect(sections.experience.items[0].period).toBe("Mär 2023 - heute");
    expect(sections.education.items[0].period).toBe(
      "September 2019 - Juli 2022",
    );
    expect(sections.projects.items[0].period).toBe("Jan 2024 - heute");
  });

  it("preserves custom section titles", () => {
    const result = localizeResumeStaticText(
      resumeWithTitlesAndDates(),
      "german",
    );
    expect((result.sections as any).projects.title).toBe("Key Projects");
  });

  it("does not mutate the input", () => {
    const resume = resumeWithTitlesAndDates();
    localizeResumeStaticText(resume, "german");
    expect((resume.sections as any).experience.title).toBe("Experience");
    expect((resume.sections as any).experience.items[0].period).toBe(
      "Mar 2023 - Present",
    );
  });

  it("localizes Reactive Resume default headings (Skills, Volunteering)", () => {
    const result = localizeResumeStaticText(
      {
        sections: {
          skills: { title: "Skills", items: [] },
          volunteer: { title: "Volunteering", items: [] },
        },
      },
      "german",
    );
    const sections = result.sections as Record<string, any>;
    expect(sections.skills.title).toBe("Kompetenzen");
    expect(sections.volunteer.title).toBe("Ehrenamt");
  });
});

describe("bracketizeResumeProse", () => {
  it("swaps parens in prose + skills, preserving HTML tags", () => {
    const resume: Record<string, unknown> = {
      basics: {
        name: "Jane Doe",
        headline: "Engineer (Platform)",
        phone: "+49 (0)160 123",
        url: "https://x.test/wiki/Foo_(bar)",
      },
      summary: { content: "<p>Focus on IaC (infra as code).</p>" },
      sections: {
        experience: {
          items: [
            {
              company: "Acme (EU) GmbH",
              position: "Engineer (Senior)",
              description: "<ul><li>Built pipelines (CI/CD).</li></ul>",
            },
          ],
        },
        skills: {
          items: [{ name: "DevOps", keywords: ["Infrastructure as Code (IaC)"] }],
        },
      },
    };

    const result = bracketizeResumeProse(resume);
    const sections = result.sections as Record<string, any>;

    // Prose + skill keyword bracketized; HTML tags intact.
    expect((result.summary as any).content).toBe(
      "<p>Focus on IaC [infra as code].</p>",
    );
    expect(sections.experience.items[0].position).toBe("Engineer [Senior]");
    expect(sections.experience.items[0].description).toBe(
      "<ul><li>Built pipelines [CI/CD].</li></ul>",
    );
    expect(sections.skills.items[0].keywords).toEqual([
      "Infrastructure as Code [IaC]",
    ]);

    // Contact/proper-noun fields untouched.
    expect((result.basics as any).headline).toBe("Engineer (Platform)");
    expect((result.basics as any).phone).toBe("+49 (0)160 123");
    expect((result.basics as any).url).toBe("https://x.test/wiki/Foo_(bar)");
    expect(sections.experience.items[0].company).toBe("Acme (EU) GmbH");
  });

  it("does not mutate the input", () => {
    const resume: Record<string, unknown> = {
      summary: { content: "a (b)" },
      sections: { experience: { items: [{ position: "X (Y)" }] } },
    };
    bracketizeResumeProse(resume);
    expect((resume.summary as any).content).toBe("a (b)");
    expect((resume.sections as any).experience.items[0].position).toBe("X (Y)");
  });
});
