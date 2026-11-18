import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Markdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type Feature, type Manager } from "./api";
import { Robot } from "./Robot";
import "./conversation.css";

type Block = {
  id: string;
  kind: "message" | "activity" | "approval";
  text: string;
  title?: string;
  phase?: string;
  group?: string;
  status?: string;
  requestId?: string;
  summary?: string;
  canAccept?: boolean;
};
type Turn = {
  id: string;
  ordinal: number;
  prompt: string;
  status: string;
  error: string;
  provider: string;
  created: string;
  updated: number;
  blocks: Block[];
};
type Page = { turns: Turn[]; cursor: number; hasOlder: boolean };
const live = (turn: Turn) =>
  ["queued", "running", "waiting"].includes(turn.status);
const fileTarget = (href: string) =>
  /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))([\w.@ /-]+?)(?::(\d+))?$/.exec(href);
const plugins = [remarkGfm];
const statusText: Record<string, string> = {
  queued: "Queued",
  running: "Working",
  waiting: "Needs your approval",
  completed: "Complete",
  failed: "Failed",
  interrupted: "Stopped",
};

const Reply = memo(function Reply({
  text,
  streaming,
  openFile,
}: {
  text: string;
  streaming: boolean;
  openFile: (path: string, line: number) => void;
}) {
  // Streaming stays plain text. Parse Markdown once the turn settles, rather than on every token.
  if (streaming) return <div className="chat-prose streaming-text">{text}</div>;
  return (
    <div className="chat-prose">
      <Markdown
        remarkPlugins={plugins}
        urlTransform={(url) =>
          fileTarget(url) ? url : defaultUrlTransform(url)
        }
        components={{
          a: ({ href = "", children }) => {
            const file = fileTarget(href);
            return file ? (
              <button
                className="file-link"
                onClick={() => openFile(file[1], Number(file[2] || 1))}
              >
                {children}
              </button>
            ) : /^https?:\/\//.test(href) ? (
              <a href={href} target="_blank" rel="noreferrer">
                {children}
              </a>
            ) : (
              <span>{children}</span>
            );
          },
          img: ({ alt }) => (
            <span className="muted">{alt ? `[Image: ${alt}]` : "[Image]"}</span>
          ),
          pre: ({ children }) => <pre tabIndex={0}>{children}</pre>,
        }}
      >
        {text}
      </Markdown>
    </div>
  );
});

