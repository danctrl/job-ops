import { createHash } from "node:crypto";
import * as settingsRepo from "@server/repositories/settings";
import { settingsRegistry } from "@shared/settings-registry";
import type {
  Job,
  JobPdfFreshness,
  LatexProjectLinkStyle,
  LatexTheme,
  PdfRenderer,
  TypstTheme,
} from "@shared/types";
import { getCurrentDesignResumeOrNullOnLegacy } from "./design-resume";
import { getConfiguredRxResumeBaseResumeId } from "./rxresume/baseResumeId";

const PDF_FINGERPRINT_VERSION = "v1";
type JobPdfFingerprintInput = Pick<
  Job,
  | "tailoredSummary"
  | "tailoredHeadline"
  | "tailoredSkills"
  | "selectedProjectIds"
  | "jobDescription"
  | "tracerLinksEnabled"
  | "employer"
  | "title"
  | "location"
>;

type JobPdfFreshnessInput = JobPdfFingerprintInput &
  Pick<Job, "pdfPath" | "pdfSource" | "pdfRegenerating" | "pdfFingerprint">;

export interface PdfFingerprintContext {
  version: typeof PDF_FINGERPRINT_VERSION;
  designResumeDocumentId: string | null;
  designResumeRevision: number | null;
  designResumeUpdatedAt: string | null;
  pdfRenderer: PdfRenderer;
  typstTheme: TypstTheme;
  latexTheme: LatexTheme;
  latexProjectLinkStyle: LatexProjectLinkStyle;
  rxresumeBaseResumeId: string | null;
}

export async function resolvePdfFingerprintContext(): Promise<PdfFingerprintContext> {
  const [
    designResume,
    rawRenderer,
    rawTypstTheme,
    rawLatexTheme,
    rawLatexProjectLinkStyle,
    configuredBaseResume,
  ] = await Promise.all([
    getCurrentDesignResumeOrNullOnLegacy(),
    settingsRepo.getSetting("pdfRenderer"),
    settingsRepo.getSetting("typstTheme"),
    settingsRepo.getSetting("latexTheme"),
    settingsRepo.getSetting("latexProjectLinkStyle"),
    getConfiguredRxResumeBaseResumeId(),
  ]);

  const parsedRenderer = settingsRegistry.pdfRenderer.parse(
    rawRenderer ?? undefined,
  );
  const parsedTypstTheme = settingsRegistry.typstTheme.parse(
    rawTypstTheme ?? undefined,
  );
  const parsedLatexTheme = settingsRegistry.latexTheme.parse(
    rawLatexTheme ?? undefined,
  );
  const parsedLatexProjectLinkStyle =
    settingsRegistry.latexProjectLinkStyle.parse(
      rawLatexProjectLinkStyle ?? undefined,
    );

  return {
    version: PDF_FINGERPRINT_VERSION,
    designResumeDocumentId: designResume?.id ?? null,
    designResumeRevision: designResume?.revision ?? null,
    designResumeUpdatedAt: designResume?.updatedAt ?? null,
    pdfRenderer: parsedRenderer ?? settingsRegistry.pdfRenderer.default(),
    typstTheme: parsedTypstTheme ?? settingsRegistry.typstTheme.default(),
    latexTheme: parsedLatexTheme ?? settingsRegistry.latexTheme.default(),
    latexProjectLinkStyle:
      parsedLatexProjectLinkStyle ??
      settingsRegistry.latexProjectLinkStyle.default(),
    rxresumeBaseResumeId: configuredBaseResume.resumeId ?? null,
  };
}

export function createJobPdfFingerprint(
  job: JobPdfFingerprintInput,
  context: PdfFingerprintContext,
): string {
  const payload = {
    version: context.version,
    renderer: context.pdfRenderer,
    ...(context.pdfRenderer === "typst"
      ? { typstTheme: context.typstTheme }
      : {}),
    ...(context.pdfRenderer === "latex"
      ? {
          latexTheme: context.latexTheme,
          latexProjectLinkStyle: context.latexProjectLinkStyle,
        }
      : {}),
    rxresumeBaseResumeId: context.rxresumeBaseResumeId,
    designResumeDocumentId: context.designResumeDocumentId,
    designResumeRevision: context.designResumeRevision,
    designResumeUpdatedAt: context.designResumeUpdatedAt,
    job: {
      tailoredSummary: job.tailoredSummary ?? null,
      tailoredHeadline: job.tailoredHeadline ?? null,
      tailoredSkills: job.tailoredSkills ?? null,
      selectedProjectIds: job.selectedProjectIds ?? null,
      jobDescription: job.jobDescription ?? null,
      tracerLinksEnabled: Boolean(job.tracerLinksEnabled),
      employer: job.employer ?? null,
      title: job.title ?? null,
      location: job.location ?? null,
    },
  };

  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function getJobPdfFreshness(
  job: JobPdfFreshnessInput,
  context: PdfFingerprintContext,
): JobPdfFreshness {
  if (job.pdfRegenerating) return "regenerating";
  if (!job.pdfPath) return "missing";
  if (job.pdfSource === "uploaded") return "uploaded";

  const nextFingerprint = createJobPdfFingerprint(job, context);
  return job.pdfFingerprint === nextFingerprint ? "current" : "stale";
}

export function applyJobPdfFreshness<T extends JobPdfFreshnessInput>(
  job: T,
  context: PdfFingerprintContext,
): T & { resumeFreshness: JobPdfFreshness } {
  return {
    ...job,
    resumeFreshness: getJobPdfFreshness(job, context),
  };
}

export function applyJobsPdfFreshness<T extends JobPdfFreshnessInput>(
  jobs: T[],
  context: PdfFingerprintContext,
): Array<T & { resumeFreshness: JobPdfFreshness }> {
  return jobs.map((job) => applyJobPdfFreshness(job, context));
}
