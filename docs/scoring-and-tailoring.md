# Scoring & Tailoring — Strategy Reference

Developer-facing map of how a job goes from raw posting to a scored, tailored,
ATS-optimized CV. File references are anchors, not exact line guarantees — grep
the symbol if a line moved.

## End-to-end flow

```
Ingest job (search crawl OR manual import)
   │
   ├─ Extraction ──────────► structured fields + Job Brief  (job.jobBrief)
   │
   ├─ Scoring ─────────────► suitabilityScore 0-100 + reason (candidate fit)
   │
   └─ Tailoring (summarizeJob → generateTailoring)
          ├─ ensure a Job Brief exists (on-demand if missing)
          ├─ Headline   → exact JD title
          ├─ Summary    → JD-mirrored hook (+ optional keyword push)
          ├─ Skills     → LLM selects from master, deterministic guardrails
          ├─ Experience → LLM rephrases bullets, truthfulness guardrails (opt-in)
          ├─ Coverage   → % of brief must-haves present in the CV
          └─ Render     → applyTailoredChunks → PDF (latex/typst/rxresume)
```

The single tailoring code path is `summarizeJob` → `generateTailoring`
(`orchestrator/src/server/pipeline/orchestrator.ts`,
`orchestrator/src/server/services/summary.ts`). Every entry point funnels
through it:

- Search pipeline: `processJobsStep` → `processJob` → `summarizeJob`
- Manual import: `api/routes/manual-jobs.ts` (`/import`) → `processJob`
- Manual re-tailor: `api/routes/jobs/documents.ts` (`/:id/summarize`) → `summarizeJob`

## 1. Extraction & the Job Brief

`extractJobPosting` / `generateJobBrief` (`services/job-brief.ts`) turn the raw
JD into a structured `JobBrief` (`shared/src/types/jobs.ts`):

```ts
JobBrief {
  role_summary: string
  skills_and_domain_highlights: string[]   // clean, concrete skills
  tools_mentioned: string[]
  they_want: string[]                       // requirements
  company_offers: string[]
  missing_or_unclear: string[]
}
```

Stored as JSON in `jobs.job_brief`. The brief is the **reference vocabulary**
for skill selection, the summary keyword push, and the coverage score.

Set during extraction/scoring for both search (`pipeline/steps/score-jobs.ts`)
and manual import (`api/routes/manual-jobs.ts`). If it is still missing at
tailoring time, `summarizeJob` generates and persists one on demand so coverage
is always available regardless of ingestion path.

## 2. Scoring (job suitability)

`services/scorer.ts` — an LLM scores how well the **candidate fits the job**
(0-100 `suitabilityScore` + reason), used to prioritize which jobs to pursue.
This is distinct from the CV coverage score (§ Coverage), which measures how
well the **tailored CV covers the JD**.

## 3. Tailoring

`generateTailoring(jobDescription, profile, brief, skillsSettings, features)`
returns `TailoredData { headline, summary, skills, experience, coverageScore }`.
The prompt template lives in `shared/src/prompt-template-definitions.ts`
(`tailoringPromptTemplate`); flag-gated blocks are rendered from
`buildTailoringPrompt` in `summary.ts`.

### Headline
Must equal the JD job title exactly (top ATS factor). No translation/paraphrase.

### Summary
A "hook" mirroring the company's "about you". With the `summaryKeywordPush`
flag, the model also weaves in 2-3 genuine JD key terms using the JD's wording.

### Skills — curation (the core)
Principle: **the LLM selects, deterministic code guards.** Source of truth is
the master profile's skills (grouped, `profile.sections.skills`).

Per-group mode (settings `resumeSkills`, UI: design-resume rail):
- **Always** (locked) — guaranteed represented every CV
- **AI can select** (default) — LLM decides per job
- **Don't select** (excluded) — stripped from prompt + output

Flow:
1. Excluded groups removed before the prompt.
2. LLM selects/prioritizes/aligns wording from the remaining master skills.
3. `enforceSkillGuardrails` (`services/skill-selection.ts`):
   - **anti-invention** — a returned keyword must correspond to a real master
     skill (`calculateSimilarity >= 70`, or it embeds a real skill as a whole
     word — this admits ATS **dual-terms** like `Kubernetes (K8s)`)
   - **dedup** across the section
   - **cap** total keywords (`maxKeywords`, default 22)
   - **representation** — LOCKED groups forced to appear
   - **floor** — backfill from master if too few survive (never empty)

