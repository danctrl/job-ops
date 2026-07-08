export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function stripHtmlTags(value: string): string {
  return normalizeWhitespace(value.replace(/<[^>]*>/g, " "));
}

// Country/region words that end an "or"-joined location list.
const LOCATION_COUNTRY_WORDS = new Set([
  "germany",
  "deutschland",
  "austria",
  "österreich",
  "osterreich",
  "switzerland",
  "schweiz",
  "europe",
  "europa",
  "eu",
]);

// Known city -> country, so a bare city gets its country appended
// ("Berlin" -> "Berlin, Germany"). Sources sometimes drop the country.
const GERMAN_CITIES = [
  "frankfurt am main",
  "berlin",
  "hamburg",
  "münchen",
  "munich",
  "köln",
  "cologne",
  "frankfurt",
  "stuttgart",
  "düsseldorf",
  "dusseldorf",
  "dortmund",
  "essen",
  "leipzig",
  "dresden",
  "hannover",
  "hanover",
  "nürnberg",
  "nuremberg",
  "bremen",
  "duisburg",
  "bochum",
  "wuppertal",
  "bonn",
  "münster",
  "karlsruhe",
  "mannheim",
  "augsburg",
  "wiesbaden",
  "braunschweig",
  "kiel",
  "aachen",
  "magdeburg",
  "freiburg",
  "mainz",
  "lübeck",
  "erfurt",
  "rostock",
  "kassel",
  "potsdam",
  "heidelberg",
  "darmstadt",
  "regensburg",
  "ingolstadt",
  "ulm",
  "göttingen",
];
const CITY_COUNTRY = new Map<string, string>([
  ...GERMAN_CITIES.map((city) => [city, "Germany"] as [string, string]),
  ...["wien", "vienna", "graz", "linz", "salzburg", "innsbruck"].map(
    (city) => [city, "Austria"] as [string, string],
  ),
  ...["zürich", "zurich", "genf", "geneva", "basel", "bern"].map(
    (city) => [city, "Switzerland"] as [string, string],
  ),
  ["amsterdam", "Netherlands"],
  ["london", "United Kingdom"],
  ["paris", "France"],
  ["madrid", "Spain"],
  ["barcelona", "Spain"],
  ["dublin", "Ireland"],
]);
// German federal states (EN + DE + abbreviations). A location whose leading
// component is one of these is a region, not a city, so it collapses to the
// country. City-states (Berlin, Hamburg, Bremen) are intentionally excluded —
// there the name IS the city.
const GERMAN_STATES = new Set([
  "baden-württemberg",
  "baden-wurttemberg",
  "bavaria",
  "bayern",
  "brandenburg",
  "hesse",
  "hessen",
  "lower saxony",
  "niedersachsen",
  "mecklenburg-vorpommern",
  "mecklenburg-western pomerania",
  "north rhine-westphalia",
  "nordrhein-westfalen",
  "nrw",
  "rhineland-palatinate",
  "rheinland-pfalz",
  "saarland",
  "saxony",
  "sachsen",
  "saxony-anhalt",
  "sachsen-anhalt",
  "schleswig-holstein",
  "thuringia",
  "thüringen",
  "thueringen",
]);

// A component that is an administrative region rather than a city: a known
// German state, a name ending in a region word ("Brussels Region", "New York
// State"), or a "Greater/Grand X" agglomeration.
const REGION_SUFFIX_RE =
  /\b(?:region|province|state|county|district|oblast|kanton|canton|prefecture|voivodeship|governorate|metropolitan(?:\s+area)?)$/i;
const REGION_PREFIX_RE = /^(?:greater|grand)\s/i;
function isRegion(part: string): boolean {
  return (
    GERMAN_STATES.has(part.toLowerCase()) ||
    REGION_SUFFIX_RE.test(part) ||
    REGION_PREFIX_RE.test(part)
  );
}

