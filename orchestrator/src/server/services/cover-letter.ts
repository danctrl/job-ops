/**
 * Service for generating a tailored cover letter (text + PDF) for a job.
 */

import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import { getSetting } from "@server/repositories/settings";
import { settingsRegistry } from "@shared/settings-registry";
import type {
  ChatStyleManualLanguage,
  CoverLetterDetails,
  CoverLetterRenderer,
  CoverLetterTheme,
  Job,
  LatexTheme,
  ResumeProfile,
} from "@shared/types";
import { normalizeJobTitle } from "@shared/utils/string";
import {
  buildCoverLetterFingerprintContext,
  createCoverLetterFingerprint,
} from "./cover-letter-fingerprint";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";
import {
  getWritingLanguageLabel,
  resolveWritingOutputLanguage,
} from "./output-language";
import { getTenantCoverLetterPdfPath } from "./pdf-storage";
import { getProfile, getProfileForLanguage } from "./profile";
import {
  getEffectivePromptTemplate,
  renderPromptTemplate,
} from "./prompt-templates";
import type {
  CoverLetterPersonalInfo,
  RenderCoverLetterPdfArgs,
} from "./resume-renderer/cover-letter";
import { renderCoverLetterPdf } from "./resume-renderer/cover-letter";
import { bracketizeText } from "./text-style";
import { getWritingStyle } from "./writing-style";

export interface CoverLetterResult {
  success: boolean;
  text?: string;
  path?: string;
  error?: string;
}

/** JSON schema wrapping the plain-text cover letter body. */
const COVER_LETTER_SCHEMA: JsonSchemaDefinition = {
  name: "cover_letter",
  schema: {
    type: "object",
    properties: {
      body: {
        type: "string",
        description:
          "The cover letter body text, paragraphs separated by blank lines",
      },
    },
    required: ["body"],
    additionalProperties: false,
  },
};

