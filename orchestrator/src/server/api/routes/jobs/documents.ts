import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { AppError, badRequest } from "@infra/errors";
import { fail, ok, okWithMeta } from "@infra/http";
import { logger } from "@infra/logger";
import { isDemoMode } from "@server/config/demo";
import { resolveRequestOrigin } from "@server/infra/request-origin";
import { generateFinalPdf, summarizeJob } from "@server/pipeline/index";
import * as jobDocumentsRepo from "@server/repositories/job-documents";
import * as jobsRepo from "@server/repositories/jobs";
import {
  generateCoverLetter,
  generateCoverLetterAddress,
  rerenderCoverLetter,
} from "@server/services/cover-letter";
import {
  simulateGeneratePdf,
  simulateSummarizeJob,
} from "@server/services/demo-simulator";
import {
  removeStoredJobDocument,
  storeJobDocument,
} from "@server/services/job-document-storage";
import { uploadJobPdf } from "@server/services/job-pdf-upload";
import { getTenantCoverLetterPdfPath } from "@server/services/pdf-storage";
import { decodeBase64Upload } from "@server/services/upload-base64";
import { getSafeInlineJobDocumentMediaType } from "@shared/job-document-classification.js";
import { type Request, type Response, Router } from "express";
import {
  appErrorFromPipelineFailure,
  hydrateJobPdfFreshness,
  queueTailoringAutoPdfRegenerationIfNeeded,
  requireJob,
  toJobsRouteError,
  uploadJobDocumentSchema,
  uploadJobPdfSchema,
} from "./shared";

export const jobsDocumentsRouter = Router();

const MAX_COVER_LETTER_PDF_BYTES = 10 * 1024 * 1024;

const tailoringGenerateFields = ["summary", "headline", "skills"] as const;
type TailoringGenerateField = (typeof tailoringGenerateFields)[number];

