import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { isNative } from "./bridge";
import { version as configuredVersion } from "../src-tauri/tauri.conf.json";

export function useUpdates() {
  const [installed, setInstalled] = useState(configuredVersion);
  const [available, setAvailable] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const checked = useRef(false);
  const inFlight = useRef(false);

  const check = useCallback(async (manual: boolean) => {
    if (inFlight.current || !isNative()) return;
    inFlight.current = true;
    checked.current = true;
    setChecking(true);
    setMessage("");
    try {
      const { availableVersion } = await invoke<{
        availableVersion: string | null;
      }>("check_for_updates");
      setAvailable(availableVersion);
      if (manual && !availableVersion) setMessage("No newer version found.");
    } catch {
      if (manual) setMessage("Could not check for updates. Please try again.");
    } finally {
      inFlight.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (!isNative()) return;
    let active = true;
    void invoke<string>("app_version").then(
      (version) => {
        if (active) setInstalled(version);
      },
      () => {},
    );
    const timer = window.setTimeout(() => {
      if (!checked.current) void check(false);
    }, 4000);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [check]);

  async function openRelease() {
    if (!available) return;
    try {
      await invoke("open_update_release", { version: available });
    } catch {
      setMessage("Could not open the GitHub release page.");
    }
  }

  return {
    installed,
    available,
    message,
    checking,
    showNotice: Boolean(available) && !dismissed,
    dismiss: () => setDismissed(true),
    check,
    openRelease,
  };
}
