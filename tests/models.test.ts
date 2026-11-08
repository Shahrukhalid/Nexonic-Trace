import { describe, expect, it } from "vitest";
import { csvReport, detectQuery, safeSourceUrl } from "../src/models";
import type { Finding } from "../src/models";

describe("query boundaries", () => {
  it("distinguishes usernames, email addresses, and empty input", () => {
    expect(detectQuery(" octocat ")).toBe("username");
    expect(detectQuery("me@example.com")).toBe("email");
    expect(detectQuery("")).toBe("empty");
    expect(detectQuery("wrong@")).toBe("invalid");
  });
  it("rejects URLs, path fragments, and oversized usernames", () => {
    for (const input of [
      "../admin",
      "https://example.com",
      "a".repeat(40),
      "a b",
    ])
      expect(detectQuery(input)).toBe("invalid");
  });
});
describe("report safety", () => {
  const finding: Finding = {
    site: "=EXTERNAL()",
    category: "Developer",
    url: "https://github.com/octocat",
    status: "confirmed",
    evidence: ['A "quoted" field'],
    checkedAt: "2026-11-08T00:00:00Z",
  };
  it("quotes CSV cells and protects against spreadsheet formulas", () => {
    const csv = csvReport([finding]);
    expect(csv).toContain('"\'=EXTERNAL()"');
    expect(csv).toContain('A ""quoted"" field');
  });
  it("redacts source URLs and evidence", () => {
    const csv = csvReport([finding], true);
    expect(csv).not.toContain("octocat");
    expect(csv).not.toContain("quoted");
    expect(csv).toContain("[redacted]");
  });
  it("only allows HTTPS source hosts", () => {
    expect(safeSourceUrl("https://github.com/octocat")).toBe(true);
    for (const url of [
      "javascript:alert(1)",
      "http://github.com/user",
      "https://github.com.evil.test/user",
      "https://user:pass@github.com/user",
      "https://127.0.0.1/user",
    ])
      expect(safeSourceUrl(url)).toBe(false);
  });
});
