import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Download,
  History,
  KeyRound,
  LoaderCircle,
  Trash2,
  ArrowUpRight,
  ShieldCheck,
} from "lucide-react";
import { isNative, openSource, saveReport } from "./bridge";
import type { Finding, SearchSummary } from "./models";

export interface Preferences {
  historyEnabled: boolean;
  appearance: "dark" | "light";
  timeoutSeconds: number;
}
export interface SavedScan {
  id: string;
  query: string;
  mode: string;
  createdAt: string;
  summary: SearchSummary;
}
const message = (error: unknown) =>
  typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : "The request could not finish.";
function Source({ url }: { url: string }) {
  const [error, setError] = useState("");
  if (error) return <span role="status">{error}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        if (isNative()) {
          event.preventDefault();
          void openSource(url).catch((error) => setError(message(error)));
        }
      }}
    >
      Source
      <ArrowUpRight size={13} />
    </a>
  );
}

export function SecurityPanel({
  findings,
  onNotice,
}: {
  findings: Finding[];
  onNotice: (notice: string) => void;
}) {
  const [tab, setTab] = useState<"password" | "email" | "public">("password");
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [checkedAt, setCheckedAt] = useState("");
  const [redactEmail, setRedactEmail] = useState(true);
  const [breachCheckedAt, setBreachCheckedAt] = useState("");
  const [email, setEmail] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [breaches, setBreaches] = useState<
    | null
    | {
        Name: string;
        Title: string;
        Domain: string;
        BreachDate: string;
        DataClasses: string[];
        IsVerified: boolean;
      }[]
  >(null);
  const [selected, setSelected] = useState<string[]>([]);
  const password = useRef<HTMLInputElement>(null);
  async function passwordCheck(event: React.FormEvent) {
    event.preventDefault();
    if (!isNative()) {
      onNotice("Open the installed app to check a password privately.");
      return;
    }
    const value = password.current?.value || "";
    if (!value) return;
    setCount(null);
    setBusy(true);
    // Clear the input immediately. The owned Rust buffer is zeroized after hashing.
    if (password.current) password.current.value = "";
    try {
      const result = await invoke<{ occurrences: number; checkedAt: string }>(
        "password_check",
        {
          password: value,
        },
      );
      setCount(result.occurrences);
      setCheckedAt(result.checkedAt);
    } catch (error) {
      onNotice(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function breachCheck(event: React.FormEvent) {
    event.preventDefault();
    if (!isNative()) {
      onNotice(
        "Open the installed app and connect an authorized breach provider in Settings.",
      );
      return;
    }
    setBusy(true);
    setBreaches(null);
    try {
      setBreaches(await invoke("breach_check", { email, authorized }));
      setBreachCheckedAt(new Date().toISOString());
    } catch (error) {
      onNotice(message(error));
    } finally {
      setBusy(false);
    }
  }
  async function exportBreaches() {
    if (!breaches) return;
    try {
      await saveReport(
        "json",
        JSON.stringify(
          {
            application: "Nexonic Trace",
            email: redactEmail ? "[redacted]" : email,
            checkedAt: breachCheckedAt,
            provider: "Have I Been Pwned",
            source: "https://haveibeenpwned.com/",
            license: "https://creativecommons.org/licenses/by/4.0/",
            authorization:
              "User declared permission; identity ownership not independently verified.",
            records: breaches,
            recommendations:
              "Use unique passwords, enable multi-factor authentication, and watch for phishing.",
          },
          null,
          2,
        ),
      );
    } catch (error) {
      onNotice(message(error));
    }
  }
  return (
    <section className="panel">
      <h1>Security checks</h1>
      <div
        className="segments feature-tabs"
        role="tablist"
        aria-label="Security check type"
      >
        {(
          [
            { id: "password", label: "Password" },
            { id: "email", label: "Email breaches" },
            { id: "public", label: "Public information" },
          ] as const
        ).map((item) => (
          <button
            role="tab"
            aria-selected={tab === item.id}
            key={item.id}
            className={tab === item.id ? "selected" : ""}
            disabled={busy}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "password" && (
        <form onSubmit={passwordCheck} className="feature-form">
          <p>
            Check a password against known breach data. Only the first five
            characters of its hash leave your device.
          </p>
          <label>
            Password
            <input
              ref={password}
              type="password"
              autoComplete="off"
              maxLength={4096}
              required
              placeholder="Enter a password"
              disabled={busy}
            />
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? (
              <LoaderCircle className="spin" size={16} />
            ) : (
              <ShieldCheck size={16} />
            )}
            Check password
          </button>
          {count !== null && (
            <div className="check-result" role="status">
              <h2>
                {count > 0
                  ? `Seen ${count.toLocaleString()} times`
                  : "No match in the checked data"}
              </h2>
              <p>
                {count > 0
                  ? "Replace it with a unique password and enable multi-factor authentication."
                  : "This does not guarantee that the password is secure. Use a long, unique password."}
              </p>
              <small>
                Pwned Passwords · Checked {new Date(checkedAt).toLocaleString()}
              </small>
            </div>
          )}
          <small>
            Never saved, logged, or included in reports. This check does not
            link a password to an email address.
          </small>
        </form>
      )}
      {tab === "email" && (
        <form onSubmit={breachCheck} className="feature-form">
          <p>
            Uses your licensed Have I Been Pwned API key. Subscription charges
            may apply. Only verified, non-sensitive breach records are
            displayed.
          </p>
          <label>
            Email address
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={254}
              disabled={busy}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={authorized}
              onChange={(e) => setAuthorized(e.target.checked)}
            />
            I own this address or have permission to check it.
          </label>
          <button className="primary-button" disabled={busy || !authorized}>
            {busy && <LoaderCircle className="spin" size={16} />}Check email
            breaches
          </button>
          {breaches && (
            <div role="status">
              {breaches.length === 0 ? (
                <div className="check-result">
                  No verified, non-sensitive records were returned. This does
                  not prove the address has never been exposed.
                </div>
              ) : (
                breaches.map((b) => (
                  <article className="breach" key={b.Name}>
                    <h2>{b.Title}</h2>
                    <p>{b.BreachDate} · Provider-verified breach</p>
                    <div className="source-list">
                      {b.DataClasses.map((c) => (
                        <span key={c}>{c}</span>
                      ))}
                    </div>
                    <p>
                      {b.DataClasses.some((c) =>
                        c.toLowerCase().includes("password"),
                      )
                        ? "Change affected passwords, avoid reuse, and enable multi-factor authentication."
                        : "Watch for phishing and review the affected service’s security settings."}
                    </p>
                    <Source
                      url={`https://haveibeenpwned.com/PwnedWebsites#${encodeURIComponent(b.Name)}`}
                    />
                  </article>
                ))
              )}
            </div>
          )}
          {breaches !== null && (
            <div className="breach-export">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={redactEmail}
                  onChange={(e) => setRedactEmail(e.target.checked)}
                />
                Redact email in export
              </label>
              <button
                type="button"
                className="secondary-button"
                onClick={exportBreaches}
              >
                Export breach report (JSON)
              </button>
              <small>Data: Have I Been Pwned · CC BY 4.0</small>
            </div>
          )}
          <small>
            Your permission statement is not ownership verification. Sensitive
            and protected account-specific records are excluded.
          </small>
        </form>
      )}
      {tab === "public" && (
        <div className="feature-form">
          <p>
            Select public profiles you have independently verified as yours.
            Accounts are kept separate; the app does not infer shared ownership.
          </p>
          {findings
            .filter((f) => f.status === "confirmed" && f.publicFields?.length)
            .map((f) => (
              <article className="public-fields" key={f.url}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={selected.includes(f.url)}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, f.url]
                          : old.filter((url) => url !== f.url),
                      )
                    }
                  />
                  <strong>{f.site}</strong> — I verified this profile as mine.
                </label>
                {selected.includes(f.url) && (
                  <>
                    <dl>
                      {f.publicFields?.map((field, i) => (
                        <div key={i}>
                          <dt>{field.label}</dt>
                          <dd>{field.value}</dd>
                        </div>
                      ))}
                    </dl>
                    <Source url={f.url} />
                    <small>
                      User-selected source; ownership has not been independently
                      verified by Nexonic Trace.
                    </small>
                  </>
                )}
              </article>
            ))}
          {!findings.some(
            (f) => f.status === "confirmed" && f.publicFields?.length,
          ) && (
            <div className="empty">
              Run a username search to inspect publicly disclosed profile
              fields.
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function HistoryPanel({
  onLoad,
  onNotice,
}: {
  onLoad: (scan: SavedScan) => void;
  onNotice: (notice: string) => void;
}) {
  const [scans, setScans] = useState<SavedScan[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  async function refresh() {
    if (!isNative()) return;
    try {
      setScans(await invoke("list_scans"));
    } catch (error) {
      onNotice(message(error));
    }
  }
  useEffect(() => {
    void refresh();
  }, []);
  async function remove(id?: string) {
    setBusy(true);
    try {
      await invoke(id ? "delete_scan" : "clear_history", id ? { id } : {});
      setSelected([]);
      await refresh();
    } catch (error) {
      onNotice(message(error));
    } finally {
      setBusy(false);
    }
  }
  const comparison =
    selected.length === 2
      ? scans
          .filter((s) => selected.includes(s.id))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      : [];
  const comparable =
    comparison.length === 2 &&
    comparison[0].query.toLowerCase() === comparison[1].query.toLowerCase();
  const changes = comparable
    ? Array.from(
        new Set(
          comparison.flatMap((s) => s.summary.findings.map((f) => f.site)),
        ),
      )
        .map((site) => ({
          site,
          before:
            comparison[0].summary.findings.find((f) => f.site === site)
              ?.status || "not_checked",
          after:
            comparison[1].summary.findings.find((f) => f.site === site)
              ?.status || "not_checked",
        }))
        .filter((row) => row.before !== row.after)
    : [];
  return (
    <section className="panel">
      <div className="section-heading">
        <h1>History</h1>
        <button
          className="danger-button"
          disabled={!scans.length || busy}
          onClick={() => remove()}
        >
          <Trash2 size={15} />
          Clear history
        </button>
      </div>
      <p className="muted">
        Up to 100 recent searches. Enable saving in Settings. Select two scans
        of the same query to compare.
      </p>
      {scans.length === 0 ? (
        <div className="empty">
          <History size={28} />
          <h2>No saved searches</h2>
          <p>
            History is off by default. Enable it to keep future searches
            locally.
          </p>
        </div>
      ) : (
        scans.map((scan) => (
          <article className="history-row" key={scan.id}>
            <input
              aria-label={`Compare scan ${scan.query} ${scan.createdAt}`}
              type="checkbox"
              checked={selected.includes(scan.id)}
              disabled={!selected.includes(scan.id) && selected.length === 2}
              onChange={(e) =>
                setSelected((old) =>
                  e.target.checked
                    ? [...old, scan.id]
                    : old.filter((id) => id !== scan.id),
                )
              }
            />
            <button onClick={() => onLoad(scan)}>
              <strong>{scan.query}</strong>
              <small>
                {new Date(scan.createdAt).toLocaleString()} ·{" "}
                {scan.summary.findings.length} results
              </small>
            </button>
            <button
              className="icon-button"
              aria-label={`Delete scan ${scan.query}`}
              disabled={busy}
              onClick={() => remove(scan.id)}
            >
              <Trash2 size={16} />
            </button>
          </article>
        ))
      )}
      {comparison.length === 2 && (
        <div className="check-result">
          <h2>Scan comparison</h2>
          {!comparable ? (
            <p>
              Choose two searches for the same query. Different queries are not
              linked into an identity.
            </p>
          ) : changes.length === 0 ? (
            <p>No source-status changes between these scans.</p>
          ) : (
            changes.map((change) => (
              <p key={change.site}>
                {change.site}: {change.before.replaceAll("_", " ")} →{" "}
                {change.after.replaceAll("_", " ")}
              </p>
            ))
          )}
        </div>
      )}
    </section>
  );
}

export function ProviderSettings({
  onNotice,
}: {
  onNotice: (notice: string) => void;
}) {
  const [provider, setProvider] = useState("brave");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<[boolean, boolean]>([false, false]);
  const [busy, setBusy] = useState(false);
  const key = useRef<HTMLInputElement>(null);
  async function refresh() {
    if (isNative()) setStatus(await invoke("provider_status"));
  }
  useEffect(() => {
    void refresh().catch((error) => onNotice(message(error)));
  }, []);
  async function configure(event: React.FormEvent) {
    event.preventDefault();
    if (!isNative()) {
      onNotice("Connect providers in the installed app.");
      return;
    }
    const value = key.current?.value || "";
    if (key.current) key.current.value = "";
    setBusy(true);
    try {
      await invoke("configure_provider", {
        provider,
        key: value,
        acceptCosts: consent,
      });
      await refresh();
      onNotice(
        value
          ? "Provider connected for this session."
          : "Provider disconnected.",
      );
    } catch (error) {
      onNotice(message(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="provider-settings">
      <h2>Optional providers</h2>
      <p>
        Keys stay in memory and are cleared when the app closes. Provider
        subscriptions or usage charges may apply; Nexonic does not set those
        prices.
      </p>
      <form onSubmit={configure} className="feature-form">
        <label>
          Provider
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              if (key.current) key.current.value = "";
              setConsent(false);
            }}
          >
            <option value="brave">
              Brave Search — {status[0] ? "connected" : "not connected"}
            </option>
            <option value="hibp">
              Have I Been Pwned — {status[1] ? "connected" : "not connected"}
            </option>
          </select>
        </label>
        <label>
          API key
          <input
            ref={key}
            type="password"
            autoComplete="off"
            maxLength={512}
            placeholder="Enter key, or leave blank to disconnect"
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I authorize requests under my provider plan and accept applicable
          provider charges.
        </label>
        <button className="secondary-button" disabled={busy}>
          <KeyRound size={15} />
          Save session connection
        </button>
      </form>
    </div>
  );
}

export function ExportPanel({
  findings,
  busy,
  onExport,
  redact,
  onRedact,
}: {
  findings: Finding[];
  busy: boolean;
  onExport: (format: "json" | "csv" | "html" | "pdf") => void;
  redact: boolean;
  onRedact: (value: boolean) => void;
}) {
  return (
    <section className="panel">
      <h1>Export results</h1>
      <p>
        {findings.length} source results available. Reports include evidence,
        timestamps, source links, and ownership limitations.
      </p>
      <label className="setting">
        <span>Redact query, profile URLs, evidence, and public fields</span>
        <input
          type="checkbox"
          checked={redact}
          onChange={(e) => onRedact(e.target.checked)}
        />
      </label>
      <div className="button-row">
        {(["json", "csv", "html", "pdf"] as const).map((format) => (
          <button
            key={format}
            className={format === "pdf" ? "primary-button" : "secondary-button"}
            onClick={() => onExport(format)}
            disabled={!findings.length || busy}
          >
            {format.toUpperCase()}
            <Download size={16} />
          </button>
        ))}
      </div>
    </section>
  );
}
