import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import { classifyRoleFamilies } from "@server/services/role-family-classifier";
import type { Job } from "@shared/types";

/**
 * Enrich discovered jobs with an LLM-assigned role family (full-LLM mode).
 * Best-effort: any failure is swallowed so jobs keep their null family and the
 * pipeline is never broken by classification.
 */
export async function enrichRoleFamiliesStep(args: {
  jobs: readonly Job[];
  shouldCancel?: () => boolean;
}): Promise<{ enrichedCount: number }> {
  if (args.jobs.length === 0) return { enrichedCount: 0 };

  logger.info("Running role-family enrichment step", {
    jobs: args.jobs.length,
  });

  let enrichedCount = 0;
  try {
    const classifications = await classifyRoleFamilies(
      args.jobs.map((job) => ({
        id: job.id,
        title: job.title,
        employer: job.employer,
      })),
      { shouldCancel: args.shouldCancel },
    );

    for (const [id, roleFamily] of classifications) {
      if (args.shouldCancel?.()) break;
      await jobsRepo.updateJob(id, { roleFamily });
      enrichedCount += 1;
    }
  } catch (error) {
    logger.warn("Role-family enrichment skipped", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info("Role-family enrichment complete", { enrichedCount });
  return { enrichedCount };
}
