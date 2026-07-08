/**
 * Canonical role families used to group jobs.
 *
 * Classification is done by the LLM enrichment step (full-LLM mode); this list
 * is the controlled vocabulary the model is asked to prefer. It is not
 * exhaustive — the model may return a concise new family when none of these
 * fit (e.g. non-engineering roles).
 */
export const KNOWN_ROLE_FAMILIES: readonly string[] = [
  "Site Reliability Engineer",
  "DevSecOps Engineer",
  "DevOps Engineer",
  "Platform Engineer",
  "Cloud Engineer",
  "Machine Learning Engineer",
  "Data Engineer",
  "Security Engineer",
  "Infrastructure Engineer",
  "Backend Engineer",
  "Frontend Engineer",
  "Full Stack Engineer",
  "Network Engineer",
  "Systems Engineer",
  "QA Engineer",
  "Solutions Architect",
  "Software Architect",
  "Engineering Manager",
  "Tech Lead",
  "Software Engineer",
];
