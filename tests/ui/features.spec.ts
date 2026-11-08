import { expect, test } from "@playwright/test";

// Deterministic IPC fixtures for interface tests only. No fixture path is shipped
// in application code; actual provider behavior is tested separately in Rust.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let preferences = {
      appearance: "dark",
      historyEnabled: new URLSearchParams(location.search).has(
        "delete-during-startup",
      ),
      timeoutSeconds: 12,
    };
    let scans: unknown[] = [];
    const fixture = {
      site: "GitHub",
      category: "Developer community",
      url: "https://github.com/fixture",
      status: "confirmed",
      evidence: ["Structured profile matches the fixture query."],
      checkedAt: "2026-11-08T00:00:00Z",
      publicFields: [{ label: "Public name", value: "Fixture name" }],
      requestOutcome: "completed",
    };
    let id = 0;
    let preferenceReads = 0;
    const fixtureCase = new URLSearchParams(location.search);
    const internals = {
      transformCallback: () => ++id,
      unregisterCallback: () => {},
      invoke: async (command: string, args: Record<string, unknown> = {}) => {
        if (command === "get_preferences") {
          preferenceReads++;
          if (
            fixtureCase.has("delete-during-startup") &&
            preferenceReads === 1
          ) {
            const snapshot = { ...preferences };
            return new Promise((resolve) =>
              window.setTimeout(() => resolve(snapshot), 1000),
            );
          }
          if (fixtureCase.has("lost-settings-replies") && preferenceReads <= 2)
            return new Promise(() => {});
          if (fixtureCase.has("settings-read-failure") && preferenceReads <= 3)
            throw "Local database is temporarily unavailable.";
          return preferences;
        }
        if (command === "set_preferences") {
          preferences = args.preferences as typeof preferences;
          return;
        }
        if (command === "provider_status") return [false, false, false];
        if (command === "start_search") {
          const summary = {
            jobId: args.jobId,
            findings: [fixture],
            total: 2,
            canceled: false,
          };
          if (preferences.historyEnabled)
            scans = [
              {
                id: args.jobId,
                query: args.query,
                mode: args.mode,
                createdAt: "2026-11-08T00:00:00Z",
                summary,
              },
            ];
          return summary;
        }
        if (command === "list_scans" || command === "recent_scans")
          return scans;
        if (command === "delete_scan" || command === "clear_history") {
          scans = [];
          return;
        }
        if (command === "password_check")
          return {
            occurrences: 42,
            provider: "Pwned Passwords",
            checkedAt: "2026-11-08T00:00:00Z",
          };
        if (command === "breach_check")
          throw "No licensed breach provider is connected.";
        if (command === "public_web_search") throw "No provider is connected.";
        if (command === "stealer_log_check")
          throw "Stealer logs require a Have I Been Pwned Pro plan and provider-verified control of this email domain.";
        if (command === "dark_web_search") {
          if (!args.authorized) throw "Permission is required.";
          if (!fixtureCase.has("darkowl-metadata"))
            throw "No licensed dark-web provider is connected.";
          return {
            jobId: args.jobId,
            total: 1,
            canceled: false,
            findings: [
              {
                ...fixture,
                site: "DarkOwl · abcdef1234567890",
                url: "",
                status: "inconclusive",
                category: "Dark-web index mention",
                evidence: [
                  "Matching indexed record; no document content or passwords were requested.",
                ],
                publicFields: [
                  { label: "Provider record ID", value: "abcdef1234567890" },
                  { label: "Network", value: "Tor" },
                ],
              },
            ],
          };
        }
        if (command === "delete_all_data") {
          scans = [];
          preferences = {
            appearance: "dark",
            historyEnabled: false,
            timeoutSeconds: 12,
          };
          return;
        }
        return null;
      },
    };
    Object.defineProperty(window, "isTauri", {
      value: true,
      configurable: true,
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: internals,
      configurable: true,
    });
  });
});

