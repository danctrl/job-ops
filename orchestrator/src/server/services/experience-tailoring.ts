/**
 * Truthfulness guardrails for per-job experience-bullet tailoring.
 *
 * The LLM may only REPHRASE a candidate's existing bullets to surface the job's
 * terminology — it must not invent claims. Entries are matched to the master by
 * COMPANY name (robust: the model echoes a meaningful string reliably, unlike an
 * opaque id). These deterministic checks enforce truthfulness as far as free
 * text allows:
 *   - the entry must map to a real master experience item (by company);
 *   - the tailored bullet count may not exceed the original;
 *   - every number/metric in the tailored bullets must already exist in the
 *     original bullets — otherwise we fall back to the original bullets for that
 *     entry (never worse, never a fabricated metric).
 */

export interface TailoredExperienceEntry {
  company: string;
  bullets: string[];
}

export interface MasterExperienceItem {
  company?: string;
  summary?: string;
}

function normalizeCompany(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().toLowerCase()
    : "";
}

/** Split an experience item's stored description/summary into plain-text bullets. */
export function extractExperienceBullets(summary: unknown): string[] {
  if (typeof summary !== "string" || !summary.trim()) return [];
  const listItems = [...summary.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map(
      (m) =>
        m[1]
          ?.replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim() ?? "",
    )
    .filter(Boolean);
  if (listItems.length > 0) return listItems;
  return summary
    .replace(/<[^>]*>/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** Numeric tokens (with optional decimals / % / k / m suffix) in a text. */
function extractNumbers(text: string): Set<string> {
  const matches = text
    .toLowerCase()
    .match(/\d+(?:[.,]\d+)?\s*(?:%|k|m|bn|b|x|\+)?/g);
  return new Set((matches ?? []).map((n) => n.replace(/\s+/g, "")));
}

/** Significant words (>=4 chars) used to check a tailored bullet is a rephrase. */
function contentTokens(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter(
    (w) => w.length >= 4,
  );
}

/**
 * Length budget per tailored bullet. Allows a rephrase to grow enough to
 * surface a JD keyword (roughly up to two lines) but blocks runaway padding
 * (three-plus lines / filler). Line-wrapping is fine; ballooning is not.
 */
function bulletLengthBudget(originalBullets: string[]): number {
  const longest = originalBullets.reduce((m, b) => Math.max(m, b.length), 0);
  // ~45 chars of slack to weave in a keyword, with a ~2-line floor.
  return Math.max(longest + 45, 175);
}

/**
 * Validate the LLM's tailored experience against the master. Returns only
 * entries that map to a real item (by company); each keeps its rephrased
 * bullets unless a fabricated number is detected, in which case it falls back
 * to the original.
 */
export function enforceExperienceGuardrails(
  tailored: readonly TailoredExperienceEntry[] | undefined | null,
  masterItems: readonly MasterExperienceItem[] | undefined | null,
): TailoredExperienceEntry[] {
  const master = new Map<
    string,
    {
      company: string;
      originalBullets: string[];
      originalNumbers: Set<string>;
      originalTokens: Set<string>;
      budget: number;
    }
  >();
  for (const item of masterItems ?? []) {
    const key = normalizeCompany(item.company);
    if (!key) continue;
    const originalBullets = extractExperienceBullets(item.summary);
    master.set(key, {
      company: typeof item.company === "string" ? item.company : "",
      originalBullets,
      originalNumbers: extractNumbers(originalBullets.join(" ")),
      originalTokens: new Set(contentTokens(originalBullets.join(" "))),
      budget: bulletLengthBudget(originalBullets),
    });
  }

  const seen = new Set<string>();
  const result: TailoredExperienceEntry[] = [];
  for (const entry of tailored ?? []) {
    if (!entry || typeof entry.company !== "string") continue;
    const key = normalizeCompany(entry.company);
    const ref = master.get(key);
    if (!ref || seen.has(key)) continue; // unknown / duplicate company -> skip
    seen.add(key);

    const bullets = (Array.isArray(entry.bullets) ? entry.bullets : [])
      .filter((b): b is string => typeof b === "string" && b.trim() !== "")
      .map((b) => b.trim());
    if (bullets.length === 0) continue;

    // Never emit more bullets than the original had.
    const capped =
      ref.originalBullets.length > 0
        ? bullets.slice(0, ref.originalBullets.length)
        : bullets;

    // A tailored entry is only kept if EVERY bullet is a safe rephrase:
    //   - no fabricated numbers (all numbers exist in the original);
    //   - stays on one line (not much longer than the original);
    //   - is anchored to the original (shares real words) so the model
    //     cannot slip in a wholesale-invented responsibility.
    // Any failure -> fall back to the original bullets (never worse).
    const safe = capped.every((bullet) => {
      const numbers = extractNumbers(bullet);
      if (![...numbers].every((n) => ref.originalNumbers.has(n))) return false;
      if (ref.originalBullets.length > 0 && bullet.length > ref.budget) {
        return false;
      }
      const toks = contentTokens(bullet);
      if (toks.length >= 4) {
        const shared = toks.filter((t) => ref.originalTokens.has(t)).length;
        if (shared / toks.length < 0.3) return false; // unrelated -> invented
      }
      return true;
    });

    result.push({
      company: ref.company,
      bullets: safe ? capped : ref.originalBullets,
    });
  }
  return result;
}
