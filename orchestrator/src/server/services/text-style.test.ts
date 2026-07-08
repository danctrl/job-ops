import { describe, expect, it } from "vitest";
import { bracketizeText } from "./text-style";

describe("bracketizeText", () => {
  it("swaps round parentheses for square brackets", () => {
    expect(bracketizeText("Infrastructure as Code (IaC)")).toBe(
      "Infrastructure as Code [IaC]",
    );
  });

  it("leaves existing square brackets untouched (idempotent)", () => {
    const already = "HWR Berlin [Hochschule für Wirtschaft und Recht]";
    expect(bracketizeText(already)).toBe(already);
    expect(bracketizeText(bracketizeText("a (b)"))).toBe("a [b]");
  });

  it("swaps parens in visible text but not inside HTML tags/attributes", () => {
    const html =
      '<ul><li>Built pipelines (CI/CD) — see <a href="https://x.test/wiki/Foo_(bar)">docs</a></li></ul>';
    expect(bracketizeText(html)).toBe(
      '<ul><li>Built pipelines [CI/CD] — see <a href="https://x.test/wiki/Foo_(bar)">docs</a></li></ul>',
    );
  });

  it("handles multiple parens and is a no-op without any", () => {
    expect(bracketizeText("(a) and (b)")).toBe("[a] and [b]");
    expect(bracketizeText("no parens here")).toBe("no parens here");
    expect(bracketizeText("")).toBe("");
  });
});
