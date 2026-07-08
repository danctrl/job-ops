import { fail } from "@infra/http";
import { logger } from "@infra/logger";
import { renderCoverLetterSamplePreview } from "@server/services/cover-letter";
import {
  COVER_LETTER_RENDERER_VALUES,
  COVER_LETTER_THEME_VALUES,
  LATEX_THEME_VALUES,
} from "@shared/types";
import { type Request, type Response, Router } from "express";
import { z } from "zod";
import { toJobsRouteError } from "./jobs/shared";

export const coverLetterRouter = Router();

const samplePreviewSchema = z
  .object({
    renderer: z.enum(COVER_LETTER_RENDERER_VALUES).optional(),
    theme: z.enum(COVER_LETTER_THEME_VALUES).optional(),
    latexTheme: z.enum(LATEX_THEME_VALUES).optional(),
  })
  .strict();

// Render a fixed sample cover letter with the given (or configured) renderer /
// template so the Settings picker can show a preview (no job context).
coverLetterRouter.post(
  "/preview-sample",
  async (req: Request, res: Response) => {
    try {
      const override = samplePreviewSchema.parse(req.body ?? {});
      const pdf = await renderCoverLetterSamplePreview(override);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.type("application/pdf");
      res.send(pdf);
    } catch (error) {
      const err = toJobsRouteError(error);
      logger.error("Cover letter sample preview failed", {
        route: "POST /api/cover-letter/preview-sample",
        status: err.status,
        code: err.code,
      });
      fail(res, err);
    }
  },
);
