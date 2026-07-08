/**
 * Cover letter PDF freshness fingerprinting.
 *
 * Mirrors pdf-fingerprint.ts for the resume: a generated cover letter PDF is
 * "current" only while a fingerprint of the inputs that feed the render still
 * matches the one stored when it was last built. Editing the recipient,
 * salutation, body, etc. (or switching renderer/theme/profile identity) changes
 * the fingerprint, so the PDF correctly flips to "stale" until re-rendered.
 */

import { createHash } from "node:crypto";
import { getSetting } from "@server/repositories/settings";
import { settingsRegistry } from "@shared/settings-registry";
import type {
  CoverLetterRenderer,
  CoverLetterTheme,
  Job,
  JobPdfFreshness,
  LatexTheme,
  ResumeProfile,
} from "@shared/types";
import { getProfile } from "./profile";

const COVER_LETTER_FINGERPRINT_VERSION = "v1";

type CoverLetterFingerprintInput = Pick<
  Job,
  "coverLetterDetails" | "employer" | "location" | "title" | "tailoredHeadline"
>;

type CoverLetterFreshnessInput = CoverLetterFingerprintInput &
  Pick<
    Job,
    | "coverLetterPath"
    | "coverLetterSource"
    | "coverLetterFingerprint"
    | "coverLetterRegenerating"
  >;

export interface CoverLetterFingerprintContext {
  version: string;
  renderer: CoverLetterRenderer;
  theme: CoverLetterTheme;
  // Shared with the resume; selects the LaTeX cover-letter template (jake|danctrl).
  latexTheme: LatexTheme;
  // Header identity that the render pulls from the profile (name + contact line).
  identity: {
    name: string | null;
    email: string | null;
    phone: string | null;
    url: string | null;
  };
}

/** Build a fingerprint context from already-resolved parts (no IO). */
export function buildCoverLetterFingerprintContext(
  profile: ResumeProfile,
  renderer: CoverLetterRenderer,
  theme: CoverLetterTheme,
  latexTheme: LatexTheme,
): CoverLetterFingerprintContext {
  const basics = profile.basics ?? {};
  return {
    version: COVER_LETTER_FINGERPRINT_VERSION,
    renderer,
    theme,
    latexTheme,
    identity: {
      name: basics.name?.trim() || null,
      email: basics.email?.trim() || null,
      phone: basics.phone?.trim() || null,
      url: basics.url?.trim() || null,
    },
  };
}

export async function resolveCoverLetterFingerprintContext(): Promise<CoverLetterFingerprintContext> {
  const [rawRenderer, rawTheme, rawLatexTheme, profile] = await Promise.all([
    getSetting("coverLetterRenderer"),
    getSetting("coverLetterTheme"),
    getSetting("latexTheme"),
    getProfile(),
  ]);

  const renderer =
    settingsRegistry.coverLetterRenderer.parse(rawRenderer ?? undefined) ??
    settingsRegistry.coverLetterRenderer.default();
  const theme =
    settingsRegistry.coverLetterTheme.parse(rawTheme ?? undefined) ??
    settingsRegistry.coverLetterTheme.default();
  const latexTheme =
    settingsRegistry.latexTheme.parse(rawLatexTheme ?? undefined) ??
    settingsRegistry.latexTheme.default();

  return buildCoverLetterFingerprintContext(
    profile,
    renderer,
    theme,
    latexTheme,
  );
}

export function createCoverLetterFingerprint(
  job: CoverLetterFingerprintInput,
  context: CoverLetterFingerprintContext,
): string {
  const details = job.coverLetterDetails ?? null;
  const payload = {
    version: context.version,
    renderer: context.renderer,
    theme: context.theme,
    // Only the LaTeX renderer uses latexTheme; including it unconditionally would
    // needlessly churn Typst cover-letter fingerprints on unrelated changes.
    ...(context.renderer === "latex" ? { latexTheme: context.latexTheme } : {}),
    identity: context.identity,
    employer: job.employer ?? null,
    location: job.location ?? null,
    // Feed the letter-header position (role applied for), which derives from the
    // tailored headline or the job title — so editing either flips the PDF stale.
    title: job.title ?? null,
    tailoredHeadline: job.tailoredHeadline ?? null,
    details: details
      ? {
          body: details.body ?? null,
          contactPerson: details.contactPerson ?? null,
          companyName: details.companyName ?? null,
          addressLines: details.addressLines ?? null,
          salutation: details.salutation ?? null,
          closing: details.closing ?? null,
        }
      : null,
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function getCoverLetterFreshness(
  job: CoverLetterFreshnessInput,
  context: CoverLetterFingerprintContext,
): JobPdfFreshness {
  if (!job.coverLetterPath) return "missing";
  if (job.coverLetterRegenerating) return "regenerating";
  if (job.coverLetterSource === "uploaded") return "uploaded";

  const nextFingerprint = createCoverLetterFingerprint(job, context);
  return job.coverLetterFingerprint === nextFingerprint ? "current" : "stale";
}

export function applyCoverLetterFreshness<T extends CoverLetterFreshnessInput>(
  job: T,
  context: CoverLetterFingerprintContext,
): T & { coverLetterFreshness: JobPdfFreshness } {
  return {
    ...job,
    coverLetterFreshness: getCoverLetterFreshness(job, context),
  };
}

export function applyCoverLettersFreshness<T extends CoverLetterFreshnessInput>(
  jobs: T[],
  context: CoverLetterFingerprintContext,
): Array<T & { coverLetterFreshness: JobPdfFreshness }> {
  return jobs.map((job) => applyCoverLetterFreshness(job, context));
}