// Reduce a location to "City, Country" or just "Country". Keeps the last
// component (country); for the city, prefer the first *known* city so a leading
// district collapses to its city ("Neukölln, Berlin, Germany" -> "Berlin,
// Germany"), otherwise the first non-region component ("Brussels, Brussels
// Region, Belgium" -> "Brussels, Belgium"; "NRW, Germany" -> "Germany").
function reduceToCityCountry(parts: string[]): string[] {
  if (parts.length < 2) return parts;
  const country = parts[parts.length - 1];
  const upstream = parts.slice(0, -1);
  const city =
    upstream.find((part) => CITY_COUNTRY.has(part.toLowerCase())) ??
    upstream.find((part) => !isRegion(part));
  const result: string[] = [];
  if (city) result.push(city);
  if (!city || city.toLowerCase() !== country.toLowerCase()) {
    result.push(country);
  }
  return result.length ? result : parts;
}

// Append the country for a bare single-city location ("Berlin" ->
// "Berlin, Germany"). Multi-component locations are left as-is — they either
// already carry a country or a district we should not second-guess.
function appendCityCountry(parts: string[]): string[] {
  if (parts.length !== 1) return parts;
  const country = CITY_COUNTRY.get(parts[0].toLowerCase());
  return country ? [parts[0], country] : parts;
}

/**
 * Reduce an "or"-joined alternates list to the first place plus the first
 * country, dropping the rest. Sources like hiringcafe emit
 * "Berlin or Munich or Germany" / "Koblenz or Berlin or Cologne or Germany".
 * "Berlin or Munich or Germany" -> "Berlin, Germany".
 */
function collapseLocationAlternatives(value: string): string {
  if (!/\s+or\s+/i.test(value)) return value;
  const segments = value
    .split(/\s+or\s+/i)
    .map((part) => part.trim())
    .filter(Boolean);
  if (!segments.length) return value;
  const isCountry = (part: string) =>
    LOCATION_COUNTRY_WORDS.has(part.toLowerCase());
  const primary = segments.find((part) => !isCountry(part)) ?? segments[0];
  const country = segments.find(isCountry);
  return country && country.toLowerCase() !== primary.toLowerCase()
    ? `${primary}, ${country}`
    : primary;
}

/**
 * Collapse consecutive duplicate comma-separated components in a location
 * string (case-insensitive) and normalize whitespace. Fixes city-state
 * duplication emitted by sources like LinkedIn, e.g.
 * "Berlin, Berlin, Germany" -> "Berlin, Germany". Also reduces "or"-joined
 * alternates ("Berlin or Munich or Germany" -> "Berlin, Germany"), collapses
 * any region/subdivision between the city and country ("Brussels, Brussels
 * Region, Belgium" -> "Brussels, Belgium"; "Düsseldorf, North Rhine-
 * Westphalia, Germany" -> "Düsseldorf, Germany"; "NRW, Germany" -> "Germany"),
 * and appends the country to a bare known city ("Berlin" -> "Berlin, Germany").
 * Result is always city + country, or country only.
 */
export function normalizeLocation(value: string): string {
  const parts = collapseLocationAlternatives(normalizeWhitespace(value))
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  const deduped: string[] = [];
  for (const part of parts) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev.toLowerCase() !== part.toLowerCase()) {
      deduped.push(part);
    }
  }
  return appendCityCountry(reduceToCityCountry(deduped)).join(", ");
}

