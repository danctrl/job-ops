/**
 * Structured salary parsed from a free-text range. Both ingestion paths converge
 * on these fields: the scraper already provides them numerically, and manual /
 * LLM text is parsed here so filtering and display use one shape. `text` keeps
 * the original human-readable string; a fully unparseable, empty input is null.
 */
export type SalaryPeriod = "year" | "month" | "week" | "day" | "hour";

export interface ParsedSalary {
  text: string;
  min: number | null;
  max: number | null;
  currency: string | null;
  period: SalaryPeriod | null;
}

const CURRENCY_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["EUR", /€|\beur\b|\beuro\b/i],
  ["GBP", /£|\bgbp\b/i],
  ["USD", /\$|\busd\b/i],
  ["CHF", /\bchf\b|\bsfr\b/i],
];

const PERIOD_PATTERNS: ReadonlyArray<readonly [SalaryPeriod, RegExp]> = [
  ["hour", /\/\s*h\b|per\s+hour|hourly|\bstunde\b|\/\s*std\b|\bp\.?h\.?\b/i],
  ["day", /\/\s*day\b|per\s+day|daily|\btag\b|\/\s*tag\b/i],
  ["week", /\/\s*w(?:k|eek)?\b|per\s+week|weekly|\bwoche\b/i],
  ["month", /\/\s*mo(?:nth)?\b|per\s+month|monthly|\bmonat\b|\/\s*mon\b/i],
  [
    "year",
    /\/\s*(?:yr|year|a)\b|per\s+(?:year|annum)|yearly|annual|p\.?a\.?\b|\bjahr\b|\bpro\s+jahr\b/i,
  ],
];

/** Parse a single amount token that may use k-suffix and EN or DE separators. */
function parseAmount(token: string): number | null {
  let t = token.replace(/[^\d.,kmKM]/g, "");
  if (!t) return null;
  let mult = 1;
  const suffix = t.match(/[kmKM]$/)?.[0]?.toLowerCase();
  if (suffix) {
    mult = suffix === "m" ? 1_000_000 : 1_000;
    t = t.slice(0, -1);
  }
  if (t.includes(".") && t.includes(",")) {
    // Both separators: the rightmost is the decimal separator.
    if (t.lastIndexOf(",") > t.lastIndexOf(".")) {
      t = t.replace(/\./g, "").replace(",", "."); // 1.500,50 -> 1500.50 (DE)
    } else {
      t = t.replace(/,/g, ""); // 1,500.50 -> 1500.50 (EN)
    }
  } else if (t.includes(",")) {
    // Comma only: thousands when it groups 3 digits, else a decimal point.
    t = /,\d{3}(?:\D|$)/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if (t.includes(".")) {
    // Dot only: thousands when it groups exactly 3 digits (60.000), else decimal.
    if (/\.\d{3}(?:\D|$)/.test(t)) t = t.replace(/\./g, "");
  }
  const n = Number.parseFloat(t);
  return Number.isFinite(n) ? Math.round(n * mult) : null;
}

/**
 * Parse a free-text salary string into structured `{ min, max, currency,
 * period }`, preserving the original as `text`. Returns null when the input is
 * empty; returns a text-only record (numbers null) when no amount is found.
 */
export function parseSalary(
  raw: string | null | undefined,
): ParsedSalary | null {
  const text = raw?.trim();
  if (!text) return null;

  const currency =
    CURRENCY_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? null;
  const period = PERIOD_PATTERNS.find(([, re]) => re.test(text))?.[0] ?? null;

  // Grab number-like tokens (digits with optional grouping/decimal + k/m).
  const tokens = text.match(/\d[\d.,]*\s*[kmKM]?/g) ?? [];
  const parsed = tokens
    .map((tok) => ({
      value: parseAmount(tok),
      suffix: tok.match(/[kmKM]/)?.[0]?.toLowerCase() ?? null,
    }))
    .filter(
      (p): p is { value: number; suffix: string | null } =>
        p.value !== null && p.value > 0,
    );

  // In a range like "60-70k" the suffix binds only to the last number; apply it
  // to bare sub-thousand siblings so both ends scale together.
  const groupSuffix = parsed.find((p) => p.suffix)?.suffix ?? null;
  if (groupSuffix) {
    const mult = groupSuffix === "m" ? 1_000_000 : 1_000;
    for (const p of parsed) {
      if (!p.suffix && p.value < 1000) p.value *= mult;
    }
  }
  const amounts = parsed.map((p) => p.value);

  let min: number | null = null;
  let max: number | null = null;
  if (amounts.length === 1) {
    // A lone number with a "+"/"from"/"ab" cue is a floor, otherwise a max.
    if (/\+|\bfrom\b|\bab\b|\bmin(?:imum)?\b/i.test(text)) min = amounts[0];
    else max = amounts[0];
  } else if (amounts.length >= 2) {
    min = Math.min(amounts[0], amounts[1]);
    max = Math.max(amounts[0], amounts[1]);
  }

  return { text, min, max, currency, period };
}
