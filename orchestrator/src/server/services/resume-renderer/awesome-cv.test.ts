import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildAwesomeCvDocument } from "./awesome-cv";
import type { ResumeRenderDocument } from "./types";

const template = readFileSync(
  join(__dirname, "latex-themes", "danctrl", "template.tex"),
  "utf8",
);

const baseDocument: ResumeRenderDocument = {
  name: "Daniel Guntermann",
  headline: null,
  location: "Berlin, Germany",
  picture: null,
  contactItems: [
    { text: "+49 160 90294318", kind: "phone" },
    {
      text: "d.guntermann@me.com",
      url: "mailto:d.guntermann@me.com",
      kind: "email",
    },
    { text: "danctrl.dev", url: "https://danctrl.dev", kind: "website" },
  ],
  profileItems: [
    {
      network: "GitHub",
      username: "danctrl",
      url: "https://github.com/danctrl",
    },
    {
      network: "LinkedIn",
      username: "danielguntermann",
      url: "https://linkedin.com/in/danielguntermann",
    },
  ],
  customFieldItems: [
    { title: "Quote", text: "Be the change you want to see." },
  ],
  summary: "DevOps Engineer based in Berlin.",
  experience: [
    {
      title: "Self-Employed",
      subtitle: "Freelance Technologist / Berlin, Germany",
      date: "Mar 2023 -- Present",
      bullets: [
        "Built a Podman homelab on RHEL.",
        "Ran a Traefik & Authentik stack.",
      ],
    },
  ],
  education: [
    {
      title: "HWR Berlin",
      subtitle: "B.A. Business Administration",
      secondarySubtitle: "Berlin, Germany",
      date: "Apr 2024 -- Present",
      bullets: [],
    },
  ],
  projects: [
    {
      title: "danctrl.dev",
      subtitle: "Astro, Cloudflare",
      url: "https://github.com/danctrl/portfolio",
      bullets: ["A privacy-first personal site."],
    },
  ],
  skillGroups: [
    { name: "DevOps & Infrastructure", keywords: ["Podman", "Ansible"] },
  ],
  languages: [{ language: "German", fluency: "Native", level: null }],
  interests: [],
  awards: [],
  certifications: [
    {
      title: "Full-Stack Web Developer",
      subtitle: "Le Wagon",
      date: "2022",
      bullets: [],
    },
  ],
  publications: [],
  volunteer: [],
  references: [],
};