// Matches an HTML tag (e.g. <p>, </div>, <br/>) or a named/numeric entity.
// Intentionally strict on tags (name must be followed by whitespace or ">") so
// Markdown autolinks like <https://example.com> are not treated as HTML.
const HTML_MARKER =
  /<\/?[a-z][a-z0-9]*(?:\s[^>]*)?>|&(?:nbsp|amp|lt|gt|quot|apos|#\d+|#x[0-9a-f]+);/i;

/**
 * Convert HTML to readable plain text while preserving paragraph and line
 * breaks. When the value contains no HTML markers it is treated as
 * Markdown/plain text and only has its whitespace normalized, so clean inputs
 * pass through untouched.
 */
export function htmlToText(value: string): string {
  const normalizedBreaks = value.replace(/\r\n?/g, "\n");
  if (!HTML_MARKER.test(normalizedBreaks)) {
    return normalizedBreaks
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  return (
    normalizedBreaks
      .replace(/<\s*br\s*\/?>/gi, "\n")
      .replace(
        /<\/\s*(?:p|div|li|h[1-6]|ul|ol|tr|table|section|article)\s*>/gi,
        "\n",
      )
      .replace(/<[^>]*>/g, " ")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">")
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&apos;/gi, "'")
      // Decode &amp; last so sequences like "&amp;lt;" do not double-decode.
      .replace(/&amp;/gi, "&")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

// A single gender/diversity token part, e.g. the "m", "w", "d" in "m/w/d".
const GENDER_PART = "(?:m|w|f|d|x|i|g|n|gn|div|divers|diverse)";
// A gender combo trailing the title after an optional separator, for sources
// that omit the parentheses (e.g. "Data Engineer - m/w/d"). Kept strict (>=2
// parts) so internal role lists like "AWS / GCP" or a trailing single letter
// are never touched.
const BARE_TRAILING_GENDER = new RegExp(
  `\\s*[-–—|,/]?\\s*${GENDER_PART}(?:\\s*[/|]\\s*${GENDER_PART}){1,4}\\s*\\*?$`,
  "i",
);

// Canonicalize seniority abbreviations: "(Sr.)"/"Sr." -> "Senior", "Jr." ->
// "Junior". Only whole-token forms (parenthesized or with a trailing period)
// so we never touch letters inside a word.
function canonicalizeSeniority(title: string): string {
  return title
    .replace(/\(\s*sr\.?\s*\)/gi, "Senior")
    .replace(/\(\s*jr\.?\s*\)/gi, "Junior")
    .replace(/\bsr\.(?=\s|$)/gi, "Senior")
    .replace(/\bjr\.(?=\s|$)/gi, "Junior");
}

// Parenthetical seniority is a German-posting artifact:
// "(Junior) Product Manager", "(Associate) Product Manager". Unwrap to a bare
// word first so the leading-level detector can lift it into the Level field.
const PAREN_SENIORITY_RE =
  /\(\s*(junior|senior|associate|lead|principal|staff|trainee|intern|working\s+student|werkstudent(?:in)?|praktikant(?:in)?)\s*\)/gi;

function unwrapParentheticalSeniority(title: string): string {
  return title.replace(PAREN_SENIORITY_RE, "$1");
}

// Seniority level detected at the title's start, mapped to a canonical label.
// The level is lifted out of the title into the Level field, so it shows only
// in the brief status row — never in the title. Deliberately excludes
// ambiguous words like "Lead"/"Staff" ("Lead Generation", "Staff Accountant").
const LEVEL_PATTERNS: Array<[RegExp, string]> = [
  [/^(?:senior|sr\.?)\b/i, "Senior"],
  [/^(?:junior|jr\.?)\b/i, "Junior"],
  [/^associate\b/i, "Associate"],
  [/^principal\b/i, "Principal"],
  [/^trainee\b/i, "Trainee"],
  [/^(?:working\s+student|werkstudent(?:in)?)\b/i, "Werkstudent"],
  [/^(?:praktikant(?:in)?|internship|intern)\b/i, "Intern"],
  [/^graduate\b/i, "Graduate"],
  [/^entry[\s-]?level\b/i, "Entry-level"],
  [/^mid[\s-]?level\b/i, "Mid-level"],
];

// Detect a leading level word and the role remaining after it. Returns null
// when the level is the whole title (so "Associate" alone stays a title).
function detectLeadingLevel(
  title: string,
): { level: string; rest: string } | null {
  const trimmed = title.trimStart();
  for (const [pattern, level] of LEVEL_PATTERNS) {
    const match = trimmed.match(pattern);
    if (!match) continue;
    const rest = trimmed
      .slice(match[0].length)
      .replace(/^[\s,–—-]+/, "")
      .trim();
    if (rest) return { level, rest };
  }
  return null;
}

/**
 * Extract the canonical seniority level from a raw title ("Junior AI Project
 * Manager" -> "Junior", "(Sr.) DevOps Engineer" -> "Senior"), or null. Used to
 * populate the Level field when the extractor did not provide one.
 */
export function extractJobLevel(rawTitle: string): string | null {
  const canonical = unwrapParentheticalSeniority(
    canonicalizeSeniority(normalizeWhitespace(rawTitle)),
  );
  return detectLeadingLevel(canonical)?.level ?? null;
}

/**
 * Clean a job title down to the role. Every qualifier is stripped and lives in
 * the brief instead: parenthetical/bracket tags (gender/diversity, location,
 * contract/work-mode, tools, domains), separator-led tails, and the leading
 * seniority level (which is surfaced via {@link extractJobLevel} in the Level
 * field). Non-parenthesized trailing tails (gender combo, city, contract,
 * market segment) are also removed.
 *
 * "Cloud DevOps Engineer (all genders)"    -> "Cloud DevOps Engineer"
 * "(Sr.) DevOps Engineer"                  -> "DevOps Engineer"
 * "Junior AI Project Manager"              -> "AI Project Manager"
 * "DevOps Engineer (m/w/d) in Hamburg"     -> "DevOps Engineer"
 * "Infrastructure Engineer (Kubernetes)"   -> "Infrastructure Engineer"
 * "Product Manager (AI)"                    -> "Product Manager"
 * "(Junior) AI Project Manager"            -> "Junior AI Project Manager"
 */
// Curated location tokens that belong in the location field, not the title.
// An allowlist (not "any capitalized word after 'in'") so domain phrases like
// "in Finance" or "in Fintech" are never mistaken for a place.
const TITLE_CITIES = [
  "frankfurt am main",
  "berlin",
  "hamburg",
  "münchen",
  "munich",
  "köln",
  "cologne",
  "frankfurt",
  "stuttgart",
  "düsseldorf",
  "dusseldorf",
  "dortmund",
  "essen",
  "leipzig",
  "dresden",
  "hannover",
  "hanover",
  "nürnberg",
  "nuremberg",
  "bremen",
  "duisburg",
  "bochum",
  "wuppertal",
  "bonn",
  "münster",
  "karlsruhe",
  "mannheim",
  "augsburg",
  "wiesbaden",
  "braunschweig",
  "kiel",
  "aachen",
  "magdeburg",
  "freiburg",
  "mainz",
  "lübeck",
  "erfurt",
  "rostock",
  "kassel",
  "potsdam",
  "heidelberg",
  "darmstadt",
  "regensburg",
  "ingolstadt",
  "ulm",
  "göttingen",
  "wien",
  "vienna",
  "graz",
  "linz",
  "salzburg",
  "innsbruck",
  "zürich",
  "zurich",
  "genf",
  "geneva",
  "basel",
  "bern",
  "amsterdam",
  "london",
  "paris",
  "madrid",
  "barcelona",
  "dublin",
];
// Longest-first so multi-word cities win in the alternation.
const CITY_ALT = TITLE_CITIES.slice()
  .sort((a, b) => b.length - a.length)
  .join("|");
const COUNTRY_TAIL = "(?:\\s*[,/|]\\s*(?:germany|deutschland|europe|eu))?";
// Trailing " in <City>" fragments, e.g. "DevOps Engineer in Hamburg".
const IN_CITY_RE = new RegExp(
  `\\s+in\\s+(?:${CITY_ALT})${COUNTRY_TAIL}\\s*$`,
  "i",
);
// A trailing bare city the source appended to the role, e.g. "… Traineeprogramm
// Berlin". Allowlist-bound so ordinary words are never mistaken for a place.
const BARE_TRAILING_CITY_RE = new RegExp(
  `\\s+(?:${CITY_ALT})${COUNTRY_TAIL}\\s*$`,
  "i",
);
// A lone trailing workplace word (no separator), e.g. "Developer remote".
const BARE_WORKPLACE_RE = new RegExp(
  `\\s+(?:remote|hybrid|on[\\s-]?site|vor\\s+ort)${COUNTRY_TAIL}\\s*$`,
  "i",
);

// A lone trailing contract word with no separator, e.g. "Engineer Vollzeit".
// (Separator-led tails are already removed by the role-tail truncation.)
const CONTRACT_ALT =
  "in\\s+festanstellung|festanstellung|voll-?\\s*(?:oder|/)\\s*teilzeit|vollzeit|teilzeit|unbefristet|befristet|full[\\s-]?time|part[\\s-]?time|permanent|temporary";
const BARE_CONTRACT_RE = new RegExp(`\\s+(?:${CONTRACT_ALT})\\s*$`, "i");

// A trailing market-segment qualifier sales/BD titles append with no separator
// ("Business Development Representative Mid-Market" -> "… Representative").
// Allowlisted so it never truncates a role whose core is one of these words
// (they are stripped only when trailing, never when leading).
const SEGMENT_ALT =
  "mid[\\s-]?market|enterprise|smb|sme|commercial|strategic|corporate|(?:named|key|global|major)\\s+accounts|public\\s+sector";
const BARE_TRAILING_SEGMENT_RE = new RegExp(`\\s+(?:${SEGMENT_ALT})\\s*$`, "i");

// The role core is everything before the first tail separator: a space-padded
// dash/pipe or a comma. Sources append specialization/domain/team/location
// after it ("… - Tax Enablement", "… – MarTech", "…, Agent AI",
// "… -Bulgaria/Turkey"). Internal hyphens without a leading space
// ("IT-Projektmanager", "Go-To-Market") are preserved.
const ROLE_TAIL_DASH_RE = /\s+[-–—|].*$/u;
const ROLE_TAIL_COMMA_RE = /,.*$/u;

export function normalizeJobTitle(value: string): string {
  const original = normalizeWhitespace(value);
  if (!original) return original;

  // Lift the leading seniority level out of the title (it shows in the Level
  // field / brief status row). Canonicalize abbreviations and unwrap
  // parenthesized seniority first so "(Sr.)"/"(Junior)" are detected too.
  let result = unwrapParentheticalSeniority(canonicalizeSeniority(original));
  const leadingLevel = detectLeadingLevel(result);
  if (leadingLevel) result = leadingLevel.rest;
  // Every remaining parenthetical/bracket group is a qualifier that belongs in
  // the brief, not the title: gender/diversity, location, contract/work-mode,
  // tools, and business domains. Strip them all.
  result = result.replace(/\s*[([]\s*[^()[\]]*?\s*[)\]]\s*\*?/g, " ");
  // A trailing "@ Company/Venture" belongs in the employer field, not the title
  // ("… Team Lead @ AI Cybersecurity Venture" -> "… Team Lead").
  result = result.replace(/\s*@\s+\S.*$/u, "");
  // Inline German gender markers on the role noun (Ingenieur*in, Leiter/in,
  // Kolleg:in, Mitarbeiter:innen, MitarbeiterInnen) -> keep the base noun. The
  // trailing-combo form (m/w/d) is handled separately below.
  result = result.replace(
    /([A-Za-zÄÖÜäöüß])(?:[*:/](?:in|innen)|Innen)\b/gu,
    "$1",
  );
  // Truncate the specialization/domain/team/location tail after the first
  // separator, keeping only the core role.
  result = result.replace(ROLE_TAIL_DASH_RE, "");
  result = result.replace(ROLE_TAIL_COMMA_RE, "");
  // Non-parenthesized trailing tails that have no separator (gender combo,
  // city, workplace, contract word).
  result = result.replace(BARE_TRAILING_GENDER, "");
  result = result.replace(IN_CITY_RE, "");
  result = result.replace(BARE_TRAILING_CITY_RE, "");
  result = result.replace(BARE_WORKPLACE_RE, "");
  result = result.replace(BARE_CONTRACT_RE, "");
  result = result.replace(BARE_TRAILING_SEGMENT_RE, "");
  result = result
    .replace(/\(\s*\)|\[\s*\]/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([),.\]])/g, "$1")
    .replace(/^[\s\-–—|,/]+|[\s\-–—|,/]+$/g, "")
    .trim();

  return result || original;
}

