import { randomUUID } from "node:crypto";

// Separate tables keep transcript hydration out of the frequently polled app snapshot.
export class ChatStore {
  constructor(db, namespace = "") {
    if (!["", "question_"].includes(namespace))
      throw new Error("Unknown conversation namespace");
    this.db = db;
    const sqlFor = (sql) =>
      sql
        .replace(
          /\b(conversations|chat_clock|chat_turns|chat_feature|chat_updates)\b/g,
          (name) => namespace + name,
        )
        .replace(
          /REFERENCES features\(id\)/g,
          namespace ? "REFERENCES questions(id)" : "REFERENCES features(id)",
        );
    this.prepare = (sql) => db.prepare(sqlFor(sql));
    this.exec = (sql) => db.exec(sqlFor(sql));
    this.exec(`CREATE TABLE IF NOT EXISTS conversations (
      featureId TEXT PRIMARY KEY REFERENCES features(id), provider TEXT NOT NULL, sessionId TEXT);
      CREATE TABLE IF NOT EXISTS chat_clock (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL);
      INSERT OR IGNORE INTO chat_clock VALUES (1,0);
      CREATE TABLE IF NOT EXISTS chat_turns (
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        featureId TEXT NOT NULL REFERENCES features(id), requestId TEXT NOT NULL,
        provider TEXT NOT NULL, prompt TEXT NOT NULL, status TEXT NOT NULL,
        blocks TEXT NOT NULL DEFAULT '[]', error TEXT NOT NULL DEFAULT '',
        created TEXT NOT NULL, updated INTEGER NOT NULL, UNIQUE(featureId,requestId));
      CREATE INDEX IF NOT EXISTS chat_feature ON chat_turns(featureId,ordinal);
      CREATE INDEX IF NOT EXISTS chat_updates ON chat_turns(featureId,updated);`);
    // Never silently replay execution after a supervisor crash.
    for (const row of this.prepare(
      "SELECT id FROM chat_turns WHERE status IN ('queued','running','waiting')",
    ).all())
      this.update(row.id, {
        blocks: this.get(row.id).blocks.map((b) =>
          b.kind === "approval" && b.status === "waiting"
            ? { ...b, status: "expired" }
            : b,
        ),
        status: "interrupted",
        error:
          "The service stopped. Send a new message to continue; this request was not replayed.",
      });
  }
  decode(row) {
    return row ? { ...row, blocks: JSON.parse(row.blocks) } : null;
  }
  clock() {
    return this.prepare("SELECT value FROM chat_clock WHERE id=1").get().value;
  }
  tick() {
    return this.prepare(
      "UPDATE chat_clock SET value=value+1 WHERE id=1 RETURNING value",
    ).get().value;
  }
  get(id) {
    return this.decode(
      this.prepare("SELECT * FROM chat_turns WHERE id=?").get(id),
    );
  }
  existing(featureId, requestId) {
    return this.decode(
      this.prepare(
        "SELECT * FROM chat_turns WHERE featureId=? AND requestId=?",
      ).get(featureId, requestId),
    );
  }
  add(featureId, provider, prompt, requestId) {
    const id = randomUUID();
    this.prepare(
      "INSERT INTO chat_turns (id,featureId,requestId,provider,prompt,status,created,updated) VALUES (?,?,?,?,?,'queued',?,?)",
    ).run(
      id,
      featureId,
      requestId,
      provider,
      prompt,
      new Date().toISOString(),
      this.tick(),
    );
    return this.get(id);
  }
  update(id, patch) {
    const turn = { ...this.get(id), ...patch };
    this.prepare(
      "UPDATE chat_turns SET status=?,blocks=?,error=?,updated=? WHERE id=?",
    ).run(
      turn.status,
      JSON.stringify(turn.blocks),
      turn.error,
      this.tick(),
      id,
    );
    return turn;
  }
  session(featureId) {
    return this.prepare("SELECT * FROM conversations WHERE featureId=?").get(
      featureId,
    );
  }
  setSession(featureId, provider, id) {
    this.prepare(
      "INSERT INTO conversations VALUES (?,?,?) ON CONFLICT(featureId) DO UPDATE SET sessionId=excluded.sessionId,provider=excluded.provider",
    ).run(featureId, provider, id);
  }
  queued(featureId) {
    return this.prepare(
      "SELECT id FROM chat_turns WHERE featureId=? AND status='queued' ORDER BY ordinal",
    ).all(featureId);
  }
  activeCount() {
    return this.prepare(
      "SELECT count(*) AS n FROM chat_turns WHERE status IN ('queued','running','waiting')",
    ).get().n;
  }
  page(featureId, { after = 0, before = 0 } = {}) {
    const cursor = this.clock();
    // Update polls carry only changed turns, never the whole transcript.
    const rows = after
      ? this.prepare(
          "SELECT * FROM chat_turns WHERE featureId=? AND updated>? ORDER BY updated LIMIT 50",
        ).all(featureId, after)
      : this.prepare(
          "SELECT * FROM chat_turns WHERE featureId=? AND ordinal<? ORDER BY ordinal DESC LIMIT 30",
        )
          .all(featureId, before || Number.MAX_SAFE_INTEGER)
          .reverse();
    const oldest = rows[0]?.ordinal;
    return {
      turns: rows.map((r) => this.decode(r)),
      cursor: after && rows.length === 50 ? rows.at(-1).updated : cursor,
      hasOlder:
        !after &&
        !!oldest &&
        !!this.prepare(
          "SELECT 1 FROM chat_turns WHERE featureId=? AND ordinal<? LIMIT 1",
        ).get(featureId, oldest),
    };
  }
}
