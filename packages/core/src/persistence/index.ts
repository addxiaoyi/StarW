/**
 * OpenStar Persistence Layer
 * SQLite-based state management for sessions, tasks, and workflows.
 * References: HomeRail's SQLite persistence model.
 */
import { createSqliteDatabase, type SqliteDatabase } from "./sqlite.js";
import path from "path";
import fs from "fs";

// ─── Types ───────────────────────────────────────────────────────────

export interface PersistenceConfig {
  dbPath: string;
  wal?: boolean;
  migrate?: boolean;
}

export interface StoredSession {
  id: string;
  agent_id: string;
  status: string;
  model: string | null;
  working_directory: string | null;
  metadata: string; // JSON
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export interface StoredTask {
  id: string;
  session_id: string | null;
  parent_task_id: string | null;
  title: string;
  description: string;
  priority: string;
  status: string;
  agent_id: string | null;
  input: string; // JSON
  output: string; // JSON
  error: string | null;
  progress: number;
  created_at: number;
  started_at: number | null;
  completed_at: number | null;
  metadata: string; // JSON
}

export interface StoredCheckpoint {
  id: string;
  session_id: string;
  task_id: string | null;
  label: string;
  snapshot: string; // JSON
  created_at: number;
}

export interface StoredEvent {
  id: string;
  session_id: string;
  actor_id: string;
  event_type: string;
  payload: string; // JSON
  timestamp: number;
}

// ─── Core ────────────────────────────────────────────────────────────

export class Persistence {
  private db: SqliteDatabase;
  private config: PersistenceConfig;

  constructor(config: PersistenceConfig) {
    this.config = { wal: true, migrate: true, ...config };
    const dir = path.dirname(this.config.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = createSqliteDatabase(this.config.dbPath);
    if (this.config.wal) {
      this.db.exec("PRAGMA journal_mode = WAL;");
    }
    this.db.exec("PRAGMA foreign_keys = ON;");
    if (this.config.migrate) {
      this.migrate();
    }
  }

  // ── Migration ──────────────────────────────────────────────────────

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        model TEXT,
        working_directory TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        parent_task_id TEXT,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'pending',
        agent_id TEXT,
        input TEXT NOT NULL DEFAULT '{}',
        output TEXT NOT NULL DEFAULT '{}',
        error TEXT,
        progress REAL NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        task_id TEXT,
        label TEXT NOT NULL,
        snapshot TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        actor_id TEXT NOT NULL DEFAULT '',
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        timestamp INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
      CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
      CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
      CREATE INDEX IF NOT EXISTS idx_checkpoints_session ON checkpoints(session_id);
    `);
  }

  // ── Sessions ───────────────────────────────────────────────────────

  saveSession(session: Omit<StoredSession, "updated_at">): StoredSession {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, agent_id, status, model, working_directory, metadata, created_at, updated_at, completed_at)
      VALUES (@id, @agent_id, @status, @model, @working_directory, @metadata, @created_at, @updated_at, @completed_at)
      ON CONFLICT(id) DO UPDATE SET
        status = @status,
        model = @model,
        metadata = @metadata,
        updated_at = @updated_at,
        completed_at = @completed_at
    `);
    stmt.run({ ...session, updated_at: now, completed_at: session.completed_at ?? null });
    return { ...session, updated_at: now };
  }

  getSession(id: string): StoredSession | null {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as StoredSession | undefined;
    return row ?? null;
  }

