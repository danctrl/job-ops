/**
 * Normalize a source-provided posting date to a canonical ISO 8601 string.
 *
 * Extractors emit posting dates in inconsistent shapes: epoch milliseconds
 * (e.g. "1782345600000"), epoch seconds, ISO strings, or human/relative text
 * ("2 days ago"). Stored inconsistently they break sorting and posting-age
 * calculation (e.g. `new Date("1782345600000")` is Invalid Date).
 *
 * Rules:
 * - all-digit strings: interpreted as epoch ms (>=12 digits) or epoch seconds
 *   (>=10 digits) and converted to ISO; other numeric junk is kept as-is.
 * - anything `Date`-parseable (ISO etc.): canonicalized via toISOString().
 * - relative/unrecognized text: kept unchanged so downstream relative-age
 *   parsing can still handle it.
 */
export function normalizePostedDate(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^\d+$/.test(trimmed)) {
    const num = Number(trimmed);
    const ms =
      trimmed.length >= 12
        ? num
        : trimmed.length >= 10
          ? num * 1000
          : Number.NaN;
    if (Number.isFinite(ms)) {
      const fromEpoch = new Date(ms);
      if (!Number.isNaN(fromEpoch.getTime())) return fromEpoch.toISOString();
    }
    return trimmed;
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();

  return trimmed;
}
