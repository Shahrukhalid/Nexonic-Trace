import { Channel, invoke, isTauri } from '@tauri-apps/api/core';
import type { SearchMode, SearchSummary, SearchUpdate } from './models';

export const isNative = () => isTauri();
export async function search(jobId: string, query: string, mode: SearchMode, timeoutSeconds: number, onUpdate: (update: SearchUpdate) => void): Promise<SearchSummary> {
  if (!isNative()) throw new Error('Live discovery runs in the installed app. Open the desktop application to search public sources.');
  const channel = new Channel<SearchUpdate>();
  channel.onmessage = onUpdate;
  return invoke<SearchSummary>('start_search', { jobId, query, mode, timeoutSeconds, onUpdate: channel });
}
export async function cancelSearch(jobId: string): Promise<void> {
  await invoke('cancel_search', { jobId });
}
export async function openSource(url: string): Promise<void> {
  await invoke('open_source', { url });
}
export async function saveReport(format: 'json' | 'csv', content: string): Promise<boolean> {
  return invoke<boolean>('save_report', { format, content });
}
