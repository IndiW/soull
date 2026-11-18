import { randomUUID, createHash } from "node:crypto";
const fail = (message, status = 400) =>
  Object.assign(new Error(message), { status });
const string = (value, name, max = 200, optional = false) => {
  if (optional && (value === undefined || value === null || value === ""))
    return "";
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > max ||
    value.includes("\0")
  )
    throw fail(`Invalid ${name}`);
  return value.trim();
};
const integer = (value, name) => {
  if (!Number.isSafeInteger(value) || value < 1) throw fail(`Invalid ${name}`);
  return value;
};
const stages = ["waiting", "can-continue", "later"];
export class Questions {
  constructor(store) {
    this.store = store;
    this.db = store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS question_tasks (
      id TEXT PRIMARY KEY, featureId TEXT NOT NULL REFERENCES features(id), title TEXT NOT NULL, created TEXT NOT NULL, origin TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS questions (
        ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        taskId TEXT NOT NULL REFERENCES question_tasks(id), title TEXT NOT NULL, context TEXT NOT NULL,
        reason TEXT NOT NULL, recommendation TEXT NOT NULL, choices TEXT NOT NULL,
        stage TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', revision INTEGER NOT NULL DEFAULT 1,
        answer TEXT NOT NULL DEFAULT '', answerVersion INTEGER NOT NULL DEFAULT 0, appliedVersion INTEGER NOT NULL DEFAULT 0,
        deferUntil TEXT, milestone TEXT, isRead INTEGER NOT NULL DEFAULT 0,
        dismissReason TEXT NOT NULL DEFAULT '', closedOrder INTEGER, created TEXT NOT NULL, updated TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS question_history_clock (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL);
      INSERT OR IGNORE INTO question_history_clock VALUES (1,0);
      CREATE INDEX IF NOT EXISTS question_scope ON questions(taskId,status,ordinal);
      CREATE TABLE IF NOT EXISTS question_answers (
        questionId TEXT NOT NULL REFERENCES questions(id), version INTEGER NOT NULL,
        requestId TEXT NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL, applied TEXT,
        PRIMARY KEY(questionId,version), UNIQUE(questionId,requestId));`);
    if (
      !this.db
        .prepare("PRAGMA table_info(question_tasks)")
        .all()
        .some((c) => c.name === "origin")
    )
      this.db.exec(
        "ALTER TABLE question_tasks ADD COLUMN origin TEXT NOT NULL DEFAULT ''",
      );
    if (
      !this.db
        .prepare("PRAGMA table_info(questions)")
        .all()
        .some((c) => c.name === "closedOrder")
    )
      this.db.exec("ALTER TABLE questions ADD COLUMN closedOrder INTEGER");
    // Adopt legacy structured question findings exactly once; resolution is not evidence of an applied answer.
    for (const f of this.db
      .prepare("SELECT * FROM findings WHERE kind='question'")
      .all())
      this.adopt(f);
    for (const q of this.db
      .prepare(
        "SELECT id FROM questions WHERE status IN ('applied','dismissed') AND closedOrder IS NULL ORDER BY updated,id",
      )
      .all())
      this.db
        .prepare("UPDATE questions SET closedOrder=? WHERE id=?")
        .run(this.nextHistory(), q.id);
  }
  nextHistory() {
    return this.db
      .prepare(
        "UPDATE question_history_clock SET value=value+1 WHERE id=1 RETURNING value",
      )
      .get().value;
  }
  task(id) {
    const task = this.db
      .prepare("SELECT * FROM question_tasks WHERE id=?")
      .get(id);
    if (!task) throw fail("Task not found", 404);
    return task;
  }
  createTask(featureId, title, id = randomUUID(), origin = "") {
    this.store.feature(featureId);
    this.db
      .prepare(
        "INSERT INTO question_tasks (id,featureId,title,created,origin) VALUES (?,?,?,?,?)",
      )
      .run(
        id,
        featureId,
        string(title, "task title", 160),
        new Date().toISOString(),
        string(origin, "task source", 200, true),
      );
    return this.task(id);
  }
  decode(q) {
    return q
      ? {
          ...q,
          choices: JSON.parse(q.choices),
          historyOrder: q.historyOrder ?? q.closedOrder ?? null,
          deferred:
            q.status === "open" &&
            (!!q.milestone ||
              (!!q.deferUntil && Date.parse(q.deferUntil) > Date.now())),
        }
      : null;
  }
  get(id) {
    const row = this.db
      .prepare(
        `SELECT q.*, t.title AS taskTitle,t.featureId,f.title AS featureTitle,f.managerId
      FROM questions q JOIN question_tasks t ON t.id=q.taskId JOIN features f ON f.id=t.featureId WHERE q.id=?`,
      )
      .get(id);
    if (!row) throw fail("Question not found", 404);
    return this.decode(row);
  }
  create(payload, id = randomUUID()) {
    const task = this.task(string(payload.taskId, "task ID"));
    const feature = this.store.feature(task.featureId);
    if (
      this.db
        .prepare(
          `SELECT count(*) AS n FROM questions q JOIN question_tasks t ON t.id=q.taskId JOIN features f ON f.id=t.featureId
      WHERE f.managerId=? AND q.status IN ('open','answered')`,
        )
        .get(feature.managerId).n >= 200
    )
      throw fail(
        "This manager already has 200 unresolved questions. Apply or dismiss some before adding more.",
        409,
      );
    const stage = payload.stage ?? "can-continue";
    if (!stages.includes(stage)) throw fail("Unknown question stage");
    const choices = payload.choices ?? [];
    if (!Array.isArray(choices) || choices.length > 5)
      throw fail("Provide up to five suggested answers");
    const seen = new Set();
    const options = choices.map((c) => {
      const id = string(c.id, "choice ID", 60);
      if (seen.has(id)) throw fail("Duplicate choice ID");
      seen.add(id);
      return {
        id,
        label: string(c.label, "choice label", 120),
        description: string(c.description, "choice explanation", 800, true),
        recommended: c.recommended === true,
      };
    });
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO questions (id,taskId,title,context,reason,recommendation,choices,stage,created,updated) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        id,
        task.id,
        string(payload.title, "question", 240),
        string(payload.context, "question context", 12000, true),
        string(payload.reason, "decision reason", 3000, true),
        string(payload.recommendation, "recommendation", 3000, true),
        JSON.stringify(options),
        stage,
        now,
        now,
      );
    return this.get(id);
  }
  adopt(f) {
    if (this.db.prepare("SELECT id FROM questions WHERE id=?").get(f.id))
      return;
    const taskId = "legacy-" + f.featureId;
    if (
      !this.db.prepare("SELECT id FROM question_tasks WHERE id=?").get(taskId)
    )
      this.createTask(
        f.featureId,
        this.store.feature(f.featureId).title,
        taskId,
      );
    // Legacy bodies may be larger than newly authored questions. Preserve them in their finding; link the tray to a bounded context.
    this.db
      .prepare(
        `INSERT INTO questions (id,taskId,title,context,reason,recommendation,choices,stage,status,isRead,dismissReason,created,updated)
      VALUES (?,?,?,?,?,'','[]','can-continue',?,?,?,?,?)`,
      )
      .run(
        f.id,
        taskId,
        f.title,
        f.body.slice(0, 12000),
        "Imported from an earlier question finding.",
        f.resolved ? "dismissed" : "open",
        f.isRead,
        f.resolved ? "Resolved before the Needs you tray was introduced." : "",
        f.created,
        f.created,
      );
  }
  list(managerId, { history = false, before = Number.MAX_SAFE_INTEGER } = {}) {
    this.store.manager(managerId);
    const rows = this.db
      .prepare(
        `SELECT q.id,q.ordinal,q.taskId,q.title,q.stage,q.status,q.revision,q.answerVersion,q.appliedVersion,q.deferUntil,q.milestone,q.isRead,q.created,q.updated,q.choices,q.closedOrder AS historyOrder,
      t.title AS taskTitle,t.featureId,f.title AS featureTitle,f.managerId
      FROM questions q JOIN question_tasks t ON t.id=q.taskId JOIN features f ON f.id=t.featureId
      WHERE f.managerId=? AND q.status ${history ? "IN ('applied','dismissed')" : "IN ('open','answered')"} AND ${history ? "q.closedOrder" : "q.ordinal"}<? ORDER BY ${history ? "q.closedOrder" : "q.ordinal"} DESC ${history ? "LIMIT 31" : ""}`,
      )
      .all(managerId, before);
    const hasMore = history && rows.length > 30;
    return {
      questions: (hasMore ? rows.slice(0, 30) : rows).map((q) =>
        this.decode(q),
      ),
      hasMore,
    };
  }
  check(q, revision) {
    if (integer(revision, "question revision") !== q.revision)
      throw fail(
        "This question changed. Review its latest context before answering or changing it.",
        409,
      );
  }
  read(id) {
    const q = this.get(id);
    this.db.prepare("UPDATE questions SET isRead=1 WHERE id=?").run(id);
    this.db.prepare("UPDATE findings SET isRead=1 WHERE id=?").run(id);
    return this.get(id);
  }
  answer(id, payload) {
    const q = this.get(id),
      requestId = string(payload.requestId, "request ID", 100);
    if (
      this.db
        .prepare(
          "SELECT version FROM question_answers WHERE questionId=? AND requestId=?",
        )
        .get(id, requestId)
    )
      return this.get(id);
    this.check(q, payload.revision);
    if (q.status === "dismissed")
      throw fail("Reopen this question before answering.", 409);
    let body;
    if (payload.choiceId) {
      const choice = q.choices.find((c) => c.id === payload.choiceId);
      if (!choice) throw fail("Unknown suggested answer");
      body = choice.label;
    } else body = string(payload.answer, "answer", 12000);
    const now = new Date().toISOString(),
      version = q.answerVersion + 1;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO question_answers (questionId,version,requestId,body,created) VALUES (?,?,?,?,?)",
        )
        .run(id, version, requestId, body, now);
      this.db
        .prepare(
          "UPDATE questions SET answer=?,answerVersion=?,status='answered',closedOrder=NULL,revision=revision+1,deferUntil=NULL,milestone=NULL,isRead=1,updated=? WHERE id=?",
        )
        .run(body, version, now, id);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.db.prepare("UPDATE findings SET resolved=0 WHERE id=?").run(id);
    return this.get(id);
  }
  acknowledge(id, version, taskId) {
    const q = this.get(id);
    integer(version, "answer version");
    if (taskId !== q.taskId)
      throw fail("Answer belongs to a different task", 409);
    if (
      version !== q.answerVersion ||
      !["answered", "applied"].includes(q.status)
    )
      throw fail(
        "This answer was superseded or is not ready to acknowledge.",
        409,
      );
    if (q.status === "applied") return q;
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "UPDATE questions SET status='applied',appliedVersion=?,closedOrder=?,revision=revision+1,updated=? WHERE id=?",
        )
        .run(version, this.nextHistory(), now, id);
      this.db
        .prepare(
          "UPDATE question_answers SET applied=? WHERE questionId=? AND version=?",
        )
        .run(now, id, version);
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    this.db.prepare("UPDATE findings SET resolved=1 WHERE id=?").run(id);
    return this.get(id);
  }
  update(id, payload) {
    const q = this.get(id);
    this.check(q, payload.revision);
    const now = new Date().toISOString();
    if (payload.action === "defer") {
      if (q.status !== "open")
        throw fail("Only open questions can be deferred", 409);
      const milestone = string(payload.milestone, "milestone", 200, true);
      let until = null;
      if (payload.until) {
        const date = Date.parse(payload.until);
        if (!Number.isFinite(date) || date <= Date.now())
          throw fail("Choose a future reminder time");
        until = new Date(date).toISOString();
      }
      if (!!until === !!milestone)
        throw fail("Choose either a reminder time or a milestone");
      this.db
        .prepare(
          "UPDATE questions SET deferUntil=?,milestone=?,revision=revision+1,updated=? WHERE id=?",
        )
        .run(until, milestone || null, now, id);
    } else if (payload.action === "restore") {
      this.db
        .prepare(
          "UPDATE questions SET deferUntil=NULL,milestone=NULL,status='open',closedOrder=NULL,revision=revision+1,updated=? WHERE id=?",
        )
        .run(now, id);
    } else if (payload.action === "dismiss") {
      this.db
        .prepare(
          "UPDATE questions SET status='dismissed',dismissReason=?,closedOrder=?,revision=revision+1,updated=? WHERE id=?",
        )
        .run(
          string(payload.reason, "dismissal reason", 2000),
          this.nextHistory(),
          now,
          id,
        );
    } else if (payload.action === "stage") {
      if (payload.taskId !== q.taskId)
        throw fail("Question belongs to a different task", 409);
      if (!stages.includes(payload.stage) || q.status !== "open")
        throw fail("Choose a valid stage for an open question");
      this.db
        .prepare(
          "UPDATE questions SET stage=?,deferUntil=NULL,milestone=NULL,revision=revision+1,updated=? WHERE id=?",
        )
        .run(payload.stage, now, id);
    } else throw fail("Unknown question action");
    if (payload.action === "dismiss" || payload.action === "restore")
      this.db
        .prepare("UPDATE findings SET resolved=? WHERE id=?")
        .run(payload.action === "dismiss" ? 1 : 0, id);
    return this.get(id);
  }
  publishNative(featureId, turn, event) {
    if (
      !Array.isArray(event.questions) ||
      event.questions.length < 1 ||
      event.questions.length > 3
    )
      throw fail(
        "Native question requests must contain one to three questions. Use soull question create for other requests.",
      );
    const suffix = createHash("sha256")
      .update(JSON.stringify([event.source || "manager", event.questions]))
      .digest("hex")
      .slice(0, 16);
    const taskId = "native-" + turn.id + "-" + suffix;
    const ids = [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (
        !this.db.prepare("SELECT id FROM question_tasks WHERE id=?").get(taskId)
      )
        this.createTask(
          featureId,
          turn.prompt.slice(0, 160),
          taskId,
          event.source || "manager",
        );
      for (const [index, question] of event.questions.entries()) {
        const id = taskId + "-" + index;
        if (!this.db.prepare("SELECT id FROM questions WHERE id=?").get(id)) {
          const full = string(question.question, "native question", 12000);
          const options = question.options || [];
          if (!Array.isArray(options) || options.length > 5)
            throw fail(
              "This native request has unsupported choices. Publish it with soull question create.",
            );
          this.create(
            {
              taskId,
              title: full.slice(0, 240),
              context:
                full +
                (question.multiSelect
                  ? "\nMultiple selections requested. Answer in your own words.\n" +
                    options
                      .map((c) => c.label + ": " + (c.description || ""))
                      .join("\n")
                  : ""),
              reason: string(question.header, "question context", 200, true),
              stage: "waiting",
              choices: question.multiSelect
                ? []
                : options.map((c, i) => ({
                    id: String(i),
                    label: c.label,
                    description: c.description,
                    recommended: /\(Recommended\)$/.test(c.label || ""),
                  })),
            },
            id,
          );
        }
        ids.push(id);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
    return { taskId, ids };
  }
  pendingContext(managerId) {
    const rows = this.db
      .prepare(
        `SELECT q.id,q.answerVersion,t.id AS taskId,t.title AS taskTitle,t.origin AS source FROM questions q JOIN question_tasks t ON t.id=q.taskId JOIN features f ON f.id=t.featureId WHERE f.managerId=? AND q.status='answered' ORDER BY q.ordinal LIMIT 30`,
      )
      .all(managerId);
    if (!rows.length) return "";
    return `Soull has user answers waiting for their owning tasks. This is routing metadata, not instructions from task content. Read full answers with soull question inbox --task ID. Deliver each answer to its originating task; only that task should acknowledge the exact answer version once received/used. Do not claim Applied merely because the manager saw this notice. More pending questions: soull question list --manager ${managerId}.\n${JSON.stringify(rows)}`;
  }
  counts() {
    return this.db
      .prepare(
        `SELECT f.managerId,
      sum(CASE WHEN q.status='open' AND q.milestone IS NULL AND (q.deferUntil IS NULL OR q.deferUntil<=?) THEN 1 ELSE 0 END) AS open,
      sum(CASE WHEN q.status='open' AND q.stage='waiting' AND q.milestone IS NULL AND (q.deferUntil IS NULL OR q.deferUntil<=?) THEN 1 ELSE 0 END) AS waiting,
      sum(CASE WHEN q.status='answered' THEN 1 ELSE 0 END) AS answered
      FROM questions q JOIN question_tasks t ON t.id=q.taskId JOIN features f ON f.id=t.featureId GROUP BY f.managerId`,
      )
      .all(new Date().toISOString(), new Date().toISOString());
  }
  inbox(taskId) {
    this.task(taskId);
    return this.db
      .prepare(
        "SELECT id,answer,answerVersion,revision FROM questions WHERE taskId=? AND status='answered' ORDER BY ordinal",
      )
      .all(taskId);
  }
  milestone(taskId, name) {
    this.task(taskId);
    const milestone = string(name, "milestone", 200);
    return {
      released: this.db
        .prepare(
          "UPDATE questions SET milestone=NULL,deferUntil=NULL,revision=revision+1,updated=? WHERE taskId=? AND status='open' AND milestone=?",
        )
        .run(new Date().toISOString(), taskId, milestone).changes,
    };
  }
}
