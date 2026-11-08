export type SearchMode = 'quick' | 'deep' | 'comprehensive';
export type ResultStatus = 'confirmed' | 'probable' | 'not_found' | 'inconclusive' | 'blocked' | 'unsupported' | 'invalid_username';
export interface Finding {
  site: string;
  category: string;
  url: string;
  status: ResultStatus;
  evidence: string[];
  checkedAt: string;
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
}
export const statusLabels: Record<ResultStatus, string> = {
  confirmed: 'Profile exists', probable: 'Probable profile', not_found: 'Not found',
  inconclusive: 'Inconclusive', blocked: 'Blocked', unsupported: 'Unsupported', invalid_username: 'Invalid username',
};
export function detectQuery(raw: string): 'email' | 'username' | 'empty' | 'invalid' {
  const query = raw.trim();
  if (!query) return 'empty';
  if (query.includes('@')) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(query) ? 'email' : 'invalid';
  return /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,38}$/.test(query) ? 'username' : 'invalid';
}
export function safeSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      ['github.com', 'dev.to'].includes(url.hostname);
  } catch { return false; }
}
export function csvReport(findings: Finding[], redact = false): string {
  const cell = (value: string) => `"${(/^[=+\-@\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`;
  return [['Website', 'Status', 'Source URL', 'Evidence', 'Checked at'], ...findings.map(f => [f.site, statusLabels[f.status], redact ? '[redacted]' : f.url, redact ? '[redacted]' : f.evidence.join('; '), f.checkedAt])].map(row => row.map(cell).join(',')).join('\r\n');
}