const Exchange = memo(function Exchange({
  turn,
  name,
  read,
  onRead,
  onCancel,
  onApproval,
  openFile,
  copyText,
  retry,
}: {
  turn: Turn;
  name: string;
  read: boolean;
  onRead: (id: string) => void;
  onCancel: (id: string) => void;
  onApproval: (id: string, requestId: string, decision: string) => void;
  openFile: (path: string, line: number) => void;
  copyText: (text?: string) => void;
  retry: (text: string) => void;
}) {
  const allMessages = turn.blocks.filter((b) => b.kind === "message" && b.text);
  const finals = allMessages.filter((b) => b.phase === "final_answer");
  const last = allMessages.at(-1);
  const messages = finals.length
    ? finals
    : last?.group
      ? allMessages.filter((b) => b.group === last.group)
      : allMessages.slice(-1);
  const progress = allMessages.filter((b) => !messages.includes(b));
  const activity = turn.blocks.filter((b) => b.kind === "activity");
  const approvals = turn.blocks.filter((b) => b.kind === "approval");
  const [approvalBusy, setApprovalBusy] = useState(false);
  return (
    <article
      className="chat-exchange"
      data-turn-id={turn.id}
      data-ordinal={turn.ordinal}
      aria-label={`Message from ${new Date(turn.created).toLocaleString()}`}
    >
      <div className="chat-user">
        <div className="chat-speaker">
          <strong>You</strong>
          <time>
            {new Date(turn.created).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </time>
        </div>
        <div className="chat-prompt">{turn.prompt}</div>
      </div>
      <div className="chat-answer">
        <div className="chat-speaker">
          <strong>{name}</strong>
          <span className={live(turn) ? "chat-state active" : "chat-state"}>
            {statusText[turn.status] || turn.status}
          </span>
          {!live(turn) && messages.length > 0 && !read && (
            <span className="chat-unread">Unread</span>
          )}
          {live(turn) && (
            <button
              className="chat-text-button"
              onClick={() => onCancel(turn.id)}
            >
              {turn.status === "queued" ? "Cancel" : "Stop"}
            </button>
          )}
        </div>
        {messages.map((b) => (
          <Reply
            key={b.id}
            text={b.text}
            streaming={live(turn)}
            openFile={openFile}
          />
        ))}
        {!messages.length && live(turn) && (
          <p className="muted">
            {turn.status === "queued"
              ? "This message will run after the current reply."
              : "Waiting for the provider’s response…"}
          </p>
        )}
        {approvals.map((b) => (
          <section
            className="chat-approval"
            key={b.id}
            aria-label="Tool approval"
          >
            <strong>{b.title}</strong>
            {b.summary && <p className="chat-approval-summary">{b.summary}</p>}
            <details>
              <summary>Inspect request</summary>
              <pre>{b.text}</pre>
            </details>
            {b.status === "waiting" ? (
              <div className="chat-actions">
                <button
                  disabled={approvalBusy || b.canAccept === false}
                  onClick={async () => {
                    setApprovalBusy(true);
                    try {
                      await onApproval(turn.id, b.requestId!, "accept");
                    } finally {
                      setApprovalBusy(false);
                    }
                  }}
                >
                  Allow once
                </button>
                <button
                  disabled={approvalBusy}
                  onClick={async () => {
                    setApprovalBusy(true);
                    try {
                      await onApproval(turn.id, b.requestId!, "decline");
                    } finally {
                      setApprovalBusy(false);
                    }
                  }}
                >
                  Deny
                </button>
              </div>
            ) : (
              <small>{b.status}</small>
            )}
          </section>
        ))}
        {progress.length > 0 && (
          <details className="chat-activity">
            <summary>Earlier updates from {name}</summary>
            {progress.map((b) => (
              <Reply
                key={b.id}
                text={b.text}
                streaming={live(turn)}
                openFile={openFile}
              />
            ))}
          </details>
        )}
        {activity.length > 0 && (
          <details className="chat-activity">
            <summary>
              {activity.length}{" "}
              {activity.length === 1 ? "activity" : "activities"} · inspect
              tools and evidence
            </summary>
            <div>
              {activity.map((b) => (
                <details key={b.id}>
                  <summary>
                    {b.title || "Tool result"} <span>{b.status}</span>
                  </summary>
                  <pre>{b.text || "No output reported."}</pre>
                </details>
              ))}
            </div>
          </details>
        )}
        {turn.error && (
          <p className="chat-turn-error" role="alert">
            {turn.error}
          </p>
        )}
        {!live(turn) && (
          <div className="chat-actions">
            {messages.length > 0 && (
              <>
                <button
                  onClick={() =>
                    copyText(messages.map((b) => b.text).join("\n\n"))
                  }
                >
                  Copy reply
                </button>
                <button onClick={() => onRead(turn.id)}>
                  {read ? "Mark unread" : "Mark read"}
                </button>
              </>
            )}
            {["failed", "interrupted"].includes(turn.status) && (
              <button onClick={() => retry(turn.prompt)}>
                Edit and resend
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
});

export function Conversation({
  feature,
  manager,
  openFile,
  onCopySelection,
  briefings,
  openTerminal,
  findingFocus,
  endpoint,
  storageScope,
  compact = false,
}: {
  feature: Feature;
  manager: Manager;
  endpoint?: string;
  storageScope?: string;
  compact?: boolean;
  openFile: (path: string, line: number) => void;
  onCopySelection: () => void;
  briefings: ReactNode;
  findingFocus?: string | null;
  openTerminal: () => void;
}) {
  const base = endpoint || "/features/" + feature.id + "/conversation";
  const key = storageScope || "soull-chat-" + feature.id;
  const inputId = "chat-message-" + (storageScope || feature.id);
  const [turns, setTurns] = useState<Turn[]>([]),
    [draft, setDraft] = useState(
      () => localStorage.getItem(key + "-draft") || "",
    ),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false),
    [hasOlder, setHasOlder] = useState(false),
    [olderBusy, setOlderBusy] = useState(false),
    [away, setAway] = useState(false),
    [copied, setCopied] = useState(false),
    [readIds, setReadIds] = useState<string[]>(() => {
      try {
        return JSON.parse(localStorage.getItem(key + "-read") || "[]");
      } catch {
        return [];
      }
    });
  const scroll = useRef<HTMLDivElement>(null),
    input = useRef<HTMLTextAreaElement>(null),
    pinned = useRef(true),
    cursor = useRef(0),
    active = useRef(false),
    restore = useRef<{
      id?: string;
      ordinal?: number;
      offset?: number;
      bottom?: boolean;
    } | null>(
      (() => {
        try {
          return JSON.parse(
            sessionStorage.getItem(key + "-position") || "null",
          );
        } catch {
          return null;
        }
      })(),
    ),
    initial = useRef(true),
    sendLock = useRef(false),
    request = useRef<{ text: string; id: string } | null>(null),
    prepend = useRef<{ height: number; top: number } | null>(null);
  const writeDraft = useCallback(
    (text: string) => {
      setDraft(text);
      localStorage.setItem(key + "-draft", text);
    },
    [key],
  );
  const merge = useCallback((updates: Turn[]) => {
    if (!updates.length) return;
    setTurns((old) => {
      const map = new Map(old.map((t) => [t.id, t]));
      for (const t of updates)
        if (!map.has(t.id) || map.get(t.id)!.updated < t.updated)
          map.set(t.id, t);
      return [...map.values()].sort((a, b) => a.ordinal - b.ordinal);
    });
  }, []);
  useEffect(() => {
    let cancelled = false,
      timer: ReturnType<typeof setTimeout>;
    async function poll() {
      let delay = 1800;
      try {
        const page = await api<Page>(
          base + (cursor.current ? "?after=" + cursor.current : ""),
        );
        if (cancelled) return;
        if (!cursor.current) {
          let oldest = page;
          // Hydrate through the saved visible turn before restoring its relative offset.
          // Normal opens still fetch only 30 turns; older pages load only to restore an explicit reading position.
          while (
            restore.current?.ordinal &&
            oldest.hasOlder &&
            oldest.turns[0]?.ordinal > restore.current.ordinal
          ) {
            oldest = await api<Page>(
              base + "?before=" + oldest.turns[0].ordinal,
            );
            if (cancelled) return;
            page.turns = [...oldest.turns, ...page.turns];
          }
          setHasOlder(oldest.hasOlder);
        }
        cursor.current = page.cursor;
        merge(page.turns);
        setLoaded(true);
        setError("");
        if (page.turns.length) active.current = page.turns.some(live);
        if (active.current) delay = 250;
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
      if (!cancelled) timer = setTimeout(poll, document.hidden ? 5000 : delay);
    }
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [base, merge]);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el || !loaded) return;
    if (prepend.current) {
      el.scrollTop =
        prepend.current.top + el.scrollHeight - prepend.current.height;
      prepend.current = null;
    } else if (initial.current) {
      const saved = restore.current;
      const anchor = saved?.id
        ? el.querySelector<HTMLElement>(`[data-turn-id="${saved.id}"]`)
        : null;
      if (anchor && !saved?.bottom)
        el.scrollTop +=
          anchor.getBoundingClientRect().top -
          el.getBoundingClientRect().top -
          (saved?.offset || 0);
      else el.scrollTop = el.scrollHeight;
      initial.current = false;
      pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 70;
      setAway(!pinned.current);
    } else if (pinned.current) el.scrollTop = el.scrollHeight;
  }, [turns, loaded, key]);
  useEffect(() => {
    if (loaded && findingFocus) {
      pinned.current = false;
      document
        .getElementById("finding-" + findingFocus)
        ?.scrollIntoView({ block: "center" });
    }
  }, [loaded, findingFocus]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const onRead = useCallback(
    (id: string) =>
      setReadIds((ids) => {
        const next = ids.includes(id)
          ? ids.filter((x) => x !== id)
          : [...ids, id];
        localStorage.setItem(key + "-read", JSON.stringify(next));
        return next;
      }),
    [key],
  );
  const copyText = useCallback(async (text?: string) => {
    if (!text) return;
    try {
      const native = (window as any).webkit?.messageHandlers?.clipboard;
      if (native) native.postMessage(text);
      else await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setError("Could not copy. Select the reply and use Copy.");
    }
  }, []);
  const cancel = useCallback(
    async (id: string) => {
      try {
        await api(base + "/" + id + "/cancel", "POST");
      } catch (e) {
        setError(String(e));
      }
    },
    [base],
  );
  const approve = useCallback(
    async (id: string, requestId: string, decision: string) => {
      try {
        await api(base + "/" + id + "/approval", "POST", {
          requestId,
          decision,
        });
      } catch (e) {
        setError(String(e));
      }
    },
    [base],
  );
  const retry = useCallback(
    (text: string) => {
      writeDraft(text);
      input.current?.focus();
    },
    [writeDraft],
  );
  async function send() {
    const text = draft.trim();
    if (!text || sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    setError("");
    // Reuse the ID after a lost response so retrying cannot enqueue the same prompt twice.
    if (request.current?.text !== text)
      request.current = { text, id: crypto.randomUUID() };
    try {
      const turn = await api<Turn>(base, "POST", {
        prompt: text,
        requestId: request.current.id,
      });
      merge([turn]);
      request.current = null;
      setDraft((current) => {
        if (current.trim() === text) {
          localStorage.removeItem(key + "-draft");
          return "";
        }
        return current;
      });
      pinned.current = true;
      setAway(false);
      input.current?.focus();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  }
  async function older() {
    if (!scroll.current || olderBusy) return;
    setOlderBusy(true);
    try {
      const page = await api<Page>(base + "?before=" + turns[0].ordinal);
      prepend.current = {
        height: scroll.current.scrollHeight,
        top: scroll.current.scrollTop,
      };
      merge(page.turns);
      setHasOlder(page.hasOlder);
    } catch (e) {
      setError(String(e));
    } finally {
      setOlderBusy(false);
    }
  }
  const outstanding = turns.filter(live).length;
  return (
    <section
      className="rich-conversation"
      aria-label={
        compact
          ? `Question discussion with ${manager.name}`
          : `Conversation with ${manager.name}`
      }
    >
      {!compact && (
        <header className="chat-heading">
          <Robot name={manager.name} size={34} />
          <div>
            <h2>{manager.name}</h2>
            <p>
              {manager.provider === "codex" ? "Codex" : "Claude Code"} ·{" "}
              {feature.title}
            </p>
          </div>
          <button onClick={openTerminal}>Open terminal</button>
        </header>
      )}
      <div
        ref={scroll}
        className="chat-scroll"
        tabIndex={0}
        aria-label="Conversation history"
        onMouseUp={onCopySelection}
        onScroll={() => {
          const el = scroll.current!;
          pinned.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 70;
          setAway(!pinned.current);
          const top = el.getBoundingClientRect().top;
          const visible = [
            ...el.querySelectorAll<HTMLElement>("[data-turn-id]"),
          ].find((node) => node.getBoundingClientRect().bottom > top);
          sessionStorage.setItem(
            key + "-position",
            JSON.stringify({
              bottom: pinned.current,
              id: visible?.dataset.turnId,
              ordinal: Number(visible?.dataset.ordinal),
              offset: visible ? visible.getBoundingClientRect().top - top : 0,
            }),
          );
        }}
      >
        <div className="chat-column">
          {!loaded && !error && (
            <p className="muted" role="status">
              Loading conversation…
            </p>
          )}
          {hasOlder && (
            <button className="chat-load" disabled={olderBusy} onClick={older}>
              {olderBusy ? "Loading…" : "Load earlier messages"}
            </button>
          )}
          {loaded && !turns.length && (
            <div className="chat-empty">
              <h2>
                {compact
                  ? "Explore this decision."
                  : "A conversation you can come back to."}
              </h2>
              <p>
                {compact
                  ? `Talk through the tradeoffs with ${manager.name}. Return to the question when you’re ready to give an answer.`
                  : `Ask ${manager.name} about this feature, explore an approach, or start the work. Your replies and findings stay with this workspace.`}
              </p>
              {!compact && (
                <p className="muted">
                  Sign in with your subscription in the installed{" "}
                  {manager.provider === "codex" ? "Codex" : "Claude Code"} CLI
                  first. Soull uses that CLI’s authentication and permissions.
                </p>
              )}
            </div>
          )}
          {turns.map((turn) => (
            <Exchange
              key={turn.id}
              turn={turn}
              name={manager.name}
              read={readIds.includes(turn.id)}
              onRead={onRead}
              onCancel={cancel}
              onApproval={approve}
              openFile={openFile}
              copyText={copyText}
              retry={retry}
            />
          ))}
          {!compact && (
            <details
              className="chat-briefings"
              open={findingFocus ? true : undefined}
            >
              <summary>Durable findings and questions</summary>
              {briefings}
            </details>
          )}
        </div>
      </div>
      {away && (
        <button
          className="chat-jump"
          onClick={() => {
            pinned.current = true;
            scroll.current!.scrollTop = scroll.current!.scrollHeight;
            setAway(false);
          }}
        >
          Jump to latest
        </button>
      )}
      <div className="chat-compose-wrap">
        <div className="chat-column">
          {error && (
            <p className="chat-error" role="alert">
              {error} <button onClick={() => setError("")}>Dismiss</button>
            </p>
          )}
          <form
            className="chat-compose"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <label className="sr-only" htmlFor={inputId}>
              Message {manager.name}
            </label>
            <textarea
              id={inputId}
              ref={input}
              value={draft}
              maxLength={30000}
              rows={3}
              placeholder={`Message ${manager.name}…`}
              onChange={(e) => writeDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing
                ) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <div className="chat-compose-footer">
              <span>
                {outstanding
                  ? `${outstanding} outstanding · new messages queue in order`
                  : "Enter to send · Shift + Enter for a new line"}
              </span>
              <button
                className="primary"
                disabled={!loaded || !draft.trim() || sending}
                type="submit"
              >
                {sending
                  ? "Sending…"
                  : outstanding
                    ? "Queue message"
                    : "Send message"}
              </button>
            </div>
          </form>
          <p className="chat-provider-note">
            {manager.provider === "claude"
              ? "Tools needing new permission may be denied by Claude Code. Continue in Terminal to grant access."
              : "Codex requests command and file approvals here when needed."}
          </p>
        </div>
      </div>
      <span className="sr-only" role="status">
        {copied
          ? "Reply copied"
          : outstanding
            ? `${outstanding} messages outstanding`
            : "Ready"}
      </span>
      {copied && (
        <div className="toast" role="status">
          Reply copied
        </div>
      )}
    </section>
  );
}
