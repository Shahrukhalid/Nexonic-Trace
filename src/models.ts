export type SearchMode = "quick" | "deep" | "comprehensive";
export type ResultStatus =
  | "confirmed"
  | "probable"
  | "not_found"
  | "inconclusive"
  | "blocked"
  | "unsupported"
  | "invalid_username";
export interface Finding {
  site: string;
  category: string;
  url: string;
  status: ResultStatus;
  evidence: string[];
  checkedAt: string;
  publicFields?: { label: string; value: string }[];
  requestOutcome?: string;
}
export interface SearchUpdate {
  jobId: string;
  finding: Finding;
  completed: number;
  total: number;
}
export interface SearchSummary {
  jobId: string;
  findings: Finding[];
  canceled: boolean;
  total: number;
  warnings?: string[];
}
export const statusLabels: Record<ResultStatus, string> = {
  confirmed: "Profile exists",
  probable: "Probable profile",
  not_found: "Not found",
  inconclusive: "Inconclusive",
  blocked: "Blocked",
  unsupported: "Unsupported",
  invalid_username: "Invalid username",
};
export function detectQuery(
  raw: string,
): "email" | "username" | "empty" | "invalid" {
  const query = raw.trim();
  if (!query) return "empty";
  if (query.includes("@"))
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query) ? "email" : "invalid";
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,38}$/.test(query)
    ? "username"
    : "invalid";
}
export function safeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      host.includes(".") &&
      !/^\d+(?:\.\d+){3}$/.test(host) &&
      !host.startsWith("[") &&
      ![
        "localhost",
        ".localhost",
        ".local",
        ".internal",
        ".test",
        ".invalid",
      ].some((suffix) => host.endsWith(suffix))
    );
  } catch {
    return false;
  }
}

export function csvReport(findings: Finding[], redact = false): string {
  const cell = (value: string) =>
    `"${(/^(?:\s*[=+\-@]|[\t\r\n])/.test(value) ? "'" : "") + value.replaceAll('"', '""')}"`;
  return [
    ["Website", "Status", "Source URL", "Evidence", "Checked at"],
    ...findings.map((f) => [
      redact && f.category === "Public web mention"
        ? "Public web result"
        : f.site,
      statusLabels[f.status],
      redact ? "[redacted]" : f.url,
      redact ? "[redacted]" : f.evidence.join("; "),
      f.checkedAt,
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\r\n");
}