/**
 * Clean an employer name for storage/display. Strips scraping artifacts that
 * leak from source pages while preserving the real name and legal form
 * (GmbH, SE, AG). Applied once at persistence, so search and manual imports
 * share the same cleanup.
 *
 * - startupjobs prefixes every company with German "bei " (= "at"):
 *   "bei HUM Systems GmbH"   -> "HUM Systems GmbH"
 * - careers-page wrappers:
 *   "Careers at Marriott"    -> "Marriott"
 *   "Jobs at Acme"           -> "Acme"
 * - "legal entity // brand" joins (startupjobs), keep the brand — it is the
 *   recognizable name and matches how the same company appears elsewhere:
 *   "DRTJ Organic Cosmetics GmbH // UND GRETEL" -> "UND GRETEL"
 * - "company | tagline" joins, keep the company (the tagline is a descriptor):
 *   "Pack GTM | SaaS Sales Recruitment in Germany" -> "Pack GTM"
 */
export function normalizeEmployer(value: string): string {
  const original = normalizeWhitespace(value);
  if (!original) return original;
  let s = original;
  // German recruiting preamble -> keep only the company after "bei [article]":
  // "Dein Einstieg bei der Init AG" -> "Init AG", "Karriere bei SAP SE" -> "SAP
  // SE". Anchored on a recruiting-phrase word so a real name that merely
  // contains "bei" (e.g. "Weber bei der Arbeit GmbH") is left intact.
  s = s.replace(
    /^(?:dein|deine|ihr|ihre|willkommen|karriere|einstieg|arbeiten|starte?n?|werde\s+teil(?:\s+von)?)\b.*?\bbei\s+(?:(?:der|dem|den|die|das)\s+)?/i,
    "",
  );
  // Leading "bei [article] " (startupjobs prefix), article optional.
  s = s.replace(/^bei\s+(?:(?:der|dem|den|die|das)\s+)?/i, "");
  s = s.replace(/^(?:careers?|jobs)\s+at\s+/i, "");
  const brandParts = s.split(/\s*\/\/\s*/);
  if (brandParts.length === 2 && brandParts[0].trim() && brandParts[1].trim()) {
    s = brandParts[1];
  }
  // "Company | Tagline" -> keep the company (first segment).
  const pipeParts = s.split(/\s*\|\s*/);
  if (pipeParts.length > 1 && pipeParts[0].trim()) {
    s = pipeParts[0];
  }
  return normalizeWhitespace(s) || original;
}

