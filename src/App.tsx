import { useEffect, useRef, useState } from "react";
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

type Page = "search" | "exposure" | "history" | "reports" | "settings";
const pages = [
  { id: "search", label: "Search", icon: Search },
  { id: "exposure", label: "Security", icon: Shield },
  { id: "history", label: "History", icon: History },
  { id: "reports", label: "Export", icon: Download },
  { id: "settings", label: "Settings", icon: Settings2 },
] as const;
const sources = ["GitHub", "DEV Community", "Codeberg", "Lichess", "Chess.com"];
const sourceCount = (mode: SearchMode) =>
  mode === "quick" ? 2 : mode === "deep" ? 4 : 5;
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
  const [webSearch, setWebSearch] = useState(false);
  const [activeWeb, setActiveWeb] = useState(false);
  const [resetEpoch, setResetEpoch] = useState(0);
  const job = useRef<string | null>(null);
  const queryInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const prefsRead = useRef<AbortController | null>(null);
  const [total, setTotal] = useState(2);
  const kind = detectQuery(query);
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
    const useWeb = kind === "email" || webSearch;
    setActiveWeb(useWeb);
    setTotal(useWeb ? 0 : sourceCount(mode));
    try {
      const result = useWeb
        ? await invoke<SearchSummary>("public_web_search", {
            jobId: id,
            query: query.trim(),
            mode,
          })
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
    setActiveWeb(scan.mode.startsWith("public_web"));
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
      setWebSearch(false);
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
                <p>Find public profiles. See the evidence.</p>
              </div>
              <form className="search-box" onSubmit={start}>
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
                    onChange={(e) => setQuery(e.target.value)}
                    disabled={running}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    maxLength={254}
                  />
                  <button
                    className="primary-button"
                    disabled={running || !query.trim()}
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
                    {kind === "email" || webSearch
                      ? `${mode === "quick" ? 3 : mode === "deep" ? 6 : 10} indexed results max`
                      : `${sourceCount(mode)} sources`}
                  </span>
                </div>
              </form>
              {running && (
                <div className="live-status">
                  <div>
                    <LoaderCircle size={16} className="spin" />
                    <span>
                      {activeWeb
                        ? "Searching the public index…"
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
                    <article className="finding" key={f.url}>
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
              {!running && !completed && (
                <div className="starting-state">
                  <div className="source-list">
                    {(kind === "email" || webSearch
                      ? ["Brave Search · provider key required"]
                      : sources.slice(0, sourceCount(mode))
                    ).map((name) => (
                      <span key={name}>{name}</span>
                    ))}
                  </div>
                  <p>
                    No account needed. Searches go directly to the selected
                    public sources.
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
              <label className="setting">
                <span>
                  Use public-web search for usernames
                  <small>
                    Requires a Brave Search key. Results are indexed mentions,
                    not verified profiles.
                  </small>
                </span>
                <input
                  aria-label="Use public-web search for usernames"
                  type="checkbox"
                  checked={webSearch}
                  onChange={(e) => setWebSearch(e.target.checked)}
                />
              </label>
              <div className="setting">
                <span>
                  Source rules v1
                  <small>
                    Five connectors. Last smoke check: 8 November 2026. Rules
                    update with application releases.
                  </small>
                </span>
                <a
                  href="https://github.com/Shahrukhalid/Nexonic-Trace/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => {
                    if (isNative()) {
                      e.preventDefault();
                      void openSource(
                        "https://github.com/Shahrukhalid/Nexonic-Trace/releases",
                      ).catch((error) => setNotice(errorText(error)));
                    }
                  }}
                >
                  Check updates
                </a>
              </div>
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
          Searches use permitted public APIs. Every confirmation needs matching
          account data; HTTP success alone is insufficient.
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
