// Runs against our installed debug APK on a dedicated emulator, never a personal device.
import { _android, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const devices = await _android.devices();
const device = devices.find(
  (d) => d.serial() === (process.env.ANDROID_SERIAL || "emulator-5554"),
);
if (!device) throw new Error("Dedicated Android test emulator not found.");
let page;
try {
  const avd = (await device.shell("getprop ro.boot.qemu.avd_name"))
    .toString()
    .trim();
  if (avd !== "NexonicTraceTest")
    throw new Error("Refusing to modify a non-test Android device.");
  const webview = await device.webView(
    { pkg: "com.nexonic.trace" },
    { timeout: 120_000 },
  );
  page = await webview.page();
  await expect(
    page.getByRole("heading", { name: "Discover your digital footprint." }),
  ).toBeVisible();
  const prefs = await page.evaluate(() =>
    window.__TAURI_INTERNALS__.invoke("get_preferences"),
  );
  if (prefs.historyEnabled)
    throw new Error("A fresh test install must not enable history.");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Save searches on this device", { exact: true })
    .check();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__TAURI_INTERNALS__
          .invoke("get_preferences")
          .then((p) => p.historyEnabled),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Username or email address").fill("thibault");
  await page.getByText("Comprehensive", { exact: true }).click();
  await page
    .getByRole("button", { name: "Start discovery", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel search", exact: true })
    .click();
  await expect(page.locator(".results-heading")).toContainText("Canceled");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__TAURI_INTERNALS__
          .invoke("list_scans")
          .then((scans) =>
            scans.some(
              (scan) => scan.summary.canceled && scan.query === "thibault",
            ),
          ),
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "Security", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Check password", exact: true }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Email breaches" }).click();
  await page
    .getByLabel("Email address", { exact: true })
    .fill("fixture@example.org");
  await page
    .getByLabel("I own this address or have permission to check it.")
    .check();
  await page.getByRole("button", { name: "Check email breaches" }).click();
  await expect(page.getByRole("status")).toContainText(
    "No licensed breach provider",
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Delete all data" }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__TAURI_INTERNALS__
          .invoke("get_preferences")
          .then((p) => p.historyEnabled),
      ),
    )
    .toBe(false);
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/android-native.json",
    JSON.stringify({
      passed: true,
      device: device.serial(),
      testedAbi: (await device.shell("getprop ro.product.cpu.abi"))
        .toString()
        .trim(),
      checks: [
        "real Rust IPC",
        "history opt-in",
        "native cancellation",
        "saved real scan",
        "missing credentials",
        "deletion",
      ],
    }),
  );
  console.log(
    "Android native WebView, real Rust IPC, opt-in persistence, missing-provider limitation, and deletion checks passed.",
  );
} catch (error) {
  if (page) {
    await mkdir("test-results", { recursive: true });
    await page
      .screenshot({ path: "test-results/android-failure.png" })
      .catch(() => {});
    console.error(
      "Native UI status:",
      await page
        .getByRole("status")
        .allTextContents()
        .catch(() => []),
    );
  }
  throw error;
} finally {
  await device.close();
}