// ISO currency code -> display symbol.
const CURRENCY_SYMBOLS: Array<[RegExp, string]> = [
  [/\beur\b|\beuros?\b/gi, "€"],
  [/\busd\b|\bus\$/gi, "$"],
  [/\bgbp\b/gi, "£"],
  [/\bchf\b/gi, "CHF "],
  [/\bpln\b/gi, "zł"],
];

// Collapse full thousands to k-notation: "90000"/"90.000"/"90,000" -> "90k",
// "85500" -> "85.5k". Only whole hundreds (>= 1000) convert, so odd figures
// like "82750" are left intact rather than becoming an ugly "82.75k".
function thousandsToK(value: string): string {
  return value.replace(/\d{1,3}(?:[.,]\d{3})+|\d{4,}/g, (match) => {
    const n = Number(match.replace(/[.,]/g, ""));
    if (!Number.isFinite(n) || n < 1000 || n % 100 !== 0) return match;
    return `${n / 1000}k`;
  });
}

// Words allowed to sit next to the figure in a salary string. Anything else
// (equity, package, budget, competitive, industry, ...) marks the value as
// benefits prose, not a salary, and the whole thing is rejected.
const SALARY_ALLOWED_WORDS = new Set([
  "k",
  "ote",
  "gross",
  "net",
  "netto",
  "brutto",
  "per",
  "pa",
  "year",
  "yr",
  "annum",
  "annual",
  "annually",
  "month",
  "monthly",
  "mo",
  "hour",
  "hourly",
  "hr",
  "day",
  "daily",
  "a",
  "and",
  "to",
  "up",
  "from",
  "circa",
  "ca",
  "approx",
  "ab",
  "bis",
  "jahr",
  "jährlich",
  "monat",
  "monatlich",
  "stunde",
  "eur",
  "usd",
  "gbp",
  "chf",
  "pln",
]);

