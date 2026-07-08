/**
 * Cosmetic text-style transforms applied to rendered resume/cover-letter prose.
 *
 * Deterministic, no LLM. Runs at render time so it also catches LLM-generated
 * text (tailored summaries, cover-letter bodies) that a hand-authored master
 * can't control.
 */

/**
 * Swaps round parentheses for square brackets as a stylistic device, matching
 * the user's hand-typed convention (e.g. "HWR Berlin [Hochschule …]").
 *
 * Safe on both plain text and HTML: the regex matches a whole `<…>` tag OR a
 * single parenthesis, so tag interiors (and any URLs / attributes inside them)
 * pass through untouched — only parentheses in visible text are swapped.
 * Idempotent, since square brackets are never rewritten.
 */
export function bracketizeText(value: string): string {
  return value.replace(/<[^>]+>|[()]/g, (match) =>
    match.length > 1 ? match : match === "(" ? "[" : "]",
  );
}
