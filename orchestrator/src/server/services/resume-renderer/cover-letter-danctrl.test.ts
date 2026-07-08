import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildDanctrlCoverLetterDocument,
  type RenderCoverLetterPdfArgs,
} from "./cover-letter";

const template = readFileSync(
  join(__dirname, "cover-letter-templates", "danctrl-cover-letter.tex"),
  "utf8",
);

const baseArgs: RenderCoverLetterPdfArgs = {
  renderer: "latex",
  theme: "classic",
  latexTheme: "danctrl",
  name: "Daniel Guntermann",
  contactLine: "",
  personal: {
    phone: "+49 160 90294318",
    email: "d.guntermann@me.com",
    website: "https://danctrl.dev",
    socialLinks: [
      { network: "GitHub", username: "danctrl", url: null },
      { network: "LinkedIn", username: "danielguntermann", url: null },
    ],
    quote: "Be the change.",
  },
  date: "June 18, 2026",
  recipientLines: ["MERCH MY DAY", "Berlin, Germany"],
  salutation: "Dear Hiring Manager,",
  paragraphs: ["First paragraph.", "Second paragraph with R&D budget."],
  closing: "Sincerely,",
  outputPath: "",
  jobId: "cl-test",
};

describe("danctrl cover letter builder", () => {
  it("builds the Awesome-CV header from structured personal info", () => {
    const tex = buildDanctrlCoverLetterDocument(template, baseArgs);
    expect(tex).toContain("\\name{\\textcolor{awesome}{Dan}iel}{Guntermann}");
    expect(tex).toContain("\\mobile{+49 160 90294318}");
    expect(tex).toContain("\\email{d.guntermann@me.com}");
    expect(tex).toContain("\\homepage{danctrl.dev}");
    expect(tex).toContain("\\headersociallinks{");
    expect(tex).toContain("\\href{https://github.com/danctrl}{\\faGithub");
    expect(tex).toContain(
      "\\href{https://www.linkedin.com/in/danielguntermann}{\\faLinkedin",
    );
    expect(tex).toContain("\\quote{``Be the change.''}");
  });

  it("splits the recipient into name and address", () => {
    const tex = buildDanctrlCoverLetterDocument(template, baseArgs);
    expect(tex).toContain("\\recipient{MERCH MY DAY}{Berlin, Germany}");
    expect(tex).toContain("\\letterdate{June 18, 2026}");
    expect(tex).toContain("\\letteropening{Dear Hiring Manager,}");
    expect(tex).toContain("\\letterclosing{Sincerely,}");
  });

  it("renders and escapes the body paragraphs", () => {
    const tex = buildDanctrlCoverLetterDocument(template, baseArgs);
    expect(tex).toContain("First paragraph.");
    expect(tex).toContain("Second paragraph with R\\&D budget.");
    // No unsubstituted placeholders remain.
    expect(tex).not.toContain("__PERSONAL_INFO__");
    expect(tex).not.toContain("__BODY__");
    expect(tex).not.toContain("__RECIPIENT_NAME__");
  });

  it("omits social commands when the corresponding data is absent", () => {
    const tex = buildDanctrlCoverLetterDocument(template, {
      ...baseArgs,
      personal: { email: "only@example.com" },
    });
    expect(tex).toContain("\\email{only@example.com}");
    expect(tex).not.toContain("\\headersociallinks{");
    expect(tex).not.toContain("\\quote{");
  });
});
