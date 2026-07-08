import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import * as settingsRepo from "@server/repositories/settings";
import {
  extractJobPosting,
  mergeStructuredIntoJob,
} from "@server/services/job-brief";
import { scoreJobSuitability } from "@server/services/scorer";
import * as visaSponsors from "@server/services/visa-sponsors/index";
import { asyncPool } from "@server/utils/async-pool";
import type { Job } from "@shared/types";
import { progressHelpers, updateProgress } from "../progress";
import type { ScoredJob } from "./types";

const SCORING_CONCURRENCY = 4;

export async function scoreJobsStep(args: {
  profile: Record<string, unknown>;
  scoringInstructions?: string;
  shouldCancel?: () => boolean;
  maxJobsToScore?: number;
}): Promise<{ unprocessedJobs: Job[]; scoredJobs: ScoredJob[] }> {
  logger.info("Running scoring step");
  // Cost ceiling: fetch at most `maxJobsToScore` freshest unscored jobs so the
  // number of LLM scoring calls is bounded regardless of how many were
  // discovered. The repo orders by discoveredAt desc, so the newest survive.
  const unprocessedJobs = await jobsRepo.getUnscoredDiscoveredJobs(
    args.maxJobsToScore,
  );
  if (args.maxJobsToScore && unprocessedJobs.length >= args.maxJobsToScore) {
    logger.info("Scoring capped at maxJobsToScore", {
      maxJobsToScore: args.maxJobsToScore,
    });
  }

  // Check if auto-skip threshold is configured
  const autoSkipThresholdRaw = await settingsRepo.getSetting(
    "autoSkipScoreThreshold",
  );
  const autoSkipThreshold = autoSkipThresholdRaw
    ? parseInt(autoSkipThresholdRaw, 10)
    : null;

  updateProgress({
    step: "scoring",
    jobsDiscovered: unprocessedJobs.length,
    jobsScored: 0,
    jobsProcessed: 0,
    totalToProcess: 0,
    currentJob: undefined,
  });

  const scoredJobs: ScoredJob[] = [];
  let completed = 0;
  const scoringInstructions = args.scoringInstructions?.trim();

  await asyncPool({
    items: unprocessedJobs,
    concurrency: SCORING_CONCURRENCY,
    shouldStop: args.shouldCancel,
    task: async (job) => {
      if (args.shouldCancel?.()) return;

      // Isolate each job: a single scoring/extraction failure must not abort the
      // whole pool (asyncPool rethrows the first error) or fail the run — log and
      // skip it so the rest of the batch still scores. A cancellation race is not
      // a failure, so swallow silently when cancel was requested.
      try {
        const hasCachedScore =
          typeof job.suitabilityScore === "number" &&
          !Number.isNaN(job.suitabilityScore);

        if (hasCachedScore) {
          completed += 1;
          progressHelpers.scoringJob(
            completed,
            unprocessedJobs.length,
            `${job.title} (cached)`,
          );
          scoredJobs.push({
            ...job,
            suitabilityScore: job.suitabilityScore as number,
            suitabilityReason: job.suitabilityReason ?? "",
          });
          return;
        }

        const scoringResultPromise = scoringInstructions
          ? scoreJobSuitability(job, args.profile, { scoringInstructions })
          : scoreJobSuitability(job, args.profile);
        const [{ score, reason }, extraction] = await Promise.all([
          scoringResultPromise,
          extractJobPosting(job.jobDescription, { jobId: job.id }),
        ]);
        if (args.shouldCancel?.()) return;

        let sponsorMatchScore = 0;
        let sponsorMatchNames: string | undefined;

        if (job.employer) {
          const sponsorResults = await visaSponsors.searchSponsors(
            job.employer,
            { limit: 10, minScore: 50 },
          );

          const summary =
            visaSponsors.calculateSponsorMatchSummary(sponsorResults);
          sponsorMatchScore = summary.sponsorMatchScore;
          sponsorMatchNames = summary.sponsorMatchNames ?? undefined;
        }

        // Check if job should be auto-skipped based on score threshold
        const shouldAutoSkip =
          job.status !== "applied" &&
          score !== null &&
          autoSkipThreshold !== null &&
          !Number.isNaN(autoSkipThreshold) &&
          score < autoSkipThreshold;

        await jobsRepo.updateJob(job.id, {
          suitabilityScore: score,
          suitabilityReason: reason,
          jobBrief: extraction?.jobBrief ?? null,
          ...(extraction
            ? mergeStructuredIntoJob(job, extraction.structured)
            : {}),
          sponsorMatchScore,
          sponsorMatchNames,
          ...(shouldAutoSkip ? { status: "skipped" } : {}),
        });

        if (shouldAutoSkip) {
          logger.info("Auto-skipped job due to low score", {
            jobId: job.id,
            title: job.title,
            score,
            threshold: autoSkipThreshold,
          });
        }

        completed += 1;
        progressHelpers.scoringJob(
          completed,
          unprocessedJobs.length,
          job.title,
        );
        scoredJobs.push({
          ...job,
          suitabilityScore: score,
          suitabilityReason: reason,
        });
      } catch (error) {
        if (args.shouldCancel?.()) return;
        logger.warn("Scoring failed for job; skipping", {
          jobId: job.id,
          title: job.title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
  });

  progressHelpers.scoringComplete(scoredJobs.length);
  logger.info("Scoring step completed", {
    scoredJobs: scoredJobs.length,
    concurrency: SCORING_CONCURRENCY,
  });

  return { unprocessedJobs, scoredJobs };
}