function encodeContentDispositionFileName(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*~]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function contentDispositionAttachment(fileName: string): string {
  const fallbackFileName =
    fileName
      .replace(/["\\\r\n]/g, "_")
      .replace(/[^\x20-\x7E]/g, "_")
      .trim() || "document";
  return `attachment; filename="${fallbackFileName}"; filename*=UTF-8''${encodeContentDispositionFileName(fileName)}`;
}

function removeJobDocumentContentHeaders(res: Response): void {
  res.removeHeader("Cache-Control");
  res.removeHeader("Content-Disposition");
  res.removeHeader("Content-Type");
  res.removeHeader("X-Content-Type-Options");
}

function setJobDocumentContentHeaders(
  res: Response,
  document: { fileName: string; mediaType: string | null },
): void {
  const safeInlineMediaType = getSafeInlineJobDocumentMediaType(document);

  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (!safeInlineMediaType) {
    res.setHeader(
      "Content-Disposition",
      contentDispositionAttachment(document.fileName),
    );
    res.type("application/octet-stream");
    return;
  }

  res.setHeader("Content-Disposition", "inline");
  if (safeInlineMediaType === "text/plain") {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    return;
  }
  res.type(safeInlineMediaType);
}

const parseTailoringGenerateFields = (
  raw: string | undefined,
): TailoringGenerateField[] | undefined => {
  if (!raw) return undefined;
  const fields = raw
    .split(",")
    .map((field) => field.trim())
    .filter(Boolean);
  const invalidFields = fields.filter(
    (field): field is string =>
      !tailoringGenerateFields.includes(field as TailoringGenerateField),
  );
  if (invalidFields.length > 0) {
    throw badRequest("Invalid tailoring generation field", {
      fields,
      invalidFields,
      allowedFields: [...tailoringGenerateFields],
    });
  }
  return [...new Set(fields)] as TailoringGenerateField[];
};

jobsDocumentsRouter.post("/:id/pdf", async (req: Request, res: Response) => {
  let uploadedPath: string | null = null;

  try {
    const input = uploadJobPdfSchema.parse(req.body);
    const currentJob = await jobsRepo.getJobById(req.params.id);

    if (!currentJob) {
      const err = new AppError({
        status: 404,
        code: "NOT_FOUND",
        message: "Job not found",
      });
      logger.warn("Job PDF upload failed", {
        route: "POST /api/jobs/:id/pdf",
        jobId: req.params.id,
        status: err.status,
        code: err.code,
      });
      fail(res, err);
      return;
    }

    const uploaded = await uploadJobPdf({
      jobId: req.params.id,
      fileName: input.fileName,
      mediaType: input.mediaType,
      dataBase64: input.dataBase64,
    });
    uploadedPath = uploaded.outputPath;

    // Uploading a resume keeps the job in its current column (a discovered job
    // stays discovered, like building does) — it only leaves Discovered when
    // applied. So we no longer auto-promote to "ready" here.
    const job = await jobsRepo.updateJob(req.params.id, {
      pdfPath: uploaded.outputPath,
      pdfSource: "uploaded",
      pdfRegenerating: false,
      pdfFingerprint: null,
      pdfGeneratedAt: new Date().toISOString(),
    });

    if (!job) {
      await rm(uploaded.outputPath, { force: true }).catch((cleanupError) => {
        logger.warn("Failed to clean up uploaded PDF after missing job", {
          route: "POST /api/jobs/:id/pdf",
          jobId: req.params.id,
          cleanupError,
        });
      });

      const err = new AppError({
        status: 404,
        code: "NOT_FOUND",
        message: "Job not found",
      });
      logger.warn("Job PDF upload failed", {
        route: "POST /api/jobs/:id/pdf",
        jobId: req.params.id,
        status: err.status,
        code: err.code,
      });
      fail(res, err);
      return;
    }

    logger.info("Job PDF uploaded", {
      route: "POST /api/jobs/:id/pdf",
      jobId: req.params.id,
      fileName: input.fileName,
      byteLength: uploaded.byteLength,
    });

    ok(res, await hydrateJobPdfFreshness(job), 201);
  } catch (error) {
    const err = toJobsRouteError(error, {
      invalidRequestFallbackMessage: "Invalid job PDF upload request",
    });

    if (uploadedPath) {
      await rm(uploadedPath, { force: true }).catch((cleanupError) => {
        logger.warn("Failed to clean up uploaded PDF after route error", {
          route: "POST /api/jobs/:id/pdf",
          jobId: req.params.id,
          cleanupError,
        });
      });
    }

    logger.error("Job PDF upload failed", {
      route: "POST /api/jobs/:id/pdf",
      jobId: req.params.id,
      status: err.status,
      code: err.code,
      details: err.details,
      uploadedPath,
    });

    fail(res, err);
  }
});

jobsDocumentsRouter.post(
  "/:id/generate-cover-letter",
  async (req: Request, res: Response) => {
    try {
      const job = await requireJob(req.params.id);
      if (job.coverLetterSource === "uploaded") {
        throw new AppError({
          status: 409,
          code: "CONFLICT",
          message:
            "Uploaded cover letter can't be overwritten. Delete it first to regenerate.",
        });
      }
      // Default to rendering; the tailoring "Generate" passes render:false to
      // write the body only (resume-style) so the user can edit before building.
      const rawRender = req.body?.render;
      if (rawRender !== undefined && typeof rawRender !== "boolean") {
        throw badRequest("`render` must be a boolean when provided.");
      }
      const render = rawRender !== false;
      const result = await generateCoverLetter(req.params.id, { render });
      if (!result.success) {
        throw new AppError({
          status: 502,
          code: "UPSTREAM_ERROR",
          message: result.error ?? "Failed to generate cover letter",
        });
      }

      const updatedJob = await jobsRepo.getJobById(req.params.id);
      if (!updatedJob) {
        throw new AppError({
          status: 404,
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      logger.info("Cover letter generated", {
        route: "POST /api/jobs/:id/generate-cover-letter",
        jobId: req.params.id,
      });

      ok(res, await hydrateJobPdfFreshness(updatedJob));
    } catch (error) {
      const err = toJobsRouteError(error);
      logger[err.status === 404 ? "warn" : "error"](
        "Cover letter generation failed",
        {
          route: "POST /api/jobs/:id/generate-cover-letter",
          jobId: req.params.id,
          status: err.status,
          code: err.code,
          details: err.details,
        },
      );
      fail(res, err);
    }
  },
);

jobsDocumentsRouter.post(
  "/:id/cover-letter/address",
  async (req: Request, res: Response) => {
    try {
      await requireJob(req.params.id);
      const suggestion = await generateCoverLetterAddress(req.params.id);
      ok(res, suggestion);
    } catch (error) {
      const err = toJobsRouteError(error, {
        invalidRequestFallbackMessage: "Failed to generate address",
      });
      logger[err.status >= 500 ? "error" : "warn"](
        "Cover letter address generation failed",
        {
          route: "POST /api/jobs/:id/cover-letter/address",
          jobId: req.params.id,
          status: err.status,
          code: err.code,
        },
      );
      fail(res, err);
    }
  },
);

jobsDocumentsRouter.post(
  "/:id/cover-letter/render",
  async (req: Request, res: Response) => {
    try {
      await requireJob(req.params.id);
      const result = await rerenderCoverLetter(req.params.id);
      if (!result.success) {
        throw badRequest(result.error ?? "Failed to update cover letter PDF");
      }
      const updatedJob = await jobsRepo.getJobById(req.params.id);
      if (!updatedJob) {
        throw new AppError({
          status: 404,
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }
      ok(res, await hydrateJobPdfFreshness(updatedJob));
    } catch (error) {
      const err = toJobsRouteError(error);
      logger[err.status >= 500 ? "error" : "warn"](
        "Cover letter re-render failed",
        {
          route: "POST /api/jobs/:id/cover-letter/render",
          jobId: req.params.id,
          status: err.status,
          code: err.code,
        },
      );
      fail(res, err);
    }
  },
);

jobsDocumentsRouter.post(
  "/:id/cover-letter/pdf",
  async (req: Request, res: Response) => {
    try {
      const input = uploadJobPdfSchema.parse(req.body);
      await requireJob(req.params.id);

      const bytes = decodeBase64Upload({
        dataBase64: input.dataBase64,
        maxBytes: MAX_COVER_LETTER_PDF_BYTES,
        emptyMessage: "Cover letter upload requires file data.",
        invalidMessage: "Cover letter file data must be valid base64.",
        tooLargeMessage: "Cover letter PDFs must be 10 MB or smaller.",
      });
      if (
        bytes.byteLength < 5 ||
        bytes.subarray(0, 5).toString("latin1") !== "%PDF-"
      ) {
        throw badRequest("Uploaded cover letter must be a valid PDF.");
      }

      const outputPath = getTenantCoverLetterPdfPath(req.params.id);
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, bytes);

      const updatedJob = await jobsRepo.setJobCoverLetter({
        id: req.params.id,
        coverLetterPath: outputPath,
        source: "uploaded",
      });
      if (!updatedJob) {
        // Job vanished between requireJob and the DB write — drop the orphaned file.
        await rm(outputPath, { force: true });
        throw new AppError({
          status: 404,
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      logger.info("Cover letter PDF replaced", {
        route: "POST /api/jobs/:id/cover-letter/pdf",
        jobId: req.params.id,
      });

      ok(res, await hydrateJobPdfFreshness(updatedJob));
    } catch (error) {
      const err = toJobsRouteError(error);
      logger[err.status >= 500 ? "error" : "warn"](
        "Cover letter PDF upload failed",
        {
          route: "POST /api/jobs/:id/cover-letter/pdf",
          jobId: req.params.id,
          status: err.status,
          code: err.code,
          details: err.details,
        },
      );
      fail(res, err);
    }
  },
);

jobsDocumentsRouter.delete("/:id/pdf", async (req: Request, res: Response) => {
  try {
    const job = await jobsRepo.getJobById(req.params.id);
    if (!job) {
      throw new AppError({
        status: 404,
        code: "NOT_FOUND",
        message: "Job not found",
      });
    }
    if (job.pdfSource !== "uploaded") {
      throw new AppError({
        status: 409,
        code: "CONFLICT",
        message: "Only an uploaded resume PDF can be deleted.",
      });
    }

    const previousPath = job.pdfPath;
    const updatedJob = await jobsRepo.updateJob(req.params.id, {
      pdfPath: null,
      pdfSource: null,
      pdfRegenerating: false,
      pdfFingerprint: null,
      pdfGeneratedAt: null,
    });
    if (!updatedJob) {
      throw new AppError({
        status: 404,
        code: "NOT_FOUND",
        message: "Job not found",
      });
    }

    if (previousPath) {
      await rm(previousPath, { force: true }).catch((cleanupError) => {
        logger.warn("Failed to delete uploaded resume PDF file", {
          route: "DELETE /api/jobs/:id/pdf",
          jobId: req.params.id,
          cleanupError,
        });
      });
    }

    logger.info("Uploaded resume PDF deleted", {
      route: "DELETE /api/jobs/:id/pdf",
      jobId: req.params.id,
    });

    ok(res, await hydrateJobPdfFreshness(updatedJob));
  } catch (error) {
    const err = toJobsRouteError(error);
    logger[err.status >= 500 ? "error" : "warn"](
      "Uploaded resume PDF delete failed",
      {
        route: "DELETE /api/jobs/:id/pdf",
        jobId: req.params.id,
        status: err.status,
        code: err.code,
        details: err.details,
      },
    );
    fail(res, err);
  }
});

jobsDocumentsRouter.delete(
  "/:id/cover-letter/pdf",
  async (req: Request, res: Response) => {
    try {
      const job = await jobsRepo.getJobById(req.params.id);
      if (!job) {
        throw new AppError({
          status: 404,
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }
      if (job.coverLetterSource !== "uploaded") {
        throw new AppError({
          status: 409,
          code: "CONFLICT",
          message: "Only an uploaded cover letter PDF can be deleted.",
        });
      }

      const previousPath = job.coverLetterPath;
      const updatedJob = await jobsRepo.updateJob(req.params.id, {
        coverLetterPath: null,
        coverLetterSource: null,
        coverLetterGeneratedAt: null,
      });
      if (!updatedJob) {
        throw new AppError({
          status: 404,
          code: "NOT_FOUND",
          message: "Job not found",
        });
      }

      if (previousPath) {
        await rm(previousPath, { force: true }).catch((cleanupError) => {
          logger.warn("Failed to delete uploaded cover letter PDF file", {
            route: "DELETE /api/jobs/:id/cover-letter/pdf",
            jobId: req.params.id,
            cleanupError,
          });
        });
      }

      logger.info("Uploaded cover letter PDF deleted", {
        route: "DELETE /api/jobs/:id/cover-letter/pdf",
        jobId: req.params.id,
      });

      ok(res, await hydrateJobPdfFreshness(updatedJob));
    } catch (error) {
      const err = toJobsRouteError(error);
      logger[err.status >= 500 ? "error" : "warn"](
        "Uploaded cover letter PDF delete failed",
        {
          route: "DELETE /api/jobs/:id/cover-letter/pdf",
          jobId: req.params.id,
          status: err.status,
          code: err.code,
          details: err.details,
        },
      );
      fail(res, err);
    }
  },
);

jobsDocumentsRouter.get(
  "/:id/documents",
  async (req: Request, res: Response) => {
    try {
      await requireJob(req.params.id);
      ok(res, await jobDocumentsRepo.listJobDocuments(req.params.id));
    } catch (error) {
      const err = toJobsRouteError(error);
      logger[err.status === 404 ? "warn" : "error"](
        "Job documents list failed",
        {
          route: "GET /api/jobs/:id/documents",
          jobId: req.params.id,
          status: err.status,
          code: err.code,
          details: err.details,
        },
      );
      fail(res, err);
    }
  },
);

jobsDocumentsRouter.post(
  "/:id/documents",
  async (req: Request, res: Response) => {
    let storagePath: string | null = null;

    try {
      const input = uploadJobDocumentSchema.parse(req.body);
      await requireJob(req.params.id);

      const stored = await storeJobDocument({
        jobId: req.params.id,
        fileName: input.fileName,
        mediaType: input.mediaType,
        dataBase64: input.dataBase64,
      });
      storagePath = stored.storagePath;

      const document = await jobDocumentsRepo.createJobDocument({
        jobId: req.params.id,
        fileName: stored.fileName,
        mediaType: stored.mediaType,
        byteSize: stored.byteSize,
        storagePath: stored.storagePath,
      });

      logger.info("Job document uploaded", {
        route: "POST /api/jobs/:id/documents",
        jobId: req.params.id,
        documentId: document.id,
        fileName: document.fileName,
        mediaType: document.mediaType,
        byteSize: document.byteSize,
      });

      ok(res, document, 201);
    } catch (error) {
      const err = toJobsRouteError(error, {
        invalidRequestFallbackMessage: "Invalid job document upload request",
      });

      if (storagePath) {
        await removeStoredJobDocument(storagePath).catch((cleanupError) => {
          logger.warn("Failed to clean up uploaded job document after error", {
            route: "POST /api/jobs/:id/documents",
            jobId: req.params.id,
            cleanupError,
          });
        });
      }

      logger.error("Job document upload failed", {
        route: "POST /api/jobs/:id/documents",
        jobId: req.params.id,
        status: err.status,
        code: err.code,
        details: err.details,
      });

      fail(res, err);
    }
  },
);

jobsDocumentsRouter.get(
  "/:id/documents/:documentId/content",
  async (req: Request, res: Response) => {
    try {
      await requireJob(req.params.id);
      const document = await jobDocumentsRepo.getJobDocumentForJob(
        req.params.id,
        req.params.documentId,
      );

      if (!document) {
        throw new AppError({
          status: 404,
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }

      setJobDocumentContentHeaders(res, document);
      res.sendFile(document.storagePath, (error) => {
        if (error && !res.headersSent) {
          removeJobDocumentContentHeaders(res);
          fail(
            res,
            new AppError({
              status: 404,
              code: "NOT_FOUND",
              message: "Document not found",
            }),
          );
        }
      });
    } catch (error) {
      const err = toJobsRouteError(error);
      logger[err.status === 404 ? "warn" : "error"](
        "Job document fetch failed",
        {
          route: "GET /api/jobs/:id/documents/:documentId/content",
          jobId: req.params.id,
          documentId: req.params.documentId,
          status: err.status,
          code: err.code,
          details: err.details,
        },
      );
      fail(res, err);
    }
  },
);

jobsDocumentsRouter.delete(
  "/:id/documents/:documentId",
  async (req: Request, res: Response) => {
    try {
      await requireJob(req.params.id);
      const document = await jobDocumentsRepo.deleteJobDocumentForJob(
        req.params.id,
        req.params.documentId,
      );

      if (!document) {
        throw new AppError({
          status: 404,
          code: "NOT_FOUND",
          message: "Document not found",
        });
      }

      await removeStoredJobDocument(document.storagePath).catch((error) => {
        logger.warn("Failed to delete job document file", {
          route: "DELETE /api/jobs/:id/documents/:documentId",
          jobId: req.params.id,
          documentId: req.params.documentId,
          error,
        });
      });

      logger.info("Job document deleted", {
        route: "DELETE /api/jobs/:id/documents/:documentId",
        jobId: req.params.id,
        documentId: req.params.documentId,
      });

      ok(res, null);
    } catch (error) {
      const err = toJobsRouteError(error);
      logger[err.status === 404 ? "warn" : "error"](
        "Job document delete failed",
        {
          route: "DELETE /api/jobs/:id/documents/:documentId",
          jobId: req.params.id,
          documentId: req.params.documentId,
          status: err.status,
          code: err.code,
          details: err.details,
        },
      );
      fail(res, err);
    }
  },
);

jobsDocumentsRouter.post(
  "/:id/summarize",
  async (req: Request, res: Response) => {
    try {
      const forceRaw = req.query.force as string | undefined;
      const force = forceRaw === "1" || forceRaw === "true";
      const fields = parseTailoringGenerateFields(
        req.query.fields as string | undefined,
      );

      if (isDemoMode()) {
        const result = await simulateSummarizeJob(req.params.id, {
          force,
          fields,
        });
        if (!result.success) {
          return fail(
            res,
            badRequest(result.error ?? "Failed to summarize the job"),
          );
        }
        const job = await requireJob(req.params.id);
        return okWithMeta(res, await hydrateJobPdfFreshness(job), {
          simulated: true,
        });
      }

      const previousJob = await requireJob(req.params.id);
      const result = await summarizeJob(req.params.id, { force, fields });

      if (!result.success) {
        return fail(
          res,
          badRequest(result.error ?? "Failed to summarize the job"),
        );
      }

      const job = await requireJob(req.params.id);
      ok(res, await hydrateJobPdfFreshness(job));

      queueTailoringAutoPdfRegenerationIfNeeded(
        previousJob,
        job,
        "POST /api/jobs/:id/summarize",
      );
    } catch (error) {
      fail(res, toJobsRouteError(error));
    }
  },
);

jobsDocumentsRouter.post(
  "/:id/generate-pdf",
  async (req: Request, res: Response) => {
    try {
      if (isDemoMode()) {
        const result = await simulateGeneratePdf(req.params.id);
        if (!result.success) {
          return fail(
            res,
            badRequest(result.error ?? "Failed to generate a resume PDF"),
          );
        }
        const job = await requireJob(req.params.id);
        return okWithMeta(res, await hydrateJobPdfFreshness(job), {
          simulated: true,
        });
      }

      const result = await generateFinalPdf(req.params.id, {
        requestOrigin: resolveRequestOrigin(req),
        analyticsOrigin: "generate_pdf",
      });

      if (!result.success) {
        return fail(
          res,
          appErrorFromPipelineFailure(
            result,
            "Failed to generate a resume PDF",
          ),
        );
      }

      const job = await requireJob(req.params.id);
      ok(res, await hydrateJobPdfFreshness(job));
    } catch (error) {
      fail(res, toJobsRouteError(error));
    }
  },
);
