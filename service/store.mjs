import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS managers (id TEXT PRIMARY KEY, name TEXT NOT NULL, repo TEXT NOT NULL, provider TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS features (id TEXT PRIMARY KEY, managerId TEXT NOT NULL REFERENCES managers(id), title TEXT NOT NULL, branch TEXT NOT NULL, workspace TEXT NOT NULL, base TEXT NOT NULL, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS findings (id TEXT PRIMARY KEY, featureId TEXT NOT NULL REFERENCES features(id), title TEXT NOT NULL, body TEXT NOT NULL, kind TEXT NOT NULL, isRead INTEGER NOT NULL DEFAULT 0, resolved INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
    PRAGMA user_version=1;`);
  return {
    db,
    snapshot() {
      return {
        managers: db.prepare("SELECT * FROM managers ORDER BY created").all(),
        features: db.prepare("SELECT * FROM features ORDER BY created").all(),
        findings: db
          .prepare("SELECT * FROM findings ORDER BY created DESC")
          .all(),
      };
    },
    manager(id) {
      const v = db.prepare("SELECT * FROM managers WHERE id=?").get(id);
      if (!v)
        throw Object.assign(new Error("Manager not found"), { status: 404 });
      return v;
    },
    feature(id) {
      const v = db.prepare("SELECT * FROM features WHERE id=?").get(id);
      if (!v)
        throw Object.assign(new Error("Feature not found"), { status: 404 });
      return v;
    },
    addManager(name, repo, provider) {
      const v = {
        id: randomUUID(),
        name,
        repo,
        provider,
        created: new Date().toISOString(),
      };
      db.prepare("INSERT INTO managers VALUES (?,?,?,?,?)").run(
        v.id,
        name,
        repo,
        provider,
        v.created,
      );
      return v;
    },
    addFeature(v) {
      db.prepare("INSERT INTO features VALUES (?,?,?,?,?,?,?)").run(
        v.id,
        v.managerId,
        v.title,
        v.branch,
        v.workspace,
        v.base,
        v.created,
      );
      return v;
    },
    addFinding(featureId, title, body, kind) {
      this.feature(featureId);
      const v = {
        id: randomUUID(),
        featureId,
        title,
        body,
        kind,
        isRead: 0,
        resolved: 0,
        created: new Date().toISOString(),
      };
      db.prepare("INSERT INTO findings VALUES (?,?,?,?,?,?,?,?)").run(
        v.id,
        featureId,
        title,
        body,
        kind,
        0,
        0,
        v.created,
      );
      return v;
    },
    updateFinding(id, patch) {
      if (!db.prepare("SELECT id FROM findings WHERE id=?").get(id))
        throw Object.assign(new Error("Finding not found"), { status: 404 });
      for (const key of ["isRead", "resolved"])
        if (typeof patch[key] === "boolean")
          db.prepare(`UPDATE findings SET ${key}=? WHERE id=?`).run(
            Number(patch[key]),
            id,
          );
    },
    close() {
      db.close();
    },
  };
}
