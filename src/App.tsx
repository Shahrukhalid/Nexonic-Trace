import { useEffect, useRef, useState } from "react";
import registry from "../crates/trace-core/rules/sites.json";
import {
  Search,
  Shield,
  History,
  Download,
  Settings2,
  Sun,
  Moon,
  ArrowUpRight,
  X,
  Check,
  LoaderCircle,
  Fingerprint,
  Trash2,
} from "lucide-react";
import {
  cancelSearch,
  isNative,
  openSource,
  saveReport,
  search,
} from "./bridge";
import { detectQuery, safeSourceUrl, statusLabels } from "./models";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  SecurityPanel,
  HistoryPanel,
  ProviderSettings,
  ExportPanel,
  RecentScans,
} from "./features";
import type { Preferences, SavedScan } from "./features";
import { loadLocalSettings } from "./settings";
import { createReport } from "./reports";
import type { ReportFormat } from "./reports";
import type { Finding, SearchMode, SearchSummary } from "./models";

type SearchArea = "profiles" | "web" | "dark";
const indexLimit = (mode: SearchMode) =>
  mode === "quick" ? 20 : mode === "deep" ? 60 : 100;
type Page = "search" | "exposure" | "history" | "reports" | "settings";
const pages = [
  { id: "search", label: "Search", icon: Search },
  { id: "exposure", label: "Security", icon: Shield },
  { id: "history", label: "History", icon: History },
  { id: "reports", label: "Export", icon: Download },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;
// The bundled connector registry is the single source of truth for profile sources.
const sources = [...registry.sites]
  .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id))
  .map((site) => site.name);
const sourceCount = (mode: SearchMode) =>
  mode === "quick"
    ? Math.min(10, sources.length)
    : mode === "deep"
      ? Math.min(20, sources.length)
      : sources.length;
const SHOWN_SOURCES = 12;
const errorText = (error: unknown) =>
  typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "Something went wrong. Please try again.";

