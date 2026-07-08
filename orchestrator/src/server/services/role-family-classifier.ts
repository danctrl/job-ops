/**
 * LLM-based job role-family classification.
 *
 * Assigns each job a short canonical "role family" used for grouping. The LLM
 * is the sole source of truth (full-LLM mode); jobs are inserted with a null
 * roleFamily and this step fills it. Titles are sent in batches to keep the
 * token cost low, with a controlled-but-open vocabulary. When a batch fails
 * the affected jobs simply keep their null family rather than breaking the run.
 */
import { logger } from "@infra/logger";
import { asyncPool } from "@server/utils/async-pool";
import { KNOWN_ROLE_FAMILIES } from "@shared/utils/role-family";
import type { JsonSchemaDefinition } from "./llm/types";
import { createConfiguredLlmService, resolveLlmModel } from "./modelSelection";

export interface ClassifiableJob {
  id: string;
  title: string;
  employer: string | null;
}

interface RoleFamilyResult {
  jobId: string;
  roleFamily: string;
}

const BATCH_SIZE = 20;
const CONCURRENCY = 3;

export const ROLE_FAMILY_SCHEMA: JsonSchemaDefinition = {
  name: "role_family_classifications",
  schema: {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: {
            jobId: { type: "string", description: "The exact job id given" },
            roleFamily: {
              type: "string",
              description:
                "Concise Title Case role family (2-4 words), no seniority/location/gender",
            },
          },
          required: ["jobId", "roleFamily"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  },
};

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    batches.push(items.slice(i, i + size));
  }
  return batches;
}

export function cleanRoleFamily(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 60);
}

export function buildRoleFamilyPrompt(
  batch: readonly ClassifiableJob[],
): string {
  const known = KNOWN_ROLE_FAMILIES.join(", ");
  const lines = batch
    .map((job) =>
      job.employer
        ? `${job.id} | ${job.title} | ${job.employer}`
        : `${job.id} | ${job.title}`,
    )
    .join("\n");
  return `You label job postings with a short "role family" used only to group similar roles.

Rules:
- Prefer EXACTLY one of these known families when it fits: ${known}.
- If none fits, return a concise Title Case family of 2-4 words (e.g. "Product Manager", "UX Designer", "Accountant").
- Never include seniority (Senior/Junior/Lead), location, employment type, or gender markers.
- Return exactly one result per input job, echoing its id verbatim.

Jobs (id | title | employer):
${lines}`;
}

/** Map LLM results back to a jobId -> family map, ignoring unknown ids. */
export function mapClassifications(
  batch: readonly ClassifiableJob[],
  results: ReadonlyArray<RoleFamilyResult>,
): Map<string, string> {
  const batchIds = new Set(batch.map((job) => job.id));
  const mapped = new Map<string, string>();
  for (const result of results) {
    if (!batchIds.has(result.jobId)) continue;
    const family = cleanRoleFamily(result.roleFamily ?? "");
    if (family) mapped.set(result.jobId, family);
  }
  return mapped;
}

export async function classifyRoleFamilies(
  jobs: readonly ClassifiableJob[],
  options: { shouldCancel?: () => boolean; signal?: AbortSignal } = {},
): Promise<Map<string, string>> {
  const classifications = new Map<string, string>();
  if (jobs.length === 0) return classifications;

  const [model, llm] = await Promise.all([
    resolveLlmModel("scoring"),
    createConfiguredLlmService("scoring"),
  ]);

  await asyncPool({
    items: chunk(jobs, BATCH_SIZE),
    concurrency: CONCURRENCY,
    shouldStop: options.shouldCancel,
    task: async (batch) => {
      const response = await llm.callJson<{ results: RoleFamilyResult[] }>({
        model,
        messages: [{ role: "user", content: buildRoleFamilyPrompt(batch) }],
        jsonSchema: ROLE_FAMILY_SCHEMA,
        maxRetries: 1,
        signal: options.signal,
      });
      if (!response.success) {
        logger.warn("Role-family classification batch failed", {
          error: response.error,
          batchSize: batch.length,
        });
        return;
      }
      for (const [id, family] of mapClassifications(
        batch,
        response.data.results,
      )) {
        classifications.set(id, family);
      }
    },
  });

  return classifications;
}
