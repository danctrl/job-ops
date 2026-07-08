import { createJob } from "@shared/testing/factories";
import { describe, expect, it } from "vitest";
import { shouldEnqueueCoverLetterAutoPdfRegeneration } from "./shared";

describe("shouldEnqueueCoverLetterAutoPdfRegeneration", () => {
  it("enqueues when a generated cover letter's details change on a ready job", () => {
    const previous = createJob({
      status: "ready",
      coverLetterSource: "generated",
      coverLetterDetails: { body: "before" },
    });
    const next = createJob({
      status: "ready",
      coverLetterSource: "generated",
      coverLetterDetails: { body: "after" },
    });

    expect(shouldEnqueueCoverLetterAutoPdfRegeneration(previous, next)).toBe(
      true,
    );
  });

  it("ignores cover letters that are uploaded (not generated)", () => {
    const previous = createJob({
      status: "ready",
      coverLetterSource: "uploaded",
      coverLetterDetails: { body: "before" },
    });
    const next = createJob({
      status: "ready",
      coverLetterSource: "uploaded",
      coverLetterDetails: { body: "after" },
    });

    expect(shouldEnqueueCoverLetterAutoPdfRegeneration(previous, next)).toBe(
      false,
    );
  });

  it("skips when the job is not ready", () => {
    const previous = createJob({
      status: "in_progress",
      coverLetterSource: "generated",
      coverLetterDetails: { body: "before" },
    });
    const next = createJob({
      status: "in_progress",
      coverLetterSource: "generated",
      coverLetterDetails: { body: "after" },
    });

    expect(shouldEnqueueCoverLetterAutoPdfRegeneration(previous, next)).toBe(
      false,
    );
  });

  it("skips when the cover letter details are unchanged", () => {
    const details = { body: "same", salutation: "Dear team," };
    const previous = createJob({
      status: "ready",
      coverLetterSource: "generated",
      coverLetterDetails: details,
    });
    const next = createJob({
      status: "ready",
      coverLetterSource: "generated",
      coverLetterDetails: { ...details },
    });

    expect(shouldEnqueueCoverLetterAutoPdfRegeneration(previous, next)).toBe(
      false,
    );
  });
});
