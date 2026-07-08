import type { Job } from "@shared/types.js";
import type React from "react";
import {
  formatContractType,
  formatLevel,
  formatWorkmode,
} from "../lib/job-format";
import { cn } from "@/lib/utils";

const PILL_CLASS =
  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border/50 bg-card/70 px-2.5 py-1 text-xs font-medium text-foreground";

const Pill: React.FC<{ label: string; dotClass: string }> = ({
  label,
  dotClass,
}) => (
  <span className={PILL_CLASS}>
    <span className={cn("h-1.5 w-1.5 rounded-full", dotClass)} />
    {label}
  </span>
);

const WORKMODE_DOT: Record<string, string> = {
  Remote: "bg-emerald-400",
  Hybrid: "bg-amber-400",
  "On-site": "bg-sky-400",
};

/** Level + work mode + contract type as pills — the same at-a-glance summary
 *  the brief status row shows, for the top of the job page. */
export const JobStatusPills: React.FC<{ job: Job; className?: string }> = ({
  job,
  className,
}) => {
  const level = formatLevel(job.jobLevel);
  const workmode = formatWorkmode(job);
  const contract = formatContractType(job.jobType);
  if (!level && !workmode && !contract) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {level && <Pill label={level} dotClass="bg-indigo-400" />}
      {workmode && (
        <Pill
          label={workmode}
          dotClass={WORKMODE_DOT[workmode] ?? "bg-primary/70"}
        />
      )}
      {contract && <Pill label={contract} dotClass="bg-muted-foreground/60" />}
    </div>
  );
};
