import { createJob } from "@shared/testing/factories.js";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { JobBriefPane } from "./JobBriefPane";

vi.mock("framer-motion", async () => {
  const actual =
    await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    useReducedMotion: () => true,
  };
});

describe("JobBriefPane", () => {
  it("renders the UI-ready brief fields", () => {
    const job = createJob({
      suitabilityScore: 82,
      suitabilityReason: "Good fit because the stack matches.",
      jobBrief: JSON.stringify({
        role_summary: "Build internal workflow tools.",
        skills_and_domain_highlights: ["Node.js", "PostgreSQL"],
        tools_mentioned: ["Slack"],
        they_want: ["TypeScript", "React"],
        company_offers: ["Mentorship"],
        missing_or_unclear: ["Sponsorship not stated"],
      }),
    });

    render(<JobBriefPane job={job} />);

    expect(screen.getByText("Build internal workflow tools.")).toBeVisible();
    expect(screen.getByText("TypeScript")).toBeVisible();
    expect(screen.getByText("React")).toBeVisible();
    expect(screen.getByText("Node.js")).toBeVisible();
    expect(screen.getByText("PostgreSQL")).toBeVisible();
    expect(screen.getByText("Slack")).toBeVisible();
    expect(screen.getByText("Mentorship")).toBeVisible();
    expect(screen.getByText("Sponsorship not stated")).toBeVisible();
  });

  it("falls back to legacy `specifics` for highlights", () => {
    const job = createJob({
      jobBrief: JSON.stringify({
        role_summary: "Legacy brief shape.",
        they_want: [],
        specifics: ["Kubernetes", "Terraform"],
        company_offers: [],
        practical_details: [],
        missing_or_unclear: [],
        repeated_signals: [],
      }),
    });

    render(<JobBriefPane job={job} />);

    expect(screen.getByText("Highlights")).toBeVisible();
    expect(screen.getByText("Kubernetes")).toBeVisible();
    expect(screen.getByText("Terraform")).toBeVisible();
  });

  it("falls back when the brief is missing", () => {
    render(
      <JobBriefPane
        job={createJob({
          jobBrief: null,
          suitabilityReason: "Fallback fit reason.",
        })}
      />,
    );

    expect(screen.getByText("Fallback fit reason.")).toBeVisible();
    expect(
      screen.getByText("Recalculate match to generate a concise JD brief."),
    ).toBeVisible();
  });

  it("does not render empty sections", () => {
    const job = createJob({
      jobBrief: JSON.stringify({
        role_summary: "Maintain data pipelines.",
        skills_and_domain_highlights: [],
        tools_mentioned: [],
        they_want: [],
        company_offers: [],
        missing_or_unclear: [],
      }),
    });

    render(<JobBriefPane job={job} />);

    expect(screen.getByText("Maintain data pipelines.")).toBeVisible();
    expect(screen.queryByText("They want")).not.toBeInTheDocument();
    expect(screen.queryByText("Highlights")).not.toBeInTheDocument();
    expect(screen.queryByText("Tools")).not.toBeInTheDocument();
  });
});