Synonyms/ATS wording: the prompt aligns a skill to the JD's exact term in either
direction and may render `Canonical (Variant)` dual-terms; these are ephemeral
(computed per job, stored in `jobs.tailored_skills`), not persisted to master.
To force a dual-term everywhere, put it in the master keyword itself.

### Experience — bullet tailoring (opt-in, `tailorExperience`)
The LLM rephrases each experience entry's bullets to surface the job's
terminology. `enforceExperienceGuardrails` (`services/experience-tailoring.ts`)
protects truthfulness — any failed check **falls back to the original bullets**,
so the result is never worse than the untouched CV:
- match entry to master by **company** (robust; not an opaque id)
- **number preservation** — every metric must exist in the original
- **length budget** — up to ~2 lines; runaway/filler reverts to original
- **anti-invention** — a bullet sharing almost no real words with the original
  is treated as fabricated → revert
Unmatched companies are left untouched (renderer keeps the master bullets).
Prompt also asks to vary wording across entries (no repeated taglines).

### Coverage score (ATS %)
`services/coverage.ts` — fraction of brief must-have terms
(`skills_and_domain_highlights ∪ tools_mentioned ∪ they_want`) present in the
tailored CV text (headline + summary + skills + experience bullets). A term
counts if the whole phrase appears OR most of its significant tokens appear
(token-level, e.g. "support triage" ↔ "support" + "triage"). Stored in
`jobs.coverage_score`; shown as an "ATS N%" badge on the job header when the
`showCoverageScore` flag is on.

## 4. Feature toggles

`tailoringFeatures` typed setting (`shared/src/settings-registry.ts`,
UI: Settings → Tailoring Features, `TailoringFeaturesSection.tsx`):

| flag | default | effect |
|---|---|---|
| `tailorExperience` | off | rephrase experience bullets |
| `summaryKeywordPush` | on | weave JD terms into the summary |
| `softSkillsOnlyIfMentioned` | on | soft skills only when the JD names them |
| `showCoverageScore` | on | show the ATS coverage badge |

The panel auto-saves per toggle (self-contained; the global "Save changes"
button does not apply to it).

## 5. Data model

Per job (`jobs` table): `job_brief`, `suitability_score`, `suitability_reason`,
`tailored_summary`, `tailored_headline`, `tailored_skills`,
`tailored_experience`, `coverage_score`, `selected_project_ids`.

Settings (registry-backed): `resumeProjects`, `resumeSkills`,
`tailoringFeatures`, `writingStyle`, `pdfRenderer`, …

## 6. Render

`applyTailoredChunks` (`services/rxresume/tailoring.ts`) writes the tailored
summary/headline/skills/experience back onto the working resume JSON;
`prepareTailoredResumeForPdf` then hands it to the active renderer
(`pdfRenderer` = latex / typst / rxresume). Experience bullets are written into
each entry's `description` in the original format (HTML list vs newlines).

## 7. Invariants (safety guarantees)

- Skills: never invented, never empty, capped, locked groups always present.
- Experience: never invented; any guardrail failure → original bullets; the CV
  can only stay the same or improve, never get worse.
- Coverage: computed for every tailored job (brief ensured on demand).

## 8. Known limits / future work

- Coverage matching is lexical (phrase + token), not semantic — acronyms that
  are Levenshtein-far (e.g. `K8s`↔`Kubernetes`) rely on the LLM/dual-term, not
  the metric.
- No curated synonym/alias table (deliberate — zero maintenance).
- Experience free-text fabrication beyond numbers/word-overlap is not fully
  detectable deterministically; `tailorExperience` stays opt-in for review.
- Coverage badge is on the job detail header, not the search-results list.

## Key files

| area | file |
|---|---|
| Tailoring orchestration | `pipeline/orchestrator.ts` (`summarizeJob`, `processJob`) |
| Tailoring LLM + schema + prompt wiring | `services/summary.ts` |
| Prompt template | `shared/src/prompt-template-definitions.ts` |
| Skills guardrails | `services/skill-selection.ts` |
| Experience guardrails | `services/experience-tailoring.ts` |
| Coverage | `services/coverage.ts` |
| Job brief | `services/job-brief.ts` |
| Scoring | `services/scorer.ts` |
| Render apply | `services/rxresume/tailoring.ts`, `services/rxresume/index.ts`, `services/resume-renderer/document.ts` |
| Settings registry/types | `shared/src/settings-registry.ts`, `shared/src/types/settings.ts` |
| Skill-mode UI | `components/design-resume/DesignResumeListSection.tsx`, `DesignResumeRail.tsx` |
| Feature-toggle UI | `pages/settings/components/TailoringFeaturesSection.tsx` |
