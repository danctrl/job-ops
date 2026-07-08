// Builder that maps a LatexResumeDocument to Awesome-CV markup for the "danctrl"
// LaTeX theme. Kept independent of the Jake builder (latex.ts) on purpose: the
// two templates use entirely different command sets, and coupling them would make
// both harder to evolve. The small escaping helpers are duplicated rather than
// shared so each renderer can tune escaping for its own template.
import { getLatexResumeSectionTitles } from "./document";
import { composeHeaderSocialLinks, emphasizeNamePrefix } from "./header-social";
import type {
  LatexResumeContactItem,
  LatexResumeCustomFieldItem,
  LatexResumeDocument,
  LatexResumeEntry,
  LatexResumeOrderedSectionKey,
  LatexResumeSkillGroup,
} from "./types";

function normalizeText(value: string): string {
  // Preserve en/em dashes: XeLaTeX + Poppins render them faithfully and the
  // Awesome-CV design relies on them (e.g. the header quote). Only collapse
  // whitespace and the non-breaking hyphen.
  return value.replace(/‑/g, "-").replace(/\s+/g, " ").trim();
}

function escapeRawLatex(value: string): string {
  return value
    .replace(/\\/g, "￿")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}")
    .replace(/￿/g, "\\textbackslash{}");
}

/** Escape user text, converting a small set of inline HTML tags to LaTeX macros. */
function escapeText(value: string): string {
  const normalized = normalizeText(value);
  const parts = normalized.split(/(<\/?(?:strong|b|em|i)\b[^>]*>)/gi);
  const result: string[] = [];
  const tagStack: string[] = [];

  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("<") && part.endsWith(">")) {
      const lower = part.toLowerCase();
      if (lower.startsWith("<strong") || lower.startsWith("<b")) {
        result.push("\\textbf{");
        tagStack.push("bold");
      } else if (lower.startsWith("</strong") || lower.startsWith("</b>")) {
        tagStack.pop();
        result.push("}");
      } else if (lower.startsWith("<em") || lower.startsWith("<i")) {
        result.push("\\textit{");
        tagStack.push("italic");
      } else if (lower.startsWith("</em") || lower.startsWith("</i>")) {
        tagStack.pop();
        result.push("}");
      }
    } else {
      result.push(escapeRawLatex(part));
    }
  }
  while (tagStack.pop()) result.push("}");
  return result.join("");
}

function escapeUrl(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "￿")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/￿/g, "\\textbackslash{}");
}

function renderLink(label: string, url?: string | null): string {
  const safeLabel = escapeText(label);
  if (!url) return safeLabel;
  return `\\href{${escapeUrl(url)}}{${safeLabel}}`;
}

function cleanUrlForDisplay(url: string): string {
  return url
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/+$/, "");
}

function splitName(name: string): { first: string; last: string } {
  const trimmed = name.trim();
  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) return { first: trimmed, last: "" };
  return {
    first: trimmed.slice(0, spaceIndex),
    last: trimmed.slice(spaceIndex + 1),
  };
}

function findContact(
  items: LatexResumeContactItem[],
  kind: LatexResumeContactItem["kind"],
): LatexResumeContactItem | undefined {
  return items.find((item) => item.kind === kind);
}

const QUOTE_FIELD = /^(quote|tagline|motto|slogan)$/i;