test("password input is cleared immediately and prevalence is shown", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Security", exact: true }).click();
  const password = page.getByLabel("Password", { exact: true });
  await password.fill("public-test-value");
  await page
    .getByRole("button", { name: "Check password", exact: true })
    .click();
  await expect(password).toHaveValue("");
  await expect(page.getByRole("status")).toContainText("Seen 42 times");
});
test("missing breach credentials explain the limitation without fabricated records", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Security", exact: true }).click();
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
  await expect(page.locator(".breach")).toHaveCount(0);
});
test("opt-in history saves a scan, reopens it, and deletes it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Save searches on this device", { exact: true })
    .check();
  await page.getByRole("button", { name: "Search", exact: true }).click();
  await page.getByLabel("Username or email address").fill("fixture");
  await page.getByRole("button", { name: "Start discovery" }).click();
  await expect(
    page.getByRole("link", { name: "Open GitHub source" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /fixture.*1 results/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete scan fixture" }).click();
  await expect(
    page.getByRole("heading", { name: "No saved searches" }),
  ).toBeVisible();
});

test("local settings recover when startup replies are lost", async ({
  page,
}) => {
  await page.goto("/?lost-settings-replies=1");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const history = page.getByLabel("Save searches on this device", {
    exact: true,
  });
  await expect(history).toBeEnabled({ timeout: 10000 });
  await expect(history).not.toBeChecked();
  await history.check();
  await expect(history).toBeChecked();
});

test("failed settings reads stay disabled and can be retried", async ({
  page,
}) => {
  await page.goto("/?settings-read-failure=1");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const history = page.getByLabel("Save searches on this device", {
    exact: true,
  });
  await expect(
    page.getByRole("button", { name: "Reload local settings" }),
  ).toBeVisible();
  await expect(history).toBeDisabled();
  await page.getByRole("button", { name: "Reload local settings" }).click();
  await expect(history).toBeEnabled();
  await expect(history).not.toBeChecked();
});

test("deletion cannot be undone by a late startup settings reply", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/?delete-during-startup=1");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete all data", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("have been cleared");
  await page.clock.fastForward(2000);
  const history = page.getByLabel("Save searches on this device", {
    exact: true,
  });
  await expect(history).toBeEnabled();
  await expect(history).not.toBeChecked();
});

test("web discovery is visible and offers broader paginated depths", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Web", exact: true }).check();
  await page.getByRole("radio", { name: "Comprehensive", exact: true }).check();
  await expect(
    page.getByText("100 indexed results max", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Username or email address").fill("fixture");
  await page.getByRole("button", { name: "Start discovery" }).click();
  await expect(page.getByRole("status")).toContainText(
    "No provider is connected",
  );
  await expect(page.locator(".finding")).toHaveCount(0);
});
test("dark-web search requires fresh authorization and explains missing credentials", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("radio", { name: "Dark web", exact: true }).check();
  await page.getByLabel("Username or email address").fill("fixture");
  const start = page.getByRole("button", { name: "Start discovery" });
  await expect(start).toBeDisabled();
  await page
    .getByLabel(
      "This username or email is mine, or I have permission to check it.",
    )
    .check();
  await start.click();
  await expect(page.getByRole("status")).toContainText(
    "No licensed dark-web provider",
  );
  await page.getByLabel("Username or email address").fill("different-fixture");
  await expect(start).toBeDisabled();
  await expect(page.locator(".finding")).toHaveCount(0);
});
test("dark-web metadata stays unverified and exposes no direct leak links", async ({
  page,
}) => {
  await page.goto("/?darkowl-metadata=1");
  await page.getByRole("radio", { name: "Dark web", exact: true }).check();
  await page.getByLabel("Username or email address").fill("fixture");
  await page
    .getByLabel(
      "This username or email is mine, or I have permission to check it.",
    )
    .check();
  await page.getByRole("button", { name: "Start discovery" }).click();
  const finding = page.locator(".finding");
  await expect(finding).toContainText("Inconclusive");
  await expect(finding.getByRole("link")).toHaveCount(0);
  await finding.locator("summary").click();
  await expect(finding).toContainText("Provider record ID");
  await expect(finding).toContainText("Tor");
  await page.getByRole("button", { name: "Export", exact: true }).click();
  await expect(page.getByRole("checkbox")).toBeChecked();
});
test("stealer logs explain domain verification and plan requirements", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Security", exact: true }).click();
  await page.getByRole("tab", { name: "Email breaches" }).click();
  await page.getByLabel("Exposure source").selectOption("stealers");
  await page
    .getByLabel("Email address", { exact: true })
    .fill("fixture@example.org");
  await page
    .getByLabel("I own this address or have permission to check it.")
    .check();
  await page.getByRole("button", { name: "Check stealer logs" }).click();
  await expect(page.getByRole("status")).toContainText(
    "provider-verified control",
  );
  await expect(page.locator(".check-result")).toHaveCount(0);
});

test("dark-web keys are cleared from inputs after session connection", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Provider", { exact: true }).selectOption("darkowl");
  const publicKey = page.getByLabel("Public key", { exact: true });
  const privateKey = page.getByLabel("Private key", { exact: true });
  await publicKey.fill("fixture-public-key");
  await privateKey.fill("fixture-private-key");
  await page
    .getByLabel(
      "I authorize requests under my provider plan and accept applicable provider charges.",
    )
    .check();
  await page.getByRole("button", { name: "Save session connection" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Provider connected for this session",
  );
  await expect(publicKey).toHaveValue("");
  await expect(privateKey).toHaveValue("");
});
