(async () => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  async function waitFor(test) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (await test()) return;
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
    throw new Error("Native workspace did not reach the expected state.");
  }
  const button = (name) =>
    [...document.querySelectorAll("button")].find(
      (node) => node.textContent.trim() === name,
    );
  try {
    await waitFor(
      () =>
        document.querySelector("h1")?.textContent ===
        "Discover your digital footprint.",
    );
    if (document.documentElement.scrollWidth > innerWidth)
      throw new Error("Native workspace overflows the viewport.");
    const stage = await invoke("smoke_stage");
    button("Settings").click();
    await waitFor(
      () => document.querySelector("h1")?.textContent === "Settings",
    );
    await waitFor(
      () =>
        !document.querySelector(
          'input[aria-label="Save searches on this device"]',
        ).disabled,
    );
    if (stage === "write") {
      button("Light").click();
      const history = document.querySelector(
        'input[aria-label="Save searches on this device"]',
      );
      if (!history.checked) history.click();
      await waitFor(async () => {
        const prefs = await invoke("get_preferences");
        return prefs.historyEnabled && prefs.appearance === "light";
      });
    } else {
      const persisted = await invoke("get_preferences");
      if (!persisted.historyEnabled || persisted.appearance !== "light")
        throw new Error("Preferences did not survive application restart.");
      button("Security").click();
      await waitFor(() => button("Check password"));
      button("Settings").click();
      await waitFor(() => button("Delete all data"));
      button("Delete all data").click();
      await waitFor(
        async () => !(await invoke("get_preferences")).historyEnabled,
      );
      if ((await invoke("list_scans")).length)
        throw new Error("Local history was not deleted.");
      const providers = await invoke("provider_status");
      if (providers.some(Boolean))
        throw new Error("Provider keys were not cleared.");
    }
    await invoke("smoke_finished", {
      passed: true,
      details:
        "Native rendering, navigation, actual Rust IPC, preference persistence, and deletion passed.",
    });
  } catch (error) {
    await invoke("smoke_finished", { passed: false, details: String(error) });
  }
})();
