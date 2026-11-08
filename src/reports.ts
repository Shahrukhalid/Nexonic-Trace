import { csvReport, safeSourceUrl, statusLabels } from "./models";
import type { Finding } from "./models";
export type ReportFormat = "json" | "csv" | "html" | "pdf";
export function reportData(
  query: string,
  findings: Finding[],
  redact: boolean,
  canceled: boolean,
  total: number,
) {
  return {
    application: "Nexonic Trace",
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    query: redact ? "[redacted]" : query,
    canceled,
    total,
    ownership:
      "Account existence does not establish identity ownership. Indexed web mentions have not been independently verified.",
    findings: findings.map((f) =>
      redact
        ? {
            ...f,
            site:
              f.category === "Public web mention"
                ? "Public web result"
                : f.site,
            url: "[redacted]",
            evidence: ["[redacted]"],
            publicFields: [],
          }
        : f,
    ),
  };
}
export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
export async function createReport(
  format: ReportFormat,
  query: string,
  findings: Finding[],
  redact: boolean,
  canceled: boolean,
  total: number,
): Promise<string | Uint8Array> {
  const data = reportData(query, findings, redact, canceled, total);
  if (format === "json") return JSON.stringify(data, null, 2);
  if (format === "csv") return csvReport(data.findings, redact);
  if (format === "html")
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Nexonic Trace report</title><style>body{font:15px/1.7 system-ui;max-width:850px;margin:40px auto;padding:0 24px;color:#222}article{border-top:1px solid #ddd;padding:20px 0}h1{font-size:28px}h2{font-size:19px}small{color:#555}li{overflow-wrap:anywhere}a{color:#4338ca}dt{font-weight:bold}dd{margin:0 0 10px;overflow-wrap:anywhere}</style></head><body><h1>Nexonic Trace</h1><p>Query: ${escapeHtml(data.query)}</p><p>${escapeHtml(data.ownership)}</p><p>${data.findings.length}/${total} results recorded${canceled ? " · Canceled, partial results" : ""} · ${escapeHtml(data.generatedAt)}</p>${data.findings.map((f) => `<article><h2>${escapeHtml(f.site)}</h2><p>${escapeHtml(statusLabels[f.status])}</p>${safeSourceUrl(f.url) ? `<a href="${escapeHtml(f.url)}" target="_blank" rel="noopener noreferrer">Original source</a>` : `<p>${escapeHtml(f.url)}</p>`}<ul>${f.evidence.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul><dl>${f.publicFields?.map((field) => `<dt>${escapeHtml(field.label)}</dt><dd>${escapeHtml(field.value)}</dd>`).join("") || ""}</dl><small>${escapeHtml(f.checkedAt)}</small></article>`).join("")}<footer>By Nexonic Technologies</footer></body></html>`;
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF();
  pdf.setProperties({
    title: "Nexonic Trace report",
    author: "Nexonic Technologies",
  });
  let y = 20;
  const hasUnicode = /[^\x00-\x7F]/.test(JSON.stringify(data));
  // Escape characters absent from the built-in PDF font instead of silently losing them.
  const ascii = (value: string) =>
    Array.from(value)
      .map((c) =>
        c.charCodeAt(0) < 127 ? c : `\\u{${c.codePointAt(0)!.toString(16)}}`,
      )
      .join("");
  function text(value: string, size = 10, link?: string) {
    pdf.setFontSize(size);
    const lines = pdf.splitTextToSize(ascii(value), 172) as string[];
    for (const line of lines) {
      if (y > 275) {
        pdf.addPage();
        y = 20;
      }
      if (link && safeSourceUrl(link))
        pdf.textWithLink(line, 19, y, { url: link });
      else pdf.text(line, 19, y);
      y += size * 0.5 + 2;
    }
  }
  text("NEXONIC TRACE", 19);
  text(`Query: ${data.query}`, 12);
  text(data.generatedAt);
  text(data.ownership);
  text(
    `${data.findings.length}/${total} results${canceled ? " (canceled, partial)" : ""}.${hasUnicode ? " Unicode is represented by explicit code-point escapes." : ""}`,
  );
  y += 5;
  for (const f of data.findings) {
    text(`${f.site} - ${statusLabels[f.status]}`, 12);
    text(f.url, 10, f.url);
    for (const evidence of f.evidence) text(evidence);
    for (const field of f.publicFields || [])
      text(`${field.label}: ${field.value}`);
    text(f.checkedAt);
    y += 6;
  }
  for (let page = 1; page <= pdf.getNumberOfPages(); page++) {
    pdf.setPage(page);
    pdf.setFontSize(8);
    pdf.setTextColor(100);
    pdf.text(
      `Nexonic Technologies | ${page} / ${pdf.getNumberOfPages()}`,
      19,
      289,
    );
  }
  return new Uint8Array(pdf.output("arraybuffer"));
}
