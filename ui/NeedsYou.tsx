import { useEffect, useRef, useState } from "react";
import { api, type Feature, type Manager } from "./api";
import { Conversation } from "./Conversation";
import "./needs-you.css";
type Choice = {
  id: string;
  label: string;
  description: string;
  recommended: boolean;
};
export type Question = {
  id: string;
  ordinal: number;
  historyOrder: number | null;
  taskId: string;
  taskTitle: string;
  featureId: string;
  featureTitle: string;
  managerId: string;
  title: string;
  context: string;
  reason: string;
  recommendation: string;
  choices: Choice[];
  stage: "waiting" | "can-continue" | "later";
  status: "open" | "answered" | "applied" | "dismissed";
  revision: number;
  answer: string;
  answerVersion: number;
  appliedVersion: number;
  deferUntil: string | null;
  milestone: string | null;
  deferred: boolean;
  isRead: number;
  dismissReason: string;
  updated: string;
};
type Page = { questions: Question[]; hasMore: boolean };
const stageLabels = {
  waiting: "Waiting on you",
  "can-continue": "Can continue",
  later: "Needed later",
};
function QuestionDetail({
  question: q,
  answer,
  change,
  discuss,
  busy,
}: {
  question: Question;
  answer: (
    revision: number,
    body: string,
    choiceId?: string,
  ) => Promise<boolean>;
  change: (revision: number, patch: object) => Promise<boolean>;
  discuss: () => void;
  busy: boolean;
}) {
  const key = "soull-question-" + q.id + "-answer";
  const [draft, setDraft] = useState(() => localStorage.getItem(key) || ""),
    [base, setBase] = useState(
      () => Number(localStorage.getItem(key + "-revision")) || q.revision,
    ),
    [defer, setDefer] = useState(false),
    [until, setUntil] = useState(""),
    [milestone, setMilestone] = useState(""),
    [dismiss, setDismiss] = useState(false),
    [reason, setReason] = useState("");
  useEffect(() => {
    if (!draft) setBase(q.revision);
  }, [q.revision]);
  const conflicted = base !== q.revision;
  async function send(choiceId?: string) {
    if (await answer(base, draft, choiceId)) {
      setDraft("");
      localStorage.removeItem(key);
      localStorage.removeItem(key + "-revision");
    }
  }
  return (
    <div className="question-detail">
      <p className="question-task">
        {q.taskTitle}
        <span>{q.featureTitle}</span>
      </p>
      <h3>{q.title}</h3>
      <p className={q.status === "open" ? "question-stage" : "question-status"}>
        {q.status === "open"
          ? q.deferred
            ? "Deferred"
            : stageLabels[q.stage]
          : q.status === "answered"
            ? `Answered · waiting for agent (v${q.answerVersion})`
            : q.status === "applied"
              ? `Applied · agent acknowledged v${q.appliedVersion}`
              : "Dismissed"}
      </p>
      {q.context && <p className="question-context">{q.context}</p>}
      {q.reason && (
        <div className="question-context-block">
          <h4>Why it matters</h4>
          <p>{q.reason}</p>
        </div>
      )}
      {q.recommendation && (
        <div className="question-context-block">
          <h4>Manager’s recommendation</h4>
          <p>{q.recommendation}</p>
        </div>
      )}
      {q.answer && (
        <div className="question-recorded">
          <h4>
            {q.status === "open"
              ? "Previous answer"
              : `Answer v${q.answerVersion}`}
          </h4>
          <p>{q.answer}</p>
          {q.status === "answered" && (
            <small>
              Recorded in this task’s mailbox. It stays here until the agent
              acknowledges this version.
            </small>
          )}
        </div>
      )}
      <button className="question-discuss" onClick={discuss}>
        Discuss this
      </button>
      <p className="question-helper">
        Discussion explores the decision. Only an explicit answer records it.
      </p>
      {q.status === "dismissed" ? (
        <div>
          <p className="question-context">{q.dismissReason}</p>
          <button
            disabled={busy}
            onClick={() => change(q.revision, { action: "restore" })}
          >
            Reopen question
          </button>
        </div>
      ) : (
        <>
          {conflicted && (
            <div className="question-warning" role="alert">
              This question changed while you were drafting. Review the updated
              context.
              <button
                onClick={() => {
                  setBase(q.revision);
                  localStorage.setItem(key + "-revision", String(q.revision));
                }}
              >
                Use latest question
              </button>
            </div>
          )}
          <div className="question-options">
            {q.choices.map((c) => (
              <button
                key={c.id}
                disabled={busy || conflicted}
                onClick={() => send(c.id)}
              >
                <span>
                  {c.label}
                  {c.recommended && <small>Recommended</small>}
                </span>
                {c.description && <small>{c.description}</small>}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <label htmlFor={"answer-" + q.id}>
              {q.answerVersion ? "Give an updated answer" : "Your answer"}
            </label>
            <textarea
              id={"answer-" + q.id}
              rows={3}
              maxLength={12000}
              value={draft}
              placeholder="Answer in your own words…"
              onChange={(e) => {
                setDraft(e.target.value);
                localStorage.setItem(key, e.target.value);
                localStorage.setItem(key + "-revision", String(base));
              }}
            />
            <button
              className="primary"
              disabled={busy || conflicted || !draft.trim()}
              type="submit"
            >
              {busy
                ? "Saving…"
                : q.answerVersion
                  ? "Update answer"
                  : "Send answer"}
            </button>
          </form>
          {q.status === "open" && (
            <div className="question-secondary">
              <button
                disabled={busy}
                onClick={() => {
                  setDefer(!defer);
                  setDismiss(false);
                }}
              >
                Defer
              </button>
              <button
                disabled={busy}
                onClick={() => {
                  setDismiss(!dismiss);
                  setDefer(false);
                }}
              >
                Dismiss
              </button>
              {q.deferred && (
                <button
                  disabled={busy}
                  onClick={() => change(q.revision, { action: "restore" })}
                >
                  Bring back now
                </button>
              )}
            </div>
          )}
          {defer && (
            <form
              className="question-defer"
              onSubmit={async (e) => {
                e.preventDefault();
                if (
                  await change(q.revision, {
                    action: "defer",
                    ...(milestone.trim()
                      ? { milestone: milestone.trim() }
                      : {
                          until: until ? new Date(until).toISOString() : null,
                        }),
                  })
                )
                  setDefer(false);
              }}
            >
              <label htmlFor={"until-" + q.id}>Remind me at</label>
              <input
                id={"until-" + q.id}
                type="datetime-local"
                value={until}
                disabled={!!milestone.trim()}
                onChange={(e) => setUntil(e.target.value)}
              />
              <label htmlFor={"milestone-" + q.id}>
                Or after a task milestone
              </label>
              <input
                id={"milestone-" + q.id}
                value={milestone}
                maxLength={200}
                placeholder="e.g. API contract agreed"
                onChange={(e) => setMilestone(e.target.value)}
              />
              <p className="question-helper">
                A timed reminder returns automatically. A milestone returns when
                the task reports that exact milestone.
              </p>
              <button
                disabled={busy || (!until && !milestone.trim())}
                type="submit"
              >
                Defer question
              </button>
            </form>
          )}
          {dismiss && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                await change(q.revision, { action: "dismiss", reason });
              }}
            >
              <label htmlFor={"dismiss-" + q.id}>Why dismiss it?</label>
              <input
                id={"dismiss-" + q.id}
                value={reason}
                maxLength={2000}
                onChange={(e) => setReason(e.target.value)}
              />
              <button disabled={busy || !reason.trim()}>
                Confirm dismissal
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
export function NeedsYou({
  manager,
  features,
  focusId,
  focusVersion,
  openFile,
  onCopySelection,
}: {
  manager: Manager;
  features: Feature[];
  focusId?: string | null;
  focusVersion?: number;
  openFile: (featureId: string, path: string, line: number) => void;
  onCopySelection: () => void;
}) {
  const [questions, setQuestions] = useState<Question[]>([]),
    [history, setHistory] = useState<Question[]>([]),
    [historyOpen, setHistoryOpen] = useState(false),
    [historyBusy, setHistoryBusy] = useState(false),
    [more, setMore] = useState(false),
    [selected, setSelected] = useState<string | null>(focusId || null),
    [detail, setDetail] = useState<Question | null>(null),
    [discussion, setDiscussion] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const historyOpenRef = useRef(false);
  const historyLock = useRef(false);
  const historyRef = useRef<Question[]>([]);
  useEffect(() => {
    historyRef.current = history;
  }, [history]);
  useEffect(() => {
    historyOpenRef.current = historyOpen;
  }, [historyOpen]);
  const lock = useRef(false),
    request = useRef<{ signature: string; id: string } | null>(null);
  const base = "/managers/" + manager.id + "/questions";
  async function refresh() {
    const page = await api<Page>(base);
    setQuestions(page.questions);
    setLoaded(true);
  }
  useEffect(() => {
    let ended = false,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const page = await api<Page>(base);
        if (ended) return;
        setQuestions(page.questions);
        setLoaded(true);
        if (historyOpenRef.current) {
          const historyPage = await api<Page>(base + "?history=true");
          if (ended) return;
          const live = new Set(page.questions.map((q) => q.id));
          const previous = new Map(
            historyRef.current
              .filter((q) => !live.has(q.id))
              .map((q) => [q.id, q.historyOrder]),
          );
          let cursorPage = historyPage,
            incoming = historyPage.questions;
          // Bridge new completions to the existing history window before merging, so pagination stays contiguous.
          while (
            previous.size &&
            cursorPage.hasMore &&
            !cursorPage.questions.some(
              (q) => previous.get(q.id) === q.historyOrder,
            )
          ) {
            cursorPage = await api<Page>(
              base +
                "?history=true&before=" +
                cursorPage.questions.at(-1)!.historyOrder,
            );
            if (ended) return;
            incoming = [...incoming, ...cursorPage.questions];
          }
          setHistory((old) => {
            const merged = new Map(
              old.filter((q) => !live.has(q.id)).map((q) => [q.id, q]),
            );
            for (const q of incoming) merged.set(q.id, q);
            return [...merged.values()].sort(
              (a, b) => (b.historyOrder || 0) - (a.historyOrder || 0),
            );
          });
          setMore((wasMore) =>
            previous.size ? wasMore && cursorPage.hasMore : cursorPage.hasMore,
          );
        }
      } catch (e) {
        if (!ended) setError(String(e));
      }
      if (!ended) timer = setTimeout(poll, 2000);
    }
    poll();
    return () => {
      ended = true;
      clearTimeout(timer);
    };
  }, [base]);
  useEffect(() => {
    if (focusId) {
      setSelected(focusId);
      setDiscussion(false);
    }
  }, [focusId, focusVersion]);
  const selectedSummary = questions.find((q) => q.id === selected);
  const revision = selectedSummary?.revision;
  const deferred = selectedSummary?.deferred;
  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let ended = false;
    api<Question>("/questions/" + selected)
      .then((q) => {
        if (!ended) {
          if (q.managerId !== manager.id)
            throw new Error("Question belongs to a different manager");
          setDetail(q);
          api("/questions/" + q.id, "PATCH", { action: "read" }).catch(
            () => {},
          );
        }
      })
      .catch((e) => {
        if (!ended) setError(String(e));
      });
    return () => {
      ended = true;
    };
  }, [selected, revision, deferred, manager.id]);
  async function answer(
    q: Question,
    version: number,
    body: string,
    choiceId?: string,
  ) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    const signature = JSON.stringify([q.id, version, body, choiceId]);
    if (request.current?.signature !== signature)
      request.current = { signature, id: crypto.randomUUID() };
    try {
      await api("/questions/" + q.id + "/answer", "POST", {
        revision: version,
        answer: body,
        choiceId,
        requestId: request.current.id,
      });
      request.current = null;
      await refresh();
      setSelected(null);
      setDiscussion(false);
      setNotice("Answer recorded for " + q.taskTitle + ".");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refresh().catch(() => {});
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function change(version: number, patch: object) {
    if (!detail || lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const q = await api<Question>("/questions/" + detail.id, "PATCH", {
        revision: version,
        ...patch,
      });
      setDetail(q);
      await refresh();
      if (historyOpen) await loadHistory();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      await refresh().catch(() => {});
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function loadHistory(older = false) {
    if (historyLock.current) return;
    historyLock.current = true;
    setHistoryBusy(true);
    try {
      const page = await api<Page>(
        base +
          "?history=true" +
          (older && history.length
            ? "&before=" + history.at(-1)!.historyOrder
            : ""),
      );
      setHistory((old) => {
        const merged = new Map((older ? old : []).map((q) => [q.id, q]));
        for (const q of page.questions)
          if (!merged.has(q.id) || merged.get(q.id)!.revision <= q.revision)
            merged.set(q.id, q);
        return [...merged.values()].sort(
          (a, b) => (b.historyOrder || 0) - (a.historyOrder || 0),
        );
      });
      setMore(page.hasMore);
    } catch (e) {
      setError(String(e));
    } finally {
      historyLock.current = false;
      setHistoryBusy(false);
    }
  }
  const count = questions.filter(
    (q) => q.status === "open" && !q.deferred,
  ).length;
  const groups = [
    ["waiting", "Waiting on you"],
    ["can-continue", "Can continue"],
    ["later", "Needed later"],
    ["deferred", "Deferred"],
    ["answered", "Answers waiting for agent"],
  ] as const;
  const feature = features.find((f) => f.id === detail?.featureId);
  const showList = () => {
    setSelected(null);
    setDiscussion(false);
    setError("");
  };
  function row(q: Question) {
    return (
      <article className="question-row" key={q.id}>
        <button
          className="question-open"
          onClick={() => {
            setSelected(q.id);
            setDiscussion(false);
            setNotice("");
          }}
        >
          <span className="question-task">
            {q.taskTitle}
            {!q.isRead && <small>Unread</small>}
          </span>
          <strong>{q.title}</strong>
          <span className="question-row-meta">
            {q.status === "answered"
              ? `Answer v${q.answerVersion} recorded`
              : q.status === "applied"
                ? `Applied · v${q.appliedVersion}`
                : q.status === "dismissed"
                  ? "Dismissed"
                  : q.milestone
                    ? "After: " + q.milestone
                    : q.deferUntil && q.deferred
                      ? "Until " + new Date(q.deferUntil).toLocaleString()
                      : stageLabels[q.stage]}
          </span>
        </button>
        {q.status === "open" && !q.deferred && q.choices.length > 0 && (
          <div className="question-quick">
            {q.choices.map((c) => (
              <button
                key={c.id}
                disabled={busy}
                title={c.description || c.label}
                onClick={() => answer(q, q.revision, "", c.id)}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </article>
    );
  }
  return (
    <aside
      className={"needs-you" + (discussion ? " is-discussing" : "")}
      aria-label="Needs you"
    >
      <header className="needs-you-heading">
        <div>
          <h2>
            Needs you <span>{count}</span>
          </h2>
          <p>{manager.name}’s questions across tasks</p>
        </div>
        {selected && (
          <button onClick={discussion ? () => setDiscussion(false) : showList}>
            {discussion ? "Back to question" : "All questions"}
          </button>
        )}
      </header>
      {error && (
        <div className="needs-you-error" role="alert">
          {error}
          <button onClick={() => setError("")}>Dismiss error</button>
        </div>
      )}
      {notice && (
        <p className="needs-you-notice" role="status">
          {notice}
        </p>
      )}
      {selected ? (
        !detail || detail.id !== selected ? (
          <p className="needs-you-loading" role="status">
            Loading question…
          </p>
        ) : discussion && feature ? (
          <>
            <div className="question-discussion-anchor">
              <h3>{detail.title}</h3>
              <p>
                Discuss with {manager.name}. This conversation won’t submit an
                answer.
              </p>
            </div>
            <Conversation
              key={detail.id}
              compact
              feature={feature}
              manager={manager}
              endpoint={"/questions/" + detail.id + "/discussion"}
              storageScope={"soull-question-" + detail.id + "-discussion"}
              openFile={(path, line) => openFile(detail.featureId, path, line)}
              onCopySelection={onCopySelection}
              openTerminal={() => {}}
              briefings={null}
            />
          </>
        ) : (
          <div className="needs-you-scroll">
            <QuestionDetail
              key={detail.id}
              question={detail}
              busy={busy}
              answer={(revision, body, choiceId) =>
                answer(detail, revision, body, choiceId)
              }
              change={change}
              discuss={() => setDiscussion(true)}
            />
          </div>
        )
      ) : (
        <div className="needs-you-scroll">
          {!loaded && (
            <p className="needs-you-loading" role="status">
              Loading questions…
            </p>
          )}
          {loaded && !questions.length && (
            <div className="needs-you-empty">
              <h3>Nothing needs a decision.</h3>
              <p>
                Questions your manager publishes with{" "}
                <code>soull question create</code> stay here until answered or
                dismissed.
              </p>
            </div>
          )}
          {groups.map(([stage, label]) => {
            const rows = questions.filter((q) =>
              stage === "answered"
                ? q.status === "answered"
                : stage === "deferred"
                  ? q.status === "open" && q.deferred
                  : q.status === "open" && !q.deferred && q.stage === stage,
            );
            return rows.length ? (
              <section className={"question-group " + stage} key={stage}>
                <h3>
                  {label}
                  <span>{rows.length}</span>
                </h3>
                {rows.map(row)}
              </section>
            ) : null;
          })}
          <div className="question-history">
            <button
              aria-expanded={historyOpen}
              disabled={historyBusy}
              onClick={() => {
                if (!historyOpen) loadHistory();
                setHistoryOpen(!historyOpen);
              }}
            >
              Answered & dismissed history
            </button>
            {historyOpen && (
              <>
                {history.map(row)}
                {!history.length && (
                  <p className="question-helper">
                    Applied answers and dismissed questions appear here.
                  </p>
                )}
                {more && (
                  <button
                    disabled={historyBusy}
                    onClick={() => loadHistory(true)}
                  >
                    Load earlier questions
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </aside>
  );
}
