import { describe, expect, it } from "vitest";
import { createReport, reportData } from "../src/reports";
import type { Finding } from "../src/models";
const finding: Finding = {
  site: "<script>alert(1)</script>",
  category: "Public web mention",
  url: "https://example.org/person",
  status: "inconclusive",
  evidence: ["<img src=x onerror=alert(1)>"],
  checkedAt: "2026-11-08T00:00:00Z",
  publicFields: [{ label: "Public name", value: "Private label" }],
};
describe("evidence-backed exports", () => {
  it("escapes untrusted strings in HTML and embeds no external resources", async () => {
    const html = (await createReport(
      "html",
      "person",
      [finding],
      false,
      false,
      1,
    )) as string;
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("default-src");
    expect(html).not.toContain("<img src=x");
  });
  it("redacts query, profile URLs, evidence and public fields consistently", () => {
    const report = JSON.stringify(
      reportData("person", [finding], true, false, 1),
    );
    expect(report).not.toContain("example.org/person");
    expect(report).not.toContain("Private label");
    expect(report).not.toContain("<img");
    expect(report).not.toContain("<script>");
    expect(report).toContain("[redacted]");
  });
  it("generates actual PDF bytes", async () => {
    const bytes = (await createReport(
      "pdf",
      "person",
      [finding],
      true,
      false,
      1,
    )) as Uint8Array;
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(bytes.length).toBeGreaterThan(1000);
  });
  it("retains original timestamps and cancellation state", async () => {
    const report = JSON.parse(
      (await createReport(
        "json",
        "person",
        [finding],
        false,
        true,
        5,
      )) as string,
    );
    expect(report.canceled).toBe(true);
    expect(report.total).toBe(5);
    expect(report.findings[0].checkedAt).toBe(finding.checkedAt);
  });
});