export default function App() {
  const [page, setPage] = useState<Page>("search");
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      return localStorage.getItem("nexonic.theme") === "light"
        ? "light"
        : "dark";
    } catch {
      return "dark";
    }
  });
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("quick");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [canceled, setCanceled] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [notice, setNotice] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("website");
  const [timeout, setTimeout] = useState(12);
  const [redact, setRedact] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [help, setHelp] = useState(false);
  const [historyEnabled, setHistoryEnabled] = useState(false);
  const [prefsReady, setPrefsReady] = useState(!isNative());
  const [prefsFailed, setPrefsFailed] = useState(false);
  const [prefsAttempt, setPrefsAttempt] = useState(0);
  const [area, setArea] = useState<SearchArea>("profiles");
  const [authorized, setAuthorized] = useState(false);
  const [activeArea, setActiveArea] = useState<SearchArea>("profiles");
  const activeWeb = activeArea !== "profiles";
  const [resetEpoch, setResetEpoch] = useState(0);
  const job = useRef<string | null>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const prefsRead = useRef<AbortController | null>(null);
  const [total, setTotal] = useState(2);
  const kind = detectQuery(query);
  const effectiveArea = area === "profiles" && kind === "email" ? "web" : area;
  const confirmed = findings.filter((f) => f.status === "confirmed").length;
  const outcomes = findings.reduce(
    (counts, finding) => {
      const outcome = finding.requestOutcome || "completed";
      if (outcome === "failed") counts.failed++;
      else if (outcome === "blocked") counts.blocked++;
      else if (outcome === "skipped") counts.skipped++;
      else counts.completed++;
      return counts;
    },
    {
      completed: 0,
      failed: 0,
      blocked: 0,
      skipped: completed && canceled ? total - findings.length : 0,
    },
  );
  const filtered = findings
    .filter((f) => filter === "all" || f.status === filter)
    .sort((a, b) =>
      sort === "status"
        ? a.status.localeCompare(b.status)
        : a.site.localeCompare(b.site),
    );
  useEffect(() => {
    if (!isNative()) return;
    let active = true;
    const controller = new AbortController();
    prefsRead.current = controller;
    setPrefsFailed(false);
    void loadLocalSettings(
      () => invoke<Preferences>("get_preferences"),
      controller.signal,
    )
      .then((prefs) => {
        if (active && !controller.signal.aborted) {
          setTheme(prefs.appearance);
          setTimeout(prefs.timeoutSeconds);
          setHistoryEnabled(prefs.historyEnabled);
          setPrefsReady(true);
        }
      })
      .catch((error) => {
        if (active && !controller.signal.aborted) {
          setPrefsFailed(true);
          setNotice(errorText(error));
        }
      });
    return () => {
      active = false;
      controller.abort();
      if (prefsRead.current === controller) prefsRead.current = null;
    };
  }, [prefsAttempt]);
  useEffect(() => {
    if (
      isNative() &&
      prefsReady &&
      document.querySelector("h1")?.textContent ===
        "Discover your digital footprint."
    ) {
      // Local readiness signal; no network, query, password or key data.
      void emit("nexonic-startup-ready").catch(() => {});
    }
  }, [prefsReady]);
  useEffect(() => {
    if (isNative() && prefsReady)
      void invoke("set_preferences", {
        preferences: {
          appearance: theme,
          timeoutSeconds: timeout,
          historyEnabled,
        },
      }).catch((error) => setNotice(errorText(error)));
  }, [theme, timeout, historyEnabled, prefsReady]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      if (!isNative()) localStorage.setItem("nexonic.theme", theme);
    } catch {
      /* Session theme still works. */
    }
  }, [theme]);
  useEffect(() => {
    if (help) dialog.current?.showModal();
    else dialog.current?.close();
  }, [help]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setPage("search");
        window.setTimeout(() => queryInput.current?.focus(), 0);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);
  async function start(event: React.FormEvent) {
    event.preventDefault();
    if (job.current) return;
    if (kind === "empty" || kind === "invalid") {
      setNotice("Enter a valid username or email address.");
      return;
    }
    if (effectiveArea === "dark" && !authorized) {
      setNotice("Confirm permission to check this username or email.");
      return;
    }
    if (!isNative()) {
      setNotice(
        kind === "email"
          ? "No provider is connected in this preview. Open the installed app to configure public email discovery."
          : "This is the interface preview; no search requests were made. Open the installed app for live discovery.",
      );
      return;
    }
    const id = crypto.randomUUID();
    job.current = id;
    setRunning(true);
    setCompleted(false);
    setCanceled(false);
    setCanceling(false);
    setFindings([]);
    setFilter("all");
    setNotice("");
    setActiveQuery(query.trim());
    const useWeb = effectiveArea !== "profiles";
    setActiveArea(effectiveArea);
    if (effectiveArea === "dark") setRedact(true);
    setTotal(useWeb ? 0 : sourceCount(mode));
    try {
      const result = useWeb
        ? await invoke<SearchSummary>(
            effectiveArea === "dark" ? "dark_web_search" : "public_web_search",
            {
              jobId: id,
              query: query.trim(),
              mode,
              authorized,
            },
          )
        : await search(id, query.trim(), mode, timeout, (update) => {
            if (job.current === update.jobId) {
              setTotal(update.total);
              setFindings((previous) => [
                ...previous.filter((f) => f.site !== update.finding.site),
                update.finding,
              ]);
            }
          });
      setFindings(result.findings);
      setTotal(result.total);
      setCanceled(result.canceled);
      setCompleted(true);
      if (result.warnings?.length) setNotice(result.warnings.join(" "));
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      job.current = null;
      setRunning(false);
      setCanceling(false);
    }
  }
  async function cancel() {
    if (!job.current) return;
    setCanceling(true);
    try {
      await cancelSearch(job.current);
    } catch (error) {
      setNotice(errorText(error));
      setCanceling(false);
    }
  }
  async function exportReport(format: ReportFormat) {
    setExporting(true);
    try {
      const content = await createReport(
        format,
        activeQuery,
        findings,
        redact,
        canceled,
        total,
      );
      if (await saveReport(format, content)) setNotice("Report saved.");
    } catch (error) {
      setNotice(errorText(error));
    } finally {
      setExporting(false);
    }
  }
  function loadScan(scan: SavedScan) {
    setFindings(scan.summary.findings);
    setActiveQuery(scan.query);
    setQuery(scan.query);
    setTotal(scan.summary.total);
    setCanceled(scan.summary.canceled);
    setCompleted(true);
    setFilter("all");
    const savedArea = scan.mode.startsWith("dark_web")
      ? "dark"
      : scan.mode.startsWith("public_web")
        ? "web"
        : "profiles";
    setActiveArea(savedArea);
    setArea(savedArea);
    setAuthorized(false);
    if (savedArea === "dark") setRedact(true);
    setPage("search");
  }
  async function deleteAll() {
    try {
      if (isNative()) await invoke("delete_all_data");
      prefsRead.current?.abort();
      setPrefsFailed(false);
      setPrefsReady(true);
      setFindings([]);
      setQuery("");
      setActiveQuery("");
      setCompleted(false);
      setTheme("dark");
      setHistoryEnabled(false);
      setTimeout(12);
      setArea("profiles");
      setAuthorized(false);
      setResetEpoch((old) => old + 1);
      try {
        localStorage.removeItem("nexonic.theme");
      } catch {
        /* No saved browser preference. */
      }
      setNotice(
        "Search history, session results, provider keys, and appearance have been cleared.",
      );
    } catch (error) {
      setNotice(errorText(error));
    }
  }

  return (
    <div className="workspace">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <a
          href="#"
          className="brand"
          onClick={(e) => {
            e.preventDefault();
            setPage("search");
          }}
        >
          <img src="/mark.svg" width="34" height="34" alt="" />
          <span>
            Nexonic <b>Trace</b>
          </span>
        </a>
        <nav aria-label="Main navigation">
          {pages.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              aria-current={page === id ? "page" : undefined}
              onClick={() => {
                setPage(id);
                setNotice("");
              }}
            >
              <Icon size={19} />
              <span>{label}</span>
            </button>
          ))}
        </nav>
        <small className="publisher">Nexonic Technologies</small>
      </aside>
      <div className="content">
        <header>
          <span>{pages.find((p) => p.id === page)?.label}</span>
          <div>
            <span className="runtime">
              {isNative() ? "Local workspace" : "Interface preview"}
            </span>
            <button
              className="icon-button"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            </button>
            <button
              className="icon-button"
              aria-label="About Nexonic Trace"
              onClick={() => setHelp(true)}
            >
              <Fingerprint size={19} />
            </button>
          </div>
        </header>
        <main id="main">
          {notice && (
            <div className="notice" role="status">
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notice"
                onClick={() => setNotice("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {page === "search" && (
            <>
              <div className="intro">
                <span className="eyebrow">YOUR PUBLIC PRESENCE</span>
                <h1>Discover your digital footprint.</h1>
                <p>Search profiles, the web and exposure indexes.</p>
              </div>
              <form className="search-box" onSubmit={start}>
                <div
                  className="search-scope segments"
                  role="radiogroup"
                  aria-label="Search area"
                >
                  {(
                    [
                      { id: "profiles", label: "Profiles" },
                      { id: "web", label: "Web" },
                      { id: "dark", label: "Dark web" },
                    ] as const
                  ).map((item) => (
                    <label
                      key={item.id}
                      className={effectiveArea === item.id ? "selected" : ""}
                    >
                      <input
                        type="radio"
                        name="area"
                        value={item.id}
                        checked={effectiveArea === item.id}
                        disabled={
                          running ||
                          (item.id === "profiles" && kind === "email")
                        }
                        onChange={() => {
                          setArea(item.id);
                          setAuthorized(false);
                          setNotice("");
                        }}
                      />
                      {item.label}
                    </label>
                  ))}
                </div>
                <div className="query-row">
                  <Search size={22} />
                  <label className="sr-only" htmlFor="query">
                    Username or email address
                  </label>
                  <input
                    ref={queryInput}
                    id="query"
                    placeholder="Username or email address"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setAuthorized(false);
                    }}
                    disabled={running}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={254}
                  />
                  <button
                    className="primary-button"
                    disabled={
                      running ||
                      !query.trim() ||
                      (effectiveArea === "dark" && !authorized)
                    }
                  >
                    {running ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : (
                      <Search size={17} />
                    )}
                    <span>{running ? "Searching" : "Start discovery"}</span>
                  </button>
                </div>
                <div className="search-options">
                  <div
                    className="segments"
                    role="radiogroup"
                    aria-label="Search depth"
                  >
                    {(
                      [
                        { id: "quick", label: "Quick" },
                        { id: "deep", label: "Deep" },
                        { id: "comprehensive", label: "Comprehensive" },
                      ] as const
                    ).map((item) => (
                      <label
                        key={item.id}
                        className={mode === item.id ? "selected" : ""}
                      >
                        <input
                          type="radio"
                          name="mode"
                          value={item.id}
                          checked={mode === item.id}
                          onChange={() => setMode(item.id)}
                          disabled={running}
                        />
                        {item.label}
                      </label>
                    ))}
                  </div>
                  <span className="source-count">
                    {effectiveArea !== "profiles"
                      ? `${indexLimit(mode)} indexed results max`
                      : `${sourceCount(mode)} sources`}
                  </span>
                </div>
                {effectiveArea === "dark" && (
                  <label className="checkbox-label search-authorization">
                    <input
                      type="checkbox"
                      checked={authorized}
                      disabled={running}
                      onChange={(e) => setAuthorized(e.target.checked)}
                    />
                    This username or email is mine, or I have permission to
                    check it.
                  </label>
                )}
              </form>
              {running && (
                <div className="live-status">
                  <div>
                    <LoaderCircle size={16} className="spin" />
                    <span>
                      {activeWeb
                        ? activeArea === "dark"
                          ? "Searching the licensed dark-web index…"
                          : "Searching the public index…"
                        : `Checking ${findings.length} of ${total} sources`}
                    </span>
                    <button
                      className="text-button"
                      onClick={cancel}
                      disabled={canceling}
                    >
                      {canceling ? "Canceling…" : "Cancel search"}
                    </button>
                  </div>
                  {!activeWeb && (
                    <progress max={total} value={findings.length} />
                  )}
                </div>
              )}
              {(completed || findings.length > 0) && (
                <section className="results">
                  <div className="results-heading">
                    <div>
                      <h2>{activeQuery}</h2>
                      <p>
                        {running
                          ? "Searching"
                          : canceled
                            ? "Canceled"
                            : "Search complete"}{" "}
                        {activeWeb
                          ? `· ${findings.length} indexed mentions · not independently verified`
                          : `· ${confirmed} profiles confirmed · ${findings.length}/${total} sources finished`}
                      </p>
                    </div>
                    <div
                      className="outcome-counts"
                      aria-label="Source outcomes"
                    >
                      {outcomes.completed} {activeWeb ? "indexed" : "checked"}
                      {outcomes.failed > 0 && ` · ${outcomes.failed} failed`}
                      {outcomes.blocked > 0 && ` · ${outcomes.blocked} blocked`}
                      {outcomes.skipped > 0 && ` · ${outcomes.skipped} skipped`}
                    </div>
                    <div className="result-controls">
                      <select
                        aria-label="Filter results"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="all">All results</option>
                        {Object.entries(statusLabels).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Sort results"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option value="website">Website A–Z</option>
                        <option value="status">Status</option>
                      </select>
                    </div>
                  </div>
                  {filtered.map((f) => (
                    <article className="finding" key={`${f.url}:${f.site}`}>
                      <div className="finding-main">
                        <span className={`status-dot ${f.status}`} />
                        <div>
                          <h3>{f.site}</h3>
                          <span className="muted">
                            {f.category === "Public web mention"
                              ? `Indexed mention · ${new URL(f.url).hostname}`
                              : f.category}
                          </span>
                        </div>
                        <span className={`badge ${f.status}`}>
                          {statusLabels[f.status]}
                        </span>
                        {safeSourceUrl(f.url) && (
                          <a
                            href={f.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Open ${f.site} source`}
                            onClick={(e) => {
                              if (isNative()) {
                                e.preventDefault();
                                void openSource(f.url).catch((error) =>
                                  setNotice(errorText(error)),
                                );
                              }
                            }}
                          >
                            Source
                            <ArrowUpRight size={15} />
                          </a>
                        )}
                      </div>
                      <details>
                        <summary>Evidence</summary>
                        <ul>
                          {f.evidence.map((e, i) => (
                            <li key={i}>{e}</li>
                          ))}
                        </ul>
                        {!!f.publicFields?.length && (
                          <dl className="evidence-fields">
                            {f.publicFields.map((field, i) => (
                              <div key={i}>
                                <dt>{field.label}</dt>
                                <dd>{field.value}</dd>
                              </div>
                            ))}
                          </dl>
                        )}
                        <small>{new Date(f.checkedAt).toLocaleString()}</small>
                      </details>
                    </article>
                  ))}
                  {filtered.length === 0 && (
                    <div className="empty">
                      {findings.length === 0
                        ? "No results returned. This does not prove there is no exposure."
                        : "No results match this filter."}
                    </div>
                  )}
                  <p className="result-note">
                    A matching username does not prove identity or ownership.
                  </p>
                </section>
              )}
              <p className="coverage-note">
                {effectiveArea !== "profiles"
                  ? "Indexed sources only. No search covers the entire internet or private dark-web content."
                  : `Profile checks use ${sources.length} official public APIs. Choose Web or Dark web for broader discovery.`}
              </p>
              {!running && !completed && (
                <div className="starting-state">
                  <div className="source-list">
                    {(effectiveArea !== "profiles"
                      ? [
                          effectiveArea === "dark"
                            ? "DarkOwl · licensed keys required"
                            : "Brave Search · provider key required",
                        ]
                      : sources.slice(
                          0,
                          Math.min(SHOWN_SOURCES, sourceCount(mode)),
                        )
                    ).map((name) => (
                      <span key={name}>{name}</span>
                    ))}
                    {effectiveArea === "profiles" &&
                      sourceCount(mode) > SHOWN_SOURCES && (
                        <span>+{sourceCount(mode) - SHOWN_SOURCES} more</span>
                      )}
                  </div>
                  <p>
                    {effectiveArea === "profiles"
                      ? "No account needed. Searches go directly to the selected public sources."
                      : effectiveArea === "dark"
                        ? "Metadata only. No leaked documents or passwords are downloaded. A mention does not prove an exposed credential pair."
                        : "Search the broader web index for usernames or emails. Results are mentions, not verified accounts."}
                  </p>
                  <span className="sr-only">
                    No generated or sample findings
                  </span>
                </div>
              )}
            </>
          )}
          {page === "search" && historyEnabled && (
            <RecentScans
              onLoad={loadScan}
              onNotice={setNotice}
              busy={running}
              stamp={findings[0]?.checkedAt || ""}
            />
          )}
          {page === "exposure" && (
            <SecurityPanel findings={findings} onNotice={setNotice} />
          )}
          {page === "history" && (
            <HistoryPanel onLoad={loadScan} onNotice={setNotice} />
          )}
          {page === "reports" && (
            <ExportPanel
              findings={findings}
              busy={running || exporting}
              onExport={exportReport}
              redact={redact}
              onRedact={setRedact}
            />
          )}
          {page === "settings" && (
            <section className="panel">
              <h1>Settings</h1>
              {prefsFailed && (
                <div className="setting">
                  <span>Local settings could not be loaded.</span>
                  <button
                    onClick={() => {
                      setNotice("");
                      setPrefsAttempt((value) => value + 1);
                    }}
                  >
                    Reload local settings
                  </button>
                </div>
              )}
              <div className="setting">
                <span>Appearance</span>
                <div className="segments">
                  {(["dark", "light"] as const).map((value) => (
                    <button
                      key={value}
                      className={theme === value ? "selected" : ""}
                      onClick={() => setTheme(value)}
                    >
                      {value === "dark" ? "Dark" : "Light"}
                    </button>
                  ))}
                </div>
              </div>
              <label className="setting">
                <span>Request timeout</span>
                <select
                  aria-label="Request timeout"
                  value={timeout}
                  onChange={(e) => setTimeout(Number(e.target.value))}
                >
                  <option value={8}>8 seconds</option>
                  <option value={12}>12 seconds</option>
                  <option value={20}>20 seconds</option>
                </select>
              </label>
              <label className="setting">
                <span>
                  Save searches on this device
                  <small>
                    Off by default. Stores queries, results, and evidence
                    metadata locally.
                  </small>
                </span>
                <input
                  aria-label="Save searches on this device"
                  type="checkbox"
                  checked={historyEnabled}
                  disabled={!isNative() || !prefsReady}
                  onChange={(e) => setHistoryEnabled(e.target.checked)}
                />
              </label>
              <ProviderSettings key={resetEpoch} onNotice={setNotice} />
              <div className="setting">
                <span>
                  Delete all local data
                  <small>Exported reports stay where you saved them.</small>
                </span>
                <button
                  className="danger-button"
                  onClick={deleteAll}
                  disabled={running}
                >
                  <Trash2 size={15} />
                  Delete all data
                </button>
              </div>
            </section>
          )}
        </main>
      </div>
      <dialog
        ref={dialog}
        onCancel={() => setHelp(false)}
        onClose={() => setHelp(false)}
        className="about"
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const buttons =
            event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
          const first = buttons[0],
            last = buttons[buttons.length - 1];
          if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          }
        }}
      >
        <button
          className="icon-button close"
          aria-label="Close help"
          onClick={() => setHelp(false)}
        >
          <X size={19} />
        </button>
        <img src="/mark.svg" width="44" height="44" alt="" />
        <h2>Nexonic Trace</h2>
        <p>
          Direct profile checks need matching account evidence. Web and dark-web
          indexes return unverified mentions within their coverage.
        </p>
        <p>
          Accounts with matching usernames may belong to different people.
          Source links let you review the original evidence.
        </p>
        <small>Nexonic Technologies · 0.1.0</small>
        <button className="primary-button" onClick={() => setHelp(false)}>
          Got it
          <Check size={16} />
        </button>
      </dialog>
    </div>
  );
}