function sanitizeText(text: string): string {
  return text
    .replace(/\*\*([\s\S]*?)\*\*/g, "$1") // strip markdown bold, keep content
    .replace(/^["']|["']$/g, "")
    .trim();
}

function buildContactLine(profile: ResumeProfile): string {
  const basics = profile.basics ?? {};
  const parts = [basics.email, basics.phone, basics.url].filter(
    (part): part is string => Boolean(part?.trim()),
  );
  return parts.join("  |  ");
}

function buildRecentExperience(profile: ResumeProfile): string {
  const items = profile.sections?.experience?.items ?? [];
  return items
    .slice(0, 2)
    .map((item) => {
      const header = [item.position, item.company].filter(Boolean).join(" at ");
      const summary = item.summary?.trim() ? ` — ${item.summary.trim()}` : "";
      return `- ${header}${summary}`;
    })
    .join("\n");
}

/** Intl locale used to format the letter date per output language. */
const COVER_LETTER_DATE_LOCALES: Record<ChatStyleManualLanguage, string> = {
  english: "en-US",
  german: "de-DE",
  french: "fr-FR",
  spanish: "es-ES",
};

/**
 * Default salutation/closing per output language. Applied only when the user
 * has not overridden `details.salutation` / `details.closing`. German closings
 * follow DIN convention (no trailing comma).
 */
const COVER_LETTER_GREETINGS: Record<
  ChatStyleManualLanguage,
  { named: (name: string) => string; generic: string; closing: string }
> = {
  english: {
    named: (name) => `Dear ${name},`,
    generic: "Dear Hiring Manager,",
    closing: "Sincerely,",
  },
  german: {
    named: (name) => `Guten Tag ${name},`,
    generic: "Sehr geehrte Damen und Herren,",
    closing: "Mit freundlichen Grüßen",
  },
  french: {
    named: (name) => `Bonjour ${name},`,
    generic: "Madame, Monsieur,",
    closing: "Cordialement,",
  },
  spanish: {
    named: (name) => `Estimado/a ${name}:`,
    generic: "Estimados señores:",
    closing: "Atentamente,",
  },
};

function formatTodayDate(
  language: ChatStyleManualLanguage = "english",
): string {
  return new Date().toLocaleDateString(
    COVER_LETTER_DATE_LOCALES[language] ?? "en-US",
    {
      year: "numeric",
      month: "long",
      day: "numeric",
    },
  );
}

function splitBodyParagraphs(body: string): string[] {
  return body
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean);
}

function buildRecipientLines(
  details: CoverLetterDetails,
  job: Pick<Job, "employer" | "location">,
): string[] {
  const contactPerson = details.contactPerson?.trim();
  const companyName = details.companyName?.trim();
  const addressLines = (details.addressLines ?? [])
    .map((line) => line.trim())
    .filter(Boolean);

  // When any recipient detail is personalized, build from it; otherwise fall
  // back to the previous default of employer + location.
  if (contactPerson || companyName || addressLines.length > 0) {
    return [contactPerson, companyName ?? job.employer, ...addressLines].filter(
      (line): line is string => Boolean(line?.trim()),
    );
  }
  return [job.employer, job.location ?? ""];
}

/**
 * Resolve the render arguments from a job's editable cover letter details,
 * applying the historical defaults when a field is left blank.
 */
function findProfileHandle(
  profile: ResumeProfile,
  matcher: RegExp,
): string | null {
  const match = (profile.basics?.profiles ?? []).find((item) =>
    matcher.test(item.network ?? ""),
  );
  if (!match) return null;
  return match.username?.trim() || match.url?.trim() || null;
}

/**
 * basics.location is typed as a structured object (JSON Resume) but is a plain
 * string at runtime for RxResume profiles. Handle both.
 */
export function formatBasicsLocation(location: unknown): string | null {
  if (!location) return null;
  if (typeof location === "string") return location.trim() || null;
  if (typeof location === "object") {
    const obj = location as Record<string, unknown>;
    const str = (key: string): string => {
      const value = obj[key];
      return typeof value === "string" ? value.trim() : "";
    };
    // Prefer "City, Region/Country"; be forgiving about which keys are filled.
    const city = str("city");
    const regionish = str("region") || str("country") || str("countryCode");
    const parts = [city, regionish].filter(Boolean);
    return parts.join(", ") || str("address") || null;
  }
  return null;
}

/** Structured header fields for the danctrl (Awesome-CV) letter header. */
function buildCoverLetterPersonalInfo(
  profile: ResumeProfile,
): CoverLetterPersonalInfo {
  const basics = profile.basics ?? {};
  return {
    phone: basics.phone?.trim() || null,
    email: basics.email?.trim() || null,
    website: basics.url?.trim() || null,
    location: formatBasicsLocation(basics.location),
    socialLinks: (basics.profiles ?? []).map((item) => ({
      network: item.network ?? null,
      username: item.username ?? null,
      url: item.url ?? null,
    })),
    headline: basics.headline?.trim() || null,
  };
}

function buildCoverLetterRenderArgs(args: {
  job: Job;
  profile: ResumeProfile;
  details: CoverLetterDetails;
  renderer: CoverLetterRenderer;
  theme: CoverLetterTheme;
  latexTheme: LatexTheme;
  outputPath: string;
  language?: ChatStyleManualLanguage;
}): RenderCoverLetterPdfArgs {
  const { job, profile, details, renderer, theme, latexTheme, outputPath } =
    args;
  const language = args.language ?? "english";
  const greetings =
    COVER_LETTER_GREETINGS[language] ?? COVER_LETTER_GREETINGS.english;
  const personName = profile.basics?.name?.trim() || "Applicant";
  const salutation =
    details.salutation?.trim() ||
    (details.contactPerson?.trim()
      ? greetings.named(details.contactPerson.trim())
      : greetings.generic);
  const closing = details.closing?.trim() || greetings.closing;

  // The letter header position is the ROLE being applied for, not the
  // applicant's generic base headline. Prefer the tailored headline, fall back
  // to the (cleaned) job title, then the profile headline.
  const personal = buildCoverLetterPersonalInfo(profile);
  const roleHeadline =
    job.tailoredHeadline?.trim() ||
    normalizeJobTitle(job.title) ||
    personal.headline;

  return {
    renderer,
    theme,
    latexTheme,
    name: personName,
    contactLine: buildContactLine(profile),
    personal: { ...personal, headline: roleHeadline },
    date: formatTodayDate(language),
    recipientLines: buildRecipientLines(details, job),
    salutation,
    // Cosmetic: render round parentheses as square brackets in the body only.
    paragraphs: splitBodyParagraphs(details.body ?? "").map(bracketizeText),
    closing,
    outputPath,
    jobId: job.id,
  };
}

/** Render a cover letter to a throwaway temp file and return the PDF bytes. */
async function renderCoverLetterToBuffer(
  args: Omit<RenderCoverLetterPdfArgs, "outputPath">,
): Promise<Buffer> {
  const tempDir = await mkdtemp(join(tmpdir(), "job-ops-cl-preview-"));
  const outputPath = join(tempDir, "preview.pdf");
  try {
    await renderCoverLetterPdf({ ...args, outputPath });
    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function resolveCoverLetterRenderer(): Promise<CoverLetterRenderer> {
  const storedValue = await getSetting("coverLetterRenderer");
  return (
    settingsRegistry.coverLetterRenderer.parse(storedValue ?? undefined) ??
    settingsRegistry.coverLetterRenderer.default()
  );
}

async function resolveCoverLetterTheme(): Promise<CoverLetterTheme> {
  const storedValue = await getSetting("coverLetterTheme");
  return (
    settingsRegistry.coverLetterTheme.parse(storedValue ?? undefined) ??
    settingsRegistry.coverLetterTheme.default()
  );
}

/**
 * The LaTeX cover letter shares the resume's `latexTheme` setting, so selecting
 * the danctrl resume template also styles the cover letter as Awesome-CV.
 */
async function resolveLatexTheme(): Promise<LatexTheme> {
  const storedValue = await getSetting("latexTheme");
  return (
    settingsRegistry.latexTheme.parse(storedValue ?? undefined) ??
    settingsRegistry.latexTheme.default()
  );
}

/**
 * Generate a cover letter for a job: call the LLM for the body, render a PDF,
 * and persist the path on the job record.
 */
export async function generateCoverLetter(
  jobId: string,
  options: { render?: boolean } = {},
): Promise<CoverLetterResult> {
  const job = await jobsRepo.getJobById(jobId);
  if (!job) {
    return { success: false, error: "Job not found" };
  }

  // Mirror the resume guard: an uploaded cover letter is user-supplied and must
  // not be silently overwritten by a regeneration.
  if (job.coverLetterSource === "uploaded") {
    return {
      success: false,
      error:
        "Uploaded cover letter can't be overwritten. Delete it first to regenerate.",
    };
  }

  const [model, baseProfile, writingStyle] = await Promise.all([
    resolveLlmModel("tailoring"),
    getProfile(),
    getWritingStyle(),
  ]);

  const jobDescription = job.jobDescription?.trim() || "";

  const resolvedLanguage = resolveWritingOutputLanguage({
    style: writingStyle,
    profile: baseProfile,
    jobDescription,
  });

  // Draw the letter's prose from the hand-authored master for the target
  // language when one exists (falls back to the primary profile otherwise).
  const profile =
    resolvedLanguage.language === "english"
      ? baseProfile
      : await getProfileForLanguage(resolvedLanguage.language);

  const personName = profile.basics?.name?.trim() || "Applicant";
  const tailoredSummary =
    job.tailoredSummary?.trim() || profile.basics?.summary?.trim() || "";
  const recentExperience = buildRecentExperience(profile);
  const locationSuffix = job.location?.trim()
    ? ` in ${job.location.trim()}`
    : "";
  const outputLanguage = getWritingLanguageLabel(resolvedLanguage.language);

  const template = await getEffectivePromptTemplate(
    "coverLetterPromptTemplate",
  );
  const prompt = renderPromptTemplate(template, {
    personName,
    jobTitle: job.title,
    employer: job.employer,
    location: locationSuffix,
    jobDescription,
    recentExperience,
    tailoredSummary,
    outputLanguage,
    constraintsBullet: writingStyle.constraints?.trim()
      ? `- Additional constraints: ${writingStyle.constraints.trim()}`
      : "",
    avoidTermsBullet: writingStyle.doNotUse?.trim()
      ? `- Avoid these words or phrases: ${writingStyle.doNotUse.trim()}`
      : "",
  });

  const llm = await createConfiguredLlmService("tailoring");
  const result = await llm.callJson<{ body: string }>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: COVER_LETTER_SCHEMA,
    jobId,
  });

  if (!result.success) {
    const context = `provider=${llm.getProvider()} baseUrl=${llm.getBaseUrl()}`;
    const message = result.error.toLowerCase().includes("api key")
      ? `LLM API key not set, cannot generate cover letter. (${context})`
      : `${result.error} (${context})`;
    logger.warn("Cover letter generation failed", { jobId, message });
    return { success: false, error: message };
  }

  const bodyText = sanitizeText(result.data.body || "");
  const paragraphs = bodyText
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return { success: false, error: "Cover letter body was empty" };
  }

  // Preserve any personalization (recipient, salutation, closing) the user
  // already set; only the body is replaced by the fresh LLM output.
  const details: CoverLetterDetails = {
    ...(job.coverLetterDetails ?? {}),
    body: paragraphs.join("\n\n"),
  };

  // Resume-style flow: when not rendering, persist only the body so the user can
  // review/edit it before building the PDF. The PDF stays stale until "Build PDF".
  if (options.render === false) {
    await jobsRepo.updateJob(jobId, { coverLetterDetails: details });
    logger.info("Cover letter body generated", { jobId });
    return { success: true, text: details.body };
  }

  const outputPath = getTenantCoverLetterPdfPath(jobId);
  await mkdir(dirname(outputPath), { recursive: true });

  const [renderer, theme, latexTheme] = await Promise.all([
    resolveCoverLetterRenderer(),
    resolveCoverLetterTheme(),
    resolveLatexTheme(),
  ]);

  try {
    await renderCoverLetterPdf(
      buildCoverLetterRenderArgs({
        job,
        profile,
        details,
        renderer,
        theme,
        latexTheme,
        outputPath,
        language: resolvedLanguage.language,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: `Failed to render cover letter PDF: ${message}`,
    };
  }

  await jobsRepo.setJobCoverLetter({
    id: jobId,
    coverLetterPath: outputPath,
    source: "generated",
    details,
    fingerprint: createCoverLetterFingerprint(
      {
        coverLetterDetails: details,
        employer: job.employer,
        location: job.location,
        title: job.title,
        tailoredHeadline: job.tailoredHeadline,
      },
      buildCoverLetterFingerprintContext(profile, renderer, theme, latexTheme),
    ),
  });

  logger.info("Cover letter generated", { jobId, outputPath });
  return { success: true, text: paragraphs.join("\n\n"), path: outputPath };
}

/** JSON schema for an on-demand recipient address suggestion. */
const COVER_LETTER_ADDRESS_SCHEMA: JsonSchemaDefinition = {
  name: "cover_letter_address",
  schema: {
    type: "object",
    properties: {
      companyName: {
        type: "string",
        description: "Official company name for the recipient block",
      },
      contactPerson: {
        type: "string",
        description: "Named hiring contact if genuinely known, else empty",
      },
      addressLines: {
        type: "array",
        items: { type: "string" },
        description:
          "Postal address lines: street (if known), then 'postcode city', then country. Omit lines you are not confident about; never invent a street or postcode.",
      },
    },
    required: ["companyName", "addressLines"],
    additionalProperties: false,
  },
};

export interface CoverLetterAddressSuggestion {
  companyName: string;
  contactPerson: string;
  addressLines: string[];
}

/**
 * Draft a recipient postal address for the cover letter from the job's company
 * details using the LLM. Not persisted — the editor fills the fields and the
 * usual autosave stores them. The model is told not to invent a precise street
 * when unsure, but output should still be verified before sending.
 */
export async function generateCoverLetterAddress(
  jobId: string,
): Promise<CoverLetterAddressSuggestion> {
  const job = await jobsRepo.getJobById(jobId);
  if (!job) throw new Error("Job not found");

  const [model, llm] = await Promise.all([
    resolveLlmModel("tailoring"),
    createConfiguredLlmService("tailoring"),
  ]);

  const context = [
    `Company: ${job.employer}`,
    job.location?.trim() ? `Location: ${job.location.trim()}` : "",
    job.companyUrlDirect?.trim()
      ? `Website: ${job.companyUrlDirect.trim()}`
      : "",
    job.companyDescription?.trim()
      ? `About: ${job.companyDescription.trim().slice(0, 500)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const prompt = `You provide the postal mailing address for the recipient block of a job application cover letter.

${context}

Return the company's official name and its postal address as address lines: street (if known), then "postcode city", then country. Use the job location to infer the city and country. If you do not reliably know the exact street and postcode, return only the lines you are confident about (for example city and country) instead of inventing a street or postcode. Leave contactPerson empty unless a specific hiring contact is genuinely known. Output at most 4 address lines.`;

  const result = await llm.callJson<{
    companyName: string;
    contactPerson?: string;
    addressLines: string[];
  }>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: COVER_LETTER_ADDRESS_SCHEMA,
    jobId,
  });

  if (!result.success) {
    throw new Error(result.error);
  }

  const addressLines = (result.data.addressLines ?? [])
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);

  return {
    companyName: (result.data.companyName || job.employer || "").trim(),
    contactPerson: (result.data.contactPerson || "").trim(),
    addressLines,
  };
}