  listSessions(status?: string, limit = 50): StoredSession[] {
    if (status) {
      return this.db
        .prepare("SELECT * FROM sessions WHERE status = ? ORDER BY updated_at DESC LIMIT ?")
        .all(status, limit) as StoredSession[];
    }
    return this.db
      .prepare("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as StoredSession[];
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  }

  // ── Tasks ──────────────────────────────────────────────────────────

  saveTask(task: StoredTask): StoredTask {
    const stmt = this.db.prepare(`
      INSERT INTO tasks (id, session_id, parent_task_id, title, description, priority, status, agent_id, input, output, error, progress, created_at, started_at, completed_at, metadata)
      VALUES (@id, @session_id, @parent_task_id, @title, @description, @priority, @status, @agent_id, @input, @output, @error, @progress, @created_at, @started_at, @completed_at, @metadata)
      ON CONFLICT(id) DO UPDATE SET
        status = @status,
        agent_id = @agent_id,
        output = @output,
        error = @error,
        progress = @progress,
        started_at = @started_at,
        completed_at = @completed_at,
        metadata = @metadata
    `);
    stmt.run({
      ...task,
      session_id: task.session_id ?? null,
      parent_task_id: task.parent_task_id ?? null,
      agent_id: task.agent_id ?? null,
      error: task.error ?? null,
      started_at: task.started_at ?? null,
      completed_at: task.completed_at ?? null,
    });
    return task;
  }

  getTask(id: string): StoredTask | null {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as StoredTask | undefined;
    return row ?? null;
  }

  listTasks(filters?: { sessionId?: string; status?: string; priority?: string; parentTaskId?: string }, limit = 200): StoredTask[] {
    const conditions: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters?.sessionId) {
      conditions.push("session_id = @sessionId");
      params.sessionId = filters.sessionId;
    }
    if (filters?.status) {
      conditions.push("status = @status");
      params.status = filters.status;
    }
    if (filters?.priority) {
      conditions.push("priority = @priority");
      params.priority = filters.priority;
    }
    if (filters?.parentTaskId) {
      conditions.push("parent_task_id = @parentTaskId");
      params.parentTaskId = filters.parentTaskId;
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const sql = `SELECT * FROM tasks ${where} ORDER BY created_at DESC LIMIT ?`;
    return this.db.prepare(sql).all(...Object.values(params), limit) as StoredTask[];
  }

  // ── Checkpoints ────────────────────────────────────────────────────

  saveCheckpoint(checkpoint: StoredCheckpoint): StoredCheckpoint {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO checkpoints (id, session_id, task_id, label, snapshot, created_at)
      VALUES (@id, @session_id, @task_id, @label, @snapshot, @created_at)
    `);
    stmt.run({ ...checkpoint, task_id: checkpoint.task_id ?? null });
    return checkpoint;
  }

  getCheckpoints(sessionId: string): StoredCheckpoint[] {
    return this.db
      .prepare("SELECT * FROM checkpoints WHERE session_id = ? ORDER BY created_at DESC")
      .all(sessionId) as StoredCheckpoint[];
  }

  // ── Events (Activity Journal) ──────────────────────────────────────

  appendEvent(event: StoredEvent): StoredEvent {
    const stmt = this.db.prepare(`
      INSERT INTO events (id, session_id, actor_id, event_type, payload, timestamp)
      VALUES (@id, @session_id, @actor_id, @event_type, @payload, @timestamp)
    `);
    stmt.run(event);
    return event;
  }

  getEvents(sessionId: string, eventType?: string, limit = 500): StoredEvent[] {
    if (eventType) {
      return this.db
        .prepare("SELECT * FROM events WHERE session_id = ? AND event_type = ? ORDER BY timestamp ASC LIMIT ?")
        .all(sessionId, eventType, limit) as StoredEvent[];
    }
    return this.db
      .prepare("SELECT * FROM events WHERE session_id = ? ORDER BY timestamp ASC LIMIT ?")
      .all(sessionId, limit) as StoredEvent[];
  }

  // ── Stats ──────────────────────────────────────────────────────────

  getStats() {
    const sessions = this.db.prepare("SELECT COUNT(*) as count FROM sessions").get() as { count: number };
    const tasks = this.db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number };
    const events = this.db.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number };
    const tasksByStatus = this.db.prepare(
      "SELECT status, COUNT(*) as count FROM tasks GROUP BY status"
    ).all() as { status: string; count: number }[];

    return {
      totalSessions: sessions.count,
      totalTasks: tasks.count,
      totalEvents: events.count,
      tasksByStatus: Object.fromEntries(tasksByStatus.map((r) => [r.status, r.count])),
    };
  }

  // ── Lifecycle ──────────────────────────────────────────────────────

  close(): void {
    this.db.close();
  }

  get raw(): SqliteDatabase {
    return this.db;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────

let defaultInstance: Persistence | null = null;

export function initPersistence(config: PersistenceConfig): Persistence {
  defaultInstance?.close();
  defaultInstance = new Persistence(config);
  return defaultInstance;
}

export function getPersistence(): Persistence {
  if (!defaultInstance) {
    const dbPath = process.env.OPENSTAR_DB_PATH ||
      path.join(process.env.HOME || process.env.USERPROFILE || "/tmp", ".openstar", "state.db");
    defaultInstance = new Persistence({ dbPath });
  }
  return defaultInstance;
}

// ─── Helpers ─────────────────────────────────────────────────────────

export function generateId(): string {
  // ULID-like: timestamp + random
  const timestamp = Date.now().toString(36);
  const random = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 36).toString(36)
  ).join("");
  return `${timestamp}${random}`;
}