// A salary must be a compact compensation figure — a currency-tagged amount, a
// k-amount, or a 4+ digit number — with only qualifier words alongside it.
// Rejects prose/benefits sentences ("Industry-competitive salaries (plus
// equity package, €1,000 ... budget)") so junk never reaches the salary field.
function isSalaryLike(s: string): boolean {
  if (!/(?:[€$£zł]\s?\d|\d\s?k\b|\d{4,})/i.test(s)) return false;
  const words = s.toLowerCase().match(/[a-zäöüß.]+/g) ?? [];
  return words.every((word) => {
    const cleaned = word.replace(/\./g, "");
    return !cleaned || SALARY_ALLOWED_WORDS.has(cleaned);
  });
}

/**
 * Validate and unify a salary string so the same figure reads consistently.
 * "€80-90k OTE" -> "€80–90k OTE", "EUR 80000 - 90000" -> "€80k–90k".
 *
 * - currency codes become symbols (EUR -> €, USD -> $, GBP -> £)
 * - full thousands collapse to k-notation ("90000" / "90.000" -> "90k")
 * - thousands "k"/"K" lowercase, no space before it
 * - range separators (-, –, —, "to", "bis") become an en dash with no spaces
 * - a symbol hugs its amount ("€ 80" -> "€80")
 *
 * Qualifiers such as OTE (On-Target Earnings), gross/brutto are preserved.
 * Returns null for empty input OR anything that reads as prose/benefits rather
 * than a compensation figure — so no source can leak a sentence into salary.
 */
