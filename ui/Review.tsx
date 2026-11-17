import { useEffect, useState, useRef } from "react";
import { api, type Feature, type Changes } from "./api";
import { Explanation } from "./Explanation";
type FileContent = { path: string; content: string; version: string };
export function Review({
  feature,
  mode,
  onError,
  onDirty,
  initialFile,
  onDiscuss,
}: {
  feature: Feature;
  mode: "review" | "code";
  onError: (e: unknown) => void;
  onDirty: (dirty: boolean) => void;
  onDiscuss: (prompt: string) => void;
  initialFile?: { path: string; line: number } | null;
}) {
  const [changes, setChanges] = useState<Changes | null>(null),
    [refreshKey, setRefreshKey] = useState(0),
    [files, setFiles] = useState<string[]>([]),
    [selected, setSelected] = useState(""),
    [diff, setDiff] = useState(""),
    [diffRevision, setDiffRevision] = useState<string | null>(null),
    [file, setFile] = useState<FileContent | null>(null),
    [draft, setDraft] = useState(""),
    [editing, setEditing] = useState(mode === "code"),
    [saved, setSaved] = useState(false),
    [loading, setLoading] = useState(false),
    [saving, setSaving] = useState(false),
    [reviewed, setReviewed] = useState<Record<string, string>>({});
  const editor = useRef<HTMLTextAreaElement>(null);
  const selectedRef = useRef("");
  const dirtyRef = useRef(false);
  const generation = useRef(0),
    dirty = !!file && draft !== file.content;
  dirtyRef.current = dirty;
  useEffect(() => {
    onDirty(dirty);
    return () => onDirty(false);
  }, [dirty]);
  async function refresh() {
    try {
      const [data, tree] = await Promise.all([
        api<Changes>("/features/" + feature.id + "/changes"),
        api<{ files: string[] }>("/features/" + feature.id + "/files"),
      ]);
      setChanges(data);
      setRefreshKey((k) => k + 1);
      setFiles(tree.files);
      const currentPath = selectedRef.current,
        sequence = generation.current;
      if (currentPath && !dirtyRef.current) {
        if (data.files.some((f) => f.path === currentPath)) {
          const result = await api<{
            diff: string;
            revision: string | null;
            readable?: boolean;
          }>(
            "/features/" +
              feature.id +
              "/diff?path=" +
              encodeURIComponent(currentPath),
          );
          if (sequence === generation.current) {
            setDiff(result.diff);
            setDiffRevision(result.revision);
          }
        } else setDiff("");
      }
      return data;
    } catch (e) {
      onError(e);
    }
  }
  useEffect(() => {
    refresh();
  }, [feature.id]);
  useEffect(() => {
    if (!selected) {
      const first =
        initialFile?.path ||
        (mode === "code" ? files[0] : changes?.files[0]?.path);
      if (first) open(first);
    }
  }, [changes, files]);
  useEffect(() => {
    if (mode === "code") setEditing(true);
  }, [mode]);
  useEffect(() => {
    if (initialFile && selected !== initialFile.path) open(initialFile.path);
  }, [initialFile?.path]);
  useEffect(() => {
    if (file && initialFile?.path === file.path && editor.current) {
      const position =
        file.content
          .split("\n")
          .slice(0, Math.max(0, initialFile.line - 1))
          .join("\n").length + (initialFile.line > 1 ? 1 : 0);
      editor.current.focus();
      editor.current.setSelectionRange(position, position);
      editor.current.scrollTop = Math.max(0, initialFile.line - 4) * 23;
    }
  }, [file?.path, loading]);
  async function open(relative: string) {
    if (
      dirty &&
      !confirm("Discard your unsaved edits before opening another file?")
    )
      return;
    const sequence = ++generation.current;
    setSelected(relative);
    selectedRef.current = relative;
    setLoading(true);
    setSaved(false);
    setFile(null);
    setDiff("");
    setDiffRevision(null);
    try {
      if (changes?.files.some((f) => f.path === relative)) {
        const result = await api<{
          diff: string;
          revision: string | null;
          readable?: boolean;
        }>(
          "/features/" +
            feature.id +
            "/diff?path=" +
            encodeURIComponent(relative),
        );
        if (sequence === generation.current) {
          setDiff(result.diff);
          setDiffRevision(result.revision);
        }
        if (
          result.readable === false ||
          /^deleted file mode /m.test(result.diff)
        )
          return;
      }
      const data = await api<FileContent>(
        "/features/" +
          feature.id +
          "/file?path=" +
          encodeURIComponent(relative),
      );
      if (sequence === generation.current) {
        setFile(data);
        setDraft(data.content);
      }
    } catch (e) {
      if (sequence === generation.current) onError(e);
    } finally {
      if (sequence === generation.current) setLoading(false);
    }
  }
  async function save() {
    if (!file) return;
    setSaving(true);
    try {
      const data = await api<FileContent>(
        "/features/" + feature.id + "/file",
        "PUT",
        { ...file, content: draft },
      );
      setFile(data);
      setSaved(true);
      await refresh();
      const result = await api<{
        diff: string;
        revision: string | null;
        readable?: boolean;
      }>(
        "/features/" +
          feature.id +
          "/diff?path=" +
          encodeURIComponent(selected),
      );
      setDiff(result.diff);
      setDiffRevision(result.revision);
    } catch (e) {
      onError(e);
    } finally {
      setSaving(false);
    }
  }
  const changed = changes?.files || [],
    categories = [...new Set(changed.map((f) => f.category))].sort();
  const list =
    mode === "code"
      ? files.map((path) => ({ path, category: "Files", untracked: false }))
      : changed;
  const groups = mode === "code" ? ["Files"] : categories;
  return (
    <section className="review-layout">
      <aside className="file-nav">
        <div className="file-nav-heading">
          <strong>
            {mode === "code"
              ? "Workspace files"
              : `${changed.length} changed files`}
          </strong>
          <button title="Refresh changes" onClick={refresh}>
            ↻
          </button>
        </div>
        {mode === "review" && (
          <p className="muted tiny">
            Grouped by category.
            <br />
            Guided flow order is coming next.
          </p>
        )}
        {groups.map((group) => (
          <div className="file-group" key={group}>
            <h3>{group}</h3>
            {list
              .filter((f) => f.category === group)
              .map((f) => (
                <button
                  title={f.path}
                  className={
                    "file-row " + (selected === f.path ? "selected" : "")
                  }
                  key={f.path}
                  onClick={() => open(f.path)}
                >
                  <span>
                    {reviewed[f.path] === diff && selected === f.path
                      ? "✓"
                      : f.untracked
                        ? "+"
                        : "·"}
                  </span>
                  <span>
                    {f.path.split("/").at(-1)}
                    <small>
                      {f.path.includes("/")
                        ? f.path.slice(0, f.path.lastIndexOf("/"))
                        : "Repository root"}
                    </small>
                  </span>
                </button>
              ))}
          </div>
        ))}
        {!list.length && (
          <p className="muted">
            No changes yet. Work in the terminal, then refresh.
          </p>
        )}
      </aside>
      <div className="review-main">
        {mode === "code" && (
          <div className="review-summary">
            <span className="eyebrow">
              {mode === "code" ? "SOURCE EDITOR" : "WORKING CHANGE"}
            </span>
            <h2>{feature.title}</h2>
            <p className="muted">
              {mode === "code"
                ? "Edit text files inside this feature’s isolated worktree."
                : "Review the working diff with revision-bound AI guidance."}
            </p>
          </div>
        )}
        {mode === "review" && (
          <Explanation
            featureId={feature.id}
            selected={selected}
            dirty={dirty}
            refreshKey={refreshKey}
            diffRevision={diffRevision}
            discuss={onDiscuss}
          />
        )}
        {selected ? (
          <>
            <div className="editor-toolbar">
              <code title={selected}>{selected}</code>
              <div>
                <button
                  disabled={loading || !file}
                  className={editing ? "selected" : ""}
                  onClick={() => {
                    if (
                      !editing ||
                      !dirty ||
                      confirm("Keep edits in the editor and show the diff?")
                    )
                      setEditing(!editing);
                  }}
                >
                  {editing ? "Show diff" : "Edit file"}
                </button>
                {editing && (
                  <button
                    className="primary"
                    disabled={!dirty || saving}
                    onClick={save}
                  >
                    {saving ? "Saving…" : "Save changes"}
                  </button>
                )}
              </div>
            </div>
            {loading ? (
              <p className="loading">Opening file…</p>
            ) : editing && file ? (
              <div className="source-wrap">
                <textarea
                  ref={editor}
                  className="source-editor"
                  aria-label={"Edit " + selected}
                  spellCheck={false}
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setSaved(false);
                  }}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
                      e.preventDefault();
                      save();
                    }
                  }}
                />
              </div>
            ) : (
              <div className="diff-code" role="region" aria-label="File diff">
                <pre>
                  {(diff || "No working changes in this file.")
                    .split("\n")
                    .map((line, i) => (
                      <span
                        key={i}
                        className={
                          line.startsWith("+++") || line.startsWith("---")
                            ? "diff-meta"
                            : line.startsWith("+")
                              ? "addition"
                              : line.startsWith("-")
                                ? "deletion"
                                : line.startsWith("@@")
                                  ? "diff-hunk"
                                  : ""
                        }
                      >
                        <i>{i + 1}</i>
                        {line || " "}
                      </span>
                    ))}
                </pre>
              </div>
            )}
            <div className="evidence-strip">
              <div>
                <strong>
                  {saved
                    ? "✓ Saved to worktree"
                    : dirty
                      ? "Unsaved changes"
                      : "Test evidence unavailable"}
                </strong>
                <p>
                  {saved
                    ? "The working diff has been refreshed."
                    : dirty
                      ? "Save before switching features or leaving the editor."
                      : "Related-test mapping and revision-bound results will arrive in the Guided diff slice."}
                </p>
              </div>
              {mode === "review" && (
                <button
                  disabled={!diff}
                  onClick={() => setReviewed({ ...reviewed, [selected]: diff })}
                >
                  {reviewed[selected] === diff ? "✓ Reviewed" : "Mark reviewed"}
                </button>
              )}
            </div>
          </>
        ) : (
          <div className="empty">
            <h2>A clear view of your changes</h2>
            <p>Files appear here when the feature worktree changes.</p>
          </div>
        )}
        <footer className="pane-footer">
          <span>{feature.branch}</span>
          <span>{changes?.head || "Reading Git…"} · local worktree</span>
        </footer>
      </div>
    </section>
  );
}