/**
 * Re-render the stored cover letter PDF from the job's edited details, without
 * calling the LLM. Used after the user personalizes the letter.
 */
export async function rerenderCoverLetter(
  jobId: string,
): Promise<CoverLetterResult> {
  const job = await jobsRepo.getJobById(jobId);
  if (!job) return { success: false, error: "Job not found" };
  if (job.coverLetterSource === "uploaded") {
    return {
      success: false,
      error: "Uploaded cover letter can't be re-rendered. Delete it first.",
    };
  }
  const details = job.coverLetterDetails;
  if (!details?.body?.trim()) {
    return {
      success: false,
      error: "Generate a cover letter before updating the PDF.",
    };
  }

  const [profile, writingStyle, renderer, theme, latexTheme] =
    await Promise.all([
      getProfile(),
      getWritingStyle(),
      resolveCoverLetterRenderer(),
      resolveCoverLetterTheme(),
      resolveLatexTheme(),
    ]);

  // Localize the letter envelope (date, salutation, closing) to match the
  // language the body was written in.
  const resolvedLanguage = resolveWritingOutputLanguage({
    style: writingStyle,
    profile,
    jobDescription: job.jobDescription?.trim() || "",
  });

  const outputPath = getTenantCoverLetterPdfPath(jobId);
  await mkdir(dirname(outputPath), { recursive: true });

  try {
    await renderCoverLetterPdf(
      buildCoverLetterRenderArgs({
        job,
        profile,
        details,
        renderer,
        theme,
        latexTheme,
        outputPath,
        language: resolvedLanguage.language,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      success: false,
      error: `Failed to render cover letter PDF: ${message}`,
    };
  }

  await jobsRepo.setJobCoverLetter({
    id: jobId,
    coverLetterPath: outputPath,
    source: "generated",
    details,
    fingerprint: createCoverLetterFingerprint(
      {
        coverLetterDetails: details,
        employer: job.employer,
        location: job.location,
        title: job.title,
        tailoredHeadline: job.tailoredHeadline,
      },
      buildCoverLetterFingerprintContext(profile, renderer, theme, latexTheme),
    ),
  });
  logger.info("Cover letter re-rendered", { jobId, outputPath });
  return { success: true, text: details.body, path: outputPath };
}

const SAMPLE_PREVIEW_DETAILS: CoverLetterDetails = {
  contactPerson: "Jane Doe",
  companyName: "Acme Corporation",
  addressLines: ["123 Example Street", "10115 Berlin"],
  salutation: "Dear Jane Doe,",
  closing: "Kind regards,",
  body: [
    "This is a sample cover letter used to preview how the selected renderer and template look.",
    "The second paragraph shows paragraph spacing and justification so you can judge the overall layout before applying a template.",
    "Replace this with a generated, personalized cover letter from a job's Tailoring tab.",
  ].join("\n\n"),
};

/** Render a fixed sample cover letter with the given (or configured) renderer/theme. */
export async function renderCoverLetterSamplePreview(override?: {
  renderer?: CoverLetterRenderer;
  theme?: CoverLetterTheme;
  latexTheme?: LatexTheme;
}): Promise<Buffer> {
  const [renderer, theme, latexTheme, profile] = await Promise.all([
    override?.renderer ?? resolveCoverLetterRenderer(),
    override?.theme ?? resolveCoverLetterTheme(),
    override?.latexTheme ?? resolveLatexTheme(),
    getProfile(),
  ]);

  // Use the real applicant identity so the sample reflects the actual header;
  // the body stays generic placeholder copy to showcase the template layout.
  const name = profile.basics?.name?.trim() || "Alex Applicant";
  const contactLine =
    buildContactLine(profile) ||
    "alex@example.com  |  +49 30 0000000  |  example.com";

  return renderCoverLetterToBuffer({
    renderer,
    theme,
    latexTheme,
    name,
    contactLine,
    personal: buildCoverLetterPersonalInfo(profile),
    date: formatTodayDate(),
    recipientLines: buildRecipientLines(SAMPLE_PREVIEW_DETAILS, {
      employer: "Acme Corporation",
      location: "Berlin",
    }),
    salutation: SAMPLE_PREVIEW_DETAILS.salutation ?? "Dear Hiring Manager,",
    paragraphs: splitBodyParagraphs(SAMPLE_PREVIEW_DETAILS.body ?? "").map(
      bracketizeText,
    ),
    closing: SAMPLE_PREVIEW_DETAILS.closing ?? "Sincerely,",
    jobId: "sample-preview",
  });
}