describe("awesome-cv (danctrl) resume builder", () => {
  it("builds the Awesome-CV personal-information header from contacts and profiles", () => {
    const tex = buildAwesomeCvDocument(baseDocument, template);
    // First three letters of the first name are accented in the theme color.
    expect(tex).toContain("\\name{\\textcolor{awesome}{Dan}iel}{Guntermann}");
    expect(tex).toContain("\\mobile{+49 160 90294318}");
    expect(tex).toContain("\\email{d.guntermann@me.com}");
    expect(tex).toContain("\\homepage{danctrl.dev}");
    // Social profiles render generically into the header social row.
    expect(tex).toContain("\\headersociallinks{");
    expect(tex).toContain("\\href{https://github.com/danctrl}{\\faGithub");
    // The profile's own URL is preferred over the builder's constructed one.
    expect(tex).toContain(
      "\\href{https://linkedin.com/in/danielguntermann}{\\faLinkedin",
    );
    // Location renders as the header address line.
    expect(tex).toContain("\\address{Berlin, Germany}");
  });

  it("maps any known social network generically, incl. Instagram", () => {
    const tex = buildAwesomeCvDocument(
      {
        ...baseDocument,
        profileItems: [
          { network: "Instagram", username: "danctrl", url: null },
          {
            network: "Mastodon",
            username: "dan",
            url: "https://hsn.social/@dan",
          },
        ],
      },
      template,
    );
    expect(tex).toContain(
      "\\href{https://instagram.com/danctrl}{\\faInstagram",
    );
    // Full URL is preferred when the profile carries one (Mastodon).
    expect(tex).toContain("\\href{https://hsn.social/@dan}{\\faMastodon");
  });

  it("maps a Quote custom field to the header quote", () => {
    const tex = buildAwesomeCvDocument(baseDocument, template);
    expect(tex).toContain("\\quote{``Be the change you want to see.''}");
    // The quote field must not also render as a body section.
    expect(tex).not.toContain("\\cvsection{Custom Fields}");
  });

  it("splits the packed experience subtitle into position and location columns", () => {
    const tex = buildAwesomeCvDocument(baseDocument, template);
    expect(tex).toContain("\\cvsection{Experience}");
    expect(tex).toContain("{Freelance Technologist}");
    expect(tex).toContain("{Self-Employed}");
    expect(tex).toContain("{Berlin, Germany}");
    expect(tex).toContain("\\begin{cvitems}");
    expect(tex).toContain("\\item {Built a Podman homelab on RHEL.}");
  });

  it("renders skills as a category label with keyword pills", () => {
    const tex = buildAwesomeCvDocument(baseDocument, template);
    expect(tex).toContain("\\cvpillskill{DevOps \\& Infrastructure}");
    expect(tex).toContain("\\cvpill{Podman}");
    expect(tex).toContain("\\cvpill{Ansible}");
  });

  it("renders certifications as cvhonor with the title in the bold slot and no stray comma", () => {
    const tex = buildAwesomeCvDocument(baseDocument, template);
    expect(tex).toContain("\\begin{cvhonors}");
    // title in #1 (bold position slot), #2 empty -> "{title}\n    {}"
    expect(tex).toContain(
      "{Full-Stack Web Developer}\n    {}\n    {Le Wagon}\n    {2022}",
    );
  });

  it("renders projects with a hyperlinked title and the subtitle beneath it", () => {
    const tex = buildAwesomeCvDocument(baseDocument, template);
    expect(tex).toContain("\\cvsection{Projects}");
    // Default ("icon") style: the title is the hyperlink, with no link glyph.
    expect(tex).toContain(
      "\\href{https://github.com/danctrl/portfolio}{danctrl.dev}",
    );
    // The project title carries no trailing link glyph.
    expect(tex).not.toContain("danctrl.dev~\\faLink");
    // Subtitle (tech) is visible in the position slot; the description renders
    // as a plain paragraph (no bullet list).
    expect(tex).toContain("{Astro, Cloudflare}");
    expect(tex).toContain("{A privacy-first personal site.}");
  });

  it("prints the full URL beside the project in 'url' link style", () => {
    const tex = buildAwesomeCvDocument(
      { ...baseDocument, projectLinkStyle: "url" },
      template,
    );
    expect(tex).toContain(
      "\\href{https://github.com/danctrl/portfolio}{danctrl.dev}",
    );
    expect(tex).toContain(
      "\\href{https://github.com/danctrl/portfolio}{github.com/danctrl/portfolio}",
    );
  });

  it("renders a language name (Poppins) with a fluency pill and no colon", () => {
    const tex = buildAwesomeCvDocument(baseDocument, template);
    expect(tex).toContain("\\cvsection{Languages}");
    expect(tex).toContain("\\begin{cvpills}");
    expect(tex).toContain("{\\languagenamestyle{German}}");
    expect(tex).not.toContain("{\\languagenamestyle{German:}}");
    expect(tex).toContain("\\cvpill{Native}");
    // The old "Level 0" placeholder must never appear.
    expect(tex).not.toContain("Level 0");
  });

  it("splits a comma-separated fluency into multiple pills", () => {
    const tex = buildAwesomeCvDocument(
      {
        ...baseDocument,
        languages: [{ language: "English", fluency: "Fluent, C1", level: 4 }],
      },
      template,
    );
    expect(tex).toContain("{\\languagenamestyle{English}}");
    expect(tex).toContain("\\cvpill{Fluent}");
    expect(tex).toContain("\\cvpill{C1}");
    // With fluency text set, the numeric level is not mapped to a word.
    expect(tex).not.toContain("\\cvpill{Advanced}");
  });

  it("maps a numeric language level to a word when fluency text is absent", () => {
    const tex = buildAwesomeCvDocument(
      {
        ...baseDocument,
        languages: [{ language: "Spanish", fluency: null, level: 3 }],
      },
      template,
    );
    expect(tex).toContain("\\cvpill{Intermediate}");
  });

  it("renders publications/volunteer/references as paragraphs without forced bullets", () => {
    const tex = buildAwesomeCvDocument(
      {
        ...baseDocument,
        experience: [],
        certifications: [],
        volunteer: [
          {
            title: "Code Mentor",
            subtitle: "Berlin",
            date: "2023",
            bullets: ["Taught Git basics.", "Ran weekly sessions."],
          },
        ],
      },
      template,
    );
    expect(tex).toContain("\\cvsection{Volunteer}");
    expect(tex).toContain("{Taught Git basics. Ran weekly sessions.}");
    // No cvitems anywhere now that experience/certs are cleared.
    expect(tex).not.toContain("\\item");
  });

  it("escapes LaTeX special characters in content", () => {
    const tex = buildAwesomeCvDocument(
      { ...baseDocument, summary: "Cost down 50% & rising" },
      template,
    );
    expect(tex).toContain("50\\% \\& rising");
  });
});