function findQuote(items: LatexResumeCustomFieldItem[]): string | null {
  const field = items.find(
    (item) => item.title && QUOTE_FIELD.test(item.title),
  );
  if (!field) return null;
  return field.text.replace(/^[“"']+|[”"']+$/g, "").trim() || null;
}

/** Build the preamble personal-information block (\name, \mobile, \quote, ...). */
function buildPersonalInfo(document: LatexResumeDocument): string {
  const { first, last } = splitName(document.name);
  const lines: string[] = [
    `\\name{${emphasizeNamePrefix(first, escapeText)}}{${escapeText(last)}}`,
  ];

  if (document.headline) {
    lines.push(`\\position{${escapeText(document.headline)}}`);
  }

  if (document.location) {
    lines.push(`\\address{${escapeText(document.location)}}`);
  }

  const phone = findContact(document.contactItems, "phone");
  if (phone) lines.push(`\\mobile{${escapeText(phone.text)}}`);

  const email = findContact(document.contactItems, "email");
  if (email) lines.push(`\\email{${escapeText(email.text)}}`);

  const website = findContact(document.contactItems, "website");
  if (website) {
    lines.push(`\\homepage{${escapeText(cleanUrlForDisplay(website.text))}}`);
  }

  const socialLinks = composeHeaderSocialLinks(document.profileItems);
  if (socialLinks) lines.push(`\\headersociallinks{${socialLinks}}`);

  const quote = findQuote(document.customFieldItems);
  if (quote) lines.push(`\\quote{\`\`${escapeText(quote)}''}`);

  return lines.join("\n");
}

function renderCvItems(bullets: string[]): string {
  const items = bullets.filter((bullet) => bullet.trim().length > 0);
  if (items.length === 0) return "";
  return [
    "    {",
    "      \\begin{cvitems}",
    ...items.map((bullet) => `        \\item {${escapeText(bullet)}}`),
    "      \\end{cvitems}",
    "    }",
  ].join("\n");
}

/** Experience subtitle packs "position / location"; recover both halves. */
function splitPositionLocation(subtitle?: string | null): {
  position: string;
  location: string;
} {
  if (!subtitle) return { position: "", location: "" };
  const sep = subtitle.indexOf(" / ");
  if (sep === -1) return { position: subtitle, location: "" };
  return {
    position: subtitle.slice(0, sep),
    location: subtitle.slice(sep + 3),
  };
}

function renderExperienceEntry(entry: LatexResumeEntry): string {
  const { position, location } = splitPositionLocation(entry.subtitle);
  const desc = renderCvItems(entry.bullets);
  return [
    "  \\cventry",
    `    {${escapeText(position)}}`,
    `    {${renderLink(entry.title, entry.url)}}`,
    `    {${escapeText(location)}}`,
    `    {${escapeText(entry.date ?? "")}}`,
    desc || "    {}",
  ].join("\n");
}

/**
 * Same column layout as an experience entry, but the description renders as a
 * plain paragraph instead of a forced bullet list. Used for sections whose body
 * is free text the user typed (publications, volunteer, references) — they only
 * get bullets if they add them in the textbox themselves.
 */
function renderProseEntry(entry: LatexResumeEntry): string {
  // Share the project entry layout so every paragraph-bodied section
  // (projects, publications, volunteer, references) lines up identically:
  // title + date on one row, subtitle beneath, then the paragraph.
  const subtitle = entry.subtitle ? escapeText(entry.subtitle) : "";
  const paragraph = entry.bullets
    .filter((bullet) => bullet.trim().length > 0)
    .map((bullet) => escapeText(bullet))
    .join(" ");
  return [
    "  \\cvprojectentry",
    `    {${renderLink(entry.title, entry.url)}}`,
    `    {${escapeText(entry.date ?? "")}}`,
    `    {${subtitle}}`,
    `    {${paragraph}}`,
  ].join("\n");
}

function renderEducationEntry(entry: LatexResumeEntry): string {
  const desc = renderCvItems(entry.bullets);
  return [
    "  \\cventry",
    `    {${escapeText(entry.subtitle ?? "")}}`,
    `    {${renderLink(entry.title, entry.url)}}`,
    `    {${escapeText(entry.secondarySubtitle ?? "")}}`,
    `    {${escapeText(entry.date ?? "")}}`,
    desc || "    {}",
  ].join("\n");
}

type ProjectLinkStyle = "url" | "icon";

function renderProjectEntry(
  entry: LatexResumeEntry,
  linkStyle: ProjectLinkStyle,
): string {
  // Use the dedicated \cvprojectentry: title (left, hyperlinked) and date on a
  // single row, the keywords subtitle on its own line beneath (only when set, so
  // keyword-less projects don't get a gap), then the description as a plain
  // paragraph. In "url" mode the full address joins the subtitle line.
  const keywords = entry.subtitle ? escapeText(entry.subtitle) : "";
  const url =
    linkStyle === "url" && entry.url
      ? renderLink(cleanUrlForDisplay(entry.url), entry.url)
      : "";
  const subtitle = [keywords, url]
    .filter((part) => part.length > 0)
    .join("\\quad\\textbullet\\quad ");
  const title = entry.url
    ? `\\href{${escapeUrl(entry.url)}}{${escapeText(entry.title)}}`
    : escapeText(entry.title);
  const paragraph = entry.bullets
    .filter((bullet) => bullet.trim().length > 0)
    .map((bullet) => escapeText(bullet))
    .join(" ");
  return [
    "  \\cvprojectentry",
    `    {${title}}`,
    `    {${escapeText(entry.date ?? "")}}`,
    `    {${subtitle}}`,
    `    {${paragraph}}`,
  ].join("\n");
}

function renderHonorEntry(entry: LatexResumeEntry): string {
  // \cvhonor{<position>}{<title>}{<location>}{<date>} renders as:
  //   <date> | <position(bold)>,<title> | <location>
  // The bold element is the position slot (#1), and a comma is inserted only
  // when the title slot (#2) is non-empty. So put the entry title in #1 and
  // leave #2 empty: "<date> | <title(bold)> | <issuer>" with no stray comma.
  return [
    "  \\cvhonor",
    `    {${renderLink(entry.title, entry.url)}}`,
    "    {}",
    `    {${escapeText(entry.subtitle ?? "")}}`,
    `    {${escapeText(entry.date ?? "")}}`,
  ].join("\n");
}

function section(title: string, body: string): string {
  if (!body.trim()) return "";
  return [`\\cvsection{${escapeText(title)}}`, "", body, ""].join("\n");
}

function cventriesBlock(entries: string[]): string {
  if (entries.length === 0) return "";
  return [
    "\\begin{cventries}",
    "",
    entries.join("\n\n"),
    "",
    "\\end{cventries}",
  ].join("\n");
}

function cvhonorsBlock(entries: string[]): string {
  if (entries.length === 0) return "";
  return ["\\begin{cvhonors}", entries.join("\n"), "\\end{cvhonors}"].join(
    "\n",
  );
}

function renderSkillRows(
  groups: { name: string; keywords: string[] }[],
): string {
  if (groups.length === 0) return "";
  const rows = groups
    .filter((group) => group.keywords.length > 0 || group.name)
    .map(
      (group) =>
        `  \\cvskill\n    {${escapeText(group.name)}}\n    {${group.keywords
          .map((keyword) => escapeText(keyword))
          .join(", ")}}`,
    );
  if (rows.length === 0) return "";
  return ["\\begin{cvskills}", rows.join("\n\n"), "\\end{cvskills}"].join("\n");
}

/** Join (already-safe) labels as pills with a uniform, breakable gap between
 * them. \cvpillsep (defined in the theme .cls) is a single fixed-width \hspace,
 * so every gap is identical and wrapping stays clean. */
function pillsJoined(labels: string[]): string {
  return labels
    .filter((label) => label.trim().length > 0)
    .map((label) => `\\cvpill{${label}}`)
    .join("\\cvpillsep{}");
}

/** A full-width wrapping row of pills. */
function pillRow(labels: string[]): string {
  return `\\begin{cvpills}${pillsJoined(labels)}\\end{cvpills}`;
}

function renderSummary(document: LatexResumeDocument): string {
  if (!document.summary) return "";
  // No section heading — the summary stands on its own as a lead paragraph, set
  // off from the header by a slightly larger gap than the normal section gaps.
  return [
    "\\vspace{4.5mm}",
    `{\\summarystyle ${escapeText(document.summary)}\\par}`,
    "\\vspace{1.5mm}",
  ].join("\n");
}

function renderSkillsSection(
  document: LatexResumeDocument,
  title: string,
): string {
  // Each category renders as a bold subheading with its keywords as pills.
  const groups = document.skillGroups.filter(
    (group) => group.keywords.length > 0 || group.name.trim(),
  );
  if (groups.length === 0) return "";
  const blocks = groups.map((group) => {
    // Category label on the left, pills to its right — one compact row per group.
    const pills = pillsJoined(
      group.keywords.map((keyword) => escapeText(keyword)),
    );
    return `\\cvpillskill{${escapeText(group.name)}}{${pills}}`;
  });
  return section(
    title,
    `\\begin{cvpillskills}\n${blocks.join("\n")}\n\\end{cvpillskills}`,
  );
}

/** Map a reactive-resume 1–5 proficiency level to a human label. */
const LANGUAGE_LEVEL_LABELS: Record<number, string> = {
  1: "Beginner",
  2: "Elementary",
  3: "Intermediate",
  4: "Advanced",
  5: "Native",
};

/**
 * Proficiency labels for a language. The user fully controls these via the free
 * fluency field, comma-separated for multiple pills (e.g. "Fluent, C1"). Only
 * when no fluency text is set does the numeric 1–5 level fall back to a word, so
 * the pills always say exactly what the user typed and "Level 0" never appears.
 */
function languageProficiency(
  item: {
    fluency?: string | null;
    level?: number | null;
  },
  levelLabels: Record<number, string> = LANGUAGE_LEVEL_LABELS,
): string[] {
  const fluency = item.fluency?.trim();
  if (fluency) {
    return fluency
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }
  if (item.level != null && item.level >= 1) {
    const levelWord = levelLabels[item.level];
    return levelWord ? [levelWord] : [];
  }
  return [];
}

function renderLanguagesSection(
  document: LatexResumeDocument,
  title: string,
): string {
  // "Language" in Poppins, then its proficiency pills right beside it. Pills of
  // one language sit tight together; a wider gap separates languages so the
  // grouping is clear. Everything flows inline and wraps to stay compact.
  const units = document.languages
    .filter((item) => item.language.trim().length > 0)
    .map((item) => {
      const name = `{\\languagenamestyle{${escapeText(item.language)}}}`;
      const pills = languageProficiency(item, document.miscLabels?.proficiency)
        .map((part) => `\\cvpill{${escapeText(part)}}`)
        .join("\\hspace{2.5pt}");
      return pills ? `${name}\\hspace{5pt}${pills}` : name;
    });
  if (units.length === 0) return "";
  const line = units.join("\\hspace{16pt plus 5pt} ");
  return section(title, `\\begin{cvpills}${line}\\end{cvpills}`);
}

function renderInterestsSection(
  document: LatexResumeDocument,
  title: string,
): string {
  // No categories — just a flat, wrapping row of interest pills (each interest
  // name and any keywords), deduplicated.
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const item of document.interests) {
    for (const raw of [item.name, ...item.keywords]) {
      const value = raw?.trim();
      if (value && !seen.has(value)) {
        seen.add(value);
        labels.push(value);
      }
    }
  }
  if (labels.length === 0) return "";
  return section(title, pillRow(labels.map((label) => escapeText(label))));
}

function renderCustomFieldsSection(
  document: LatexResumeDocument,
  title: string,
): string {
  // Skip fields consumed by the header (e.g. the quote/tagline).
  const items = document.customFieldItems.filter(
    (item) => !(item.title && QUOTE_FIELD.test(item.title)),
  );
  if (items.length === 0) return "";
  const groups: LatexResumeSkillGroup[] = items.map((item) => ({
    name: item.title ?? "",
    keywords: [item.url ? cleanUrlForDisplay(item.url) : item.text].filter(
      Boolean,
    ),
  }));
  return section(title, renderSkillRows(groups));
}

function entrySection(
  title: string,
  entries: LatexResumeEntry[],
  render: (entry: LatexResumeEntry) => string,
): string {
  return section(title, cventriesBlock(entries.map((entry) => render(entry))));
}

function honorSection(title: string, entries: LatexResumeEntry[]): string {
  return section(title, cvhonorsBlock(entries.map(renderHonorEntry)));
}

function buildBody(document: LatexResumeDocument): string {
  const titles = document.sectionTitles ?? getLatexResumeSectionTitles();
  const projectLinkStyle: ProjectLinkStyle =
    document.projectLinkStyle ?? "icon";
  // Fixed section order for the danctrl theme (Summary renders before this list;
  // profiles live in the header). Intentionally ignores the RxResume layout order
  // so the danctrl CV always follows this arrangement.
  const order: LatexResumeOrderedSectionKey[] = [
    "skills",
    "experience",
    "education",
    "certifications",
    "projects",
    "awards",
    "publications",
    "volunteer",
    "languages",
    "interests",
    "references",
  ];

  const builders: Record<LatexResumeOrderedSectionKey, () => string> = {
    // Profiles live in the header (github/linkedin/website), so no body section.
    profiles: () => "",
    experience: () =>
      entrySection(
        titles.experience,
        document.experience,
        renderExperienceEntry,
      ),
    education: () =>
      entrySection(titles.education, document.education, renderEducationEntry),
    projects: () =>
      entrySection(titles.projects, document.projects, (entry) =>
        renderProjectEntry(entry, projectLinkStyle),
      ),
    skills: () => renderSkillsSection(document, titles.skills),
    languages: () => renderLanguagesSection(document, titles.languages),
    interests: () => renderInterestsSection(document, titles.interests),
    awards: () => honorSection(titles.awards, document.awards),
    certifications: () =>
      honorSection(titles.certifications, document.certifications),
    publications: () =>
      entrySection(
        titles.publications,
        document.publications,
        renderProseEntry,
      ),
    volunteer: () =>
      entrySection(titles.volunteer, document.volunteer, renderProseEntry),
    references: () =>
      entrySection(titles.references, document.references, renderProseEntry),
  };

  return [
    renderSummary(document),
    renderCustomFieldsSection(document, titles.customFields),
    ...order.map((key) => builders[key]()),
  ]
    .filter(Boolean)
    .join("\n");
}

/** Default class font size; the reference Awesome-CV CV compiles at 10pt. */
const DEFAULT_FONT_SIZE = "10pt";

export function buildAwesomeCvDocument(
  document: LatexResumeDocument,
  template: string,
): string {
  return template
    .replace("__FONTSIZE__", () => DEFAULT_FONT_SIZE)
    .replace("__PERSONAL_INFO__", () => buildPersonalInfo(document))
    .replace("__BODY__", () => buildBody(document));
}
