import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { SearchMode, SearchSummary, SearchUpdate } from "./models";

export const isNative = () => isTauri();
export async function search(
  jobId: string,
  query: string,
  mode: SearchMode,
  timeoutSeconds: number,
  onUpdate: (update: SearchUpdate) => void,
): Promise<SearchSummary> {
  if (!isNative())
    throw new Error(
      "Live discovery runs in the installed app. Open the desktop application to search public sources.",
    );
  const channel = new Channel<SearchUpdate>();
  channel.onmessage = onUpdate;
  return invoke<SearchSummary>("start_search", {
    jobId,
    query,
    mode,
    timeoutSeconds,
    onUpdate: channel,
  });
}
export async function cancelSearch(jobId: string): Promise<void> {
  await invoke("cancel_search", { jobId });
}
export async function openSource(url: string): Promise<void> {
  await invoke("open_source", { url });
}
export async function saveReport(
  format: "json" | "csv" | "html" | "pdf",
  content: string | Uint8Array,
): Promise<boolean> {
  if (!isNative()) throw new Error("Open the installed app to save reports.");
  const { save } = await import("@tauri-apps/plugin-dialog");
  const { open } = await import("@tauri-apps/plugin-fs");
  const path = await save({
    title: "Save Nexonic Trace report",
    defaultPath: `NexonicTrace-Report.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  });
  if (!path) return false;
  const bytes =
    typeof content === "string" ? new TextEncoder().encode(content) : content;
  const file = await open(path, { write: true, create: true, truncate: true });
  try {
    let offset = 0;
    while (offset < bytes.length) {
      const written = await file.write(bytes.subarray(offset));
      if (written <= 0)
        throw new Error("The report could not be completely written.");
      offset += written;
    }
  } finally {
    await file.close();
  }
  return true;
}