export function normalizeSalary(raw: string | null | undefined): string | null {
  let s = normalizeWhitespace(raw ?? "");
  if (!s) return null;
  for (const [pattern, symbol] of CURRENCY_SYMBOLS)
    s = s.replace(pattern, symbol);
  s = thousandsToK(s);
  s = s.replace(/(\d)\s*[kK]\b/g, "$1k");
  // Drop a repeated currency symbol on the upper bound ("€40k - €60k" ->
  // "€40k - 60k") so the range collapses to a single "€40k–60k". Requires a
  // number before the separator so "up to €65k" keeps its symbol.
  s = s.replace(/(\d[\d.,]*k?\s*(?:-|–|—|to|bis)\s*)[€$£]\s*(?=\d)/gi, "$1");
  s = s.replace(
    /(\d+(?:\.\d+)?k?)\s*(?:-|–|—|to|bis)\s*(\d+(?:\.\d+)?k?)/gi,
    "$1–$2",
  );
  s = s.replace(/([€$£])\s+(?=\d)/g, "$1");
  // Move a lone floating/trailing currency symbol (one not already hugging its
  // amount) to the front for a consistent "€80k–90k" shape
  // ("80k–90k € gross" -> "€80k–90k gross", "45k–55k £" -> "£45k–55k").
  const symbols = s.match(/[€$£]/g);
  if (symbols && symbols.length === 1 && /[€$£](?!\d)/.test(s)) {
    s = symbols[0] + normalizeWhitespace(s.replace(/[€$£]/, ""));
  }
  s = normalizeWhitespace(s);
  return s && isSalaryLike(s) ? s : null;
}
