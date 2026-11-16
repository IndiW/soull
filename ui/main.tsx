import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  api,
  token,
  type State,
  type Manager,
  type Feature,
  type Finding,
} from "./api";
import { Robot } from "./Robot";
import { Terminal } from "./Terminal";
import { Review } from "./Review";
import { Conversation } from "./Conversation";
import "./style.css";
type Tab = "map" | "conversation" | "terminal" | "review" | "code";
const empty: State = { managers: [], features: [], findings: [], sessions: [] };
function App() {
  const [data, setData] = useState<State>(empty),
    [managerId, setManagerId] = useState(
      localStorage.getItem("soull-manager") || "",
    ),
    [featureId, setFeatureId] = useState(
      localStorage.getItem("soull-feature") || "",
    ),
    [tab, setTab] = useState<Tab>(
      (localStorage.getItem("soull-tab") as Tab) || "map",
    ),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [form, setForm] = useState<"manager" | "feature" | null>(null),
    [busy, setBusy] = useState(false),
    [inbox, setInbox] = useState(false),
    [dirty, setDirty] = useState(false),
    [copied, setCopied] = useState(false),
    [selectedFinding, setSelectedFinding] = useState<string | null>(null),
    [copySelection, setCopySelection] = useState(
      localStorage.getItem("soull-copy") !== "false",
    ),
    [fileLink, setFileLink] = useState<{ path: string; line: number } | null>(
      null,
    );
  const manager =
      data.managers.find((m) => m.id === managerId) || data.managers[0],
    features = data.features.filter((f) => f.managerId === manager?.id),
    feature = features.find((f) => f.id === featureId) || features[0],
    findings = data.findings.filter((f) => f.featureId === feature?.id),
    unread = data.findings.filter((f) => !f.isRead).length;
  const report = (e: unknown) =>
    setError(e instanceof Error ? e.message : String(e));
  async function refresh() {
    try {
      setData(await api<State>("/state"));
    } catch (e) {
      report(e);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (token) refresh();
    else setLoading(false);
    const timer = setInterval(() => {
      if (token) refresh();
    }, 2500);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (manager) localStorage.setItem("soull-manager", manager.id);
    if (feature) localStorage.setItem("soull-feature", feature.id);
    localStorage.setItem("soull-tab", tab);
  }, [manager?.id, feature?.id, tab]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(timer);
  }, [copied]);
  const allowSwitch = () =>
    !dirty || confirm("Discard unsaved file edits before switching views?");
  function navigate(next: Tab) {
    if (!allowSwitch()) return;
    setDirty(false);
    setInbox(false);
    setTab(next);
    setFileLink(null);
    setSelectedFinding(null);
  }
  async function submitManager(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const m = await api<Manager>(
        "/managers",
        "POST",
        Object.fromEntries(fields),
      );
      await refresh();
      setManagerId(m.id);
      setFeatureId("");
      setForm(null);
      setTab("map");
      setInbox(false);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function submitFeature(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const f = await api<Feature>("/features", "POST", {
        managerId: manager?.id,
        title: fields.get("title"),
      });
      await refresh();
      setFeatureId(f.id);
      setForm(null);
      setTab("terminal");
      setInbox(false);
    } catch (e) {
      report(e);
    } finally {
      setBusy(false);
    }
  }
  async function patchFinding(f: Finding, patch: object) {
    try {
      await api("/findings/" + f.id, "PATCH", patch);
      await refresh();
    } catch (e) {
      report(e);
    }
  }
  async function copyText() {
    if (!copySelection) return;
    const selected = window.getSelection()?.toString();
    if (!selected?.trim()) return;
    try {
      const native = (window as any).webkit?.messageHandlers?.clipboard;
      if (native) native.postMessage(selected);
      else await navigator.clipboard.writeText(selected);
      setCopied(true);
    } catch (e) {
      report(e);
    }
  }
  function openFinding(f: Finding) {
    if (!allowSwitch()) return;
    const target = data.features.find((x) => x.id === f.featureId);
    if (!target) return;
    setManagerId(target.managerId);
    setFeatureId(target.id);
    setInbox(false);
    setTab("conversation");
    setSelectedFinding(f.id);
    setDirty(false);
    patchFinding(f, { isRead: true });
  }
  const openFile = useCallback(
    (path: string, line: number) => {
      if (!allowSwitch()) return;
      setFileLink({ path, line });
      setTab("code");
      setInbox(false);
    },
    [dirty],
  );
  if (!token)
    return (
      <div className="locked">
        <Robot name="Mika" size={72} />
        <h1>Welcome to Soull</h1>
        <p>Open the app through the local launcher to connect securely.</p>
        <code>node bin/soull.mjs open</code>
      </div>
    );
  return (
    <div className="app-shell">
      <header className="global-bar">
        <div className="wordmark">
          <Robot name="Mika" size={25} />
          <strong>Soull</strong>
          <span className="dev-tag">DEV</span>
        </div>
        <span className="global-note">A little space for big ideas.</span>
        <button
          className={"inbox-button " + (inbox ? "selected" : "")}
          onClick={() => {
            if (allowSwitch()) {
              setInbox(!inbox);
              setDirty(false);
            }
          }}
        >
          ▱ Inbox {unread > 0 && <span className="count">{unread}</span>}
        </button>
      </header>
      <aside className="sidebar">
        <div className="sidebar-title">
          <span>Your managers</span>
          <button
            aria-label="Hire a manager"
            title="Hire a manager"
            onClick={() => setForm(form === "manager" ? null : "manager")}
          >
            +
          </button>
        </div>
        <nav aria-label="Managers">
          {data.managers.map((m) => {
            const ids = data.features
                .filter((f) => f.managerId === m.id)
                .map((f) => f.id),
              running = data.sessions.filter(
                (s) => ids.includes(s.featureId) && s.state === "running",
              ).length,
              attention = data.findings.filter(
                (f) =>
                  ids.includes(f.featureId) &&
                  !f.resolved &&
                  f.kind === "question",
              ).length;
            return (
              <button
                className={
                  "manager-row " + (manager?.id === m.id ? "selected" : "")
                }
                key={m.id}
                onClick={() => {
                  if (allowSwitch()) {
                    setManagerId(m.id);
                    setFeatureId("");
                    setTab("map");
                    setInbox(false);
                    setDirty(false);
                  }
                }}
              >
                <Robot name={m.name} />
                <span>
                  <strong>{m.name}</strong>
                  <small>{m.repo.split("/").at(-1)}</small>
                  <span
                    className={"manager-state " + (attention ? "peach" : "")}
                  >
                    {attention
                      ? "Decision needed"
                      : running
                        ? "Session active"
                        : "Ready when you are"}
                  </span>
                </span>
              </button>
            );
          })}
        </nav>
        {!data.managers.length && !loading && (
          <p className="sidebar-hint">
            Every project starts with a good manager.
          </p>
        )}
        <div className="sidebar-bottom">
          <div className="usage">
            <span className="eyebrow">PLAN USAGE</span>
            <p>Not connected yet</p>
            <small>Your agents use their own subscription sign-in.</small>
          </div>
          <label className="setting">
            <input
              type="checkbox"
              checked={copySelection}
              onChange={(e) => {
                setCopySelection(e.target.checked);
                localStorage.setItem("soull-copy", String(e.target.checked));
              }}
            />
            Copy selected conversation text
          </label>
          <span className="local-label">
            <span className="dot green" /> Local workspace
          </span>
        </div>
      </aside>
      <main className="workspace">
        {error && (
          <div className="error" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              ×
            </button>
          </div>
        )}
        {form === "manager" && (
          <form className="setup-form" onSubmit={submitManager}>
            <div>
              <span className="eyebrow">A NEW COMPANION</span>
              <h2>Hire a manager</h2>
              <p className="muted">
                Give them a name, a repository, and their preferred agent.
              </p>
            </div>
            <label>
              Name
              <input
                name="name"
                required
                maxLength={60}
                placeholder="Mika"
                autoFocus
              />
            </label>
            <label>
              Local Git repository
              <input
                name="repo"
                required
                placeholder="/Users/you/Projects/my-app"
              />
            </label>
            <label>
              Provider
              <select name="provider">
                <option value="codex">Codex</option>
                <option value="claude">Claude Code</option>
              </select>
            </label>
            <div className="form-actions">
              <button type="button" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Checking repository…" : "Hire manager"}
              </button>
            </div>
          </form>
        )}
        {form === "feature" && (
          <form className="setup-form compact" onSubmit={submitFeature}>
            <div>
              <span className="eyebrow">NEXT MISSION</span>
              <h2>What are we working on?</h2>
              <p className="muted">
                Soull creates an isolated branch and worktree from the
                repository’s current HEAD. Uncommitted files are not copied.
              </p>
            </div>
            <label>
              Feature title
              <input
                name="title"
                required
                maxLength={200}
                placeholder="Add account settings"
                autoFocus
              />
            </label>
            <div className="form-actions">
              <button type="button" onClick={() => setForm(null)}>
                Cancel
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "Creating worktree…" : "Create workspace"}
              </button>
            </div>
          </form>
        )}
        {loading ? (
          <div className="empty">
            <h2>Opening your workspace…</h2>
          </div>
        ) : inbox ? (
          <>
            <div className="workspace-heading">
              <div>
                <span className="eyebrow">YOUR ATTENTION, AT YOUR PACE</span>
                <h1>Inbox</h1>
                <p className="muted">
                  Findings, answers, and decisions from your managers.
                </p>
              </div>
            </div>
            <section className="inbox-list">
              {data.findings.length ? (
                data.findings.map((f) => (
                  <button
                    className={"inbox-row " + (!f.isRead ? "unread" : "")}
                    key={f.id}
                    onClick={() => openFinding(f)}
                  >
                    <span className="kind-icon">
                      {f.kind === "question" ? "?" : "✧"}
                    </span>
                    <span>
                      <strong>{f.title}</strong>
                      <small>
                        {data.features.find((x) => x.id === f.featureId)?.title}{" "}
                        · {f.kind}
                        {f.resolved ? " · Resolved" : ""}
                      </small>
                    </span>
                    <span>{f.isRead ? "Read" : "Unread"} ↗</span>
                  </button>
                ))
              ) : (
                <div className="empty">
                  <Robot name="Atlas" size={64} />
                  <h2>A clear head, a quiet inbox</h2>
                  <p>
                    When your managers publish findings or questions,
                    <br />
                    they’ll be waiting here.
                  </p>
                </div>
              )}
            </section>
          </>
        ) : !manager ? (
          <div className="empty welcome">
            <Robot name="Mika" size={96} />
            <span className="eyebrow">MEET YOUR NEXT TEAM</span>
            <h1>Make room for your ideas.</h1>
            <p>
              Give a manager a project. Let them coordinate the work.
              <br />
              Come back to clear answers, whenever you’re ready.
            </p>
            <button className="primary" onClick={() => setForm("manager")}>
              + Hire your first manager
            </button>
            <small>Codex and Claude Code · Your own subscriptions</small>
          </div>
        ) : (
          <>
            <div className="workspace-heading">
              <div>
                <span className="eyebrow">
                  {manager.name.toUpperCase()}’S WORKSPACE
                </span>
                <h1>{feature?.title || manager.repo.split("/").at(-1)}</h1>
                <p className="muted">
                  {feature ? feature.branch : manager.repo}
                </p>
              </div>
              <div className="heading-actions">
                {features.length > 0 && (
                  <select
                    aria-label="Current feature"
                    value={feature?.id}
                    onChange={(e) => {
                      if (allowSwitch()) {
                        setFeatureId(e.target.value);
                        setDirty(false);
                        setFileLink(null);
                        setSelectedFinding(null);
                      }
                    }}
                  >
                    {features.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.title}
                      </option>
                    ))}
                  </select>
                )}
                <button className="primary" onClick={() => setForm("feature")}>
                  + New feature
                </button>
              </div>
            </div>
            <nav className="view-tabs" aria-label="Workspace views">
              {(
                [
                  ["map", "◇", "Map"],
                  ["conversation", "◌", "Conversation"],
                  ["terminal", "›_", "Terminal"],
                  ["review", "◉", "Guided diff"],
                  ["code", "⌘", "Code"],
                ] as const
              ).map(([id, icon, label]) => (
                <button
                  className={tab === id ? "active" : ""}
                  key={id}
                  onClick={() => navigate(id)}
                >
                  <span>{icon}</span>
                  {label}
                </button>
              ))}
            </nav>
            {!feature ? (
              <div className="empty">
                <Robot name={manager.name} size={72} />
                <h2>{manager.name} is ready.</h2>
                <p>
                  Create a feature to give your manager an isolated workspace.
                </p>
                <button className="primary" onClick={() => setForm("feature")}>
                  Create first feature
                </button>
              </div>
            ) : tab === "terminal" ? (
              <Terminal
                key={feature.id}
                feature={feature}
                manager={manager}
                sessions={data.sessions.filter(
                  (s) => s.featureId === feature.id,
                )}
                refresh={refresh}
                onError={report}
              />
            ) : tab === "review" || tab === "code" ? (
              <Review
                key={feature.id + tab}
                feature={feature}
                mode={tab === "code" ? "code" : "review"}
                onError={report}
                onDirty={setDirty}
                initialFile={fileLink}
              />
            ) : tab === "conversation" ? (
              <Conversation
                key={feature.id}
                feature={feature}
                manager={manager}
                openFile={openFile}
                onCopySelection={copyText}
                findingFocus={selectedFinding}
                openTerminal={() => navigate("terminal")}
                briefings={
                  <section className="conversation">
                    <div className="briefing-heading">
                      <Robot name={manager.name} size={48} />
                      <div>
                        <h2>{manager.name}’s briefings</h2>
                        <p className="muted">
                          Findings and questions published by your coordinator.
                        </p>
                      </div>
                      <button onClick={() => navigate("terminal")}>
                        Open terminal ↗
                      </button>
                    </div>
                    {findings.length ? (
                      findings.map((f) => (
                        <article
                          className="finding"
                          key={f.id}
                          id={"finding-" + f.id}
                        >
                          <div className="finding-meta">
                            <span>{f.kind}</span>
                            <time>{new Date(f.created).toLocaleString()}</time>
                            {!f.isRead && (
                              <span className="unread-label">Unread</span>
                            )}
                          </div>
                          <h2>{f.title}</h2>
                          <FindingBody body={f.body} openFile={openFile} />
                          <div className="finding-actions">
                            <button
                              onClick={() =>
                                patchFinding(f, { isRead: !f.isRead })
                              }
                            >
                              {f.isRead ? "Mark unread" : "Mark read"}
                            </button>
                            <button
                              onClick={() =>
                                patchFinding(f, { resolved: !f.resolved })
                              }
                            >
                              {f.resolved ? "✓ Resolved" : "Resolve"}
                            </button>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="empty">
                        <h2>Keep the useful parts.</h2>
                        <p>
                          Ask your coordinator to publish a finding with the{" "}
                          <code>soull</code> CLI.
                          <br />
                          It stays here even as the conversation moves on.
                        </p>
                        <code>soull help</code>
                        <button onClick={() => navigate("terminal")}>
                          Go to terminal
                        </button>
                      </div>
                    )}
                  </section>
                }
              />
            ) : (
              <section className="map-view">
                <div className="map-caption">
                  <span className="eyebrow">MISSION MAP</span>
                  <span>
                    {features.length}{" "}
                    {features.length === 1 ? "feature" : "features"} ·
                    Dependency editing coming next
                  </span>
                </div>
                <div className="mission-root">
                  <Robot name={manager.name} size={48} />
                  <div>
                    <strong>{manager.name}</strong>
                    <small>
                      {manager.provider === "claude" ? "Claude Code" : "Codex"}{" "}
                      manager
                    </small>
                  </div>
                </div>
                <div className="missions">
                  {features.map((f) => {
                    const active = data.sessions.some(
                        (s) => s.featureId === f.id && s.state === "running",
                      ),
                      count = data.findings.filter(
                        (x) => x.featureId === f.id && !x.isRead,
                      ).length;
                    return (
                      <button
                        key={f.id}
                        className={
                          "mission " + (feature.id === f.id ? "current" : "")
                        }
                        onClick={() => {
                          setFeatureId(f.id);
                          setTab("terminal");
                        }}
                      >
                        <span className="mission-top">
                          ↳ Feature{" "}
                          <span>
                            {active ? "Session active" : "Workspace ready"}
                          </span>
                        </span>
                        <h2>{f.title}</h2>
                        <code>{f.branch}</code>
                        <span className="mission-bottom">
                          {count
                            ? `${count} unread findings`
                            : "Open workspace"}{" "}
                          ↗
                        </span>
                      </button>
                    );
                  })}
                </div>
                <p className="map-footnote">
                  These are real workspaces. Agent progress and dependencies
                  will appear when explicitly recorded.
                </p>
              </section>
            )}
          </>
        )}
      </main>
      {copied && (
        <div className="toast" role="status">
          ✓ Selection copied
        </div>
      )}
    </div>
  );
}
function FindingBody({
  body,
  openFile,
}: {
  body: string;
  openFile: (path: string, line: number) => void;
}) {
  // Explicit workspace-relative links only; external Markdown is rendered as text.
  const parts = body.split(/(\[[^\]]+\]\([^\s)]+\))/g);
  return (
    <div className="finding-body">
      {parts.map((part, i) => {
        const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
        if (!match) return part;
        const target = match[2].match(
          /^(?!\/)(?!.*\.\.\/)([\w./@ -]+?)(?::(\d+))?$/,
        );
        if (!target) return part;
        return (
          <button
            className="file-link"
            key={i}
            onClick={() => openFile(target[1], Number(target[2] || 1))}
          >
            {match[1]} ↗
          </button>
        );
      })}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
